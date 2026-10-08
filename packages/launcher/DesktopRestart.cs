using System.Diagnostics;

namespace Lingxi.Launcher;

// A restart is requested by the running Desktop, then waits for its exact
// generation and supervisor to leave. It never kills either process.
public static class DesktopRestart
{
    public static async Task Run(InstallationStore installation, BundleStore bundles, DesktopUpdateContext context,
        string digest, string channel, Action ready, CancellationToken cancellationToken)
    {
        using var restart = installation.Lock("restart");
        var bound = new DesktopUpdates(installation, bundles, context).Bound();
        if (bound.Candidate is not { } candidate || candidate.Sha256 != digest || bound.Channel != channel)
            throw new InvalidOperationException("The staged update selection changed");
        bundles.Verify(candidate);
        if (!BackendTransition.Compatible(bound.Current!, candidate, bundles))
            throw new InvalidOperationException("The staged update has no compatible return path");
        var attempt = bound.Attempt!;
        using var desktop = Process.GetProcessById(attempt.ProcessId ?? throw new InvalidOperationException("Desktop owner missing"));
        if (attempt.ProcessStartedAt is null || desktop.HasExited || desktop.StartTime.ToUniversalTime() != attempt.ProcessStartedAt.Value.UtcDateTime)
            throw new InvalidOperationException("Desktop generation changed");
        using var supervisor = SupervisorBootstrap.Open(installation, bound)
            ?? throw new InvalidOperationException("The running supervisor cannot hand off a restart");
        ready();
        using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
        {
            deadline.CancelAfter(TimeSpan.FromMinutes(2));
            await desktop.WaitForExitAsync(deadline.Token);
            await supervisor.WaitForExitAsync(deadline.Token);
        }
        var current = installation.Read();
        if (current.Profile != bound.Profile || current.Channel != channel || current.Candidate?.Sha256 != digest
            || current.Current?.Sha256 != context.BundleSha256 || current.Attempt is not null)
            throw new InvalidOperationException("Installation changed during restart handoff");
        // No Desktop is alive now and Bound rejects another restart request.
        // The new supervisor must not retain this handoff lock for its lifetime.
        restart.Dispose();
        await new LaunchCoordinator(installation, bundles).Launch(cancellationToken, digest, true);
    }
}
