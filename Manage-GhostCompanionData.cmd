@echo off
setlocal
if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Manage-Data.ps1" -Choose -Restart
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Manage-Data.ps1" %*
)
if errorlevel 1 pause
endlocal
