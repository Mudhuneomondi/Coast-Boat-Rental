// ── Section loader registry ───────────────────────────────
const sectionLoaders = {};

function registerLoader(section, fn) {
  sectionLoaders[section] = fn;
}

function showSection(name) {
  document.querySelectorAll('[id^="section-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
  const target = document.getElementById('section-' + name);
  if (target) target.style.display = 'block';
  document.getElementById('nav-' + name)?.classList.add('nav-active');
  if (sectionLoaders[name]) sectionLoaders[name]();
}

// ── Panel switcher ────────────────────────────────────────
function showPanel(id) {
  ['panel-login', 'panel-signup'].forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) target.style.display = 'block';
  // clear any login error if the function exists
  if (typeof clearLoginError === 'function') clearLoginError();
}

// ── Password toggle ───────────────────────────────────────
function togglePwd(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
  if (!input || !icon) return;
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fas fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fas fa-eye';
  }
}

// ── Formatting ────────────────────────────────────────────
function fmt(n) {
  return 'KSh ' + Number(n || 0).toLocaleString('en-KE');
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric'
  }) : '—';
}
function badge(s) {
  return `<span class="badge status-${(s||'').toLowerCase().replace(/\s/g,'-')}">${s||'—'}</span>`;
}
function btnSm(label, onclick, cls = 'btn-default') {
  return `<button onclick="${onclick}" class="action-btn ${cls}">${label}</button>`;
}
function filterTbody(tbodyId, q) {
  document.getElementById(tbodyId)?.querySelectorAll('tr').forEach(r =>
    r.style.display = r.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none');
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const colors = {
    success: 'bg-green-500', error: 'bg-red-500',
    warning: 'bg-yellow-500', info: 'bg-cyan-600'
  };
  const t = document.createElement('div');
  t.className = `toast px-6 py-3 rounded-2xl text-sm font-medium shadow-2xl text-white ${colors[type] || colors.success}`;
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3500);
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

// ── Photo upload ──────────────────────────────────────────
async function uploadPhoto(bucket, file) {
  if (!file) return null;
  const path = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) { console.error('Upload error', error); return null; }
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// ── Shared event listeners ────────────────────────────────
document.addEventListener('change', e => {
  if (e.target.id === 'b-photo') {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('b-photo-img').src = ev.target.result;
      document.getElementById('b-photo-preview').style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
  if (e.target.id === 'bk-start' || e.target.id === 'bk-end' || e.target.id === 'bk-boat') {
    calcBookingTotal();
  }
  if (e.target.id === 'c-book-start' || e.target.id === 'c-book-end') {
    calcCustomerBookingPreview();
  }
});
