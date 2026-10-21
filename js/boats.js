'use strict';
const isManager = () => ['Admin', 'Manager'].includes(currentUserRole);

async function loadBoats() {
  const sf = document.getElementById('boat-status-filter')?.value || '';
  let q = sb.from('boats').select('*').is('deleted_at', null).order('id', { ascending: false });
  if (sf) q = q.eq('status', sf);
  const { data: boats, error } = await q;
  const grid = document.getElementById('boats-grid');
  if (error) { grid.innerHTML = `<p class="col-span-3 text-center text-red-400 py-12">${esc(friendlyError(error, 'Could not load boats.'))}</p>`; return; }
  if (!boats?.length) { grid.innerHTML = '<p class="col-span-3 text-center text-gray-500 py-12">No boats found</p>'; return; }

  const mgr = isManager();
  grid.innerHTML = boats.map(b => {
    const sc = b.status === 'Available' ? 'bg-green-500' : b.status === 'Rented' ? 'bg-blue-500' : 'bg-yellow-500';
    return `
      <div class="card overflow-hidden" data-search="${esc((b.name + ' ' + b.type).toLowerCase())}">
        <img src="${esc(safeImgUrl(b.photo_urls))}" alt="${esc(b.name)}" class="boat-photo" loading="lazy" referrerpolicy="no-referrer">
        <div class="p-5">
          <div class="flex justify-between items-start mb-1">
            <h3 class="text-lg font-bold">${esc(b.name)}</h3>
            <span class="text-xs px-3 py-1 rounded-full ${sc} text-white font-semibold">${esc(b.status)}</span>
          </div>
          <p class="text-cyan-300 text-sm mb-1">${esc(b.type)} · ${int(b.capacity)} pax</p>
          <p class="text-xl font-bold mb-3">${esc(fmt(b.base_price))}<span class="text-sm text-gray-400 font-normal">/day</span></p>
          ${mgr ? `<div class="flex gap-2">
            <button type="button" ${act('openEditStatus', b.id, b.status)}
              class="flex-1 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-medium transition-colors">
              <i class="fas fa-edit mr-1"></i> Status</button>
            <button type="button" ${act('archiveBoat', b.id, b.name)}
              class="py-2 px-3 bg-red-500/20 hover:bg-red-500/40 text-red-300 rounded-xl text-sm font-medium transition-colors" title="Archive boat">
              <i class="fas fa-archive"></i></button></div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function filterBoatCards(q) {
  const needle = String(q).toLowerCase();
  document.querySelectorAll('#boats-grid [data-search]').forEach(el => {
    el.style.display = el.dataset.search.includes(needle) ? '' : 'none';
  });
}

async function addBoat() {
  const name  = document.getElementById('b-name').value.trim();
  const type  = document.getElementById('b-type').value;
  const cap   = parseInt(document.getElementById('b-capacity').value, 10);
  const price = parseInt(document.getElementById('b-price').value, 10);
  const file  = document.getElementById('b-photo').files[0];
  if (!name || !cap || !price) { showToast('Name, capacity and price required', 'error'); return; }
  if (name.length > 100)        { showToast('Name is too long', 'error'); return; }
  if (cap < 1 || cap > 200)     { showToast('Capacity must be between 1 and 200', 'error'); return; }
  if (price < 1 || price > 10000000) { showToast('Enter a valid daily price', 'error'); return; }

  await once('addBoat', async () => {
    showToast('Saving...', 'info');
    let photoUrl = null;
    try {
      const path = await uploadPhoto('boats', file);
      if (path) photoUrl = sb.storage.from('boats').getPublicUrl(path).data.publicUrl;
    } catch (e) { showToast(e.message, 'error'); return; }
    const { error } = await sb.from('boats').insert({ name, type, capacity: cap, base_price: price, status: 'Available', photo_urls: photoUrl });
    if (error) { showToast(friendlyError(error, 'Could not add the boat.'), 'error'); return; }
    showToast('Boat added!', 'success');
    closeModal('modal-add-boat');
    ['b-name', 'b-capacity', 'b-price'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('b-photo').value = '';
    document.getElementById('b-photo-preview').style.display = 'none';
    loadBoats();
  });
}

function openEditStatus(id, current) {
  document.getElementById('es-boat-id').value = int(id);
  document.getElementById('es-status').value  = current;
  openModal('modal-edit-status');
}
async function updateBoatStatus() {
  const id     = int(document.getElementById('es-boat-id').value);
  const status = document.getElementById('es-status').value;
  const { error } = await sb.from('boats').update({ status }).eq('id', id);
  if (error) { showToast(friendlyError(error, 'Could not update the status.'), 'error'); return; }
  showToast('Status → ' + status, 'success');
  closeModal('modal-edit-status'); loadBoats();
}

async function archiveBoat(id, name) {
  if (!confirm(`Archive "${name}"? It will disappear from the fleet (an administrator can restore it).`)) return;
  const { error } = await sb.rpc('archive_record', { p_table: 'boats', p_id: int(id) });
  if (error) { showToast(friendlyError(error, 'Could not archive the boat.'), 'error'); return; }
  showToast('Boat archived', 'success'); loadBoats();
}

registerLoader('boats', loadBoats);
registerActions({ loadBoats, filterBoatCards, addBoat, openEditStatus, updateBoatStatus, archiveBoat });
