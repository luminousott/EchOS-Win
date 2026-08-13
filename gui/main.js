// EchOS-Win - 主进程
// 负责：内核(x-tunnel.exe)生命周期、系统代理(注册表+WinINET)、开机启动、托盘、更新检查、日志
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, shell } = require('electron');
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
  webdav: null
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
  logLines.push(line);
  if (logLines.length > 3000) logLines.splice(0, logLines.length - 3000);
  try {
    ensureLogFile();
    logFileHandle.write(line + '\n');
  } catch (e) {}
  if (win && !win.isDestroyed()) {
    win.webContents.send('log-line', line);
  }
}

// 日志分级过滤：内核日志级别
function kernelLogFilter(line) {
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

function startKernel() {
  if (kernelProc || isStarting) return { ok: false, error: '代理已在运行或正在启动' };
  const server = selectedServer();
  if (!server) return { ok: false, error: '请先添加并选择一台服务器' };
  if (!cleanHost(server.server)) return { ok: false, error: '服务地址为空，请检查服务器配置' };
  if (!fs.existsSync(kernelPath)) return { ok: false, error: `找不到内核程序 ${kernelPath}` };

  // 清理上次残留内核进程
  killLeftoverKernel();

  isStarting = true;
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
      logLine('[系统] 本地代理端口未就绪，内核可能启动失败');
      isStarting = false;
      broadcastState();
      return;
    }
    isStarting = false;
    if (config.autoSystemProxy) {
      const r = setSystemProxyEnabled(true, server.listenPort, false);
      if (!r.ok) logLine(`[系统] 接管系统代理失败: ${r.error}`);
    }
    logLine('[系统] 内核已就绪，本地代理运行中');
    broadcastState();
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
    if (kernelLogSink) {
      try { kernelLogSink(line); } catch (e) {}
    }
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

function rebuildTrayMenu() {
  if (!tray) return;
  const running = isKernelRunning();
  const menu = Menu.buildFromTemplate([
    { label: '显示 EchOS-Win', click: () => showWindow() },
    { type: 'separator' },
    {
      label: running ? '停止代理' : '启动代理',
      click: () => { running ? stopKernel() : startKernel(); }
    },
    {
      label: '切换分流模式',
      submenu: Object.keys(ROUTE_MODES).map(key => ({
        label: ROUTE_MODES[key].label,
        type: 'radio',
        checked: config.routeMode === key,
        click: () => { config.routeMode = key; saveConfig(); broadcastState(); rebuildTrayMenu(); }
      }))
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: !!config.autoLaunch,
      click: (item) => { setAutoLaunch(item.checked); }
    },
    { type: 'separator' },
    { label: '退出', click: () => { quitApp(); } }
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
  if (enabled && !server) return { ok: false, error: '请先选择服务器' };
  if (enabled && !isKernelRunning()) return { ok: false, error: '代理未运行，无法接管系统代理' };
  const r = await setSystemProxyEnabled(enabled, server ? server.listenPort : 0, false);
  if (r.ok) { config.autoSystemProxy = enabled; saveConfig(); }
  return r;
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

ipcMain.handle('select-server', (e, id) => {
  if (!config.servers.some(x => x.id === id)) return { ok: false, error: '服务器不存在' };
  config.selectedID = id;
  saveConfig();
  broadcastState();
  return { ok: true };
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
    for (const k of ['logLevel', 'logVisible', 'showDiagnosticLogs', 'autoSystemProxy']) {
      if (k in patch) config[k] = patch[k];
    }
    saveConfig();
    broadcastState();
  }
  return { ok: true };
});

ipcMain.handle('check-updates', async () => checkUpdates());

ipcMain.handle('self-check', async () => {
  const server = selectedServer();
  if (!server) return { ok: false, error: '请先选择服务器' };
  if (!isKernelRunning()) return { ok: false, error: '代理未运行，无法自检' };
  logLine('[自检] 开始通过本地代理探测连通性...');
  const r = await selfCheck(server.listenPort);
  logLine(r.ok ? `[自检] 通过: ${r.detail}` : `[自检] 失败: ${r.error}`);
  broadcastState();
  return r;
});

ipcMain.handle('reveal-logs', () => {
  shell.openPath(logDir);
  return { ok: true };
});

ipcMain.handle('open-update-url', (e, url) => { shell.openExternal(url); return { ok: true }; });

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