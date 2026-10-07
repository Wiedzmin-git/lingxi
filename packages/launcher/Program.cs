using System.Text;
using System.Text.Json;
using Lingxi.Launcher;

try
{
    if (args.Length == 0) throw new ArgumentException("Usage: Lingxi.Launcher <status|initialize|initialize-new|channel|stage-local|stage|launch|credential> <installation-root> ...");
    if (args[0] == "credential")
    {
        if (args.Length != 1 || Console.IsInputRedirected) throw new ArgumentException("Credential entry requires an interactive console; never pass a token as an argument");
        Console.Write("GitHub read-only release token: ");
        var token = new StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(true);
            if (key.Key == ConsoleKey.Enter) break;
            if (key.Key == ConsoleKey.Backspace) { if (token.Length > 0) token.Length--; continue; }
            if (!char.IsControl(key.KeyChar) && token.Length < 2048) token.Append(key.KeyChar);
        }
        WindowsCredential.Write(token.ToString());
        token.Clear();
        Console.WriteLine("\nSaved in Windows Credential Manager.");
        return 0;
    }
    if (args.Length < 2) throw new ArgumentException("An explicit installation root is required");
    var installation = new InstallationStore(args[1]);
    var bundles = new BundleStore(installation.Root);
    switch (args[0])
    {
        case "initialize-new" when args.Length == 4:
            FreshProfile.Create(installation, args[2], args[3]);
            break;
        case "initialize" when args.Length == 5:
            installation.Initialize(args[2], args[3], args[4]);
            break;
        case "status" when args.Length == 2:
            Console.WriteLine(JsonSerializer.Serialize(installation.Read(), Wire.Json));
            break;
        case "channel" when args.Length == 3:
            installation.SelectChannel(args[2]);
            break;
        case "stage-local" when args.Length == 5:
            using (installation.Lock("stage"))
                installation.SelectCandidate(bundles.Stage(args[2], args[3], long.Parse(args[4])));
            break;
        case "stage" when args.Length == 2:
            using (installation.Lock("stage"))
            using (var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(15)))
            using (var handler = new HttpClientHandler { AllowAutoRedirect = false })
            using (var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan })
            {
                var feed = new PrivateDistribution(client);
                var credential = WindowsCredential.Read();
                var manifest = await feed.Channel(installation.Read().Channel, credential, deadline.Token);
                var archive = Path.Combine(installation.Root, "downloads", Guid.NewGuid().ToString("N") + ".zip");
                try
                {
                    await feed.Download(manifest, archive, credential, deadline.Token);
                    var candidate = bundles.Stage(archive, manifest.ArchiveSha256, manifest.ArchiveBytes);
                    if (candidate.ReleaseId != manifest.ReleaseId) throw new InvalidDataException("Channel and bundle release identities differ");
                    installation.SelectCandidate(candidate);
                }
                finally { if (File.Exists(archive)) File.Delete(archive); }
            }
            break;
        case "launch" when args.Length == 2:
            Console.WriteLine(await new LaunchCoordinator(installation, bundles).Launch(CancellationToken.None));
            break;
        default: throw new ArgumentException("Unknown command or argument count");
    }
    return 0;
}
catch (Exception error)
{
    // URLs, response bodies, environment and credential values are deliberately absent.
    Console.Error.WriteLine(error is HttpRequestException http ? $"Private release request failed ({(int?)http.StatusCode})" : error.Message);
    return 1;
}
