'use strict';
// ═════════════════════════════════════════════════════════════════════════
// Authentication — Supabase Auth (A07). No passwords are read, stored or compared
// by this app: Supabase hashes them (bcrypt), rate-limits sign-in attempts,
// issues short-lived JWTs and refreshes them.
//
// The browser NEVER decides who is staff: after login the server function
// bootstrap_profile() answers that, and Row Level Security enforces it on
// every query. Hiding a menu item below is cosmetic only.
// ═════════════════════════════════════════════════════════════════════════
const sb = supabase.createClient(CBR.SUPABASE_URL, CBR.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

let currentUserRole   = '';
let currentUserName   = '';
let currentUserId     = null;     // users.id  (staff)
let currentCustomerId = null;     // customers.id

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

function setBusy(btnId, busy, html) {
  const b = document.getElementById(btnId);
  if (!b) return;
  b.disabled = busy;
  if (html !== undefined) b.innerHTML = html;
}
const SIGNIN_HTML = '<i class="fas fa-sign-in-alt mr-2"></i> Sign In';

// Same wording for "no such user" and "wrong password": no account enumeration
function authMessage(error) {
  console.error('[CBR] auth', error.code || error.status, error.message);
  if (error.code === 'email_not_confirmed') return 'Please confirm your e-mail address first (check your inbox).';
  if (error.status === 429 || error.code === 'over_request_rate_limit') return 'Too many attempts. Please wait a minute and try again.';
  if (error.code === 'weak_password') return 'That password is too weak. Use a longer, less common one.';
  return 'Invalid e-mail or password.';
}

// ── SIGN IN ──────────────────────────────────────────────
async function unifiedLogin() {
  clearLoginError();
  const email = document.getElementById('uni-email').value.trim().toLowerCase();
  const pass  = document.getElementById('uni-password').value;
  if (!email || !pass) { showLoginError('Please enter your e-mail and password.'); return; }
  if (!EMAIL_RE.test(email)) { showLoginError('Please enter a valid e-mail address.'); return; }

  await once('login', async () => {
    setBusy('login-btn', true, '<i class="fas fa-spinner fa-spin mr-2"></i>Signing in...');
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) { showLoginError(authMessage(error)); return; }
      document.getElementById('uni-password').value = '';
      await startSession();
    } finally {
      setBusy('login-btn', false, SIGNIN_HTML);
    }
  });
}

/** After a valid Supabase session exists: ask the server who we are, then show the right UI. */
async function startSession() {
  const { data, error } = await sb.rpc('bootstrap_profile');
  if (error || !data) {
    const msg = friendlyError(error, 'Could not load your profile.');
    await sb.auth.signOut();
    showLoginError(msg);
    return false;
  }
  if (data.kind === 'staff') {
    currentUserRole = data.role;  currentUserId = data.id;  currentCustomerId = null;
  } else {
    currentUserRole = 'Customer'; currentCustomerId = data.id; currentUserId = null;
  }
  currentUserName = data.name;

  enterApp(currentUserName, currentUserRole);
  if (data.kind === 'staff') { renderSidebar(); showSection('dashboard'); }
  else                       { renderCustomerSidebar(); showSection('c-boats'); }
  showToast('Welcome, ' + currentUserName + '!', 'success');
  startIdleTimer();
  return true;
}

// ── SIGN UP (customers only — staff are invited by an Admin) ──────
async function customerSignUp() {
  const errEl = document.getElementById('signup-error');
  const fail = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; };
  errEl.textContent = ''; errEl.style.display = 'none';

  const name  = document.getElementById('su-name').value.trim();
  const email = document.getElementById('su-email').value.trim().toLowerCase();
  const pass  = document.getElementById('su-password').value;
  const phone = document.getElementById('su-phone').value.trim();

  if (!name || !email || !pass)      return fail('Name, e-mail and password are required.');
  if (name.length > 100)             return fail('Name is too long.');
  if (!EMAIL_RE.test(email))         return fail('Please enter a valid e-mail address.');
  if (phone && !PHONE_RE.test(phone)) return fail('Phone may only contain digits, spaces, + ( ) -');
  if (pass.length < CBR.MIN_PASSWORD) return fail(`Password must be at least ${CBR.MIN_PASSWORD} characters.`);
  if (!/[A-Za-z]/.test(pass) || !/[0-9]/.test(pass)) return fail('Password must contain letters and numbers.');

  await once('signup', async () => {
    const { data, error } = await sb.auth.signUp({
      email, password: pass,
      options: { data: { full_name: name, phone: phone || null }, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) { fail(authMessage(error)); return; }
    document.getElementById('su-password').value = '';
    if (data.session) { await startSession(); return; }                // confirmation switched off in the project
    document.getElementById('uni-email').value = email;
    showPanel('panel-login');
    // identical message whether or not the e-mail already existed (no enumeration)
    showToast('Check your e-mail for a confirmation link, then sign in.', 'info');
  });
}

// ── SIGN OUT ──────────────────────────────────────────────
async function logout() { await forceLogout('Logged out successfully', 'success'); }

async function forceLogout(message, type = 'warning') {
  stopIdleTimer();
  try { await sb.auth.signOut(); } catch (e) { console.error('[CBR] signOut', e); }
  resetUi();
  if (message) showToast(message, type);
}
function resetUi() {
  currentUserRole = ''; currentUserName = ''; currentUserId = null; currentCustomerId = null;
  // wipe rendered data so nothing stays in the DOM on a shared computer
  document.querySelectorAll('#content-area tbody, #content-area [id$="-grid"], #content-area [id$="-list"], #sidebar')
    .forEach(el => { el.innerHTML = ''; });
  document.getElementById('main-app').style.display     = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  showPanel('panel-login');
}

// ── Auto sign-out after inactivity ───────────────────────
let idleTimer = null;
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => forceLogout('You were signed out due to inactivity.'), CBR.IDLE_MINUTES * 60000);
}
function startIdleTimer() {
  ['click', 'keydown', 'mousemove', 'touchstart'].forEach(ev => document.addEventListener(ev, resetIdle, { passive: true }));
  resetIdle();
}
function stopIdleTimer() {
  clearTimeout(idleTimer);
  ['click', 'keydown', 'mousemove', 'touchstart'].forEach(ev => document.removeEventListener(ev, resetIdle));
}

// Another tab signed out / token could not be refreshed → leave the app too.
// (kept synchronous: never await Supabase calls inside this callback)
sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && currentUserRole) resetUi();
});

// ── ENTER APP ─────────────────────────────────────────────
function enterApp(name, role) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-app').style.display     = 'flex';
  document.getElementById('current-user').textContent   = name;
  document.getElementById('current-role').textContent   = role;
}

// ── ERROR HELPERS ─────────────────────────────────────────
function clearLoginError() {
  const el = document.getElementById('login-error');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent = msg; el.style.display = 'block';
}

// ── SIDEBARS (cosmetic: the database enforces the real permissions) ──
function navHtml(items) {
  return items.map(i => `
    <div ${act('showSection', i.id)} id="nav-${esc(i.id)}" role="button" tabindex="0"
      class="nav-item flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer text-gray-300 hover:text-white">
      <i class="fas fa-${esc(i.icon)} w-5 text-center"></i>
      <span class="font-medium">${esc(i.label)}</span>
    </div>`).join('');
}
function renderSidebar() {
  const isAdmin = currentUserRole === 'Admin';
  const isAM    = ['Admin', 'Manager'].includes(currentUserRole);
  const items = [
    { id: 'dashboard', icon: 'tachometer-alt',       label: 'Dashboard'     },
    { id: 'boats',     icon: 'ship',                 label: 'Boat Registry' },
    { id: 'bookings',  icon: 'calendar-check',       label: 'Bookings'      },
    { id: 'customers', icon: 'users',                label: 'Customers'     },
    { id: 'payments',  icon: 'money-bill-wave',      label: 'Payments',  show: isAM    },
    { id: 'incidents', icon: 'exclamation-triangle', label: 'Incidents'     },
    { id: 'reports',   icon: 'chart-bar',            label: 'Reports',   show: isAM    },
    { id: 'users',     icon: 'user-cog',             label: 'Users',     show: isAdmin },
    { id: 'audit',     icon: 'clipboard-list',       label: 'Audit Log', show: isAdmin },
  ].filter(i => i.show !== false);
  document.getElementById('sidebar').innerHTML = navHtml(items);
  document.getElementById('btn-add-boat')?.classList.toggle('hidden', !isAM);
  document.getElementById('btn-add-user')?.classList.toggle('hidden', !isAdmin);
}
function renderCustomerSidebar() {
  document.getElementById('sidebar').innerHTML = navHtml([
    { id: 'c-boats',    icon: 'ship',            label: 'Browse Boats' },
    { id: 'c-bookings', icon: 'calendar-check',  label: 'My Bookings'  },
    { id: 'c-payments', icon: 'money-bill-wave', label: 'My Payments'  },
  ]);
}

registerActions({ unifiedLogin, customerSignUp, logout });
