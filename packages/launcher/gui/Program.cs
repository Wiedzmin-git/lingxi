using System.Runtime.InteropServices;
using Lingxi.Launcher;

try
{
    if (args.Length != 1) throw new ArgumentException("An explicit Lingxi installation directory is required.");
    var installation = new InstallationStore(args[0]);
    await new LaunchCoordinator(installation, new BundleStore(installation.Root)).Launch(CancellationToken.None);
    return 0;
}
catch (Exception error)
{
    Native.MessageBox(IntPtr.Zero, error.Message, "Lingxi", 0x10);
    return 1;
}

internal static class Native
{
    [DllImport("user32.dll", EntryPoint = "MessageBoxW", CharSet = CharSet.Unicode)]
    internal static extern int MessageBox(IntPtr owner, string text, string title, uint type);
}
