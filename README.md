# EchOS-Win

基于 **ECH（Encrypted Client Hello）** 的加密代理客户端，**Windows 桌面应用**。

**Go 内核 + Electron 界面**，一个 App 完成代理全部功能，不需要额外装 v2rayN / ClashX。
服务端跑在 Cloudflare Workers 上，免费额度足够个人日常使用。
> 上游源仓库：**[https://github.com/nerder-real/EchOS/](https://github.com/nerder-real/EchOS/)**（macOS 原版，本项目由它移植而来）
> **Windows 版（Go + Electron）为当前默认**；原 macOS 版（Go + SwiftUI）源码保留在 `gui-macos/`，
> 构建脚本为 `build.sh` / `make-dmg.sh`。

---

## 界面预览

浅色 / 深色自动适配，跟随 Windows 系统深浅色自动切换，无需手动设置：

| 浅色 | 深色 |
|---|---|
| ![浅色](screenshot/light.png) | ![深色](screenshot/dark.png) |

> 多服务器管理、核心配置、分流规则、运行日志都在一个窗口里。

---

## 功能特性

- **ECH 加密隧道** — 基于 TLS ECH 的代理协议，抗 DPI 检测
- **SOCKS5 + HTTP 双协议本地代理** — 自动分配端口，HTTP 端口自动 +1
- **系统代理一键接管** — 启动即接管 Safari / Chrome 等全部系统代理流量，停止时自动还原。接管只作用于**当前默认路由所在的活动网络服务**（快且不碰无关网卡）；默认路由落在虚拟接口（有 VPN 在跑）时**自动跳过接管**，绝不和 VPN 抢流量。菜单栏图标在**接管成功后才变蓝**
- **三种分流模式（App 级）** — 绕过中国大陆 / 黑名单 / 全局；分流模式是全局参数，无论选中哪台服务器都遵从同一个，切换**立即生效并自动保存**（不要求点「保存」，重启不回退）。配合 v2rayN 使用时建议 v2rayN 负责分流、这里选「全局模式」当纯隧道出口
- **自定义分流规则** — 域名、IP 段、网站分类（geosite / geoip），支持搜索与展开查看
- **多服务器管理** — 新增即弹「新建服务器名称」；服务器名称唯一（重名拦截），最多 8 个汉字 / 16 个英文（输入时实时截断）；参数不完整时拒绝保存并说明；只有点过「保存」的服务器才会落盘，未保存的退出后自动丢弃。**运行中切换服务器**：状态栏菜单或主窗口下拉直接切换，自动重启代理换到新服务器生效
- **隧道兜底（防黑洞卡死）** — 客户端已向目标发过数据、服务端却长时间从未返回时（典型是 Worker 兼容日期不对导致出站数据不转发）自动断开并点名提示，连接不再永久挂起
- **自动检查更新** — 启动时后台静默检查 GitHub Releases；发现新版本用独立弹窗提示，确认后**自动下载 DMG 并替换 /Applications 里的旧版，完成后自动重启**（不需要手动拖拽；失败自动退回手动方式）；分流数据（geoip / geosite）也会随上游自动更新到本地数据目录。网络策略为**隧道优先、失败降级直连**（隧道出口共享 IP 被 GitHub API 限流 403 时自动改用家庭独立 IP 直连重试）。**更新源仓库不写死**：构建时自动取自 git remote（fork 后打包自动指向 fork 自己的仓库），也可环境变量覆盖
- **服务器分享** — 勾选已保存的服务器导出成文件（.json），或从分享文件一键导入；导入只接收参数完整的服务器，名称撞车时（服务地址+端口不同）自动改名「-01」防重复，无效/空壳/未保存的草稿自动过滤丢弃
- **整配置备份** — 本地文件 / WebDAV 两种备份方式；只备份已保存的服务器，WebDAV 密码存系统钥匙串；还原前逐台校验，参数不完整的自动跳过，不让坏数据污染配置
- **浅色/深色自动适配** — 跟随 Windows 系统深浅色自动切换
- **连通性自检** — 自检按钮任何状态都能点：未启动时预检（TCP 测服务器端口 + DoH 443 可达性），人工确认配置能用了再启动；启动时自动静默检测一次，运行中随时可手动复查完整连通性（本地端口、国内直连、隧道），图标颜色反映实际结果（待检测中性色、检测中黄色、通过绿色、失败红色）。国外站点为**多站点连通性探测**（gstatic / cloudflare 两个 `generate_204` 零字节端点，任一通过即隧道正常），避免出口被 Google 系屏蔽却被误杀
- **菜单栏常驻 + 程序坞图标开关** — 适合挂后台
- **开机自启** — 登录 Mac 后自动启动。注册在系统「登录项 → 允许在后台运行」（这是 macOS 对无 Apple 开发者签名 App 提供的唯一途径，菜单栏常驻 App 的标准位置，`登录时打开` 需正式签名）；登录后静默常驻菜单栏，不弹主窗口。开关关闭时真正停止：卸载 launchd 任务 + 删除描述文件 + 翻转系统「已启用」记录，系统设置里的开关不会残留为开启
- **端口占用一键处理** — 启动时若监听端口被占用，弹窗标明占用进程（名称 + PID），可一键**强制结束占用进程并自动重启**，或取消保持停止
- **启动失败智能提示** — 启动失败弹窗按 2+1 分类直接说清原因：TOKEN 与服务器端不一致 / 服务器连接失败（解析失败、拒绝、超时、握手失败）/ 识别不出再看日志；域名解析失败还能指出是「服务地址」还是「优选IP/域名」填错
- **未保存改动保护** — 只有点过「保存」的服务器才会落盘；有未保存改动时「保存」按钮橙色高亮，启动前会拦截提示先保存，不会带着改了一半的参数跑起来
- **运行日志** — 界面日志 + 落盘文件（`logs/`，可回溯上次崩溃）。日志区展开时恰好显示完整 4 行（滚动到底无残影），底部内边距完整不截断；窗口高度随内容自动贴合

---

## 系统要求

- macOS 13.0+
- Intel 或 Apple Silicon（通用二进制）

---

## 快速开始

### 使用预打包 DMG

1. 打开 `EchOS-mac-<版本>-universal-x64.dmg`
2. 将 `EchOS.app` 拖入 `Applications`
3. 首次运行时**右键 → 打开**（无 Apple 开发者签名，Gatekeeper 会拦截）
4. 首次启动弹出「新建服务器名称」，起名后填好服务器配置 → 点「保存」→ 点「启动代理」

### 配置项

| 字段 | 说明 | 示例 |
|---|---|---|
| 服务地址 | Workers 域名（不含协议头） | `xxx.workers.dev` |
| 服务端口 | 连接端口 | `443` |
| 监听地址 | 本地代理地址 | `127.0.0.1` |
| 监听端口 | SOCKS5 端口，HTTP 自动 +1 | `30000` |
| 优选IP(域名) | Cloudflare 优选 IP，逗号分隔 | `104.16.158.132` |
| ECH域名 | ECH 公钥查询域名 | `cloudflare-ech.com` |
| DOH服务器 | ECH 公钥查询 DNS | `dns.alidns.com/dns-query` |
| TOKEN | 可选，与服务端 Workers 的 `TOKEN` 环境变量一致 | |

> **ECH域名 / DOH服务器 已内置常用选项**：ECH 域名下拉含 `cloudflare-ech.com`、`crypto.cloudflare.com` 等；
> DOH 含阿里 DoH、腾讯国密 DoH、360 DoH、OpenDNS、Quad9 等国内外共 10 个，直接选即可，无需手动去查。
> 感谢 [@CM 大佬](https://t.me/CMLiussss)（优选 IP 方案与其维护的 ProxyIP 同源）整理。

---

## Cloudflare 部署（服务端）

服务端是一个 Cloudflare Worker，仓库根目录的 `Worker-ECH.js` 就是完整代码。仓库已带 `wrangler.toml` 和 `deploy-worker.sh`，两种方式任选：

> <span style="color:red">**⚠️ 必读：Worker「兼容日期」必须设为 26 年之前的任意日期**（26 年 4 月群友反馈：用 26 年内的日期部署后隧道无法使用）。</span>
>
> 设置位置：Worker 项目 → **Settings（设置）→ Running（运行时）→ Compatibility Date（兼容日期）** 改成 `Sep 15, 2025`。
>
> 命令行部署（方式一）已由 `wrangler.toml` 的 `compatibility_date = "2025-09-15"` 自动带上；网页部署（方式二）需手动设置。

### 方式一：命令行一键部署（推荐）

```bash
# 安装 wrangler（需要 Node.js 环境）
npm install -g wrangler

# 首次需要登录 Cloudflare 账号（会打开浏览器）
wrangler login

# 部署；需要鉴权时带上 TOKEN（值自定义，一长串随机字符）
TOKEN=你的密钥 ./deploy-worker.sh
```

`wrangler.toml` 里的 `name` 就是 Worker 名称，部署前可自行修改。

### 方式二：网页 Dashboard 手动部署

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → 选 **Workers**
2. 名称随意，创建后点 **Edit code**，用 `Worker-ECH.js` 的内容覆盖默认代码，保存
3. <span style="color:red">**设置兼容日期**：**Settings（设置）→ Running（运行时）→ Compatibility Date（兼容日期）** 改成 `Sep 15, 2025`（⚠️ 不设则隧道数据不通，现象是「能连上但打不开网站」）</span>
4. 可选：**Settings → Variables and Secrets → Add**，加一个环境变量 `TOKEN`
   - 设了 TOKEN 后，客户端必须填相同的 TOKEN 才能连上
   - 不设 TOKEN 就是全公开，任何人都能拿你的 Worker 当代理，**强烈建议设置**
5. 部署后得到一个 `https://<你的名称>.workers.dev` 地址，填进客户端的「服务地址」

> 无需绑定域名、无需支付。Worker 免费计划每天 10 万请求，个人使用绰绰有余。

---

## 从源码构建（Windows）

需要 **Go 1.22+** 和 **Node.js 18+**（含 npm）。

```powershell
# 1) 下载分流规则数据（geoip.dat / geosite.dat，约 28MB 二进制，不进仓库）
#    已装 Git Bash 可直接运行；或用任意方式下载 Loyalsoldier/v2ray-rules-dat 的 release
bash fetch-geodata.sh

# 2) 一键构建：编译 Go 内核 + 打包 Electron 安装包
.\build.ps1

# 产物：
#   build/x-tunnel.exe                         Go 内核
#   build/installer/EchOS-Win <版本>.exe       免安装便携版
#   build/installer/EchOS-Win Setup <版本>.exe NSIS 安装包
```

> 只想编译内核：`.\build.ps1 -KernelOnly`；依赖已装好、跳过 npm install：`.\build.ps1 -SkipNpm`。
> `fetch-geodata.sh` 下载过之后会跳过；想强制更新最新数据，删掉 `assets/geoip.dat`
> 和 `assets/geosite.dat` 再跑一次即可。
---

## 项目结构

```
EchOS-Win/
├── Worker-ECH.js          # Cloudflare Worker 服务端（完整代码）
├── wrangler.toml          # Worker 配置（名称、入口）
├── deploy-worker.sh       # 一键部署脚本（wrangler CLI）
├── CHANGELOG.md           # 更新日志（发版时自动作为 Release 正文）
├── fetch-geodata.sh       # 下载分流数据 geoip.dat / geosite.dat
├── build.ps1              # Windows 一键构建脚本（内核 + Electron 打包）
├── build.sh               # macOS 构建脚本（gui-macos/ 旧版界面）
├── make-dmg.sh            # macOS DMG 打包脚本
├── core/                  # Go 内核 (x-tunnel)，跨平台
│   ├── x-tunnel.go        # 入口：参数解析、端口监听、隧道调度
│   ├── simple_ws.go       # WebSocket 隧道（简单协议）
│   ├── route_*.go         # 分流规则（geosite / geoip）
│   └── tun_*.go           # TUN 相关（当前平台均未启用）
├── gui/                   # Windows 界面（Electron）
│   ├── main.js            # 主进程：内核生命周期、系统代理、托盘、开机自启
│   ├── preload.js         # 安全桥接
│   ├── renderer/          # 前端页面（HTML/CSS/JS，跟随系统深浅色）
│   └── package.json       # Electron 配置与打包
├── gui-macos/             # 原 macOS 界面（SwiftUI，保留参考）
├── assets/                # 分流数据（构建前下载）、图标源文件
├── screenshot/            # 界面截图（浅色/深色）
└── .github/workflows/
    └── release.yml        # 打标签自动构建 macOS DMG + Windows 安装包并发布
```
---

## 分发说明

- DMG 不含任何用户配置（配置文件在 `~/Library/Application Support/EchOS/config.json`，密码在系统钥匙串）
- 首次启动自动创建一台服务器并弹出「新建服务器名称」命名框；只有点过「保存」的服务器才会写入配置，未保存的服务器退出后自动丢弃
- 没有 Apple Developer ID 签名，对方首次需要**右键 → 打开**绕过 Gatekeeper
- 如要彻底消除 Gatekeeper 弹窗，需购买 Apple Developer Program 并签名
- 发版：推 `v*` 标签自动触发 `.github/workflows/release.yml`，CI 里构建通用二进制、打 DMG 并发布 GitHub Release（正文取 `CHANGELOG.md` 对应版本段落）；不想重复打包时只推目标版本标签即可，中间版本标签保留本地

## 不传 GitHub 的文件

以下内容**不会**出现在 GitHub 仓库里（`.gitignore` 兜底）：

| 内容 | 原因 |
|---|---|
| `build/`（app、DMG 中间产物） | 编译产物，由 Actions 发版时自动生成 |
| 根目录 `EchOS-mac-*.dmg` | 本地 `make-dmg.sh` 打出的成品包，不入库 |
| `assets/geoip.dat`、`assets/geosite.dat` | 24MB 二进制，上游开源数据，构建前用 `fetch-geodata.sh` 下载 |
| `.DS_Store` | macOS 系统文件 |
| `config.json`、`logs/` | 用户配置与日志（在用户目录，运行时生成） |

---

## 版本记录

| 版本 | 内容 |
|---|---|
| 1.2.7 | **窗口高度重构 + 日志显示精确化**：窗口高度改由隐藏探针按内容理想高度统一驱动，新增用户手动拉伸保护（只有真拖过的才保持、内容变化跟着缩回）。**日志区**：展开时恰好显示完整 4 行、滚动到底无第 5 行残影（行距实测 14pt，槽位 4×14=56，内边距移出滚动区）；修复日志底部被窗口截断（探针漏算卡片外层 8pt×2 内边距，补齐后严丝合缝）。**界面**：状态栏云朵图标放大 18→22pt；服务器下拉框宽度只由内容决定、不再整行拉长 |
| 1.2.6 | **掩码显示修复**：服务器地址 / TOKEN 掩码不显示（原画在输入框下层被背景盖住），改为置于输入框之上、用系统语义色，浅色/深色模式均清晰。**App 图标适配 Mac 风格** |
| 1.2.5 | **开机自启动开关修复**：关闭后系统「允许在后台运行」的开关不再残留为开启（launchd 的「已启用」记录用 `launchctl disable` 翻转，重新开启时先 `enable` 再 bootstrap）。**隐私优化**：服务器地址 / TOKEN 输入框掩码（圆点遮挡，聚焦显示）。**WebDAV 备份管理**：可删除远程备份文件、删除已保存的 WebDAV 服务器（含钥匙串密码）。**界面重排**：服务器地址 / TOKEN / 优选域名归入核心配置，新服务器默认优选域名 `cdns.doon.eu.org`。下拉箭头恢复系统默认色 |
| 1.2.4 | **启动「假蓝」修复**：崩溃/强杀后接管标记残留使下次启动图标启动即蓝（本地端口无人监听），初始不再信任残留标记，真正接管成功才变蓝；**残留接管自愈**：启动时检测到异常退出遗留的接管状态自动还原系统代理，避免流量打到无人监听的旧端口 |
| 1.2.3 | 启动新实例前无条件清理旧实例并预留系统清图标时间，消除自动更新期间菜单栏双图标短暂并存 |
| 1.2.2 | **自动更新可靠性修复**：自动更新后重改用**直接执行二进制**启动新实例（原 `open` 在脚本上下文不可靠致新版不启动）；替换前确保旧进程完全退出（超时 `pkill`），避免双菜单栏图标；替换成功后**自动删除下载的 DMG**（失败退回手动时才保留）；退出时记录代理状态，**下次启动（含更新重启）自动恢复代理** |
| 1.2.1 | 分享导入/导出补成功与失败弹窗反馈（原来只写日志）；失败弹窗统一短文案（完整原因保留在运行日志），避免长文本导致弹窗内容布局偏；结果弹窗统一原生 NSAlert 并置于屏幕上部居中；修复 `UNIVERSAL=0 ./build.sh` 重复构建时 Go 报 "already exists" 中断、导致 Swift 从不重新编译的伪修复问题 |
| 1.2.0 | **系统代理接管提速与可靠**：只接管当前默认路由所在的活动网络服务（约 6s→约 1s），默认路由在虚拟接口（VPN）时跳过接管不抢流量；菜单栏图标接管**成功后才变蓝**。<br>**服务器切换修复**：代理运行中切换服务器立即重启换到新服务器生效。<br>**检查更新修复（GitHub 403）**：隧道出口共享 IP 被 GitHub API 限流导致「检查更新报网络错误」，改为**隧道优先、失败自动降级直连重试**，覆盖新版本、分流数据与 DMG 下载 |
| 1.1.14 | 修复「检查更新 / 显示应用」后右上角菜单栏下方的**透明幽灵空窗**（accessory 模式模态弹窗残留累积） |
| 1.1.13 | 分流模式改为 **App 级全局参数**：无论选中哪台服务器都遵从同一个分流模式；切换**立即生效并自动保存**（不要求点「保存」，重启不回退）；升级后各服务器分流模式统一重置为默认「绕过中国大陆」 |
| 1.1.12 | **Worker 兼容日期必须 ≥ `Sep 15, 2025`**，否则隧道「握手通但数据不通」（443 黑洞），客户端加 8 秒无返回自动断开兜底；自检国外站点改 gstatic/cloudflare 两个零字节 204 端点多站点探测，防 Google 系出口被屏蔽时误杀；移除全部悬停提示气泡；更新源由 git remote 自动获取（fork 后自动指向 fork 仓库，不写死） |
| 1.1.11 | 启动失败弹窗 2+1 分类（TOKEN / 服务器连接失败 / 看日志，域名解析失败可指认「服务地址」还是「优选IP/域名」）；端口占用弹窗一键强制结束并自动重启；配置保存模型重构（未保存改动绝不落盘 + 保存按钮高亮 + 启动前拦截）；重命名即时落盘修复；服务端 TOKEN 无论是否设置都校验 |
| 1.1.10 | 自检按钮任何状态可点（未启动预检 / 运行中完整检测）、探针重试间隔优化、自检图标颜色反映真实结果 |
| 1.1.9 | 启动/停止代理不再卡（系统代理接管挪到后台 actor）、修复 start() 假运行状态、隧道探针失败自动还原系统代理、修复自检重复记录 |
| 1.1.8 | DoH / UDP DNS 拨号 IPv4 优先，修复 IPv6 路由不通时 ECH 公钥查询失败 |
| 1.1.7 | 启动提速（端口就绪即接管系统代理）、系统代理备份/还原补上 PAC 自动代理 |
| 1.1.6 | 修复检查更新失败弹窗长文案导致内容左对齐 |
| 1.1.5 | 检查更新弹窗统一原生 NSAlert 居中展示，整理代码 |
| 1.1.4 | 检查更新全流程弹窗内容全部居中（含下载进度面板） |
| 1.1.3 | 检查更新弹窗统一原生 NSAlert（图标与文字居中显示） |
| 1.1.2 | 代理运行中也允许分享 / 备份（导出、导入、本地与 WebDAV 备份还原） |
| 1.1.1 | 更新下载进度面板（可取消）、更新完成后只弹「更新完成」不再弹主窗口 |
| 1.1.0 | 服务器分享、本地/WebDAV 整配置备份 |
| 1.0.1 | 检查更新独立弹窗（不再打开主窗口）、关闭按钮隐藏窗口、导入/分享/备份数据安全、服务器名称长度限制 |
| 1.0.0 | 基础版：多服务器、分流、系统代理、自检、浅色/深色自适应、自动检查更新 |

> v1.1.7 – v1.1.10 未单独发版，随 v1.1.10 一起发布，Release 正文含全部改动。
> v1.1.11 – v1.1.14 单独发版；每次 Release 的改动说明优先取 `CHANGELOG.md` 里对应版本的段落，没写则退回自动生成。

---

## 开源说明

**EchOS-Win 是开源项目**，欢迎贡献与反馈：

- 本项目基于 [MIT 协议](LICENSE) 开源，可自由 Fork、修改、提交 Pull Request
- 使用中发现 Bug 或有功能建议，欢迎在 GitHub 仓库提交 Issue
- **仅供学习交流使用，请勿用于商业用途；请在下载后 24 小时内删除。**
- 请遵守所在地区的法律法规；ECH 是加密传输技术，本身无好坏之分，请勿用于任何非法用途
- `assets/geoip.dat`、`assets/geosite.dat` 为分流规则数据，遵循各自上游开源协议
- 本项目不提供任何可用的公共代理服务器，服务端需自行部署（见上文 Cloudflare 部署）
- 本地一键构建与打包见上文「从源码构建（Windows）」

---

## 致谢与来源说明
本项目由 macOS 版 [EchOS](https://github.com/nerder-real/EchOS/)（Go + SwiftUI）移植而来，
上游源仓库：**https://github.com/nerder-real/EchOS/**，在多位开源作者的工作基础上适配成 Windows 桌面应用（Go + Electron）。


本项目是面向 Windows 的 ECH 加密代理客户端，在多位开源作者的工作基础上适配而来。特别感谢：

- **CCF 大佬**（[@CCF](https://t.me/JPCCF)）—— 客户端开发与整体方案设计，核心能力基于其开源项目 [CF_NAT](https://t.me/CF_NAT) 构建
- **byJoey 大佬** —— 部分实现参考其开源项目 [ech-wk](https://github.com/byJoey/ech-wk)
- **CM 大佬**（[CMLiussss](https://t.me/CMLiussss)）—— 优选 IP 方案参考其维护的 ProxyIP 定制优化

在此基础上定制修改出的 Windows 端专用客户端，让部署到 Cloudflare Workers 后的连接、分流与使用体验更加便捷。

本文涉及的工具与技术方案均来源于：

| 内容 | 来源 |
|---|---|
| 客户端开发 | [CCF](https://t.me/JPCCF) |
| 核心开源项目 | [CF_NAT](https://t.me/CF_NAT) |
| 优选 IP（ProxyIP） | [CMLiussss](https://t.me/CMLiussss) |
| ECH 协议技术 | [Cloudflare 官方文档](https://developers.cloudflare.com/ssl/edge-certificates/ech/) |
| 文档支持 | [Cloudflare-ECH-Workers](https://blog.zrf.me/p/Cloudflare-ECH-Workers) |
