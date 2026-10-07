using System.IO.Compression;
using System.Security.Cryptography;

namespace Lingxi.Launcher;

public sealed class BundleStore(string root)
{
    public string DirectoryFor(string digest)
    {
        if (!Wire.Digest(digest)) throw new InvalidDataException("Invalid bundle digest");
        return Path.Combine(root, "bundles", digest.ToLowerInvariant());
    }

    public Slot Stage(string archive, string expectedDigest, long expectedBytes)
    {
        using var archiveStream = new FileStream(archive, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (expectedBytes <= 0 || expectedBytes > 4L * 1024 * 1024 * 1024 || archiveStream.Length != expectedBytes
            || !Wire.Digest(expectedDigest) || !Convert.ToHexStringLower(SHA256.HashData(archiveStream)).Equals(expectedDigest, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Archive size or digest mismatch");
        archiveStream.Position = 0;
        var destination = DirectoryFor(expectedDigest);
        var temporary = Path.Combine(root, "staging", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporary);
        try
        {
            using (var zip = new ZipArchive(archiveStream, ZipArchiveMode.Read, true))
            {
                if (zip.Entries.Count > 50_000) throw new InvalidDataException("Too many archive entries");
                var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                long expanded = 0;
                foreach (var entry in zip.Entries)
                {
                    var directory = entry.FullName.EndsWith('/');
                    var name = directory ? entry.FullName[..^1] : entry.FullName;
                    var path = Wire.Within(temporary, name);
                    if (!names.Add(name) || (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0
                        || ((entry.ExternalAttributes >> 16) & 0xf000) == 0xa000)
                        throw new InvalidDataException("Duplicate or linked archive entry");
                    expanded = checked(expanded + entry.Length);
                    if (expanded > 8L * 1024 * 1024 * 1024) throw new InvalidDataException("Expanded bundle exceeds size limit");
                    if (directory) { Directory.CreateDirectory(path); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    using var source = entry.Open();
                    using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    source.CopyTo(output);
                    if (output.Length != entry.Length) throw new InvalidDataException("Incomplete archive entry");
                    output.Flush(true);
                }
            }
            var slot = VerifyDirectory(temporary, expectedDigest);
            if (Directory.Exists(destination)) return Verify(slot);
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            Directory.Move(temporary, destination);
            return slot;
        }
        finally { if (Directory.Exists(temporary)) Directory.Delete(temporary, true); }
    }

    public Slot Verify(Slot expected)
    {
        var actual = VerifyDirectory(DirectoryFor(expected.Sha256), expected.Sha256);
        if (actual.ManifestSha256 != expected.ManifestSha256) throw new InvalidDataException("Bundle manifest changed after admission");
        return actual;
    }
    public BundleManifest Manifest(string digest) => Wire.Read<BundleManifest>(Path.Combine(DirectoryFor(digest), "bundle.json"));

    private static Slot VerifyDirectory(string directory, string digest)
    {
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Linked bundle directory");
        var inventory = new List<string>();
        var directories = new Stack<string>();
        directories.Push(directory);
        while (directories.TryPop(out var current))
            foreach (var item in Directory.EnumerateFileSystemEntries(current))
            {
                var attributes = File.GetAttributes(item);
                if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Linked bundle content");
                if ((attributes & FileAttributes.Directory) != 0) directories.Push(item);
                else inventory.Add(Path.GetRelativePath(directory, item).Replace('\\', '/'));
            }
        var manifest = Wire.Read<BundleManifest>(Path.Combine(directory, "bundle.json"));
        if (manifest.Format != 1 || string.IsNullOrWhiteSpace(manifest.ReleaseId) || !Wire.Digest(manifest.StorageContract)
            || string.IsNullOrWhiteSpace(manifest.BackendVersion) || manifest.Files.Length == 0
            || manifest.AllowedFallbacks.Any(value => !Wire.Digest(value)))
            throw new InvalidDataException("Invalid bundle manifest");
        var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "bundle.json" };
        foreach (var item in manifest.Files)
        {
            var file = Wire.Within(directory, item.Path);
            if (!files.Add(item.Path) || item.Bytes < 0 || !Wire.Digest(item.Sha256))
                throw new InvalidDataException("Invalid manifest file");
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0 || new FileInfo(file).Length != item.Bytes
                || !Wire.Hash(file).Equals(item.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Bundle file failed verification");
        }
        if (!files.Contains(manifest.Entrypoint) || manifest.Entrypoint == "bundle.json")
            throw new InvalidDataException("Entrypoint is not an inventoried executable");
        if (inventory.Any(item => !files.Contains(item))) throw new InvalidDataException("Unlisted bundle content");
        return new Slot(digest.ToLowerInvariant(), Wire.Hash(Path.Combine(directory, "bundle.json")), manifest.ReleaseId,
            manifest.StorageContract.ToLowerInvariant(), manifest.BackendVersion, manifest.AllowedFallbacks.Select(value => value.ToLowerInvariant()).ToArray());
    }
}
