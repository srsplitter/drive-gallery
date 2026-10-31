$ErrorActionPreference = 'Stop'
$vaceRoot = 'C:\AI\VACE-local-test'
$python = 'C:\AI\ComfyUI_windows_portable\python_embeded\python.exe'
$main = 'C:\AI\ComfyUI_windows_portable\ComfyUI\main.py'
if (Get-NetTCPConnection -LocalPort 8189 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 8189 is already in use. Check the existing engine before starting another.'
}
foreach ($folder in @('input', 'output', 'temp', 'user', 'logs')) {
    New-Item -ItemType Directory -Path (Join-Path $vaceRoot $folder) -Force | Out-Null
}
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:HF_HUB_OFFLINE = '1'
$env:HF_HUB_DISABLE_TELEMETRY = '1'
$env:HF_HOME = Join-Path $vaceRoot 'hf-cache'
$process = Start-Process -FilePath $python -ArgumentList @(
    '-s', $main, '--base-directory', $vaceRoot,
    '--listen', '127.0.0.1', '--port', '8189', '--offline',
    '--disable-all-custom-nodes', '--disable-auto-launch',
    '--use-pytorch-cross-attention', '--reserve-vram', '1.0', '--cache-none'
) -WorkingDirectory $vaceRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $vaceRoot 'logs\server.stdout.log') `
    -RedirectStandardError (Join-Path $vaceRoot 'logs\server.stderr.log')
$process.Id | Set-Content -LiteralPath (Join-Path $vaceRoot 'engine.pid')
Write-Output "VACE engine starting on http://127.0.0.1:8189 (PID $($process.Id))"
