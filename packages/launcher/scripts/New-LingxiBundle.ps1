param(
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)][string]$Output,
    [Parameter(Mandatory = $true)][string]$ReleaseId,
    [Parameter(Mandatory = $true)][string]$BackendVersion,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$StorageContract,
    [string]$Entrypoint = 'Lingxi.exe',
    [string[]]$AllowedFallbacks = @()
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/')
$destination = [IO.Path]::GetFullPath($Output)
if (-not [IO.Directory]::Exists($root)) { throw 'Bundle input directory is absent' }
if ($destination.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must be outside bundle input' }
foreach ($digest in $AllowedFallbacks) {
    if ($digest -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid allowed fallback digest' }
}
# Walk without following reparse directories. Fail rather than silently omitting content.
$pending = [Collections.Generic.Stack[string]]::new()
$pending.Push($root)
$files = [Collections.Generic.List[string]]::new()
while ($pending.Count) {
    $current = $pending.Pop()
    if ([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked bundle input' }
    foreach ($item in [IO.Directory]::EnumerateFileSystemEntries($current)) {
        $attributes = [IO.File]::GetAttributes($item)
        if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked bundle input' }
        if ($attributes -band [IO.FileAttributes]::Directory) { $pending.Push($item) }
        else { $files.Add($item) }
    }
}
$inventory = [Collections.Generic.List[object]]::new()
$created = $false
$complete = $false
$outputStream = $null
$zip = $null
$sorted = $files.ToArray()
[Array]::Sort($sorted, [StringComparer]::Ordinal)
$timestamp = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
try {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    $outputStream = [IO.FileStream]::new($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $created = $true
    $zip = [IO.Compression.ZipArchive]::new($outputStream, [IO.Compression.ZipArchiveMode]::Create, $true)
    foreach ($file in $sorted) {
        $name = $file.Substring($root.Length + 1).Replace('\', '/')
        if ($name -eq 'bundle.json') { throw 'Input already contains a bundle manifest' }
        $input = [IO.FileStream]::new($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        try {
            $hash = [Security.Cryptography.SHA256]::Create()
            try { $digest = [BitConverter]::ToString($hash.ComputeHash($input)).Replace('-', '').ToLowerInvariant() }
            finally { $hash.Dispose() }
            $input.Position = 0
            $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Fastest)
            $entry.LastWriteTime = $timestamp
            $stream = $entry.Open()
            try { $input.CopyTo($stream) } finally { $stream.Dispose() }
            $inventory.Add([ordered]@{ path = $name; bytes = $input.Length; sha256 = $digest })
        } finally { $input.Dispose() }
    }
    if ($Entrypoint -notin $inventory.path) { throw 'Entrypoint is not an inventoried file' }
    $manifest = [ordered]@{
        format = 1; releaseId = $ReleaseId; entrypoint = $Entrypoint
        storageContract = $StorageContract.ToLowerInvariant(); backendVersion = $BackendVersion
        allowedFallbacks = @($AllowedFallbacks | ForEach-Object { $_.ToLowerInvariant() }); files = @($inventory.ToArray())
    } | ConvertTo-Json -Depth 8
    $entry = $zip.CreateEntry('bundle.json')
    $entry.LastWriteTime = $timestamp
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try { $writer.Write($manifest) } finally { $writer.Dispose() }
    $zip.Dispose(); $zip = $null
    $outputStream.Flush($true)
    $outputStream.Dispose(); $outputStream = $null
    $complete = $true
} finally {
    if ($null -ne $zip) { $zip.Dispose() }
    if ($null -ne $outputStream) { $outputStream.Dispose() }
    if ($created -and -not $complete) { [IO.File]::Delete($destination) }
}
@{ archive = $destination; sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = (Get-Item -LiteralPath $destination).Length; files = $inventory.Count } | ConvertTo-Json
