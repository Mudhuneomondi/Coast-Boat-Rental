'use strict';
async function populateIncidentBoats() {
  const { data: boats } = await sb.from('boats').select('id, name').is('deleted_at', null).order('name');
  document.getElementById('i-boat').innerHTML = '<option value="">— Select Boat —</option>' +
    (boats || []).map(b => `<option value="${int(b.id)}">${esc(b.name)}</option>`).join('');
}

// Incident photos live in a PRIVATE bucket; we show them through short-lived signed URLs.
async function signedPhotoUrls(rows) {
  const paths = [...new Set(rows.map(r => r.photo_urls).filter(Boolean))];
  if (!paths.length) return {};
  const { data } = await sb.storage.from('incidents').createSignedUrls(paths, 3600);
  const map = {};
  (data || []).forEach(d => { if (d.signedUrl) map[d.path] = d.signedUrl; });
  return map;
}

async function loadIncidents() {
  const tbody = document.getElementById('incidents-tbody');
  const { data: incidents, error } = await sb
    .from('incidents').select('*, boats(name)').is('deleted_at', null)
    .order('incident_date', { ascending: false }).limit(300);
  if (error) { tbody.innerHTML = emptyRow(6, friendlyError(error, 'Could not load incidents.')); return; }
  if (!incidents?.length) { tbody.innerHTML = emptyRow(6, 'No incidents'); return; }
  const urls = await signedPhotoUrls(incidents);
  const mgr = isManager();
  tbody.innerHTML = incidents.map(i => {
    const url = urls[i.photo_urls];
    return `<tr>
        <td class="font-medium">${esc(i.boats?.name || '—')}</td>
        <td class="text-sm text-gray-400">${esc(fmtDate(i.incident_date))}</td>
        <td class="text-sm text-gray-300" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(i.description)}">${esc(i.description)}</td>
        <td>${url ? `<a href="${esc(safeImgUrl(url))}" target="_blank" rel="noopener noreferrer"><img src="${esc(safeImgUrl(url))}" alt="Incident photo" class="incident-photo" referrerpolicy="no-referrer"></a>` : '—'}</td>
        <td>${badge(i.status)}</td>
        <td>${mgr && i.status === 'Reported' ? btnSm('Resolve', act('resolveIncident', i.id), 'btn-approve') : '—'}</td>
      </tr>`;
  }).join('');
}

async function addIncident() {
  const boatId = int(document.getElementById('i-boat').value);
  const desc   = document.getElementById('i-desc').value.trim();
  const file   = document.getElementById('i-photo').files[0];
  if (!boatId || !desc) { showToast('Select a boat and enter description', 'error'); return; }
  if (desc.length > 2000) { showToast('Description is too long (max 2000 characters)', 'error'); return; }
  await once('addIncident', async () => {
    showToast('Submitting...', 'info');
    let path = null;
    try { path = await uploadPhoto('incidents', file); } catch (e) { showToast(e.message, 'error'); return; }
    const { error } = await sb.from('incidents').insert({ boat_id: boatId, description: desc, photo_urls: path });
    if (error) { showToast(friendlyError(error, 'Could not report the incident.'), 'error'); return; }
    showToast('Incident reported!', 'success');
    closeModal('modal-add-incident');
    document.getElementById('i-desc').value  = '';
    document.getElementById('i-photo').value = '';
    loadIncidents();
  });
}

async function resolveIncident(id) {
  const { data, error } = await sb.from('incidents').update({ status: 'Resolved' }).eq('id', int(id)).select('id');
  if (error || !data?.length) { showToast(friendlyError(error, 'You do not have permission to do that.'), 'error'); return; }
  showToast('Marked as Resolved', 'success'); loadIncidents();
}

registerLoader('incidents', loadIncidents);
registerActions({ addIncident, resolveIncident });
