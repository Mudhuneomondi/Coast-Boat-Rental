async function loadUsers() {
  const { data: users } = await sb.from('users').select('*').order('role');
  if (!users?.length) {
    document.getElementById('users-tbody').innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-500">No users</td></tr>';
    return;
  }
  document.getElementById('users-tbody').innerHTML = users.map(u => `
    <tr>
      <td class="font-medium">${u.full_name||'—'}</td>
      <td class="text-gray-400 text-sm">${u.email}</td>
      <td><span class="text-xs px-2 py-1 rounded-full bg-cyan-900 text-cyan-300">${u.role}</span></td>
      <td class="text-gray-400 text-sm">${u.phone||'—'}</td>
      <td>${u.id !== currentUserId
        ? btnSm('Remove', `removeUser(${u.id},'${u.full_name?.replace(/'/g,"\\'")||''}')`, 'btn-reject')
        : '<span class="text-xs text-gray-500">You</span>'}</td>
    </tr>`).join('');
}

async function addUser() {
  const name  = document.getElementById('u-name').value.trim();
  const email = document.getElementById('u-email').value.trim();
  const pass  = document.getElementById('u-password').value;
  const role  = document.getElementById('u-role').value;
  const phone = document.getElementById('u-phone').value.trim();
  if (!name || !email || !pass) { showToast('Name, email and password required','error'); return; }
  if (pass.length < 6) { showToast('Password must be at least 6 characters','error'); return; }
  const { error } = await sb.from('users').insert({ full_name: name, email, password_hash: pass, role, phone });
  if (error) {
    showToast(error.code==='23505' ? 'Email already exists' : 'Failed: '+error.message, 'error');
    return;
  }
  showToast(`${role} account created for ${name}`,'success');
  closeModal('modal-add-user');
  ['u-name','u-email','u-password','u-phone'].forEach(id => document.getElementById(id).value = '');
  loadUsers();
}

async function removeUser(id, name) {
  if (!confirm(`Remove user "${name}"? This cannot be undone.`)) return;
  const { error } = await sb.from('users').delete().eq('id', id);
  if (error) { showToast('Failed: '+error.message,'error'); return; }
  showToast('User removed','success'); loadUsers();
}

registerLoader('users', loadUsers);
