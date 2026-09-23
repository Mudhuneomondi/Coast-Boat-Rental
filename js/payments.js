async function loadPayments() {
  const { data: payments } = await sb
    .from('payments')
    .select('*, bookings(id, total_amount, customers(full_name), boats(name))')
    .order('created_at', { ascending: false });

  if (!payments?.length) {
    document.getElementById('payments-tbody').innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-500">No payments yet</td></tr>';
    return;
  }
  document.getElementById('payments-tbody').innerHTML = payments.map(p => `
    <tr>
      <td class="text-gray-500 text-xs">${fmtDate(p.created_at)}</td>
      <td>${p.bookings?.customers?.full_name||'—'}</td>
      <td class="text-gray-400 text-xs">#${p.booking_id} · ${p.bookings?.boats?.name||'—'}</td>
      <td class="text-cyan-400 font-semibold">${fmt(p.amount)}</td>
      <td>${p.method}</td>
      <td class="text-xs text-gray-400">${p.reference||'—'}</td>
      <td class="text-xs text-gray-400">${fmtDate(p.created_at)}</td>
    </tr>`).join('');
}

async function populatePaymentBookings() {
  const { data: bookings } = await sb
    .from('bookings')
    .select('id, total_amount, customers(full_name), boats(name)')
    .in('status', ['Approved'])
    .neq('payment_status', 'Paid')
    .order('id');
  const sel = document.getElementById('pm-booking-id');
  if (!sel) return;
  // If already pre-filled from booking action, keep it
  if (!sel.value) {
    sel.innerHTML = '<option value="">— Select Booking —</option>' +
      (bookings||[]).map(b => `<option value="${b.id}">#${b.id} — ${b.customers?.full_name||'?'} — ${b.boats?.name||'?'} — ${fmt(b.total_amount)}</option>`).join('');
  }
}

async function recordPayment() {
  const bookingId = document.getElementById('pm-booking-id').value;
  const amount    = parseInt(document.getElementById('pm-amount').value);
  const method    = document.getElementById('pm-method').value;
  const reference = document.getElementById('pm-reference').value.trim();
  if (!bookingId || !amount || !method) { showToast('Booking, amount and method required','error'); return; }

  // Insert payment record
  const { error } = await sb.from('payments').insert({
    booking_id: parseInt(bookingId), amount, method, reference,
    recorded_by: currentUserId
  });
  if (error) { showToast('Failed: '+error.message,'error'); return; }

  // Check total paid vs booking total to update payment_status
  const { data: booking } = await sb.from('bookings').select('total_amount').eq('id', bookingId).single();
  const { data: allPaid } = await sb.from('payments').select('amount').eq('booking_id', bookingId);
  const totalPaid = (allPaid||[]).reduce((s, p) => s + p.amount, 0);
  const payStatus = totalPaid >= (booking?.total_amount||0) ? 'Paid' : 'Partial';
  await sb.from('bookings').update({ payment_status: payStatus }).eq('id', bookingId);

  showToast(`Payment recorded — booking is now ${payStatus}`,'success');
  closeModal('modal-add-payment');
  document.getElementById('pm-amount').value    = '';
  document.getElementById('pm-reference').value = '';
  document.getElementById('pm-booking-id').value = '';
  loadPayments(); loadBookings();
}

registerLoader('payments', loadPayments);
