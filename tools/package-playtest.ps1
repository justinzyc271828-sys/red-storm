param(
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version = '0.6.5'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$distRoot = Join-Path $repoRoot 'dist'
$packageName = "red-storm-playtest-v$Version"
$packageDir = Join-Path $distRoot $packageName
$zipPath = Join-Path $distRoot "$packageName.zip"
$shaPath = "$zipPath.sha256"

$runtimeFiles = @(
  'index.html'
  'favicon.ico'
  'README-PLAY.md'
  'art/favicon.png'
  'art/music/title.mp3'
  'art/music/peace-01.mp3'
  'art/music/peace-02.mp3'
  'art/music/tension.mp3'
  'src/config.js'
  'src/i18n.js'
  'src/art-data.js'
  'src/iso.js'
  'src/map.js'
  'src/units.js'
  'src/field-guide.js'
  'src/sprites.js'
  'src/enemy-art.js'
  'src/camera.js'
  'src/input.js'
  'src/game.js'
  'src/combat.js'
  'src/ai.js'
  'src/audio.js'
  'src/campaign-art.js'
  'src/cutscene.js'
  'src/campaign.js'
  'src/render.js'
  'src/main.js'
)

# 剧情 CG 关键帧(tools/convert-cg.js 产出的正式图;raw/ 原图不进包)
$cgDir = Join-Path $repoRoot 'art/campaign/cg'
if (Test-Path -LiteralPath $cgDir -PathType Container) {
  Get-ChildItem -LiteralPath $cgDir -File -Filter '*.png' | ForEach-Object {
    $runtimeFiles += ('art/campaign/cg/' + $_.Name)
  }
}

# 正式音效(art/sfx 根目录全部 wav;candidates/ 候选子目录不进包)
$sfxDir = Join-Path $repoRoot 'art/sfx'
if (Test-Path -LiteralPath $sfxDir -PathType Container) {
  Get-ChildItem -LiteralPath $sfxDir -File -Filter '*.wav' | ForEach-Object {
    $runtimeFiles += ('art/sfx/' + $_.Name)
  }
}

foreach ($relativePath in $runtimeFiles) {
  $sourcePath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Missing runtime file; packaging stopped: $relativePath"
  }
}

$declaredFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($relativePath in $runtimeFiles) {
  [void]$declaredFiles.Add($relativePath)
}
$indexText = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $repoRoot 'index.html')
$indexReferences = [regex]::Matches($indexText, '(?:src|href)="([^"?]+)(?:\?[^"]*)?"') |
  ForEach-Object { $_.Groups[1].Value }
$audioText = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $repoRoot 'src/audio.js')
$audioReferences = [regex]::Matches($audioText, "'(art/(?:music|sfx)/[^']+)'") |
  ForEach-Object { $_.Groups[1].Value }
foreach ($reference in @($indexReferences) + @($audioReferences)) {
  if (-not $declaredFiles.Contains($reference)) {
    throw "Referenced runtime file is not allowlisted; packaging stopped: $reference"
  }
}

foreach ($target in @($packageDir, $zipPath, $shaPath)) {
  if (Test-Path -LiteralPath $target) {
    throw "Target already exists; refusing to overwrite: $target`nUse a new version or remove the old artifact manually."
  }
}

if (-not (Test-Path -LiteralPath $distRoot)) {
  New-Item -ItemType Directory -Path $distRoot | Out-Null
}
New-Item -ItemType Directory -Path $packageDir | Out-Null

foreach ($relativePath in $runtimeFiles) {
  $sourcePath = Join-Path $repoRoot $relativePath
  $destinationPath = Join-Path $packageDir $relativePath
  $destinationParent = Split-Path -Parent $destinationPath
  if (-not (Test-Path -LiteralPath $destinationParent)) {
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
  }
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
}

$packagedReadme = Join-Path $packageDir 'README-PLAY.md'
$readmeText = Get-Content -Raw -Encoding utf8 -LiteralPath $packagedReadme
$versionLinePattern = '(?m)^(.{3}v)[^\r\n]+'
if ($readmeText -notmatch $versionLinePattern) {
  throw 'README-PLAY.md has no replaceable version line; packaging stopped.'
}
$versionedReadmeText = $readmeText -replace $versionLinePattern, ('${1}' + $Version)
if ($versionedReadmeText -cne $readmeText) {
  Set-Content -LiteralPath $packagedReadme -Value $versionedReadmeText -Encoding utf8
}

$manifestLines = @(
  'Red Storm playtest package'
  "Version: $Version"
  "Package: $packageName"
  ''
  'SHA-256  Bytes  Path'
)
foreach ($relativePath in $runtimeFiles | Sort-Object) {
  $packagedPath = Join-Path $packageDir $relativePath
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $packagedPath).Hash.ToLowerInvariant()
  $bytes = (Get-Item -LiteralPath $packagedPath).Length
  $manifestLines += "$hash  $bytes  $relativePath"
}
$manifestPath = Join-Path $packageDir 'MANIFEST.txt'
Set-Content -LiteralPath $manifestPath -Value $manifestLines -Encoding utf8

Compress-Archive -LiteralPath $packageDir -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
Set-Content -LiteralPath $shaPath -Value "$zipHash  $packageName.zip" -Encoding ascii

$packageBytes = (Get-ChildItem -LiteralPath $packageDir -File -Recurse |
  Measure-Object -Property Length -Sum).Sum
$zipBytes = (Get-Item -LiteralPath $zipPath).Length

[pscustomobject]@{
  Version = $Version
  PackageDirectory = $packageDir
  Zip = $zipPath
  Sha256File = $shaPath
  Sha256 = $zipHash
  FileCount = $runtimeFiles.Count + 1
  PackageBytes = $packageBytes
  ZipBytes = $zipBytes
}
