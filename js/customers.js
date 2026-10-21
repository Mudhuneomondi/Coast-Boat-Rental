'use strict';
// ── STAFF: view registered customers ─────────────────────
async function loadCustomers() {
  const tbody = document.getElementById('customers-tbody');
  const { data: customers, error } = await sb.from('customers').select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) { tbody.innerHTML = emptyRow(6, friendlyError(error, 'Could not load customers.')); return; }
  if (!customers?.length) { tbody.innerHTML = emptyRow(6, 'No customers registered yet'); return; }
  tbody.innerHTML = customers.map(c => `
    <tr>
      <td><p class="font-medium">${esc(c.full_name)}</p></td>
      <td class="text-gray-400 text-sm">${esc(c.email)}</td>
      <td class="text-gray-400 text-sm">${esc(c.phone || '—')}</td>
      <td class="text-gray-400 text-sm">${esc(c.id_number || '—')}</td>
      <td class="text-gray-500 text-xs">${esc(fmtDate(c.created_at))}</td>
      <td><button type="button" ${act('viewCustomerBookings', c.id, c.full_name)} class="action-btn btn-default">View Bookings</button></td>
    </tr>`).join('');
}

async function viewCustomerBookings(id, name) {
  const { data: bookings, error } = await sb
    .from('bookings').select('*, boats(name, type)')
    .eq('customer_id', int(id)).is('deleted_at', null)
    .order('created_at', { ascending: false });
  const rows = error ? emptyRow(6, friendlyError(error, 'Could not load bookings.'))
    : (bookings || []).length
    ? bookings.map(b => `
        <tr>
          <td class="text-xs text-gray-400">#${int(b.id)}</td>
          <td>${esc(b.boats?.name || '—')}</td>
          <td class="text-xs">${esc(fmtDate(b.start_date))} → ${esc(fmtDate(b.end_date))}</td>
          <td class="text-cyan-400">${esc(fmt(b.total_amount))}</td>
          <td>${badge(b.status)}</td>
          <td>${badge(b.payment_status)}</td>
        </tr>`).join('')
    : emptyRow(6, 'No bookings');
  document.getElementById('cb-modal-title').textContent = name + ' — Bookings';
  document.getElementById('cb-modal-tbody').innerHTML = rows;
  openModal('modal-customer-bookings');
}

registerLoader('customers', loadCustomers);

// ── CUSTOMER PORTAL: browse boats ─────────────────────────
async function loadCustomerBoats() {
  const grid = document.getElementById('c-boats-grid');
  grid.innerHTML = '<p class="col-span-3 text-center text-gray-500 py-12">Loading...</p>';
  const { data: boats, error } = await sb.from('boats').select('*').eq('status', 'Available').is('deleted_at', null).order('name');
  if (error) { grid.innerHTML = `<p class="col-span-3 text-center text-red-400 py-12">${esc(friendlyError(error, 'Could not load boats.'))}</p>`; return; }
  if (!boats?.length) { grid.innerHTML = '<p class="col-span-3 text-center text-gray-500 py-12">No boats available right now</p>'; return; }
  grid.innerHTML = boats.map(b => `
      <div class="card overflow-hidden">
        <img src="${esc(safeImgUrl(b.photo_urls))}" alt="${esc(b.name)}" class="boat-photo" loading="lazy" referrerpolicy="no-referrer">
        <div class="p-5">
          <h3 class="text-lg font-bold mb-1">${esc(b.name)}</h3>
          <p class="text-cyan-300 text-sm mb-1">${esc(b.type)} · ${int(b.capacity)} pax</p>
          <p class="text-xl font-bold mb-3">${esc(fmt(b.base_price))}<span class="text-sm text-gray-400 font-normal">/day</span></p>
          <button type="button" ${act('openCustomerBooking', b.id, b.name, b.base_price)}
            class="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-2xl transition-colors">
            <i class="fas fa-calendar-plus mr-2"></i>Book Now
          </button>
        </div>
      </div>`).join('');
}

// ── CUSTOMER PORTAL: my bookings (RLS already limits rows to the signed-in customer) ──
async function loadCustomerBookings() {
  const el = document.getElementById('c-bookings-list');
  el.textContent = 'Loading...';
  const { data: bookings, error } = await sb
    .from('bookings').select('*, boats(name, type), payments(amount)')
    .eq('customer_id', int(currentCustomerId)).is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) { el.innerHTML = `<p class="text-center text-red-400 py-12">${esc(friendlyError(error, 'Could not load your bookings.'))}</p>`; return; }
  if (!bookings?.length) { el.innerHTML = '<p class="text-center text-gray-500 py-12">No bookings yet</p>'; return; }
  el.innerHTML = bookings.map(b => {
    const totalPaid = (b.payments || []).reduce((s, p) => s + p.amount, 0);
    const balance   = (b.total_amount || 0) - totalPaid;
    return `
      <div class="card p-5 mb-4">
        <div class="flex justify-between items-start mb-3">
          <div>
            <p class="font-bold text-lg">${esc(b.boats?.name || '—')} <span class="text-sm text-gray-400 font-normal">(${esc(b.boats?.type || '')})</span></p>
            <p class="text-sm text-gray-400">${esc(fmtDate(b.start_date))} → ${esc(fmtDate(b.end_date))}</p>
          </div>
          <div class="text-right">${badge(b.status)}<br><span class="text-xs text-gray-400 mt-1 block">${badge(b.payment_status)}</span></div>
        </div>
        <div class="flex justify-between text-sm border-t border-white/5 pt-3">
          <span class="text-gray-400">Total: <span class="text-white font-semibold">${esc(fmt(b.total_amount))}</span></span>
          <span class="text-gray-400">Paid: <span class="text-green-400 font-semibold">${esc(fmt(totalPaid))}</span></span>
          <span class="text-gray-400">Balance: <span class="${balance > 0 ? 'text-red-400' : 'text-green-400'} font-semibold">${esc(fmt(balance))}</span></span>
        </div>
        ${b.status === 'Approved' && balance > 0
          ? `<button type="button" ${act('openCustomerPayment', b.id, balance)}
               class="mt-3 w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm">
               <i class="fas fa-credit-card mr-1"></i>Make Payment</button>` : ''}
        ${b.status === 'Pending'
          ? `<button type="button" ${act('cancelMyBooking', b.id)}
               class="mt-3 w-full py-2 bg-white/10 hover:bg-white/20 text-red-300 font-medium rounded-xl text-sm">
               <i class="fas fa-times mr-1"></i>Cancel request</button>` : ''}
      </div>`;
  }).join('');
}

async function cancelMyBooking(id) {
  if (!confirm('Cancel this booking request?')) return;
  const { data, error } = await sb.from('bookings').update({ status: 'Cancelled' }).eq('id', int(id)).select('id');
  if (error || !data?.length) { showToast(friendlyError(error, 'Could not cancel the booking.'), 'error'); return; }
  showToast('Booking cancelled', 'warning'); loadCustomerBookings();
}

// ── CUSTOMER PORTAL: my payments ─────────────────────────
async function loadCustomerPayments() {
  const el = document.getElementById('c-payments-list');
  el.textContent = 'Loading...';
  const { data: payments, error } = await sb
    .from('payments').select('*, bookings(boats(name))')
    .order('created_at', { ascending: false });             // RLS: only this customer's payments come back
  if (error) { el.innerHTML = `<p class="text-center text-red-400 py-12">${esc(friendlyError(error, 'Could not load your payments.'))}</p>`; return; }
  el.innerHTML = (payments || []).length
    ? payments.map(p => `
        <div class="card p-4 mb-3 flex justify-between items-center">
          <div>
            <p class="font-medium">${esc(p.bookings?.boats?.name || '—')}</p>
            <p class="text-xs text-gray-400">${esc(p.method)}${p.reference ? ' · ' + esc(p.reference) : ''} · ${esc(fmtDate(p.created_at))}</p>
          </div>
          <p class="text-cyan-400 font-bold">${esc(fmt(p.amount))}</p>
        </div>`).join('')
    : '<p class="text-center text-gray-500 py-12">No payments yet</p>';
}

// ── Customer makes a booking ──────────────────────────────
let c_bookingBoatId = null;
let c_bookingPrice  = 0;

function openCustomerBooking(id, name, price) {
  c_bookingBoatId = int(id);
  c_bookingPrice  = int(price);
  document.getElementById('c-book-boat-name').textContent = name;
  document.getElementById('c-book-preview').classList.add('hidden');
  const s = document.getElementById('c-book-start'), e = document.getElementById('c-book-end');
  s.value = ''; e.value = ''; s.min = e.min = todayISO();
  document.getElementById('c-book-notes').value = '';
  openModal('modal-c-book');
}

function calcCustomerBookingPreview() {
  const start = document.getElementById('c-book-start').value;
  const end   = document.getElementById('c-book-end').value;
  const prev  = document.getElementById('c-book-preview');
  const days  = start && end ? daysBetween(start, end) : 0;
  if (days <= 0) { prev.classList.add('hidden'); return; }
  document.getElementById('c-book-days').textContent  = days + (days === 1 ? ' day' : ' days');
  document.getElementById('c-book-total').textContent = fmt(days * c_bookingPrice) + ' (estimate)';
  prev.classList.remove('hidden');
}

async function submitCustomerBooking() {
  const start = document.getElementById('c-book-start').value;
  const end   = document.getElementById('c-book-end').value;
  const notes = document.getElementById('c-book-notes').value.trim().slice(0, 1000);
  if (!start || !end) { showToast('Select dates', 'error'); return; }
  if (daysBetween(start, end) <= 0) { showToast('End must be after start', 'error'); return; }
  await once('cbook', async () => {
    // price, status and payment status are decided by the database, not sent from here
    const { error } = await sb.from('bookings').insert({
      customer_id: currentCustomerId, boat_id: c_bookingBoatId, start_date: start, end_date: end, notes: notes || null,
    });
    if (error) { showToast(friendlyError(error, 'Could not send the booking request.'), 'error'); return; }
    showToast('Booking request sent — awaiting approval!', 'success');
    closeModal('modal-c-book');
    showSection('c-bookings');
  });
}

// ── Customer makes a payment (atomic server-side call) ────
function openCustomerPayment(bookingId, balance) {
  document.getElementById('c-pay-booking-id').value = int(bookingId);
  document.getElementById('c-pay-amount').value     = int(balance);
  document.getElementById('c-pay-max').textContent  = fmt(balance);
  openModal('modal-c-payment');
}

async function submitCustomerPayment() {
  const bookingId = int(document.getElementById('c-pay-booking-id').value);
  const amount    = parseInt(document.getElementById('c-pay-amount').value, 10);
  const method    = document.getElementById('c-pay-method').value;
  const reference = document.getElementById('c-pay-reference').value.trim();
  if (!Number.isInteger(amount) || amount <= 0 || !method) { showToast('A positive amount and a method are required', 'error'); return; }
  if (method === 'MPesa' && !reference) { showToast('Enter the M-Pesa confirmation code', 'error'); return; }
  await once('cpay', async () => {
    const { error } = await sb.rpc('record_payment', {
      p_booking_id: bookingId, p_amount: amount, p_method: method, p_reference: reference || null,
    });
    if (error) { showToast(friendlyError(error, 'Payment was not recorded.'), 'error'); return; }
    showToast('Payment submitted!', 'success');
    document.getElementById('c-pay-reference').value = '';
    closeModal('modal-c-payment');
    showSection('c-bookings');
  });
}

registerLoader('c-boats',    loadCustomerBoats);
registerLoader('c-bookings', loadCustomerBookings);
registerLoader('c-payments', loadCustomerPayments);
registerActions({ viewCustomerBookings, openCustomerBooking, submitCustomerBooking,
                  openCustomerPayment, submitCustomerPayment, cancelMyBooking });
