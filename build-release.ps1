$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestPath = Join-Path $root "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = [string]$manifest.version

if ($version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Versi manifest tidak valid: $version"
}

$trackedChanges = & git -C $root status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0) {
  throw "Status Git tidak dapat diperiksa."
}
if ($trackedChanges) {
  throw "Commit perubahan source sebelum membuat paket rilis."
}

$output = Join-Path $root "netmedic-rsdkh-v$version.zip"
& git -C $root archive --format=zip --output=$output HEAD
if ($LASTEXITCODE -ne 0) {
  throw "Pembuatan ZIP gagal."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($output)
try {
  $entry = $archive.Entries | Where-Object FullName -eq "manifest.json"
  if (-not $entry) {
    throw "manifest.json tidak ditemukan di dalam ZIP."
  }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try {
    $archiveVersion = [string](($reader.ReadToEnd() | ConvertFrom-Json).version)
  } finally {
    $reader.Dispose()
  }
  if ($archiveVersion -ne $version) {
    throw "Versi ZIP $archiveVersion tidak sama dengan manifest $version."
  }
} finally {
  $archive.Dispose()
}

Write-Host "Paket Chrome Web Store siap: $output (v$version)"
