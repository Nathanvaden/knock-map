/* Knock Map: Settings, filters, help guide, modals, tab switching and startup */
'use strict';

// ---------- settings ----------
function renderSettings() {
  const cnt = BIZ.length, cust = Object.keys(state.custom).length, hid = Object.keys(state.hidden).length;
  $('#settings').innerHTML = `
  <div class="page-title">Settings</div><div class="page-sub">Set up once, then forget about it. <a href="#" id="helpLink">How this app works</a></div>
  <div class="card"><h3><span class="step ${cnt ? 'done' : ''}">${cnt ? '✓' : '1'}</span>Businesses</h3>
    <p class="small">${cnt ? `${cnt} businesses from OpenStreetMap, last pulled ${fmtWhen(bizFetchedAt)}. ${cust} you added. ${hid} hidden.` : 'Nothing loaded yet. Tap the button to pull every business in your zips from OpenStreetMap. Free.'}</p>
    ${loadStatus.running ? '<button class="btn block primary" disabled>Loading… keep this screen open</button>'
      : zipsLeft() ? `<button class="btn block primary" id="loadBiz">${cnt ? `Finish loading (${zipsLeft()} zips left)` : 'Load businesses'}</button>`
      : '<button class="btn block" id="refreshBiz">Refresh all businesses</button>'}
    ${syncReady() && !loadStatus.running ? '<button class="btn block" id="cloudBiz">Get the business list from my other device</button>' : ''}
    <div id="loadMsg" class="small" style="${loadStatus.err ? 'color:#e5484d' : ''}">${esc(loadStatus.msg)}</div>
    <p class="small">Loading saves after each zip, so if it stops you can pick up where it left off. Refreshing keeps all your knocks and notes.</p>
  </div>
  <div class="card"><h3><span class="step ${settings.lastSync ? 'done' : ''}">${settings.lastSync ? '✓' : '2'}</span>Cloud backup</h3>
    <p class="small">Saves your knocks to your private <b>${KM_ID ? 'knock-data-' + KM_ID : 'knock-data'}</b> repo so nothing is lost if your phone dies, and so they show up on any device.</p>
    <div class="field"><label>GitHub username</label><input id="sOwner" value="${esc(settings.owner || '')}" autocapitalize="off" autocorrect="off"></div>
    <div class="field"><label>Data repo</label><input id="sRepo" value="${esc(settings.repo || (KM_ID ? 'knock-data-' + KM_ID : 'knock-data'))}" autocapitalize="off" autocorrect="off"></div>
    <div class="field"><label>Access token</label><input id="sToken" type="password" value="${esc(settings.token || '')}" placeholder="github_pat_…" autocapitalize="off" autocorrect="off"></div>
    <button class="btn block primary" id="saveSync">Save &amp; sync now</button>
    <p class="small">${settings.lastSync ? 'Last synced ' + fmtWhen(settings.lastSync) : 'Not synced yet.'} ${settings.lastSyncErr && !syncReady() ? '' : ''}</p>
  </div>
  <div class="card"><h3><span class="step ${Object.keys(state.permits || {}).length ? 'done' : ''}">${Object.keys(state.permits || {}).length ? '✓' : '3'}</span>Permits (new construction)</h3>
    <p class="small">Each week, download the county's permit spreadsheet from <a href="https://www.maricopa.gov/Archive.aspx?AMID=128" target="_blank" rel="noopener">maricopa.gov weekly permit reports</a> (covers Sun City and Sun City West), or any permit list you get from a city, and drop it here. It keeps the ones in your zips and puts them on the map as orange pins.</p>
    <label style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="pmCom" checked style="width:22px;height:22px"> Commercial only (skip pools, patios, re-roofs)</label>
    <label class="btn block primary" style="text-align:center">Import permit spreadsheet<input type="file" id="pmFile" accept=".xlsx,.xls,.csv" hidden></label>
    <div id="pmMsg" class="small" style="${permitMsg.err ? 'color:#e5484d' : ''}">${esc(permitMsg.text)}</div><div id="pmGeo" class="small"></div>
    <p class="small">${Object.keys(state.permits || {}).length} permits saved · ${livePermits().length} new · ${Object.values(state.permits || {}).filter(p => p.status === 'new' && p.lat == null && !p.geoFail).length} still being placed on the map</p>
  </div>
  <div class="card"><h3>Bay Alarm customers</h3>
    <p class="small">Import the customer account list (Excel or CSV with name, address, service and monthly amount). Customers get a red ring on the map, show their services and what they don't have yet, and are left out of day plans.</p>
    <label style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="cuRes" style="width:22px;height:22px"> Include residential accounts</label>
    <label class="btn block primary" style="text-align:center">Import customer list<input type="file" id="cuFile" accept=".xlsx,.xls,.csv" hidden></label>
    <div id="cuMsg" class="small">${esc(custMsg)}</div><div id="cuGeo" class="small"></div>
    <p class="small">${Object.keys(state.customers || {}).length} customer locations · ${Object.values(state.customers || {}).filter(c => c.bizId).length} on the map${Object.values(state.customers || {}).filter(c => c.geoFail).length ? ' · ' + Object.values(state.customers || {}).filter(c => c.geoFail).length + ' address not found' : ''}</p>
  </div>
  <div class="card"><h3>Custom fields</h3>
    <p class="small">Add anything you want to track on every business. It shows up under Details.</p>
    ${(state.fields || []).map(f => `<div class="brow"><span style="flex:1">${esc(f.name)} <span class="small">(${f.type}${f.options ? ': ' + f.options.map(esc).join(', ') : ''})</span></span><button class="chip" data-delf="${f.id}">Remove</button></div>`).join('') || '<p class="small">None yet.</p>'}
    <div class="two"><div class="field"><label>Field name</label><input id="fName" placeholder="e.g. # of locations"></div>
    <div class="field"><label>Type</label><select id="fType"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="yesno">Yes / No</option><option value="choice">Pick from list</option></select></div></div>
    <div class="field hidden" id="fOptsWrap"><label>Choices (comma separated)</label><input id="fOpts" placeholder="Small, Medium, Large"></div>
    <button class="btn block" id="addField">Add field</button>
  </div>
  <details class="card more" ${settings.moreOpen ? "open" : ""}><summary><h3 style="display:inline">More settings</h3> <span class="small">cooling off, Google, export, home screen</span></summary>
  <div class="sub-card"><h3>Cooling off</h3>
    <p class="small">After someone boots you, their pin fades and they're left out of day plans for this many days.</p>
    <div class="field"><label>Days</label><input id="cdDays" type="number" inputmode="numeric" value="${cooldownDays()}"></div>
  </div>
  <div class="sub-card"><h3>Google details (optional)</h3>
    <p class="small">With a Google Maps API key, each business gets a button that pulls its phone, hours and address. It only calls Google when you tap it.</p>
    <div class="field"><label>Google API key</label><input id="sGkey" type="password" value="${esc(settings.gkey || '')}" autocapitalize="off" autocorrect="off"></div>
    <button class="btn block" id="saveG">Save key</button>
    ${settings.gcalls ? `<p class="small">Google lookups from this phone: ${settings.gcalls}</p>` : ''}
  </div>
  <div class="sub-card"><h3>Export</h3>
    <button class="btn block" id="expCsv">Download spreadsheet (CSV)</button>
    <button class="btn block" id="expJson">Download full backup (JSON)</button>
    <label class="btn block" style="text-align:center">Restore from backup<input type="file" id="impJson" accept=".json,application/json" hidden></label>
  </div>
  <div class="sub-card"><h3>Put it on your home screen</h3><p class="small">In Safari tap the Share button, then <b>Add to Home Screen</b>. It opens full screen like an app.</p></div>
  </details>
  <p class="footer-note">Knock Map v38 · Map data © OpenStreetMap contributors</p>`;
}
$('#settings').addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('more')) { settings.moreOpen = e.target.open; saveLocalSoon(); } }, true);
$('#settings').addEventListener('click', async e => {
  const t = e.target;
  if (t.id === 'helpLink') { e.preventDefault(); showHelp(); return; }
  if (t.id === 'loadBiz') loadBusinesses(false);
  if (t.id === 'refreshBiz') loadBusinesses(true);
  if (t.id === 'cloudBiz') { t.disabled = true; t.textContent = 'Checking the cloud…'; pullBizList(true, true).then(ok => { if (!ok) toast("Couldn't get the list. Check that cloud backup is green."); renderSettingsIfOpen(); }); }
  if (t.id === 'saveSync') {
    settings.owner = $('#sOwner').value.trim(); settings.repo = $('#sRepo').value.trim(); settings.token = $('#sToken').value.trim();
    await saveLocal(); await sync(true); renderSettings();
  }
  if (t.id === 'saveG') { settings.gkey = $('#sGkey').value.trim(); await saveLocal(); toast(settings.gkey ? 'Google key saved' : 'Google key removed'); }
  if (t.id === 'addField') {
    const name = $('#fName').value.trim(); if (!name) return;
    const f = { id: 'f' + Date.now().toString(36), name, type: $('#fType').value };
    if (f.type === 'choice') f.options = $('#fOpts').value.split(',').map(s => s.trim()).filter(Boolean);
    state.fields = (state.fields || []).concat(f); state.fieldsAt = Date.now(); state.updatedAt = Date.now();
    await commit(); renderSettings(); toast('Field added');
  }
  if (t.dataset.delf) { state.fields = state.fields.filter(f => f.id !== t.dataset.delf); state.fieldsAt = Date.now(); await commit(); renderSettings(); }
  if (t.id === 'expCsv') exportCsv();
  if (t.id === 'expJson') download('knock-map-backup-' + todayStr() + '.json', JSON.stringify(state), 'application/json');
});
$('#settings').addEventListener('change', async e => {
  if (e.target.id === 'fType') $('#fOptsWrap').classList.toggle('hidden', e.target.value !== 'choice');
  if (e.target.id === 'cdDays') { state.prefs = { ...(state.prefs || {}), cooldownDays: Math.max(0, +e.target.value || 0), at: Date.now() }; state.updatedAt = Date.now(); commit(); toast('Saved'); }
  if (e.target.id === 'cuFile') {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const msg = $('#cuMsg'); msg.textContent = 'Reading the list…';
    try {
      const r = await importCustomers(f, $('#cuRes').checked);
      custMsg = `Read ${r.read} accounts → ${r.sites} customer locations (${r.added} new). Skipped ${r.skippedRes} residential${r.skippedArea ? ' and ' + r.skippedArea + ' outside your zips' : ''}.`;
      msg.textContent = custMsg;
      placeCustomers(m => { const el = $('#cuGeo'); if (el) el.textContent = m; });
    } catch (err) { custMsg = 'Could not read that file: ' + err.message; msg.textContent = custMsg; }
  }
  if (e.target.id === 'pmFile') {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const msg = $('#pmMsg'); msg.textContent = 'Reading spreadsheet…'; msg.style.color = '';
    try {
      const r = await importPermits(f, $('#pmCom').checked);
      permitMsg = { text: `Read ${r.seen} permits. ${r.added} new in your zips. Skipped ${r.skippedArea} outside your territory${$('#pmCom').checked ? ' and ' + r.skippedRes + ' residential in your zips' : ''}.${!r.added && r.skippedRes ? ' No commercial permits in your area this time.' : ''}`, err: false };
      if (r.customerList) permitMsg = { text: 'That looks like the Bay Alarm customer list, not a permit file. Use Import customers below instead.', err: true };
      else if (!r.seen) permitMsg = { text: "Couldn't find the permit rows in that file (no address column found). Send me the file and I'll adjust it.", err: true };
      msg.textContent = permitMsg.text; msg.style.color = permitMsg.err ? '#e5484d' : '';
      geocodePermits(m => { const el = $('#pmGeo'); if (el) el.textContent = m; });
    } catch (err) { permitMsg = { text: 'Could not read that file: ' + err.message, err: true }; msg.textContent = permitMsg.text; msg.style.color = '#e5484d'; }
  }
  if (e.target.id === 'impJson') {
    const f = e.target.files[0]; if (!f) return;
    try { const data = JSON.parse(await f.text()); state = mergeInto(state, data); reindex(); await commit(); toast('Backup restored and merged'); }
    catch (err) { toast('That file did not work: ' + err.message); }
  }
});
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function exportCsv() {
  const fields = state.fields || [];
  const head = ['Name', 'Category', 'Type', 'Address', 'City', 'Zip', 'Status', 'Visits', 'First visit', 'Last visit', 'Follow-up', 'Decision maker', 'Title', 'Phone', 'Email', 'Provider', 'Contract ends', 'Current system', 'Install $', 'Monthly $', 'Property owner', 'Owner mailing address', 'Future proposals', ...fields.map(f => f.name), 'Notes', 'Lat', 'Lon'];
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const rows = [head];
  for (const b of allBiz()) {
    const r = rec(b.id); if (!r || !(r.visits || []).length && !r.notes && !r.followUp) continue;
    const vs = r.visits || [];
    rows.push([b.name, b.cat, b.type, (r.g && r.g.addr) || b.addr, b.city, b.zip, S[statusOf(b.id)].label, vs.length,
      vs[0] ? new Date(vs[0].t).toLocaleString() : '', vs.length ? new Date(vs[vs.length - 1].t).toLocaleString() : '', r.followUp || '',
      r.dm, r.dmTitle, r.phone || (r.g && r.g.phone) || b.phone, r.email, r.provider, r.contractEnd, r.currentSystem, r.dealInstall, r.dealMonthly, r.parcel && r.parcel.owner, r.parcel && [r.parcel.mail, r.parcel.mailCity].filter(Boolean).join(', '), (r.futures || []).filter(f => f.status === 'open').map(f => f.venue + (f.revisit ? ' (' + f.revisit + ')' : '')).join('; '),
      ...fields.map(f => (r.custom || {})[f.id]), r.notes, b.lat, b.lon]);
  }
  download('knocks-' + todayStr() + '.csv', rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv');
}

// ---------- filters modal ----------
$('#filterBtn').onclick = () => {
  const zips = TERRITORY.features.map(f => f.properties).sort((a, b) => a.zip.localeCompare(b.zip));
  const chip = (set, val, label, color) => `<button class="chip ${set.has(val) ? 'on' : ''}" data-set="${set === filters.statuses ? 's' : set === filters.cats ? 'c' : 'z'}" data-val="${esc(val)}">${color ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:5px"></span>` : ''}${esc(label)}</button>`;
  showModal(`<h3>Show only…</h3><p class="small">Nothing picked in a group means show all.</p>
   <h2 class="sec" style="margin-left:0">Status</h2><div class="checkgrid">${STATUSES.map(s => chip(filters.statuses, s.k, s.label, s.color)).join('')}</div>
   <h2 class="sec" style="margin-left:0">Business type</h2><div class="checkgrid">${CATS.map(c => chip(filters.cats, c, c)).join('')}</div>
   <h2 class="sec" style="margin-left:0">Zip</h2><div class="checkgrid">${zips.map(z => chip(filters.zips, z.zip, z.zip + ' ' + z.city)).join('')}</div>
   <h2 class="sec" style="margin-left:0">Other</h2><div class="checkgrid"><button class="chip ${filters.permits ? 'on' : ''}" data-tog="permits"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f97316;margin-right:5px"></span>Permits</button><button class="chip ${filters.sites ? 'on' : ''}" data-tog="sites"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#eab308;margin-right:5px"></span>Construction</button><button class="chip ${filters.leases ? 'on' : ''}" data-tog="leases"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#0891b2;margin-right:5px"></span>For lease</button><button class="chip ${filters.customers ? 'on' : ''}" data-tog="customers"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #ee2e24;margin-right:5px"></span>Customers</button>${state.plan && state.plan.date === todayStr() ? `<button class="chip ${filters.planOnly ? 'on' : ''}" data-tog="planOnly">Today's plan only</button>` : ''}</div>
   <div class="two" style="margin-top:14px"><button class="btn ghost" id="fClear">Clear all</button><button class="btn primary" id="fDone">Done</button></div>`);
  $('#modalBody').onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.set) { const set = t.dataset.set === 's' ? filters.statuses : t.dataset.set === 'c' ? filters.cats : filters.zips; set.has(t.dataset.val) ? set.delete(t.dataset.val) : set.add(t.dataset.val); t.classList.toggle('on'); }
    if (t.dataset.tog) { filters[t.dataset.tog] = !filters[t.dataset.tog]; t.classList.toggle('on'); }
    if (t.id === 'fClear') { filters.statuses.clear(); filters.cats.clear(); filters.zips.clear(); filters.planOnly = false; filters.permits = true; filters.customers = true; filters.leases = true; filters.sites = true; $('#modalBody').querySelectorAll('.chip.on').forEach(c => c.classList.remove('on')); const pc = $('#modalBody').querySelector('[data-tog=permits]'); if (pc) pc.classList.add('on'); }
    if (t.id === 'fDone') { hideModal(); $('#modalBody').onclick = null; }
    $('#filterDot').classList.toggle('hidden', !filterActive()); refreshAll();
  };
};
// Collapsible sections on Plan and Pipeline: tap a heading to fold it. Remembered per device.
function sectionKey(h) { return h.textContent.replace(/\(.*$/s, '').replace(/·.*$/s, '').trim(); }
function applyCollapse(el) {
  if (!el) return;
  const searching = !!(filters.q || '').trim(), col = settings.collapsed || {};
  el.querySelectorAll('h2.sec').forEach(h => {
    h.classList.add('coll-h'); const shut = !searching && !!col[sectionKey(h)]; h.classList.toggle('shut', shut);
    let n = h.nextElementSibling;
    while (n && !n.matches('h2.sec, .card')) { n.classList.toggle('coll-hide', shut); n = n.nextElementSibling; }
  });
  el.querySelectorAll('.card > h3:first-child').forEach(h => { h.classList.add('coll-h'); const shut = !searching && !!col[sectionKey(h)]; h.classList.toggle('shut', shut); h.parentElement.classList.toggle('collapsed', shut); });
}
['#follow', '#pipe'].forEach(sel => $(sel).addEventListener('click', e => {
  const h = e.target.closest('.coll-h'); if (!h || e.target.closest('button, a, input')) return;
  e.stopPropagation(); settings.collapsed = settings.collapsed || {}; const k = sectionKey(h);
  if (settings.collapsed[k]) delete settings.collapsed[k]; else settings.collapsed[k] = true;
  saveLocal(); applyCollapse($(sel));
}, true));

// Search works on every tab: Map/Nearby filter businesses; Plan and Pipeline filter their own lists.
function searchPage(el) {
  if (!el) return;
  const q = (filters.q || '').trim().toLowerCase();
  el.querySelectorAll('.item').forEach(it => { it.style.display = !q || (it.dataset.q || '').includes(q) || it.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  el.querySelectorAll('h2.sec').forEach(h => {
    let n = h.nextElementSibling, any = false, has = false;
    while (n && !n.matches('h2.sec')) { if (n.classList.contains('item')) { has = true; if (n.style.display !== 'none') any = true; } n = n.nextElementSibling; }
    h.style.display = q && has && !any ? 'none' : '';
  });
  let note = el.querySelector('.searchnote');
  if (q) { const n = [...el.querySelectorAll('.item')].filter(i => i.style.display !== 'none').length; if (!note) { note = document.createElement('div'); note.className = 'searchnote small'; el.querySelector('.page-sub')?.after(note); } note.textContent = n ? `Showing ${n} match${n === 1 ? '' : 'es'} for "${filters.q.trim()}"` : `Nothing here matches "${filters.q.trim()}"`; }
  else if (note) note.remove();
  applyCollapse(el);
}
let st; $('#search').addEventListener('input', e => { clearTimeout(st); st = setTimeout(() => {
  filters.q = e.target.value; listLimit = 100;
  const onPage = ['follow', 'pipe'].find(v => $('#view-' + v).classList.contains('active'));
  if (onPage) { searchPage($('#' + onPage)); drawMarkers(); return; }
  refreshAll(); if (filters.q && $('#view-map').classList.contains('active')) switchView('list');
}, 250); });

// ---------- help ----------
function showHelp() {
  showModal(`<div class="help"><h3>How Knock Map works</h3>
   <p>A map of every business in the territory. Walk in, tap the pin, tap what happened. That's it.</p>
   <h4>Pin colors</h4>
   <ul class="plain">${STATUSES.map(s => `<li><span class="pill" style="--c:${s.color}">${s.label}</span> ${s.hint}</li>`).join('')}<li><span class="pill" style="--c:#f97316">Permit</span> Something's being built or remodeled</li></ul>
   <h4>At the door</h4>
   <ul><li>Tap a pin (or a name in <b>Nearby</b>) to open the business.</li><li>Tap what happened under <b>Log this visit</b>. It saves the time. Tapped the wrong one? Hit <b>Undo</b>.</li><li>Set a follow-up date, or <b>Scan a business card</b> to fill in the contact for you.</li><li><b>Next closest</b> jumps to the nearest place you haven't hit yet.</li><li>Name wrong on the map? Tap <b>✎ Edit</b> next to it.</li></ul>
   <h4>Appointments and deals</h4>
   <ul><li>Booked a meeting? Tap <b>Appt set</b>.</li><li>When you sit down, open the <b>Appt</b> tab and tap <b>Start appointment</b>. Who's there, what they want, time-stamped notes and photos all stay with that appointment.</li><li>Tap <b>End &amp; save</b> when you leave. The business moves to <b>Building quote</b> (big pink pin).</li><li>Sent the quote? Tap <b>Quote sent</b> under Deal stage. A follow-up is set 3 days out.</li><li>Then <b>Sold</b> or <b>Not a fit</b>. Put the install and monthly $ in the Deal box.</li><li>Only took one thing? Add the other venues under <b>Future proposals</b> with a date to bring them back up.</li><li>The <b>Pipeline</b> tab shows every deal by stage, plus future proposals. Quotes out more than a week turn red.</li></ul>
   <h4>Planning</h4>
   <ul><li><b>Plan</b> tab → <b>Plan my day</b> builds a route: follow-ups first, then the closest new doors. Open it in Google Maps 9 stops at a time. <b>Clear plan</b> removes it.</li><li>Follow-ups that are due, contracts ending soon, new permits, construction sites and For Lease signs all show up there too.</li><li><b>Landlords &amp; property managers</b> (bottom of Plan) lists who owns the most commercial buildings in the territory. On any business, <b>Who owns this property?</b> pulls the owner from county records.</li></ul>
   <h4>Good to know</h4>
   <ul><li><b>Notes &amp; photos</b> is for general notes and walkthrough pictures. Appointment notes stay in the Appt tab.</li><li>Booted somewhere? The pin fades and it's left out of plans for 60 days (change it in Settings → More).</li><li>A <b>red ring</b> means it's already a Bay Alarm customer. Open it to see their services and what they don't have yet.</li><li>Tap <b>+</b> on the map → <b>For Lease sign here</b> or <b>Construction site here</b> to mark it where you are. Snap the sign and it reads the phone number and company. Removed one by mistake? Plan → <b>Removed pins</b> → Bring back.</li><li>Business missing from the map? <b>+</b> → <b>A business that's missing</b>.</li><li>The cloud icon turns green when everything is backed up. If a device says <b>Update now</b>, tap it so it doesn't miss newer changes.</li><li><b>Stats → Daily log</b> shows everything you did on a day, with a Copy button for each business so you can paste it into HubSpot.</li><li>Add it to your home screen so it opens like an app.</li></ul>
   <button class="btn block primary" id="helpClose">Got it</button></div>`);
  $('#helpClose').onclick = hideModal;
}

// ---------- modal / toast ----------
function showModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
function hideModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') hideModal(); });
let tt;
function toast(msg, undo) {
  const t = $('#toast'); t.innerHTML = esc(msg) + (undo && lastUndo ? '<button id="undoBtn">Undo</button>' : ''); t.classList.remove('hidden');
  clearTimeout(tt); tt = setTimeout(() => t.classList.add('hidden'), undo ? 5000 : 2500);
  const u = $('#undoBtn'); if (u) u.onclick = () => { lastUndo && lastUndo(); lastUndo = null; commit(); if (current) renderSheet(); t.classList.add('hidden'); };
}

// ---------- views ----------
function switchView(v) {
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('active', x.id === 'view-' + v));
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x.dataset.view === v));
  if (v !== 'map') $('#sheet').classList.add('hidden');
  if (v === 'map') { setTimeout(() => map.invalidateSize(), 50); if (current) $('#sheet').classList.remove('hidden'); }
  if (v === 'list') renderList();
  if (v === 'follow') renderFollow();
  if (v === 'pipe') renderPipe();
  if (v === 'stats') renderStats();
  if (v === 'settings') renderSettings();
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchView(b.dataset.view); });
function refreshAll() {
  if (map) drawMarkers();
  if ($('#view-list').classList.contains('active')) renderList();
  if ($('#view-stats').classList.contains('active')) renderStats();
  renderFollow();
}
$('#locateBtn').onclick = () => {
  if (!me) { toast('Waiting for GPS…'); followMe = true; $('#locateBtn').classList.add('on'); return; }
  followMe = !followMe; $('#locateBtn').classList.toggle('on', followMe);
  if (followMe) map.setView([me.lat, me.lon], Math.max(map.getZoom(), 17));
};
$('#layerBtn').onclick = () => {
  if (map.hasLayer(baseSat)) { map.removeLayer(baseSat); baseStreet.addTo(map); $('#layerBtn').textContent = 'Sat'; }
  else { map.removeLayer(baseStreet); baseSat.addTo(map); $('#layerBtn').textContent = 'Map'; }
};
$('#addBtn').onclick = () => chooseAdd();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { saveLocal(); if (dirty) sync(); }
  else if (syncReady()) sync();
});
window.addEventListener('online', () => { if (dirty) sync(); });

// ---------- boot ----------
(async function boot() {
  try {
    state = (await kv.get('state')) || blankState();
    settings = (await kv.get('settings')) || {};
    BIZ = (await kv.get('biz')) || [];
    bizFetchedAt = (await kv.get('bizAt')) || 0;
    bizZips = (await kv.get('bizZips')) || {};
    landlordCache = (await kv.get('landlords')) || null;
  } catch (e) { console.warn('storage unavailable', e); }
  applyMoves(); reindex();
  initMap(); renderLegend(); drawMarkers(); renderFollow();
  setBadge(syncReady() ? 'ok' : 'off');
  startGPS();
  if (syncReady()) sync();
  setTimeout(() => { if (cleanJunkPermits()) drawMarkers(); }, syncReady() ? 6000 : 500);
  if (!settings.geoRetry9) { settings.geoRetry9 = true; for (const p of Object.values(state.permits || {})) if (p.geoFail) { p.geoFail = false; p.updatedAt = Date.now(); } }
  setTimeout(() => { if (Object.values(state.customers || {}).some(c => !c.bizId && !c.geoFail)) placeCustomers(); }, 7000);
  setTimeout(() => { if (Object.values(state.permits || {}).some(p => p.status === 'new' && p.lat == null && !p.geoFail)) geocodePermits(); }, 5000);
  if (!BIZ.length) switchView('settings');
  if (!settings.seenHelp) { settings.seenHelp = true; saveLocalSoon(); setTimeout(showHelp, 600); }
  else if (!BIZ.length) toast('Start here: tap "Load businesses"');
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register(KM_BASE + 'sw.js').catch(() => {});
  window.__km = { get state() { return state; }, get BIZ() { return BIZ; }, logOutcome, openBiz, sync, mergeInto, zipOf, loadBusinesses, drawMarkers, get map() { return map; } };
})();
window.__kmLoaded = true;
