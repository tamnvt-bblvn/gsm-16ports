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
const drawerDetail = document.getElementById('drawer-detail');
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

const STATUS_LABEL = {
  online: 'online',
  offline: 'offline',
  connecting: 'connecting',
  no_sim: 'Chưa SIM',
  disabled: 'disabled',
};

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

themeToggle.addEventListener('click', () => {
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

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Đã copy: ${text}`, 'success', 2000);
  } catch {
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

function normalizePhoneInput(value) {
  let digits = String(value ?? '').replace(/[\s\-().+]/g, '');
  if (digits.startsWith('84') && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  }
  if (!digits.startsWith('0') && /^\d{9,10}$/.test(digits)) {
    digits = `0${digits}`;
  }
  return digits;
}

function isValidPhone(value) {
  return /^0\d{9,10}$/.test(value);
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
    phoneSetup.hidden = true;
    phoneSetupList.innerHTML = '';
    lastMissingPhonePortsKey = '';
    return;
  }

  const portsKey = missing.map((modem) => modem.port).join('|');

  phoneSetup.hidden = false;
  phoneSetupCount.textContent = `${missing.length} cổng`;

  if (portsKey === lastMissingPhonePortsKey) {
    return;
  }

  capturePhoneDraftsFromDom();
  lastMissingPhonePortsKey = portsKey;
  phoneSetupList.innerHTML = missing.map(buildPhoneSetupItem).join('');
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
        return `
      <tr class="clickable" data-port="${escapeHtml(modem.port)}" tabindex="0" role="button" aria-label="Chi tiết ${escapeHtml(modem.port)}">
        <td class="mono">${escapeHtml(modem.port)}</td>
        <td><span class="status-badge status-${escapeHtml(modem.status)}">${escapeHtml(STATUS_LABEL[modem.status] ?? modem.status)}</span></td>
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

smsToolbar.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch(1);
});

smsClear.addEventListener('click', () => {
  smsSearch.value = '';
  smsPortFilter.value = '';
  smsOnlyOtp.checked = false;
  enterLiveMode();
});

smsPrev.addEventListener('click', () => {
  if (searchPage > 1) runSearch(searchPage - 1);
});

smsNext.addEventListener('click', () => {
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
  const enabled = modem.enabled !== false;
  suppressEnabledToggleEvent = true;
  drawerEnabledToggle.checked = enabled;
  drawerEnabledLabel.textContent = enabled ? 'Bật' : 'Tắt';
  suppressEnabledToggleEvent = false;
}

function renderDrawerDetail(modem) {
  drawerTitle.textContent = modem.port;
  const rows = [
    ['Status', STATUS_LABEL[modem.status] ?? modem.status],
    ['Operator', modem.operator ?? '—'],
    ['Signal', modem.signal == null ? '—' : String(modem.signal)],
    ['Phone', modem.phone ?? '—'],
    ['SIM', simDrawerLabel(modem)],
    ['Enabled', modem.enabled ? 'Có' : 'Không'],
  ];
  drawerDetail.innerHTML = rows
    .map(
      ([label, value]) =>
        `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`,
    )
    .join('');

  syncDrawerEnabledToggle(modem);

  const canSend = modem.status === 'online';
  sendSubmit.disabled = !canSend;
  sendHint.className = 'send-hint';
  sendHint.textContent = canSend
    ? ''
    : 'Modem chưa online, không thể gửi SMS.';

  const portDisabled = modem.status === 'disabled' || modem.enabled === false;
  drawerPhoneSave.disabled = portDisabled;
}

function openDrawer(port) {
  const modem = modems.get(port);
  if (!modem) return;
  activeDrawerPort = port;
  renderDrawerDetail(modem);
  drawerPhoneInput.value = modem.phone ?? phoneDraftByPort.get(port) ?? '';
  sendPhone.value = '';
  sendMessage.value = '';
  drawer.classList.remove('hidden');
  drawerOverlay.classList.remove('hidden');
  sendPhone.focus();
}

function closeDrawer() {
  activeDrawerPort = null;
  drawer.classList.add('hidden');
  drawerOverlay.classList.add('hidden');
}

modemTableBody.addEventListener('click', (event) => {
  const row = event.target.closest('tr.clickable');
  if (row?.dataset.port) openDrawer(row.dataset.port);
});

modemTableBody.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('tr.clickable');
  if (row?.dataset.port) {
    event.preventDefault();
    openDrawer(row.dataset.port);
  }
});

phoneSetupList.addEventListener('input', (event) => {
  const input = event.target.closest('.phone-setup-input');
  if (input?.dataset.port) {
    phoneDraftByPort.set(input.dataset.port, input.value);
  }
});

phoneSetupList.addEventListener('click', (event) => {
  const button = event.target.closest('.phone-setup-save');
  if (!button?.dataset.port) return;
  const row = button.closest('.phone-setup-item');
  const input = row?.querySelector('.phone-setup-input');
  if (!input) return;
  requestPhoneSave(button.dataset.port, input.value);
});

phoneSetupList.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const input = event.target.closest('.phone-setup-input');
  if (!input?.dataset.port) return;
  event.preventDefault();
  requestPhoneSave(input.dataset.port, input.value);
});

drawerPhoneSave.addEventListener('click', () => {
  if (!activeDrawerPort) return;
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
  pendingEnabledSave = null;
  enabledConfirmOverlay.classList.add('hidden');
  enabledConfirmOverlay.hidden = true;
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

drawerEnabledToggle.addEventListener('change', () => {
  if (suppressEnabledToggleEvent || !activeDrawerPort) return;
  const modem = modems.get(activeDrawerPort);
  if (!modem) return;

  const nextEnabled = drawerEnabledToggle.checked;
  syncDrawerEnabledToggle(modem);
  openEnabledConfirm(activeDrawerPort, nextEnabled);
});

enabledConfirmCancel.addEventListener('click', closeEnabledConfirm);

enabledConfirmOverlay.addEventListener('click', (event) => {
  if (event.target === enabledConfirmOverlay) {
    closeEnabledConfirm();
  }
});

enabledConfirmOk.addEventListener('click', async () => {
  if (!pendingEnabledSave) return;
  const { port, enabled } = pendingEnabledSave;
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
    enabledConfirmOk.disabled = false;
  }
});

confirmCancel.addEventListener('click', closePhoneConfirm);

phoneConfirmOverlay.addEventListener('click', (event) => {
  if (event.target === phoneConfirmOverlay) {
    closePhoneConfirm();
  }
});

confirmOk.addEventListener('click', async () => {
  if (!pendingPhoneSave) return;
  const { port, phone } = pendingPhoneSave;
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
  if (event.key === 'Escape' && !drawer.classList.contains('hidden')) {
    closeDrawer();
  }
});

drawerClose.addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);

sendForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeDrawerPort) return;

  const phone = sendPhone.value.trim();
  const message = sendMessage.value.trim();
  if (!phone || !message) return;

  sendSubmit.disabled = true;
  sendHint.className = 'send-hint';
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
      throw new Error(payload.message ?? 'Gửi SMS thất bại');
    }
    sendHint.className = 'send-hint is-success';
    sendHint.textContent = `Đã gửi tới ${phone}`;
    sendMessage.value = '';
    showToast(`SMS đã gửi qua ${activeDrawerPort}`, 'success');
  } catch (error) {
    const text = Array.isArray(error.message)
      ? error.message.join(', ')
      : error.message;
    sendHint.className = 'send-hint is-error';
    sendHint.textContent = text;
    showToast(text, 'error');
  } finally {
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

  socket.on('sms.received', (sms) => {
    if (smsMode !== 'live') return;
    prependFeedItem(
      smsFeed,
      smsEmpty,
      buildSmsItem(
        sms.port,
        sms.message,
        formatDate(sms.receivedAt),
        sms.sender,
        null,
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
  });

  setInterval(async () => {
    if (socket.connected) return;
    try {
      await loadModems();
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
