using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;

namespace Lingxi.Launcher;

public sealed class PrivateDistribution(HttpClient http, string channelPrefix = "lingxi-channel-")
{
    private const string Repository = "https://api.github.com/repos/Wiedzmin-git/lingxi-releases";

    public async Task<ChannelManifest> Channel(string channel, string credential, CancellationToken cancellationToken)
    {
        if (channel is not ("dev" or "stable")) throw new ArgumentException("Unknown channel");
        if (channelPrefix is not ("lingxi-channel-" or "lingxi-runtime-")) throw new ArgumentException("Unknown feed capability");
        using var request = Request(new Uri(Repository + "/releases/tags/" + channelPrefix + channel), credential, false);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var release = JsonDocument.Parse(await Bounded(response.Content, 1_048_576, cancellationToken));
        var asset = release.RootElement.GetProperty("assets").EnumerateArray()
            .Single(item => item.GetProperty("name").GetString() == "channel.json");
        using var payload = await Asset(asset.GetProperty("id").GetInt64(), credential, cancellationToken);
        var manifest = JsonSerializer.Deserialize<ChannelManifest>(await Bounded(payload.Content, 65_536, cancellationToken), Wire.Json)
            ?? throw new InvalidDataException("Empty channel manifest");
        if (manifest.Format != 1 || manifest.Channel != channel || manifest.ArchiveAssetId <= 0
            || manifest.ArchiveBytes <= 0 || manifest.ArchiveBytes > 4L * 1024 * 1024 * 1024
            || !Wire.Digest(manifest.ArchiveSha256) || string.IsNullOrWhiteSpace(manifest.ReleaseId))
            throw new InvalidDataException("Invalid channel manifest");
        return manifest;
    }

    public async Task Download(ChannelManifest manifest, string destination, string credential, CancellationToken cancellationToken,
        Action<long, long>? progress = null)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        var complete = false;
        var created = false;
        try
        {
            progress?.Invoke(0, manifest.ArchiveBytes);
            using var response = await Asset(manifest.ArchiveAssetId, credential, cancellationToken);
            if (response.Content.Headers.ContentLength is { } bytes && bytes != manifest.ArchiveBytes)
                throw new InvalidDataException("Asset size does not match channel manifest");
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
            await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65_536, true);
            created = true;
            var buffer = new byte[65_536];
            long total = 0;
            while (true)
            {
                var count = await input.ReadAsync(buffer, cancellationToken);
                if (count == 0) break;
                total = checked(total + count);
                if (total > manifest.ArchiveBytes) throw new InvalidDataException("Asset exceeded admitted size");
                hash.AppendData(buffer, 0, count);
                await output.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
                progress?.Invoke(total, manifest.ArchiveBytes);
            }
            if (total != manifest.ArchiveBytes || !Convert.ToHexStringLower(hash.GetHashAndReset()).Equals(manifest.ArchiveSha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Downloaded asset failed digest verification");
            output.Flush(true);
            complete = true;
        }
        finally { if (created && !complete && File.Exists(destination)) File.Delete(destination); }
    }

    private async Task<HttpResponseMessage> Asset(long id, string credential, CancellationToken cancellationToken)
    {
        if (id <= 0) throw new InvalidDataException("Invalid asset ID");
        using var request = Request(new Uri(Repository + "/releases/assets/" + id), credential, true);
        var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (response.StatusCode is HttpStatusCode.Found or HttpStatusCode.TemporaryRedirect or HttpStatusCode.SeeOther)
        {
            var location = response.Headers.Location;
            response.Dispose();
            if (location is null || !location.IsAbsoluteUri || location.Scheme != "https"
                || !(location.Host == "release-assets.githubusercontent.com" || location.Host == "objects.githubusercontent.com"))
                throw new InvalidDataException("Unexpected private asset redirect");
            // Signed asset URLs carry their own access grant. The repository credential stays on api.github.com.
            using var redirected = Request(location, null, true);
            response = await http.SendAsync(redirected, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        }
        if (!response.IsSuccessStatusCode)
        {
            var status = response.StatusCode;
            response.Dispose();
            throw new HttpRequestException("Private release request failed", null, status);
        }
        return response;
    }

    private static HttpRequestMessage Request(Uri uri, string? credential, bool asset)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.UserAgent.ParseAdd("Lingxi-Launcher/0.1");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(asset ? "application/octet-stream" : "application/vnd.github+json"));
        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        if (credential is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential);
        return request;
    }

    private static async Task<byte[]> Bounded(HttpContent content, int limit, CancellationToken cancellationToken)
    {
        using var output = new MemoryStream();
        await using var input = await content.ReadAsStreamAsync(cancellationToken);
        var buffer = new byte[4096];
        while (true)
        {
            var count = await input.ReadAsync(buffer, cancellationToken);
            if (count == 0) return output.ToArray();
            if (output.Length + count > limit) throw new InvalidDataException("Release metadata exceeds size limit");
            output.Write(buffer, 0, count);
        }
    }
}
