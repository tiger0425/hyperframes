# tools/shot.ps1 - capture a real page with local headless Chrome at 2x (3788x1960)
# Why a .ps1: local Chrome needs its own user-data-dir to exit reliably, and this
# pipeline forbids Node from capturing child stdout (restricted-sandbox EPERM).
# ASCII only on purpose - keep the file readable under any console codepage.
#
# usage:
#   powershell -File tools/shot.ps1 -Url <url> -Out <png> [-Width 1894] [-Height 980] [-WaitSec 90]
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Width = 1894,
  [int]$Height = 980,
  [int]$WaitSec = 90
)

$ErrorActionPreference = "Stop"

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { throw "chrome not found: $chrome" }

$outFull = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Out))
$outDir = [System.IO.Path]::GetDirectoryName($outFull)
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Remove-Item -LiteralPath $outFull -ErrorAction SilentlyContinue

$ud = Join-Path $env:TEMP "hf-shot-profile"
New-Item -ItemType Directory -Force -Path $ud | Out-Null

$chromeArgs = @(
  "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--force-device-scale-factor=2",
  "--user-data-dir=$ud",
  "--window-size=$Width,$Height",
  "--virtual-time-budget=15000",
  "--screenshot=$outFull",
  $Url
)

$p = Start-Process -FilePath $chrome -ArgumentList $chromeArgs -PassThru -WindowStyle Hidden
$p | Wait-Process -Timeout $WaitSec -ErrorAction SilentlyContinue
if (-not $p.HasExited) { $p.Kill(); Start-Sleep -Milliseconds 1000 }

if (-not (Test-Path $outFull)) { throw "screenshot failed (no output file): $Url" }
$dim = & ffprobe -v error -show_entries stream=width,height -of csv=p=0 $outFull
Write-Output ("OK " + (Split-Path -Leaf $outFull) + " " + $dim)
