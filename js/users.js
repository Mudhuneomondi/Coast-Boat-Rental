'use strict';
// Staff accounts are created by INVITATION. The Admin invites an e-mail + role;
// that person signs up normally, confirms their e-mail, and the server promotes them.
// No password ever passes through this screen.
const STAFF_ROLES = ['Operator', 'Manager', 'Admin'];

async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  const [{ data: users, error }, { data: invites }] = await Promise.all([
    sb.from('users').select('*').is('deleted_at', null).order('role'),
    sb.from('staff_invites').select('*').order('created_at', { ascending: false }),
  ]);
  if (error) { tbody.innerHTML = emptyRow(5, friendlyError(error, 'Could not load users.')); return; }

  const rows = (users || []).map(u => `
    <tr>
      <td class="font-medium">${esc(u.full_name || '—')}</td>
      <td class="text-gray-400 text-sm">${esc(u.email)}</td>
      <td><span class="text-xs px-2 py-1 rounded-full bg-cyan-900 text-cyan-300">${esc(u.role)}</span></td>
      <td class="text-gray-400 text-sm">${esc(u.phone || '—')}</td>
      <td>${u.id !== currentUserId
        ? btnSm('Remove', act('removeUser', u.id, u.full_name || u.email), 'btn-reject')
        : '<span class="text-xs text-gray-500">You</span>'}</td>
    </tr>`);
  const pending = (invites || []).map(i => `
    <tr>
      <td class="font-medium">${esc(i.full_name || '—')}</td>
      <td class="text-gray-400 text-sm">${esc(i.email)}</td>
      <td><span class="text-xs px-2 py-1 rounded-full bg-yellow-900 text-yellow-300">${esc(i.role)} · invited</span></td>
      <td class="text-gray-400 text-sm">${esc(i.phone || '—')}</td>
      <td>${btnSm('Revoke', act('revokeInvite', i.id), 'btn-reject')}</td>
    </tr>`);
  tbody.innerHTML = rows.concat(pending).join('') || emptyRow(5, 'No users');
}

async function addUser() {
  const name  = document.getElementById('u-name').value.trim();
  const email = document.getElementById('u-email').value.trim().toLowerCase();
  const role  = document.getElementById('u-role').value;
  const phone = document.getElementById('u-phone').value.trim();
  if (!name || !email) { showToast('Name and e-mail are required', 'error'); return; }
  if (!EMAIL_RE.test(email)) { showToast('Enter a valid e-mail address', 'error'); return; }
  if (!STAFF_ROLES.includes(role)) { showToast('Unknown role', 'error'); return; }
  if (phone && !PHONE_RE.test(phone)) { showToast('Phone may only contain digits, spaces, + ( ) -', 'error'); return; }
  await once('addUser', async () => {
    const { error } = await sb.from('staff_invites').insert({ email, full_name: name, role, phone: phone || null });
    if (error) { showToast(error.code === '23505' ? 'That e-mail has already been invited' : friendlyError(error, 'Could not create the invitation.'), 'error'); return; }
    showToast(`Invitation created. Ask ${name} to sign up with ${email}.`, 'success');
    closeModal('modal-add-user');
    ['u-name', 'u-email', 'u-phone'].forEach(id => document.getElementById(id).value = '');
    loadUsers();
  });
}

async function revokeInvite(id) {
  const { error } = await sb.from('staff_invites').delete().eq('id', int(id));
  if (error) { showToast(friendlyError(error, 'Could not revoke the invitation.'), 'error'); return; }
  showToast('Invitation revoked', 'success'); loadUsers();
}

// Soft delete: the account is archived (kept for the audit trail) and can no longer sign in.
async function removeUser(id, name) {
  if (!confirm(`Remove "${name}"? They will no longer be able to sign in. The record is kept for the audit log.`)) return;
  const { error } = await sb.rpc('archive_record', { p_table: 'users', p_id: int(id) });
  if (error) { showToast(friendlyError(error, 'Could not remove the user.'), 'error'); return; }
  showToast('User removed', 'success'); loadUsers();
}

registerLoader('users', loadUsers);
registerActions({ addUser, revokeInvite, removeUser });
