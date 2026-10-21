'use strict';
async function loadPayments() {
  const tbody = document.getElementById('payments-tbody');
  const { data: payments, error } = await sb
    .from('payments')
    .select('*, bookings(id, total_amount, customers(full_name), boats(name))')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) { tbody.innerHTML = emptyRow(7, friendlyError(error, 'Could not load payments.')); return; }
  if (!payments?.length) { tbody.innerHTML = emptyRow(7, 'No payments yet'); return; }
  tbody.innerHTML = payments.map(p => `
    <tr>
      <td class="text-gray-500 text-xs">${esc(fmtDate(p.created_at))}</td>
      <td>${esc(p.bookings?.customers?.full_name || '—')}</td>
      <td class="text-gray-400 text-xs">#${int(p.booking_id)} · ${esc(p.bookings?.boats?.name || '—')}</td>
      <td class="text-cyan-400 font-semibold">${esc(fmt(p.amount))}</td>
      <td>${esc(p.method)}</td>
      <td class="text-xs text-gray-400">${esc(p.reference || '—')}</td>
      <td class="text-xs text-gray-400">${esc(fmtDate(p.created_at))}</td>
    </tr>`).join('');
}

async function populatePaymentBookings() {
  const sel = document.getElementById('pm-booking-id');
  if (!sel) return;
  const { data: bookings, error } = await sb
    .from('bookings')
    .select('id, total_amount, payment_status, customers(full_name), boats(name)')
    .eq('status', 'Approved').neq('payment_status', 'Paid').is('deleted_at', null)
    .order('id');
  if (error) { showToast(friendlyError(error, 'Could not load bookings.'), 'error'); return; }
  sel.innerHTML = '<option value="">— Select Booking —</option>' +
    (bookings || []).map(b => `<option value="${int(b.id)}">#${int(b.id)} — ${esc(b.customers?.full_name || '?')} — ${esc(b.boats?.name || '?')} — ${esc(fmt(b.total_amount))}</option>`).join('');
  if (sel.dataset.preset) { sel.value = sel.dataset.preset; delete sel.dataset.preset; }
}

// One atomic server-side call: lock booking → validate → insert payment → update status.
// Nothing here can leave a payment recorded without the booking being updated (or vice-versa).
async function recordPayment() {
  const bookingId = int(document.getElementById('pm-booking-id').value);
  const amount    = parseInt(document.getElementById('pm-amount').value, 10);
  const method    = document.getElementById('pm-method').value;
  const reference = document.getElementById('pm-reference').value.trim();
  if (!bookingId || !Number.isInteger(amount) || amount <= 0 || !method) { showToast('Booking, a positive amount and method required', 'error'); return; }

  await once('payment', async () => {
    const { data, error } = await sb.rpc('record_payment', {
      p_booking_id: bookingId, p_amount: amount, p_method: method, p_reference: reference || null,
    });
    if (error) { showToast(friendlyError(error, 'Payment was not recorded.'), 'error'); return; }
    showToast(`Payment recorded — booking is now ${data.payment_status}`, 'success');
    closeModal('modal-add-payment');
    document.getElementById('pm-amount').value = '';
    document.getElementById('pm-reference').value = '';
    document.getElementById('pm-booking-id').value = '';
    loadPayments(); loadBookings();
  });
}

registerLoader('payments', loadPayments);
registerActions({ recordPayment });
