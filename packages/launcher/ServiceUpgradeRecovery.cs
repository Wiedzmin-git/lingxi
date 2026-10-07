using System.Diagnostics;
using System.Text.Json;

namespace Lingxi.Launcher;

// Only a pre-readiness service generation created during this exact launch may
// be retired. Ordinary Desktop failures continue to preserve an existing server.
public static class ServiceUpgradeRecovery
{
    public static string Marker(InstallationStore installation, Attempt attempt) =>
        Path.Combine(installation.Root, "service-upgrade-" + attempt.Id + ".json");

    public static async Task Retire(InstallationStore installation, ProfileSelection profile, Attempt attempt)
    {
        var marker = Marker(installation, attempt);
        if (!File.Exists(marker)) return;
        InstallationStore.VerifyProfile(profile);
        using var upgrade = JsonDocument.Parse(File.ReadAllBytes(marker));
        var note = upgrade.RootElement;
        if (note.GetProperty("attemptId").GetString() != attempt.Id || note.GetProperty("profileDigest").GetString() != profile.BindingSha256)
            throw new InvalidDataException("Service upgrade recovery does not match this launch");
        using var descriptor = JsonDocument.Parse(File.ReadAllBytes(profile.BindingPath));
        var registration = descriptor.RootElement.GetProperty("serviceRegistration").GetString()!;
        var expected = Path.Combine(descriptor.RootElement.GetProperty("desktopUserData").GetString()!,
            "cli", BackendTransition.CacheVersion(attempt.Bundle!.BackendVersion), "opencode-cli.exe");
        var contenders = note.GetProperty("contenders").EnumerateArray().Select(value => value.GetInt32()).ToArray();
        foreach (var pid in contenders)
        {
            Process? process;
            try { process = Process.GetProcessById(pid); }
            catch (ArgumentException) { continue; }
            using (process)
            {
                if (process.HasExited) continue;
                if (!Path.GetFullPath(process.MainModule!.FileName).Equals(Path.GetFullPath(expected), StringComparison.OrdinalIgnoreCase)
                    || process.StartTime.ToUniversalTime() < note.GetProperty("startedAt").GetDateTimeOffset().UtcDateTime)
                    throw new InvalidOperationException("Replacement process ownership is not established; recovery was stopped");
                process.Kill(false);
                await process.WaitForExitAsync(CancellationToken.None);
            }
        }
        // A crash inside process creation, before its PID was durably recorded,
        // must not authorize fallback while an unknown contender could publish.
        if (note.GetProperty("pendingSpawn").GetBoolean())
            throw new InvalidOperationException("Replacement process admission is uncertain; automatic recovery was stopped");
        if (!File.Exists(registration)) { File.Delete(marker); return; }
        var bytes = File.ReadAllBytes(registration);
        using var document = JsonDocument.Parse(bytes);
        var current = document.RootElement;
        // Preserve the original only if it still exists. stop() can be interrupted
        // between its process exit and removal of the old registration.
        var originalRegistration = current.GetProperty("pid").GetInt32() == note.GetProperty("previousPid").GetInt32()
            && (current.TryGetProperty("id", out var identity) ? identity.GetString() : null) == note.GetProperty("previousId").GetString();
        if (originalRegistration)
        {
            try
            {
                using var original = Process.GetProcessById(current.GetProperty("pid").GetInt32());
                if (!original.HasExited) { File.Delete(marker); return; }
            }
            catch (ArgumentException) { }
        }
        else if (!contenders.Contains(current.GetProperty("pid").GetInt32()))
            throw new InvalidOperationException("Registration belongs to an unrecorded service; recovery was stopped");
        var expectedVersion = originalRegistration && note.TryGetProperty("previousVersion", out var previousVersion)
            ? previousVersion.GetString() : attempt.Bundle!.BackendVersion;
        if (current.GetProperty("version").GetString() != expectedVersion)
            throw new InvalidDataException("Replacement service version does not match the attempted bundle");
        if (File.Exists(registration))
        {
            if (!File.ReadAllBytes(registration).SequenceEqual(bytes))
                throw new InvalidOperationException("Service registration changed after recovery");
            File.Delete(registration);
        }
        File.Delete(marker);
    }
}
