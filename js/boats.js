async function loadBoats() {
  const sf = document.getElementById('boat-status-filter')?.value || '';
  let q = sb.from('boats').select('*').order('id', { ascending: false });
  if (sf) q = q.eq('status', sf);
  const { data: boats } = await q;
  const grid = document.getElementById('boats-grid');
  if (!boats?.length) { grid.innerHTML = '<p class="col-span-3 text-center text-gray-500 py-12">No boats found</p>'; return; }
  const isAM = ['Admin','Manager'].includes(currentUserRole);
  grid.innerHTML = boats.map(b => {
    const photo = b.photo_urls || `https://picsum.photos/seed/${b.id}/400/220`;
    const sc = b.status==='Available'?'bg-green-500':b.status==='Rented'?'bg-blue-500':'bg-yellow-500';
    return `
      <div class="card overflow-hidden" data-search="${b.name.toLowerCase()} ${b.type.toLowerCase()}">
        <img src="${photo}" class="boat-photo" onerror="this.src='https://picsum.photos/400/220'">
        <div class="p-5">
          <div class="flex justify-between items-start mb-1">
            <h3 class="text-lg font-bold">${b.name}</h3>
            <span class="text-xs px-3 py-1 rounded-full ${sc} text-white font-semibold">${b.status}</span>
          </div>
          <p class="text-cyan-300 text-sm mb-1">${b.type} · ${b.capacity} pax</p>
          <p class="text-xl font-bold mb-3">${fmt(b.base_price)}<span class="text-sm text-gray-400 font-normal">/day</span></p>
          ${isAM ? `<button onclick="openEditStatus(${b.id},'${b.status}')"
            class="w-full py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-medium transition-colors">
            <i class="fas fa-edit mr-1"></i> Update Status</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function filterBoatCards(q) {
  document.querySelectorAll('#boats-grid [data-search]').forEach(el => {
    el.style.display = el.dataset.search.includes(q.toLowerCase()) ? '' : 'none';
  });
}

async function addBoat() {
  const name  = document.getElementById('b-name').value.trim();
  const type  = document.getElementById('b-type').value;
  const cap   = parseInt(document.getElementById('b-capacity').value);
  const price = parseInt(document.getElementById('b-price').value);
  const file  = document.getElementById('b-photo').files[0];
  if (!name || !cap || !price) { showToast('Name, capacity and price required','error'); return; }
  showToast('Saving...','info');
  const photoUrl = await uploadPhoto('boats', file);
  const { error } = await sb.from('boats').insert({ name, type, capacity: cap, base_price: price, status: 'Available', photo_urls: photoUrl });
  if (error) { showToast('Failed: ' + error.message,'error'); return; }
  showToast('Boat added!','success');
  closeModal('modal-add-boat');
  ['b-name','b-capacity','b-price'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('b-photo-preview').classList.add('hidden');
  loadBoats();
}

function openEditStatus(id, current) {
  document.getElementById('es-boat-id').value = id;
  document.getElementById('es-status').value  = current;
  openModal('modal-edit-status');
}
async function updateBoatStatus() {
  const id = document.getElementById('es-boat-id').value;
  const status = document.getElementById('es-status').value;
  const { error } = await sb.from('boats').update({ status }).eq('id', id);
  if (error) { showToast('Failed: '+error.message,'error'); return; }
  showToast('Status → '+status,'success');
  closeModal('modal-edit-status'); loadBoats();
}

registerLoader('boats', loadBoats);
