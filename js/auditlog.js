'use strict';
// Admin-only view of the append-only audit_log table (RLS: Admin can SELECT, nobody can modify).
async function loadAudit() {
  const tbody = document.getElementById('audit-tbody');
  const { data: rows, error } = await sb
    .from('audit_log')
    .select('id, at, actor_email, actor_role, table_name, record_id, action, changed_fields')
    .order('id', { ascending: false }).limit(200);
  if (error) { tbody.innerHTML = emptyRow(5, friendlyError(error, 'Could not load the audit log.')); return; }
  if (!rows?.length) { tbody.innerHTML = emptyRow(5, 'No activity recorded yet'); return; }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="text-xs text-gray-400 whitespace-nowrap">${esc(fmtDateTime(r.at))}</td>
      <td class="text-sm">${esc(r.actor_email || 'system')}<span class="text-xs text-gray-500"> ${esc(r.actor_role || '')}</span></td>
      <td class="text-sm">${esc(r.table_name)} <span class="text-gray-500">#${esc(r.record_id)}</span></td>
      <td><span class="text-xs px-2 py-1 rounded-full bg-cyan-900 text-cyan-300">${esc(r.action)}</span></td>
      <td class="text-xs text-gray-400">${esc((r.changed_fields || []).join(', ') || '—')}</td>
    </tr>`).join('');
}
registerLoader('audit', loadAudit);
registerActions({ loadAudit });
