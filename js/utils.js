'use strict';
// ═════════════════════════════════════════════════════════════════════════
// Shared helpers. SECURITY NOTES
//  • esc()        — every database value that reaches innerHTML MUST go through it (XSS, A05)
//  • act()        — builds data-click attributes; there are NO inline onclick= handlers
//                   anywhere, so the CSP can forbid inline scripts entirely
//  • friendlyError() — users see a safe message; technical detail stays in the console
// ═════════════════════════════════════════════════════════════════════════

// ── HTML escaping ────────────────────────────────────────
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
function esc(v) {
  return String(v ?? '').replace(/[&<>"'`]/g, c => ESC_MAP[c]);
}
/** Integer or 0 — for ids/amounts that are placed in markup. */
function int(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// ── Safe image URLs (only our own Supabase storage, or an inline placeholder) ──
const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="220"><rect width="100%" height="100%" fill="#0A2540"/>' +
  '<text x="50%" y="52%" fill="#22D3EE" font-family="sans-serif" font-size="20" text-anchor="middle">No photo</text></svg>');
function safeImgUrl(u) {
  try {
    const x = new URL(String(u || ''), location.href);
    return x.protocol === 'https:' && x.origin === new URL(CBR.SUPABASE_URL).origin ? x.href : PLACEHOLDER_IMG;
  } catch { return PLACEHOLDER_IMG; }
}
// <img onerror=…> is an inline handler (blocked by CSP) → one delegated listener instead
document.addEventListener('error', e => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.dataset.fallback !== 'done') { t.dataset.fallback = 'done'; t.src = PLACEHOLDER_IMG; }
}, true);

// ── Event delegation (replaces every inline onclick/oninput/onchange) ────
const ACTIONS = Object.create(null);
function registerActions(map) { Object.assign(ACTIONS, map); }
/** act('approveBooking', 5) → data-click="approveBooking" data-args="[5]" */
function act(name, ...args) {
  return `data-click="${esc(name)}" data-args="${esc(JSON.stringify(args))}"`;
}
function actArgs(el) {
  try { const a = JSON.parse(el.dataset.args || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}
function dispatch(name, args) {
  const fn = ACTIONS[name];                       // allow-list: only registered functions can run
  if (!fn) return;
  Promise.resolve().then(() => fn(...args)).catch(handleUnexpected);
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-click]');
  if (!el || el.disabled) return;
  e.preventDefault();
  dispatch(el.dataset.click, actArgs(el));
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-input]');
  if (el) dispatch(el.dataset.input, [...actArgs(el), el.value]);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el) dispatch(el.dataset.change, [...actArgs(el), el.value]);
  if (e.target.id === 'b-photo') previewBoatPhoto(e.target);
  if (['bk-start', 'bk-end', 'bk-boat'].includes(e.target.id)) calcBookingTotal();
  if (['c-book-start', 'c-book-end'].includes(e.target.id)) calcCustomerBookingPreview();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const el = e.target.closest('[data-enter]');
  if (el) { e.preventDefault(); dispatch(el.dataset.enter, actArgs(el)); }
});

// ── Errors: safe message for the user, detail only in the console ────────
function friendlyError(err, fallback = 'Something went wrong. Please try again.') {
  if (!err) return fallback;
  console.error('[CBR]', err.code || '', err.message || err);
  const msg = String(err.message || '');
  if (err.name === 'TypeError' && /fetch|network/i.test(msg)) return 'Network problem — check your connection and try again.';
  if (err.code === 'PGRST301' || err.code === 'PGRST303' || /jwt expired/i.test(msg)) {
    setTimeout(() => forceLogout('Your session expired. Please sign in again.'), 0);
    return 'Your session expired. Please sign in again.';
  }
  switch (err.code) {
    case 'P0001': return msg;                                   // business-rule messages written in schema.sql
    case '23P01': return 'That boat is already booked for those dates.';
    case '23505': return 'That value is already in use (duplicate).';
    case '23514': return 'One of the values is not allowed. Please check your input.';
    case '23503': return 'That record is linked to other data and cannot be changed.';
    case '42501': return /permission denied|row-level security/i.test(msg)
                      ? 'You do not have permission to do that.' : msg;   // our own 42501 texts are user-safe
    default:      return fallback;
  }
}
function handleUnexpected(e) {
  console.error('[CBR] unexpected', e);
  showToast(friendlyError(e), 'error');
}
window.addEventListener('error', e => { console.error('[CBR] error', e.message); });
window.addEventListener('unhandledrejection', e => { e.preventDefault(); handleUnexpected(e.reason); });

// ── Section loader registry ───────────────────────────────
const sectionLoaders = {};
function registerLoader(section, fn) { sectionLoaders[section] = fn; }

function showSection(name) {
  document.querySelectorAll('[id^="section-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
  const target = document.getElementById('section-' + name);
  if (target) target.style.display = 'block';
  document.getElementById('nav-' + name)?.classList.add('nav-active');
  if (sectionLoaders[name]) sectionLoaders[name]();
}

function showPanel(id) {
  ['panel-login', 'panel-signup'].forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) target.style.display = 'block';
  if (typeof clearLoginError === 'function') clearLoginError();
}

function togglePwd(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
  if (!input || !icon) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  icon.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
}

// ── Formatting (all return plain text/HTML-safe strings) ───
function fmt(n) { return 'KSh ' + Number(n || 0).toLocaleString('en-KE'); }
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
function fmtDateTime(d) {
  return d ? new Date(d).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
function todayISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }); }

const BADGE_KEYS = new Set(['available','rented','maintenance','pending','approved','rejected','completed',
  'cancelled','unpaid','partial','paid','reported','resolved']);
function badge(s) {
  const key = String(s || '').toLowerCase().replace(/\s/g, '-');
  return `<span class="badge ${BADGE_KEYS.has(key) ? 'status-' + key : ''}">${esc(s || '—')}</span>`;
}
function btnSm(label, actionAttrs, cls = 'btn-default') {
  return `<button type="button" ${actionAttrs} class="action-btn ${esc(cls)}">${esc(label)}</button>`;
}
function filterTbody(tbodyId, q) {
  const needle = String(q).toLowerCase();
  document.getElementById(tbodyId)?.querySelectorAll('tr').forEach(r =>
    r.style.display = r.textContent.toLowerCase().includes(needle) ? '' : 'none');
}
function emptyRow(cols, text) {
  return `<tr><td colspan="${int(cols)}" class="text-center py-8 text-gray-500">${esc(text)}</td></tr>`;
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const colors = { success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-yellow-500', info: 'bg-cyan-600' };
  const t = document.createElement('div');
  t.className = `toast px-6 py-3 rounded-2xl text-sm font-medium shadow-2xl text-white ${colors[type] || colors.success}`;
  t.setAttribute('role', 'status');
  t.textContent = msg;                                  // textContent: never parsed as HTML
  document.getElementById('toast-container')?.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// ── Modal helpers ─────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
  if (id === 'modal-add-incident') populateIncidentBoats();
  if (id === 'modal-add-booking')  populateBookingSelects();
  if (id === 'modal-add-payment')  populatePaymentBookings();
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ── Photo upload: type + size + REAL content check, random file name ─────
const IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const IMG_MAX   = { boats: 2 * 1024 * 1024, incidents: 3 * 1024 * 1024 };

async function sniffImage(file) {                       // don't trust file.type — read the magic bytes
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
/** Returns the storage path (e.g. "3f2a….jpg"), null when no file chosen, or throws a user-safe Error. */
async function uploadPhoto(bucket, file) {
  if (!file) return null;
  if (file.size > IMG_MAX[bucket]) throw new Error(`Photo is too large (max ${IMG_MAX[bucket] / 1048576} MB).`);
  const real = await sniffImage(file);
  if (!real || !IMG_TYPES[real] || (file.type && file.type !== real)) throw new Error('Only JPG, PNG or WebP photos are allowed.');
  const path = `${crypto.randomUUID()}.${IMG_TYPES[real]}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, { upsert: false, contentType: real });
  if (error) { console.error('[CBR] upload', error); throw new Error('Photo upload failed.'); }
  return path;
}

function previewBoatPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = document.getElementById('b-photo-img');
  img.onload = () => URL.revokeObjectURL(url);
  img.src = url;                                         // blob: URL — no FileReader/data URL needed
  document.getElementById('b-photo-preview').style.display = 'block';
}

// ── Double-submit guard for actions that change money/data ─────
const inFlight = new Set();
async function once(key, fn) {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try { return await fn(); } finally { inFlight.delete(key); }
}

// ── Generic actions used by static HTML ───────────────────
registerActions({ openModal, closeModal, togglePwd, showPanel, showSection, filterTbody });
