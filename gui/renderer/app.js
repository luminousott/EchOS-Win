// EchOS Windows 版 - 渲染进程逻辑
const api = window.echos;

let state = null;
let logs = [];            // 界面显示的日志
let logDirty = false;
let serverModal = null;   // { mode: 'list' | 'edit', server }

// ======================= DOM 引用 =======================
const $ = (id) => document.getElementById(id);
const els = {
  version: $('versionLabel'), serverSelect: $('serverSelect'), manageBtn: $('manageBtn'),
  statusDot: $('statusDot'), statusTitle: $('statusTitle'), statusSub: $('statusSub'),
  startBtn: $('startBtn'), selfCheckBtn: $('selfCheckBtn'),
  modeRow: $('modeRow'), systemProxySwitch: $('systemProxySwitch'),
  proxySummary: $('proxySummary'), autoLaunchSwitch: $('autoLaunchSwitch'),
  logLevelSelect: $('logLevelSelect'), logVisibleSwitch: $('logVisibleSwitch'),
  logPanel: $('logPanel'), logBody: $('logBody'),
  revealLogsBtn: $('revealLogsBtn'), clearLogsBtn: $('clearLogsBtn'),
  checkUpdateBtn: $('checkUpdateBtn'),
  modalOverlay: $('modalOverlay'), modalBox: $('modalBox'),
  toast: $('toast')
};

// ======================= 工具 =======================
function toast(msg, isError) {
  els.toast.textContent = msg;
  els.toast.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { els.toast.className = 'toast'; }, 3000);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ======================= 状态渲染 =======================
function renderState(s) {
  state = s;
  els.version.textContent = 'v' + s.version;

  // 服务器下拉
  els.serverSelect.innerHTML = '';
  if (!s.servers.length) {
    els.serverSelect.innerHTML = '<option value="">（暂无服务器，请先添加）</option>';
  } else {
    for (const sv of s.servers) {
      const opt = document.createElement('option');
      opt.value = sv.id;
      opt.textContent = sv.name + '  (' + sv.server + ':' + sv.serverPort + ')';
      if (sv.id === s.selectedID) opt.selected = true;
      els.serverSelect.appendChild(opt);
    }
  }

  // 状态
  if (s.starting) {
    els.statusDot.className = 'status-dot starting';
    els.statusTitle.textContent = '正在启动…';
  } else if (s.running) {
    els.statusDot.className = 'status-dot running';
    els.statusTitle.textContent = '运行中';
  } else {
    els.statusDot.className = 'status-dot';
    els.statusTitle.textContent = '未运行';
  }
  if (s.server) {
    els.statusSub.textContent = `SOCKS5 127.0.0.1:${s.server.listenPort} / HTTP 127.0.0.1:${s.server.listenPort + 1}`;
  } else {
    els.statusSub.textContent = '请先添加服务器';
  }
  els.startBtn.textContent = s.running || s.starting ? '停止代理' : '启动代理';
  els.startBtn.classList.toggle('running', s.running || s.starting);
  els.selfCheckBtn.disabled = !s.running;

  // 分流模式
  els.modeRow.querySelectorAll('.mode-option').forEach(el => {
    const on = el.dataset.mode === s.routeMode;
    el.classList.toggle('selected', on);
    const radio = el.querySelector('input');
    radio.checked = on;
  });

  // 系统代理 / 设置
  els.systemProxySwitch.checked = !!s.autoSystemProxy;
  els.autoLaunchSwitch.checked = !!s.autoLaunch;
  els.logLevelSelect.value = s.logLevel;
  els.logVisibleSwitch.checked = !!s.logVisible;
  els.logPanel.style.display = s.logVisible ? 'flex' : 'none';

  // 内核缺失提示
  if (!s.kernelExists) {
    toast('未找到内核 x-tunnel.exe，请先运行 build.ps1 构建', true);
  }
  refreshProxySummary();
}

async function refreshProxySummary() {
  const r = await api.getSystemProxySummary();
  if (r && r.summary) els.proxySummary.textContent = r.summary;
}

// ======================= 日志 =======================
function appendLog(line) {
  logs.push(line);
  if (logs.length > 1500) logs.splice(0, logs.length - 1500);
  if (state && state.logVisible) renderLogTail();
}

function renderLogTail() {
  // 只增量渲染尾部
  if (logDirty) return;
  logDirty = true;
  requestAnimationFrame(() => {
    logDirty = false;
    const max = 300;
    const slice = logs.slice(-max);
    els.logBody.textContent = slice.join('\n');
    els.logBody.scrollTop = els.logBody.scrollHeight;
  });
}

function clearLogsUI() { logs = []; els.logBody.textContent = ''; }

// ======================= 服务器管理弹窗 =======================
function openModal(html) {
  els.modalBox.innerHTML = html;
  els.modalOverlay.classList.remove('hidden');
}
function closeModal() { els.modalOverlay.classList.add('hidden'); }

function showServerList() {
  const s = state || {};
  const items = s.servers.map(sv => `
    <div class="server-item ${sv.id === s.selectedID ? 'selected' : ''}" data-id="${sv.id}">
      <div style="flex:1">
        <div class="s-name">${esc(sv.name)}</div>
        <div class="s-desc">${esc(sv.server)}:${sv.serverPort} · SOCKS5 ${sv.listenPort} / HTTP ${sv.listenPort + 1}</div>
      </div>
      <div class="s-actions">
        <button class="s-btn" data-act="select">选择</button>
        <button class="s-btn" data-act="edit">编辑</button>
        <button class="s-btn danger" data-act="del">删除</button>
      </div>
    </div>`).join('');
  const html = `
    <div class="modal-head">
      <h2>服务器管理</h2>
      <button class="modal-close" data-act="close">×</button>
    </div>
    <div class="modal-body">
      <div class="server-list">
        ${items || '<div style="color:var(--text-sub);padding:12px">还没有服务器，点击下方「新增服务器」添加。</div>'}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" data-act="new">新增服务器</button>
        <button class="btn ghost" data-act="import">从文件导入</button>
        <button class="btn ghost" data-act="export">导出到文件</button>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-act="close">关闭</button>
    </div>`;
  openModal(html);
}

function showServerEdit(sv) {
  const isNew = !sv;
  sv = sv || {
    id: null, name: '新服务器', server: '', serverPort: 443,
    listen: '127.0.0.1', listenPort: 30000,
    ip: 'cdns.doon.eu.org', ech: 'cloudflare-ech.com',
    dns: 'dns.alidns.com/dns-query', token: '',
    connections: 3, block: '443', ips: '',
    fallback: false, insecure: false
  };
  const html = `
    <div class="modal-head">
      <h2>${isNew ? '新增服务器' : '编辑服务器'}</h2>
      <button class="modal-close" data-act="cancel">×</button>
    </div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-group">
          <label>服务器名称</label>
          <input id="f_name" value="${esc(sv.name)}" maxlength="16" placeholder="给这台服务器起个名字">
        </div>
        <div class="form-group">
          <label>监听端口（SOCKS5）</label>
          <input id="f_listenPort" type="number" min="1" max="65534" value="${sv.listenPort}">
        </div>
        <div class="form-group full">
          <label>服务地址（服务器主机名，如 xxx.workers.dev）</label>
          <input id="f_server" value="${esc(sv.server)}" placeholder="xxx.workers.dev">
        </div>
        <div class="form-group">
          <label>服务端口</label>
          <input id="f_serverPort" type="number" min="1" max="65535" value="${sv.serverPort}">
        </div>
        <div class="form-group">
          <label>身份令牌 TOKEN</label>
          <input id="f_token" type="password" value="${esc(sv.token)}" placeholder="可留空">
        </div>
        <div class="form-group">
          <label>监听地址</label>
          <input id="f_listen" value="${esc(sv.listen)}">
        </div>
        <div class="form-group">
          <label>优选 IP / 域名（-ip，多个用逗号）</label>
          <input id="f_ip" value="${esc(sv.ip)}">
        </div>
        <div class="form-group">
          <label>ECH 域名</label>
          <input id="f_ech" value="${esc(sv.ech)}">
        </div>
        <div class="form-group">
          <label>DoH 服务器（查询 ECH 公钥）</label>
          <input id="f_dns" value="${esc(sv.dns)}">
        </div>
        <div class="form-group">
          <label>拦截 UDP 端口</label>
          <input id="f_block" value="${esc(sv.block)}">
        </div>
        <div class="form-group">
          <label>IP 访问策略（-ips）</label>
          <input id="f_ips" value="${esc(sv.ips)}" placeholder="留空=自动 / 4 / 6 / 4,6">
        </div>
        <div class="form-group">
          <label>连接数（-n）</label>
          <input id="f_connections" type="number" min="1" max="32" value="${sv.connections}">
        </div>
        <div class="form-group full" style="flex-direction:row;gap:18px;align-items:center;padding-top:4px">
          <label class="form-check"><input type="checkbox" id="f_fallback" ${sv.fallback ? 'checked' : ''}> 禁用 ECH（回退 TLS1.3）</label>
          <label class="form-check"><input type="checkbox" id="f_insecure" ${sv.insecure ? 'checked' : ''}> 跳过证书校验</label>
        </div>
        <div class="form-group full"><div class="form-error" id="f_error"></div></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-act="cancel">取消</button>
      <button class="btn primary" data-act="save">保存</button>
    </div>`;
  openModal(html);
}

function validateServer() {
  const v = (id) => ($(id).value || '').trim();
  const num = (id, min, max) => {
    const n = parseInt($(id).value, 10);
    if (!(n >= min && n <= max)) return null;
    return n;
  };
  const server = v('f_server');
  const serverPort = num('f_serverPort', 1, 65535);
  const listenPort = num('f_listenPort', 1, 65534);
  if (!server) return { error: '请填写服务地址' };
  if (serverPort == null) return { error: '服务端口应在 1-65535 之间' };
  if (listenPort == null) return { error: '监听端口应在 1-65534 之间' };
  return {
    id: serverModal.sv ? serverModal.sv.id : null,
    name: v('f_name') || '新服务器',
    server, serverPort,
    listen: v('f_listen') || '127.0.0.1', listenPort,
    ip: v('f_ip'), ech: v('f_ech'), dns: v('f_dns'),
    token: v('f_token'), block: v('f_block') || '443',
    ips: v('f_ips'),
    connections: parseInt($('f_connections').value, 10) || 3,
    fallback: $('f_fallback').checked,
    insecure: $('f_insecure').checked
  };
}

// ======================= 事件 =======================
function bindEvents() {
  els.startBtn.addEventListener('click', async () => {
    if (!state) return;
    if (state.running || state.starting) {
      await api.stop();
    } else {
      const r = await api.start();
      if (!r.ok) toast(r.error || '启动失败', true);
    }
  });

  els.selfCheckBtn.addEventListener('click', async () => {
    toast('正在自检，请稍候…');
    const r = await api.selfCheck();
    if (r.ok) toast('自检通过：' + r.detail);
    else toast('自检失败：' + (r.error || '未知原因'), true);
  });

  els.serverSelect.addEventListener('change', async (e) => {
    if (e.target.value) {
      await api.selectServer(e.target.value);
    }
  });

  els.manageBtn.addEventListener('click', () => showServerList());

  els.modeRow.addEventListener('change', async (e) => {
    if (e.target.name === 'mode') {
      const r = await api.setRouteMode(e.target.value);
      if (!r.ok) toast(r.error, true);
      else if (state && state.running) toast('分流模式已保存，重启代理后生效');
    }
  });

  els.systemProxySwitch.addEventListener('change', async (e) => {
    const r = await api.setSystemProxy(e.target.checked);
    if (!r.ok) {
      toast(r.error || '设置系统代理失败', true);
      e.target.checked = !e.target.checked;
    } else {
      toast(e.target.checked ? '已接管系统代理' : '已关闭系统代理');
      refreshProxySummary();
    }
  });

  els.autoLaunchSwitch.addEventListener('change', async (e) => {
    const r = await api.setAutoLaunch(e.target.checked);
    if (!r.ok) { toast(r.error || '设置开机自启失败', true); e.target.checked = !e.target.checked; }
  });

  els.logLevelSelect.addEventListener('change', (e) => {
    api.setConfig({ logLevel: e.target.value });
  });

  els.logVisibleSwitch.addEventListener('change', async (e) => {
    await api.setConfig({ logVisible: e.target.checked });
    const s = await api.getState();
    renderState(s);
  });

  els.revealLogsBtn.addEventListener('click', () => api.revealLogs());
  els.clearLogsBtn.addEventListener('click', async () => {
    await api.clearLogs();
    clearLogsUI();
  });

  els.checkUpdateBtn.addEventListener('click', async () => {
    toast('正在检查更新…');
    const r = await api.checkUpdates();
    if (!r.ok) { toast(r.error || '检查更新失败', true); return; }
    if (!r.hasUpdate) { toast('已是最新版本 v' + r.current); return; }
    showUpdateDialog(r);
  });

  els.modalOverlay.addEventListener('click', (e) => {
    if (e.target === els.modalOverlay) closeModal();
  });

  els.modalBox.addEventListener('click', async (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    switch (act) {
      case 'close': closeModal(); break;
      case 'cancel': closeModal(); break;
      case 'new':
        serverModal = { sv: null };
        showServerEdit(null);
        break;
      case 'edit': {
        const id = e.target.closest('.server-item').dataset.id;
        const sv = state.servers.find(x => x.id === id);
        serverModal = { sv };
        showServerEdit(sv);
        break;
      }
      case 'del': {
        const id = e.target.closest('.server-item').dataset.id;
        if (confirm('确定删除这台服务器？')) {
          await api.deleteServer(id);
          const s = await api.getState();
          renderState(s);
          showServerList();
        }
        break;
      }
      case 'select': {
        const id = e.target.closest('.server-item').dataset.id;
        await api.selectServer(id);
        const s = await api.getState();
        renderState(s);
        showServerList();
        break;
      }
      case 'import': {
        const r = await api.importFromFile();
        if (r.ok && !r.canceled) {
          toast(`成功导入 ${r.added} 台服务器`);
          const s = await api.getState();
          renderState(s);
          showServerList();
        } else if (r.error) toast(r.error, true);
        break;
      }
      case 'export': {
        const r = await api.exportServers();
        if (r.ok) toast('已导出到 ' + r.filePath);
        break;
      }
      case 'save': {
        const data = validateServer();
        if (data.error) { $('f_error').textContent = data.error; return; }
        const r = await api.saveServer(data);
        if (!r.ok) { $('f_error').textContent = r.error || '保存失败'; return; }
        const s = await api.getState();
        renderState(s);
        closeModal();
        toast('已保存');
        break;
      }
    }
  });
}

function showUpdateDialog(r) {
  const html = `
    <div class="modal-head"><h2>发现新版本 v${r.latest}</h2><button class="modal-close" data-act="close">×</button></div>
    <div class="modal-body">
      <p style="margin-bottom:8px">当前版本 v${r.current}，发现新版本 v${r.latest}。</p>
      <div style="color:var(--text-sub);font-size:12px;white-space:pre-wrap;max-height:180px;overflow-y:auto">${esc(r.notes || '')}</div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-act="close">稍后</button>
      <button class="btn primary" id="gotoRelease">前往下载</button>
    </div>`;
  openModal(html);
  const btn = document.getElementById('gotoRelease');
  if (btn) btn.addEventListener('click', () => { api.openUpdateUrl(r.url); closeModal(); });
}

// ======================= 初始化 =======================
async function init() {
  bindEvents();
  api.onState(s => { renderState(s); renderLogTail(); });
  api.onLogLine(l => appendLog(l));
  api.onKernelLog(l => appendLog(l));
  api.onUpdateAvailable(r => showUpdateDialog(r));

  const s = await api.getState();
  renderState(s);
  logs = s.logs.slice();
  renderLogTail();
  await api.subscribeKernelLogs(true);
}

init();