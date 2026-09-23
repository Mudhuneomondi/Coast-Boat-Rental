let fleetChart = null;

async function loadDashboard() {
  // Show loading state immediately so it's never a black screen
  document.getElementById('kpi-grid').innerHTML = `
    <div class="card p-5 text-gray-400 text-sm col-span-4 text-center py-6">
      <i class="fas fa-spinner fa-spin mr-2"></i>Loading dashboard...
    </div>`;
  document.getElementById('recent-incidents').innerHTML =
    '<p class="text-gray-500 text-xs text-center py-4"><i class="fas fa-spinner fa-spin mr-2"></i>Loading...</p>';

  try {
    const [
      { data: boats,     error: e1 },
      { data: bookings,  error: e2 },
      { data: incidents, error: e3 },
      { data: customers, error: e4 }
    ] = await Promise.all([
      sb.from('boats').select('status'),
      sb.from('bookings').select('status, payment_status'),
      sb.from('incidents')
        .select('status, incident_date, description, boats(name)')
        .order('incident_date', { ascending: false }).limit(5),
      sb.from('customers').select('id'),
    ]);

    // If any query errored, log it but keep going with empty arrays
    if (e1) console.warn('boats query:', e1.message);
    if (e2) console.warn('bookings query:', e2.message);
    if (e3) console.warn('incidents query:', e3.message);
    if (e4) console.warn('customers query:', e4.message);

    const b  = boats     || [];
    const bk = bookings  || [];
    const i  = incidents || [];
    const c  = customers || [];

    const avail   = b.filter(x => x.status === 'Available').length;
    const rented  = b.filter(x => x.status === 'Rented').length;
    const maint   = b.filter(x => x.status === 'Maintenance').length;
    const pending = bk.filter(x => x.status === 'Pending').length;
    const unpaid  = bk.filter(x => x.payment_status === 'Unpaid' && x.status === 'Approved').length;
    const openInc = i.filter(x => x.status === 'Reported').length;

    const kpis = [
      { label: 'Total Boats',      value: b.length, icon: 'ship',                  color: 'text-cyan-400'   },
      { label: 'Available',        value: avail,    icon: 'check-circle',          color: 'text-green-400'  },
      { label: 'Rented',           value: rented,   icon: 'anchor',                color: 'text-blue-400'   },
      { label: 'Pending Bookings', value: pending,  icon: 'clock',                 color: 'text-yellow-400' },
      { label: 'Awaiting Payment', value: unpaid,   icon: 'money-bill-wave',       color: 'text-orange-400' },
      { label: 'Customers',        value: c.length, icon: 'users',                 color: 'text-purple-400' },
      { label: 'Open Incidents',   value: openInc,  icon: 'exclamation-triangle',  color: 'text-red-400'    },
      { label: 'Maintenance',      value: maint,    icon: 'tools',                 color: 'text-gray-400'   },
    ];

    document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
      <div class="card p-5">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-${k.icon} ${k.color}"></i>
          <span class="text-xs text-gray-400 uppercase tracking-wider">${k.label}</span>
        </div>
        <p class="text-2xl font-bold">${k.value}</p>
      </div>`).join('');

    // Fleet chart
    if (fleetChart) fleetChart.destroy();
    const ctx = document.getElementById('fleet-chart');
    if (ctx) {
      fleetChart = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Available', 'Rented', 'Maintenance'],
          datasets: [{ data: [avail, rented, maint], backgroundColor: ['#4ade80','#60a5fa','#facc15'], borderWidth: 0, hoverOffset: 6 }]
        },
        options: { responsive: true, plugins: { legend: { labels: { color: '#9ca3af', font: { size: 12 } } } } }
      });
    }

    // Recent incidents
    document.getElementById('recent-incidents').innerHTML = i.length
      ? i.map(x => `
          <div class="flex items-start justify-between py-2 border-b border-white/5 last:border-0">
            <div>
              <p class="font-medium text-white text-sm">${x.boats?.name || '—'}</p>
              <p class="text-gray-500 text-xs">${(x.description||'').slice(0,60)}${(x.description||'').length > 60 ? '...' : ''}</p>
            </div>
            <span class="badge status-${(x.status||'').toLowerCase()} ml-2 shrink-0">${x.status}</span>
          </div>`).join('')
      : '<p class="text-gray-500 text-xs text-center py-4">No incidents yet</p>';

  } catch (err) {
    console.error('Dashboard error:', err);
    document.getElementById('kpi-grid').innerHTML = `
      <div class="col-span-4 text-center py-6 text-red-400 text-sm">
        <i class="fas fa-exclamation-circle mr-2"></i>
        Failed to load dashboard. Check console for details.<br>
        <span class="text-xs text-gray-500 mt-1 block">Most likely cause: RLS is enabled in Supabase. Go to Table Editor → each table → Disable RLS.</span>
      </div>`;
  }
}

registerLoader('dashboard', loadDashboard);
