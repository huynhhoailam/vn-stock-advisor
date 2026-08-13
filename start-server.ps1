param([int]$Port = 8765)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Get-Command python -ErrorAction SilentlyContinue
$pyLauncher = Get-Command py -ErrorAction SilentlyContinue

Write-Host "VN Stock Advisor: http://127.0.0.1:$Port/"
Write-Host 'Nhan Ctrl+C de dung server.'

if ($python) {
    & $python.Source -m http.server $Port --bind 127.0.0.1 --directory $workspace
} elseif ($pyLauncher) {
    & $pyLauncher.Source -m http.server $Port --bind 127.0.0.1 --directory $workspace
} else {
    throw 'Can cai Python hoac chay bang mot static web server bat ky.'
}
