const modemTableBody = document.getElementById('modem-table-body');
const modemTableWrap = document.getElementById('modem-table-wrap');
const modemEmpty = document.getElementById('modem-empty');
const modemCount = document.getElementById('modem-count');
const smsFeed = document.getElementById('sms-feed');
const otpFeed = document.getElementById('otp-feed');
const smsEmpty = document.getElementById('sms-empty');
const otpEmpty = document.getElementById('otp-empty');
const connectionStatus = document.getElementById('connection-status');

const statOnline = document.getElementById('stat-online');
const statConnecting = document.getElementById('stat-connecting');
const statNoSim = document.getElementById('stat-no-sim');
const statDisabled = document.getElementById('stat-disabled');
const statSimReady = document.getElementById('stat-sim-ready');

const themeToggle = document.getElementById('theme-toggle');
const toastStack = document.getElementById('toast-stack');
const portChangeAlerts = document.getElementById('port-change-alerts');

const smsToolbar = document.getElementById('sms-toolbar');
const smsSearch = document.getElementById('sms-search');
const smsPortFilter = document.getElementById('sms-port-filter');
const smsOnlyOtp = document.getElementById('sms-only-otp');
const smsClear = document.getElementById('sms-clear');
const smsModeLabel = document.getElementById('sms-mode-label');
const smsPager = document.getElementById('sms-pager');
const smsPagerInfo = document.getElementById('sms-pager-info');
const smsPrev = document.getElementById('sms-prev');
const smsNext = document.getElementById('sms-next');

const drawer = document.getElementById('modem-drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const drawerClose = document.getElementById('drawer-close');
const drawerTitle = document.getElementById('drawer-title');
const drawerStatusBadge = document.getElementById('drawer-status-badge');
const drawerMetrics = document.getElementById('drawer-metrics');
const drawerPhoneBlock = document.getElementById('drawer-phone-block');
const drawerPhoneTag = document.getElementById('drawer-phone-tag');
const sendStatusTag = document.getElementById('send-status-tag');
const sendSmsSection = document.getElementById('send-sms-section');
const sendForm = document.getElementById('send-sms-form');
const sendPhone = document.getElementById('send-phone');
const sendMessage = document.getElementById('send-message');
const sendSubmit = document.getElementById('send-submit');
const sendHint = document.getElementById('send-hint');

const phoneSetup = document.getElementById('phone-setup');
const phoneSetupList = document.getElementById('phone-setup-list');
const phoneSetupCount = document.getElementById('phone-setup-count');
const PHONE_SETUP_COLLAPSED_KEY = 'gsm-phone-setup-collapsed';
const drawerPhoneInput = document.getElementById('drawer-phone-input');
const drawerPhoneSave = document.getElementById('drawer-phone-save');
const drawerEnabledToggle = document.getElementById('drawer-enabled-toggle');
const drawerEnabledLabel = document.getElementById('drawer-enabled-label');
const enabledConfirmOverlay = document.getElementById('enabled-confirm-overlay');
const enabledConfirmPort = document.getElementById('enabled-confirm-port');
const enabledConfirmDesc = document.getElementById('enabled-confirm-desc');
const enabledConfirmNote = document.getElementById('enabled-confirm-note');
const enabledConfirmCancel = document.getElementById('enabled-confirm-cancel');
const enabledConfirmOk = document.getElementById('enabled-confirm-ok');
const phoneConfirmOverlay = document.getElementById('phone-confirm-overlay');
const confirmPhone = document.getElementById('confirm-phone');
const confirmPort = document.getElementById('confirm-port');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmOk = document.getElementById('confirm-ok');

const helpers = window.DashboardHelpers || {};
const normalizePhoneInput =
  helpers.normalizePhoneInput ||
  function normalizePhoneInputFallback(value) {
    let digits = String(value ?? '').replace(/[\s\-().+]/g, '');
    if (digits.startsWith('84') && digits.length >= 11) {
      digits = `0${digits.slice(2)}`;
    }
    if (!digits.startsWith('0') && /^\d{9,10}$/.test(digits)) {
      digits = `0${digits}`;
    }
    return digits;
  };
const isValidPhone =
  helpers.isValidPhone ||
  function isValidPhoneFallback(value) {
    return /^0\d{9,10}$/.test(value);
  };
const pickSmsOtpCode =
  helpers.pickSmsOtpCode ||
  function pickSmsOtpCodeFallback(sms) {
    return sms?.otpCode ?? sms?.otp ?? null;
  };
const shouldPrependLiveSms =
  helpers.shouldPrependLiveSms ||
  function shouldPrependLiveSmsFallback(mode) {
    return mode === 'live';
  };

const modems = new Map();
const phoneDraftByPort = new Map();
let pendingPhoneSave = null;
let pendingEnabledSave = null;
let suppressEnabledToggleEvent = false;
let lastMissingPhonePortsKey = '';
let smsMode = 'live';
let searchPage = 1;
let searchTotalPages = 1;
let activeDrawerPort = null;
let enabledSaveInFlight = false;
let phoneSaveInFlight = false;
let sendSmsInFlight = false;

const STATUS_LABEL = {
  online: 'Online',
  offline: 'Offline',
  connecting: 'Đang kết nối',
  no_sim: 'Chưa SIM',
  disabled: 'Tắt',
};

function on(element, event, handler) {
  if (element) {
    element.addEventListener(event, handler);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

/* ── Theme ──────────────────────────────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('gsm-theme', theme);
  } catch {
    /* ignore storage errors */
  }
}

(function initTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem('gsm-theme');
  } catch {
    stored = null;
  }
  const prefersLight =
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(stored ?? (prefersLight ? 'light' : 'dark'));
})();

on(themeToggle, 'click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'light' ? 'dark' : 'light');
});

/* ── Toasts ─────────────────────────────────────────────────────────── */
function showToast(message, variant = 'info', timeout = 3600) {
  const toast = document.createElement('div');
  toast.className = `toast is-${variant}`;
  toast.textContent = message;
  toastStack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 240);
  }, timeout);
}

/* ── Port-change alerts (SIM moved to a different modem/device) ──────── */
/* From 15/6/2026, moving a SIM to a different device/IMEI requires face
   re-authentication within 2h or the line gets locked. We persist these
   alerts in localStorage so a page refresh mid-window doesn't lose them. */
const PORT_CHANGE_ALERTS_KEY = 'gsm-port-change-alerts';
const PORT_CHANGE_REAUTH_WINDOW_MS = 2 * 60 * 60 * 1000;
const portChangeAlertState = new Map();
let portChangeCountdownTimer = null;

function loadPersistedPortChangeAlerts() {
  let stored = [];
  try {
    stored = JSON.parse(localStorage.getItem(PORT_CHANGE_ALERTS_KEY) ?? '[]');
  } catch {
    stored = [];
  }
  const now = Date.now();
  for (const alert of Array.isArray(stored) ? stored : []) {
    if (!alert?.iccid || !alert?.detectedAt) continue;
    if (now - new Date(alert.detectedAt).getTime() > PORT_CHANGE_REAUTH_WINDOW_MS) {
      continue;
    }
    portChangeAlertState.set(alert.iccid, alert);
  }
  renderPortChangeAlerts();
}

function persistPortChangeAlerts() {
  try {
    localStorage.setItem(
      PORT_CHANGE_ALERTS_KEY,
      JSON.stringify(Array.from(portChangeAlertState.values())),
    );
  } catch {
    /* ignore storage errors */
  }
}

function formatCountdown(msRemaining) {
  if (msRemaining <= 0) return 'đã hết hạn';
  const totalSeconds = Math.floor(msRemaining / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `còn ${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderPortChangeAlerts() {
  if (!portChangeAlerts) return;
  const alerts = Array.from(portChangeAlertState.values()).sort(
    (a, b) => new Date(b.detectedAt) - new Date(a.detectedAt),
  );

  if (!alerts.length) {
    portChangeAlerts.classList.add('hidden');
    portChangeAlerts.innerHTML = '';
    return;
  }

  portChangeAlerts.classList.remove('hidden');
  portChangeAlerts.innerHTML = alerts
    .map((alert) => {
      const phoneLabel = alert.phone
        ? escapeHtml(alert.phone)
        : `SIM …${escapeHtml(alert.iccid.slice(-6))}`;
      const otpBlock = alert.otp
        ? `<span class="pca-otp">OTP mới nhất: <strong class="mono">${escapeHtml(alert.otp)}</strong> · dùng để hoàn tất xác thực</span>`
        : `<span class="pca-otp-wait">Đang chờ OTP xác thực đổi máy...</span>`;
      return `
        <div class="port-change-alert" data-iccid="${escapeHtml(alert.iccid)}">
          <div class="pca-head">
            <span class="pca-badge">Cần xác thực lại SIM</span>
            <button
              type="button"
              class="pca-dismiss"
              data-dismiss-iccid="${escapeHtml(alert.iccid)}"
              aria-label="Đóng cảnh báo"
            >×</button>
          </div>
          <p class="pca-desc">
            ${phoneLabel} vừa chuyển từ <strong>${escapeHtml(alert.previousPort)}</strong>
            sang <strong>${escapeHtml(alert.newPort)}</strong>. Theo quy định từ 15/6/2026,
            cần xác thực lại khuôn mặt trong vòng 2 giờ (vd. app Viettel Tammi &rarr;
            "Xác thực đổi máy") kẻo bị khóa 1 chiều.
          </p>
          <div class="pca-meta">
            <span class="pca-countdown mono" data-countdown-iccid="${escapeHtml(alert.iccid)}"
              >${formatCountdown(PORT_CHANGE_REAUTH_WINDOW_MS - (Date.now() - new Date(alert.detectedAt).getTime()))}</span
            >
            ${otpBlock}
          </div>
        </div>`;
    })
    .join('');
}

function addPortChangeAlert(data) {
  if (!data?.iccid) return;
  const existing = portChangeAlertState.get(data.iccid);
  portChangeAlertState.set(data.iccid, {
    iccid: data.iccid,
    previousPort: data.previousPort,
    newPort: data.newPort,
    phone: data.phone ?? existing?.phone ?? null,
    detectedAt: data.detectedAt,
    otp: existing?.otp ?? null,
  });
  persistPortChangeAlerts();
  renderPortChangeAlerts();
  showToast(
    `SIM đổi cổng ${data.previousPort} → ${data.newPort}. Cần xác thực khuôn mặt trong 2h.`,
    'error',
    9000,
  );
}

function attachOtpToPortChangeAlerts(port, otp) {
  let changed = false;
  for (const alert of portChangeAlertState.values()) {
    if (alert.newPort === port) {
      alert.otp = otp;
      changed = true;
    }
  }
  if (changed) {
    persistPortChangeAlerts();
    renderPortChangeAlerts();
  }
}

function dismissPortChangeAlert(iccid) {
  portChangeAlertState.delete(iccid);
  persistPortChangeAlerts();
  renderPortChangeAlerts();
}

on(portChangeAlerts, 'click', (event) => {
  const btn = event.target.closest('[data-dismiss-iccid]');
  if (!btn) return;
  dismissPortChangeAlert(btn.getAttribute('data-dismiss-iccid'));
});

loadPersistedPortChangeAlerts();
portChangeCountdownTimer = setInterval(() => {
  if (!portChangeAlertState.size) return;
  const now = Date.now();
  let expired = false;
  for (const [iccid, alert] of portChangeAlertState) {
    const remaining =
      PORT_CHANGE_REAUTH_WINDOW_MS - (now - new Date(alert.detectedAt).getTime());
    if (remaining <= 0) {
      portChangeAlertState.delete(iccid);
      expired = true;
      continue;
    }
    const el = portChangeAlerts?.querySelector(
      `[data-countdown-iccid="${CSS.escape(iccid)}"]`,
    );
    if (el) el.textContent = formatCountdown(remaining);
  }
  if (expired) {
    persistPortChangeAlerts();
    renderPortChangeAlerts();
  }
}, 1000);

function copyWithExecCommand(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

async function copyToClipboard(text) {
  // navigator.clipboard requires a secure context (HTTPS or localhost).
  // Internal deployments served over plain HTTP don't get it at all, so
  // fall back to the execCommand('copy') trick in that case.
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Đã copy: ${text}`, 'success', 2000);
      return;
    } catch {
      // fall through to legacy fallback below
    }
  }

  if (copyWithExecCommand(text)) {
    showToast(`Đã copy: ${text}`, 'success', 2000);
  } else {
    showToast('Không thể copy', 'error');
  }
}

function setConnectionState(state, label) {
  connectionStatus.classList.remove('is-live', 'is-fallback', 'is-error');
  connectionStatus.classList.add(state);
  connectionStatus.querySelector('.connection-label').textContent = label;
}

function isMissingPhone(modem) {
  return (
    modem.enabled !== false &&
    modem.status !== 'disabled' &&
    modem.status !== 'no_sim' &&
    !modem.phone
  );
}

function openPhoneConfirm(port, phone) {
  pendingPhoneSave = { port, phone };
  confirmPort.textContent = port;
  confirmPhone.textContent = phone;
  phoneConfirmOverlay.classList.remove('hidden');
  phoneConfirmOverlay.hidden = false;
  confirmOk.focus();
}

function closePhoneConfirm() {
  pendingPhoneSave = null;
  phoneConfirmOverlay.classList.add('hidden');
  phoneConfirmOverlay.hidden = true;
}

async function savePhoneOverride(port, phone) {
  const res = await fetch(
    `/api/modems/${encodeURIComponent(port)}/phone`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone }),
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(payload.message)
      ? payload.message.join(', ')
      : payload.message ?? 'Lưu số SIM thất bại';
    throw new Error(message);
  }

  phoneDraftByPort.delete(port);
  modems.set(port, payload);
  lastMissingPhonePortsKey = '';
  renderModems();
  showToast(`Đã lưu ${phone} cho ${port}`, 'success');
  return payload;
}

function requestPhoneSave(port, rawPhone) {
  const phone = normalizePhoneInput(rawPhone);
  if (!isValidPhone(phone)) {
    showToast('Số không hợp lệ. Nhập dạng 0xxxxxxxxx', 'error');
    return;
  }
  openPhoneConfirm(port, phone);
}

function isPhoneSetupCollapsed() {
  try {
    return localStorage.getItem(PHONE_SETUP_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function persistPhoneSetupCollapsed(collapsed) {
  try {
    localStorage.setItem(PHONE_SETUP_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore storage errors */
  }
}

function initPhoneSetupCollapse() {
  if (!phoneSetup) {
    return;
  }
  phoneSetup.open = !isPhoneSetupCollapsed();
}

if (phoneSetup) {
  phoneSetup.addEventListener('toggle', () => {
    persistPhoneSetupCollapsed(!phoneSetup.open);
  });
  initPhoneSetupCollapse();
}

function capturePhoneDraftsFromDom() {
  if (!phoneSetupList) {
    return;
  }
  for (const input of phoneSetupList.querySelectorAll('.phone-setup-input')) {
    if (input.dataset.port) {
      phoneDraftByPort.set(input.dataset.port, input.value);
    }
  }
}

function buildPhoneSetupItem(modem) {
  const draft = phoneDraftByPort.get(modem.port) ?? '';
  return `
      <li class="phone-setup-item">
        <span class="phone-setup-port">${escapeHtml(modem.port)}</span>
        <input
          type="tel"
          class="input mono phone-setup-input"
          data-port="${escapeHtml(modem.port)}"
          value="${escapeHtml(draft)}"
          placeholder="0924033230"
          inputmode="numeric"
          autocomplete="off"
        />
        <button
          type="button"
          class="btn btn-accent phone-setup-save"
          data-port="${escapeHtml(modem.port)}"
        >
          Lưu
        </button>
      </li>
    `;
}

function renderPhoneSetup() {
  const missing = [...modems.values()]
    .filter(isMissingPhone)
    .sort((a, b) => a.port.localeCompare(b.port, undefined, { numeric: true }));

  if (!missing.length) {
    if (phoneSetup) {
      phoneSetup.hidden = true;
    }
    if (phoneSetupList) {
      phoneSetupList.innerHTML = '';
    }
    lastMissingPhonePortsKey = '';
    return;
  }

  const portsKey = missing.map((modem) => modem.port).join('|');

  if (phoneSetup) {
    phoneSetup.hidden = false;
  }
  if (phoneSetupCount) {
    phoneSetupCount.textContent = `${missing.length} cổng`;
  }

  if (portsKey === lastMissingPhonePortsKey) {
    return;
  }

  capturePhoneDraftsFromDom();
  lastMissingPhonePortsKey = portsKey;
  if (phoneSetupList) {
    phoneSetupList.innerHTML = missing.map(buildPhoneSetupItem).join('');
  }
}

function renderSimPill(modem) {
  if (modem.status === 'disabled') {
    return '<span class="sim-pill disabled">Tắt</span>';
  }

  if (modem.status === 'no_sim') {
    return '<span class="sim-pill empty">Empty</span>';
  }

  return `<span class="sim-pill ${modem.simReady ? 'ready' : 'not-ready'}">${modem.simReady ? 'Ready' : 'Waiting'}</span>`;
}

function renderSignalBars(signal) {
  if (signal == null || Number.isNaN(signal)) {
    return '<span class="mono">—</span>';
  }

  const activeBars = Math.max(1, Math.min(5, Math.round(signal / 6)));
  const bars = Array.from({ length: 5 }, (_, index) => {
    const height = 6 + index * 3;
    const active = index < activeBars ? 'is-active' : '';
    return `<span class="signal-bar ${active}" style="height:${height}px"></span>`;
  }).join('');

  return `<span class="signal-meter" aria-label="Signal ${signal}">${bars}</span><span class="mono" style="margin-left:8px">${signal}</span>`;
}

function updateStats() {
  const rows = [...modems.values()];
  const online = rows.filter((item) => item.status === 'online').length;
  const connecting = rows.filter((item) => item.status === 'connecting').length;
  const noSim = rows.filter((item) => item.status === 'no_sim').length;
  const disabled = rows.filter((item) => item.status === 'disabled').length;
  const active = rows.length - disabled;
  const simReady = rows.filter((item) => item.simReady).length;

  statOnline.textContent = String(online);
  statConnecting.textContent = String(connecting);
  statNoSim.textContent = String(noSim);
  statDisabled.textContent = String(disabled);
  statSimReady.textContent = String(simReady);
  modemCount.textContent = `${active} active · ${rows.length} total`;
}

function renderModems() {
  const rows = [...modems.values()].sort((a, b) =>
    a.port.localeCompare(b.port, undefined, { numeric: true }),
  );

  updateStats();

  if (!rows.length) {
    modemTableWrap.classList.add('hidden');
    modemEmpty.classList.remove('hidden');
    modemTableBody.innerHTML = '';
    return;
  }

  modemTableWrap.classList.remove('hidden');
  modemEmpty.classList.add('hidden');

  modemTableBody.innerHTML = rows
    .map(
      (modem) => {
        const phoneClass = isMissingPhone(modem) ? 'phone-missing' : 'phone-known';
        const phoneLabel = modem.phone ?? '-';
        const errorBadge = modem.lastError
          ? `<span class="error-badge" title="${escapeHtml(modem.lastError)}">⚠</span>`
          : '';
        return `
      <tr class="clickable" data-port="${escapeHtml(modem.port)}" tabindex="0" role="button" aria-label="Chi tiết ${escapeHtml(modem.port)}">
        <td class="mono">${escapeHtml(modem.port)}</td>
        <td><span class="status-badge status-${escapeHtml(modem.status)}">${escapeHtml(STATUS_LABEL[modem.status] ?? modem.status)}</span>${errorBadge}</td>
        <td>${renderSignalBars(modem.signal)}</td>
        <td>${escapeHtml(modem.operator ?? '-')}</td>
        <td class="mono ${phoneClass}">${escapeHtml(phoneLabel)}</td>
        <td>${renderSimPill(modem)}</td>
      </tr>
    `;
      },
    )
    .join('');

  renderPhoneSetup();

  if (activeDrawerPort && modems.has(activeDrawerPort)) {
    renderDrawerDetail(modems.get(activeDrawerPort));
  }
}

function toggleFeedEmpty(list, emptyEl) {
  const hasItems = list.children.length > 0;
  emptyEl.classList.toggle('hidden', hasItems);
}

function prependFeedItem(list, emptyEl, html, maxItems = 50) {
  const item = document.createElement('li');
  item.innerHTML = html;
  list.prepend(item);
  trimFeed(list, maxItems);
  toggleFeedEmpty(list, emptyEl);
}

function appendFeedItem(list, emptyEl, html) {
  const item = document.createElement('li');
  item.innerHTML = html;
  list.appendChild(item);
  toggleFeedEmpty(list, emptyEl);
}

function trimFeed(list, maxItems) {
  while (list.children.length > maxItems) {
    list.removeChild(list.lastChild);
  }
}

function buildSmsItem(port, body, meta, sender, otp) {
  const bodyHtml = sender
    ? `<span class="sender">${escapeHtml(sender)}</span> ${escapeHtml(body)}`
    : escapeHtml(body);
  const otpTag = otp
    ? `<div class="feed-otp-row"><span class="otp-chip copyable otp-code feed-otp-tag" data-otp="${escapeHtml(otp)}" title="Copy OTP">${escapeHtml(otp)}</span></div>`
    : '';
  return `
    <div class="feed-row">
      <span class="feed-port">${escapeHtml(port)}</span>
      <p class="feed-body">${bodyHtml}</p>
      <time class="feed-meta">${escapeHtml(meta)}</time>
      ${otpTag}
    </div>
  `;
}

function buildOtpItem(port, otp, meta) {
  return `
    <span class="feed-port">${escapeHtml(port)}</span>
    <div class="otp-chip copyable otp-code" data-otp="${escapeHtml(otp)}" title="Copy OTP">${escapeHtml(otp)}</div>
    <time class="feed-meta">${escapeHtml(meta)}</time>
  `;
}

/* ── Initial / live load ────────────────────────────────────────────── */
async function loadModems() {
  const res = await fetch('/api/modems');
  if (!res.ok) {
    throw new Error('modems request failed');
  }
  const modemList = await res.json();
  modems.clear();
  modemList.forEach((modem) => modems.set(modem.port, modem));
  renderModems();
}

async function loadLiveMessages() {
  const res = await fetch('/api/messages?page=1&pageSize=25');
  if (!res.ok) {
    throw new Error('messages request failed');
  }
  const payload = await res.json();
  const messages = payload.data ?? [];

  smsFeed.innerHTML = '';
  [...messages].reverse().forEach((message) => {
    appendFeedItem(
      smsFeed,
      smsEmpty,
      buildSmsItem(
        message.modemPort,
        message.message,
        formatDate(message.receivedAt),
        message.sender,
        message.otpCode,
      ),
    );
    if (message.otpCode) {
      appendFeedItem(
        otpFeed,
        otpEmpty,
        buildOtpItem(
          message.modemPort,
          message.otpCode,
          formatDate(message.receivedAt),
        ),
      );
    }
  });

  toggleFeedEmpty(smsFeed, smsEmpty);
  toggleFeedEmpty(otpFeed, otpEmpty);
}

async function loadInitialData() {
  setConnectionState('', 'Đang tải dữ liệu...');
  await Promise.all([loadModems(), loadLiveMessages()]);
}

/* ── Search mode ────────────────────────────────────────────────────── */
function enterLiveMode() {
  smsMode = 'live';
  smsPager.classList.add('hidden');
  smsModeLabel.textContent = 'Realtime từ tất cả cổng';
  loadLiveMessages().catch(() => showToast('Không tải được SMS', 'error'));
}

async function runSearch(page = 1) {
  smsMode = 'search';
  searchPage = page;

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', '20');
  if (smsSearch.value.trim()) params.set('search', smsSearch.value.trim());
  if (smsPortFilter.value.trim())
    params.set('port', smsPortFilter.value.trim().toUpperCase());
  if (smsOnlyOtp.checked) params.set('onlyOtp', 'true');

  try {
    const res = await fetch(`/api/messages?${params.toString()}`);
    if (!res.ok) {
      throw new Error('search failed');
    }
    const payload = await res.json();
    const messages = payload.data ?? [];
    searchTotalPages = payload.meta?.totalPages ?? 1;

    smsFeed.innerHTML = '';
    messages.forEach((message) => {
      appendFeedItem(
        smsFeed,
        smsEmpty,
        buildSmsItem(
          message.modemPort,
          message.message,
          formatDate(message.receivedAt),
          message.sender,
          message.otpCode,
        ),
      );
    });
    toggleFeedEmpty(smsFeed, smsEmpty);

    smsModeLabel.textContent = `Tìm kiếm · ${payload.meta?.total ?? messages.length} tin`;
    smsPager.classList.remove('hidden');
    smsPagerInfo.textContent = `Trang ${searchPage}/${searchTotalPages}`;
    smsPrev.disabled = searchPage <= 1;
    smsNext.disabled = searchPage >= searchTotalPages;
  } catch {
    showToast('Tìm kiếm thất bại', 'error');
  }
}

on(smsToolbar, 'submit', (event) => {
  event.preventDefault();
  runSearch(1);
});

on(smsClear, 'click', () => {
  smsSearch.value = '';
  smsPortFilter.value = '';
  smsOnlyOtp.checked = false;
  enterLiveMode();
});

on(smsPrev, 'click', () => {
  if (searchPage > 1) runSearch(searchPage - 1);
});

on(smsNext, 'click', () => {
  if (searchPage < searchTotalPages) runSearch(searchPage + 1);
});

/* ── Copy OTP (event delegation) ────────────────────────────────────── */
document.addEventListener('click', (event) => {
  const target = event.target.closest('.otp-code.copyable');
  if (target?.dataset.otp) {
    copyToClipboard(target.dataset.otp);
  }
});

/* ── Modem drawer ───────────────────────────────────────────────────── */
function simDrawerLabel(modem) {
  if (modem.status === 'disabled') return 'Tắt';
  if (modem.status === 'no_sim') return 'Empty';
  return modem.simReady ? 'Ready' : 'Waiting';
}

function syncDrawerEnabledToggle(modem) {
  if (!drawerEnabledToggle || !drawerEnabledLabel) {
    return;
  }
  const enabled = modem.enabled !== false;
  suppressEnabledToggleEvent = true;
  drawerEnabledToggle.checked = enabled;
  drawerEnabledLabel.textContent = enabled ? 'Bật' : 'Tắt';
  suppressEnabledToggleEvent = false;
}

function renderDrawerMetric(label, value, tone = '') {
  const toneClass = tone ? ` drawer-metric-value-${tone}` : '';
  return `
    <div class="drawer-metric">
      <span class="drawer-metric-label">${escapeHtml(label)}</span>
      <span class="drawer-metric-value mono${toneClass}">${escapeHtml(value)}</span>
    </div>
  `;
}

function renderDrawerDetail(modem) {
  if (!modem || !drawer) {
    return;
  }

  if (drawerTitle) {
    drawerTitle.textContent = modem.port;
  }

  const statusLabel = STATUS_LABEL[modem.status] ?? modem.status;
  if (drawerStatusBadge) {
    drawerStatusBadge.className = `drawer-status-badge status-${modem.status}`;
    drawerStatusBadge.textContent = statusLabel;
  }

  const enabledLabel = modem.enabled !== false ? 'Bật' : 'Tắt';
  const enabledTone = modem.enabled !== false ? 'ok' : 'muted';
  const simLabel = simDrawerLabel(modem);
  const simTone =
    modem.status === 'no_sim'
      ? 'muted'
      : modem.simReady
        ? 'ok'
        : 'warn';

  if (drawerMetrics) {
    const metrics = [
      renderDrawerMetric(
        'Signal',
        modem.signal == null ? '—' : String(modem.signal),
      ),
      renderDrawerMetric('Operator', modem.operator ?? '—'),
      renderDrawerMetric('Phone', modem.phone ?? '—', modem.phone ? '' : 'warn'),
      renderDrawerMetric('SIM', simLabel, simTone),
      renderDrawerMetric('ICCID', modem.iccid ? modem.iccid.slice(0, 10) + '…' : '—'),
      renderDrawerMetric('Monitor', enabledLabel, enabledTone),
    ];

    if (modem.lastError) {
      metrics.push(renderDrawerMetric('Lỗi gần nhất', modem.lastError, 'error'));
    }

    drawerMetrics.innerHTML = metrics.join('');
  }

  syncDrawerEnabledToggle(modem);

  const portDisabled = modem.status === 'disabled' || modem.enabled === false;
  const canSend = modem.status === 'online' && !portDisabled;

  if (drawerPhoneBlock) {
    drawerPhoneBlock.classList.toggle(
      'drawer-panel-highlight',
      isMissingPhone(modem),
    );
  }
  if (drawerPhoneTag) {
    drawerPhoneTag.textContent = modem.phone ?? 'Chưa có';
    drawerPhoneTag.className = `drawer-panel-tag mono${modem.phone ? ' is-ok' : ' is-warn'}`;
  }
  if (drawerPhoneSave) {
    drawerPhoneSave.disabled = portDisabled;
  }

  if (sendSmsSection) {
    sendSmsSection.classList.toggle('drawer-panel-muted', !canSend);
  }
  if (sendSubmit) {
    sendSubmit.disabled = !canSend;
  }
  if (sendStatusTag) {
    sendStatusTag.textContent = canSend ? 'Sẵn sàng' : 'Chờ online';
    sendStatusTag.className = `drawer-panel-tag mono${canSend ? ' is-ok' : ' is-warn'}`;
  }

  if (sendHint) {
    if (!canSend) {
      sendHint.className = 'drawer-alert is-warn';
      sendHint.textContent =
        modem.enabled === false || modem.status === 'disabled'
          ? 'Cổng đang tắt. Bật monitor để gửi SMS.'
          : 'Modem chưa online, không thể gửi SMS.';
    } else {
      sendHint.className = 'drawer-alert hidden';
      sendHint.textContent = '';
    }
  }
}

function openDrawer(port) {
  try {
    const modem = modems.get(port);
    if (!modem || !drawer || !drawerOverlay) {
      return;
    }

    activeDrawerPort = port;
    renderDrawerDetail(modem);

    if (drawerPhoneInput) {
      drawerPhoneInput.value =
        modem.phone ?? phoneDraftByPort.get(port) ?? '';
    }
    if (sendPhone) {
      sendPhone.value = '';
    }
    if (sendMessage) {
      sendMessage.value = '';
    }

    drawer.classList.remove('hidden');
    drawerOverlay.classList.remove('hidden');
    drawer.setAttribute('aria-hidden', 'false');
    drawerOverlay.setAttribute('aria-hidden', 'false');

    if (sendPhone) {
      sendPhone.focus();
    } else if (drawerClose) {
      drawerClose.focus();
    }
  } catch (error) {
    console.error('openDrawer failed', port, error);
    showToast('Không mở được chi tiết cổng', 'error');
  }
}

function closeDrawer() {
  activeDrawerPort = null;
  if (drawer) {
    drawer.classList.add('hidden');
    drawer.setAttribute('aria-hidden', 'true');
  }
  if (drawerOverlay) {
    drawerOverlay.classList.add('hidden');
    drawerOverlay.setAttribute('aria-hidden', 'true');
  }
}

document.addEventListener('click', (event) => {
  const row = event.target.closest('#modem-table-body tr.clickable');
  if (row?.dataset.port) {
    openDrawer(row.dataset.port);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('#modem-table-body tr.clickable');
  if (!row?.dataset.port) return;
  event.preventDefault();
  openDrawer(row.dataset.port);
});

on(phoneSetupList, 'input', (event) => {
  const input = event.target.closest('.phone-setup-input');
  if (input?.dataset.port) {
    phoneDraftByPort.set(input.dataset.port, input.value);
  }
});

on(phoneSetupList, 'click', (event) => {
  const button = event.target.closest('.phone-setup-save');
  if (!button?.dataset.port) return;
  const row = button.closest('.phone-setup-item');
  const input = row?.querySelector('.phone-setup-input');
  if (!input) return;
  requestPhoneSave(button.dataset.port, input.value);
});

on(phoneSetupList, 'keydown', (event) => {
  if (event.key !== 'Enter') return;
  const input = event.target.closest('.phone-setup-input');
  if (!input?.dataset.port) return;
  event.preventDefault();
  requestPhoneSave(input.dataset.port, input.value);
});

on(drawerPhoneSave, 'click', () => {
  if (!activeDrawerPort || !drawerPhoneInput) return;
  requestPhoneSave(activeDrawerPort, drawerPhoneInput.value);
});

function openEnabledConfirm(port, enabled) {
  pendingEnabledSave = { port, enabled };
  enabledConfirmPort.textContent = port;
  enabledConfirmDesc.innerHTML = enabled
    ? `Bật lại monitor cho cổng <strong class="mono">${escapeHtml(port)}</strong>?`
    : `Tắt monitor cho cổng <strong class="mono">${escapeHtml(port)}</strong>?`;
  enabledConfirmNote.textContent = enabled
    ? 'Service sẽ bắt đầu kết nối lại cổng nếu thiết bị có trong hệ thống. Thay đổi ghi vào config/modems.yaml.'
    : 'Service sẽ ngừng monitor cổng và không reconnect. Thay đổi ghi vào config/modems.yaml.';
  enabledConfirmOk.textContent = enabled ? 'Bật cổng' : 'Tắt cổng';
  enabledConfirmOverlay.classList.remove('hidden');
  enabledConfirmOverlay.hidden = false;
  enabledConfirmOk.focus();
}

function closeEnabledConfirm() {
  const port = pendingEnabledSave?.port ?? activeDrawerPort;
  pendingEnabledSave = null;
  enabledConfirmOverlay.classList.add('hidden');
  enabledConfirmOverlay.hidden = true;
  if (port && modems.has(port) && activeDrawerPort === port) {
    renderDrawerDetail(modems.get(port));
  }
}

async function savePortEnabled(port, enabled) {
  const res = await fetch(
    `/api/modems/${encodeURIComponent(port)}/enabled`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(payload.message)
      ? payload.message.join(', ')
      : payload.message ?? 'Cập nhật cổng thất bại';
    throw new Error(message);
  }

  modems.set(port, payload);
  lastMissingPhonePortsKey = '';
  renderModems();
  showToast(
    enabled ? `Đã bật monitor ${port}` : `Đã tắt monitor ${port}`,
    'success',
  );
  return payload;
}

if (drawerEnabledToggle) {
  drawerEnabledToggle.addEventListener('change', () => {
    if (suppressEnabledToggleEvent || !activeDrawerPort) return;
    const modem = modems.get(activeDrawerPort);
    if (!modem) return;

    const nextEnabled = drawerEnabledToggle.checked;
    syncDrawerEnabledToggle(modem);
    openEnabledConfirm(activeDrawerPort, nextEnabled);
  });
}

on(enabledConfirmCancel, 'click', closeEnabledConfirm);

on(enabledConfirmOverlay, 'click', (event) => {
  if (event.target === enabledConfirmOverlay) {
    closeEnabledConfirm();
  }
});

on(enabledConfirmOk, 'click', async () => {
  if (!pendingEnabledSave || enabledSaveInFlight) return;
  const { port, enabled } = pendingEnabledSave;
  enabledSaveInFlight = true;
  enabledConfirmOk.disabled = true;
  try {
    const payload = await savePortEnabled(port, enabled);
    closeEnabledConfirm();
    if (activeDrawerPort === port) {
      renderDrawerDetail(payload);
    }
  } catch (error) {
    showToast(error.message ?? 'Cập nhật thất bại', 'error');
  } finally {
    enabledSaveInFlight = false;
    enabledConfirmOk.disabled = false;
  }
});

on(confirmCancel, 'click', closePhoneConfirm);

on(phoneConfirmOverlay, 'click', (event) => {
  if (event.target === phoneConfirmOverlay) {
    closePhoneConfirm();
  }
});

on(confirmOk, 'click', async () => {
  if (!pendingPhoneSave || phoneSaveInFlight) return;
  const { port, phone } = pendingPhoneSave;
  phoneSaveInFlight = true;
  confirmOk.disabled = true;
  try {
    await savePhoneOverride(port, phone);
    closePhoneConfirm();
    if (activeDrawerPort === port) {
      drawerPhoneInput.value = phone;
    }
  } catch (error) {
    showToast(error.message ?? 'Lưu thất bại', 'error');
  } finally {
    phoneSaveInFlight = false;
    confirmOk.disabled = false;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !enabledConfirmOverlay.classList.contains('hidden')) {
    closeEnabledConfirm();
    return;
  }
  if (event.key === 'Escape' && !phoneConfirmOverlay.classList.contains('hidden')) {
    closePhoneConfirm();
    return;
  }
  if (event.key === 'Escape' && drawer && !drawer.classList.contains('hidden')) {
    closeDrawer();
  }
});

on(drawerClose, 'click', closeDrawer);
on(drawerOverlay, 'click', closeDrawer);

on(sendForm, 'submit', async (event) => {
  event.preventDefault();
  if (!activeDrawerPort || sendSmsInFlight) return;

  const phone = sendPhone.value.trim();
  const message = sendMessage.value.trim();
  if (!phone || !message) return;

  sendSmsInFlight = true;
  sendSubmit.disabled = true;
  sendHint.className = 'drawer-alert is-info';
  sendHint.classList.remove('hidden');
  sendHint.textContent = 'Đang gửi…';

  try {
    const res = await fetch(
      `/api/modems/${encodeURIComponent(activeDrawerPort)}/send-sms`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, message }),
      },
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMessage = Array.isArray(payload.message)
        ? payload.message.join(', ')
        : payload.message ?? 'Gửi SMS thất bại';
      const err = new Error(errMessage);
      err.suggestion = payload.details?.suggestion ?? '';
      throw err;
    }
    sendHint.className = 'drawer-alert is-success';
    sendHint.classList.remove('hidden');
    sendHint.textContent = `Đã gửi tới ${phone}`;
    sendMessage.value = '';
    showToast(`SMS đã gửi qua ${activeDrawerPort}`, 'success');
  } catch (error) {
    const text = error.message || 'Gửi SMS thất bại';
    const suggestion = error.suggestion || '';
    sendHint.className = 'drawer-alert is-error';
    sendHint.classList.remove('hidden');
    sendHint.innerHTML = `<strong>${escapeHtml(text)}</strong>${suggestion ? `<br><small class="error-suggestion">${escapeHtml(suggestion)}</small>` : ''}`;
    showToast(text, 'error', 6000);
  } finally {
    sendSmsInFlight = false;
    sendSubmit.disabled = false;
  }
});

/* ── Socket / realtime ──────────────────────────────────────────────── */
function connectSocket() {
  const socket = io();

  socket.on('connect', () => {
    setConnectionState('is-live', 'WebSocket đang kết nối');
  });

  socket.on('disconnect', () => {
    setConnectionState('is-fallback', 'WebSocket mất kết nối · dùng polling');
  });

  socket.on('modem.status', (modem) => {
    modems.set(modem.port, modem);
    renderModems();
  });

  socket.on('modem.removed', (payload) => {
    const port = payload?.port;
    if (!port) return;
    modems.delete(port);
    if (activeDrawerPort === port) {
      closeDrawer();
    }
    lastMissingPhonePortsKey = '';
    renderModems();
    showToast(`Cổng ${port} đã ngắt`, 'info', 4000);
  });

  socket.on('sms.received', (sms) => {
    const otpCode = pickSmsOtpCode(sms);
    if (otpCode) {
      attachOtpToPortChangeAlerts(sms.port, otpCode);
    }
    if (!shouldPrependLiveSms(smsMode)) return;
    prependFeedItem(
      smsFeed,
      smsEmpty,
      buildSmsItem(
        sms.port,
        sms.message,
        formatDate(sms.receivedAt),
        sms.sender,
        otpCode,
      ),
    );
  });

  socket.on('otp.received', (otp) => {
    prependFeedItem(
      otpFeed,
      otpEmpty,
      buildOtpItem(otp.port, otp.otp, formatDate(otp.receivedAt)),
    );
    showToast(`OTP ${otp.otp} · ${otp.port}`, 'success', 5000);
    attachOtpToPortChangeAlerts(otp.port, otp.otp);
  });

  socket.on('sim.port_changed', (data) => {
    addPortChangeAlert(data);
  });

  socket.on('sim.changed', (data) => {
    const phoneInfo = data.newPhone
      ? `Số mới: ${data.newPhone}`
      : 'Chưa detect được số - cần nhập thủ công';
    showToast(
      `SIM thay đổi tại ${data.port}. ${phoneInfo}`,
      data.newPhone ? 'info' : 'error',
      8000,
    );
    loadModems().catch(() => {});
  });

  setInterval(async () => {
    if (socket.connected) return;
    try {
      const tasks = [loadModems()];
      if (shouldPrependLiveSms(smsMode)) {
        tasks.push(loadLiveMessages());
      }
      await Promise.all(tasks);
      setConnectionState('is-fallback', 'Polling fallback đang hoạt động');
    } catch {
      setConnectionState('is-error', 'Không thể kết nối API');
    }
  }, 5000);
}

loadInitialData().catch(() => {
  setConnectionState('is-error', 'Không tải được dữ liệu ban đầu');
  modemTableWrap.classList.add('hidden');
  modemEmpty.classList.remove('hidden');
});

connectSocket();
