# Builds the Windows release on the owner's PC: a self-contained publish, then Velopack's
# installer, full package and delta against the last published release.
#   pwsh tools\windows\pack.ps1 -Version 2.0.1 [-Notes "что нового"]
# Copy windows\Releases\ to the server and run tools/windows/publish.sh there.
param(
    [Parameter(Mandatory)][string]$Version,
    [string]$Notes = "",
    [string]$Feed = "https://musixai.ru/download/windows"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\.."
$app = "$root\windows\src\Musix.App"
$pub = "$root\windows\publish"
$out = "$root\windows\Releases"
# vpk must match the Velopack package in Musix.App.csproj
dotnet tool update -g vpk --version 0.0.1298
Remove-Item -Recurse -Force $pub -ErrorAction SilentlyContinue
dotnet publish $app -c Release -r win-x64 --self-contained -p:Version=$Version -o $pub
# the previous release, for a delta package (a first release has none)
try { vpk download http --url $Feed --outputDir $out } catch { Write-Host "no previous release at $Feed" }
$notesFile = Join-Path $env:TEMP "musix-notes.md"
Set-Content -Path $notesFile -Value $Notes -Encoding utf8
vpk pack --packId MusiX --packVersion $Version --packDir $pub --mainExe MusiX.exe `
    --packTitle MusiX --packAuthors MusiX --icon "$app\Assets\musix.ico" --releaseNotes $notesFile --outputDir $out
Get-FileHash "$out\MusiX-win-Setup.exe" -Algorithm SHA256 | Format-List
Write-Host "Done: $out"
