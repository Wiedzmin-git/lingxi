using System.Text;
using System.Text.Json;
using Lingxi.Launcher;

var interactive = args.Length > 0 && args[0] == "stage-interactive";

try
{
    if (args.Length == 0) throw new ArgumentException("Usage: Lingxi.Launcher <status|initialize|initialize-new|channel|stage-local|stage|launch|credential> <installation-root> ...");
    if (args[0] == "credential")
    {
        if (args.Length != 1 || Console.IsInputRedirected) throw new ArgumentException("Credential entry requires an interactive console; never pass a token as an argument");
        Console.Write("GitHub read-only release token: ");
        var token = new StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(true);
            if (key.Key == ConsoleKey.Enter) break;
            if (key.Key == ConsoleKey.Backspace) { if (token.Length > 0) token.Length--; continue; }
            if (!char.IsControl(key.KeyChar) && token.Length < 2048) token.Append(key.KeyChar);
        }
        WindowsCredential.Write(token.ToString());
        token.Clear();
        Console.WriteLine("\nSaved in Windows Credential Manager.");
        return 0;
    }
    if (args.Length < 2) throw new ArgumentException("An explicit installation root is required");
    var installation = new InstallationStore(args[1]);
    var bundles = new BundleStore(installation.Root);
    switch (args[0])
    {
        case "desktop-restart" when args.Length == 4:
            try
            {
                await DesktopRestart.Run(installation, bundles, new DesktopUpdateContext(
                    Environment.GetEnvironmentVariable("LINGXI_PROFILE_ID") ?? "",
                    Environment.GetEnvironmentVariable("LINGXI_PROFILE_DIGEST") ?? "",
                    Environment.GetEnvironmentVariable("LINGXI_LAUNCH_ATTEMPT") ?? "",
                    Environment.GetEnvironmentVariable("LINGXI_BUNDLE_DIGEST") ?? ""), args[2], args[3], () =>
                    {
                        Console.WriteLine("ready");
                        Console.Out.Flush();
                        Console.SetOut(TextWriter.Null);
                    }, CancellationToken.None);
            }
            catch
            {
                Wire.AtomicWrite(Path.Combine(installation.Root, "restart-result.json"), new { status = "failed", at = DateTimeOffset.UtcNow });
                throw;
            }
            break;
        case "desktop-check" when args.Length == 2:
        case "desktop-stage" when args.Length == 4:
            using (var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(args[0] == "desktop-check" ? 1 : 15)))
            using (var handler = new HttpClientHandler { AllowAutoRedirect = false })
            using (var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan })
            {
                var context = new DesktopUpdateContext(
                    Environment.GetEnvironmentVariable("LINGXI_PROFILE_ID") ?? "",
                    Environment.GetEnvironmentVariable("LINGXI_PROFILE_DIGEST") ?? "",
                    Environment.GetEnvironmentVariable("LINGXI_LAUNCH_ATTEMPT") ?? "",
                    Environment.GetEnvironmentVariable("LINGXI_BUNDLE_DIGEST") ?? "");
                var updates = new DesktopUpdates(installation, bundles, context);
                var bound = updates.Bound();
                SupervisorBootstrap.Prepare(installation, bundles, bound);
                if (!SupervisorBootstrap.Current(installation, bound))
                {
                    Console.WriteLine(JsonSerializer.Serialize(new DesktopUpdateOffer("staged", bound.Channel,
                        bound.Current!.ReleaseId, bound.Current.Sha256), Wire.Json));
                    break;
                }
                var feed = new PrivateDistribution(client, "lingxi-runtime-");
                var result = args[0] == "desktop-check"
                    ? await updates.Check(feed, WindowsCredential.Read, deadline.Token)
                    : await updates.Stage(feed, WindowsCredential.Read, args[2], args[3], deadline.Token, Progress(true));
                Console.WriteLine(JsonSerializer.Serialize(result, Wire.Json));
            }
            break;
        case "initialize-new" when args.Length == 4:
            FreshProfile.Create(installation, args[2], args[3]);
            break;
        case "initialize" when args.Length == 5:
            installation.Initialize(args[2], args[3], args[4]);
            break;
        case "status" when args.Length == 2:
            Console.WriteLine(JsonSerializer.Serialize(installation.Read(), Wire.Json));
            break;
        case "channel" when args.Length == 3:
            installation.SelectChannel(args[2]);
            break;
        case "stage-local" when args.Length == 5:
            using (installation.Lock("stage"))
                installation.SelectCandidate(bundles.Stage(args[2], args[3], long.Parse(args[4])));
            break;
        case "stage" when args.Length == 2:
        case "stage-interactive" when args.Length == 2:
            // A retained shortcut may enter through an older accepted bundle.
            // Delegate before taking the stage lock so the current helper owns it.
            if (installation.Read().Current is { } accepted)
            {
                bundles.Verify(accepted);
                var helper = Path.Combine(bundles.DirectoryFor(accepted.Sha256), "resources", "lingxi-updater", "Lingxi.Launcher.exe");
                if (Wire.Hash(helper) != Wire.Hash(Environment.ProcessPath!))
                {
                    var start = new System.Diagnostics.ProcessStartInfo(helper) { UseShellExecute = false };
                    foreach (var argument in args) start.ArgumentList.Add(argument);
                    using var delegated = System.Diagnostics.Process.Start(start) ?? throw new IOException("Current update helper did not start");
                    await delegated.WaitForExitAsync();
                    return delegated.ExitCode;
                }
            }
            using (installation.Lock("stage"))
            using (var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(15)))
            using (var handler = new HttpClientHandler { AllowAutoRedirect = false })
            using (var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan })
            {
                Console.WriteLine("Lingxi: checking the selected update channel...");
                var feed = new PrivateDistribution(client, "lingxi-runtime-");
                var credential = WindowsCredential.Read();
                var state = installation.Read();
                if (state.Current is not null) SupervisorBootstrap.Prepare(installation, bundles, state);
                Console.WriteLine("Channel: " + state.Channel + ". Connecting to GitHub...");
                var manifest = await feed.Channel(state.Channel, credential, deadline.Token);
                if (state.Current?.Sha256 == manifest.ArchiveSha256 || state.Candidate?.Sha256 == manifest.ArchiveSha256)
                {
                    Console.WriteLine(state.Current?.Sha256 == manifest.ArchiveSha256
                        ? "Already up to date. No download needed."
                        : "Update already downloaded. Close and open Lingxi when convenient.");
                    break;
                }
                Console.WriteLine("Release: " + manifest.ReleaseId);
                Console.WriteLine("Downloading " + (manifest.ArchiveBytes / 1048576.0).ToString("F1") + " MB. Keep this window open.");
                var archive = Path.Combine(installation.Root, "downloads", Guid.NewGuid().ToString("N") + ".zip");
                try
                {
                    await feed.Download(manifest, archive, credential, deadline.Token, Progress(false));
                    Console.WriteLine("\nDownload complete. Verifying and unpacking files...");
                    var candidate = bundles.Stage(archive, manifest.ArchiveSha256, manifest.ArchiveBytes);
                    if (candidate.ReleaseId != manifest.ReleaseId) throw new InvalidDataException("Channel and bundle release identities differ");
                    if (state.Current is { } current && !BackendTransition.Compatible(current, candidate, bundles))
                        throw new InvalidOperationException("This update requires a separate compatibility transition");
                    installation.SelectCandidate(candidate);
                    Console.WriteLine("READY. Update downloaded and verified. Close and open Lingxi when convenient to apply it.");
                }
                finally { if (File.Exists(archive)) File.Delete(archive); }
            }
            break;
        case "launch" when args.Length == 2:
            Console.WriteLine(await new LaunchCoordinator(installation, bundles).Launch(CancellationToken.None));
            break;
        default: throw new ArgumentException("Unknown command or argument count");
    }
    Pause();
    return 0;
}
catch (Exception error)
{
    // URLs, response bodies, environment and credential values are deliberately absent.
    Console.Error.WriteLine(error is HttpRequestException http ? $"Private release request failed ({(int?)http.StatusCode})" : error.Message);
    if (interactive) Console.Error.WriteLine("Update was not confirmed. Your current Desktop continues. Check your connection and saved release key, then try again.");
    Pause();
    return 1;
}

void Pause()
{
    if (!interactive || Console.IsInputRedirected) return;
    Console.WriteLine("Press Enter to close this window.");
    Console.ReadLine();
}

Action<long, long> Progress(bool wire)
{
    var clock = System.Diagnostics.Stopwatch.StartNew();
    var last = -1.0;
    return (received, total) =>
    {
        var seconds = clock.Elapsed.TotalSeconds;
        if (received != total && last >= 0 && seconds - last < 1) return;
        last = seconds;
        var percent = (int)(100 * received / total);
        if (wire)
        {
            var bytesPerSecond = seconds >= 1 ? received / seconds : 0;
            double? remainingSeconds = seconds >= 3 && bytesPerSecond > 0
                ? Math.Ceiling((total - received) / bytesPerSecond)
                : null;
            Console.Error.WriteLine(JsonSerializer.Serialize(new { percent, received, total, bytesPerSecond, remainingSeconds }, new JsonSerializerOptions(Wire.Json) { WriteIndented = false }));
            return;
        }
        Console.Write($"\r{percent,3}%  {received / 1048576.0:F1}/{total / 1048576.0:F1} MB  {received / Math.Max(seconds, 0.001) / 1048576.0:F1} MB/s    ");
    };
}
