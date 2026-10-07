namespace Lingxi.Launcher;

public sealed record DesktopUpdateContext(string ProfileId, string BindingSha256, string AttemptId, string BundleSha256);
public sealed record DesktopUpdateOffer(string Status, string Channel, string? Version = null, string? Sha256 = null);

// The bundled helper uses the launcher's existing admission machinery. It never
// activates a bundle, replaces the installed launcher or touches the backend.
public sealed class DesktopUpdates(InstallationStore installation, BundleStore bundles, DesktopUpdateContext context)
{
    public Installation Bound()
    {
        var state = installation.Read();
        InstallationStore.VerifyProfile(state.Profile);
        if (state.Profile.Id != context.ProfileId || state.Profile.BindingSha256 != context.BindingSha256
            || state.Attempt?.Id != context.AttemptId || state.Attempt.Sha256 != context.BundleSha256
            || state.Attempt.Phase != "ready" || state.Current?.Sha256 != context.BundleSha256)
            throw new InvalidOperationException("Update request does not match the active Desktop");
        return state;
    }

    public async Task<DesktopUpdateOffer> Check(PrivateDistribution feed, Func<string> credential, CancellationToken cancellationToken)
    {
        var state = Bound();
        if (state.Candidate is { } staged && staged.Sha256 != context.BundleSha256)
        {
            Compatible(state, staged);
            return new("staged", state.Channel, staged.ReleaseId, staged.Sha256);
        }
        var manifest = await feed.Channel(state.Channel, credential(), cancellationToken);
        var current = Bound();
        if (current.Channel != state.Channel) throw new InvalidOperationException("Update channel changed; check again");
        if (current.Candidate is { } candidate && candidate.Sha256 != context.BundleSha256)
        {
            Compatible(current, candidate);
            return new("staged", current.Channel, candidate.ReleaseId, candidate.Sha256);
        }
        return manifest.ArchiveSha256 == context.BundleSha256
            ? new("up-to-date", state.Channel)
            : new("available", state.Channel, manifest.ReleaseId, manifest.ArchiveSha256);
    }

    public async Task<DesktopUpdateOffer> Stage(PrivateDistribution feed, Func<string> credential, string expectedDigest,
        string expectedChannel, CancellationToken cancellationToken, Action<long, long>? progress = null)
    {
        if (!Wire.Digest(expectedDigest)) throw new InvalidDataException("Invalid update selection");
        using var ownership = installation.Lock("stage");
        var state = Bound();
        if (state.Channel != expectedChannel) throw new InvalidOperationException("Update channel changed; check again");
        if (state.Candidate is { } candidate)
        {
            Compatible(state, candidate);
            if (candidate.Sha256 == expectedDigest) return new("staged", state.Channel, candidate.ReleaseId, candidate.Sha256);
            throw new InvalidOperationException("Another update is already staged; check again");
        }
        var key = credential();
        var manifest = await feed.Channel(state.Channel, key, cancellationToken);
        if (manifest.ArchiveSha256 != expectedDigest) throw new InvalidOperationException("Published update changed; check again");
        var archive = Path.Combine(installation.Root, "downloads", Guid.NewGuid().ToString("N") + ".zip");
        try
        {
            await feed.Download(manifest, archive, key, cancellationToken, progress);
            var slot = bundles.Stage(archive, manifest.ArchiveSha256, manifest.ArchiveBytes);
            var current = Bound();
            if (slot.ReleaseId != manifest.ReleaseId) throw new InvalidDataException("Channel and bundle release identities differ");
            Compatible(current, slot);
            installation.SelectCandidate(slot);
            return new("staged", current.Channel, slot.ReleaseId, slot.Sha256);
        }
        finally { if (File.Exists(archive)) File.Delete(archive); }
    }

    private void Compatible(Installation state, Slot candidate)
    {
        if (!BackendTransition.Compatible(state.Current!, candidate, bundles))
            throw new InvalidOperationException("This update requires a separate compatibility transition");
    }
}
