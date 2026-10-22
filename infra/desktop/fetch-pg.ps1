# Fetches the PostgreSQL 17.10 Windows binaries Mawl embeds (docs/REDESIGN.md §10.1) and prunes
# them to what the server runs: initdb, postgres, pg_ctl (+ pg_controldata for diagnostics), their
# DLLs, the extension libraries and share/ without translations.
#
# Usage: pwsh infra/desktop/fetch-pg.ps1 -Dest <dir> [-Zip <path to keep the zip>] [-Force]
#   -Dest  the pruned bundle (the install's pg\, and MAWL_PG_ROOT for the embedded-pg tests)
#   -Zip   where the downloaded zip is cached; an existing file is reused if its hash matches
#   -Force replace an existing -Dest that is not a bundle this script made
#
# Idempotent: a -Dest with a matching marker is left alone. The zip (about 318 MiB, most of it
# pgAdmin) is pinned by SHA256 and the script fails on any mismatch. The bundle is assembled in a
# staging dir and moved into place; it carries its marker, so -Dest is either the complete new
# bundle or the previous one (moved aside to -Dest.old and restored on failure). A run killed
# mid-swap can leave -Dest missing with -Dest.old intact: rerun to finish.
param(
  [Parameter(Mandatory)] [string] $Dest,
  [string] $Zip,
  [switch] $Force
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Version = '17.10-1'
$Url = "https://get.enterprisedb.com/postgresql/postgresql-$Version-windows-x64-binaries.zip"
$Sha256 = 'F9AAFCA58E7026A1EF2CAEEE711ACF761671E57904D430ADC85F468374F5A821'
$MarkerName = '.mawl-pg-bundle'
$MarkerText = "postgresql $Version $Sha256"

$Dest = [IO.Path]::GetFullPath($Dest)
if (-not $Zip) { $Zip = "$Dest.zip" }
$Zip = [IO.Path]::GetFullPath($Zip)
$marker = Join-Path $Dest $MarkerName

if ((Test-Path -LiteralPath $marker) -and ((Get-Content -LiteralPath $marker -Raw).Trim() -eq $MarkerText)) {
  "bundle up to date: $Dest"
  exit 0
}
if ((Test-Path -LiteralPath $Dest) -and -not $Force) {
  throw "$Dest exists but is not a PostgreSQL $Version bundle from this script; pass -Force to replace it"
}

# 1. The zip, pinned by hash.
if (-not (Test-Path -LiteralPath $Zip)) {
  New-Item -ItemType Directory -Force (Split-Path -Parent $Zip) | Out-Null
  $partial = "$Zip.partial"
  Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
  "downloading $Url"
  # HTTPS only, including redirects (EDB redirects to its CDN); the hash check is the real gate.
  curl.exe -fsSL --proto '=https' --proto-redir '=https' --retry 3 -o $partial $Url
  if ($LASTEXITCODE -ne 0) { throw "download failed (curl exit $LASTEXITCODE)" }
  $got = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash
  if ($got -ne $Sha256) {
    Remove-Item -LiteralPath $partial -Force
    throw "SHA256 mismatch for the downloaded zip: got $got, expected $Sha256"
  }
  Move-Item -LiteralPath $partial $Zip
} else {
  $got = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash
  if ($got -ne $Sha256) {
    throw "SHA256 mismatch for $Zip`: got $got, expected $Sha256. Delete it to download again."
  }
}

# 2. Extract only what the server can use (no pgAdmin, StackBuilder, docs or headers).
$staging = "$Dest.staging"
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Force $staging | Out-Null
tar.exe -xf $Zip -C $staging pgsql/bin pgsql/lib pgsql/share pgsql/server_license.txt pgsql/commandlinetools_3rd_party_licenses.txt
if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
$root = Join-Path $staging 'pgsql'

# 3. Prune. bin\ keeps every runtime DLL Postgres may load, but only the tools the server runs.
$keepExe = @('initdb.exe', 'postgres.exe', 'pg_ctl.exe', 'pg_controldata.exe')
Get-ChildItem -LiteralPath "$root\bin" -File | Where-Object {
  ($_.Extension -eq '.exe' -and $keepExe -notcontains $_.Name) -or
  $_.Name -like 'wx*.dll' -or       # pgAdmin's wxWidgets (about 13 MB)
  $_.Name -eq 'testplug.dll' -or
  $_.Extension -eq '.lib'
} | Remove-Item -Force
Get-ChildItem -LiteralPath "$root\lib" -File -Filter *.lib | Remove-Item -Force   # import libs, build-only
foreach ($dir in 'lib\pgxs', 'lib\pkgconfig', 'share\locale', 'share\doc') {
  $p = Join-Path $root $dir
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
}
foreach ($exe in $keepExe) {
  if (-not (Test-Path -LiteralPath "$root\bin\$exe")) { throw "the zip has no bin\$exe" }
}

# 4. Commit: marker inside, then swap. An old -Dest is moved aside first and restored if the
#    new bundle cannot be moved in, so a failure never leaves -Dest missing or half-replaced.
Set-Content -LiteralPath (Join-Path $root $MarkerName) -Value $MarkerText -NoNewline
New-Item -ItemType Directory -Force (Split-Path -Parent $Dest) | Out-Null
$old = "$Dest.old"
if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }
$hadOld = Test-Path -LiteralPath $Dest
if ($hadOld) { Move-Item -LiteralPath $Dest $old }
try {
  Move-Item -LiteralPath $root $Dest
} catch {
  if ($hadOld -and -not (Test-Path -LiteralPath $Dest)) { Move-Item -LiteralPath $old $Dest }
  throw
}
if ($hadOld) { Remove-Item -LiteralPath $old -Recurse -Force }
Remove-Item -LiteralPath $staging -Recurse -Force
$size = (Get-ChildItem -LiteralPath $Dest -Recurse -File | Measure-Object Length -Sum).Sum
'bundle ready: {0} ({1:N1} MB)' -f $Dest, ($size / 1MB)
