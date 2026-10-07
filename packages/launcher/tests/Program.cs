using System.IO.Compression;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text.Json;
using Lingxi.Launcher;

if (Environment.GetEnvironmentVariable("LINGXI_LAUNCH_ATTEMPT") is not null)
{
    var mode = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixture-mode.txt"));
    if (mode == "exit") return 23;
    var binding = Environment.GetEnvironmentVariable("LINGXI_PROFILE_BINDING")!;
    File.AppendAllText(binding + ".history", mode + "\n");
    using var pipe = new NamedPipeClientStream(".", Environment.GetEnvironmentVariable("LINGXI_READINESS_PIPE")!, PipeDirection.InOut, PipeOptions.Asynchronous);
    await pipe.ConnectAsync(10_000);
    var message = new Readiness(1, Environment.GetEnvironmentVariable("LINGXI_LAUNCH_ATTEMPT")!,
        Environment.GetEnvironmentVariable("LINGXI_BUNDLE_DIGEST")!,
        mode == "wrong-profile" ? Guid.NewGuid().ToString() : Environment.GetEnvironmentVariable("LINGXI_PROFILE_ID")!,
        Environment.GetEnvironmentVariable("LINGXI_PROFILE_DIGEST")!, Environment.ProcessId, "fixture-backend-v1",
        true, mode != "unready", true, true);
    await using var writer = new StreamWriter(pipe, new System.Text.UTF8Encoding(false), 1024, true);
    await writer.WriteLineAsync(JsonSerializer.Serialize(message, new JsonSerializerOptions(Wire.Json) { WriteIndented = false }));
    await writer.FlushAsync();
    using var acknowledgement = new StreamReader(pipe, System.Text.Encoding.UTF8, false, 1024, true);
    if (mode.StartsWith("ready", StringComparison.Ordinal))
    {
        var line = await acknowledgement.ReadLineAsync();
        if (line is null || !JsonDocument.Parse(line).RootElement.GetProperty("accepted").GetBoolean()) return 24;
    }
    await Task.Delay(400);
    return mode == "ready-crash" ? 31 : 0;
}

var root = Path.Combine(Path.GetTempPath(), "opencode", "lingxi-launcher-contract-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var passed = new List<string>();
try
{
    await Test("bundle admission hashes every inventoried file and rejects modified manifests", () =>
    {
        var (store, _, _) = Installation("bundle");
        var bundles = new BundleStore(store.Root);
        var archive = Package("ready", []);
        var slot = bundles.Stage(archive, Wire.Hash(archive), new FileInfo(archive).Length);
        Check(bundles.Verify(slot).Sha256 == slot.Sha256, "admitted digest");
        File.AppendAllText(Path.Combine(bundles.DirectoryFor(slot.Sha256), "fixture-mode.txt"), "modified");
        Throws(() => bundles.Verify(slot));
        File.WriteAllText(Path.Combine(bundles.DirectoryFor(slot.Sha256), "fixture-mode.txt"), "ready");
        var changed = bundles.Manifest(slot.Sha256) with { ReleaseId = "changed-after-admission" };
        File.WriteAllText(Path.Combine(bundles.DirectoryFor(slot.Sha256), "bundle.json"), JsonSerializer.Serialize(changed, Wire.Json));
        Throws(() => bundles.Verify(slot));
        return Task.CompletedTask;
    });
    await Test("traversal and wrong archive digest never become candidates", () =>
    {
        var (store, _, _) = Installation("traversal");
        var bundles = new BundleStore(store.Root);
        var archive = Path.Combine(root, Guid.NewGuid() + ".zip");
        using (var zip = ZipFile.Open(archive, ZipArchiveMode.Create))
        using (var writer = new StreamWriter(zip.CreateEntry("../escaped.txt").Open())) writer.Write("escape");
        Throws(() => bundles.Stage(archive, Wire.Hash(archive), new FileInfo(archive).Length));
        Check(!File.Exists(Path.Combine(store.Root, "escaped.txt")), "no traversal output");
        Throws(() => bundles.Stage(archive, new string('0', 64), new FileInfo(archive).Length));
        Check(store.Read().Candidate is null, "candidate unchanged");
        return Task.CompletedTask;
    });
    await Test("real readiness commits exact profile and bundle; launcher retains profile lock", async () =>
    {
        var (store, binding, _) = Installation("readiness");
        var bundles = new BundleStore(store.Root);
        var archive = Package("ready", []);
        var slot = bundles.Stage(archive, Wire.Hash(archive), new FileInfo(archive).Length);
        store.SelectCandidate(slot);
        var launch = new LaunchCoordinator(store, bundles).Launch(CancellationToken.None);
        Throws(() => store.Lock("launch"));
        Check(await launch == slot.Sha256, "returned admitted digest");
        Check(store.Read().Current?.Sha256 == slot.Sha256 && store.Read().Candidate is null && store.Read().Attempt is null, "promotion committed");
        Check(File.ReadAllText(binding + ".history") == "ready\n", "fixture wrote only selected profile");
    });
    await Test("failed candidate falls back once and preserves newly written profile history", async () =>
    {
        var (store, binding, _) = Installation("fallback");
        var bundles = new BundleStore(store.Root);
        var goodArchive = Package("ready", []);
        var good = bundles.Stage(goodArchive, Wire.Hash(goodArchive), new FileInfo(goodArchive).Length);
        store.SelectCandidate(good);
        await new LaunchCoordinator(store, bundles).Launch(CancellationToken.None);
        var badArchive = Package("wrong-profile", [good.Sha256], storage: new string('A', 64));
        var bad = bundles.Stage(badArchive, Wire.Hash(badArchive), new FileInfo(badArchive).Length);
        store.SelectCandidate(bad);
        Check(await new LaunchCoordinator(store, bundles).Launch(CancellationToken.None) == good.Sha256, "fallback selected");
        Check(store.Read().Candidate is null && store.Read().Current?.Sha256 == good.Sha256, "bad candidate consumed");
        Check(File.ReadAllText(binding + ".history") == "ready\nwrong-profile\nready\n", "new history was not restored from snapshot");
    });
    await Test("unapproved fallback blocks subsequent launches without cycling", async () =>
    {
        var (store, _, _) = Installation("blocked");
        var bundles = new BundleStore(store.Root);
        var archive = Package("unready", []);
        store.SelectCandidate(bundles.Stage(archive, Wire.Hash(archive), new FileInfo(archive).Length));
        await Reject(() => new LaunchCoordinator(store, bundles).Launch(CancellationToken.None));
        var attempt = store.Read().Attempt;
        await Reject(() => new LaunchCoordinator(store, bundles).Launch(CancellationToken.None));
        Check(store.Read().Attempt == attempt && store.Read().Blocked is not null, "no repeated attempt");
    });
    await Test("changed profile descriptor cannot silently select other storage", async () =>
    {
        var (store, binding, _) = Installation("changed-binding");
        File.AppendAllText(binding, " ");
        await Reject(() => new LaunchCoordinator(store, new BundleStore(store.Root)).Launch(CancellationToken.None));
        Check(store.Read().Attempt is null, "no attempt admitted");
    });
    await Test("two installation roots cannot independently claim the same bound Desktop profile", () =>
    {
        var (store, binding, id) = Installation("cross-installation");
        var other = new InstallationStore(Path.Combine(root, "foreign-installation"));
        Throws(() => other.Initialize(binding, id, "stable"));
        using var owned = store.LockProfile(store.Read().Profile);
        Throws(() => other.LockProfile(store.Read().Profile));
        return Task.CompletedTask;
    });
    await Test("crash-shaped journal states cannot reset the durable fallback budget", async () =>
    {
        foreach (var phase in new[] { "unknown-pid", "primary", "fallback" })
        {
            var (store, binding, _) = Installation("episode-" + phase);
            var bundles = new BundleStore(store.Root);
            var goodArchive = Package("ready", []);
            var good = bundles.Stage(goodArchive, Wire.Hash(goodArchive), new FileInfo(goodArchive).Length);
            var badArchive = Package("exit", [good.Sha256]);
            var bad = bundles.Stage(badArchive, Wire.Hash(badArchive), new FileInfo(badArchive).Length);
            store.Change(value => value with
            {
                Current = good, Candidate = bad,
                Episode = new RecoveryEpisode("fixture-episode", bad, good, phase == "fallback" ? "fallback" : "primary"),
                Attempt = new Attempt("fixture-attempt", bad.Sha256, "starting", DateTimeOffset.UtcNow,
                    phase == "unknown-pid" ? null : int.MaxValue, Bundle: bad)
            });
            if (phase == "primary")
            {
                Check(await new LaunchCoordinator(store, bundles).Launch(CancellationToken.None) == good.Sha256, "resume admitted fallback");
                Check(File.ReadAllText(binding + ".history") == "ready\n", "one fallback invocation");
                continue;
            }
            await Reject(() => new LaunchCoordinator(store, bundles).Launch(CancellationToken.None));
            Check(store.Read().Blocked is not null && !File.Exists(binding + ".history"), "uncertain/exhausted startup never launches");
        }
    });
    await Test("post-readiness journal failure cannot start fallback", async () =>
    {
        var (store, binding, _) = Installation("cleanup-failure");
        var bundles = new BundleStore(store.Root);
        var archive = Package("ready", []);
        var slot = bundles.Stage(archive, Wire.Hash(archive), new FileInfo(archive).Length);
        store.SelectCandidate(slot);
        var launch = new LaunchCoordinator(store, bundles).Launch(CancellationToken.None);
        await Until(() => store.Read().Episode?.Phase == "ready");
        using (store.Lock("state")) await Reject(async () => await launch);
        Check(store.Read().Current?.Sha256 == slot.Sha256 && store.Read().Blocked is null, "accepted release retained");
        Check(File.ReadAllText(binding + ".history") == "ready\n", "no cleanup-triggered restart");
    });
    await Test("confirmed process creation failure does not permanently poison a corrected candidate", async () =>
    {
        var (store, _, _) = Installation("creation-failure");
        var bundles = new BundleStore(store.Root);
        var invalid = Package("ready", [], invalidExecutable: true);
        store.SelectCandidate(bundles.Stage(invalid, Wire.Hash(invalid), new FileInfo(invalid).Length));
        await Reject(() => new LaunchCoordinator(store, bundles).Launch(CancellationToken.None));
        Check(store.Read().Attempt is { Phase: "failed", ProcessId: null }, "known absence is persisted");
        var corrected = Package("ready", []);
        var slot = bundles.Stage(corrected, Wire.Hash(corrected), new FileInfo(corrected).Length);
        store.SelectCandidate(slot);
        Check(await new LaunchCoordinator(store, bundles).Launch(CancellationToken.None) == slot.Sha256, "corrected candidate starts");
    });
    await Test("nonzero exit after readiness is surfaced without startup fallback", async () =>
    {
        var (store, binding, _) = Installation("accepted-crash");
        var bundles = new BundleStore(store.Root);
        var archive = Package("ready-crash", []);
        var slot = bundles.Stage(archive, Wire.Hash(archive), new FileInfo(archive).Length);
        store.SelectCandidate(slot);
        await Reject(() => new LaunchCoordinator(store, bundles).Launch(CancellationToken.None));
        Check(store.Read().Current?.Sha256 == slot.Sha256 && store.Read().Episode?.Phase == "crashed", "accepted crash is distinct from startup failure");
        Check(File.ReadAllText(binding + ".history") == "ready-crash\n", "no automatic restart");
    });
    await Test("private asset redirect never forwards repository credential; interrupted bytes are removed", async () =>
    {
        await using var server = new DownloadFixture();
        using var client = server.Client();
        var feed = new PrivateDistribution(client);
        var bytes = "immutable release bytes"u8.ToArray();
        var manifest = new ChannelManifest(1, "dev", "fixture", 17, bytes.Length, Convert.ToHexStringLower(SHA256.HashData(bytes)));
        var destination = Path.Combine(root, "download.zip");
        await feed.Download(manifest, destination, "synthetic-fixture-credential", CancellationToken.None);
        Check(File.ReadAllBytes(destination).SequenceEqual(bytes), "download content");
        Check(server.Requests.Any(request => request.Contains("Authorization: Bearer synthetic-fixture-credential", StringComparison.OrdinalIgnoreCase)), "API used credential");
        Check(server.Requests.Where(request => request.Contains("GET /signed", StringComparison.Ordinal)).All(request => !request.Contains("Authorization:", StringComparison.OrdinalIgnoreCase)), "asset got no credential");
        File.Delete(destination);
        await Reject(() => feed.Download(manifest with { ArchiveAssetId = 18 }, destination, "synthetic-fixture-credential", CancellationToken.None));
        Check(!File.Exists(destination), "partial download removed");
        await Reject(() => feed.Download(manifest with { ArchiveAssetId = 19 }, destination, "synthetic-fixture-credential", CancellationToken.None));
        Check(!File.Exists(destination), "revoked credential creates no artifact");
        File.WriteAllText(destination, "preexisting-owner-file");
        await Reject(() => feed.Download(manifest with { ArchiveAssetId = 19 }, destination, "synthetic-fixture-credential", CancellationToken.None));
        Check(File.ReadAllText(destination) == "preexisting-owner-file", "HTTP failure preserves an unowned file");
        await Reject(() => feed.Download(manifest, destination, "synthetic-fixture-credential", CancellationToken.None));
        Check(File.ReadAllText(destination) == "preexisting-owner-file", "CreateNew failure preserves an unowned file");
    });
    Console.WriteLine(JsonSerializer.Serialize(new { passed = passed.Count, tests = passed, root }, Wire.Json));
    return 0;
}
finally { Directory.Delete(root, true); }

async Task Test(string name, Func<Task> action)
{
    await action();
    passed.Add(name);
    Console.WriteLine("PASS " + name);
}

(InstallationStore Store, string Binding, string Id) Installation(string name)
{
    var directory = Path.Combine(root, name);
    Directory.CreateDirectory(directory);
    var binding = Path.Combine(directory, "binding.json");
    var id = Guid.NewGuid().ToString();
    File.WriteAllText(binding, JsonSerializer.Serialize(new { format = 1, id, desktopUserData = Path.Combine(directory, "desktop") }));
    var store = new InstallationStore(Path.Combine(directory, "launcher"));
    store.Initialize(binding, id, "dev");
    return (store, binding, id);
}

string Package(string mode, string[] fallbacks, bool invalidExecutable = false, string? storage = null)
{
    var content = Path.Combine(root, "bundle-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(content);
    foreach (var file in Directory.GetFiles(AppContext.BaseDirectory))
    {
        if (Path.GetExtension(file) is ".exe" or ".dll" or ".json") File.Copy(file, Path.Combine(content, Path.GetFileName(file)));
    }
    File.WriteAllText(Path.Combine(content, "fixture-mode.txt"), mode);
    if (invalidExecutable) File.WriteAllText(Path.Combine(content, "broken.exe"), "not an executable");
    var manifest = new BundleManifest(1, "fixture-" + Guid.NewGuid().ToString("N"), invalidExecutable ? "broken.exe" : "Lingxi.Launcher.Tests.exe",
        storage ?? new string('a', 64), "fixture-backend-v1", fallbacks,
        Directory.GetFiles(content).Select(file => new BundleFile(Path.GetFileName(file), new FileInfo(file).Length, Wire.Hash(file))).ToArray());
    File.WriteAllText(Path.Combine(content, "bundle.json"), JsonSerializer.Serialize(manifest, Wire.Json));
    var archive = content + ".zip";
    ZipFile.CreateFromDirectory(content, archive);
    return archive;
}

void Check(bool value, string contract) { if (!value) throw new Exception("FAILED: " + contract); }
void Throws(Action action)
{
    try { action(); }
    catch (Exception error) when (error is IOException or InvalidDataException or InvalidOperationException or ArgumentException) { return; }
    throw new Exception("Expected rejected operation");
}
async Task Reject(Func<Task> action)
{
    try { await action(); }
    catch (Exception error) when (error is IOException or InvalidDataException or InvalidOperationException or HttpRequestException or OperationCanceledException) { return; }
    throw new Exception("Expected rejected operation");
}
async Task Until(Func<bool> condition)
{
    var deadline = DateTime.UtcNow.AddSeconds(5);
    while (!condition())
    {
        if (DateTime.UtcNow >= deadline) throw new TimeoutException("Fixture observation timed out");
        await Task.Delay(5);
    }
}
