using System.Collections.Concurrent;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

public sealed class DownloadFixture : IAsyncDisposable
{
    private readonly TcpListener listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource stopping = new();
    private readonly X509Certificate2 certificate;
    private readonly Task accepting;
    private readonly ConcurrentBag<Task> clients = [];
    public ConcurrentBag<string> Requests { get; } = [];

    public DownloadFixture()
    {
        using var key = RSA.Create(2048);
        var request = new CertificateRequest("CN=localhost", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var ephemeral = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddHours(1));
        certificate = X509CertificateLoader.LoadPkcs12(ephemeral.Export(X509ContentType.Pfx), null, X509KeyStorageFlags.UserKeySet);
        listener.Start();
        accepting = Accept();
    }

    public HttpClient Client() => new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        UseProxy = false,
        SslOptions = new SslClientAuthenticationOptions { RemoteCertificateValidationCallback = (_, _, _, _) => true },
        ConnectCallback = async (_, cancellationToken) =>
        {
            var socket = new Socket(SocketType.Stream, ProtocolType.Tcp);
            await socket.ConnectAsync(listener.LocalEndpoint, cancellationToken);
            return new NetworkStream(socket, true);
        }
    }) { Timeout = TimeSpan.FromSeconds(10) };

    private async Task Accept()
    {
        try
        {
            while (!stopping.IsCancellationRequested)
            {
                var client = await listener.AcceptTcpClientAsync(stopping.Token);
                clients.Add(Respond(client));
            }
        }
        catch (OperationCanceledException) { }
    }

    private async Task Respond(TcpClient client)
    {
        using (client)
        await using (var stream = new SslStream(client.GetStream()))
        {
            await stream.AuthenticateAsServerAsync(certificate, false, SslProtocols.Tls12 | SslProtocols.Tls13, false);
            using var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
            var request = new StringBuilder();
            while (await reader.ReadLineAsync(stopping.Token) is { Length: > 0 } line) request.AppendLine(line);
            var text = request.ToString();
            Requests.Add(text);
            var response = text.StartsWith("GET /signed ", StringComparison.Ordinal)
                ? "HTTP/1.1 200 OK\r\nContent-Length: 23\r\nConnection: close\r\n\r\nimmutable release bytes"
                : text.Contains("/assets/18 ", StringComparison.Ordinal)
                    ? "HTTP/1.1 200 OK\r\nContent-Length: 23\r\nConnection: close\r\n\r\npartial"
                    : text.Contains("/assets/19 ", StringComparison.Ordinal)
                        ? "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        : "HTTP/1.1 302 Found\r\nLocation: https://release-assets.githubusercontent.com/signed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(response), stopping.Token);
        }
    }

    public async ValueTask DisposeAsync()
    {
        stopping.Cancel();
        listener.Stop();
        await accepting;
        await Task.WhenAll(clients);
        certificate.Dispose();
        stopping.Dispose();
    }
}
