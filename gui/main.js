// EchOS-Win - 主进程
// 负责：内核(x-tunnel.exe)生命周期、系统代理(注册表+WinINET)、开机启动、托盘、更新检查、日志
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, shell, safeStorage } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ======================= 路径与配置 =======================
const APP_VERSION = app.getVersion();
const APP_NAME = 'EchOS-Win';
const isDev = !app.isPackaged;

const configDir = isDev
  ? path.join(app.getPath('appData'), 'EchOS-Win-dev')
  : path.join(app.getPath('appData'), 'EchOS-Win');
const configFile = path.join(configDir, 'config.json');
const logDir = path.join(configDir, 'logs');
const currentLogFile = path.join(logDir, 'current.log');
const previousLogFile = path.join(logDir, 'previous.log');
const kernelPidFile = path.join(configDir, 'kernel.pid');

// 内核位置：优先 exe 同级 resources/（打包后），其次仓库内 build/（开发）
function resolveKernelPath() {
  const candidates = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'x-tunnel.exe'));
  } else {
    candidates.push(path.join(__dirname, '..', 'build', 'x-tunnel.exe'));
    candidates.push(path.join(__dirname, '..', '..', 'build', 'x-tunnel.exe'));
  }
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return candidates[0];
}
const kernelPath = resolveKernelPath();

function resolveGeoPath(name) {
  const candidates = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, name));
  } else {
    candidates.push(path.join(__dirname, '..', 'assets', name));
    candidates.push(path.join(__dirname, '..', '..', 'assets', name));
    candidates.push(path.join(process.resourcesPath, name));
  }
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return null;
}

// ======================= 默认配置 =======================
const DEFAULT_SERVER = {
  id: null, name: '新服务器', server: '', serverPort: 443,
  listen: '127.0.0.1', listenPort: 30000,
  ip: 'cdns.doon.eu.org', ech: 'cloudflare-ech.com',
  dns: 'dns.alidns.com/dns-query', token: '',
  connections: 3, block: '443', ips: '',
  fallback: false, insecure: false, customRules: []
};

const ROUTE_MODES = {
  bypassCN: {
    label: '绕过中国大陆',
    defaultRoute: 'proxy',
    baseRoute: 'proxy,geosite:google;proxy,geosite:geolocation-!cn;direct,geoip:private;direct,geosite:private;direct,geosite:cn;direct,geoip:cn'
  },
  blacklist: {
    label: '黑名单模式',
    defaultRoute: 'direct',
    baseRoute: 'direct,geoip:private;direct,geosite:private;direct,geosite:cn;direct,geoip:cn;proxy,geosite:google;proxy,geosite:geolocation-!cn'
  },
  global: {
    label: '全局模式',
    defaultRoute: 'proxy',
    baseRoute: 'direct,geoip:private;direct,geosite:private'
  }
};

const DEFAULT_CONFIG = {
  servers: [],
  selectedID: null,
  autoSystemProxy: true,
  showDiagnosticLogs: false,
  logLevel: 'info',       // off / error / warning / info / checkOnly
  showDockIcon: false,    // 仅托盘常驻
  routeMode: 'bypassCN',
  logVisible: true,
  autoLaunch: false,
  webdav: null,
  cfApiUrls: [],      // 汇聚节点优选：优选汇聚器列表（如 zrf.zrf.me）
  cfIpList: []        // 汇聚节点优选：手动优选 IP / 域名列表
};

let config = loadConfig();

function loadConfig() {
  let cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  try {
    if (fs.existsSync(configFile)) {
      const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      cfg = Object.assign(cfg, raw);
    }
  } catch (e) {
    logLine(`[配置] 读取配置失败，使用默认值: ${e.message}`);
  }
  if (!cfg.servers || !Array.isArray(cfg.servers)) cfg.servers = [];
  cfg.servers = cfg.servers.map(s => Object.assign({}, DEFAULT_SERVER, s, { id: s.id || genId() }));
  if (!cfg.servers.some(s => s.id === cfg.selectedID)) {
    cfg.selectedID = cfg.servers.length ? cfg.servers[0].id : null;
  }
  return cfg;
}

function saveConfig() {
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    logLine(`[配置] 保存失败: ${e.message}`);
  }
}

function genId() { return crypto.randomUUID(); }

// ======================= 日志 =======================
let logLines = [];           // 最近 3000 行，供界面显示
let logFileHandle = null;

function ensureLogFile() {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    if (!logFileHandle) logFileHandle = fs.createWriteStream(currentLogFile, { flags: 'a', encoding: 'utf8' });
  } catch (e) {}
}

function logLine(text) {
  const t = new Date();
  const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
  const line = `[${ts}] ${text}`;
  // 自检结论走独立通道（对齐 macOS：不进运行日志）
  if (String(text).includes('[自检]')) {
    checkLines.push(line);
    if (checkLines.length > 500) checkLines.splice(0, checkLines.length - 500);
    if (win && !win.isDestroyed()) win.webContents.send('check-line', line);
  }
  logLines.push(line);
  if (logLines.length > 3000) logLines.splice(0, logLines.length - 3000);
  try {
    ensureLogFile();
    logFileHandle.write(line + '\n');
  } catch (e) {}
  // 界面只接收过滤后的行（对齐 macOS：文件留全量，界面按级别/诊断开关过滤）
  if (win && !win.isDestroyed() && kernelLogFilter(line)) {
    win.webContents.send('kernel-log', line);
  }
}

// 日志分级过滤：内核日志级别
function kernelLogFilter(line) {
  // 诊断日志开关：关闭时过滤 DNS-DIAG 等诊断行
  if (!config.showDiagnosticLogs && /\[DNS-DIAG\]|\[诊断\]/i.test(line)) return false;
  const lvl = config.logLevel || 'info';
  if (lvl === 'off') return false;
  if (lvl === 'error') return /失败|错误|error|fatal/i.test(line);
  if (lvl === 'warning') return /失败|错误|error|fatal|warn|警告/i.test(line);
  if (lvl === 'checkOnly') return /自检|check/i.test(line);
  return true; // info
}

// 界面日志分流：来自内核的原始行也进入 logLines，但界面按级别过滤显示
let kernelLogSink = null; // (line) => void，由 renderer 订阅

// ======================= 内核进程管理 =======================
let kernelProc = null;
let isStarting = false;
// 状态灯 / 自检状态（对齐 macOS 版）
let proxyActive = false;            // 系统代理是否已接管
let statusText = '已停止';
let checkState = { phase: 'idle', detail: '' };  // idle / running / ok / failed
let checking = false;
let checkLines = [];

function refreshStatusText() {
  if (!isKernelRunning()) {
    statusText = isStarting ? '启动中…' : '已停止';
  } else {
    const server = selectedServer();
    let t = '运行中';
    if (server) t += ` · 本地端口 ${server.listenPort}`;
    t += proxyActive ? ' · 已接管系统代理' : ' · 未接管系统代理';
    statusText = t;
  }
  broadcastState();
}

function normalizeDoH(raw) {
  let s = String(raw || '').trim();
  if (!s) return s;
  const lower = s.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return s;
  if (lower.startsWith('udp://')) return s.slice(6);
  if (s.includes('/')) return 'https://' + s;
  return s;
}

function cleanHost(raw) {
  let t = String(raw || '').trim();
  for (const sch of ['wss://', 'ws://', 'https://', 'http://', 'socks5://']) {
    if (t.toLowerCase().startsWith(sch)) t = t.slice(sch.length);
  }
  const slash = t.indexOf('/');
  if (slash >= 0) t = t.slice(0, slash);
  const colon = t.lastIndexOf(':');
  if (colon >= 0 && /^\d+$/.test(t.slice(colon + 1).trim())) t = t.slice(0, colon);
  return t.trim();
}

function buildKernelArgs(server, mode) {
  const args = [];
  const add = (flag, value) => {
    const v = String(value == null ? '' : value).trim();
    if (v) args.push(flag, v);
  };
  const host = cleanHost(server.server);
  const listenHost = cleanHost(server.listen) || '127.0.0.1';

  add('-f', `wss://${host}:${server.serverPort}`);
  add('-l', `socks5://${listenHost}:${server.listenPort},http://${listenHost}:${server.listenPort + 1}`);

  // 分流规则：自定义规则(server.customRules) 优先
  const m = ROUTE_MODES[mode] || ROUTE_MODES.bypassCN;
  const custom = (server.customRules || [])
    .map(r => { const c = String(r.condition || '').trim(); return c ? `${r.action},${c}` : ''; })
    .filter(Boolean)
    .join(';');
  const route = custom ? custom + ';' + m.baseRoute : m.baseRoute;
  args.push('-default', m.defaultRoute, '-route', route);

  const geoip = resolveGeoPath('geoip.dat');
  const geosite = resolveGeoPath('geosite.dat');
  if (geoip) add('-geoip', geoip);
  if (geosite) add('-geosite', geosite);

  add('-token', server.token);
  add('-ip', server.ip);

  if (server.fallback) {
    args.push('-fallback');
  } else {
    add('-dns', normalizeDoH(server.dns));
    add('-ech', server.ech);
  }
  if (server.connections && Number(server.connections) !== 3) args.push('-n', String(server.connections));
  if (server.insecure) args.push('-insecure');
  add('-block', server.block);
  add('-ips', server.ips);
  return args;
}

function selectedServer() {
  return config.servers.find(s => s.id === config.selectedID) || null;
}

let pendingPortDecision = null;

async function startKernel() {
  if (kernelProc || isStarting) return { ok: false, error: '代理已在运行或正在启动' };
  const server = selectedServer();
  if (!server) return { ok: false, error: '请先添加并选择一台服务器' };
  if (!cleanHost(server.server)) return { ok: false, error: '服务地址为空，请检查服务器配置' };
  if (!fs.existsSync(kernelPath)) return { ok: false, error: `找不到内核程序 ${kernelPath}` };

  // 清理上次残留内核进程
  killLeftoverKernel();

  // 端口占用检查：被占用则询问用户（强制结束占用进程 / 自动换端口 / 取消）
  if (!(await isPortFree(server.listenPort))) {
    const occ = await findPortOccupant(server.listenPort);
    const label = occ ? `${occ.name}(PID ${occ.pid})` : '未知进程';
    logLine(`[系统] 监听端口 ${server.listenPort} 被 ${label} 占用`);
    const decision = await new Promise(resolve => {
      pendingPortDecision = resolve;
      if (win && !win.isDestroyed()) {
        win.webContents.send('port-conflict', { port: server.listenPort, occupant: occ, label });
      } else {
        resolve({ action: 'kill', pid: occ ? occ.pid : null });
      }
    });
    pendingPortDecision = null;
    if (!decision || decision.action === 'cancel') return { ok: false, error: '已取消启动（端口被占用）' };
    if (decision.action === 'kill' && decision.pid) {
      const killed = await killProcess(decision.pid);
      if (!killed) return { ok: false, error: `无法结束进程 ${decision.pid}` };
      logLine(`[系统] 已结束占用进程 ${label}`);
      await new Promise(r => setTimeout(r, 500));
    } else if (decision.action === 'change') {
      const pair = await pickFreePortPair(server.listenPort);
      server.listenPort = pair.socks;
      const idx = config.servers.findIndex(s => s.id === server.id);
      if (idx >= 0) { config.servers[idx].listenPort = pair.socks; saveConfig(); }
      logLine(`[系统] 已自动切换监听端口为 ${pair.socks}（HTTP ${pair.http}）`);
    }
  }

  isStarting = true;
  refreshStatusText();
  const args = buildKernelArgs(server, config.routeMode);
  logLine(`[系统] 启动内核: ${path.basename(kernelPath)} ${args.join(' ')}`);

  kernelProc = spawn(kernelPath, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  kernelProc.stdout.on('data', d => onKernelOutput(d.toString()));
  kernelProc.stderr.on('data', d => onKernelOutput(d.toString()));
  kernelProc.on('error', (err) => {
    logLine(`[系统] 启动内核失败: ${err.message}`);
    isStarting = false;
    kernelProc = null;
    broadcastState();
  });
  kernelProc.on('exit', (code, signal) => {
    const wasRunning = kernelProc != null;
    kernelProc = null;
    isStarting = false;
    logLine(`[系统] 内核已退出（退出码 ${code}${signal ? ', ' + signal : ''}）`);
    if (wasRunning) {
      // 非主动停止：若接管了系统代理则还原
      if (config.autoSystemProxy) setSystemProxyEnabled(false, null, true);
    }
    broadcastState();
  });

  // 记录 PID 以便崩溃后清理
  setTimeout(() => {
    if (kernelProc && kernelProc.pid) {
      try { fs.writeFileSync(kernelPidFile, String(kernelProc.pid), 'utf8'); } catch (e) {}
    }
  }, 500);

  // 等待本地端口就绪后再接管系统代理（与 macOS 版一致：端口就绪≈隧道已通）
  waitPortReady(server.listenPort).then(ok => {
    if (!ok || !kernelProc) {
      const hint = serverFailureHint();
      logLine('[系统] 本地代理端口未就绪，内核可能启动失败' + (hint ? `：${hint}` : ''));
      isStarting = false;
      broadcastState();
      if (hint && win && !win.isDestroyed()) win.webContents.send('start-failed', { hint });
      return;
    }
    isStarting = false;
    if (config.autoSystemProxy) {
      const r = setSystemProxyEnabled(true, server.listenPort + 1, false);
      if (!r.ok) logLine(`[系统] 接管系统代理失败: ${r.error}`);
    }
    logLine('[系统] 内核已就绪，本地代理运行中');
    refreshStatusText();
    broadcastState();
    // 启动完成后自动静默自检一次（对齐 macOS：状态灯反映真实结果）
    setTimeout(() => runSelfCheck(true), 1500);
  });

  broadcastState();
  return { ok: true };
}

function stopKernel() {
  if (config.autoSystemProxy) setSystemProxyEnabled(false, null, true);
  if (kernelProc) {
    const p = kernelProc;
    kernelProc = null;
    isStarting = false;
    try { p.kill(); } catch (e) {}
  }
  try { if (fs.existsSync(kernelPidFile)) fs.unlinkSync(kernelPidFile); } catch (e) {}
  checkState = { phase: 'idle', detail: '' };
  refreshStatusText();
  broadcastState();
  return { ok: true };
}

function isKernelRunning() { return !!(kernelProc && !kernelProc.killed); }

// 等待 TCP 端口可连接（内核监听成功）
function waitPortReady(port, timeoutMs = 15000) {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (!kernelProc) return resolve(false);
      const sock = require('net').connect(port, '127.0.0.1');
      sock.setTimeout(800);
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('timeout', () => { sock.destroy(); if (Date.now() > deadline) resolve(false); else setTimeout(check, 500); });
      sock.once('error', () => { sock.destroy(); if (Date.now() > deadline) resolve(false); else setTimeout(check, 500); });
    };
    check();
  });
}

// 清理上次崩溃残留的 x-tunnel.exe（按 PID 文件 + 校验可执行路径）
function killLeftoverKernel() {
  try {
    if (!fs.existsSync(kernelPidFile)) return;
    const pid = parseInt(fs.readFileSync(kernelPidFile, 'utf8').trim(), 10);
    if (!pid || pid <= 0) return;
    // 校验该 PID 的可执行文件路径确实是我们的内核
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.Path -eq '${kernelPath.replace(/'/g, "''")}') { Stop-Process -Id ${pid} -Force }`
    ], { windowsHide: true }, () => {});
  } catch (e) {}
}

// 内核输出 → 日志（写入文件 + 通知界面）
function onKernelOutput(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    logLine(line);
  }
}

// ======================= 系统代理（Windows） =======================
const INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
let proxyBackup = null; // { ProxyEnable, ProxyServer, ProxyOverride, AutoConfigURL }

function regQuery(key, name) {
  return new Promise(resolve => {
    execFile('reg.exe', ['query', key, '/v', name], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const m = stdout.match(/REG_(?:DWORD|SZ|EXPAND_SZ)\s+(.+)/i);
      resolve(m ? m[1].trim() : null);
    });
  });
}

function regSet(key, name, type, value) {
  return new Promise(resolve => {
    execFile('reg.exe', ['add', key, '/v', name, '/t', type, '/d', value, '/f'], { windowsHide: true }, (err) => {
      resolve(!err);
    });
  });
}

function regDelete(key, name) {
  return new Promise(resolve => {
    execFile('reg.exe', ['delete', key, '/v', name, '/f'], { windowsHide: true }, () => resolve(true));
  });
}

// 广播 WinINET 设置变更，让系统立即生效
function refreshWinInet() {
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinInetHelper {
  [DllImport("wininet.dll", SetLastError=true)]
  public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
}
"@
[WinInetHelper]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
[WinInetHelper]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null`;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, () => {});
}

function setSystemProxyEnabled(enabled, httpPort, silent) {
  if (enabled) {
    // 先备份当前设置（仅备份一次）
    return (async () => {
      if (!proxyBackup) {
        const [pe, ps, po, acu] = await Promise.all([
          regQuery(INTERNET_SETTINGS, 'ProxyEnable'),
          regQuery(INTERNET_SETTINGS, 'ProxyServer'),
          regQuery(INTERNET_SETTINGS, 'ProxyOverride'),
          regQuery(INTERNET_SETTINGS, 'AutoConfigURL')
        ]);
        proxyBackup = { ProxyEnable: pe, ProxyServer: ps, ProxyOverride: po, AutoConfigURL: acu };
        logLine('[系统] 已备份原始系统代理设置');
      }
      const ok1 = await regSet(INTERNET_SETTINGS, 'ProxyEnable', 'REG_DWORD', '1');
      const ok2 = await regSet(INTERNET_SETTINGS, 'ProxyServer', 'REG_SZ', `127.0.0.1:${httpPort}`);
      const ok3 = await regSet(INTERNET_SETTINGS, 'ProxyOverride', 'REG_SZ', '<local>');
      refreshWinInet();
      proxyActive = true;
      refreshStatusText();
      logLine(`[系统] 已接管系统代理: HTTP 127.0.0.1:${httpPort}`);
      broadcastState();
      return { ok: ok1 && ok2 && ok3 };
    })();
  } else {
    return (async () => {
      await regSet(INTERNET_SETTINGS, 'ProxyEnable', 'REG_DWORD', '0');
      if (proxyBackup) {
        const b = proxyBackup;
        // 还原用户原来的设置（含 PAC）
        if (b.ProxyServer) await regSet(INTERNET_SETTINGS, 'ProxyServer', 'REG_SZ', b.ProxyServer);
        else await regDelete(INTERNET_SETTINGS, 'ProxyServer');
        if (b.ProxyOverride) await regSet(INTERNET_SETTINGS, 'ProxyOverride', 'REG_SZ', b.ProxyOverride);
        else await regDelete(INTERNET_SETTINGS, 'ProxyOverride');
        if (b.ProxyEnable === '1') await regSet(INTERNET_SETTINGS, 'ProxyEnable', 'REG_DWORD', '1');
        if (b.AutoConfigURL) await regSet(INTERNET_SETTINGS, 'AutoConfigURL', 'REG_SZ', b.AutoConfigURL);
        else await regDelete(INTERNET_SETTINGS, 'AutoConfigURL');
        proxyBackup = null;
        logLine('[系统] 已还原原始系统代理设置');
      } else {
        logLine('[系统] 已关闭系统代理（无备份可还原）');
      }
      proxyActive = false;
      refreshStatusText();
      refreshWinInet();
      broadcastState();
      return { ok: true };
    })();
  }
}

// 读取当前系统代理摘要（界面展示）
function systemProxySummary() {
  return (async () => {
    const [pe, ps] = await Promise.all([
      regQuery(INTERNET_SETTINGS, 'ProxyEnable'),
      regQuery(INTERNET_SETTINGS, 'ProxyServer')
    ]);
    if (pe === '0x1' || pe === '1') return ps ? `已启用 HTTP ${ps}` : '已启用';
    return '未启用';
  })();
}

// ======================= 开机启动 =======================
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

async function getAutoLaunch() {
  const v = await regQuery(RUN_KEY, 'EchOS-Win');
  return !!v;
}

async function setAutoLaunch(enabled) {
  if (enabled) {
    const exe = isDev ? process.execPath : process.execPath;
    const ok = await regSet(RUN_KEY, 'EchOS-Win', 'REG_SZ', `"${exe}"`);
    if (ok) { config.autoLaunch = true; saveConfig(); logLine('[系统] 已开启开机自启'); }
    return { ok, error: ok ? '' : '设置开机自启失败' };
  } else {
    await regDelete(RUN_KEY, 'EchOS-Win');
    config.autoLaunch = false;
    saveConfig();
    logLine('[系统] 已关闭开机自启');
    return { ok: true };
  }
}

// ======================= 自检（SOCKS5 + TLS 隧道） =======================
// 与 macOS 版一致：通过本地 SOCKS5 代理建立 CONNECT 隧道后再走 TLS，
// 用 HEAD 请求探测 HTTPS 端点（generate_204 等），避免明文 HTTP 访问 HTTPS 站点。
const net = require('net');
const tls = require('tls');

function socks5Handshake(sock, host, port) {
  return new Promise((resolve, reject) => {
    let stage = 0; // 0=greet, 1=connect
    sock.once('data', function onData(d) {
      if (stage === 0) {
        stage = 1;
        if (d.length < 2 || d[1] === 0xff) return reject(new Error('SOCKS5 无可用认证方式（代理需要认证）'));
        const hostBuf = Buffer.from(host, 'utf8');
        const portBuf = Buffer.from([port >> 8, port & 0xff]);
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf, portBuf
        ]);
        sock.write(req);
        sock.once('data', onData);
        return;
      }
      if (d.length < 2 || d[1] !== 0x00) {
        return reject(new Error('SOCKS5 CONNECT 失败（code=' + (d[1] || '?') + '）'));
      }
      resolve();
    });
    sock.write(Buffer.from([0x05, 0x01, 0x00])); // 版本5，1种方法，无认证
  });
}

function probeHttpsViaSocks(socksPort, host, path, timeoutMs) {
  return new Promise(resolve => {
    const sock = net.connect({ host: '127.0.0.1', port: socksPort });
    let done = false;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (e) {}
      resolve({ ok, detail });
    };
    sock.setTimeout(timeoutMs);
    sock.on('timeout', () => finish(false, '连接超时'));
    sock.on('error', e => finish(false, e.message));
    sock.on('connect', () => {
      socks5Handshake(sock, host, 443).then(() => {
        const tlsSock = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false });
        tlsSock.on('error', e => finish(false, 'TLS: ' + e.message));
        tlsSock.on('secureConnect', () => {
          tlsSock.write(`HEAD ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
          let buf = '';
          tlsSock.on('data', d => {
            buf += d.toString('latin1');
            const idx = buf.indexOf('\r\n\r\n');
            if (idx >= 0) {
              const m = buf.slice(0, idx).match(/^HTTP\/1\.[01]\s+(\d+)/);
              const code = m ? parseInt(m[1], 10) : 0;
              finish(code > 0, 'HTTP ' + code);
            }
          });
          tlsSock.on('close', () => finish(false, '连接被关闭'));
        });
      }).catch(e => finish(false, e.message));
    });
  });
}

// TCP 直连探测（预检用）
function tcpProbe(host, port, timeoutMs) {
  return new Promise(resolve => {
    const net = require('net');
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.on('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

// TCP 延迟探测（自选节点测速）
function probeLatency(host, port, timeoutMs = 5000) {
  return new Promise(resolve => {
    const net = require('net');
    const start = Date.now();
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => { sock.destroy(); resolve({ ok: false, latency: -1 }); }, timeoutMs);
    sock.on('connect', () => {
      clearTimeout(timer);
      sock.destroy();
      resolve({ ok: true, latency: Date.now() - start });
    });
    sock.on('error', () => { clearTimeout(timer); resolve({ ok: false, latency: -1 }); });
  });
}

// 代理未运行时预检：服务端（或优选 IP）+ DoH 可达性
async function runPreflight(server) {
  const dialHost = String(server.ip || '').split(',')[0].trim() || cleanHost(server.server);
  const failures = [];
  const ok1 = await tcpProbe(dialHost, server.serverPort, 4000);
  if (ok1) return { ok: true, detail: `服务端 ${dialHost}:${server.serverPort} 可达` };
  failures.push(`服务端 ${dialHost}:${server.serverPort} 不可达`);
  const dns = normalizeDoH(server.dns || '');
  let dohHost = '';
  if (/^https?:\/\//i.test(dns)) { try { dohHost = new URL(dns).host; } catch (e) {} }
  if (dohHost) {
    const ok2 = await tcpProbe(dohHost, 443, 4000);
    if (ok2) return { ok: true, detail: `DoH ${dohHost}:443 可达（服务端不可达）` };
    failures.push(`DoH ${dohHost}:443 不可达`);
  }
  return { ok: false, error: failures.join('；') };
}

// 自检统一入口（对齐 macOS runSelfCheck）
// silent: 静默模式只更新状态灯，不写日志
async function runSelfCheck(silent = false) {
  if (checking) return { ok: false, error: '正在自检中' };
  checking = true;
  checkState = { phase: 'running', detail: '' };
  broadcastState();
  if (!silent) logLine('[自检] 开始检测…');

  const server = selectedServer();
  if (!server) {
    checking = false;
    checkState = { phase: 'idle', detail: '' };
    if (!silent) logLine('[自检] 请先添加并选中服务器');
    broadcastState();
    return { ok: false, error: '请先添加并选中服务器' };
  }

  // 至少让"检测中"显示 800ms，灯一闪而过等于没有反馈
  const minShow = new Promise(r => setTimeout(r, 800));
  const result = isKernelRunning() ? await selfCheck(server.listenPort) : await runPreflight(server);
  await minShow;

  checking = false;
  checkState = result.ok ? { phase: 'ok', detail: result.detail } : { phase: 'failed', detail: result.error };
  if (!silent) logLine(result.ok ? `[自检] 通过: ${result.detail}` : `[自检] 失败: ${result.error}`);
  broadcastState();
  return result;
}

function selfCheck(port, timeoutMs = 10000) {
  const sites = [
    { host: 'www.gstatic.com', path: '/generate_204' },
    { host: 'cp.cloudflare.com', path: '/' }
  ];
  // 多站点 + 失败重试（间隔 1s、3s），避免一次网络抖动误判
  return (async () => {
    const failures = [];
    let lastDetail = '';
    const attempts = [0, 1, 3];
    for (const gap of attempts) {
      if (gap > 0) await new Promise(r => setTimeout(r, gap * 1000));
      for (const s of sites) {
        const r = await probeHttpsViaSocks(port, s.host, s.path, timeoutMs / 2);
        if (r.ok) return { ok: true, detail: `${s.host} · ${r.detail}` };
        failures.push(`${s.host}：${r.detail}`);
        lastDetail = r.detail;
      }
    }
    return { ok: false, error: `所有测试站点均未通过代理连通（${failures.join('；')}）` };
  })();
}

// ======================= 更新检查 =======================
function getUpdateRepo() {
  // 优先环境变量，其次 package.json repository
  if (process.env.ECH_UPDATE_REPO) return process.env.ECH_UPDATE_REPO;
  try {
    const pkg = require('./package.json');
    const repo = typeof pkg.repository === 'string'
      ? pkg.repository
      : (pkg.repository && (pkg.repository.url || ''));
    if (repo) {
      return String(repo).replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    }
  } catch (e) {}
  return null;
}

function checkUpdates() {
  return new Promise(resolve => {
    const repo = getUpdateRepo();
    if (!repo) return resolve({ ok: false, error: '未配置更新源仓库（ECH_UPDATE_REPO）', skip: true });
    const req = https.get(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'User-Agent': 'EchOS-Win', Accept: 'application/vnd.github+json' },
      timeout: 10000
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          if (res.statusCode === 403) return resolve({ ok: false, error: 'GitHub API 限流(403)，稍后再试' });
          if (res.statusCode !== 200) return resolve({ ok: false, error: `GitHub API 返回 ${res.statusCode}` });
          const data = JSON.parse(body);
          const latest = String(data.tag_name || '').replace(/^v/, '');
          const cur = APP_VERSION.replace(/^v/, '');
          const isNewer = compareVersions(latest, cur) > 0;
          resolve({
            ok: true,
            latest,
            current: cur,
            hasUpdate: isNewer,
            url: data.html_url || '',
            notes: (data.body || '').slice(0, 2000)
          });
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '请求超时' }); });
    req.on('error', e => resolve({ ok: false, error: e.message }));
  });
}

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// ======================= 服务器导入导出 =======================
function sanitizeServer(raw) {
  const s = Object.assign({}, DEFAULT_SERVER, raw);
  s.id = s.id || genId();
  return s;
}

// 导入：只接收参数完整的服务器，重名自动改名
// ======================= 汇聚节点优选（优选 IP/域名 + 优选汇聚器） =======================
function base64DecodeSafe(s) {
  try {
    const b = Buffer.from(String(s).replace(/\s+/g, ''), 'base64');
    const t = b.toString('utf8');
    if (t.includes('\uFFFD')) return null;
    return t;
  } catch (e) { return null; }
}
function importServers(list) {
  if (!Array.isArray(list)) return { ok: false, error: '导入数据格式错误' };
  let added = 0;
  for (const raw of list) {
    const s = sanitizeServer(raw);
    if (!cleanHost(s.server) || !(s.serverPort > 0)) continue;
    // 重名处理：服务地址+端口相同则跳过（防重复）
    const dup = config.servers.some(x => cleanHost(x.server) === cleanHost(s.server) && x.serverPort === s.serverPort);
    if (dup) continue;
    // 重名自动加序号
    let name = s.name || '导入服务器';
    const taken = new Set(config.servers.map(x => x.name));
    let base = name, n = 1;
    while (taken.has(name)) name = `${base} ${String(n++).padStart(2, '0')}`;
    s.name = name;
    config.servers.push(s);
    added++;
  }
  if (!config.selectedID) config.selectedID = config.servers.length ? config.servers[0].id : null;
  saveConfig();
  broadcastState();
  return { ok: true, added };
}

// ======================= 端口占用处理 =======================
function isPortFree(port) {
  return new Promise(resolve => {
    const net = require('net');
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

// 查询监听某端口的进程（netstat + tasklist）
function findPortOccupant(port) {
  return new Promise(resolve => {
    execFile('netstat.exe', ['-ano', '-p', 'tcp'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      let pid = null;
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = line.match(/TCP\s+(\S+):(\d+)\s+\S+:\S+\s+LISTENING\s+(\d+)/i);
        if (m && parseInt(m[2], 10) === port) { pid = parseInt(m[3], 10); break; }
      }
      if (!pid) return resolve(null);
      execFile('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (e2, out2) => {
        let name = '未知进程';
        if (!e2 && out2) { const mm = String(out2).match(/"([^"]+)"/); if (mm) name = mm[1]; }
        resolve({ pid, name });
      });
    });
  });
}

// 强制结束进程（用户明确确认过才调用）
function killProcess(pid) {
  return new Promise(resolve => {
    execFile('taskkill.exe', ['/F', '/PID', String(pid)], { windowsHide: true }, err => resolve(!err));
  });
}

// 自动挑选连续两个空闲端口（SOCKS5 + HTTP）
function pickFreePortPair(start = 30000, limit = 200) {
  return (async () => {
    const end = Math.min(start + limit, 65534);
    for (let p = start; p < end; p += 2) {
      if (await isPortFree(p) && await isPortFree(p + 1)) return { socks: p, http: p + 1 };
    }
    return { socks: start, http: start + 1 };
  })();
}

// ======================= 启动失败智能提示 =======================
function serverFailureHint() {
  const hints = logLines.slice(-30).join('\n');
  const lower = hints.toLowerCase();
  if (/认证失败|token\s*不匹配|unauthorized|401/.test(lower)) return 'TOKEN 与服务器端不一致';
  if (/no such host|lookup|找不到主机/.test(lower)) {
    const m = hints.match(/\(IP:[^)]*\)/);
    if (m) {
      return m[0].includes('自动解析')
        ? '服务地址解析失败，请检查「服务地址」'
        : '优选IP/域名解析失败，请检查「优选IP/域名」';
    }
    return '服务器连接失败';
  }
  if (/connection refused|i\/o timeout|deadline exceeded|timed out|bad handshake|handshake failure|reset by peer/.test(lower)) {
    return '服务器连接失败';
  }
  return null;
}

// ======================= WebDAV / 配置备份 =======================
const WEBDAV_FILE = 'EchOS-config.json';
const WEBDAV_DIR = 'EchOS_Backup';

// 密码用系统安全存储（DPAPI）加密后落盘
function encryptSecret(plain) {
  if (!plain) return '';
  try { return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(plain).toString('base64') : plain; } catch (e) { return plain; }
}
function decryptSecret(stored) {
  if (!stored) return '';
  if (stored.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')); } catch (e) { return ''; }
  }
  return stored;
}

// 归一化成可 PUT/GET/DELETE 的 WebDAV 文件 URL
function webdavEndpoint(raw, directory) {
  let s = String(raw || '').trim();
  if (!/^https?:\/\//i.test(s)) return null;
  if (/\.json$/i.test(s)) return s.replace(/\/+$/, '');
  const dir = String(directory || '').trim();
  return s.replace(/\/+$/, '') + '/' + (dir || WEBDAV_DIR) + '/' + WEBDAV_FILE;
}

function webdavRequest(method, url, username, password, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('WebDAV 地址无效')); }
    const lib = u.protocol === 'https:' ? https : http;
    const headers = { Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') };
    if (body) headers['Content-Type'] = 'application/json';
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method, headers, timeout: timeoutMs || 15000
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function backupData() { return JSON.stringify(config, null, 2); }

async function backupToWebDAV() {
  const w = config.webdav;
  if (!w || !w.url) return { ok: false, error: '请先填写 WebDAV 地址' };
  const url = webdavEndpoint(w.url, w.directory);
  if (!url) return { ok: false, error: 'WebDAV 地址无效' };
  const password = decryptSecret(w.passwordEnc || w.password || '');
  if (!password) return { ok: false, error: '请先设置 WebDAV 密码' };
  try {
    const r = await webdavRequest('PUT', url, w.username, password, backupData());
    if (r.status < 200 || r.status >= 300) return { ok: false, error: `WebDAV 返回 ${r.status}` };
    logLine(`[系统] 已备份到 WebDAV（${config.servers.length} 个服务器）`);
    return { ok: true, detail: '已备份到 WebDAV' };
  } catch (e) {
    logLine(`[系统] WebDAV 备份失败: ${e.message}`);
    return { ok: false, error: `WebDAV 备份失败：${e.message}` };
  }
}

async function restoreFromWebDAV() {
  const w = config.webdav;
  if (!w || !w.url) return { ok: false, error: '请先填写 WebDAV 地址' };
  const url = webdavEndpoint(w.url, w.directory);
  if (!url) return { ok: false, error: 'WebDAV 地址无效' };
  const password = decryptSecret(w.passwordEnc || w.password || '');
  if (!password) return { ok: false, error: '请先设置 WebDAV 密码' };
  try {
    const r = await webdavRequest('GET', url, w.username, password);
    if (r.status < 200 || r.status >= 300) return { ok: false, error: `WebDAV 返回 ${r.status}` };
    const data = JSON.parse(r.data);
    if (!data || !Array.isArray(data.servers)) return { ok: false, error: '备份文件不是有效的配置备份' };
    config = Object.assign({}, DEFAULT_CONFIG, data);
    config.servers = (config.servers || []).map(s => Object.assign({}, DEFAULT_SERVER, s, { id: s.id || genId() }));
    if (!config.servers.some(s => s.id === config.selectedID)) config.selectedID = config.servers.length ? config.servers[0].id : null;
    saveConfig(); broadcastState();
    logLine(`[系统] 已从 WebDAV 还原配置（${config.servers.length} 个服务器）`);
    return { ok: true, detail: '已从 WebDAV 还原配置' };
  } catch (e) {
    return { ok: false, error: `WebDAV 还原失败：${e.message}` };
  }
}

async function deleteWebDAVBackup() {
  const w = config.webdav;
  if (!w || !w.url) return { ok: false, error: '请先填写 WebDAV 地址' };
  const url = webdavEndpoint(w.url, w.directory);
  if (!url) return { ok: false, error: 'WebDAV 地址无效' };
  const password = decryptSecret(w.passwordEnc || w.password || '');
  if (!password) return { ok: false, error: '请先设置 WebDAV 密码' };
  try {
    const r = await webdavRequest('DELETE', url, w.username, password);
    if (r.status === 404) return { ok: true, detail: '远程备份不存在（视为已删除）' };
    if (r.status < 200 || r.status >= 300) return { ok: false, error: `WebDAV 返回 ${r.status}` };
    logLine('[系统] 已删除 WebDAV 远程备份');
    return { ok: true, detail: '已删除远程备份' };
  } catch (e) {
    return { ok: false, error: `删除失败：${e.message}` };
  }
}

function saveWebDAV(raw) {
  const prevEnc = (config.webdav && config.webdav.passwordEnc) || '';
  config.webdav = {
    url: String(raw.url || '').trim(),
    username: String(raw.username || '').trim(),
    directory: String(raw.directory || '').trim(),
    passwordEnc: raw.password ? encryptSecret(String(raw.password)) : prevEnc
  };
  saveConfig(); broadcastState();
  return { ok: true };
}

function removeWebDAV() {
  config.webdav = null;
  saveConfig(); broadcastState();
  return { ok: true };
}
// ======================= 窗口 & 托盘 =======================
let win = null;
let tray = null;
let isQuitting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 780,
    minWidth: 700,
    minHeight: 620,
    title: 'EchOS-Win',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (e) => {
    // 关闭窗口 = 隐藏到托盘，代理继续跑（与 macOS 版一致）
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

function createTray() {
  try {
    let iconPath = path.join(__dirname, 'assets', 'icon.png');
    if (!fs.existsSync(iconPath)) iconPath = path.join(__dirname, 'assets', 'icon.ico');
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('EchOS-Win');
    rebuildTrayMenu();
    tray.on('click', () => showWindow());
  } catch (e) {
    console.error('createTray failed', e);
  }
}

function restartKernel() {
  stopKernel();
  setTimeout(() => startKernel(), 300);
}

function rebuildTrayMenu() {
  if (!tray) return;
  const running = isKernelRunning();
  const ready = proxyActive;
  const menu = Menu.buildFromTemplate([
    {
      label: (ready ? '● ' : '○ ') + (ready ? '系统代理已接管' : (running ? '代理运行中，系统代理未接管' : 'ECH 代理未运行')),
      enabled: false
    },
    { type: 'separator' },
    { label: running ? '关闭 ECH 代理' : '开启 ECH 代理', click: () => { running ? stopKernel() : startKernel(); } },
    {
      label: '选择服务器',
      submenu: config.servers.map(sv => ({
        label: sv.name || '未命名',
        type: 'radio',
        checked: sv.id === config.selectedID,
        click: () => {
          config.selectedID = sv.id;
          saveConfig(); broadcastState();
          if (running) restartKernel();
        }
      }))
    },
    { type: 'separator' },
    {
      label: '检查更新…',
      click: () => {
        checkUpdates().then(r => {
          if (win && !win.isDestroyed() && r.ok && r.hasUpdate) win.webContents.send('update-available', r);
          else if (win && !win.isDestroyed() && r.ok) win.webContents.send('toast-msg', { msg: '已是最新版本 v' + r.current });
        }).catch(() => {});
      }
    },
    { label: '显示应用', click: () => showWindow() },
    { type: 'separator' },
    { label: '退出应用', click: () => { quitApp(); } }
  ]);
  tray.setContextMenu(menu);
}

function showWindow() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quitApp() {
  isQuitting = true;
  stopKernel();
  app.quit();
}

// 状态广播给渲染进程
function broadcastState() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('state', getPublicState());
  }
}

function getPublicState() {
  const server = selectedServer();
  return {
    version: APP_VERSION,
    running: isKernelRunning(),
    starting: isStarting,
    statusText: statusText,
    statusExtra: (() => {
      if (!isKernelRunning()) return '';
      const server = selectedServer();
      let t = '';
      if (server) t += ` · 本地端口 ${server.listenPort}`;
      t += proxyActive ? ' · 已接管系统代理' : ' · 未接管系统代理';
      return t;
    })(),
    checkState: checkState,
    checking: checking,
    checkLines: checkLines.slice(-300),
    servers: config.servers,
    selectedID: config.selectedID,
    server: server ? {
      id: server.id, name: server.name, server: server.server, serverPort: server.serverPort,
      listen: server.listen, listenPort: server.listenPort, ip: server.ip, ech: server.ech,
      dns: server.dns, token: server.token, connections: server.connections, block: server.block,
      ips: server.ips, fallback: server.fallback, insecure: server.insecure,
      customRules: server.customRules || []
    } : null,
    routeMode: config.routeMode,
    autoSystemProxy: config.autoSystemProxy,
    logLevel: config.logLevel,
    logVisible: config.logVisible,
    autoLaunch: config.autoLaunch,
    showDiagnosticLogs: config.showDiagnosticLogs,
    cfApiUrls: config.cfApiUrls || [],
    cfIpList: config.cfIpList || [],
    webdav: config.webdav ? { url: config.webdav.url, username: config.webdav.username, directory: config.webdav.directory, hasPassword: !!(config.webdav.passwordEnc || config.webdav.password) } : null,
    kernelExists: fs.existsSync(kernelPath),
    kernelPath: kernelPath,
    geoipExists: !!resolveGeoPath('geoip.dat'),
    geositeExists: !!resolveGeoPath('geosite.dat'),
    logs: logLines.slice(-500),
    isDev
  };
}

// ======================= IPC =======================
ipcMain.handle('get-state', () => getPublicState());

ipcMain.handle('start', () => startKernel());
ipcMain.handle('stop', () => stopKernel());
ipcMain.handle('restart', () => { stopKernel(); setTimeout(() => startKernel(), 300); return { ok: true }; });

ipcMain.handle('set-system-proxy', async (e, enabled) => {
  const server = selectedServer();
  if (!server) return { ok: false, error: '请先选择服务器' };
  config.autoSystemProxy = !!enabled;
  saveConfig();
  if (!isKernelRunning()) {
    // 未运行：只保存配置，下次启动代理时生效（对齐 macOS）
    logLine(enabled ? '[系统代理] 已开启自动设置，下次启动代理时生效' : '[系统代理] 已关闭自动设置');
    broadcastState();
    return { ok: true, enabled: !!enabled };
  }
  const r = await setSystemProxyEnabled(!!enabled, server.listenPort + 1, false);
  if (r.ok) {
    logLine(enabled ? '[系统代理] 已接管系统代理' : '[系统代理] 已还原系统代理');
    broadcastState();
    return { ok: true, enabled: !!enabled };
  }
  return { ok: false, enabled: !!enabled, error: r.error || '设置系统代理失败' };
});

ipcMain.handle('get-system-proxy-summary', async () => ({ summary: await systemProxySummary() }));

ipcMain.handle('set-route-mode', (e, mode) => {
  if (!ROUTE_MODES[mode]) return { ok: false, error: '未知分流模式' };
  config.routeMode = mode;
  saveConfig();
  rebuildTrayMenu();
  if (isKernelRunning()) {
    logLine('[系统] 分流模式已切换，重启内核生效');
  }
  broadcastState();
  return { ok: true };
});

ipcMain.handle('save-server', (e, raw) => {
  const s = sanitizeServer(raw);
  const idx = config.servers.findIndex(x => x.id === s.id);
  if (idx >= 0) config.servers[idx] = s;
  else config.servers.push(s);
  config.selectedID = s.id;
  saveConfig();
  broadcastState();
  return { ok: true, server: s };
});

ipcMain.handle('delete-server', (e, id) => {
  config.servers = config.servers.filter(x => x.id !== id);
  if (config.selectedID === id) config.selectedID = config.servers.length ? config.servers[0].id : null;
  saveConfig();
  broadcastState();
  return { ok: true };
});

ipcMain.handle('add-server', () => {
  const s = Object.assign({}, DEFAULT_SERVER, { id: genId(), name: '新服务器' });
  config.servers.push(s);
  config.selectedID = s.id;
  saveConfig(); broadcastState();
  return { ok: true, server: s };
});

ipcMain.handle('rename-server', (e, id, name) => {
  const sv = config.servers.find(x => x.id === id);
  if (!sv) return { ok: false, error: '服务器不存在' };
  const n = String(name || '').trim();
  if (!n) return { ok: false, error: '名称不能为空' };
  if (Buffer.byteLength(n, 'utf8') > 24) return { ok: false, error: '名称过长（最多 8 个汉字 / 16 个英文）' };
  if (config.servers.some(x => x.id !== id && x.name === n)) return { ok: false, error: '名称已存在' };
  sv.name = n;
  saveConfig(); broadcastState();
  return { ok: true };
});

ipcMain.handle('select-server', (e, id) => {
  if (!config.servers.some(x => x.id === id)) return { ok: false, error: '服务器不存在' };
  const running = isKernelRunning();
  config.selectedID = id;
  saveConfig();
  if (running) {
    logLine('[系统] 已切换服务器，重启代理生效');
    restartKernel();
  }
  broadcastState();
  return { ok: true };
});

// 自选节点：对所有服务器测速
ipcMain.handle('test-nodes', async () => {
  const results = await Promise.all(config.servers.map(async sv => {
    const dialHost = String(sv.ip || '').split(',')[0].trim() || cleanHost(sv.server);
    const r = await probeLatency(dialHost, sv.serverPort);
    return { id: sv.id, name: sv.name || '未命名', host: dialHost, port: sv.serverPort, ok: r.ok, latency: r.latency };
  }));
  return { ok: true, results };
});

// Cloudflare 节点测速：对一批 host 测 443 延迟
ipcMain.handle('test-hosts', async (e, hosts) => {
  const list = Array.isArray(hosts) ? hosts.slice(0, 50) : [];
  const results = await Promise.all(list.map(async h => {
    const host = String(h || '').trim();
    if (!host) return { host, ok: false, latency: -1 };
    const r = await probeLatency(host, 443, 4000);
    return { host, ok: r.ok, latency: r.latency };
  }));
  return { ok: true, results };
});

// 从订阅 / 优选 API 内容中提取节点 host（IP 或域名）
function extractHostsFromSubscriptionText(text) {
  const hosts = new Set();
  let t = String(text || '');
  // 订阅内容常见为 base64 整体编码（解码后是 vless:// 等链接）
  if (!/(vless|vmess|trojan|ss|hysteria2|hysteria|tuic):\/\//i.test(t)) {
    const decoded = base64DecodeSafe(t.replace(/\s+/g, ''));
    if (decoded) t = decoded;
  }
  for (const raw of t.split(/\r?\n/)) {
    let s = String(raw).trim();
    if (!s) continue;
    if (/(vless|vmess|trojan|ss|hysteria2|hysteria|tuic):\/\//i.test(s)) {
      try { hosts.add(new URL(s).hostname); } catch (e) {}
    } else {
      // 纯 IP/域名行（如 admin/ADD.txt 的优选 IP 列表）
      s = s.replace(/#.*$/, '').trim();
      if (s.includes(':')) s = s.split(':')[0];
      if (/^[0-9a-zA-Z][0-9a-zA-Z.\-]*$/.test(s) && s.includes('.')) hosts.add(s);
    }
  }
  return [...hosts];
}

// ======================= 汇聚节点优选（按 _worker.js 优选节点获取逻辑移植） =======================
const CF_UA = 'v2rayN/edgetunnel (https://github.com/cmliu/edgetunnel)';
const PH_UUID = '00000000-0000-4000-8000-000000000000';
const PH_HOST = 'example.com';

// 从优选订阅生成器（sub:// 或域名）拉取优选 IP
// 对应 _worker.js 的 获取优选订阅生成器数据：请求 /sub?host=example.com&uuid=00000000-...，
// 响应为 base64 订阅，其中含占位符 uuid/host 的行即"优选 IP 行"，提取 host:port（含 #备注）
async function fetchFromSubGenerator(source) {
  const ips = [];
  let base = String(source || '').trim().replace(/^sub:\/\//i, 'https://').split('#')[0].split('?')[0];
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  try { base = new URL(base).origin; } catch (e) { return ips; }

  const subUrl = `${base}/sub?host=${PH_HOST}&uuid=${PH_UUID}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(subUrl, { signal: ctrl.signal, headers: { 'User-Agent': CF_UA } });
    clearTimeout(t);
    if (!resp.ok) return ips;
    const decoded = base64DecodeSafe(await resp.text());
    if (!decoded) return ips;
    for (const line of decoded.split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (line.includes(PH_UUID) && line.includes(PH_HOST)) {
        const m = line.match(/:\/\/[^@]+@([^?]+)/);
        if (m) {
          const remark = line.match(/#(.+)$/);
          ips.push(m[1] + (remark ? '#' + decodeURIComponent(remark[1]) : ''));
        }
      }
    }
  } catch (e) {}
  return ips;
}

// 汇聚节点优选：优选 IP/域名 直接加入；汇聚器（sub://、域名、URL）按上述逻辑拉取
ipcMain.handle('fetch-cf-nodes', async (e, inputs) => {
  // 只处理"优选汇聚器"输入（sub://、域名、URL），统一按 _worker.js 优选订阅生成器逻辑
  // 拉取优选 IP（请求 /sub?host=example.com&uuid=00000000-...，特定 UA，base64 解码提取）。
  // 直接填写的优选 IP/域名由前端"优选 IP/域名"输入框单独处理，不走这里。
  const list = (Array.isArray(inputs) ? inputs : [inputs])
    .map(u => String(u || '').trim()).filter(Boolean).slice(0, 10);
  const nodes = new Set();
  for (const raw of list) {
    const ips = await fetchFromSubGenerator(raw);
    if (ips.length) {
      for (const ip of ips) nodes.add(ip.split('#')[0].split(':')[0]);
      continue;
    }
    // 备用：直接请求该地址，解析内容提取节点（非汇聚器的普通优选源）
    const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': CF_UA } });
      clearTimeout(t);
      if (!resp.ok) continue;
      const text = await resp.text();
      for (const h of extractHostsFromSubscriptionText(text)) nodes.add(h);
    } catch (e) {}
  }
  return { ok: true, nodes: [...nodes].slice(0, 100) };
});

ipcMain.handle('import-servers', (e, list) => importServers(list));



ipcMain.handle('export-servers', async (e) => {
  const data = JSON.stringify(config.servers, null, 2);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '导出服务器配置',
    defaultPath: path.join(app.getPath('downloads'), 'echos-win-servers.json'),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, data, 'utf8');
  return { ok: true, filePath };
});

ipcMain.handle('import-from-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '导入服务器配置',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  try {
    const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    const list = Array.isArray(data) ? data : (data.servers || [data]);
    return importServers(list);
  } catch (e) {
    return { ok: false, error: `导入文件解析失败: ${e.message}` };
  }
});

ipcMain.handle('clear-logs', () => {
  logLines = [];
  try {
    if (logFileHandle) { logFileHandle.end(); logFileHandle = null; }
    if (fs.existsSync(previousLogFile)) fs.unlinkSync(previousLogFile);
    if (fs.existsSync(currentLogFile)) fs.unlinkSync(currentLogFile);
  } catch (e) {}
  broadcastState();
  return { ok: true };
});

ipcMain.handle('set-auto-launch', async (e, enabled) => setAutoLaunch(!!enabled));

ipcMain.handle('set-config', (e, patch) => {
  if (patch && typeof patch === 'object') {
    for (const k of ['logLevel', 'logVisible', 'showDiagnosticLogs', 'autoSystemProxy', 'cfApiUrls', 'cfIpList']) {
      if (k in patch) config[k] = patch[k];
    }
    saveConfig();
    broadcastState();
  }
  return { ok: true };
});

ipcMain.handle('check-updates', async () => checkUpdates());

ipcMain.handle('self-check', async () => runSelfCheck(false));

ipcMain.handle('reveal-logs', () => {
  shell.openPath(logDir);
  return { ok: true };
});

ipcMain.handle('open-update-url', (e, url) => { shell.openExternal(url); return { ok: true }; });

// 端口占用
ipcMain.handle('find-port-occupant', async (e, port) => ({ occupant: await findPortOccupant(port) }));
ipcMain.handle('kill-process', async (e, pid) => ({ ok: await killProcess(pid) }));
ipcMain.handle('port-decision', (e, decision) => {
  if (pendingPortDecision) { pendingPortDecision(decision); pendingPortDecision = null; }
  return { ok: true };
});
ipcMain.handle('pick-free-port', async () => pickFreePortPair());

// WebDAV / 整配置备份
ipcMain.handle('get-webdav', () => ({
  webdav: config.webdav ? {
    url: config.webdav.url, username: config.webdav.username,
    directory: config.webdav.directory,
    hasPassword: !!(config.webdav.passwordEnc || config.webdav.password)
  } : null
}));
ipcMain.handle('save-webdav', (e, raw) => saveWebDAV(raw));
ipcMain.handle('remove-webdav', () => removeWebDAV());
ipcMain.handle('backup-webdav', async () => backupToWebDAV());
ipcMain.handle('restore-webdav', async () => restoreFromWebDAV());
ipcMain.handle('delete-webdav-backup', async () => deleteWebDAVBackup());

ipcMain.handle('backup-local', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '备份配置',
    defaultPath: path.join(app.getPath('downloads'), 'EchOS-Win-config.json'),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(filePath, backupData(), 'utf8');
    logLine(`[系统] 配置已备份到 ${filePath}（${config.servers.length} 个服务器）`);
    return { ok: true, filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('restore-local', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '还原配置',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  try {
    const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (!data || !Array.isArray(data.servers)) return { ok: false, error: '不是有效的配置备份' };
    config = Object.assign({}, DEFAULT_CONFIG, data);
    config.servers = (config.servers || []).map(s => Object.assign({}, DEFAULT_SERVER, s, { id: s.id || genId() }));
    if (!config.servers.some(s => s.id === config.selectedID)) config.selectedID = config.servers.length ? config.servers[0].id : null;
    saveConfig(); broadcastState();
    logLine(`[系统] 已还原配置（${config.servers.length} 个服务器）`);
    return { ok: true };
  } catch (e) { return { ok: false, error: `还原失败：${e.message}` }; }
});

// 启动失败智能提示
ipcMain.handle('get-failure-hint', () => ({ hint: serverFailureHint() }));

// 渲染进程订阅内核日志（经过级别过滤）
ipcMain.handle('subscribe-kernel-logs', (e, on) => {
  kernelLogSink = (line) => {
    if (on && kernelLogFilter(line) && win && !win.isDestroyed()) {
      win.webContents.send('kernel-log', line);
    }
  };
  return { ok: true };
});

// ======================= 生命周期 =======================
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    fs.mkdirSync(configDir, { recursive: true });
    ensureLogFile();
    logLine('========================================');
    logLine(`EchOS-Win v${APP_VERSION} 启动 (${isDev ? '开发模式' : '打包模式'})`);
    logLine(`内核: ${kernelPath} (存在: ${fs.existsSync(kernelPath)})`);

    createWindow();
    createTray();

    // 启动时若有更新标记则只弹更新完成框
    // 检查更新（静默）
    setTimeout(() => {
      checkUpdates().then(r => {
        if (r.ok && r.hasUpdate && win && !win.isDestroyed()) {
          win.webContents.send('update-available', r);
        }
      }).catch(() => {});
    }, 8000);

    app.on('activate', () => showWindow());
  });

  app.on('window-all-closed', () => {
    // 托盘常驻，不退出
  });

  app.on('before-quit', () => { isQuitting = true; });
}