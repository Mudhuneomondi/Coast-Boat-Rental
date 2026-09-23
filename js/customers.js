// ── STAFF: view registered customers ─────────────────────
async function loadCustomers() {
  const { data: customers } = await sb.from('customers').select('*').order('created_at', { ascending: false });
  if (!customers?.length) {
    document.getElementById('customers-tbody').innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">No customers registered yet</td></tr>';
    return;
  }
  document.getElementById('customers-tbody').innerHTML = customers.map(c => `
    <tr>
      <td><p class="font-medium">${c.full_name}</p></td>
      <td class="text-gray-400 text-sm">${c.email}</td>
      <td class="text-gray-400 text-sm">${c.phone||'—'}</td>
      <td class="text-gray-400 text-sm">${c.id_number||'—'}</td>
      <td class="text-gray-500 text-xs">${fmtDate(c.created_at)}</td>
      <td>
        <button onclick="viewCustomerBookings(${c.id},'${c.full_name.replace(/'/g,"\\'")}') "
          class="action-btn btn-default">View Bookings</button>
      </td>
    </tr>`).join('');
}

async function viewCustomerBookings(id, name) {
  const { data: bookings } = await sb
    .from('bookings')
    .select('*, boats(name, type)')
    .eq('customer_id', id)
    .order('created_at', { ascending: false });

  const rows = (bookings||[]).length
    ? bookings.map(b => `
        <tr>
          <td class="text-xs text-gray-400">#${b.id}</td>
          <td>${b.boats?.name||'—'}</td>
          <td class="text-xs">${fmtDate(b.start_date)} → ${fmtDate(b.end_date)}</td>
          <td class="text-cyan-400">${fmt(b.total_amount)}</td>
          <td>${badge(b.status)}</td>
          <td>${badge(b.payment_status)}</td>
        </tr>`).join('')
    : '<tr><td colspan="6" class="text-center py-4 text-gray-500">No bookings</td></tr>';

  document.getElementById('cb-modal-title').textContent = name + ' — Bookings';
  document.getElementById('cb-modal-tbody').innerHTML = rows;
  openModal('modal-customer-bookings');
}

registerLoader('customers', loadCustomers);

// ── CUSTOMER PORTAL: browse boats ─────────────────────────
async function loadCustomerBoats() {
  const grid = document.getElementById('c-boats-grid');
  grid.innerHTML = '<p class="col-span-3 text-center text-gray-500 py-12">Loading...</p>';
  const { data: boats, error } = await sb.from('boats').select('*').eq('status','Available').order('name');
  if (error) {
    console.error('loadCustomerBoats error:', error);
    grid.innerHTML = `<p class="col-span-3 text-center text-red-400 py-12">Error: ${error.message}</p>`;
    return;
  }
  if (!boats?.length) { grid.innerHTML = '<p class="col-span-3 text-center text-gray-500 py-12">No boats available right now</p>'; return; }
  grid.innerHTML = boats.map(b => {
    const photo = b.photo_urls || `https://picsum.photos/seed/${b.id}/400/220`;
    return `
      <div class="card overflow-hidden">
        <img src="${photo}" class="boat-photo" onerror="this.src='https://picsum.photos/400/220'">
        <div class="p-5">
          <h3 class="text-lg font-bold mb-1">${b.name}</h3>
          <p class="text-cyan-300 text-sm mb-1">${b.type} · ${b.capacity} pax</p>
          <p class="text-xl font-bold mb-3">${fmt(b.base_price)}<span class="text-sm text-gray-400 font-normal">/day</span></p>
          <button onclick="openCustomerBooking(${b.id},'${b.name.replace(/'/g,"\\'")}',${b.base_price})"
            class="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-2xl transition-colors">
            <i class="fas fa-calendar-plus mr-2"></i>Book Now
          </button>
        </div>
      </div>`;
  }).join('');
}

// ── CUSTOMER PORTAL: my bookings ──────────────────────────
async function loadCustomerBookings() {
  const el = document.getElementById('c-bookings-list');
  el.innerHTML = 'Loading...';
  const { data: bookings, error } = await sb
    .from('bookings')
    .select('*, boats(name, type), payments(*)')
    .eq('customer_id', currentCustomerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('loadCustomerBookings error:', error);
    el.innerHTML = `<p class="text-center text-red-400 py-12">Error: ${error.message}</p>`;
    return;
  }
  if (!bookings?.length) {
    el.innerHTML = '<p class="text-center text-gray-500 py-12">No bookings yet</p>';
    return;
  }
  document.getElementById('c-bookings-list').innerHTML = bookings.map(b => {
    const totalPaid = (b.payments||[]).reduce((s,p) => s+p.amount, 0);
    const balance   = (b.total_amount||0) - totalPaid;
    return `
      <div class="card p-5 mb-4">
        <div class="flex justify-between items-start mb-3">
          <div>
            <p class="font-bold text-lg">${b.boats?.name||'—'} <span class="text-sm text-gray-400 font-normal">(${b.boats?.type||''})</span></p>
            <p class="text-sm text-gray-400">${fmtDate(b.start_date)} → ${fmtDate(b.end_date)}</p>
          </div>
          <div class="text-right">
            ${badge(b.status)}
            <br><span class="text-xs text-gray-400 mt-1 block">${badge(b.payment_status)}</span>
          </div>
        </div>
        <div class="flex justify-between text-sm border-t border-white/5 pt-3">
          <span class="text-gray-400">Total: <span class="text-white font-semibold">${fmt(b.total_amount)}</span></span>
          <span class="text-gray-400">Paid: <span class="text-green-400 font-semibold">${fmt(totalPaid)}</span></span>
          <span class="text-gray-400">Balance: <span class="${balance>0?'text-red-400':'text-green-400'} font-semibold">${fmt(balance)}</span></span>
        </div>
        ${b.status==='Approved' && balance>0
          ? `<button onclick="openCustomerPayment(${b.id},${balance})"
               class="mt-3 w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm">
               <i class="fas fa-credit-card mr-1"></i>Make Payment
             </button>`
          : ''}
      </div>`;
  }).join('');
}

// ── CUSTOMER PORTAL: my payments ─────────────────────────
async function loadCustomerPayments() {
  const el = document.getElementById('c-payments-list');
  el.innerHTML = 'Loading...';
  const { data: bookings, error: bErr } = await sb.from('bookings').select('id').eq('customer_id', currentCustomerId);
  if (bErr) {
    console.error('loadCustomerPayments error:', bErr);
    el.innerHTML = `<p class="text-center text-red-400 py-12">Error: ${bErr.message}</p>`;
    return;
  }
  const bookingIds = (bookings||[]).map(b => b.id);
  if (!bookingIds.length) {
    el.innerHTML = '<p class="text-center text-gray-500 py-12">No payments yet</p>';
    return;
  }
  const { data: payments, error: pErr } = await sb
    .from('payments')
    .select('*, bookings(boats(name))')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: false });

  if (pErr) {
    console.error('loadCustomerPayments payments error:', pErr);
    el.innerHTML = `<p class="text-center text-red-400 py-12">Error: ${pErr.message}</p>`;
    return;
  }
  el.innerHTML = (payments||[]).length
    ? payments.map(p => `
        <div class="card p-4 mb-3 flex justify-between items-center">
          <div>
            <p class="font-medium">${p.bookings?.boats?.name||'—'}</p>
            <p class="text-xs text-gray-400">${p.method}${p.reference?' · '+p.reference:''} · ${fmtDate(p.created_at)}</p>
          </div>
          <p class="text-cyan-400 font-bold">${fmt(p.amount)}</p>
        </div>`).join('')
    : '<p class="text-center text-gray-500 py-12">No payments yet</p>';
}

// ── Customer makes a booking ──────────────────────────────
let c_bookingBoatId = null;
let c_bookingPrice  = 0;

function openCustomerBooking(id, name, price) {
  c_bookingBoatId = id;
  c_bookingPrice  = price;
  document.getElementById('c-book-boat-name').textContent = name;
  document.getElementById('c-book-preview').classList.add('hidden');
  document.getElementById('c-book-start').value = '';
  document.getElementById('c-book-end').value   = '';
  document.getElementById('c-book-notes').value = '';
  openModal('modal-c-book');
}

function calcCustomerBookingPreview() {
  const start = document.getElementById('c-book-start').value;
  const end   = document.getElementById('c-book-end').value;
  const prev  = document.getElementById('c-book-preview');
  if (!start || !end) { prev.classList.add('hidden'); return; }
  const days = Math.ceil((new Date(end) - new Date(start)) / 86400000);
  if (days <= 0) { prev.classList.add('hidden'); return; }
  document.getElementById('c-book-days').textContent  = days + (days===1?' day':' days');
  document.getElementById('c-book-total').textContent = fmt(days * c_bookingPrice);
  prev.classList.remove('hidden');
}

async function submitCustomerBooking() {
  const start = document.getElementById('c-book-start').value;
  const end   = document.getElementById('c-book-end').value;
  const notes = document.getElementById('c-book-notes').value.trim();
  if (!start || !end) { showToast('Select dates','error'); return; }
  if (new Date(end) <= new Date(start)) { showToast('End must be after start','error'); return; }
  const days  = Math.ceil((new Date(end) - new Date(start)) / 86400000);
  const total = days * c_bookingPrice;
  const { error } = await sb.from('bookings').insert({
    customer_id: currentCustomerId, boat_id: c_bookingBoatId,
    start_date: start, end_date: end, total_amount: total,
    status: 'Pending', payment_status: 'Unpaid', notes
  });
  if (error) { showToast('Failed: '+error.message,'error'); return; }
  showToast('Booking request sent — awaiting approval!','success');
  closeModal('modal-c-book');
  showSection('c-bookings');
}

// ── Customer makes a payment ──────────────────────────────
function openCustomerPayment(bookingId, balance) {
  document.getElementById('c-pay-booking-id').value = bookingId;
  document.getElementById('c-pay-amount').value     = balance;
  document.getElementById('c-pay-max').textContent  = fmt(balance);
  openModal('modal-c-payment');
}

async function submitCustomerPayment() {
  const bookingId = document.getElementById('c-pay-booking-id').value;
  const amount    = parseInt(document.getElementById('c-pay-amount').value);
  const method    = document.getElementById('c-pay-method').value;
  const reference = document.getElementById('c-pay-reference').value.trim();
  if (!amount || !method) { showToast('Amount and method required','error'); return; }
  if (method === 'MPesa' && !reference) { showToast('Enter MPesa confirmation code','error'); return; }

  const { error } = await sb.from('payments').insert({ booking_id: parseInt(bookingId), amount, method, reference });
  if (error) { showToast('Failed: '+error.message,'error'); return; }

  // Update payment status on booking
  const { data: booking } = await sb.from('bookings').select('total_amount').eq('id', bookingId).single();
  const { data: allPaid }  = await sb.from('payments').select('amount').eq('booking_id', bookingId);
  const totalPaid  = (allPaid||[]).reduce((s, p) => s + p.amount, 0);
  const payStatus  = totalPaid >= (booking?.total_amount||0) ? 'Paid' : 'Partial';
  await sb.from('bookings').update({ payment_status: payStatus }).eq('id', bookingId);

  showToast('Payment submitted!','success');
  closeModal('modal-c-payment');
  showSection('c-bookings');
}

registerLoader('c-boats',    loadCustomerBoats);
registerLoader('c-bookings', loadCustomerBookings);
registerLoader('c-payments', loadCustomerPayments);
