$ErrorActionPreference = 'Stop'
$vaceRoot = 'C:\AI\VACE-local-test'
$python = 'C:\AI\ComfyUI_windows_portable\python_embeded\python.exe'
$ready = $false
try {
    $stats = Invoke-RestMethod -Uri 'http://127.0.0.1:8189/system_stats' -TimeoutSec 2
    if ($stats.system.argv -notcontains $vaceRoot) { throw 'Port 8189 belongs to another ComfyUI instance.' }
    $ready = $true
} catch {
    if (Get-NetTCPConnection -LocalPort 8189 -State Listen -ErrorAction SilentlyContinue) { throw }
}
if (-not $ready) { & (Join-Path $PSScriptRoot 'start-engine.ps1') }
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $stats = Invoke-RestMethod -Uri 'http://127.0.0.1:8189/system_stats' -TimeoutSec 2
        $ready = $true
        break
    } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) { throw 'VACE engine did not start. Check C:\AI\VACE-local-test\logs.' }
if (Get-NetTCPConnection -LocalPort 7862 -State Listen -ErrorAction SilentlyContinue) {
    Write-Output 'The local helper is already running on port 7862.'
    exit 0
}
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:HF_HUB_OFFLINE = '1'
$env:HF_HUB_DISABLE_TELEMETRY = '1'
$script = Join-Path $PSScriptRoot 'vace_helper.py'
$process = Start-Process -FilePath $python -ArgumentList @('-s', ('"' + $script + '"')) `
    -WorkingDirectory $vaceRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $vaceRoot 'logs\helper.stdout.log') `
    -RedirectStandardError (Join-Path $vaceRoot 'logs\helper.stderr.log')
$process.Id | Set-Content -LiteralPath (Join-Path $vaceRoot 'helper.pid')
Write-Output "Face preview helper started (PID $($process.Id)). Open the gallery and choose '가상 얼굴 테스트'."
