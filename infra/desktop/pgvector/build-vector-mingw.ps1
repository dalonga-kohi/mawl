# Local fallback build of pgvector 0.8.7 for the embedded Postgres 17.10 (EDB/MSVC binaries) with MinGW gcc.
# Proven in spike D0.1 (docs/REDESIGN.md §10). Production builds use MSVC in Windows CI; this is the fallback.
# Usage: pwsh build-vector-mingw.ps1 -Root <work dir>
# Expects <work dir>\spike\node_modules\@embedded-postgres\windows-x64 (npm i --save-exact embedded-postgres@17.10.0-beta.17)
# so it can assert the EDB postgres.exe is byte-identical to the bundled one.
param([Parameter(Mandatory)] [string] $Root)
$ErrorActionPreference = 'Stop'
$bin = "$Root\bin"; $build = "$Root\build"
New-Item -ItemType Directory -Force "$bin\edb", "$bin\src", $build | Out-Null

# 1. EDB 17.10-1 zip: headers + postgres.lib (+ pg_regress/psql for installcheck). Same postgres.exe as the npm package.
$zip = "$bin\edb\pg17.zip"
if (-not (Test-Path $zip)) { curl.exe -sSL -o $zip https://get.enterprisedb.com/postgresql/postgresql-17.10-1-windows-x64-binaries.zip }
if ((Get-FileHash $zip).Hash -ne 'F9AAFCA58E7026A1EF2CAEEE711ACF761671E57904D430ADC85F468374F5A821') { throw 'EDB zip hash mismatch' }
tar.exe -xf $zip -C "$bin\edb" pgsql/include pgsql/lib/postgres.lib pgsql/bin pgsql/lib/pgxs
$npmPg = "$Root\spike\node_modules\@embedded-postgres\windows-x64\native"
if ((Get-FileHash "$bin\edb\pgsql\bin\postgres.exe").Hash -ne (Get-FileHash "$npmPg\bin\postgres.exe").Hash) { throw 'EDB and npm postgres.exe differ' }

# 2. pgvector source at a pinned tag.
$src = "$bin\src\pgvector"
if (-not (Test-Path $src)) { git -c advice.detachedHead=false clone --depth 1 --branch v0.8.7 https://github.com/pgvector/pgvector $src }

# 3. Compile + link. -Dpg_strtof / -DHAVE_X86_64_POPCNTQ make gcc see the same ABI as the MSVC headers;
#    --disable-auto-import turns any missed data-symbol mismatch into a link error instead of a runtime crash.
$inc = "$bin\edb\pgsql\include"
Push-Location $build
gcc -O2 -w -Dpg_strtof=strtof -DHAVE_X86_64_POPCNTQ -shared '-Wl,--disable-auto-import' -o vector.dll `
  "-I$inc\server\port\win32" "-I$inc\server" "-I$inc" (Get-ChildItem "$src\src" -Filter *.c).FullName "$bin\edb\pgsql\lib\postgres.lib"
if ($LASTEXITCODE -ne 0) { throw 'gcc failed' }
Pop-Location

# 4. Assemble a bundle: npm binaries + vector.dll + control + install script.
$pgroot = "$bin\pgroot"
if (-not (Test-Path $pgroot)) { Copy-Item -Recurse $npmPg $pgroot }
Copy-Item "$build\vector.dll" "$pgroot\lib\" -Force
Copy-Item "$src\vector.control" "$pgroot\share\extension\" -Force
Copy-Item "$src\sql\vector.sql" "$pgroot\share\extension\vector--0.8.7.sql" -Force
"bundle ready: $pgroot"
