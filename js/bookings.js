'use strict';
async function loadBookings() {
  const tbody = document.getElementById('bookings-tbody');
  const sf = document.getElementById('bk-status-filter')?.value || '';
  let q = sb.from('bookings')
    .select('*, customers(full_name, phone, email), boats(name, type, base_price)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (sf) q = q.eq('status', sf);
  const { data: bookings, error } = await q;
  if (error) { tbody.innerHTML = emptyRow(8, friendlyError(error, 'Could not load bookings.')); return; }
  if (!bookings?.length) { tbody.innerHTML = emptyRow(8, 'No bookings found'); return; }

  const mgr = isManager();
  tbody.innerHTML = bookings.map(b => {
    const days = daysBetween(b.start_date, b.end_date);
    let actions = '';
    if (b.status === 'Pending' && mgr) {
      actions += btnSm('Approve', act('approveBooking', b.id), 'btn-approve');
      actions += btnSm('Reject',  act('rejectBooking',  b.id), 'btn-reject');
    }
    if (b.status === 'Approved' && b.payment_status !== 'Paid' && mgr) {
      actions += btnSm('Record Payment', act('openPaymentForBooking', b.id), 'btn-pay');
    }
    if (b.status === 'Approved' && b.payment_status === 'Paid' && mgr) {
      actions += btnSm('Complete', act('completeBooking', b.id), 'btn-complete');
    }
    return `<tr>
      <td class="text-gray-500 text-xs">#${int(b.id)}</td>
      <td><p class="font-medium">${esc(b.customers?.full_name || '—')}</p><p class="text-xs text-gray-500">${esc(b.customers?.phone || '')}</p></td>
      <td><p>${esc(b.boats?.name || '—')}</p><p class="text-xs text-gray-500">${esc(b.boats?.type || '')}</p></td>
      <td class="text-xs text-gray-300">${esc(fmtDate(b.start_date))}<br>${esc(fmtDate(b.end_date))}<br><span class="text-gray-500">${int(days)}d</span></td>
      <td class="text-cyan-400 font-semibold">${esc(fmt(b.total_amount))}</td>
      <td>${badge(b.status)}</td>
      <td>${badge(b.payment_status)}</td>
      <td class="whitespace-nowrap space-x-1">${actions || '—'}</td>
    </tr>`;
  }).join('');
}

// The database enforces the workflow (who can move a booking where) and the
// no-double-booking rule; these functions only ask and report the answer.
async function setBookingStatus(id, patch, okMsg, okType = 'success') {
  const { data, error } = await sb.from('bookings').update(patch).eq('id', int(id)).select('id');
  if (error) { showToast(friendlyError(error, 'Could not update the booking.'), 'error'); return; }
  if (!data?.length) { showToast('You do not have permission to do that.', 'error'); return; }
  showToast(okMsg, okType); loadBookings();
}
const approveBooking  = (id) => once('bk' + id, () => setBookingStatus(id, { status: 'Approved' }, 'Booking approved'));
const completeBooking = (id) => once('bk' + id, () => setBookingStatus(id, { status: 'Completed' }, 'Booking marked complete'));
const rejectBooking   = (id) => once('bk' + id, () => {
  const reason = (prompt('Reason for rejection (optional):') ?? null);
  if (reason === null) return;                                 // cancelled the prompt
  return setBookingStatus(id, { status: 'Rejected', notes: reason.trim().slice(0, 1000) || null }, 'Booking rejected', 'warning');
});

function openPaymentForBooking(bookingId) {
  document.getElementById('pm-booking-id').dataset.preset = String(int(bookingId));
  openModal('modal-add-payment');
}

async function populateBookingSelects() {
  const [{ data: customers }, { data: boats }] = await Promise.all([
    sb.from('customers').select('id, full_name, phone').is('deleted_at', null).order('full_name'),
    sb.from('boats').select('id, name, type, base_price').eq('status', 'Available').is('deleted_at', null).order('name'),
  ]);
  document.getElementById('bk-customer').innerHTML = '<option value="">— Select Customer —</option>' +
    (customers || []).map(c => `<option value="${int(c.id)}">${esc(c.full_name)} (${esc(c.phone || c.id)})</option>`).join('');
  document.getElementById('bk-boat').innerHTML = '<option value="">— Select Available Boat —</option>' +
    (boats || []).map(b => `<option value="${int(b.id)}" data-price="${int(b.base_price)}">${esc(b.name)} (${esc(b.type)}) – ${esc(fmt(b.base_price))}/day</option>`).join('');
  const today = todayISO();
  document.getElementById('bk-start').min = today;
  document.getElementById('bk-end').min   = today;
}

// preview only — the server recalculates the real price and ignores anything sent from here
function calcBookingTotal() {
  const boatEl = document.getElementById('bk-boat');
  const start  = document.getElementById('bk-start').value;
  const end    = document.getElementById('bk-end').value;
  const price  = Number(boatEl?.selectedOptions[0]?.dataset?.price || 0);
  const prev   = document.getElementById('bk-total-preview');
  const days   = start && end ? daysBetween(start, end) : 0;
  if (!price || days <= 0) { prev?.classList.add('hidden'); return; }
  document.getElementById('bk-days').textContent  = days + (days === 1 ? ' day' : ' days');
  document.getElementById('bk-total').textContent = fmt(days * price) + ' (estimate)';
  prev?.classList.remove('hidden');
}

async function addBooking() {
  const customerId = int(document.getElementById('bk-customer').value);
  const boatId     = int(document.getElementById('bk-boat').value);
  const start      = document.getElementById('bk-start').value;
  const end        = document.getElementById('bk-end').value;
  const notes      = document.getElementById('bk-notes').value.trim().slice(0, 1000);
  if (!customerId || !boatId || !start || !end) { showToast('All fields required', 'error'); return; }
  if (daysBetween(start, end) <= 0) { showToast('End date must be after the start date', 'error'); return; }

  await once('addBooking', async () => {
    // NOTE: no total_amount / status / payment_status — the database sets them
    const { error } = await sb.from('bookings').insert({
      customer_id: customerId, boat_id: boatId, start_date: start, end_date: end, notes: notes || null,
    });
    if (error) { showToast(friendlyError(error, 'Could not create the booking.'), 'error'); return; }
    showToast('Booking created — pending approval', 'success');
    closeModal('modal-add-booking'); loadBookings();
  });
}

registerLoader('bookings', loadBookings);
registerActions({ loadBookings, approveBooking, rejectBooking, completeBooking, openPaymentForBooking, addBooking });
