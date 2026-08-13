// EchOS-Win - 渲染进程（1:1 复刻 macOS 版界面）
const api = window.echos;

// ======================= 预设数据 =======================
const DNS_PRESETS = [
  { value: 'dns.alidns.com/dns-query', label: '阿里 DoH（国内推荐）' },
  { value: 'sm2.doh.pub/dns-query', label: '腾讯国密 DoH（国内）' },
  { value: 'doh.360.cn/dns-query', label: '360 DoH（国内）' },
  { value: 'doh.onedns.net/dns-query', label: 'OneDNS DoH（国内）' },
  { value: 'udp://208.67.220.220:443', label: 'OpenDNS（境外）' },
  { value: 'udp://149.112.112.112:9953', label: 'Quad9（境外）' },
  { value: 'udp://45.90.28.0:5353', label: 'NextDNS（境外）' },
  { value: 'udp://188.166.206.224:5003', label: 'Tiarap（境外）' },
  { value: 'doh.applied-privacy.net/query', label: 'Applied Privacy DoH（境外）' },
  { value: 'odvr.nic.cz/doh', label: 'CZ.NIC DoH（境外）' }
];
const ECH_PRESETS = [
  { value: 'cloudflare-ech.com', label: 'cloudflare-ech.com（推荐）' },
  { value: 'crypto.cloudflare.com', label: 'crypto.cloudflare.com' },
  { value: 'encryptedsni.com', label: 'encryptedsni.com' },
  { value: 'icook.hk', label: 'icook.hk' },
  { value: 'cm.edu.kg', label: 'cm.edu.kg' },
  { value: 'godotengine.org', label: 'godotengine.org' },
  { value: 'www.britannica.com', label: 'www.britannica.com' },
  { value: 'www.prometheus.io', label: 'www.prometheus.io' },
  { value: 'www.kyocera.com', label: 'www.kyocera.com' },
  { value: 'celestia.org', label: 'celestia.org' },
  { value: 'lido.fi', label: 'lido.fi' }
];
const RULE_CATEGORIES = [
  { value: 'geosite:cn', label: '中国大陆网站' },
  { value: 'geoip:cn', label: '中国大陆 IP' },
  { value: 'geosite:geolocation-!cn', label: '境外网站' },
  { value: 'geosite:google', label: 'Google 系' },
  { value: 'geosite:youtube', label: 'YouTube' },
  { value: 'geosite:telegram', label: 'Telegram' },
  { value: 'geosite:netflix', label: 'Netflix' },
  { value: 'geosite:openai', label: 'OpenAI / ChatGPT' },
  { value: 'geosite:github', label: 'GitHub' },
  { value: 'geosite:apple', label: 'Apple' },
  { value: 'geosite:microsoft', label: 'Microsoft' },
  { value: 'geoip:private', label: '局域网' },
  { value: 'geoip:jp', label: '日本 IP' },
  { value: 'geoip:us', label: '美国 IP' },
  { value: 'geoip:hk', label: '香港 IP' },
  { value: 'geoip:tw', label: '台湾 IP' },
  { value: 'geoip:sg', label: '新加坡 IP' }
];
const RULE_ACTIONS = [
  { value: 'direct', label: '直连' },
  { value: 'proxy', label: '走代理' },
  { value: 'block', label: '拦截' }
];


let state = null;
let logs = [];
let checkLines = [];
let logDirty = false;
let currentEdit = null;
let savedSnapshot = null;
let dirty = false;
let rulesExpanded = false;
let ruleSearch = '';

// ======================= DOM =======================
const $ = (id) => document.getElementById(id);
const els = {
  version: $('versionLabel'),
  serverSelect: $('serverSelect'), addBtn: $('addBtn'), renameBtn: $('renameBtn'),
  saveBtn: $('saveBtn'), delBtn: $('delBtn'), shareBtn: $('shareBtn'), backupBtn: $('backupBtn'),
  shareMenu: $('shareMenu'), backupMenu: $('backupMenu'), selfCheckBtn: $('selfCheckBtn'),
  cfg_server: $('cfg_server'), cfg_serverPort: $('cfg_serverPort'),
  cfg_token: $('cfg_token'), cfg_listen: $('cfg_listen'), cfg_listenPort: $('cfg_listenPort'),
  cfg_ip: $('cfg_ip'), cfg_ech: $('cfg_ech'), cfg_ech_custom: $('cfg_ech_custom'),
  cfNodeTestBtn: $('cfNodeTestBtn'),
  cfg_dns: $('cfg_dns'), cfg_dns_custom: $('cfg_dns_custom'),
  modeSeg: $('modeSeg'),
  rulesChevron: $('rulesChevron'), rulesMeta: $('rulesMeta'), addRuleBtn: $('addRuleBtn'),
  rulesBody: $('rulesBody'), ruleSearchWrap: $('ruleSearchWrap'), ruleSearch: $('ruleSearch'),
  ruleSearchClear: $('ruleSearchClear'), ruleList: $('ruleList'), ruleFooter: $('ruleFooter'),
  launchSwitch: $('launchSwitch'), sysProxySwitch: $('sysProxySwitch'),
  startBtn: $('startBtn'), stopBtn: $('stopBtn'),
  statusDot: $('statusDot'), statusText: $('statusText'), checkLabel: $('checkLabel'), proxySummary: $('proxySummary'),
  updateBtn: $('updateBtn'), settingsBtn: $('settingsBtn'), settingsMenu: $('settingsMenu'),
  diagLogSwitch: $('diagLogSwitch'), logPanelSwitch: $('logPanelSwitch'),
  logPanel: $('logPanel'),
  logToggle: $('logToggle'), logChevron: $('logChevron'), logTitle: $('logTitle'),
  logLevelSelect: $('logLevelSelect'), logFileBtn: $('logFileBtn'), clearLogBtn: $('clearLogBtn'),
  logBody: $('logBody'),
  modalOverlay: $('modalOverlay'), modalBox: $('modalBox'), toast: $('toast')
};

// ======================= 工具 =======================
function toast(msg, isError) {
  els.toast.textContent = msg;
  els.toast.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { els.toast.className = 'toast'; }, 3500);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function genId() { return (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now() + Math.random().toString(16).slice(2)); }
function openModal(html) { els.modalBox.innerHTML = html; els.modalOverlay.classList.remove('hidden'); }
function closeModal() { els.modalOverlay.classList.add('hidden'); }

// ======================= 服务器编辑状态 =======================
function loadEdit(sv) {
  currentEdit = clone(sv);
  savedSnapshot = clone(sv);
  dirty = false;
  renderEdit();
}
function markDirty() { dirty = true; renderDirty(); }
function field(name, value) { if (currentEdit) { currentEdit[name] = value; markDirty(); } }

function renderDirty() {
  els.saveBtn.classList.toggle('dirty', dirty);
  els.saveBtn.textContent = dirty ? '保存 *' : '保存';
}

function renderEdit() {
  if (!currentEdit) return;
  els.cfg_server.value = currentEdit.server || '';
  els.cfg_serverPort.value = currentEdit.serverPort;
  els.cfg_token.value = currentEdit.token || '';
  els.cfg_listen.value = currentEdit.listen || '';
  els.cfg_listenPort.value = currentEdit.listenPort;
  els.cfg_ip.value = currentEdit.ip || '';
  fillPresetSelect(els.cfg_ech, ECH_PRESETS, currentEdit.ech || '', 'cloudflare-ech.com');
  fillPresetSelect(els.cfg_dns, DNS_PRESETS, currentEdit.dns || '', 'dns.alidns.com/dns-query');
  renderRules();
  renderDirty();
}


function fillPresetSelect(sel, presets, current, placeholder) {
  const isPreset = presets.some(p => p.value === current);
  sel.innerHTML = '';
  sel.appendChild(new Option('手动输入…', '__custom__', false, !isPreset));
  for (const p of presets) sel.appendChild(new Option(p.label, p.value, false, p.value === current));
  const customEl = sel.id === 'cfg_ech' ? els.cfg_ech_custom : els.cfg_dns_custom;
  customEl.classList.toggle('hidden', !(!isPreset && current));
  if (!isPreset && current) customEl.value = current;
  customEl.placeholder = placeholder;
  customEl.disabled = isPreset;
}

// ======================= 规则 =======================
function inferKind(r) {
  const t = String(r.target || '').toLowerCase();
  if (t.startsWith('geosite:') || t.startsWith('geoip:')) return 'category';
  if (t.includes('/') || /^[\d.:]+$/.test(t)) return 'ip';
  return 'domain';
}
function kernelCondition(r) {
  const t = String(r.target || '').trim();
  if (!t) return null;
  if (r.kind === 'category' || r.kind === 'ip') return t;
  let d = t;
  if (d.toLowerCase().startsWith('domain:')) return d;
  if (d.startsWith('*.')) d = d.slice(2);
  return 'domain:' + d;
}
function shadowedIDs(rules) {
  const seen = new Set(); const out = new Set();
  for (const r of rules) {
    const k = kernelCondition(r);
    if (!k) continue;
    if (seen.has(k)) out.add(r.id); else seen.add(k);
  }
  return out;
}
function ruleLabel(r) {
  if (r.kind === 'category') {
    const c = RULE_CATEGORIES.find(x => x.value === r.target);
    return c ? c.label : r.target;
  }
  return r.target;
}

function renderRules() {
  if (!currentEdit) return;
  const rules = currentEdit.customRules || [];
  const shadowed = shadowedIDs(rules);
  const filtered = ruleSearch ? rules.filter(r =>
    String(r.target || '').toLowerCase().includes(ruleSearch.toLowerCase()) ||
    ['域名', 'IP / 网段', '网站分类'].join(' ').includes(ruleSearch) ||
    ruleLabel(r).toLowerCase().includes(ruleSearch.toLowerCase())
  ) : rules;

  els.rulesMeta.textContent = rules.length ? rules.length + ' 条' + (shadowed.size ? ' · ' + shadowed.size + ' 条重复' : '') : '';

  els.ruleSearchWrap.classList.toggle('hidden', rules.length <= 2);
  els.ruleSearchClear.classList.toggle('hidden', !ruleSearch);

  const rows = filtered.map((r, i) => {
    const kindOpts = [['domain', '域名'], ['ip', 'IP/网段'], ['category', '网站分类']]
      .map(([v, l]) => `<option value="${v}" ${r.kind === v ? 'selected' : ''}>${l}</option>`).join('');
    const actOpts = RULE_ACTIONS.map(a => `<option value="${a.value}" ${r.action === a.value ? 'selected' : ''}>${a.label}</option>`).join('');
    const target = r.kind === 'category'
      ? `<select class="rule-category" data-i="${i}" data-f="target">${RULE_CATEGORIES.map(c => `<option value="${esc(c.value)}" ${r.target === c.value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>`
      : `<input class="flex1" data-i="${i}" data-f="target" value="${esc(r.target)}" placeholder="${r.kind === 'domain' ? 'claude.ai' : '192.168.50.0/24'}">`;
    return `<div class="rule-item ${shadowed.has(r.id) ? 'shadowed' : ''}">
      <select class="rule-kind" data-i="${i}" data-f="kind">${kindOpts}</select>
      ${target}
      <select class="rule-action" data-i="${i}" data-f="action">${actOpts}</select>
      ${shadowed.has(r.id) ? '<span class="warn" title="与前面的规则重复">⚠</span>' : ''}
      <button class="btn small danger rule-del" data-i="${i}">删除</button>
    </div>`;
  }).join('');

  els.ruleList.innerHTML = rows || (rules.length ? '<div style="color:var(--text-sub);font-size:11.5px;padding:4px">没有匹配的规则</div>' : '<div style="color:var(--text-sub);font-size:11.5px;padding:4px">点「添加规则」，选类型后填域名，或直接挑一个网站分类</div>');
  renderRuleFooter(rules.length, shadowed.size);
}

function renderRuleFooter(count, shadowedCount) {
  if (count === 0) {
    els.ruleFooter.innerHTML = '点右上角「添加规则」，选类型后填域名，或直接挑一个网站分类';
  } else if (dirty) {
    els.ruleFooter.innerHTML = '<span style="color:var(--orange)">⚠ 规则已修改，保存后重启代理才生效</span>';
  } else if (state && state.running) {
    els.ruleFooter.innerHTML = '<span style="color:var(--green)">✓ 规则已生效</span>';
  } else {
    els.ruleFooter.innerHTML = '<span style="color:var(--green)">✓ 规则已保存，启动代理后生效</span>';
  }
}
// ======================= 状态渲染 =======================
function renderState(s) {
  state = s;
  els.version.textContent = 'v' + s.version;

  // 服务器下拉
  els.serverSelect.innerHTML = '';
  if (!s.servers.length) {
    els.serverSelect.innerHTML = '<option value="">（还没有服务器：点「新增」开始创建）</option>';
  } else {
    for (const sv of s.servers) {
      const opt = new Option(sv.name || '未命名', sv.id, false, sv.id === s.selectedID);
      els.serverSelect.appendChild(opt);
    }
  }

  // 若当前编辑的服务器已变（增删/切换），重新加载编辑态
  if (s.selectedID) {
    const cur = s.servers.find(x => x.id === s.selectedID);
    if (cur && (!currentEdit || currentEdit.id !== cur.id)) {
      loadEdit(cur);
    }
  } else {
    currentEdit = null; savedSnapshot = null; dirty = false;
  }

  renderStatus();
  renderEdit();
  renderDirty();

  // 操作按钮：运行中禁用编辑类操作（对齐 macOS）
  const locked = s.running || s.starting;
  els.addBtn.disabled = locked;
  els.renameBtn.disabled = locked;
  els.saveBtn.disabled = locked;
  els.delBtn.disabled = locked;
  els.startBtn.style.display = locked ? 'none' : '';
  els.stopBtn.style.display = locked ? '' : 'none';
  els.selfCheckBtn.disabled = s.checking;

  els.launchSwitch.checked = !!s.autoLaunch;
  els.sysProxySwitch.checked = !!s.autoSystemProxy;
  els.logLevelSelect.value = s.logLevel;
  els.logPanelVisible = s.logVisible !== false;
  els.logPanel.style.display = els.logPanelVisible ? 'flex' : 'none';
  els.logChevron.textContent = els.logPanelVisible ? '▾' : '▸';
  els.logTitle.textContent = s.logLevel === 'checkOnly' ? '自检记录' : '运行日志';
  els.diagLogSwitch.checked = !!s.showDiagnosticLogs;
  els.logPanelSwitch.checked = els.logPanelVisible;

  // 分流模式分段
  els.modeSeg.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === s.routeMode);
  });

  if (s.logLevel === 'checkOnly') renderCheckLines(); else renderLogTail();
  refreshProxySummary();
}

async function refreshProxySummary() {
  try {
    const r = await api.getSystemProxySummary();
    if (r && r.summary) els.proxySummary.textContent = '系统代理：' + r.summary;
  } catch (e) {}
}

function renderStatus() {
  if (!state) return;
  const s = state;
  let dotClass = '', text = '', check = '';
  if (s.starting) {
    dotClass = 'starting'; text = '启动中…'; check = '· 启动中…';
  } else if (!s.running) {
    dotClass = ''; text = '已停止';
    check = s.checkState && s.checkState.phase === 'ok' ? '· 自检通过' :
            (s.checkState && s.checkState.phase === 'failed' ? '· 自检未通过' : '');
  } else {
    text = '运行中';
    if (s.statusExtra) text += s.statusExtra;
    switch (s.checkState ? s.checkState.phase : 'idle') {
      case 'running': dotClass = 'checking'; check = '· 检测中…'; break;
      case 'ok': dotClass = 'ok'; check = '· 自检通过'; break;
      case 'failed': dotClass = 'failed'; check = '· 自检未通过'; break;
      default: dotClass = 'running'; check = '· 待检测';
    }
  }
  els.statusDot.className = 'dot ' + dotClass;
  els.statusText.textContent = text;
  els.checkLabel.textContent = check;
}

// ======================= 日志 =======================
// 与主进程 kernelLogFilter 一致：级别 + 诊断日志开关
function shouldShowLog(line, lvl, showDiag) {
  if (!showDiag && /\[DNS-DIAG\]|\[诊断\]/i.test(line)) return false;
  if (lvl === 'off') return false;
  if (lvl === 'error') return /失败|错误|error|fatal/i.test(line);
  if (lvl === 'warning') return /失败|错误|error|fatal|warn|警告/i.test(line);
  if (lvl === 'checkOnly') return false;
  return true;
}
function filterLogs(list) {
  const lvl = state ? state.logLevel : 'info';
  const diag = state ? !!state.showDiagnosticLogs : false;
  return list.filter(l => shouldShowLog(l, lvl, diag));
}

function appendLog(line) {
  logs.push(line);
  if (logs.length > 2000) logs.splice(0, logs.length - 2000);
  if (state && state.logVisible && state.logLevel !== 'checkOnly') renderLogTail();
}
function appendCheckLine(line) {
  checkLines.push(line);
  if (checkLines.length > 500) checkLines.splice(0, checkLines.length - 500);
  if (state && state.logVisible && state.logLevel === 'checkOnly') renderCheckLines();
}
function logClass(line) {
  const l = String(line);
  if (/失败|错误|error|fatal|refused|timeout|超时/i.test(l)) return 'log-line-error';
  if (/警告|warn/i.test(l)) return 'log-line-warning';
  if (/自检|check/i.test(l)) return 'log-line-check';
  return '';
}
function renderLogTail() {
  if (logDirty) return;
  logDirty = true;
  requestAnimationFrame(() => {
    logDirty = false;
    const slice = logs.slice(-400);
    els.logBody.innerHTML = slice.map(l => `<div class="${logClass(l)}">${esc(l)}</div>`).join('');
    els.logBody.scrollTop = els.logBody.scrollHeight;
  });
}
function renderCheckLines() {
  els.logBody.innerHTML = checkLines.map(l => `<div class="log-line-check">${esc(l)}</div>`).join('');
  els.logBody.scrollTop = els.logBody.scrollHeight;
}
function clearLogsUI() { logs = []; checkLines = []; els.logBody.innerHTML = ''; }

// ======================= 服务器操作 =======================
async function saveServer() {
  if (!currentEdit) return;
  const err = validate(currentEdit);
  if (err) { toast(err, true); return; }
  const r = await api.saveServer(currentEdit);
  if (r.ok) {
    savedSnapshot = clone(currentEdit);
    dirty = false;
    renderDirty();
    toast('已保存');
    const s = await api.getState(); renderState(s);
  } else toast(r.error || '保存失败', true);
}
function validate(sv) {
  if (!String(sv.server || '').trim()) return '请填写服务地址';
  if (!(sv.serverPort >= 1 && sv.serverPort <= 65535)) return '服务端口应在 1-65535 之间';
  if (!(sv.listenPort >= 1 && sv.listenPort <= 65534)) return '监听端口应在 1-65534 之间';
  return null;
}
async function addServer() {
  if (dirty && !confirm('当前有未保存的改动，新增将丢弃这些改动，继续？')) return;
  const r = await api.addServer();
  if (r.ok) {
    const s = await api.getState(); renderState(s);
    openRename(r.server);
  }
}
async function deleteServer() {
  if (!state || !state.selectedID) return;
  const sv = state.servers.find(x => x.id === state.selectedID);
  if (!confirm(`确定删除服务器「${sv ? sv.name : ''}」？`)) return;
  const r = await api.deleteServer(state.selectedID);
  if (r.ok) { const s = await api.getState(); renderState(s); toast('已删除'); }
}
function openRename(sv) {
  const name = sv ? sv.name : (currentEdit ? currentEdit.name : '');
  const html = `
    <div class="modal-head"><h2>重命名服务器</h2><button class="modal-close" data-act="close">×</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>服务器名称（最多 8 个汉字 / 16 个英文）</label>
        <input id="renameInput" maxlength="16" value="${esc(name)}">
        <div class="form-error" id="renameError"></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" data-act="close">取消</button><button class="btn primary" data-act="rename-ok">确定</button></div>`;
  openModal(html);
  const input = $('renameInput');
  input.focus(); input.select();
}
async function doRename() {
  const input = $('renameInput');
  const name = input.value.trim();
  const bytes = new TextEncoder().encode(name).length;
  if (!name) { $('renameError').textContent = '名称不能为空'; return; }
  if (bytes > 24) { $('renameError').textContent = '名称过长（8 个汉字 / 16 个英文）'; return; }
  if (!currentEdit) return;
  const r = await api.renameServer(currentEdit.id, name);
  if (!r.ok) { $('renameError').textContent = r.error || '重命名失败'; return; }
  const s = await api.getState(); renderState(s);
  closeModal(); toast('已重命名');
}

// ======================= 分享 / 备份菜单 =======================
function toggleMenu(menu) {
  const open = menu.classList.contains('open');
  document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
  if (!open) menu.classList.add('open');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-wrap')) {
    document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
  }
});
async function handleMenuAction(act) {
  switch (act) {
    case 'share-export': {
      const r = await api.exportServers();
      if (r.ok) toast('已导出到 ' + r.filePath);
      else if (r.error) toast(r.error, true);
      break;
    }
    case 'share-import': {
      const r = await api.importFromFile();
      if (r.ok && !r.canceled) { toast(`成功导入 ${r.added} 台服务器`); const s = await api.getState(); renderState(s); }
      else if (r.error) toast(r.error, true);
      break;
    }
    case 'backup-local': {
      const r = await api.backupLocal();
      if (r.ok) toast('已备份到 ' + r.filePath);
      else if (r.error) toast(r.error, true);
      break;
    }
    case 'restore-local': {
      if (!confirm('还原配置将覆盖当前所有服务器与设置，确认？')) return;
      const r = await api.restoreLocal();
      if (r.ok) { toast('已还原配置'); const s = await api.getState(); renderState(s); }
      else if (r.error) toast(r.error, true);
      break;
    }
    case 'webdav-settings': showWebdavSettings(); break;
    case 'backup-webdav': {
      toast('正在备份到 WebDAV…');
      const r = await api.backupWebdav();
      if (r.ok) toast(r.detail || '已备份'); else toast(r.error || '备份失败', true);
      break;
    }
    case 'restore-webdav': {
      if (!confirm('将从 WebDAV 还原配置，覆盖当前所有服务器与设置，确认？')) return;
      toast('正在从 WebDAV 还原…');
      const r = await api.restoreWebdav();
      if (r.ok) { toast(r.detail || '已还原'); const s = await api.getState(); renderState(s); }
      else toast(r.error || '还原失败', true);
      break;
    }
    case 'delete-webdav': {
      const r = await api.deleteWebdavBackup();
      if (r.ok) toast(r.detail || '已删除'); else toast(r.error || '删除失败', true);
      break;
    }
  }
}

// ======================= WebDAV 设置弹窗 =======================
async function showWebdavSettings() {
  const r = await api.getWebdav();
  const w = (r && r.webdav) || {};
  const html = `
    <div class="modal-head"><h2>WebDAV 备份设置</h2><button class="modal-close" data-act="close">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>服务器地址（如 https://dav.example.com/dav/）</label>
        <input id="wd_url" value="${esc(w.url || '')}" placeholder="https://dav.example.com/dav/"></div>
      <div class="form-group"><label>用户名</label><input id="wd_username" value="${esc(w.username || '')}"></div>
      <div class="form-group"><label>密码（${w.hasPassword ? '已保存，留空保持不变' : '存系统安全存储'}）</label>
        <input id="wd_password" type="password" placeholder="${w.hasPassword ? '••••••' : '输入密码'}" autocomplete="new-password"></div>
      <div class="form-group"><label>备份目录（留空默认 EchOS_Backup）</label>
        <input id="wd_directory" value="${esc(w.directory || '')}" placeholder="EchOS_Backup"></div>
      <div class="form-error" id="wd_error"></div>
    </div>
    <div class="modal-foot">
      ${w.url ? '<button class="btn danger" data-act="wd-del">删除服务器</button>' : ''}
      <span style="flex:1"></span>
      <button class="btn" data-act="close">取消</button>
      <button class="btn primary" data-act="wd-save">保存</button>
    </div>`;
  openModal(html);
}

// ======================= 端口冲突弹窗 =======================
function showPortConflict(info) {
  openModal(`
    <div class="modal-head"><h2>监听端口被占用</h2></div>
    <div class="modal-body">
      <p style="margin-bottom:10px">端口 <b>${info.port}</b> 正被 <b>${esc(info.label)}</b> 占用，无法启动本地代理。</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn primary" data-act="pc-kill">强制结束占用进程</button>
        <button class="btn ghost" data-act="pc-change">自动换一个空闲端口</button>
        <button class="btn ghost" data-act="pc-cancel">取消启动</button>
      </div>
    </div>`);
}
// ======================= Cloudflare 节点测速 =======================
async function runCfNodeSpeedTest(hosts) {
  const r = await api.testHosts(hosts);
  if (!r.ok || !r.results) return [];
  return r.results.slice().sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return a.latency - b.latency;
  });
}
function renderCfNodeList(results) {
  const list = document.getElementById('cfNodeList');
  if (!list) return;
  list.innerHTML = results.map((n, i) => `
    <div class="node-item ${n.ok ? '' : 'node-down'}" data-host="${esc(n.host)}">
      <span class="node-rank">${i + 1}</span>
      <span class="node-host flex1">${esc(n.host)}</span>
      <span class="node-latency ${n.ok ? (n.latency < 150 ? 'ok' : 'slow') : ''}">${n.ok ? n.latency + ' ms' : '超时'}</span>
      <button class="btn small" data-act="cf-pick">选用</button>
    </div>`).join('') || '<div style="color:var(--text-sub)">暂无可用节点</div>';
}
// ======================= 汇聚节点优选 =======================
async function showCfNodeTest() {
  const savedIps = (state && state.cfIpList) || [];
  const savedAgg = (state && state.cfApiUrls) || [];
  openModal(`
    <div class="modal-head"><h2>汇聚节点优选</h2><button class="modal-close" data-act="close">×</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>优选 IP / 域名（逗号分隔，直接加入测速）</label>
        <textarea id="cfIpInput" rows="2" style="width:100%;padding:6px 9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);font-size:12px;font-family:var(--mono);outline:none" placeholder="104.16.158.132, cdns.doon.eu.org">${esc(savedIps.join(', '))}</textarea>
      </div>
      <div class="form-group">
        <label>优选汇聚器（逗号分隔，如 zrf.zrf.me；自动拉取其优选 IP）</label>
        <textarea id="cfAggInput" rows="2" style="width:100%;padding:6px 9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);font-size:12px;font-family:var(--mono);outline:none" placeholder="zrf.zrf.me">${esc(savedAgg.join(', '))}</textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button id="cfFetchBtn" class="btn small primary">获取并测速</button>
        <button id="cfSaveBtn" class="btn small">保存配置</button>
      </div>
      <div class="node-list" id="cfNodeList"></div>
    </div>
    <div class="modal-foot"><button class="btn" data-act="close">关闭</button></div>`);

  const doTest = async (hosts) => {
    if (!hosts.length) { toast('请先填写优选 IP/域名或汇聚器', true); return; }
    toast(`正在对 ${hosts.length} 个节点测速…`);
    renderCfNodeList(await runCfNodeSpeedTest(hosts));
  };

  document.getElementById('cfFetchBtn').addEventListener('click', async () => {
    const ips = document.getElementById('cfIpInput').value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const aggs = document.getElementById('cfAggInput').value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    let hosts = ips;
    if (aggs.length) {
      toast('正在从汇聚器拉取优选节点…');
      const fr = await api.fetchCfNodes(aggs);
      if (fr && fr.nodes && fr.nodes.length) hosts = [...new Set([...hosts, ...fr.nodes])];
      else toast('汇聚器未返回节点', true);
    }
    await doTest(hosts);
  });

  document.getElementById('cfSaveBtn').addEventListener('click', async () => {
    const ips = document.getElementById('cfIpInput').value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const aggs = document.getElementById('cfAggInput').value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    await api.setConfig({ cfIpList: ips, cfApiUrls: aggs });
    toast('汇聚节点配置已保存');
  });

  if (savedIps.length) doTest(savedIps);
}
// ======================= 事件绑定 =======================
function bindEvents() {
  // 检查更新 / 设置菜单 / 诊断日志
  els.updateBtn.addEventListener('click', async () => {
    toast('正在检查更新…');
    const r = await api.checkUpdates();
    if (!r.ok) { toast(r.error || '检查更新失败', true); return; }
    if (!r.hasUpdate) { toast('已是最新版本 v' + r.current); return; }
    showUpdateDialog(r);
  });
  els.settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(els.settingsMenu); });
  els.diagLogSwitch.addEventListener('change', async (e) => {
    await api.setConfig({ showDiagnosticLogs: e.target.checked });
    const s = await api.getState();
    state = s;
    logs = filterLogs(s.logs || []);
    renderLogTail();
  });
  els.logPanelSwitch.addEventListener('change', async (e) => {
    await api.setConfig({ logVisible: e.target.checked });
    const s = await api.getState(); renderState(s);
  });
  document.querySelectorAll('#settingsMenu .menu-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.act === 'reveal-logs') api.revealLogs();

      document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
    });
  });

  // 服务器选择
  els.serverSelect.addEventListener('change', async (e) => {
    if (!e.target.value) return;
    if (dirty && !confirm('当前有未保存的改动，切换服务器将丢弃，继续？')) { renderState(state); return; }
    await api.selectServer(e.target.value);
  });

  // 服务器操作
  els.addBtn.addEventListener('click', addServer);
  els.renameBtn.addEventListener('click', () => currentEdit && openRename(currentEdit));
  els.saveBtn.addEventListener('click', saveServer);
  els.delBtn.addEventListener('click', deleteServer);

  // 分享 / 备份菜单
  els.shareBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(els.shareMenu); });
  els.backupBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(els.backupMenu); });
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
      handleMenuAction(item.dataset.act);
      document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
    });
  });

  // 核心配置字段（主界面直接编辑）
  const bindField = (el, name) => el.addEventListener('input', () => field(name, el.value));
  bindField(els.cfg_server, 'server');
  bindField(els.cfg_serverPort, 'serverPort');
  bindField(els.cfg_token, 'token');
  bindField(els.cfg_listen, 'listen');
  bindField(els.cfg_listenPort, 'listenPort');
  bindField(els.cfg_ip, 'ip');
  els.cfNodeTestBtn.addEventListener('click', showCfNodeTest);

  // 掩码：聚焦显示、失焦圆点
  for (const el of [els.cfg_server, els.cfg_token]) {
    el.addEventListener('focus', () => { el.type = 'text'; });
    el.addEventListener('blur', () => { el.type = el.value ? 'password' : 'text'; });
  }

  // 预设下拉（ECH / DOH）：切"手动输入"时启用自定义输入框
  for (const [sel, custom, presets] of [[els.cfg_ech, els.cfg_ech_custom, ECH_PRESETS], [els.cfg_dns, els.cfg_dns_custom, DNS_PRESETS]]) {
    sel.addEventListener('change', () => {
      const customMode = sel.value === '__custom__';
      custom.classList.toggle('hidden', !customMode);
      custom.disabled = !customMode;
      if (customMode) { custom.focus(); return; }
      field(sel.id === 'cfg_ech' ? 'ech' : 'dns', sel.value);
    });
    custom.addEventListener('input', () => {
      if (!custom.classList.contains('hidden')) field(sel.id === 'cfg_ech' ? 'ech' : 'dns', custom.value);
    });
  }

  // 分流模式（立即生效并保存）
  els.modeSeg.addEventListener('click', async (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn || btn.classList.contains('active')) return;
    await api.setRouteMode(btn.dataset.mode);
  });

  // 规则折叠 / 添加 / 搜索
  document.querySelector('.rules-head').addEventListener('click', (e) => {
    if (e.target.closest('#addRuleBtn')) return;
    rulesExpanded = !rulesExpanded;
    els.rulesBody.classList.toggle('hidden', !rulesExpanded);
    els.rulesChevron.classList.toggle('open', rulesExpanded);
  });
  els.addRuleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentEdit) return;
    if (!currentEdit.customRules) currentEdit.customRules = [];
    currentEdit.customRules.push({ id: genId(), kind: 'domain', target: '', action: 'direct' });
    markDirty();
    rulesExpanded = true;
    els.rulesBody.classList.remove('hidden');
    els.rulesChevron.classList.add('open');
    renderRules();
  });
  els.ruleSearch.addEventListener('input', () => { ruleSearch = els.ruleSearch.value; renderRules(); });
  els.ruleSearchClear.addEventListener('click', () => { ruleSearch = ''; els.ruleSearch.value = ''; renderRules(); });

  // 规则列表编辑（change 委托）
  els.ruleList.addEventListener('change', (e) => {
    if (!currentEdit) return;
    const i = e.target.dataset.i;
    const f = e.target.dataset.f;
    if (i === undefined || !currentEdit.customRules || !currentEdit.customRules[i]) return;
    const rule = currentEdit.customRules[i];
    if (f === 'kind') {
      rule.kind = e.target.value;
      if (rule.kind === 'category' && !RULE_CATEGORIES.some(c => c.value === rule.target)) rule.target = RULE_CATEGORIES[0].value;
    } else {
      rule[f] = e.target.value;
    }
    markDirty();
    renderRules();
  });
  els.ruleList.addEventListener('click', (e) => {
    const del = e.target.closest('.rule-del');
    if (!del || !currentEdit) return;
    const i = parseInt(del.dataset.i, 10);
    currentEdit.customRules.splice(i, 1);
    markDirty();
    renderRules();
  });

  // 操作行
  els.launchSwitch.addEventListener('change', async (e) => {
    const r = await api.setAutoLaunch(e.target.checked);
    if (!r.ok) { toast(r.error || '设置开机自启失败', true); e.target.checked = !e.target.checked; }
  });
  els.sysProxySwitch.addEventListener('change', async (e) => {
    const r = await api.setSystemProxy(e.target.checked);
    if (!r.ok) { toast(r.error || '设置系统代理失败', true); e.target.checked = !r.enabled; }
    else {
      e.target.checked = !!r.enabled;
      if (state && state.running) toast(r.enabled ? '已接管系统代理' : '已还原系统代理');
      else toast(r.enabled ? '已开启自动设置，下次启动代理时生效' : '已关闭自动设置');
    }
  });
  els.startBtn.addEventListener('click', async () => {
    if (dirty && !confirm('有未保存的改动，启动前请先保存。仍要继续启动？')) return;
    const r = await api.start();
    if (!r.ok) toast(r.error || '启动失败', true);
  });
  els.stopBtn.addEventListener('click', async () => { await api.stop(); });

  // 自检
  els.selfCheckBtn.addEventListener('click', async () => {
    toast('正在自检，请稍候…');
    const r = await api.selfCheck();
    if (r.ok) toast('自检通过：' + r.detail);
    else toast('自检失败：' + (r.error || '未知原因'), true);
  });

  // 日志
  els.logToggle.addEventListener('click', async () => {
    const visible = !(state && state.logVisible !== false);
    await api.setConfig({ logVisible: visible });
    const s = await api.getState(); renderState(s);
  });
  els.logLevelSelect.addEventListener('change', async (e) => {
    await api.setConfig({ logLevel: e.target.value });
    const s = await api.getState();
    state = s;
    logs = filterLogs(s.logs || []);
    renderState(s);
    renderLogTail();
  });
  els.logFileBtn.addEventListener('click', () => api.revealLogs());
  els.clearLogBtn.addEventListener('click', async () => { await api.clearLogs(); clearLogsUI(); });

  // 弹窗
  els.modalOverlay.addEventListener('click', (e) => { if (e.target === els.modalOverlay) closeModal(); });
  els.modalBox.addEventListener('click', async (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    switch (act) {
      case 'close': closeModal(); break;
      case 'rename-ok': await doRename(); break;
      case 'wd-save': {
        const url = $('wd_url').value.trim();
        if (!url) { $('wd_error').textContent = '请填写服务器地址'; return; }
        const r = await api.saveWebdav({
          url, username: $('wd_username').value.trim(),
          password: $('wd_password').value, directory: $('wd_directory').value.trim()
        });
        if (!r.ok) { $('wd_error').textContent = r.error || '保存失败'; return; }
        const s = await api.getState(); renderState(s);
        closeModal(); toast('WebDAV 设置已保存');
        break;
      }
      case 'wd-del':
        if (confirm('删除 WebDAV 服务器设置？不可撤销。')) {
          await api.removeWebdav();
          const s = await api.getState(); renderState(s);
          closeModal(); toast('已删除 WebDAV 服务器');
        }
        break;
      case 'pc-kill': {
        const info = window._portConflict;
        if (info && info.occupant && !confirm(`将强制结束 ${info.label}，确认？`)) return;
        await api.portDecision({ action: 'kill', pid: info && info.occupant ? info.occupant.pid : null });
        closeModal();
        break;
      }
      case 'pc-change': await api.portDecision({ action: 'change' }); closeModal(); break;
      case 'pc-cancel': await api.portDecision({ action: 'cancel' }); closeModal(); break;

      case 'cf-pick': {
        const item = e.target.closest('.node-item');
        if (item && currentEdit) {
          field('ip', item.dataset.host);
          closeModal();
          toast('已选用节点 ' + item.dataset.host + '，记得点「保存」');
        }
        break;
      }
    }
  });
}

// ======================= 初始化 =======================
async function init() {
  bindEvents();

  api.onState(s => { renderState(s); renderLogTail(); });
  api.onKernelLog(l => appendLog(l));
  api.onCheckLine(l => appendCheckLine(l));
  api.onUpdateAvailable(r => showUpdateDialog(r));
  api.onPortConflict(info => {
    window._portConflict = info;
    showPortConflict(info);
  });
  api.onStartFailed(r => {
    if (r && r.hint) toast('启动失败：' + r.hint, true);
  });
  api.onToastMsg(r => { if (r && r.msg) toast(r.msg); });

  const s = await api.getState();
  state = s;
  logs = filterLogs(s.logs || []);
  checkLines = (s.checkLines || []).slice();
  renderState(s);
  renderLogTail();
  // 首次使用：没有服务器时自动创建并弹命名框（对齐 macOS）
  if (!s.servers.length) {
    const r = await api.addServer();
    if (r.ok) {
      const s2 = await api.getState();
      renderState(s2);
      openRename(r.server);
    }
  }
  await api.subscribeKernelLogs(true);
}

function showUpdateDialog(r) {
  openModal(`
    <div class="modal-head"><h2>发现新版本 v${r.latest}</h2><button class="modal-close" data-act="close">×</button></div>
    <div class="modal-body">
      <p style="margin-bottom:8px">当前版本 v${r.current}，发现新版本 v${r.latest}。</p>
      <div style="color:var(--text-sub);font-size:12px;white-space:pre-wrap;max-height:180px;overflow-y:auto">${esc(r.notes || '')}</div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-act="close">稍后</button>
      <button class="btn primary" id="gotoRelease">前往下载</button>
    </div>`);
  const btn = document.getElementById('gotoRelease');
  if (btn) btn.addEventListener('click', () => { api.openUpdateUrl(r.url); closeModal(); });
}

init();