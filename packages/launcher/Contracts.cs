using System.Text.Json;
using System.Text.Json.Serialization;
using System.Security.Cryptography;

namespace Lingxi.Launcher;

public sealed record BundleFile(string Path, long Bytes, string Sha256);
public sealed record BundleManifest(int Format, string ReleaseId, string Entrypoint, string StorageContract,
    string BackendVersion, string[] AllowedFallbacks, BundleFile[] Files);
public sealed record ChannelManifest(int Format, string Channel, string ReleaseId, long ArchiveAssetId,
    long ArchiveBytes, string ArchiveSha256);
public sealed record Slot(string Sha256, string ManifestSha256, string ReleaseId, string StorageContract, string BackendVersion,
    string[] AllowedFallbacks);
public sealed record ProfileSelection(string BindingPath, string Id, string BindingSha256, string OwnershipDirectory);
public sealed record Attempt(string Id, string Sha256, string Phase, DateTimeOffset StartedAt,
    int? ProcessId = null, DateTimeOffset? ProcessStartedAt = null, Slot? Bundle = null);
public sealed record Installation(int Format, ProfileSelection Profile, string Channel, Slot? Current = null,
    Slot? Candidate = null, Slot? Previous = null, Attempt? Attempt = null, string? Blocked = null, RecoveryEpisode? Episode = null);
public sealed record RecoveryEpisode(string Id, Slot Primary, Slot? Fallback, string Phase);
public sealed record Readiness(int Format, string AttemptId, string BundleSha256, string ProfileId,
    string BindingSha256, int ProcessId, string BackendVersion, bool Storage, bool Renderer, bool Server,
    bool SessionLink);

public static class Wire
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
        WriteIndented = true
    };

    public static T Read<T>(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
        if (stream.Length > 4 * 1024 * 1024) throw new InvalidDataException("Descriptor exceeds size limit");
        return JsonSerializer.Deserialize<T>(stream, Json)
            ?? throw new InvalidDataException("Descriptor is null");
    }

    public static bool Digest(string value) => value.Length == 64 && value.All(char.IsAsciiHexDigit);

    public static string Hash(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexStringLower(SHA256.HashData(stream));
    }

    public static string Within(string root, string relative)
    {
        if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative) || relative.Contains(':') || relative.Contains('\\'))
            throw new InvalidDataException("Bundle path must be relative slash-separated text");
        if (relative.Split('/').Any(part => part is "" or "." or ".." || part.EndsWith('.') || part.EndsWith(' ')))
            throw new InvalidDataException("Invalid bundle path segment");
        var result = Path.GetFullPath(Path.Combine(root, relative));
        if (!result.StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Bundle path escapes its slot");
        return result;
    }

    public static void AtomicWrite<T>(string path, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                JsonSerializer.Serialize(stream, value, Json);
                stream.Flush(true);
            }
            if (File.Exists(path)) File.Replace(temporary, path, path + ".previous", true);
            else File.Move(temporary, path);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
