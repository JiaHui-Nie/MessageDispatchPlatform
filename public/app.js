/* ==========================================================================
   信息分发平台 — 前端（无构建步骤的原生 ES Module）
   ========================================================================== */

import { renderDocs } from './docs.js';

const appEl = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastEl = document.getElementById('toast');

const state = {
  appName: '信息分发平台',
  version: '',
  configured: true,
  needsSetup: false,
  authenticated: false,
  user: null,
  timezone: 'Asia/Shanghai',
  notice: '',
};

const PROJECT_URL = 'https://github.com/JiaHui-Nie/MessageDispatchPlatform';
const PROJECT_FOOTER = `<p class="auth-project">开源项目：<a href="${PROJECT_URL}" target="_blank" rel="noopener noreferrer">JiaHui-Nie/MessageDispatchPlatform</a></p>`;

/* ------------------------------ 基础工具 ------------------------------ */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);
}

function initials(user) {
  const source = (user?.display_name || user?.username || '?').trim();
  return source.slice(0, 1).toUpperCase();
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 100 ? Math.round(size) : Math.round(size * 10) / 10} ${units[index]}`;
}

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M6.61 6.61A18.4 18.4 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.39-1.61"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="m2 2 20 20"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.85 12.15 8.4-8.4"/><path d="m18 5 2 2"/><path d="m15 8 2 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3a3 3 0 0 1 0-6V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  sparkles: '<path d="m12 3 1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  folder: '<path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 9 5-5 5 5"/><path d="M12 4v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 11 5 5 5-5"/><path d="M12 16V4"/>',
  hardDrive: '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/><path d="M6 16h.01"/><path d="M10 16h.01"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
};

function icon(name, className = '') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${className ? ` class="${className}"` : ''}>${ICONS[name] ?? ''}</svg>`;
}

/* ------------------------------ API 封装 ------------------------------ */

async function api(path, body = {}, options = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: isForm
        ? { accept: 'application/json' }
        : { 'content-type': 'application/json', accept: 'application/json' },
      body: isForm ? body : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error('网络请求失败，请检查网络连接后重试');
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.message || `请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    error.code = data?.error || 'request_failed';
    if (response.status === 401 && !path.startsWith('/api/auth/') && !options.allowUnauthorized) {
      state.user = null;
      state.authenticated = false;
      if (!location.hash.startsWith('#/f/')) {
        if (location.hash === '#/login') render();
        else location.hash = '#/login';
      }
    }
    throw error;
  }
  return data ?? { status: 200 };
}

/* ------------------------------ UI 组件 ------------------------------ */

let toastTimer = null;

function toast(message, type = 'info') {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = `toast toast-${type}`;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 3400);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.className = 'visually-hidden';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } catch {
      /* ignore */
    }
    textarea.remove();
  }
  toast('已复制到剪贴板', 'success');
}

function setBusy(button, busy, label = '处理中…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<span class="spinner"></span>${esc(label)}`;
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

function formValues(form) {
  const values = {};
  for (const element of Array.from(form.elements)) {
    if (!element.name) continue;
    if (element.type === 'checkbox') {
      values[element.name] = element.checked;
    } else {
      values[element.name] = element.value;
    }
  }
  return values;
}

function showError(container, message) {
  if (!container) return;
  container.innerHTML = `${icon('alert')}<span>${esc(message)}</span>`;
  container.hidden = false;
}

function hideError(container) {
  if (!container) return;
  container.hidden = true;
  container.textContent = '';
}

function onSubmit(form, handler) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.busy === '1') return;
    form.dataset.busy = '1';
    const button = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector('[data-error]');
    hideError(errorBox);
    setBusy(button, true);
    try {
      await handler(form);
    } catch (error) {
      showError(errorBox, error.message || '操作失败，请重试');
    } finally {
      form.dataset.busy = '0';
      setBusy(button, false);
    }
  });
}

function openModal(options) {
  const { title, subtitle = '', body = '', footer = '', size = '', onMount, onClose } = options;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-header">
        <div>
          <h2>${esc(title)}</h2>
          ${subtitle ? `<p>${subtitle}</p>` : ''}
        </div>
        <button class="icon-btn" type="button" data-close aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>`;
  modalRoot.appendChild(backdrop);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    onClose?.();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKeyDown);
  backdrop.addEventListener('click', (event) => {
    const target = event.target;
    if (target === backdrop || (target instanceof Element && target.closest('[data-close]'))) {
      close();
    }
  });

  const modal = backdrop.querySelector('.modal');
  const bodyEl = backdrop.querySelector('.modal-body');
  onMount?.(modal, close);
  return { el: modal, bodyEl, close };
}

function confirmAction({ title, message, confirmText = '确认', danger = true }) {
  return new Promise((resolve) => {
    let confirmed = false;
    const modal = openModal({
      title,
      body: `<p class="text-muted">${esc(message)}</p>`,
      footer: `<button class="btn btn-secondary" type="button" data-close>取消</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-confirm>${esc(confirmText)}</button>`,
      onClose: () => resolve(confirmed),
    });
    modal.el.querySelector('[data-confirm]')?.addEventListener('click', () => {
      confirmed = true;
      modal.close();
    });
  });
}

function emptyState(title, description, iconName = 'inbox') {
  return `<div class="empty-state">${icon(iconName)}<strong>${esc(title)}</strong><p>${esc(description)}</p></div>`;
}

function alertBox(type, message) {
  return `<div class="alert alert-${type}">${icon('alert')}<span>${message}</span></div>`;
}

function badgeForStatus(status) {
  if (status === 'unread') return '<span class="badge badge-warning"><span class="dot"></span>未读</span>';
  return '<span class="badge badge-success"><span class="dot"></span>已读</span>';
}

function maskValue(value) {
  if (!value) return '（空）';
  return '•'.repeat(Math.min(16, Math.max(6, value.length)));
}

function chatHTML(chat, perspective = 'owner') {
  if (!Array.isArray(chat) || chat.length === 0) {
    return `<div class="chat-empty">还没有消息</div>`;
  }
  return chat
    .map((message) => {
      const fromOwner = message.author === 'owner';
      const side = perspective === 'owner' ? (fromOwner ? 'owner' : 'visitor') : fromOwner ? 'visitor' : 'owner';
      return `<div class="bubble-row ${side}">
        <div class="bubble">
          <span class="bubble-tag">${fromOwner ? '回复' : '反馈'} · ${esc(message.time)}</span>
          <div>${esc(message.information)}</div>
        </div>
      </div>`;
    })
    .join('');
}

function scrollChatToEnd(container) {
  const chat = container?.querySelector('.chat');
  if (chat) chat.scrollTop = chat.scrollHeight;
}

/* ------------------------------ 导航与渲染 ------------------------------ */

const NAV_ITEMS = [
  { key: 'overview', href: '#/overview', label: '总览', icon: 'grid' },
  { key: 'security', href: '#/security', label: '安全', icon: 'shield' },
  { key: 'publish', href: '#/publish', label: '发布信息', icon: 'send' },
  { key: 'files', href: '#/files', label: '文件存储', icon: 'folder' },
  { key: 'feedback', href: '#/feedback', label: '获取反馈', icon: 'message', badge: true },
];

const ADMIN_NAV = { key: 'admin', href: '#/admin', label: '管理后台', icon: 'users' };
const DOCS_NAV = { key: 'docs', href: '#/docs', label: 'API 文档', icon: 'book' };

function navigate(hash) {
  if (location.hash === hash) {
    render();
    return;
  }
  location.hash = hash;
}

function parseRoute() {
  const raw = (location.hash || '#/').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  return { path: `/${segments.join('/')}`, segments, query: new URLSearchParams(queryPart || '') };
}

function setUnreadBadge(count) {
  const badge = document.getElementById('nav-unread');
  if (!badge) return;
  const value = Number(count) || 0;
  if (value > 0) {
    badge.textContent = value > 99 ? '99+' : String(value);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

async function refreshUnreadBadge() {
  try {
    const data = await api('/api/overview');
    setUnreadBadge(data.stats?.unread ?? 0);
  } catch {
    /* 静默失败，不影响主流程 */
  }
}

function renderConfigError() {
  document.title = `配置缺失 · ${state.appName}`;
  appEl.className = '';
  appEl.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <div class="auth-brand">
          <img src="/favicon.svg" alt="" width="52" height="52" />
          <h1>${esc(state.appName)}</h1>
          <p>服务端配置尚未完成</p>
        </div>
        ${alertBox('error', esc(state.notice || '服务端缺少 JWT_SECRET，无法签发登录凭据并加密数据。'))}
        <p class="field-hint mt-4">请任选一种方式设置密钥，然后刷新页面：</p>
        <ol class="hint-list">
          <li>命令行：<code>wrangler secret put JWT_SECRET</code>（本地开发写入 <code>.dev.vars</code>）</li>
          <li>Cloudflare 控制台：Workers → 本项目 → Settings → Variables and Secrets → 添加 <code>JWT_SECRET</code></li>
          <li>重新部署后刷新本页</li>
        </ol>
        <p class="field-hint mt-4">注意：JWT_SECRET 同时用于加密数据库中的数据，部署后请勿随意更改。</p>
        <button class="btn btn-secondary btn-block mt-4" type="button" data-reload>重新检查</button>
      </div>
    </div>`;
  appEl.querySelector('[data-reload]')?.addEventListener('click', () => location.reload());
}

function renderLogin() {
  document.title = `登录 · ${state.appName}`;
  appEl.className = '';
  appEl.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <div class="auth-brand">
          <img src="/favicon.svg" alt="" width="52" height="52" />
          <h1>${esc(state.appName)}</h1>
          <p>信息分发 · 反馈回复</p>
        </div>
        <form class="form" id="login-form" novalidate>
          <label class="field">
            <span>用户名</span>
            <input class="input" name="username" autocomplete="username" placeholder="请输入用户名" required autofocus />
          </label>
          <label class="field">
            <span>密码</span>
            <input class="input" type="password" name="password" autocomplete="current-password" placeholder="请输入密码" required />
          </label>
          <div class="alert alert-error" data-error hidden></div>
          <button class="btn btn-primary btn-block" type="submit">登录</button>
        </form>
        <p class="auth-foot">还没有账号？<a href="#/register">使用注册码注册</a></p>
        <p class="auth-note">首次部署的管理员账号固定为 <strong>admin</strong>，请先在初始化页面设置密码。</p>
        ${PROJECT_FOOTER}
      </div>
    </div>`;

  const form = document.getElementById('login-form');
  form.elements.namedItem('username')?.focus();
  onSubmit(form, async () => {
    const values = formValues(form);
    if (!values.username || !values.password) {
      throw new Error('请输入用户名和密码');
    }
    const data = await api('/api/auth/login', { username: values.username, password: values.password });
    state.user = data.user;
    state.authenticated = true;
    state.needsSetup = false;
    toast('登录成功', 'success');
    navigate('#/overview');
  });
}

function renderSetup() {
  document.title = `初始化管理员 · ${state.appName}`;
  appEl.className = '';
  appEl.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <div class="auth-brand">
          <img src="/favicon.svg" alt="" width="52" height="52" />
          <h1>初始化管理员</h1>
          <p>首次部署，请为 <strong>admin</strong> 账号设置密码</p>
        </div>
        ${alertBox('info', '该密码只会设置一次，请妥善保存。设置完成后即可登录后台。')}
        <form class="form mt-4" id="setup-form" novalidate>
          <label class="field">
            <span>账号</span>
            <input class="input" value="admin" disabled />
            <small class="field-hint">管理员账号固定为 admin，不可修改。</small>
          </label>
          <label class="field">
            <span>管理员密码</span>
            <input class="input" type="password" name="password" autocomplete="new-password" placeholder="至少 8 位，含字母与数字/符号" required autofocus />
            <small class="field-hint">至少 8 位，需同时包含字母与数字或符号。</small>
          </label>
          <label class="field">
            <span>确认密码</span>
            <input class="input" type="password" name="confirm" autocomplete="new-password" placeholder="再次输入密码" required />
          </label>
          <div class="alert alert-error" data-error hidden></div>
          <button class="btn btn-primary btn-block" type="submit">创建管理员并进入后台</button>
        </form>
        ${PROJECT_FOOTER}
      </div>
    </div>`;

  const form = document.getElementById('setup-form');
  onSubmit(form, async () => {
    const values = formValues(form);
    if (values.password !== values.confirm) {
      throw new Error('两次输入的密码不一致');
    }
    const data = await api('/api/auth/setup', { password: values.password });
    state.user = data.user;
    state.authenticated = true;
    state.needsSetup = false;
    toast('管理员创建成功', 'success');
    navigate('#/overview');
  });
}

function renderRegister() {
  document.title = `注册 · ${state.appName}`;
  appEl.className = '';
  appEl.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <div class="auth-brand">
          <img src="/favicon.svg" alt="" width="52" height="52" />
          <h1>注册账号</h1>
          <p>需要管理员提供的注册码</p>
        </div>
        <form class="form" id="register-form" novalidate>
          <label class="field">
            <span>用户名</span>
            <input class="input" name="username" autocomplete="username" placeholder="3-32 位字母、数字、下划线" required autofocus />
            <small class="field-hint">支持字母、数字、下划线、点和短横线，不区分大小写。</small>
          </label>
          <label class="field">
            <span>密码</span>
            <input class="input" type="password" name="password" autocomplete="new-password" placeholder="至少 8 位，含字母与数字/符号" required />
          </label>
          <label class="field">
            <span>注册码</span>
            <input class="input input-mono" name="code" placeholder="XXXX-XXXX-XXXX-XXXX" required />
          </label>
          <div class="alert alert-error" data-error hidden></div>
          <button class="btn btn-primary btn-block" type="submit">注册并登录</button>
        </form>
        <p class="auth-foot">已有账号？<a href="#/login">返回登录</a></p>
        ${PROJECT_FOOTER}
      </div>
    </div>`;

  const form = document.getElementById('register-form');
  onSubmit(form, async () => {
    const values = formValues(form);
    if (!values.username || !values.password || !values.code) {
      throw new Error('请填写用户名、密码和注册码');
    }
    const data = await api('/api/auth/register', {
      username: values.username,
      password: values.password,
      code: values.code,
    });
    state.user = data.user;
    state.authenticated = true;
    state.needsSetup = false;
    toast('注册成功', 'success');
    navigate('#/overview');
  });
}

function renderShell(viewKey, options = {}) {
  const user = state.user;
  const navHtml = [
    ...NAV_ITEMS,
    ...(user?.role === 'admin' ? [ADMIN_NAV] : []),
  ]
    .map(
      (item) => `
      <a class="nav-item ${item.key === viewKey ? 'is-active' : ''}" href="${item.href}">
        ${icon(item.icon)}
        <span>${item.label}</span>
        ${item.badge ? '<span class="nav-badge" id="nav-unread" hidden></span>' : ''}
      </a>`,
    )
    .join('');
  const docsHtml = `
      <a class="nav-item nav-docs ${viewKey === DOCS_NAV.key ? 'is-active' : ''}" href="${DOCS_NAV.href}">
        ${icon(DOCS_NAV.icon)}
        <span>${DOCS_NAV.label}</span>
      </a>`;

  appEl.className = '';
  appEl.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <img src="/favicon.svg" alt="" width="32" height="32" />
          <div class="brand-name">
            <strong>${esc(state.appName)}</strong>
            <small>信息分发 · 反馈回复</small>
          </div>
        </div>
        <nav class="nav" aria-label="主导航">${navHtml}${docsHtml}</nav>
        <div class="sidebar-footer">
          <div class="user-chip">
            <div class="avatar">${esc(initials(user))}</div>
            <div class="user-meta">
              <strong>${esc(user.display_name || user.username)}</strong>
              <small>${user.role === 'admin' ? '管理员' : `@${esc(user.username)}`}</small>
            </div>
            <button class="icon-btn" type="button" data-logout aria-label="退出登录" title="退出登录">${icon('logout')}</button>
          </div>
        </div>
      </aside>
      <main class="main">
        <div class="mobile-user">
          <div class="user-chip">
            <div class="avatar">${esc(initials(user))}</div>
            <div class="user-meta">
              <strong>${esc(user.display_name || user.username)}</strong>
              <small>${user.role === 'admin' ? '管理员' : `@${esc(user.username)}`}</small>
            </div>
          </div>
          <button class="icon-btn" type="button" data-logout aria-label="退出登录">${icon('logout')}</button>
        </div>
        <div id="view"></div>
      </main>
    </div>`;

  document.querySelectorAll('[data-logout]').forEach((button) => {
    button.addEventListener('click', logout);
  });

  const view = VIEWS[viewKey];
  const viewEl = document.getElementById('view');
  document.title = `${view.title} · ${state.appName}`;
  Promise.resolve(view.render(viewEl, options)).catch((error) => {
    renderErrorCard(viewEl, error, () => renderShell(viewKey, options));
  });
  refreshUnreadBadge();
}

async function logout() {
  try {
    await api('/api/auth/logout');
  } catch {
    /* 忽略退出登录错误 */
  }
  state.user = null;
  state.authenticated = false;
  toast('已退出登录');
  navigate('#/login');
}

function renderErrorCard(el, error, retry) {
  el.innerHTML = `
    <div class="card">
      <div class="card-body">
        ${alertBox('error', esc(error.message || '加载失败'))}
        <div class="page-actions mt-4">
          <button class="btn btn-secondary" type="button" data-retry>${icon('refresh')}重新加载</button>
        </div>
      </div>
    </div>`;
  el.querySelector('[data-retry]')?.addEventListener('click', retry);
}

/* ------------------------------ 总览 ------------------------------ */

const VIEWS = {};

VIEWS.overview = {
  title: '总览',
  async render(el) {
    el.innerHTML = `<div class="skeleton skeleton-title"></div><div class="skeleton"></div>`;
    let data;
    try {
      data = await api('/api/overview');
    } catch (error) {
      renderErrorCard(el, error, () => VIEWS.overview.render(el));
      return;
    }
    state.user = data.user;
    setUnreadBadge(data.stats.unread);

    const name = data.user.display_name || data.user.username;
    const feedbackLink = `${location.origin}/#/f/${encodeURIComponent(data.user.username)}`;
    const recentHtml = data.recent.length
      ? data.recent
          .map(
            (item) => `
        <div class="feedback-item ${item.status === 'unread' ? 'is-unread' : ''}" role="button" tabindex="0" data-session="${esc(item.session_id)}">
          <div class="feedback-avatar">${icon('message')}</div>
          <div class="feedback-main">
            <div class="feedback-title">${esc(item.title || '（无标题反馈）')}</div>
            <div class="feedback-meta"><span>${esc(item.update_time)}</span><span>·</span><span>${item.message_count} 条消息</span></div>
          </div>
          <div class="feedback-side">${badgeForStatus(item.status)}${icon('chevronRight')}</div>
        </div>`,
          )
          .join('')
      : emptyState('还没有收到反馈', '开启反馈功能并把链接分享出去吧。', 'inbox');

    el.innerHTML = `
      <header class="page-header">
        <div>
          <h1 class="page-title">你好，${esc(name)}</h1>
          <p class="page-subtitle">在这里管理你的固定信息、API Key 以及收到的反馈。</p>
        </div>
        <div class="page-actions">
          <a class="btn btn-secondary" href="#/publish">${icon('send')}发布信息</a>
          <a class="btn btn-secondary" href="#/files">${icon('folder')}文件存储</a>
          <a class="btn btn-primary" href="#/feedback">${icon('message')}查看反馈</a>
        </div>
      </header>

      <section class="stat-grid">
        <div class="stat-card accent">
          <div class="stat-label">${icon('message')}未读反馈</div>
          <div class="stat-value">${formatNumber(data.stats.unread)}<small>条</small></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${icon('inbox')}反馈总数</div>
          <div class="stat-value">${formatNumber(data.stats.feedback)}<small>条</small></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${icon('send')}固定信息</div>
          <div class="stat-value">${formatNumber(data.stats.information)}<small>条</small></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${icon('key')}API Key</div>
          <div class="stat-value">${formatNumber(data.stats.api_keys)}<small>个</small></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${icon('hardDrive')}存储空间</div>
          <div class="stat-value">${formatBytes(data.storage?.used ?? 0)}<small>/ ${formatBytes(data.storage?.quota ?? 0)}</small></div>
        </div>
      </section>

      <div class="grid-2">
        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">${icon('inbox')}最近反馈</h2>
              <p class="card-subtitle">仅显示最近 5 条</p>
            </div>
            <a class="btn btn-ghost btn-sm" href="#/feedback">全部${icon('chevronRight')}</a>
          </div>
          <div class="card-body tight">${recentHtml}</div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">${icon('link')}反馈入口</h2>
              <p class="card-subtitle">把链接发给需要提交反馈的人</p>
            </div>
            ${
              data.feedback.enabled
                ? '<span class="badge badge-success"><span class="dot"></span>已开启</span>'
                : '<span class="badge">未开启</span>'
            }
          </div>
          <div class="card-body">
            ${
              data.feedback.enabled
                ? `<div class="copy-box"><code>${esc(feedbackLink)}</code><button class="icon-btn" type="button" data-copy="${esc(feedbackLink)}" aria-label="复制反馈链接">${icon('copy')}</button></div>
                   <p class="field-hint mt-2">访客无需注册即可提交反馈，并通过 session_id 继续对话。</p>`
                : alertBox('warning', '反馈功能尚未开启，请前往 <a href="#/feedback">获取反馈</a> 页面开启。')
            }
            <div class="divider"></div>
            <h3 class="field-label">API 基地址</h3>
            <div class="copy-box">
              <code>${esc(data.api_base)}/api</code>
              <button class="icon-btn" type="button" data-copy="${esc(data.api_base)}/api" aria-label="复制 API 地址">${icon('copy')}</button>
            </div>
            <ul class="hint-list">
              <li>所有接口使用 <code>POST</code> + JSON 请求体</li>
              <li>第三方调用需要 API Key，网页后台无需</li>
              <li>数据在 D1 中以 AES-256-GCM 加密存储</li>
            </ul>
          </div>
        </section>
      </div>`;

    el.querySelectorAll('[data-session]').forEach((node) => {
      node.addEventListener('click', () => {
        navigate(`#/feedback?session=${encodeURIComponent(node.dataset.session)}`);
      });
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          node.click();
        }
      });
    });
  },
};

/* ------------------------------ 发布信息 ------------------------------ */

VIEWS.publish = {
  title: '发布信息',
  async render(el) {
    el.innerHTML = `<div class="skeleton skeleton-title"></div><div class="skeleton"></div>`;
    let items = [];
    try {
      const data = await api('/api/information/list');
      items = data.information;
    } catch (error) {
      renderErrorCard(el, error, () => VIEWS.publish.render(el));
      return;
    }

    const rows = items.length
      ? items
          .map(
            (item, index) => `
        <tr>
          <td><span class="cell-key">${esc(item.key)}</span></td>
          <td><span class="cell-value" data-value="${index}">${esc(maskValue(item.value))}</span></td>
          <td>${
            item.visible
              ? '<span class="badge badge-primary">公开</span>'
              : '<span class="badge badge-warning">私有</span>'
          }</td>
          <td class="nowrap cell-muted">${esc(item.updated_at_display)}</td>
          <td>
            <div class="cell-actions">
              <button class="icon-btn" type="button" data-action="reveal" data-index="${index}" aria-label="显示内容" title="显示/隐藏">${icon('eye')}</button>
              <button class="icon-btn" type="button" data-action="edit" data-index="${index}" aria-label="编辑" title="编辑">${icon('edit')}</button>
              <button class="icon-btn" type="button" data-action="visibility" data-index="${index}" aria-label="切换可见性" title="${item.visible ? '改为私有' : '改为公开'}">${icon(item.visible ? 'lock' : 'link')}</button>
              <button class="icon-btn danger" type="button" data-action="delete" data-index="${index}" aria-label="删除" title="删除">${icon('trash')}</button>
            </div>
          </td>
        </tr>`,
          )
          .join('')
      : '';

    el.innerHTML = `
      <header class="page-header">
        <div>
          <h1 class="page-title">发布信息</h1>
          <p class="page-subtitle">通过固定的 key / value 分发信息，供第三方系统按 key 拉取。</p>
        </div>
        <div class="page-actions">
          <span class="badge">${formatNumber(items.length)} / 500 条</span>
        </div>
      </header>

      <div class="stack">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('send')}<span id="form-title">发布新信息</span></h2>
            <span class="card-subtitle">内容会加密后写入 D1</span>
          </div>
          <div class="card-body">
            <form class="form" id="info-form" novalidate>
              <label class="field">
                <span>key</span>
                <input class="input input-mono" name="key" maxlength="64" placeholder="例如 notice、version、config" required />
                <small class="field-hint">只能包含字母、数字、下划线、点、冒号和短横线。</small>
              </label>
              <label class="field">
                <span>value</span>
                <textarea class="textarea" name="value" maxlength="100000" placeholder="要分发的内容，可以是文本、JSON 或配置片段" required></textarea>
              </label>
              <label class="checkbox">
                <input type="checkbox" name="visible" checked />
                <div>
                  <strong>公开读取</strong>
                  <small>开启后任何人可通过 getinformation 用 key 读取；关闭后需要提供你的 API Key。</small>
                </div>
              </label>
              <div class="alert alert-error" data-error hidden></div>
              <div class="page-actions">
                <button class="btn btn-primary" type="submit">保存信息</button>
                <button class="btn btn-secondary" type="button" id="reset-btn" hidden>取消编辑</button>
              </div>
            </form>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">${icon('inbox')}已发布的信息</h2>
              <p class="card-subtitle">共 ${formatNumber(items.length)} 条，按更新时间排序</p>
            </div>
          </div>
          <div class="card-body tight">
            ${
              items.length
                ? `<div class="table-wrap"><table>
                     <thead><tr><th>key</th><th>value</th><th>可见性</th><th class="nowrap">更新时间</th><th class="nowrap"></th></tr></thead>
                     <tbody>${rows}</tbody>
                   </table></div>`
                : emptyState('还没有发布信息', '使用左侧表单创建第一条固定信息。', 'send')
            }
          </div>
        </section>
      </div>`;

    const form = document.getElementById('info-form');
    const formTitle = document.getElementById('form-title');
    const resetButton = document.getElementById('reset-btn');
    let editingKey = null;

    const resetForm = () => {
      form.reset();
      form.elements.namedItem('visible').checked = true;
      form.elements.namedItem('key').readOnly = false;
      formTitle.textContent = '发布新信息';
      resetButton.hidden = true;
      editingKey = null;
    };

    resetButton.addEventListener('click', resetForm);

    onSubmit(form, async () => {
      const values = formValues(form);
      if (!values.key.trim() || !values.value) {
        throw new Error('请填写 key 和 value');
      }
      const payload = { key: values.key.trim(), value: values.value, visible: values.visible };
      if (editingKey && editingKey !== payload.key) {
        payload.key = editingKey;
      }
      await api('/api/setinformation', payload);
      toast('信息已保存', 'success');
      VIEWS.publish.render(el);
    });

    el.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const index = Number(button.dataset.index);
        const item = items[index];
        if (!item) return;
        const action = button.dataset.action;

        if (action === 'reveal') {
          const span = el.querySelector(`[data-value="${index}"]`);
          if (!span) return;
          const revealed = span.classList.toggle('is-revealed');
          span.textContent = revealed ? item.value : maskValue(item.value);
          button.innerHTML = icon(revealed ? 'eyeOff' : 'eye');
          return;
        }

        if (action === 'edit') {
          form.elements.namedItem('key').value = item.key;
          form.elements.namedItem('key').readOnly = true;
          form.elements.namedItem('value').value = item.value;
          form.elements.namedItem('visible').checked = item.visible;
          formTitle.textContent = '编辑信息';
          resetButton.hidden = false;
          editingKey = item.key;
          if (typeof form.scrollIntoView === 'function') {
            form.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          form.elements.namedItem('value').focus();
          return;
        }

        if (action === 'visibility') {
          try {
            await api('/api/information/visibility', { key: item.key, visible: !item.visible });
            toast(item.visible ? '已改为私有' : '已改为公开', 'success');
            VIEWS.publish.render(el);
          } catch (error) {
            toast(error.message, 'error');
          }
          return;
        }

        if (action === 'delete') {
          const confirmed = await confirmAction({
            title: '删除信息',
            message: `确定删除 key「${item.key}」吗？此操作不可恢复。`,
            confirmText: '删除',
          });
          if (!confirmed) return;
          try {
            await api('/api/deleteinformation', { key: item.key });
            toast('已删除', 'success');
            VIEWS.publish.render(el);
          } catch (error) {
            toast(error.message, 'error');
          }
        }
      });
    });
  },
};

/* ------------------------------ 文件存储 ------------------------------ */

VIEWS.files = {
  title: '文件存储',
  async render(el) {
    el.innerHTML = `<div class="skeleton skeleton-title"></div><div class="skeleton"></div>`;
    let data;
    try {
      data = await api('/api/files/list');
    } catch (error) {
      renderErrorCard(el, error, () => VIEWS.files.render(el));
      return;
    }

    const files = data.files ?? [];
    const storage = data.storage ?? { quota: 0, used: 0, remaining: 0, percent: 0, file_count: 0 };
    const maxBytes = data.limits?.max_file_size ?? 10 * 1024 * 1024;
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    const quotaLevel = storage.percent >= 90 ? 'danger' : storage.percent >= 70 ? 'warning' : '';

    const rows = files
      .map(
        (file, index) => `
        <tr>
          <td>
            <div class="file-name">${icon('file')}<span>${esc(file.name)}</span></div>
            <div class="file-meta">${esc(file.content_type)} · ${formatBytes(file.size)}</div>
          </td>
          <td>${
            file.private
              ? '<span class="badge badge-warning"><span class="dot"></span>私有</span>'
              : '<span class="badge badge-primary"><span class="dot"></span>公开</span>'
          }</td>
          <td class="nowrap cell-muted">${formatNumber(file.downloads)} 次</td>
          <td class="nowrap cell-muted">${esc(file.created_at_display)}</td>
          <td>
            <div class="cell-actions">
              <a class="icon-btn" href="${esc(file.url_path)}" target="_blank" rel="noopener noreferrer" title="下载" aria-label="下载">${icon('download')}</a>
              <button class="icon-btn" type="button" data-action="copy" data-index="${index}" title="复制链接" aria-label="复制链接">${icon('copy')}</button>
              <button class="icon-btn" type="button" data-action="toggle" data-index="${index}" title="${file.private ? '设为公开' : '设为私有'}" aria-label="切换可见性">${icon(file.private ? 'link' : 'lock')}</button>
              <button class="icon-btn danger" type="button" data-action="delete" data-index="${index}" title="删除" aria-label="删除">${icon('trash')}</button>
            </div>
          </td>
        </tr>`,
      )
      .join('');

    el.innerHTML = `
      <header class="page-header">
        <div>
          <h1 class="page-title">文件存储</h1>
          <p class="page-subtitle">上传文件并生成下载链接；文件加密存储，每个文件可单独设置是否需要 API Key。</p>
        </div>
        <div class="page-actions">
          <span class="badge">${icon('hardDrive')}单文件 ≤ ${maxMb} MB</span>
        </div>
      </header>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">${icon('chart')}空间用量</h2>
            <p class="card-subtitle">${formatBytes(storage.used)} / ${formatBytes(storage.quota)} · ${formatNumber(storage.file_count)} 个文件</p>
          </div>
          <span class="badge ${quotaLevel === 'danger' ? 'badge-danger' : quotaLevel === 'warning' ? 'badge-warning' : 'badge-primary'}">${storage.percent}%</span>
        </div>
        <div class="card-body">
          <progress class="quota-bar ${quotaLevel}" value="${storage.used}" max="${storage.quota || 1}"></progress>
          <div class="dropzone" data-dropzone role="button" tabindex="0" aria-label="上传文件">
            ${icon('upload')}
            <strong>点击选择文件，或拖拽到这里上传</strong>
            <span>文件会以 AES-256-GCM 加密后存入 D1，单个文件最大 ${maxMb} MB</span>
            <input type="file" multiple data-file-input hidden />
          </div>
          <label class="checkbox mt-3">
            <input type="checkbox" data-private-upload />
            <div>
              <strong>需要 API Key 才能下载</strong>
              <small>上传后可在列表中随时切换公开/私有。</small>
            </div>
          </label>
          <div class="alert alert-error mt-3" data-upload-error hidden></div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">${icon('folder')}文件列表</h2>
            <p class="card-subtitle">共 ${formatNumber(files.length)} 个文件</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" data-refresh>${icon('refresh')}刷新</button>
        </div>
        <div class="card-body tight">
          ${
            files.length
              ? `<div class="table-wrap"><table>
                   <thead><tr><th>文件</th><th>可见性</th><th class="nowrap">下载</th><th class="nowrap">上传时间</th><th class="nowrap"></th></tr></thead>
                   <tbody>${rows}</tbody>
                 </table></div>`
              : emptyState('还没有上传文件', '点击上方区域上传第一个文件，上传后会得到下载链接。', 'folder')
          }
        </div>
      </section>`;

    const zone = el.querySelector('[data-dropzone]');
    const input = el.querySelector('[data-file-input]');
    const errorBox = el.querySelector('[data-upload-error]');
    const privateUpload = el.querySelector('[data-private-upload]');
    let uploading = false;

    const uploadFiles = async (fileList) => {
      if (uploading) return;
      const queue = Array.from(fileList ?? []);
      if (queue.length === 0) return;
      uploading = true;
      zone.classList.add('is-uploading');
      hideError(errorBox);
      const results = [];
      for (const file of queue) {
        if (file.size > maxBytes) {
          showError(errorBox, `${file.name} 超过 ${maxMb} MB 限制`);
          continue;
        }
        const form = new FormData();
        form.append('file', file);
        if (privateUpload.checked) {
          form.append('private', 'true');
        }
        try {
          results.push(await api('/api/uploadfile', form));
        } catch (error) {
          showError(errorBox, `${file.name}：${error.message}`);
        }
      }
      uploading = false;
      zone.classList.remove('is-uploading');
      if (input) input.value = '';
      if (results.length === 0) {
        return;
      }
      openModal({
        title: `上传成功（${results.length} 个文件）`,
        subtitle: '复制链接即可分享；私有文件下载时需要提供你的 API Key',
        body: results
          .map(
            (result) => `
            <div class="modal-section">
              <div class="row-between">
                <strong class="truncate">${esc(result.name)}</strong>
                <span class="badge">${formatBytes(result.size)}</span>
              </div>
              <div class="copy-box mt-2">
                <code>${esc(result.download_url)}</code>
                <button class="icon-btn" type="button" data-copy="${esc(result.download_url)}" aria-label="复制链接">${icon('copy')}</button>
              </div>
              ${result.private ? '<p class="field-hint mt-2">私有文件：下载时需附带 <code>api_key</code> 或使用 <code>X-API-Key</code> 请求头。</p>' : ''}
            </div>`,
          )
          .join(''),
        footer: '<button class="btn btn-primary" type="button" data-close>完成</button>',
        onClose: () => VIEWS.files.render(el),
      });
    };

    zone.addEventListener('click', (event) => {
      if (event.target === input) return;
      input.click();
    });
    zone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        input.click();
      }
    });
    input.addEventListener('change', () => uploadFiles(input.files));
    for (const type of ['dragenter', 'dragover']) {
      zone.addEventListener(type, (event) => {
        event.preventDefault();
        zone.classList.add('is-dragover');
      });
    }
    for (const type of ['dragleave', 'drop']) {
      zone.addEventListener(type, (event) => {
        event.preventDefault();
        zone.classList.remove('is-dragover');
      });
    }
    zone.addEventListener('drop', (event) => uploadFiles(event.dataTransfer?.files));

    el.querySelector('[data-refresh]')?.addEventListener('click', () => VIEWS.files.render(el));

    el.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const file = files[Number(button.dataset.index)];
        if (!file) return;
        const action = button.dataset.action;
        const link = `${location.origin}${file.url_path}`;
        if (action === 'copy') {
          await copyText(link);
          if (file.private) {
            toast('链接已复制；私有文件下载时需附带 API Key', 'success');
          }
          return;
        }
        if (action === 'toggle') {
          try {
            await api('/api/files/visibility', { id: file.id, private: !file.private });
            toast(file.private ? '已设为公开' : '已设为私有', 'success');
            VIEWS.files.render(el);
          } catch (error) {
            toast(error.message, 'error');
          }
          return;
        }
        if (action === 'delete') {
          const confirmed = await confirmAction({
            title: '删除文件',
            message: `确定删除「${file.name}」吗？删除后下载链接会立即失效，并释放 ${formatBytes(file.size)} 空间。`,
            confirmText: '删除',
          });
          if (!confirmed) return;
          try {
            await api('/api/files/delete', { id: file.id });
            toast('文件已删除', 'success');
            VIEWS.files.render(el);
          } catch (error) {
            toast(error.message, 'error');
          }
        }
      });
    });
  },
};

/* ------------------------------ 获取反馈 ------------------------------ */

VIEWS.feedback = {
  title: '获取反馈',
  async render(el, options = {}) {
    el.innerHTML = `<div class="skeleton skeleton-title"></div><div class="skeleton"></div>`;
    let data;
    try {
      data = await api('/api/feedback/list', { limit: 200 });
    } catch (error) {
      renderErrorCard(el, error, () => VIEWS.feedback.render(el, options));
      return;
    }
    const settings = data.settings ?? { enabled: false, intro: '' };
    let items = data.feedback;
    let filter = 'all';

    const feedbackLink = `${location.origin}/#/f/${encodeURIComponent(state.user.username)}`;

    el.innerHTML = `
      <header class="page-header">
        <div>
          <h1 class="page-title">获取反馈</h1>
          <p class="page-subtitle">开启反馈后，任何人都可以通过公开页面或 API 向你提交反馈。</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary" type="button" data-refresh>${icon('refresh')}刷新</button>
        </div>
      </header>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">${icon('message')}反馈设置</h2>
            <p class="card-subtitle">关闭后访客将无法提交新的反馈</p>
          </div>
          <span class="badge ${settings.enabled ? 'badge-success' : ''}" data-status-badge>
            ${settings.enabled ? '<span class="dot"></span>已开启' : '已关闭'}
          </span>
        </div>
        <div class="card-body">
          <div class="switch-row">
            <div class="switch-copy">
              <strong>允许他人提交反馈</strong>
              <span>开启后，公开反馈页面与 sendfeedback 接口才会生效。</span>
            </div>
            <button class="switch" type="button" role="switch" aria-checked="${settings.enabled}" aria-label="允许他人提交反馈" data-toggle></button>
          </div>
          <form class="form mt-4" id="intro-form">
            <label class="field">
              <span>反馈页说明（可选）</span>
              <textarea class="textarea" name="intro" maxlength="500" placeholder="例如：请描述问题出现的页面与操作步骤，我会尽快回复。" rows="3">${esc(settings.intro || '')}</textarea>
              <small class="field-hint">显示在公开反馈页面的顶部，最多 500 字。</small>
            </label>
            <div class="alert alert-error" data-error hidden></div>
            <div class="page-actions">
              <button class="btn btn-secondary" type="submit">保存说明</button>
            </div>
          </form>
          <div class="divider"></div>
          <h3 class="field-label">公开反馈链接</h3>
          <div class="copy-box">
            <code>${esc(feedbackLink)}</code>
            <button class="icon-btn" type="button" data-copy="${esc(feedbackLink)}" aria-label="复制公开反馈链接">${icon('copy')}</button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">${icon('inbox')}反馈清单</h2>
            <p class="card-subtitle" data-count-text>共 ${formatNumber(items.length)} 条</p>
          </div>
          <div class="tabs" role="tablist">
            <button class="tab is-active" type="button" data-filter="all">全部<span class="tab-count">${formatNumber(data.counts.all)}</span></button>
            <button class="tab" type="button" data-filter="unread">未读<span class="tab-count">${formatNumber(data.counts.unread)}</span></button>
            <button class="tab" type="button" data-filter="read">已读<span class="tab-count">${formatNumber(data.counts.read)}</span></button>
          </div>
        </div>
        <div class="card-body tight" data-list></div>
      </section>`;

    const listEl = el.querySelector('[data-list]');
    const countText = el.querySelector('[data-count-text]');

    const renderList = () => {
      const visible = filter === 'all' ? items : items.filter((item) => item.status === filter);
      countText.textContent = `共 ${formatNumber(visible.length)} 条`;
      if (!visible.length) {
        listEl.innerHTML = emptyState(
          filter === 'all' ? '还没有收到反馈' : filter === 'unread' ? '没有未读反馈' : '没有已读反馈',
          filter === 'all' ? '开启反馈并分享公开链接，访客的留言会出现在这里。' : '切换其他筛选条件看看。',
          'inbox',
        );
        return;
      }
      listEl.innerHTML = `<div class="feedback-list">${visible
        .map(
          (item) => `
          <div class="feedback-item ${item.status === 'unread' ? 'is-unread' : ''}" role="button" tabindex="0" data-session="${esc(item.session_id)}">
            <div class="feedback-avatar">${icon('message')}</div>
            <div class="feedback-main">
              <div class="feedback-title">${esc(item.title || '（无标题反馈）')}</div>
              <div class="feedback-meta"><span>${esc(item.update_time)}</span><span>·</span><span>${item.message_count} 条消息</span></div>
            </div>
            <div class="feedback-side">${badgeForStatus(item.status)}${icon('chevronRight')}</div>
          </div>`,
        )
        .join('')}</div>`;
      listEl.querySelectorAll('[data-session]').forEach((node) => {
        node.addEventListener('click', () => openFeedbackThread(node.dataset.session, reload));
        node.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            node.click();
          }
        });
      });
    };

    const reload = () => VIEWS.feedback.render(el, options);

    const toggle = el.querySelector('[data-toggle]');
    toggle.addEventListener('click', async () => {
      const next = toggle.getAttribute('aria-checked') !== 'true';
      toggle.disabled = true;
      try {
        const result = await api('/api/feedback/settings', { enabled: next });
        toggle.setAttribute('aria-checked', String(result.enabled));
        const statusBadge = el.querySelector('[data-status-badge]');
        statusBadge.className = `badge ${result.enabled ? 'badge-success' : ''}`;
        statusBadge.innerHTML = result.enabled ? '<span class="dot"></span>已开启' : '已关闭';
        toast(result.enabled ? '已开启反馈' : '已关闭反馈', 'success');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        toggle.disabled = false;
      }
    });

    onSubmit(el.querySelector('#intro-form'), async () => {
      const values = formValues(el.querySelector('#intro-form'));
      await api('/api/feedback/settings', { intro: values.intro });
      toast('说明已保存', 'success');
    });

    el.querySelectorAll('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        filter = button.dataset.filter;
        el.querySelectorAll('[data-filter]').forEach((node) => node.classList.toggle('is-active', node === button));
        renderList();
      });
    });

    el.querySelector('[data-refresh]').addEventListener('click', reload);
    renderList();

    // 从总览/外部链接深链到某条反馈时只打开一次，避免刷新列表时重复弹窗。
    if (options.session) {
      const sessionId = options.session;
      options.session = null;
      openFeedbackThread(sessionId, reload);
    }
  },
};

async function openFeedbackThread(sessionId, onChanged) {
  let thread;
  try {
    thread = await api('/api/feedback/get', { session_id: sessionId, mark_read: true });
  } catch (error) {
    toast(error.message, 'error');
    return;
  }

  const modal = openModal({
    title: thread.title || '反馈对话',
    size: 'modal-lg',
    subtitle: `${esc(thread.update_time)} 更新 · ${thread.message_count} 条消息`,
    body: '<div data-thread></div>',
  });
  wire(thread);
  refreshUnreadBadge();

  function wire(current) {
    const container = modal.bodyEl.querySelector('[data-thread]');
    if (!container) return;
    container.innerHTML = `
      <div class="row-between mb-3">
        <div class="pill-row">
          ${badgeForStatus(current.status)}
          <span class="badge">${icon('clock')}${esc(current.created_at_display)}</span>
        </div>
        <button class="btn btn-danger btn-sm" type="button" data-delete>${icon('trash')}删除</button>
      </div>
      <div class="chat">${chatHTML(current.chat, 'owner')}</div>
      <form class="form mt-4" data-reply>
        <label class="field">
          <span>回复</span>
          <textarea class="textarea" name="message" maxlength="10000" placeholder="输入回复内容，对方可通过 session_id 查看…" rows="3" required></textarea>
        </label>
        <div class="alert alert-error" data-error hidden></div>
        <div class="page-actions">
          <button class="btn btn-primary" type="submit">${icon('send')}发送回复</button>
        </div>
      </form>`;

    const replyForm = container.querySelector('[data-reply]');
    onSubmit(replyForm, async () => {
      const values = formValues(replyForm);
      if (!values.message.trim()) {
        throw new Error('回复内容不能为空');
      }
      await api('/api/feedback/reply', { session_id: sessionId, message: values.message });
      toast('回复已发送', 'success');
      const updated = await api('/api/feedback/get', { session_id: sessionId, mark_read: true });
      thread = updated;
      modal.el.querySelector('.modal-header p').textContent = `${updated.update_time} 更新 · ${updated.message_count} 条消息`;
      wire(updated);
      refreshUnreadBadge();
      onChanged?.();
    });

    container.querySelector('[data-delete]').addEventListener('click', async () => {
      const confirmed = await confirmAction({
        title: '删除反馈',
        message: '删除后该会话的所有消息都会被移除，且访客无法再通过 session_id 访问。确定继续吗？',
        confirmText: '删除',
      });
      if (!confirmed) return;
      try {
        await api('/api/feedback/delete', { session_id: sessionId });
        toast('反馈已删除', 'success');
        modal.close();
        onChanged?.();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    scrollChatToEnd(modal.bodyEl);
  }
}

/* ------------------------------ 安全 ------------------------------ */

VIEWS.security = {
  title: '安全',
  async render(el) {
    el.innerHTML = `<div class="skeleton skeleton-title"></div><div class="skeleton"></div>`;
    let keys = [];
    try {
      const data = await api('/api/apikeys/list');
      keys = data.api_keys;
    } catch (error) {
      renderErrorCard(el, error, () => VIEWS.security.render(el));
      return;
    }

    const rows = keys.length
      ? keys
          .map(
            (key, index) => `
        <tr>
          <td>${esc(key.name)}</td>
          <td><span class="mono" data-key="${index}">${esc(maskValue(key.key))}</span></td>
          <td class="nowrap cell-muted">${esc(key.created_at_display)}</td>
          <td class="nowrap cell-muted">${key.last_used_display ? esc(key.last_used_display) : '从未使用'}</td>
          <td>
            <div class="cell-actions">
              <button class="icon-btn" type="button" data-action="reveal" data-index="${index}" aria-label="显示 API Key" title="显示/隐藏">${icon('eye')}</button>
              <button class="icon-btn" type="button" data-action="copy" data-index="${index}" aria-label="复制 API Key" title="复制">${icon('copy')}</button>
              <button class="icon-btn danger" type="button" data-action="delete" data-index="${index}" aria-label="删除 API Key" title="删除">${icon('trash')}</button>
            </div>
          </td>
        </tr>`,
          )
          .join('')
      : '';

    el.innerHTML = `
      <header class="page-header">
        <div>
          <h1 class="page-title">安全</h1>
          <p class="page-subtitle">管理登录密码与用于第三方调用的 API Key。</p>
        </div>
      </header>

      <div class="grid-2">
        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">${icon('lock')}修改密码</h2>
              <p class="card-subtitle">修改后其他设备上的登录状态会立即失效</p>
            </div>
          </div>
          <div class="card-body">
            <form class="form" id="password-form" novalidate>
              <label class="field">
                <span>当前密码</span>
                <input class="input" type="password" name="current_password" autocomplete="current-password" required />
              </label>
              <label class="field">
                <span>新密码</span>
                <input class="input" type="password" name="new_password" autocomplete="new-password" placeholder="至少 8 位，含字母与数字/符号" required />
              </label>
              <label class="field">
                <span>确认新密码</span>
                <input class="input" type="password" name="confirm_password" autocomplete="new-password" required />
              </label>
              <div class="alert alert-error" data-error hidden></div>
              <div class="page-actions">
                <button class="btn btn-primary" type="submit">更新密码</button>
              </div>
            </form>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">${icon('key')}API Key</h2>
              <p class="card-subtitle">${formatNumber(keys.length)} / 20 个，密钥默认隐藏</p>
            </div>
            <button class="btn btn-primary btn-sm" type="button" data-create>${icon('plus')}新建</button>
          </div>
          <div class="card-body tight">
            ${
              keys.length
                ? `<div class="table-wrap"><table>
                     <thead><tr><th>名称</th><th>API Key</th><th class="nowrap">创建时间</th><th class="nowrap">最近使用</th><th class="nowrap"></th></tr></thead>
                     <tbody>${rows}</tbody>
                   </table></div>`
                : emptyState('还没有 API Key', '创建后可用于第三方系统调用平台接口。', 'key')
            }
          </div>
        </section>
      </div>`;

    onSubmit(el.querySelector('#password-form'), async () => {
      const values = formValues(el.querySelector('#password-form'));
      if (values.new_password !== values.confirm_password) {
        throw new Error('两次输入的新密码不一致');
      }
      await api('/api/auth/password', {
        current_password: values.current_password,
        new_password: values.new_password,
      });
      el.querySelector('#password-form').reset();
      toast('密码已更新', 'success');
    });

    el.querySelector('[data-create]')?.addEventListener('click', () => {
      openCreateApiKey(() => VIEWS.security.render(el));
    });

    el.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const index = Number(button.dataset.index);
        const key = keys[index];
        if (!key) return;
        if (button.dataset.action === 'reveal') {
          const span = el.querySelector(`[data-key="${index}"]`);
          const revealed = span.classList.toggle('is-revealed');
          span.textContent = revealed ? key.key : maskValue(key.key);
          button.innerHTML = icon(revealed ? 'eyeOff' : 'eye');
          return;
        }
        if (button.dataset.action === 'copy') {
          await copyText(key.key);
          return;
        }
        if (button.dataset.action === 'delete') {
          const confirmed = await confirmAction({
            title: '删除 API Key',
            message: `删除「${key.name}」后，使用该 Key 的脚本会立即失效。确定删除吗？`,
            confirmText: '删除',
          });
          if (!confirmed) return;
          try {
            await api('/api/apikeys/delete', { id: key.id });
            toast('API Key 已删除', 'success');
            VIEWS.security.render(el);
          } catch (error) {
            toast(error.message, 'error');
          }
        }
      });
    });
  },
};

function openCreateApiKey(onCreated) {
  const modal = openModal({
    title: '新建 API Key',
    body: `
      <form class="form" id="key-form" novalidate>
        <label class="field">
          <span>名称</span>
          <input class="input" name="name" maxlength="32" placeholder="例如：监控脚本、CI 部署" required autofocus />
          <small class="field-hint">名称仅用于区分用途，创建后可随时删除该 Key。</small>
        </label>
        <div class="alert alert-error" data-error hidden></div>
      </form>`,
    footer: `<button class="btn btn-secondary" type="button" data-close>取消</button>
             <button class="btn btn-primary" type="button" id="key-create">创建</button>`,
  });

  const form = modal.el.querySelector('#key-form');
  const createButton = modal.el.querySelector('#key-create');
  let submitting = false;

  createButton.addEventListener('click', async () => {
    if (submitting) return;
    const values = formValues(form);
    if (!values.name.trim()) {
      showError(form.querySelector('[data-error]'), '请输入名称');
      return;
    }
    submitting = true;
    setBusy(createButton, true, '创建中…');
    try {
      const data = await api('/api/apikeys/create', { name: values.name.trim() });
      modal.close();
      showApiKeyResult(data.api_key, onCreated);
    } catch (error) {
      showError(form.querySelector('[data-error]'), error.message);
    } finally {
      submitting = false;
      setBusy(createButton, false);
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    createButton.click();
  });
}

function showApiKeyResult(apiKey, onCreated) {
  openModal({
    title: 'API Key 已创建',
    subtitle: '请复制保存，页面关闭后仍可在列表中查看',
    body: `
      <div class="field">
        <span class="field-label">名称</span>
        <p class="mt-2">${esc(apiKey.name)}</p>
      </div>
      <div class="field mt-4">
        <span class="field-label">Key</span>
        <div class="copy-box mt-2">
          <code>${esc(apiKey.key)}</code>
          <button class="icon-btn" type="button" data-copy="${esc(apiKey.key)}" aria-label="复制 API Key">${icon('copy')}</button>
        </div>
      </div>
      <div class="alert alert-info mt-4">${icon('alert')}<span>API Key 等同于账号的写权限，请勿泄露到公开仓库或前端代码中。</span></div>`,
    footer: '<button class="btn btn-primary" type="button" data-close>我知道了</button>',
    onClose: () => onCreated?.(),
  });
}

/* ------------------------------ 管理后台 ------------------------------ */

VIEWS.admin = {
  title: '管理后台',
  async render(el) {
    el.innerHTML = `<div class="skeleton skeleton-title"></div><div class="skeleton"></div>`;
    let stats;
    let codes;
    let users;
    try {
      const [statsData, codesData, usersData] = await Promise.all([
        api('/api/admin/stats'),
        api('/api/admin/codes/list'),
        api('/api/admin/users/list'),
      ]);
      stats = statsData.stats;
      codes = codesData.registration_codes;
      users = usersData.users;
    } catch (error) {
      renderErrorCard(el, error, () => VIEWS.admin.render(el));
      return;
    }

    const codeRows = codes.length
      ? codes
          .map((code) => {
            const statusMap = {
              active: '<span class="badge badge-success">可用</span>',
              used: '<span class="badge">已用完</span>',
              expired: '<span class="badge badge-warning">已过期</span>',
              revoked: '<span class="badge badge-danger">已吊销</span>',
            };
            return `<tr>
              <td>${esc(code.label || '—')}</td>
              <td>${statusMap[code.status] ?? esc(code.status)}</td>
              <td class="nowrap">${code.used_count} / ${code.max_uses}</td>
              <td class="nowrap cell-muted">${esc(code.created_at_display)}</td>
              <td class="nowrap cell-muted">${code.expires_at_display ? esc(code.expires_at_display) : '永久有效'}</td>
              <td class="nowrap cell-muted">${code.last_used_by ? esc(code.last_used_by) : '—'}</td>
              <td><div class="cell-actions">
                ${
                  code.status === 'active'
                    ? `<button class="icon-btn danger" type="button" data-revoke="${code.id}" aria-label="吊销注册码" title="吊销">${icon('trash')}</button>`
                    : ''
                }
              </div></td>
            </tr>`;
          })
          .join('')
      : '';

    const userRows = users.length
      ? users
          .map(
            (user) => `
        <tr>
          <td>
            <div class="row-between">
              <div>
                <div class="feedback-title">${esc(user.display_name || user.username)}</div>
                <div class="feedback-meta">@${esc(user.username)}</div>
              </div>
            </div>
          </td>
          <td>${user.role === 'admin' ? '<span class="badge badge-primary">管理员</span>' : '<span class="badge">用户</span>'}</td>
          <td class="nowrap">${formatNumber(user.info_count)}</td>
          <td class="nowrap">${formatNumber(user.feedback_count)}</td>
          <td class="nowrap">${formatNumber(user.api_key_count)}</td>
          <td class="nowrap">
            <div class="storage-cell">
              <span>${formatBytes(user.storage_used)} / ${formatBytes(user.storage_quota)}</span>
              <progress class="quota-bar small" value="${user.storage_used}" max="${user.storage_quota || 1}"></progress>
            </div>
          </td>
          <td class="nowrap cell-muted">${esc(user.created_at_display)}</td>
          <td class="nowrap cell-muted">${user.last_login_at ? esc(user.last_login_at.slice(0, 16).replace('T', ' ')) : '—'}</td>
          <td>
            <div class="cell-actions">
              <button class="icon-btn" type="button" data-quota="${user.id}" data-username="${esc(user.username)}" data-quota-mb="${Math.round((user.storage_quota || 0) / (1024 * 1024))}" aria-label="调整存储空间" title="调整存储空间">${icon('hardDrive')}</button>
              <button class="icon-btn" type="button" data-reset="${user.id}" data-username="${esc(user.username)}" aria-label="重置密码" title="重置密码">${icon('key')}</button>
              ${
                user.id === state.user.id
                  ? ''
                  : `<button class="icon-btn danger" type="button" data-delete-user="${user.id}" data-username="${esc(user.username)}" aria-label="删除用户" title="删除用户">${icon('trash')}</button>`
              }
            </div>
          </td>
        </tr>`,
          )
          .join('')
      : '';

    el.innerHTML = `
      <header class="page-header">
        <div>
          <h1 class="page-title">管理后台</h1>
          <p class="page-subtitle">生成注册码、管理用户与查看平台整体数据。</p>
        </div>
        <div class="page-actions">
          <span class="badge">${esc(state.version ? `v${state.version}` : '')}</span>
        </div>
      </header>

      <section class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">${icon('users')}用户</div>
          <div class="stat-value">${formatNumber(stats.users)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${icon('shield')}管理员</div>
          <div class="stat-value">${formatNumber(stats.admins)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${icon('send')}固定信息</div>
          <div class="stat-value">${formatNumber(stats.information)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${icon('message')}反馈会话</div>
          <div class="stat-value">${formatNumber(stats.feedback)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${icon('inbox')}未读反馈</div>
          <div class="stat-value">${formatNumber(stats.unread)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${icon('ticket')}有效注册码</div>
          <div class="stat-value">${formatNumber(stats.active_codes)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${icon('folder')}文件</div>
          <div class="stat-value">${formatNumber(stats.files)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${icon('hardDrive')}存储用量</div>
          <div class="stat-value">${formatBytes(stats.storage_used)}</div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">${icon('ticket')}注册码</h2>
            <p class="card-subtitle">注册码只在生成时显示一次，平台只保存其哈希值</p>
          </div>
        </div>
        <div class="card-body">
          <form class="form" id="code-form" novalidate>
            <div class="form-row">
              <label class="field">
                <span>备注</span>
                <input class="input" name="label" maxlength="40" placeholder="例如：给张三" />
              </label>
              <label class="field">
                <span>可用次数</span>
                <input class="input" name="max_uses" type="number" min="1" max="100" value="1" />
              </label>
              <label class="field">
                <span>有效天数</span>
                <input class="input" name="expires_in_days" type="number" min="0" max="365" value="7" />
                <small class="field-hint">0 表示永久有效</small>
              </label>
            </div>
            <div class="alert alert-error" data-error hidden></div>
            <div class="page-actions">
              <button class="btn btn-primary" type="submit">${icon('plus')}生成注册码</button>
            </div>
          </form>
          <div data-code-result></div>
        </div>
        <div class="card-body tight">
          ${
            codes.length
              ? `<div class="table-wrap"><table>
                   <thead><tr><th>备注</th><th>状态</th><th class="nowrap">使用</th><th class="nowrap">创建时间</th><th class="nowrap">过期时间</th><th class="nowrap">最后使用</th><th></th></tr></thead>
                   <tbody>${codeRows}</tbody>
                 </table></div>`
              : emptyState('还没有生成注册码', '生成后把注册码发给需要注册的用户。', 'ticket')
          }
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">${icon('hardDrive')}文件存储</h2>
            <p class="card-subtitle">默认空间只影响之后新注册的用户；已有用户请在下方单独调整</p>
          </div>
          <span class="badge">${formatNumber(stats.files)} 个文件 · ${formatBytes(stats.storage_used)}</span>
        </div>
        <div class="card-body">
          <form class="form" id="storage-form" novalidate>
            <div class="form-row">
              <label class="field">
                <span>新用户默认空间（MB）</span>
                <input class="input" name="default_quota_mb" type="number" min="0" max="10240" value="${Math.round(stats.default_storage_quota / (1024 * 1024))}" />
                <small class="field-hint">0 表示新用户不能上传文件；修改后不影响已注册用户。</small>
              </label>
            </div>
            <div class="alert alert-error" data-error hidden></div>
            <div class="page-actions">
              <button class="btn btn-primary" type="submit">保存默认空间</button>
            </div>
          </form>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">${icon('users')}用户</h2>
            <p class="card-subtitle">共 ${formatNumber(users.length)} 个账号</p>
          </div>
        </div>
        <div class="card-body tight">
          <div class="table-wrap"><table>
            <thead><tr><th>用户</th><th>角色</th><th class="nowrap">信息</th><th class="nowrap">反馈</th><th class="nowrap">API Key</th><th class="nowrap">存储</th><th class="nowrap">注册时间</th><th class="nowrap">最近登录</th><th></th></tr></thead>
            <tbody>${userRows}</tbody>
          </table></div>
        </div>
      </section>`;

    onSubmit(el.querySelector('#code-form'), async () => {
      const values = formValues(el.querySelector('#code-form'));
      const data = await api('/api/admin/codes/create', {
        label: values.label,
        max_uses: Number(values.max_uses || 1),
        expires_in_days: Number(values.expires_in_days || 0),
      });
      toast('注册码已生成', 'success');
      // 重新渲染以刷新注册码列表，再把一次性可见的注册码展示在新页面顶部。
      await VIEWS.admin.render(el);
      const resultEl = el.querySelector('[data-code-result]');
      if (resultEl) {
        resultEl.innerHTML = `
          <div class="alert alert-success mt-4">${icon('check')}<span>注册码已生成，请立即复制（刷新后无法再次查看）：</span></div>
          <div class="code-highlight mt-2">${esc(data.code)}</div>
          <div class="page-actions mt-2">
            <button class="btn btn-secondary btn-sm" type="button" data-copy="${esc(data.code)}">${icon('copy')}复制注册码</button>
          </div>`;
      }
    });

    onSubmit(el.querySelector('#storage-form'), async () => {
      const values = formValues(el.querySelector('#storage-form'));
      await api('/api/admin/storage', { default_quota_mb: Number(values.default_quota_mb || 0) });
      toast('默认存储空间已更新', 'success');
      VIEWS.admin.render(el);
    });

    el.querySelectorAll('[data-revoke]').forEach((button) => {
      button.addEventListener('click', async () => {
        const confirmed = await confirmAction({
          title: '吊销注册码',
          message: '吊销后该注册码将无法继续使用，确定继续吗？',
          confirmText: '吊销',
        });
        if (!confirmed) return;
        try {
          await api('/api/admin/codes/revoke', { id: Number(button.dataset.revoke) });
          toast('注册码已吊销', 'success');
          VIEWS.admin.render(el);
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });

    el.querySelectorAll('[data-quota]').forEach((button) => {
      button.addEventListener('click', () => {
        openUserStorage(
          Number(button.dataset.quota),
          button.dataset.username,
          Number(button.dataset.quotaMb),
          () => VIEWS.admin.render(el),
        );
      });
    });

    el.querySelectorAll('[data-reset]').forEach((button) => {
      button.addEventListener('click', () => {
        openResetPassword(Number(button.dataset.reset), button.dataset.username, () => VIEWS.admin.render(el));
      });
    });

    el.querySelectorAll('[data-delete-user]').forEach((button) => {
      button.addEventListener('click', async () => {
        const confirmed = await confirmAction({
          title: '删除用户',
          message: `删除用户「${button.dataset.username}」会同时删除其全部信息、反馈和 API Key，且不可恢复。确定继续吗？`,
          confirmText: '删除用户',
        });
        if (!confirmed) return;
        try {
          await api('/api/admin/users/delete', { id: Number(button.dataset.deleteUser) });
          toast('用户已删除', 'success');
          VIEWS.admin.render(el);
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
  },
};

function openResetPassword(userId, username, onDone) {
  const modal = openModal({
    title: '重置密码',
    subtitle: `用户 @${esc(username)}`,
    body: `
      <form class="form" id="reset-form" novalidate>
        <label class="field">
          <span>新密码</span>
          <input class="input" type="password" name="new_password" autocomplete="new-password" placeholder="至少 8 位，含字母与数字/符号" required autofocus />
          <small class="field-hint">重置后该用户的所有登录状态会立即失效。</small>
        </label>
        <div class="alert alert-error" data-error hidden></div>
      </form>`,
    footer: `<button class="btn btn-secondary" type="button" data-close>取消</button>
             <button class="btn btn-primary" type="button" id="reset-submit">重置密码</button>`,
  });

  modal.el.querySelector('#reset-submit').addEventListener('click', async () => {
    const form = modal.el.querySelector('#reset-form');
    const values = formValues(form);
    const button = modal.el.querySelector('#reset-submit');
    if (!values.new_password) {
      showError(form.querySelector('[data-error]'), '请输入新密码');
      return;
    }
    setBusy(button, true);
    try {
      await api('/api/admin/users/reset-password', { id: userId, new_password: values.new_password });
      modal.close();
      toast('密码已重置', 'success');
      onDone?.();
    } catch (error) {
      showError(form.querySelector('[data-error]'), error.message);
    } finally {
      setBusy(button, false);
    }
  });
}

function openUserStorage(userId, username, quotaMb, onDone) {
  const modal = openModal({
    title: '调整存储空间',
    subtitle: `用户 @${esc(username)}`,
    body: `
      <form class="form" id="quota-form" novalidate>
        <label class="field">
          <span>可用空间（MB）</span>
          <input class="input" name="quota_mb" type="number" min="0" max="10240" value="${quotaMb}" required autofocus />
          <small class="field-hint">0 表示禁止该用户上传文件；调低配额不会删除已有文件，但会阻止继续上传。</small>
        </label>
        <div class="alert alert-error" data-error hidden></div>
      </form>`,
    footer: `<button class="btn btn-secondary" type="button" data-close>取消</button>
             <button class="btn btn-primary" type="button" id="quota-submit">保存</button>`,
  });

  modal.el.querySelector('#quota-submit').addEventListener('click', async () => {
    const form = modal.el.querySelector('#quota-form');
    const values = formValues(form);
    const button = modal.el.querySelector('#quota-submit');
    if (values.quota_mb === '' || Number.isNaN(Number(values.quota_mb))) {
      showError(form.querySelector('[data-error]'), '请输入有效的空间大小');
      return;
    }
    setBusy(button, true);
    try {
      await api('/api/admin/users/storage', { id: userId, quota_mb: Number(values.quota_mb) });
      modal.close();
      toast('存储空间已更新', 'success');
      onDone?.();
    } catch (error) {
      showError(form.querySelector('[data-error]'), error.message);
    } finally {
      setBusy(button, false);
    }
  });
}

/* ------------------------------ API 文档 ------------------------------ */

VIEWS.docs = {
  title: 'API 文档',
  async render(el) {
    el.innerHTML = renderDocs(location.origin);
    const buttons = Array.from(el.querySelectorAll('[data-doc]'));
    const activate = (key) => {
      buttons.forEach((button) => button.classList.toggle('is-active', button.dataset.doc === key));
    };
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const target = el.querySelector(`#docs-${button.dataset.doc}`);
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        activate(button.dataset.doc);
      });
    });
    activate('quickstart');

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
          if (visible?.target?.id) activate(visible.target.id.replace('docs-', ''));
        },
        { rootMargin: '-90px 0px -65% 0px', threshold: 0 },
      );
      el.querySelectorAll('.docs-section').forEach((section) => observer.observe(section));
    }
  },
};

/* ------------------------------ 公开反馈页 ------------------------------ */

async function renderPublicPage(username) {
  document.title = `提交反馈 · ${state.appName}`;
  appEl.className = '';
  appEl.innerHTML = `<div class="public-page"><div class="public-shell"><div class="skeleton"></div></div></div>`;

  let profile;
  try {
    profile = await api('/api/public/profile', { user_name: username });
  } catch (error) {
    appEl.innerHTML = `<div class="public-page"><div class="public-shell">${alertBox('error', esc(error.message))}</div></div>`;
    return;
  }

  const brand = `
    <div class="public-brand">
      <img src="/favicon.svg" alt="" width="26" height="26" />
      <span>${esc(state.appName)}</span>
      <span>·</span>
      <a href="${state.authenticated ? '#/overview' : '#/login'}">${state.authenticated ? '返回控制台' : '登录'}</a>
    </div>`;

  if (!profile.exists) {
    appEl.innerHTML = `<div class="public-page"><div class="public-shell">
      ${brand}
      <div class="public-card">${emptyState('用户不存在', `没有找到用户「${username}」，请确认链接是否正确。`, 'user')}</div>
    </div></div>`;
    return;
  }

  const displayName = profile.display_name || profile.user_name;
  const hero = `
    <div class="public-hero">
      <h1>${esc(displayName)}</h1>
      <p>${esc(profile.intro || '欢迎留下你的反馈，我会尽快回复。')}</p>
    </div>`;

  if (!profile.enabled) {
    appEl.innerHTML = `<div class="public-page"><div class="public-shell">
      ${brand}${hero}
      <div class="public-card">${alertBox('warning', '该用户暂未开启反馈功能，请稍后再试。')}</div>
    </div></div>`;
    return;
  }

  const history = loadHistory(profile.user_name);
  const historyHtml = history.length
    ? `<section class="card mt-4">
        <div class="card-header"><h2 class="card-title">${icon('clock')}我的反馈记录</h2></div>
        <div class="card-body">
          <div class="thread-history">
            ${history
              .map(
                (item) => `<button type="button" data-history="${esc(item.id)}">
                  <span class="truncate">${esc(item.title || '反馈对话')}</span>
                  <span class="text-muted text-sm">${esc(item.time || '')}${icon('chevronRight')}</span>
                </button>`,
              )
              .join('')}
          </div>
          <p class="field-hint mt-3">记录仅保存在当前浏览器，清除浏览器数据后将无法通过此列表找回。请妥善保存 session_id。</p>
        </div>
      </section>`
    : '';

  appEl.innerHTML = `
    <div class="public-page">
      <div class="public-shell">
        ${brand}
        ${hero}
        <div class="public-card" data-panel>
          <form class="form" id="feedback-form" novalidate>
            <label class="field">
              <span>标题（可选）</span>
              <input class="input" name="title" maxlength="120" placeholder="用一句话概括反馈内容" />
            </label>
            <label class="field">
              <span>反馈内容</span>
              <textarea class="textarea" name="feedback" maxlength="10000" rows="6" placeholder="请描述你遇到的问题、建议或需求…" required></textarea>
              <small class="field-hint">提交后会得到一个 session_id，可用于后续查看和追加回复。</small>
            </label>
            <div class="alert alert-error" data-error hidden></div>
            <button class="btn btn-primary btn-block" type="submit">${icon('send')}提交反馈</button>
          </form>
        </div>
        <div data-thread></div>
        ${historyHtml}
      </div>
    </div>`;

  const form = document.getElementById('feedback-form');
  onSubmit(form, async () => {
    const values = formValues(form);
    if (!values.feedback.trim()) {
      throw new Error('反馈内容不能为空');
    }
    const data = await api('/api/sendfeedback', {
      user_name: profile.user_name,
      feedback: values.feedback,
      title: values.title,
    });
    saveHistory(profile.user_name, {
      id: data.session_id,
      title: values.title || data.title,
      time: data.created_at,
    });
    form.reset();
    toast('反馈已提交', 'success');
    showSessionNotice(data.session_id);
    await renderPublicThread(profile, data.session_id);
  });

  appEl.querySelectorAll('[data-history]').forEach((button) => {
    button.addEventListener('click', async () => {
      showSessionNotice(button.dataset.history);
      await renderPublicThread(profile, button.dataset.history);
    });
  });

  function showSessionNotice(sessionId) {
    const panel = appEl.querySelector('[data-panel]');
    if (!panel) return;
    panel.innerHTML = `
      <div class="alert alert-success">${icon('check')}<span>反馈已提交，请保存你的会话编号：</span></div>
      <div class="copy-box mt-3"><code>${esc(sessionId)}</code><button class="icon-btn" type="button" data-copy="${esc(sessionId)}" aria-label="复制 session_id">${icon('copy')}</button></div>
      <p class="field-hint mt-2">凭此编号可以在任何设备上继续对话，请勿泄露给他人。</p>`;
  }
}

async function renderPublicThread(profile, sessionId) {
  const container = appEl.querySelector('[data-thread]');
  if (!container) return;
  container.innerHTML = '<div class="skeleton mt-4"></div>';

  let thread;
  try {
    thread = await api('/api/getfeedbackbysessionid', { session_id: sessionId });
  } catch (error) {
    container.innerHTML = `<div class="mt-4">${alertBox('error', esc(error.message))}</div>`;
    return;
  }

  container.innerHTML = `
    <section class="card mt-4">
      <div class="card-header">
        <div>
          <h2 class="card-title">${icon('message')}${esc(thread.title || '反馈对话')}</h2>
          <p class="card-subtitle">${esc(thread.update_time)} 更新 · ${thread.chat.length} 条消息</p>
        </div>
        <span class="badge">${thread.status === 'unread' ? '等待回复' : '已回复'}</span>
      </div>
      <div class="card-body">
        <div class="chat">${chatHTML(thread.chat, 'visitor')}</div>
        <form class="form mt-4" id="public-reply-form">
          <label class="field">
            <span>追加回复</span>
            <textarea class="textarea" name="feedback" maxlength="10000" rows="3" placeholder="继续补充信息…" required></textarea>
          </label>
          <div class="alert alert-error" data-error hidden></div>
          <button class="btn btn-secondary" type="submit">${icon('send')}发送</button>
        </form>
      </div>
    </section>`;

  const replyForm = container.querySelector('#public-reply-form');
  onSubmit(replyForm, async () => {
    const values = formValues(replyForm);
    if (!values.feedback.trim()) {
      throw new Error('回复内容不能为空');
    }
    await api('/api/sendfeedbackbysessionid', { session_id: sessionId, feedback: values.feedback });
    toast('已发送', 'success');
    await renderPublicThread(profile, sessionId);
  });

  scrollChatToEnd(container);
}

/* ------------------------------ 公开反馈页历史 ------------------------------ */

function historyKey(username) {
  return `mdp.feedback.${username}`;
}

function loadHistory(username) {
  try {
    const raw = localStorage.getItem(historyKey(username));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(username, entry) {
  const list = loadHistory(username).filter((item) => item.id !== entry.id);
  list.unshift(entry);
  try {
    localStorage.setItem(historyKey(username), JSON.stringify(list.slice(0, 20)));
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

/* ------------------------------ 启动 ------------------------------ */

async function render() {
  const { path, segments, query } = parseRoute();

  if (!state.configured) {
    renderConfigError();
    return;
  }

  if (segments[0] === 'f' && segments[1]) {
    await renderPublicPage(decodeURIComponent(segments[1]));
    return;
  }

  if (state.needsSetup) {
    renderSetup();
    return;
  }

  if (!state.authenticated) {
    if (path === '/register') {
      renderRegister();
      return;
    }
    if (path !== '/login') {
      navigate('#/login');
      return;
    }
    renderLogin();
    return;
  }

  if (path === '/login' || path === '/register' || path === '/setup') {
    navigate('#/overview');
    return;
  }

  const viewKey = path.replace(/^\//, '') || 'overview';
  if (!VIEWS[viewKey]) {
    navigate('#/overview');
    return;
  }
  if (viewKey === 'admin' && state.user?.role !== 'admin') {
    navigate('#/overview');
    return;
  }
  renderShell(viewKey, { session: query.get('session') });
}

async function boot() {
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const copyButton = target.closest('[data-copy]');
    if (copyButton) {
      event.preventDefault();
      const value = copyButton.getAttribute('data-copy');
      if (value) copyText(value);
      return;
    }
    const codeButton = target.closest('[data-copy-code]');
    if (codeButton) {
      event.preventDefault();
      const code = codeButton.closest('.code-block')?.querySelector('code')?.textContent ?? '';
      if (code) copyText(code);
    }
  });

  window.addEventListener('hashchange', () => {
    render();
  });

  try {
    const status = await api('/api/auth/status');
    state.appName = status.app_name || state.appName;
    state.version = status.version || '';
    state.configured = status.configured !== false;
    state.needsSetup = Boolean(status.needs_setup);
    state.authenticated = Boolean(status.authenticated);
    state.user = status.user || null;
    state.timezone = status.display_timezone || state.timezone;
    state.notice = status.message || '';
  } catch (error) {
    appEl.className = '';
    appEl.innerHTML = `
      <div class="auth-page">
        <div class="auth-card">
          <div class="auth-brand">
            <img src="/favicon.svg" alt="" width="52" height="52" />
            <h1>${esc(state.appName)}</h1>
          </div>
          ${alertBox('error', esc(error.message || '无法连接到服务端'))}
          <button class="btn btn-secondary btn-block mt-4" type="button" data-reload>重试</button>
        </div>
      </div>`;
    appEl.querySelector('[data-reload]')?.addEventListener('click', () => location.reload());
    return;
  }

  await render();
}

boot();
