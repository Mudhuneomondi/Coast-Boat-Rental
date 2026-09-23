// ── Global error catcher ─────────────────────────────────
window.onerror = function(msg, src, line, col, err) {
  alert('JS ERROR:\n' + msg + '\nFile: ' + src + '\nLine: ' + line);
  return false;
};
window.addEventListener('unhandledrejection', function(e) {
  alert('PROMISE ERROR:\n' + e.reason);
});

const SURL = 'https://vvnokweblgojqaqlbsyh.supabase.co';
const SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2bm9rd2VibGdvanFhcWxic3loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MTE1OTgsImV4cCI6MjA4OTI4NzU5OH0.FWZseH-90QKOutDLSdrZf6QBtKO8G-BMCbvtNb6JUTI';
const sb   = supabase.createClient(SURL, SKEY);

let currentUserRole   = '';
let currentUserName   = '';
let currentUserId     = null;
let currentCustomerId = null;

// ── UNIFIED LOGIN ─────────────────────────────────────────
async function unifiedLogin() {
  console.log('unifiedLogin called');
  const email = document.getElementById('uni-email').value.trim().toLowerCase();
  const pass  = document.getElementById('uni-password').value;
  console.log('email:', email, 'pass length:', pass.length);
  const btn   = document.getElementById('login-btn');
  clearLoginError();

  if (!email || !pass) { showLoginError('Please enter your email and password'); return; }

  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Signing in...';
  btn.disabled  = true;

  // Check staff table first
  const { data: staff } = await sb.from('users').select('*').eq('email', email).maybeSingle();

  if (staff) {
    btn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Sign In';
    btn.disabled  = false;
    if (staff.password_hash !== pass) { showLoginError('Incorrect password'); return; }
    currentUserRole = staff.role;
    currentUserName = staff.full_name || email.split('@')[0];
    currentUserId   = staff.id;
    console.log('DEBUG 1: staff login ok, role=', currentUserRole);
    enterApp(currentUserName, staff.role);
    console.log('DEBUG 2: main-app display=', document.getElementById('main-app').style.display);
    console.log('DEBUG 3: main-app offsetHeight=', document.getElementById('main-app').offsetHeight);
    renderSidebar();
    showSection('dashboard');
    console.log('DEBUG 4: section-dashboard display=', document.getElementById('section-dashboard')?.style.display);
    showToast('Welcome back, ' + currentUserName + '!', 'success');
    return;
  }

  // Check customers table
  const { data: customer } = await sb.from('customers').select('*').eq('email', email).maybeSingle();

  btn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Sign In';
  btn.disabled  = false;

  if (!customer) { showLoginError('No account found with that email'); return; }
  if (customer.password_hash !== pass) { showLoginError('Incorrect password'); return; }

  currentUserRole   = 'Customer';
  currentUserName   = customer.full_name;
  currentCustomerId = customer.id;
  enterApp(customer.full_name, 'Customer');
  renderCustomerSidebar();
  showSection('c-boats');
  showToast('Welcome, ' + customer.full_name + '!', 'success');
}

// ── SIGN UP (customers only) ──────────────────────────────
async function customerSignUp() {
  const name  = document.getElementById('su-name').value.trim();
  const email = document.getElementById('su-email').value.trim().toLowerCase();
  const pass  = document.getElementById('su-password').value;
  const phone = document.getElementById('su-phone').value.trim();

  // Clear errors
  const errEl = document.getElementById('signup-error');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

  const showSignupError = (msg) => {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
  };

  if (!name || !email || !pass) { showSignupError('Name, email and password are required'); return; }
  if (pass.length < 6)          { showSignupError('Password must be at least 6 characters'); return; }
  if (email.endsWith('@coastboat.com')) {
    showSignupError('Staff accounts are managed by the administrator');
    return;
  }

  const { error } = await sb.from('customers').insert({
    full_name: name, email, password_hash: pass, phone
  });

  if (error) {
    showSignupError(error.code === '23505' ? 'That email is already registered' : error.message);
    return;
  }

  showToast('Account created! You can now sign in.', 'success');
  document.getElementById('uni-email').value    = email;
  document.getElementById('uni-password').value = '';
  showPanel('panel-login');
}

// ── ENTER APP ─────────────────────────────────────────────
// Use style.display directly — avoids Tailwind class conflicts
function enterApp(name, role) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-app').style.display     = 'flex';
  document.getElementById('current-user').textContent   = name;
  document.getElementById('current-role').textContent   = role;
}

// ── LOGOUT ────────────────────────────────────────────────
function logout() {
  currentUserRole = ''; currentUserName = '';
  currentUserId   = null; currentCustomerId = null;
  document.getElementById('main-app').style.display     = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  showPanel('panel-login');
  showToast('Logged out successfully', 'success');
}

// ── ERROR HELPERS ─────────────────────────────────────────
function clearLoginError() {
  const el = document.getElementById('login-error');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent    = msg;
  el.style.display  = 'block';
}

// ── STAFF SIDEBAR ─────────────────────────────────────────
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
  ].filter(i => i.show !== false);

  document.getElementById('sidebar').innerHTML = items.map(i => `
    <div onclick="showSection('${i.id}')" id="nav-${i.id}"
      class="nav-item flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer text-gray-300 hover:text-white">
      <i class="fas fa-${i.icon} w-5 text-center"></i>
      <span class="font-medium">${i.label}</span>
    </div>`).join('');

  if (isAM)    document.getElementById('btn-add-boat')?.classList.remove('hidden');
  if (isAdmin) document.getElementById('btn-add-user')?.classList.remove('hidden');
}

// ── CUSTOMER SIDEBAR ──────────────────────────────────────
function renderCustomerSidebar() {
  document.getElementById('sidebar').innerHTML = [
    { id: 'c-boats',    icon: 'ship',            label: 'Browse Boats' },
    { id: 'c-bookings', icon: 'calendar-check',  label: 'My Bookings'  },
    { id: 'c-payments', icon: 'money-bill-wave', label: 'My Payments'  },
  ].map(i => `
    <div onclick="showSection('${i.id}')" id="nav-${i.id}"
      class="nav-item flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer text-gray-300 hover:text-white">
      <i class="fas fa-${i.icon} w-5 text-center"></i>
      <span class="font-medium">${i.label}</span>
    </div>`).join('');
}
