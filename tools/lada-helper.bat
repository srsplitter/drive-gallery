@echo off
rem 모자이크 해제 도우미 켜기 (갤러리 사이트를 쓰는 동안 이 창을 켜 두기)
chcp 65001 >nul
"C:\Program Files\nodejs\node.exe" "%~dp0lada-helper.cjs"
pause
