async function populateIncidentBoats() {
  const { data: boats } = await sb.from('boats').select('id, name').order('name');
  document.getElementById('i-boat').innerHTML = '<option value="">— Select Boat —</option>' +
    (boats||[]).map(b => `<option value="${b.id}">${b.name}</option>`).join('');
}

async function loadIncidents() {
  const { data: incidents } = await sb
    .from('incidents')
    .select('*, boats(name)')
    .order('incident_date', { ascending: false });
  const isAM = ['Admin','Manager'].includes(currentUserRole);
  document.getElementById('incidents-tbody').innerHTML = !(incidents?.length)
    ? '<tr><td colspan="6" class="text-center py-8 text-gray-500">No incidents</td></tr>'
    : incidents.map(i => `<tr>
        <td class="font-medium">${i.boats?.name||'—'}</td>
        <td class="text-sm text-gray-400">${fmtDate(i.incident_date)}</td>
        <td class="text-sm text-gray-300" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.description}</td>
        <td>${i.photo_urls?`<img src="${i.photo_urls}" class="incident-photo cursor-pointer" onclick="window.open('${i.photo_urls}','_blank')">`:'—'}</td>
        <td>${badge(i.status)}</td>
        <td>${isAM && i.status==='Reported'
          ? btnSm('Resolve', `resolveIncident(${i.id})`, 'btn-approve')
          : '—'}</td>
      </tr>`).join('');
}

async function addIncident() {
  const boatId = document.getElementById('i-boat').value;
  const desc   = document.getElementById('i-desc').value.trim();
  const file   = document.getElementById('i-photo').files[0];
  if (!boatId || !desc) { showToast('Select a boat and enter description','error'); return; }
  showToast('Submitting...','info');
  const photoUrl = await uploadPhoto('incidents', file);
  const { error } = await sb.from('incidents').insert({ boat_id: parseInt(boatId), description: desc, photo_urls: photoUrl, status: 'Reported' });
  if (error) { showToast('Failed: '+error.message,'error'); return; }
  showToast('Incident reported!','success');
  closeModal('modal-add-incident');
  document.getElementById('i-desc').value  = '';
  document.getElementById('i-photo').value = '';
  loadIncidents();
}

async function resolveIncident(id) {
  const { error } = await sb.from('incidents').update({ status: 'Resolved' }).eq('id', id);
  if (error) { showToast('Failed','error'); return; }
  showToast('Marked as Resolved','success'); loadIncidents();
}

registerLoader('incidents', loadIncidents);
