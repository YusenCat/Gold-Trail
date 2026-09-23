$ErrorActionPreference = 'Stop'
try {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    Set-Location -LiteralPath $projectRoot
    $candidates = @()
    $installed = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($installed) { $candidates += $installed.Source }
    $runtime = $null
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            $version = & $candidate --version
            if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) {
                $runtime = $candidate
                break
            }
        }
    }
    if (-not $runtime) {
        throw 'Node.js 24+ is required. Install it from https://nodejs.org/ and run this launcher again.'
    }
    & $runtime (Join-Path $PSScriptRoot 'start-game.mjs') @args
    exit $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
