# CrokCode installer for Windows PowerShell.
#
#   irm https://www.crokcode.tech/install.ps1 | iex
#
# Because the script is piped into `iex` there are no parameters. Configure it
# with environment variables instead:
#
#   $env:CROKCODE_VERSION     = "1.2.3"          # install a specific version
#   $env:CROKCODE_INSTALL_DIR = "C:\tools\bin"   # custom install directory
#   $env:CROKCODE_REPO        = "you/crokcode"   # GitHub repo to download from
#   $env:CROKCODE_BINARY      = "C:\path\crokcode.exe"  # install a local build
#   $env:CROKCODE_NO_MODIFY_PATH = "1"           # skip PATH changes
#
# Then:  irm https://www.crokcode.tech/install.ps1 | iex

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Green = "$([char]27)[38;5;148m"
$Cream = "$([char]27)[38;5;223m"
$Dim = "$([char]27)[2m"
$Red = "$([char]27)[31m"
$Reset = "$([char]27)[0m"

function Write-Banner {
    Write-Host ""
    Write-Host "$Green         ████   █   █   █         ██$Reset"
    Write-Host "$Green       ███████████████████████████$Reset"
    Write-Host "$Green  ██████ ██████████████████████$Reset"
    Write-Host "$Green  █$Cream█$Green█$Cream█$Green█$Cream█$Green██████████████████████$Reset"
    Write-Host "$Green     ██████████████████████$Reset"
    Write-Host "$Green        ██   ██     ██  ██$Reset"
    Write-Host ""
    Write-Host "  ${Green}CrokCode$Reset ${Dim}- the AI coding agent that guards your code$Reset"
    Write-Host ""
}

function Fail($message) {
    Write-Host "${Red}error:${Reset} $message"
    exit 1
}

Write-Banner

$repo = if ($env:CROKCODE_REPO) { $env:CROKCODE_REPO } else { "aaron-sequeira/crokcode" }
$installDir = if ($env:CROKCODE_INSTALL_DIR) { $env:CROKCODE_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "crokcode\bin" }

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    "ARM64" { "arm64" }
    "AMD64" { "x64" }
    default { "x64" }
}

if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}
$target = Join-Path $installDir "crokcode.exe"

if ($env:CROKCODE_BINARY) {
    # Install from a locally built binary.
    if (-not (Test-Path $env:CROKCODE_BINARY)) { Fail "no binary at $($env:CROKCODE_BINARY)" }
    Copy-Item -Path $env:CROKCODE_BINARY -Destination $target -Force
    $version = "local"
} else {
    # Resolve the version to install.
    $version = $env:CROKCODE_VERSION
    if (-not $version) {
        Write-Host "  Resolving latest release..."
        try {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "crokcode-installer" }
            $version = $release.tag_name -replace '^v', ''
        } catch {
            Fail "could not reach GitHub releases for '$repo'. Set `$env:CROKCODE_REPO, or build locally and set `$env:CROKCODE_BINARY. See the README."
        }
    }
    if (-not $version) { Fail "could not determine a version to install" }

    $asset = "crokcode-windows-$arch.zip"
    $url = "https://github.com/$repo/releases/download/v$version/$asset"
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("crokcode-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null

    try {
        Write-Host "  Downloading $Dim$asset$Reset (v$version)"
        Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp $asset) -Headers @{ "User-Agent" = "crokcode-installer" }
        Expand-Archive -Path (Join-Path $tmp $asset) -DestinationPath $tmp -Force

        $found = Get-ChildItem -Path $tmp -Recurse -Filter "crokcode.exe" | Select-Object -First 1
        if (-not $found) { Fail "crokcode.exe was not found inside $asset" }
        Copy-Item -Path $found.FullName -Destination $target -Force
    } catch {
        Fail "install failed: $($_.Exception.Message)"
    } finally {
        try { Remove-Item -Recurse -Force $tmp -ErrorAction Stop } catch {}
    }
}

Write-Host "  Installed $Dim$target$Reset"

if ($env:CROKCODE_NO_MODIFY_PATH -ne "1") {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($null -eq $userPath) { $userPath = "" }
    if ($userPath -notlike "*$installDir*") {
        $newPath = if ($userPath.TrimEnd(';') -eq "") { $installDir } else { $userPath.TrimEnd(';') + ";" + $installDir }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        $env:Path = $env:Path + ";" + $installDir
        Write-Host "  Added to PATH $Dim(restart your terminal for new sessions)$Reset"
    } else {
        Write-Host "  Already on PATH"
    }
}

Write-Host ""
Write-Host "  Run ${Green}crokcode$Reset to start."
Write-Host ""
