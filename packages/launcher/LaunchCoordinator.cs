using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Lingxi.Launcher;

public sealed class LaunchCoordinator(InstallationStore installation, BundleStore bundles)
{
    public async Task<string> Launch(CancellationToken cancellationToken)
    {
        using var ownership = installation.Lock("launch");
        var state = installation.Read();
        InstallationStore.VerifyProfile(state.Profile);
        using var profileOwnership = installation.LockProfile(state.Profile);
        if (state.Attempt?.ProcessId is { } pid && Alive(pid, state.Attempt.ProcessStartedAt))
            throw new IOException("The selected profile still has a running Desktop process");
        if (state.Blocked is not null) throw new InvalidOperationException(state.Blocked);
        if (state.Attempt is { Phase: "starting", ProcessId: null })
            throw Block("Previous startup process ownership is unknown; automatic recovery is blocked");

        var selected = state.Candidate ?? state.Current ?? throw new InvalidOperationException("No bundle is staged");
        var episode = state.Episode is { Phase: "primary" or "fallback" } active ? active :
            new RecoveryEpisode(Guid.NewGuid().ToString("N"), selected, state.Candidate is null ? state.Previous : state.Current, "new");
        var fallbackAttempt = episode.Phase == "primary";
        if (episode.Phase == "fallback") throw Block("The admitted fallback was interrupted; recovery budget is exhausted");
        selected = fallbackAttempt ? Fallback(episode) : episode.Primary;

        Process process;
        try { process = await Start(selected, episode, fallbackAttempt, state.Profile, cancellationToken); }
        catch (StartupFailure) when (!fallbackAttempt)
        {
            selected = Fallback(episode);
            try { process = await Start(selected, episode, true, state.Profile, cancellationToken); }
            catch (StartupFailure) { throw Block("Candidate and compatible fallback did not become ready"); }
        }
        catch (StartupFailure) { throw Block("The compatible fallback did not become ready"); }

        // This phase is outside startup recovery. A journal/cleanup failure after
        // accepted readiness can never authorize another Desktop launch.
        using (process)
        {
            await process.WaitForExitAsync(cancellationToken);
            installation.Change(value => value with { Attempt = null, Episode = value.Episode! with { Phase = process.ExitCode == 0 ? "closed" : "crashed" } });
            if (process.ExitCode != 0) throw new InvalidOperationException($"Desktop exited after acceptance with code {process.ExitCode}");
        }
        return selected.Sha256;
    }

    private InvalidOperationException Block(string message)
    {
        installation.Change(value => value with { Blocked = message });
        return new InvalidOperationException(message);
    }

    private Slot Fallback(RecoveryEpisode episode)
    {
        var candidate = episode.Primary;
        var fallback = episode.Fallback;
        if (fallback is null || fallback.Sha256 == candidate.Sha256
            || !fallback.StorageContract.Equals(candidate.StorageContract, StringComparison.OrdinalIgnoreCase)
            || fallback.BackendVersion != candidate.BackendVersion
            || !candidate.AllowedFallbacks.Contains(fallback.Sha256, StringComparer.OrdinalIgnoreCase))
            throw Block("Failed startup has no tested-compatible fallback");
        return fallback;
    }

    private async Task<Process> Start(Slot selected, RecoveryEpisode episode, bool fallback,
        ProfileSelection profile, CancellationToken cancellationToken)
    {
        Process? process = null;
        var accepted = false;
        Attempt? admitted = null;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(90));
        try
        {
            bundles.Verify(selected);
            InstallationStore.VerifyProfile(profile);
            var manifest = bundles.Manifest(selected.Sha256);
            var attempt = new Attempt(Guid.NewGuid().ToString("N"), selected.Sha256, "starting", DateTimeOffset.UtcNow, Bundle: selected);
            var pipeName = "lingxi-ready-" + Guid.NewGuid().ToString("N");
            using var pipe = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            // Budget admission and the attempted bundle belong to one atomic transition.
            installation.Change(value => value with
            {
                Attempt = attempt,
                Episode = episode with { Phase = fallback ? "fallback" : "primary" },
                Candidate = fallback && value.Candidate?.Sha256 == episode.Primary.Sha256 ? null : value.Candidate
            });
            admitted = attempt;
            var start = new ProcessStartInfo(Wire.Within(bundles.DirectoryFor(selected.Sha256), manifest.Entrypoint))
            { UseShellExecute = false, WorkingDirectory = bundles.DirectoryFor(selected.Sha256) };
            start.Environment["LINGXI_PROFILE_BINDING"] = profile.BindingPath;
            start.Environment["LINGXI_PROFILE_ID"] = profile.Id;
            start.Environment["LINGXI_PROFILE_DIGEST"] = profile.BindingSha256;
            start.Environment["LINGXI_LAUNCH_ATTEMPT"] = attempt.Id;
            start.Environment["LINGXI_BUNDLE_DIGEST"] = selected.Sha256;
            start.Environment["LINGXI_READINESS_PIPE"] = pipeName;
            process = Process.Start(start) ?? throw new IOException("Desktop did not start");
            installation.Change(value => value with { Attempt = attempt with { ProcessId = process.Id, ProcessStartedAt = process.StartTime.ToUniversalTime() } });
            var handshake = Readiness(pipe, process, deadline.Token);
            var exited = process.WaitForExitAsync(deadline.Token);
            if (await Task.WhenAny(handshake, exited) != handshake) throw new IOException("Desktop exited before readiness");
            var evidence = await handshake;
            if (evidence.Format != 1 || evidence.AttemptId != attempt.Id || evidence.BundleSha256 != selected.Sha256
                || evidence.ProfileId != profile.Id || evidence.BindingSha256 != profile.BindingSha256
                || evidence.ProcessId != process.Id || evidence.BackendVersion != selected.BackendVersion
                || !evidence.Storage || !evidence.Renderer || !evidence.Server || !evidence.SessionLink || process.HasExited)
                throw new InvalidDataException("Desktop readiness did not match the admitted launch attempt");
            InstallationStore.VerifyProfile(profile);
            installation.Change(value => value with
            {
                Previous = value.Current?.Sha256 == selected.Sha256 ? value.Previous : value.Current,
                Current = selected,
                Candidate = value.Candidate?.Sha256 == selected.Sha256 ? null : value.Candidate,
                Attempt = value.Attempt! with { Phase = "accepted" },
                Episode = value.Episode! with { Phase = "accepted" },
                Blocked = null
            });
            // Acceptance is irreversible for startup recovery. ACK failure is
            // delivery uncertainty, never permission to kill a possibly interactive Desktop.
            accepted = true;
            await using (var acknowledgement = new StreamWriter(pipe, new UTF8Encoding(false), 1024, true))
            {
                await acknowledgement.WriteLineAsync(JsonSerializer.Serialize(new { accepted = true, attemptId = attempt.Id, bundleSha256 = selected.Sha256 }).AsMemory(), deadline.Token);
                await acknowledgement.FlushAsync(deadline.Token);
            }
            installation.Change(value => value with { Attempt = value.Attempt! with { Phase = "ready" }, Episode = value.Episode! with { Phase = "ready" } });
            return process;
        }
        catch (Exception error)
        {
            if (accepted)
            {
                process?.Dispose();
                throw new InvalidOperationException("Startup acceptance was committed; handoff completion is uncertain", error);
            }
            if (process is not null)
            {
                // Retire only the exact Desktop we created; never its detached backend.
                // A failure to establish its exit escapes as an ownership failure, not permission to fallback.
                if (!process.HasExited) process.Kill(false);
                await process.WaitForExitAsync(CancellationToken.None);
            }
            if (admitted is not null)
                installation.Change(value => value.Attempt?.Id == admitted.Id
                    ? value with { Attempt = value.Attempt with { Phase = "failed" } } : value);
            if (error is OperationCanceledException && cancellationToken.IsCancellationRequested) throw;
            throw new StartupFailure(error);
        }
        finally
        {
            deadline.Cancel();
            if (!accepted) process?.Dispose();
        }
    }

    private static async Task<Readiness> Readiness(NamedPipeServerStream pipe, Process process, CancellationToken cancellationToken)
    {
        await pipe.WaitForConnectionAsync(cancellationToken);
        if (OperatingSystem.IsWindows() && (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var pid) || pid != process.Id))
            throw new InvalidDataException("Readiness connection belongs to another process");
        using var reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, true);
        var text = new StringBuilder();
        var buffer = new char[1024];
        while (text.Length <= 16_384)
        {
            var count = await reader.ReadAsync(buffer, cancellationToken);
            if (count == 0) break;
            text.Append(buffer, 0, count);
            if (text.ToString().Contains('\n')) break;
        }
        if (text.Length > 16_384) throw new InvalidDataException("Readiness message exceeds size limit");
        return JsonSerializer.Deserialize<Readiness>(text.ToString().Trim(), Wire.Json) ?? throw new InvalidDataException("Empty readiness message");
    }

    private static bool Alive(int pid, DateTimeOffset? startedAt)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return !process.HasExited && (startedAt is null || process.StartTime.ToUniversalTime() == startedAt.Value.UtcDateTime);
        }
        catch (ArgumentException) { return false; }
    }

    private sealed class StartupFailure(Exception cause) : Exception("Desktop startup failed", cause);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle pipe, out uint clientProcessId);
}
