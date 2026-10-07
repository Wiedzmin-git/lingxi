using System.Net;
using System.Net.Sockets;
using System.Text.Json;

namespace Lingxi.Launcher;

public static class FreshProfile
{
    public static Installation Create(InstallationStore installation, string directory, string channel)
    {
        if (!Path.IsPathFullyQualified(directory) || channel is not ("dev" or "stable"))
            throw new ArgumentException("A qualified new profile directory and dev/stable channel are required");
        directory = Path.GetFullPath(directory);
        using var ownership = installation.Lock("initialize");
        if (File.Exists(Path.Combine(installation.Root, "installation.json")) || File.Exists(Path.Combine(installation.Root, "installation.json.previous")))
            throw new IOException("Installation already initialized");
        if (Directory.Exists(directory) && Directory.EnumerateFileSystemEntries(directory).Any())
            throw new IOException("New profile directory must be empty; existing profiles require explicit binding");
        Directory.CreateDirectory(directory);
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new IOException("New profile directory cannot be a link");
        var id = Guid.NewGuid().ToString();
        using var port = new TcpListener(IPAddress.Loopback, 0);
        port.Start();
        var descriptor = new
        {
            format = 1, id,
            desktopUserData = Path.Combine(directory, "desktop"),
            dataHome = Path.Combine(directory, "data"),
            configHome = Path.Combine(directory, "config"),
            cacheHome = Path.Combine(directory, "cache"),
            stateHome = Path.Combine(directory, "state"),
            database = Path.Combine(directory, "data", "opencode", "history.db"),
            serviceRegistration = Path.Combine(directory, "state", "opencode", "service.json"),
            serviceConfig = Path.Combine(directory, "config", "opencode", "service.json"),
            servicePort = ((IPEndPoint)port.LocalEndpoint).Port,
        };
        var binding = Path.Combine(directory, "binding.json");
        // Do not adopt or overwrite a partial profile on retry. Its immutable descriptor
        // remains available for explicit initialize/recovery if initialization fails.
        using (var output = new FileStream(binding, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(output, descriptor, Wire.Json);
            output.Flush(true);
        }
        return installation.Initialize(binding, id, channel);
    }
}
