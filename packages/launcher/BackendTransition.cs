using System.Diagnostics;
using System.Text.Json;

namespace Lingxi.Launcher;

public sealed record BackendTransitionPlan(int Format, string AttemptId, string BundleSha256,
    string ProfileDigest, string PreviousVersion, string PreviousBackendSha256, string BackendVersion,
    string? RegistrationSha256, bool PreviousRunning);
public sealed record BackendTransitionContract(int Format, string BackendVersion, string[] From);

public static class BackendTransition
{
    public static string CacheVersion(string version) => System.Text.RegularExpressions.Regex.Replace(version, "[^a-zA-Z0-9._-]", "-");

    public static bool Compatible(Slot previous, Slot candidate, BundleStore bundles)
    {
        if (!previous.StorageContract.Equals(candidate.StorageContract, StringComparison.OrdinalIgnoreCase)) return false;
        if (previous.BackendVersion == candidate.BackendVersion) return true;
        if (!candidate.AllowedFallbacks.Contains(previous.Sha256, StringComparer.OrdinalIgnoreCase)) return false;
        const string relative = "resources/lingxi-updater/backend-transition.json";
        var manifestPath = Path.Combine(bundles.DirectoryFor(candidate.Sha256), "bundle.json");
        if (Wire.Hash(manifestPath) != candidate.ManifestSha256) throw new InvalidDataException("Transition manifest changed after admission");
        var inventory = bundles.Manifest(candidate.Sha256).Files.SingleOrDefault(file => file.Path == relative);
        if (inventory is null) return false;
        var file = Wire.Within(bundles.DirectoryFor(candidate.Sha256), relative);
        if (Wire.Hash(file) != inventory.Sha256) throw new InvalidDataException("Backend transition evidence changed after admission");
        var contract = Wire.Read<BackendTransitionContract>(file);
        return contract.Format == 1 && contract.BackendVersion == candidate.BackendVersion
            && contract.From.Contains(previous.Sha256, StringComparer.OrdinalIgnoreCase);
    }

    public static string? Prepare(InstallationStore installation, BundleStore bundles,
        ProfileSelection profile, Attempt attempt, Slot? previous, Slot? reverseFrom = null)
    {
        var selected = attempt.Bundle!;
        if (previous is null || previous.BackendVersion == selected.BackendVersion) return null;
        if (!Compatible(previous, selected, bundles)
            && !(reverseFrom?.Sha256 == previous.Sha256 && Compatible(selected, reverseFrom, bundles)))
            throw new InvalidDataException("Backend transition has no tested return path");
        bundles.Verify(previous);
        using var descriptor = JsonDocument.Parse(File.ReadAllBytes(profile.BindingPath));
        var registration = descriptor.RootElement.GetProperty("serviceRegistration").GetString()!;
        var expected = Path.Combine(descriptor.RootElement.GetProperty("desktopUserData").GetString()!,
            "cli", CacheVersion(previous.BackendVersion), "opencode-cli.exe");
        var backend = bundles.Manifest(previous.Sha256).Files.Single(file => file.Path == "resources/opencode-cli.exe");
        string? registrationSha256 = null;
        var previousRunning = false;
        if (File.Exists(registration))
        {
            registrationSha256 = Wire.Hash(registration);
            using var document = JsonDocument.Parse(File.ReadAllBytes(registration));
            var info = document.RootElement;
            if (info.GetProperty("version").GetString() != previous.BackendVersion)
                throw new InvalidOperationException("The registered backend is not the selected previous release");
            Process? process = null;
            try { process = Process.GetProcessById(info.GetProperty("pid").GetInt32()); }
            catch (ArgumentException) { }
            using (process)
            {
                previousRunning = process is not null && !process.HasExited;
                if (previousRunning) VerifyCache(profile, previous, bundles);
                if (previousRunning && !Path.GetFullPath(process!.MainModule!.FileName).Equals(Path.GetFullPath(expected), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("The registered process is not this installation's previous backend");
            }
            if (Wire.Hash(registration) != registrationSha256) throw new IOException("Backend registration changed during admission");
        }
        var file = Path.Combine(installation.Root, "backend-transition-" + attempt.Id + ".json");
        Wire.AtomicWrite(file, new BackendTransitionPlan(1, attempt.Id, selected.Sha256, profile.BindingSha256,
            previous.BackendVersion, backend.Sha256, selected.BackendVersion, registrationSha256, previousRunning));
        return file;
    }

    public static void VerifyCache(ProfileSelection profile, Slot selected, BundleStore bundles)
    {
        using var descriptor = JsonDocument.Parse(File.ReadAllBytes(profile.BindingPath));
        var cached = Path.Combine(descriptor.RootElement.GetProperty("desktopUserData").GetString()!,
            "cli", CacheVersion(selected.BackendVersion), "opencode-cli.exe");
        if (!File.Exists(cached)) return;
        var backend = bundles.Manifest(selected.Sha256).Files.Single(file => file.Path == "resources/opencode-cli.exe");
        if (!Wire.Hash(cached).Equals(backend.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Cached backend bytes differ from the selected immutable bundle");
    }
}
