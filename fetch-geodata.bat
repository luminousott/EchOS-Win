@echo off
setlocal
REM Download geoip.dat / geosite.dat from Loyalsoldier/v2ray-rules-dat.
REM These are upstream open-source binaries, not committed to git.
REM Usage:
REM   fetch-geodata.bat                          download to assets/
REM   set GEO_SOURCE=https://... && fetch-geodata.bat   custom source

set "ROOT=%~dp0"
set "DIR=%ROOT%assets"
if not exist "%DIR%" mkdir "%DIR%"

if "%GEO_SOURCE%"=="" set "GEO_SOURCE=https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download"

call :fetch geoip.dat
call :fetch geosite.dat
echo Done: geo data ready.
exit /b 0

:fetch
set "f=%~1"
if exist "%DIR%\%f%" (
  for %%A in ("%DIR%\%f%") do if %%~zA gtr 0 (
    echo ==^> %f% exists, skip. (delete %DIR%\%f% to force re-download)
    exit /b 0
  )
)
echo ==^> Downloading %f%
curl -fL --retry 3 -o "%DIR%\%f%.tmp" "%GEO_SOURCE%/%f%"
if errorlevel 1 (
  echo [ERROR] Failed to download %f%
  del "%DIR%\%f%.tmp" 2>nul
  exit /b 1
)
move /y "%DIR%\%f%.tmp" "%DIR%\%f%" >nul
echo     %f% done.
exit /b 0