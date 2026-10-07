using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Lingxi.Launcher;

public static class WindowsCredential
{
    private const string Target = "Lingxi:github:Wiedzmin-git/lingxi-releases";

    public static string Read()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        if (!CredRead(Target, 1, 0, out var pointer)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Private release credential unavailable");
        try
        {
            var value = Marshal.PtrToStructure<Credential>(pointer);
            var bytes = new byte[value.BlobSize];
            Marshal.Copy(value.Blob, bytes, 0, bytes.Length);
            try { return Encoding.UTF8.GetString(bytes); }
            finally { Array.Clear(bytes); }
        }
        finally { CredFree(pointer); }
    }

    public static void Write(string token)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        if (string.IsNullOrWhiteSpace(token) || token.Length > 2048 || token.Any(char.IsWhiteSpace))
            throw new ArgumentException("Invalid token shape");
        var bytes = Encoding.UTF8.GetBytes(token);
        var pointer = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            var value = new Credential { Type = 1, TargetName = Target, BlobSize = (uint)bytes.Length, Blob = pointer, Persist = 2, UserName = "github-token" };
            if (!CredWrite(ref value, 0)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Private release credential could not be saved");
        }
        finally
        {
            Array.Clear(bytes);
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            Marshal.FreeHGlobal(pointer);
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags;
        public uint Type;
        public string? TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint BlobSize;
        public IntPtr Blob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredWrite(ref Credential credential, uint flags);
    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr pointer);
}
