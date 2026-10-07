using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Lingxi.Launcher;

public sealed record SupervisorReceipt(int Protocol, string AttemptId, string BundleSha256,
    string ProfileDigest, int ProcessId, DateTimeOffset StartedAt);

// Kept outside installation.json: a legacy supervisor must still be able to finish
// its accepted Desktop's journal after the bridge has installed the new shortcuts.
public static class SupervisorBootstrap
{
    private static string ReceiptPath(InstallationStore installation, string attempt) =>
        Path.Combine(installation.Root, "supervisor-" + attempt + ".json");

    public static void Record(InstallationStore installation, Attempt attempt, ProfileSelection profile)
    {
        using var process = Process.GetCurrentProcess();
        Wire.AtomicWrite(ReceiptPath(installation, attempt.Id), new SupervisorReceipt(2, attempt.Id,
            attempt.Sha256, profile.BindingSha256, process.Id, process.StartTime.ToUniversalTime()));
    }

    public static bool Current(InstallationStore installation, Installation state)
    {
        if (state.Attempt is not { } attempt) return false;
        var file = ReceiptPath(installation, attempt.Id);
        if (!File.Exists(file)) return false;
        var receipt = Wire.Read<SupervisorReceipt>(file);
        if (receipt.Protocol != 2 || receipt.AttemptId != attempt.Id || receipt.BundleSha256 != attempt.Sha256
            || receipt.ProfileDigest != state.Profile.BindingSha256) return false;
        try
        {
            using var process = Process.GetProcessById(receipt.ProcessId);
            return !process.HasExited && process.StartTime.ToUniversalTime() == receipt.StartedAt.UtcDateTime;
        }
        catch (ArgumentException) { return false; }
    }

    public static void Prepare(InstallationStore installation, BundleStore bundles, Installation state)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        var current = state.Current ?? throw new InvalidOperationException("No accepted Desktop to bootstrap");
        bundles.Verify(current);
        var helper = Path.Combine(bundles.DirectoryFor(current.Sha256), "resources", "lingxi-updater", "Lingxi.Launcher.exe");
        if (!File.Exists(helper) || Wire.Hash(helper) != Wire.Hash(Environment.ProcessPath!))
            throw new InvalidOperationException("Bootstrap helper does not belong to the accepted Desktop");
        var target = Path.Combine(bundles.DirectoryFor(current.Sha256), "resources", "lingxi-updater", "Lingxi.Start.exe");
        if (!File.Exists(target)) throw new InvalidDataException("The accepted bundle has no supervisor");
        var arguments = "\"" + installation.Root + "\"";
        var shortcuts = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Lingxi.lnk"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "Lingxi", "Lingxi.lnk"),
            Path.Combine(installation.Root, "Lingxi.lnk")
        };
        foreach (var file in shortcuts)
            Redirect(file, target, arguments, installation.Root, file == shortcuts[^1]);
        Redirect(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "Lingxi", "Stage updates.lnk"),
            helper, "stage-interactive " + arguments, installation.Root, false);
    }

    public static bool Redirect(string file, string target, string arguments, string root, bool create)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        var exists = File.Exists(file);
        if (!exists && !create) return false;
        var original = exists ? Wire.Hash(file) : null;
        var type = Type.GetTypeFromProgID("WScript.Shell") ?? throw new InvalidOperationException("Windows shortcuts are unavailable");
        dynamic shell = Activator.CreateInstance(type)!;
        dynamic link = shell.CreateShortcut(file);
        try
        {
            if (exists)
            {
                string previous = link.TargetPath;
                string previousArguments = link.Arguments;
                if (previousArguments != arguments) return false;
                if (Path.GetFullPath(previous).Equals(Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase)) return true;
                var relative = Path.GetRelativePath(Path.Combine(root, "bundles"), previous).Replace('\\', '/');
                var parts = relative.Split('/');
                if (parts.Length != 4 || !Wire.Digest(parts[0]) || parts[1] != "resources"
                    || parts[2] != "lingxi-updater" || parts[3] != Path.GetFileName(target)) return false;
            }
            // Save to a sibling before replacing; interruption leaves either complete link.
            var temporary = Path.Combine(Path.GetDirectoryName(file)!, Guid.NewGuid().ToString("N") + ".lnk");
            dynamic replacement = shell.CreateShortcut(temporary);
            try
            {
                replacement.TargetPath = target;
                replacement.Arguments = arguments;
                replacement.WorkingDirectory = root;
                replacement.IconLocation = exists ? link.IconLocation : target;
                replacement.Save();
                if (exists)
                {
                    if (Wire.Hash(file) != original) throw new IOException("Startup shortcut changed during bootstrap");
                    var backup = Path.Combine(root, "bootstrap", Guid.NewGuid().ToString("N") + ".lnk");
                    Directory.CreateDirectory(Path.GetDirectoryName(backup)!);
                    File.Copy(file, backup, false);
                    File.Move(temporary, file, true);
                }
                else File.Move(temporary, file, false);
            }
            finally
            {
                Marshal.FinalReleaseComObject(replacement);
                if (File.Exists(temporary)) File.Delete(temporary);
            }
            return true;
        }
        finally
        {
            Marshal.FinalReleaseComObject(link);
            Marshal.FinalReleaseComObject(shell);
        }
    }
}
