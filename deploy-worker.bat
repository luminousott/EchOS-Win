@echo off
setlocal
REM One-click deploy Cloudflare Worker.
REM Requires: wrangler CLI (npm install -g wrangler) and Cloudflare login.
REM Usage:
REM   deploy-worker.bat                             deploy without auth
REM   set TOKEN=your-secret && deploy-worker.bat    deploy and set TOKEN secret

where wrangler >nul 2>&1
if errorlevel 1 (
  echo wrangler not found. Install with: npm install -g wrangler
  exit /b 1
)

wrangler whoami >nul 2>&1
if errorlevel 1 (
  echo ==^> Not logged in. Opening browser for Cloudflare login...
  wrangler login
)

echo ==^> Deploying Worker (name in wrangler.toml)...
wrangler deploy
if errorlevel 1 (
  echo [ERROR] Deploy failed.
  exit /b 1
)

if defined TOKEN (
  echo ==^> Setting TOKEN secret (from env TOKEN)...
  echo|set /p="%TOKEN%"| wrangler secret put TOKEN
) else (
  echo ==^> No TOKEN set, skipping auth secret.
  echo     To set it later: echo your-TOKEN^| wrangler secret put TOKEN
)

echo.
echo Deploy done. URL: https://^<worker-name^>^.<your-cf-subdomain^>^.workers.dev
echo Fill this into EchOS-Win "Server Address", port 443.
exit /b 0


pause