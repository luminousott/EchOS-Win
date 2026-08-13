@echo off
REM One-click build EchOS-Win: Go kernel + Electron (portable + NSIS).
REM See build.ps1 for options (-KernelOnly / -SkipNpm).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
exit /b %errorlevel%