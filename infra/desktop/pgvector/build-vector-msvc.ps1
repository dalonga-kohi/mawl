# Production build of pgvector for the embedded Postgres 17.10 (docs/REDESIGN.md §10.1, D1.2).
# Builds with MSVC against the EDB 17.10-1 headers and postgres.lib, runs pgvector's own
# `installcheck` on a throwaway cluster, then collects vector.dll, the control file and the SQL
# script plus a SHA256SUMS.txt into -Out. The PE timestamp makes vector.dll non-reproducible, so
# the hash is recorded per build instead of compared against a fixed value.
#
# Usage (Developer shell or plain pwsh; the MSVC environment is loaded when cl.exe is missing):
#   pwsh infra/desktop/pgvector/build-vector-msvc.ps1 -Work <scratch dir> -Out <artifact dir>
# The MinGW recipe (build-vector-mingw.ps1) stays the local fallback.
param(
  [Parameter(Mandatory)] [string] $Work,
  [Parameter(Mandatory)] [string] $Out
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PgVersion = '17.10-1'
$PgUrl = "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-windows-x64-binaries.zip"
$PgZipSha256 = 'F9AAFCA58E7026A1EF2CAEEE711ACF761671E57904D430ADC85F468374F5A821'
$PgExeSha256 = 'DB14DDB0EFC10B72B57DC29DBCE5A719E2755DCD0AE54297D0EA4BBFC75F79A0'
$VectorTag = 'v0.8.7'
$VectorCommit = 'f37c13f6'
$VectorVersion = '0.8.7'
$Port = 54329

function Invoke-Native([string] $What, [scriptblock] $Block) {
  & $Block
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$Work = [IO.Path]::GetFullPath($Work)
$Out = [IO.Path]::GetFullPath($Out)
New-Item -ItemType Directory -Force $Work, $Out | Out-Null

# 1. The EDB zip, pinned by hash, and its postgres.exe pinned separately.
$zip = Join-Path $Work 'pg.zip'
if (-not (Test-Path -LiteralPath $zip)) {
  Invoke-Native 'download' { curl.exe -fsSL --proto '=https' --proto-redir '=https' --retry 3 -o $zip $PgUrl }
}
$got = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
if ($got -ne $PgZipSha256) { throw "SHA256 mismatch for the EDB zip: got $got, expected $PgZipSha256" }

$pgroot = Join-Path $Work 'pgsql'
if (Test-Path -LiteralPath $pgroot) { Remove-Item -LiteralPath $pgroot -Recurse -Force }
Invoke-Native 'tar' { tar.exe -xf $zip -C $Work pgsql/bin pgsql/lib pgsql/share pgsql/include }
$got = (Get-FileHash -LiteralPath "$pgroot\bin\postgres.exe" -Algorithm SHA256).Hash
if ($got -ne $PgExeSha256) { throw "postgres.exe differs from the pinned build: got $got, expected $PgExeSha256" }

# 2. pgvector at the pinned tag; the tag must still point at the commit we reviewed.
$src = Join-Path $Work 'pgvector'
if (Test-Path -LiteralPath $src) { Remove-Item -LiteralPath $src -Recurse -Force }
Invoke-Native 'git clone' { git -c advice.detachedHead=false clone --depth 1 --branch $VectorTag https://github.com/pgvector/pgvector $src }
$head = (git -C $src rev-parse HEAD).Trim()
if (-not $head.StartsWith($VectorCommit)) { throw "pgvector $VectorTag is at $head, expected $VectorCommit" }

# 3. MSVC environment, unless the caller already has one.
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if (-not $vs) { throw 'no Visual Studio with the C++ x64 tools found' }
  $vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
  cmd.exe /c "`"$vcvars`" >nul && set" | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') { Set-Item -LiteralPath "env:$($Matches[1])" -Value $Matches[2] }
  }
}
if (-not (Get-Command nmake.exe -ErrorAction SilentlyContinue)) { throw 'nmake.exe not on PATH' }

# 4. Build and install into the staged tree, then run pgvector's regression suite on a scratch cluster.
$env:PGROOT = $pgroot
Push-Location $src
$cluster = Join-Path $Work 'cluster'
$started = $false
try {
  Invoke-Native 'nmake build' { nmake.exe /nologo /F Makefile.win }
  Invoke-Native 'nmake install' { nmake.exe /nologo /F Makefile.win install }

  Invoke-Native 'initdb' { & "$pgroot\bin\initdb.exe" --no-sync --auth=trust --username=postgres --encoding=UTF8 --no-locale -D $cluster }
  # The runner is an administrator and postgres.exe refuses that. pg_ctl starts it with a
  # restricted token instead. Its handles are redirected to files so the call cannot hang on
  # inherited pipes, and only its exit code is read.
  $serverLog = Join-Path $Work 'postgres.log'
  $ctl = Start-Process -FilePath "$pgroot\bin\pg_ctl.exe" -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Work 'pg_ctl.out.log') -RedirectStandardError (Join-Path $Work 'pg_ctl.err.log') `
    -ArgumentList 'start', '-w', '-t', '60', '-D', "`"$cluster`"", '-l', "`"$serverLog`"", '-o', "`"-p $Port -c listen_addresses=127.0.0.1`""
  # The wait switch is avoided on purpose: it also waits for descendants, and postgres outlives pg_ctl.
  # The timed WaitForExit watches pg_ctl alone, so a stuck start fails the job instead of hanging it.
  if (-not $ctl.WaitForExit(90000)) { $ctl.Kill(); throw 'pg_ctl start did not return within 90 s' }
  $started = ($ctl.ExitCode -eq 0)
  if (-not $started) {
    # Postgres output is the only clue to why it did not come up, so print it before failing.
    foreach ($log in $serverLog, (Join-Path $Work 'pg_ctl.out.log'), (Join-Path $Work 'pg_ctl.err.log')) {
      if (Test-Path -LiteralPath $log) { "--- $log"; Get-Content -LiteralPath $log -Tail 40 }
    }
    throw "scratch Postgres did not start (pg_ctl exit $($ctl.ExitCode))"
  }

  $env:PGHOST = '127.0.0.1'; $env:PGPORT = "$Port"; $env:PGUSER = 'postgres'
  Invoke-Native 'installcheck' { nmake.exe /nologo /F Makefile.win installcheck }
} finally {
  Pop-Location
  if ($started) {
    & "$pgroot\bin\pg_ctl.exe" stop -D $cluster -m fast -w 2>&1 | Out-Null
  }
}

# 5. Collect the three files the installer ships, with their hashes.
Copy-Item "$pgroot\lib\vector.dll" $Out -Force
Copy-Item "$pgroot\share\extension\vector.control" $Out -Force
Copy-Item "$pgroot\share\extension\vector--$VectorVersion.sql" $Out -Force
$sums = Get-ChildItem -LiteralPath $Out -File | Where-Object Name -ne 'SHA256SUMS.txt' | Sort-Object Name | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name
}
Set-Content -LiteralPath (Join-Path $Out 'SHA256SUMS.txt') -Value $sums
$sums
