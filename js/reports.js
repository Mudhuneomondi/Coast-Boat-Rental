let reportStatusChart = null, reportBookingChart = null;

async function loadReports() {
  const [{ data: boats }, { data: bookings }, { data: payments }] = await Promise.all([
    sb.from('boats').select('status'),
    sb.from('bookings').select('status, payment_status, total_amount, created_at'),
    sb.from('payments').select('amount, created_at'),
  ]);

  const sc = { Available:0, Rented:0, Maintenance:0 };
  (boats||[]).forEach(b => { if (sc[b.status]!==undefined) sc[b.status]++; });

  if (reportStatusChart) reportStatusChart.destroy();
  reportStatusChart = new Chart(document.getElementById('report-status-chart').getContext('2d'), {
    type: 'bar',
    data: { labels: Object.keys(sc), datasets: [{ data: Object.values(sc), backgroundColor: ['#4ade80','#60a5fa','#facc15'], borderRadius: 8 }] },
    options: { responsive:true, plugins:{legend:{display:false}}, scales:{y:{ticks:{color:'#94a3b8'}},x:{ticks:{color:'#94a3b8'}}} }
  });

  const bkStatus = { Pending:0, Approved:0, Rejected:0, Completed:0, Cancelled:0 };
  (bookings||[]).forEach(b => { if (bkStatus[b.status]!==undefined) bkStatus[b.status]++; });

  if (reportBookingChart) reportBookingChart.destroy();
  reportBookingChart = new Chart(document.getElementById('report-booking-chart').getContext('2d'), {
    type: 'doughnut',
    data: { labels: Object.keys(bkStatus), datasets: [{ data: Object.values(bkStatus), backgroundColor: ['#facc15','#4ade80','#f87171','#94a3b8','#c084fc'], borderWidth:0 }] },
    options: { responsive:true, plugins:{legend:{labels:{color:'#9ca3af'}}} }
  });

  const totalRevenue  = (payments||[]).reduce((s,p) => s + (p.amount||0), 0);
  const totalBookings = (bookings||[]).length;
  const avgValue      = totalBookings > 0 ? Math.round((bookings||[]).reduce((s,b) => s+(b.total_amount||0),0) / totalBookings) : 0;
  const unpaidCount   = (bookings||[]).filter(b => b.payment_status==='Unpaid' && b.status==='Approved').length;

  document.getElementById('report-summary').innerHTML = `
    <div class="card p-5"><div class="text-xs text-gray-400 uppercase tracking-wider mb-2">Total Revenue Collected</div><p class="text-2xl font-bold text-cyan-400">${fmt(totalRevenue)}</p></div>
    <div class="card p-5"><div class="text-xs text-gray-400 uppercase tracking-wider mb-2">Total Bookings</div><p class="text-2xl font-bold">${totalBookings}</p></div>
    <div class="card p-5"><div class="text-xs text-gray-400 uppercase tracking-wider mb-2">Avg Booking Value</div><p class="text-2xl font-bold">${fmt(avgValue)}</p></div>
    <div class="card p-5"><div class="text-xs text-gray-400 uppercase tracking-wider mb-2">Awaiting Payment</div><p class="text-2xl font-bold text-orange-400">${unpaidCount}</p></div>
  `;
}

registerLoader('reports', loadReports);
