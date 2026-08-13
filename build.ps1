# ============================================================
#  EchOS-Win (Windows 版) 一键构建脚本
#  Go 内核 x-tunnel + Electron 界面 -> build/installer
#
#  用法:
#    .\build.ps1                # 完整构建（含 npm install）
#    .\build.ps1 -SkipNpm       # 跳过 npm install（依赖已装好）
#    .\build.ps1 -KernelOnly    # 只编译 Go 内核，不打包界面
# ============================================================
param(
  [switch]$SkipNpm,
  [switch]$KernelOnly
)
$ErrorActionPreference = 'Stop'
# 确保 go 可用（winget / 官方安装默认路径）
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
  $goCandidates = @(
    (Join-Path $env:ProgramFiles 'Go\bin'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Go\bin'),
    'C:\Go\bin'
  )
  foreach ($p in $goCandidates) {
    if (Test-Path (Join-Path $p 'go.exe')) { $env:Path = "$p;$env:Path"; break }
  }
}
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
  throw '未找到 Go 编译器，请先安装 https://go.dev/dl/ 或将其加入 PATH'
}
#  中国大陆网络若 Electron 二进制下载慢/失败，可先设置（可选）：
#    $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
#    $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$OUT  = Join-Path $ROOT 'build'
$GUI  = Join-Path $ROOT 'gui'

if (-not (Test-Path $OUT)) { New-Item -ItemType Directory -Path $OUT | Out-Null }

Write-Host "==> 1/3 编译 Go 内核 x-tunnel (windows/amd64)" -ForegroundColor Cyan
Push-Location (Join-Path $ROOT 'core')
try {
  $env:CGO_ENABLED = '0'
  $env:GOOS       = 'windows'
  $env:GOARCH     = 'amd64'
  # 国内网络可换用 GOPROXY=https://goproxy.cn,direct
  if (-not $env:GOPROXY) { $env:GOPROXY = 'https://goproxy.cn,direct' }
  go build -trimpath -ldflags '-s -w' -o (Join-Path $OUT 'x-tunnel.exe') .
  if ($LASTEXITCODE -ne 0) { throw 'Go 内核编译失败' }
} finally {
  Pop-Location
}
Write-Host "    内核输出: $(Join-Path $OUT 'x-tunnel.exe')" -ForegroundColor Green

if ($KernelOnly) {
  Write-Host "完成（仅内核）：$OUT" -ForegroundColor Green
  exit 0
}

Write-Host "==> 2/3 检查分流数据文件" -ForegroundColor Cyan
foreach ($d in @('geoip', 'geosite')) {
  $src = Join-Path $ROOT "assets\$d.dat"
  if (Test-Path $src) {
    Write-Host "    找到 $d.dat ($([math]::Round((Get-Item $src).Length / 1MB, 1)) MB)" -ForegroundColor Green
  } else {
    Write-Warning "缺少 assets/$d.dat，分流模式将无法工作（请先运行 fetch-geodata.sh）"
  }
}

# 构建时通过镜像下载 Electron 二进制与打包工具（npmmirror，国内加速）
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
Write-Host "==> 3/3 打包 Electron 应用" -ForegroundColor Cyan
Push-Location $GUI
try {
  if (-not $SkipNpm) {
    Write-Host "    安装依赖 (npm install)..."
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }
  }
  Write-Host "    开始打包 (electron-builder)..."
  npm run dist
  if ($LASTEXITCODE -ne 0) { throw 'electron-builder 打包失败' }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "完成！安装包位于: $(Join-Path $OUT 'installer')" -ForegroundColor Green