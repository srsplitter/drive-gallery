# lada-helper:// 주소를 등록해서 갤러리 [모자이크] 탭의 [도우미 켜기] 버튼이 이 PC 의 도우미를 켤 수 있게 함.
# 다른 앱처럼 실제 프로그램(node.exe)에 "%1" 을 넘기고, lada-launch.cjs 는 주소 내용을 읽지 않음.
# 기본: 현재 사용자(HKCU). -Machine: 컴퓨터 전체(HKLM, 관리자로 실행) — 크롬은 컴퓨터 전체로 등록해야 실행했음(pvd-server 때 확인).
# .reg 파일로 써서 reg.exe 로 넣음 (PowerShell 이 막는 HKLM 쓰기·5.1 의 따옴표 깨짐을 피함). -Remove 는 등록을 지움.
param([switch]$Remove, [switch]$Machine)
$ErrorActionPreference = 'Stop'
if ($Machine -and -not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw '-Machine 은 관리자 권한이 필요해요: PowerShell 을 "관리자로 실행"으로 열고 다시 실행하세요.'
}
$key = if ($Machine) { 'HKEY_LOCAL_MACHINE\Software\Classes\lada-helper' } else { 'HKEY_CURRENT_USER\Software\Classes\lada-helper' }
if ($Remove) {
  & cmd.exe /d /c "reg.exe delete `"$key`" /f >nul 2>&1"
  Write-Host 'lada-helper:// 등록을 지웠어요.'; return
}
$launcher = Join-Path $PSScriptRoot 'lada-launch.cjs'
if (-not (Test-Path -LiteralPath $launcher)) { throw 'lada-launch.cjs 를 찾지 못했어요.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$text = { param($value) '"' + $value.Replace('\', '\\').Replace('"', '\"') + '"' }
$lines = @(
  'Windows Registry Editor Version 5.00', '',
  "[$key]", ('@=' + (& $text 'URL:Gallery mosaic helper')), '"URL Protocol"=""', '',
  "[$key\DefaultIcon]", ('@=' + (& $text ('"{0}",0' -f $node))), '',
  "[$key\shell\open\command]", ('@=' + (& $text ('"{0}" "{1}" "%1"' -f $node, $launcher))), ''
)
$file = Join-Path $env:TEMP 'lada-helper-protocol.reg'
[IO.File]::WriteAllText($file, ($lines -join "`r`n"), [Text.Encoding]::Unicode)
try {
  $output = & cmd.exe /d /c "reg.exe import `"$file`" 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "reg.exe import 실패 ${key}: $($output -join ' ')" }
} finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
Write-Host ('lada-helper:// 등록됨: {0}' -f $key)
