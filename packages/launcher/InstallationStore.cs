using System.Text.Json;

namespace Lingxi.Launcher;

public sealed class InstallationStore
{
    public string Root { get; }
    private string StatePath => Path.Combine(Root, "installation.json");

    public InstallationStore(string root)
    {
        if (!Path.IsPathFullyQualified(root)) throw new ArgumentException("Installation root must be fully qualified");
        Root = Path.GetFullPath(root);
    }

    public FileStream Lock(string name)
    {
        Directory.CreateDirectory(Root);
        return new FileStream(Path.Combine(Root, name + ".lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    }

    public Installation Read()
    {
        var value = Wire.Read<Installation>(StatePath);
        if (value.Format != 1 || value.Channel is not ("dev" or "stable") || !Guid.TryParse(value.Profile.Id, out _)
            || !Path.IsPathFullyQualified(value.Profile.BindingPath) || !Path.IsPathFullyQualified(value.Profile.OwnershipDirectory)
            || !Wire.Digest(value.Profile.BindingSha256))
            throw new InvalidDataException("Invalid installation state");
        return value;
    }

    public Installation Change(Func<Installation, Installation> update)
    {
        using var ownership = Lock("state");
        var value = update(Read());
        Wire.AtomicWrite(StatePath, value);
        return value;
    }

    public Installation Initialize(string bindingPath, string profileId, string channel)
    {
        using var ownership = Lock("state");
        if (File.Exists(StatePath) || File.Exists(StatePath + ".previous")) throw new IOException("Installation already initialized");
        if (!Path.IsPathFullyQualified(bindingPath) || !Guid.TryParse(profileId, out _) || channel is not ("dev" or "stable"))
            throw new InvalidDataException("Invalid profile selection");
        using var descriptor = JsonDocument.Parse(File.ReadAllBytes(bindingPath));
        if (descriptor.RootElement.GetProperty("id").GetString() != profileId || descriptor.RootElement.GetProperty("format").GetInt32() != 1)
            throw new InvalidDataException("Profile selection does not match descriptor");
        var userData = descriptor.RootElement.GetProperty("desktopUserData").GetString();
        if (userData is null || !Path.IsPathFullyQualified(userData)) throw new InvalidDataException("Profile has no qualified Desktop storage directory");
        var profile = new ProfileSelection(bindingPath, profileId, Wire.Hash(bindingPath), Path.Combine(userData, "lingxi-launcher"));
        using var profileLock = LockProfile(profile);
        var value = new Installation(1, profile, channel);
        Wire.AtomicWrite(StatePath, value);
        return value;
    }

    public void SelectCandidate(Slot candidate) => Change(value =>
        value.Blocked is not null && value.Episode?.Primary.Sha256 == candidate.Sha256 ? value :
        value with { Candidate = candidate, Blocked = null, Episode = value.Blocked is null ? value.Episode : null });

    public Installation SelectChannel(string channel)
    {
        if (channel is not ("dev" or "stable")) throw new ArgumentException("Unknown channel");
        using var staging = Lock("stage");
        return Change(value => value.Channel == channel ? value : value with { Channel = channel, Candidate = null });
    }

    public FileStream LockProfile(ProfileSelection profile)
    {
        Directory.CreateDirectory(profile.OwnershipDirectory);
        var ownership = new FileStream(Path.Combine(profile.OwnershipDirectory, "launch.lock"), FileMode.OpenOrCreate,
            FileAccess.ReadWrite, FileShare.None);
        try
        {
            var ownerFile = Path.Combine(profile.OwnershipDirectory, "installation.json");
            if (File.Exists(ownerFile))
            {
                if (!Wire.Read<string>(ownerFile).Equals(Root, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("Profile is already bound to another launcher installation");
            }
            else Wire.AtomicWrite(ownerFile, Root);
            return ownership;
        }
        catch { ownership.Dispose(); throw; }
    }

    public static void VerifyProfile(ProfileSelection profile)
    {
        if (!Wire.Hash(profile.BindingPath).Equals(profile.BindingSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Profile descriptor changed since explicit selection");
    }
}
