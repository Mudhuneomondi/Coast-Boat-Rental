async function loadBookings() {
  const sf = document.getElementById('bk-status-filter')?.value || '';
  let q = sb.from('bookings')
    .select('*, customers(full_name, phone, email), boats(name, type, base_price)')
    .order('created_at', { ascending: false });
  if (sf) q = q.eq('status', sf);
  const { data: bookings } = await q;
  if (!bookings?.length) {
    document.getElementById('bookings-tbody').innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-500">No bookings found</td></tr>';
    return;
  }
  const isAM = ['Admin','Manager'].includes(currentUserRole);
  document.getElementById('bookings-tbody').innerHTML = bookings.map(b => {
    const days = Math.ceil((new Date(b.end_date) - new Date(b.start_date)) / 86400000);
    let actions = '';
    if (b.status === 'Pending' && isAM) {
      actions += btnSm('Approve', `approveBooking(${b.id})`, 'btn-approve');
      actions += btnSm('Reject',  `rejectBooking(${b.id})`,  'btn-reject');
    }
    if (b.status === 'Approved' && b.payment_status !== 'Paid') {
      actions += btnSm('Record Payment', `openPaymentForBooking(${b.id})`, 'btn-pay');
    }
    if (b.status === 'Approved' && b.payment_status === 'Paid') {
      actions += btnSm('Complete', `completeBooking(${b.id})`, 'btn-complete');
    }
    return `<tr>
      <td class="text-gray-500 text-xs">#${b.id}</td>
      <td><p class="font-medium">${b.customers?.full_name||'—'}</p><p class="text-xs text-gray-500">${b.customers?.phone||''}</p></td>
      <td><p>${b.boats?.name||'—'}</p><p class="text-xs text-gray-500">${b.boats?.type||''}</p></td>
      <td class="text-xs text-gray-300">${fmtDate(b.start_date)}<br>${fmtDate(b.end_date)}<br><span class="text-gray-500">${days}d</span></td>
      <td class="text-cyan-400 font-semibold">${fmt(b.total_amount)}</td>
      <td>${badge(b.status)}</td>
      <td>${badge(b.payment_status)}</td>
      <td class="whitespace-nowrap space-x-1">${actions||'—'}</td>
    </tr>`;
  }).join('');
}

async function approveBooking(id) {
  const { error } = await sb.from('bookings').update({ status: 'Approved', approved_by: currentUserId }).eq('id', id);
  if (error) { showToast('Failed: '+error.message,'error'); return; }
  showToast('Booking approved','success'); loadBookings();
}
async function rejectBooking(id) {
  const reason = prompt('Reason for rejection (optional):') || '';
  const { error } = await sb.from('bookings').update({ status: 'Rejected', notes: reason }).eq('id', id);
  if (error) { showToast('Failed','error'); return; }
  showToast('Booking rejected','warning'); loadBookings();
}
async function completeBooking(id) {
  const { error } = await sb.from('bookings').update({ status: 'Completed' }).eq('id', id);
  if (error) { showToast('Failed','error'); return; }
  showToast('Booking marked complete','success'); loadBookings();
}

function openPaymentForBooking(bookingId) {
  document.getElementById('pm-booking-id').value = bookingId;
  openModal('modal-add-payment');
}

async function populateBookingSelects() {
  const { data: customers } = await sb.from('customers').select('id, full_name, phone').order('full_name');
  document.getElementById('bk-customer').innerHTML = '<option value="">— Select Customer —</option>' +
    (customers||[]).map(c => `<option value="${c.id}">${c.full_name} (${c.phone||c.id})</option>`).join('');
  const { data: boats } = await sb.from('boats').select('id, name, type, base_price').eq('status','Available').order('name');
  document.getElementById('bk-boat').innerHTML = '<option value="">— Select Available Boat —</option>' +
    (boats||[]).map(b => `<option value="${b.id}" data-price="${b.base_price}">${b.name} (${b.type}) – ${fmt(b.base_price)}/day</option>`).join('');
}

function calcBookingTotal() {
  const boatEl = document.getElementById('bk-boat');
  const start  = document.getElementById('bk-start').value;
  const end    = document.getElementById('bk-end').value;
  const price  = parseFloat(boatEl?.selectedOptions[0]?.dataset?.price || 0);
  const prev   = document.getElementById('bk-total-preview');
  if (!start || !end || !price) { prev?.classList.add('hidden'); return; }
  const days = Math.ceil((new Date(end) - new Date(start)) / 86400000);
  if (days <= 0) { prev?.classList.add('hidden'); return; }
  document.getElementById('bk-days').textContent  = days + (days===1?' day':' days');
  document.getElementById('bk-total').textContent = fmt(days * price);
  prev?.classList.remove('hidden');
}

async function addBooking() {
  const customerId = document.getElementById('bk-customer').value;
  const boatId     = document.getElementById('bk-boat').value;
  const start      = document.getElementById('bk-start').value;
  const end        = document.getElementById('bk-end').value;
  const notes      = document.getElementById('bk-notes').value.trim();
  const boatEl     = document.getElementById('bk-boat');
  const price      = parseFloat(boatEl?.selectedOptions[0]?.dataset?.price || 0);
  if (!customerId || !boatId || !start || !end) { showToast('All fields required','error'); return; }
  const days  = Math.ceil((new Date(end) - new Date(start)) / 86400000);
  const total = days * price;
  const { error } = await sb.from('bookings').insert({
    customer_id: parseInt(customerId), boat_id: parseInt(boatId),
    start_date: start, end_date: end, total_amount: total,
    status: 'Pending', payment_status: 'Unpaid', notes
  });
  if (error) { showToast('Failed: '+error.message,'error'); return; }
  showToast('Booking created — pending approval','success');
  closeModal('modal-add-booking'); loadBookings();
}

registerLoader('bookings', loadBookings);
