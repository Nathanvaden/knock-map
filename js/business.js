/* Knock Map: The business sheet: visit, appointment, notes & photos, details, future proposals, cards */
'use strict';

// ---------- business sheet ----------
function openBiz(id, opts = {}) {
  const b = bizIndex.get(id); if (!b) return;
  currentPermit = null; currentLease = null;
  if (current !== id) sheetTab = (rec(id) || {}).activeAppt ? 'appt' : 'visit';
  const prev = current; current = id;
  if (prev && markers.get(prev)) drawMarkers(); else drawMarkers();
  renderSheet(opts);
  $('#sheet').classList.remove('hidden');
  if (opts.fly) { switchView('map'); map.setView([b.lat, b.lon], Math.max(map.getZoom(), 17)); }
}
function closeSheet() { current = null; currentPermit = null; currentLease = null; $('#sheet').classList.add('hidden'); drawMarkers(); }
let sheetTab = 'visit';
function outBtn(k) { const s = S[k], st = statusOf(current); return `<button data-out="${k}" style="--c:${s.color}" class="${k === st ? 'cur' : ''}" title="${s.hint}">${s.label}</button>`; }
function renderSheet(opts = {}) {
  const id = current, b = bizIndex.get(id); if (!b) return closeSheet();
  if (opts.tab) sheetTab = opts.tab;
  if (opts.openDetails) sheetTab = 'details';
  const r = rec(id) || {}; const st = statusOf(id); const g = r.g || {};
  const phone = r.phone || g.phone || b.phone; const web = g.web || r.webCard || b.web;
  const addr = g.addr || r.addrCard || [b.addr, b.city].filter(Boolean).join(', ');
  const d = me ? fmtMi(dist(me.lat, me.lon, b.lat, b.lon)) : '';
  const lastV = (r.visits || [])[r.visits ? r.visits.length - 1 : 0];
  const navUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + b.lat + ',' + b.lon;
  const photos = (r.photos || []).filter(p => !p.appt);
  // ---- header (always visible) ----
  let h = `<div class="sh-title"><h3>${esc(b.name)} <button class="editname" data-act="rename" aria-label="Edit name">✎ Edit</button></h3><button class="closex" data-act="close" aria-label="Close">${ICON('x')}</button></div>
  <div class="meta"><span class="pill" style="--c:${S[st].color}">${S[st].label}</span>
   &nbsp;${esc(b.cat)}${b.type ? ' · ' + esc(b.type) : ''}${d ? ' · ' + d : ''}<br>${esc(addr || 'No address on file')} · ${esc(b.zip || '')}
   ${lastV ? '<br>Last visit: ' + fmtWhen(lastV.t) + ' (' + S[lastV.s].label + ')' : ''}
   ${inCooldown(id) ? '<br><b>Cooling off</b> until ' + new Date(inCooldown(id)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '. Skipped in day plans till then.' : ''}</div>
  ${custBoxHtml(id)}
  <div class="actions">
    <a href="${navUrl}" target="_blank" rel="noopener">${ICON('nav')}Directions</a>
    ${phone ? `<a href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">${ICON('phone')}Call</a>` : ''}
    ${web ? `<a href="${esc(/^https?:/.test(web) ? web : 'https://' + web)}" target="_blank" rel="noopener">${ICON('globe')}Website</a>` : ''}
    <a href="https://www.google.com/search?q=${encodeURIComponent(b.name + ' ' + (b.city || ''))}" target="_blank" rel="noopener">${ICON('search')}Google</a>
  </div>
  <div class="stabs" role="tablist">
    <button data-stab="visit" class="${sheetTab === 'visit' ? 'on' : ''}">Visit</button>
    <button data-stab="appt" class="${sheetTab === 'appt' ? 'on' : ''}">Appt${r.activeAppt ? ' <span class="cnt live">●</span>' : (r.appts || []).length ? ` <span class="cnt">${r.appts.length}</span>` : ''}</button>
    <button data-stab="notes" class=""${sheetTab === 'notes' ? 'on' : ''}">Notes &amp; photos${photos.length ? ` <span class="cnt">${photos.length}</span>` : (r.notes || (r.noteLog || []).length) ? ' <span class="cnt">•</span>' : ''}</button>
    <button data-stab="details" class="${sheetTab === 'details' ? 'on' : ''}">Details</button>
  </div>`;
  // ---- Visit tab ----
  if (sheetTab === 'visit') {
    const vs = (r.visits || []).slice().reverse();
    h += `<div class="sec-label"><span>Log this visit</span>${lastV && ymd(new Date(lastV.t)) === todayStr() ? `<button class="btn primary" data-act="next" style="padding:7px 12px;text-transform:none;letter-spacing:0">Next closest ${ICON('arrow')}</button>` : ''}</div>
  <div class="outcomes">${DOOR.map(outBtn).join('')}</div>
  <div class="sec-label"><span>Deal stage</span></div>
  <div class="outcomes stage">${STAGE.map(outBtn).join('')}</div>
  <div class="fu-box"><div class="lbl">Follow-up${r.followUp ? ': <b>' + fmtDate(r.followUp) + '</b>' : ''}</div>
   <div class="chips">
    ${[['Tomorrow', 1], ['3 days', 3], ['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['3 months', 90]].map(([l, n]) => `<button class="chip" data-fu="${n}">${l}</button>`).join('')}
    <input type="date" id="fuPick" class="chip" value="${esc(r.followUp || '')}" style="padding:5px 8px">
    ${r.followUp ? '<button class="chip" data-fu="clear">Clear</button>' : ''}
   </div></div>
  ${['appt', 'quote', 'sent', 'sold'].includes(st) || r.dealInstall || r.dealMonthly ? `<div class="fu-box deal"><div class="lbl">Deal ${st === 'sold' ? '(sold)' : '(in pipeline)'}</div>
   <div class="two"><div class="field" style="margin:4px 0"><label>Install $</label><input data-f="dealInstall" type="number" inputmode="decimal" value="${esc(r.dealInstall || '')}" placeholder="0"></div>
   <div class="field" style="margin:4px 0"><label>Monthly $</label><input data-f="dealMonthly" type="number" inputmode="decimal" value="${esc(r.dealMonthly || '')}" placeholder="0"></div></div></div>` : ''}
  ${['appt', 'quote', 'sent', 'sold'].includes(st) || (r.futures || []).length ? futuresHtml(r) : ''}
  <label class="btn block scanbtn">${ICON('card')}Scan a business card<input type="file" accept="image/*" data-scan hidden></label>
  <div class="hist"><h2 class="sec" style="margin-left:0">Visit history (${vs.length})</h2>
   ${vs.length ? vs.map(v => `<div class="hrow"><div class="when">${fmtWhen(v.t)}</div><div class="what"><span class="pill" style="--c:${S[v.s].color}">${S[v.s].label}</span>${v.note ? '<div>' + esc(v.note) + '</div>' : ''}</div><button class="del" data-delv="${v.t}" aria-label="Delete">✕</button></div>`).join('') : '<div class="small">No visits yet.</div>'}
  </div>`;
  }
  if (sheetTab === 'appt') h += apptTabHtml(id, r);
  // ---- Notes & photos tab ----
  if (sheetTab === 'notes') {
    const log = (r.noteLog || []).slice().reverse();
    h += `<div class="field" style="margin-top:14px"><label>General notes</label>
     <textarea data-f="notes" class="notes-big" placeholder="Anything worth remembering: pain points, who to ask for, best time to come back, what you saw on the walkthrough…">${esc(r.notes || '')}</textarea>
     <div class="small">Saves as you type. In an appointment? Use the <b>Appt</b> tab so those notes stay with the appointment.</div></div>
   ${log.length ? `<div class="field"><label>Earlier time-stamped notes</label><div class="qnlist">${log.map(n => `<div class="hrow"><div class="when">${fmtWhen(n.t)}</div><div class="what" style="white-space:pre-wrap">${esc(n.text)}</div><button class="del" data-qndel="${n.t}" aria-label="Delete">✕</button></div>`).join('')}</div></div>` : ''}
   <div class="sec-label"><span>Walkthrough photos (${photos.length})</span></div>
   <label class="btn block primary">${ICON('camera')}Add photos<input type="file" accept="image/*" multiple data-photos hidden></label>
   <div id="photoMsg" class="small"></div>
   ${photos.length ? `<div class="pgrid">${photos.slice().reverse().map(p => `<button class="pthumb" data-pv="${p.t}" aria-label="Open photo"><img src="${p.thumb}" alt="">${p.caption ? `<span>${esc(p.caption)}</span>` : ''}</button>`).join('')}</div>`
     : '<p class="small">Snap the panel, entry points, camera spots, the old system — anything you\'ll want when you build the quote.</p>'}`;
  }
  // ---- Details tab ----
  if (sheetTab === 'details') {
    h += `<div style="margin-top:12px">
   <div class="two"><div class="field"><label>Decision maker</label><input data-f="dm" value="${esc(r.dm || '')}" placeholder="Name"></div>
   <div class="field"><label>Their title</label><input data-f="dmTitle" value="${esc(r.dmTitle || '')}" placeholder="Owner, GM…"></div></div>
   <div class="two"><div class="field"><label>Direct phone</label><input data-f="phone" type="tel" value="${esc(r.phone || '')}" placeholder="${esc(b.phone || g.phone || '')}"></div>
   <div class="field"><label>Email</label><input data-f="email" type="email" value="${esc(r.email || '')}"></div></div>
   <div class="two"><div class="field"><label>Current provider</label><input data-f="provider" list="provList" value="${esc(r.provider || '')}" placeholder="ADT, none…"></div>
   <div class="field"><label>Contract ends</label><input data-f="contractEnd" type="month" value="${esc(r.contractEnd || '')}"></div></div>
   <div class="field"><label>What they have now</label><input data-f="currentSystem" value="${esc(r.currentSystem || '')}" placeholder="Alarm, cameras, access control, fire…"></div>
   ${(state.fields || []).map(f => customFieldHtml(f, r)).join('')}
   ${(r.cards || []).length ? `<div class="field"><label>Business cards (${r.cards.length})</label>${r.cards.map(c => `<div class="cardrow"><div><b>${esc(c.name || 'No name')}</b>${c.title ? ' · ' + esc(c.title) : ''}<br><span class="small">${[c.cell && 'Cell ' + c.cell, c.phone && 'Office ' + c.phone, c.email, c.web].filter(Boolean).map(esc).join(' · ')}</span></div>${c.photo ? `<button class="chip" data-photo="${esc(c.photo)}">Photo</button>` : ''}</div>`).join('')}</div>` : ''}
   <datalist id="provList">${PROVIDERS.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>`;
    h += r.parcel ? ownerBoxHtml(r) : `<button class="btn block" data-act="owner">Who owns this property?</button>`;
    if (r.g) {
      h += `<div class="gbox"><b>Google info</b> <span class="small">(${fmtDate(ymd(new Date(r.g.at)))})</span>
      ${r.g.name ? `<div>${esc(r.g.name)}</div>` : ''}${r.g.addr ? `<div>${esc(r.g.addr)}</div>` : ''}${r.g.phone ? `<div>📞 ${esc(r.g.phone)}</div>` : ''}
      ${r.g.status && r.g.status !== 'OPERATIONAL' ? `<div class="err">${esc(r.g.status.replace(/_/g, ' ').toLowerCase())}</div>` : ''}
      ${r.g.hours ? `<div class="small">${r.g.hours.map(esc).join('<br>')}</div>` : ''}</div>`;
    } else if (b.hours) h += `<div class="gbox"><b>Hours (OSM):</b> ${esc(b.hours)}</div>`;
    if (settings.gkey) h += `<button class="btn block" data-act="google">${r.g ? 'Refresh Google info' : 'Get phone, hours & address from Google'}</button>`;
    h += `<div class="two" style="margin-top:12px">
   <button class="btn" data-act="move">Move pin</button>
   <button class="btn danger" data-act="hide">${b.id.startsWith('c') ? 'Delete' : 'Not a business'}</button></div>
  ${b.id.startsWith('c') ? '' : `<div class="small" style="margin-top:8px">Source: OpenStreetMap ${esc(b.id)}</div>`}`;
  }
  $('#sheetBody').innerHTML = h;
}
// ---------- appointments (notes kept separate from general notes) ----------
function flushAp(id) {
  for (const k in apTimers) clearTimeout(apTimers[k]); const r = touch(id), a = (r.appts || []).find(x => x.id === r.activeAppt); if (!a) return;
  document.querySelectorAll('#sheet [data-ap]').forEach(el => { a[el.dataset.ap] = el.value.trim(); }); a.updatedAt = Date.now();
}
function startAppt(id) {
  const r = touch(id); r.appts = r.appts || [];
  const a = { id: 'a' + Date.now().toString(36), t: Date.now(), who: r.dm || '', venues: [], notes: '', log: [], updatedAt: Date.now() };
  r.appts.push(a); r.activeAppt = a.id; commit(); renderSheet({ tab: 'appt' }); toast('Appointment started. Everything here stays with this appointment.');
}
function apptTime(a) { const tm = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); return fmtDate(ymd(new Date(a.t))) + ', ' + tm(a.t) + (a.end ? '–' + tm(a.end) : ''); }
function apptTabHtml(id, r) {
  const appts = r.appts || [], act = appts.find(a => a.id === r.activeAppt);
  const pics = aid => (r.photos || []).filter(p => p.appt === aid);
  const grid = ps => ps.length ? `<div class="pgrid">${ps.slice().reverse().map(p => `<button class="pthumb" data-pv="${p.t}" aria-label="Open photo"><img src="${p.thumb}" alt="">${p.caption ? `<span>${esc(p.caption)}</span>` : ''}</button>`).join('')}</div>` : '';
  let h = '';
  if (act) {
    const log = (act.log || []).slice().reverse();
    h += `<div class="appt-live"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div><b>Appointment in progress</b><div class="small">Started ${apptTime(act)}</div></div><button class="btn primary" data-act="apEnd" style="padding:9px 14px">End &amp; save</button></div></div>
    <div class="field"><label>Who's there</label><input data-ap="who" value="${esc(act.who || '')}" placeholder="Names and titles"></div>
    <div class="field"><label>Interested in</label><div class="chips">${VENUES.map(v => `<button class="chip ${(act.venues || []).includes(v) ? 'on' : ''}" data-apven="${v}">${v}</button>`).join('')}</div></div>
    <div class="field"><label>Running notes (time-stamped)</label>
     <div style="display:flex;gap:8px;align-items:flex-end"><textarea id="apText" rows="2" style="flex:1;min-height:48px" placeholder="Type or tap the mic on your keyboard…"></textarea><button class="btn primary" data-act="apLog" style="padding:12px 16px">Add</button></div>
     ${log.length ? `<div class="qnlist">${log.map(n => `<div class="hrow"><div class="when">${new Date(n.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div><div class="what" style="white-space:pre-wrap">${esc(n.text)}</div><button class="del" data-aplogdel="${act.id}|${n.t}" aria-label="Delete">✕</button></div>`).join('')}</div>` : ''}</div>
    <div class="field"><label>Appointment notes</label><textarea data-ap="notes" class="notes-big" placeholder="Needs, pain points, layout, current system, budget, next steps…">${esc(act.notes || '')}</textarea><div class="small">Saves as you type.</div></div>
    <div class="field"><label>Next steps</label><input data-ap="next" value="${esc(act.next || '')}" placeholder="Send quote by Friday, site survey with tech…"></div>
    <div class="sec-label"><span>Appointment photos (${pics(act.id).length})</span></div>
    <label class="btn block">${ICON('camera')}Add photos<input type="file" accept="image/*" multiple data-aphotos hidden></label>
    <div id="apPhotoMsg" class="small"></div>${grid(pics(act.id))}`;
  } else {
    h += `<button class="btn block primary" data-act="apStart" style="margin-top:14px">Start appointment</button>
    <p class="small">Keeps everything from the appointment (who was there, what they want, running notes, photos) separate from your general notes. Tap <b>End &amp; save</b> when you leave.</p>`;
  }
  const past = appts.filter(a => a.id !== r.activeAppt).slice().reverse();
  if (past.length) h += `<h2 class="sec" style="margin-left:0">Past appointments (${past.length})</h2>` + past.map(a => `<div class="appt-card">
    <div style="display:flex;justify-content:space-between;gap:8px"><b>${apptTime(a)}</b><span><button class="chip" data-apopen="${a.id}">Edit</button> <button class="chip" data-apdel="${a.id}">Delete</button></span></div>
    ${a.who ? `<div class="small">With: ${esc(a.who)}</div>` : ''}${(a.venues || []).length ? `<div class="small">Interested in: ${a.venues.map(esc).join(', ')}</div>` : ''}
    ${(a.log || []).length ? `<div class="aplog">${a.log.map(n => `<div><span class="small">${new Date(n.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span> ${esc(n.text)}</div>`).join('')}</div>` : ''}
    ${a.notes ? `<div style="white-space:pre-wrap;margin-top:6px">${esc(a.notes)}</div>` : ''}${a.next ? `<div class="small" style="margin-top:6px"><b>Next:</b> ${esc(a.next)}</div>` : ''}
    ${grid(pics(a.id))}</div>`).join('');
  return h;
}
function apptText(a, r) {
  const L = ['Appointment ' + apptTime(a).split(', ').slice(1).join(', ') + (a.who ? ' with ' + a.who : '')];
  if ((a.venues || []).length) L.push('  Interested in: ' + a.venues.join(', '));
  for (const n of (a.log || [])) L.push('  ' + new Date(n.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' - ' + n.text);
  if (a.notes) L.push('  Notes: ' + a.notes);
  if (a.next) L.push('  Next steps: ' + a.next);
  const ps = (r.photos || []).filter(p => p.appt === a.id); if (ps.length) L.push('  Photos: ' + ps.length + (ps.some(p => p.caption) ? ' (' + ps.filter(p => p.caption).map(p => p.caption).join('; ') + ')' : ''));
  return L.join('\n');
}

// ---------- fix a business name ----------
function renameModal(id) {
  const b = bizIndex.get(id); if (!b) return;
  const orig = b.origName || b.name;
  showModal(`<h3>Edit business name</h3>
    <div class="field"><label>Name</label><input id="rnName" value="${esc(b.name)}" autocomplete="off"></div>
    ${b.origName ? `<div class="small">Map listed it as: ${esc(b.origName)}</div>` : ''}
    <button class="btn block primary" id="rnSave">Save name</button>
    ${b.origName ? '<button class="btn block" id="rnReset">Go back to the original name</button>' : ''}
    <button class="btn block ghost" id="rnCancel">Cancel</button>`);
  const inp = $('#rnName'); inp.focus(); inp.select();
  const apply = name => {
    const r = touch(id);
    if (!name || name === orig) delete r.rename; else r.rename = name;
    hideModal(); reindex(); drawMarkers(); commit(); renderSheet(); toast('Name updated');
  };
  $('#rnSave').onclick = () => apply(inp.value.trim());
  inp.onkeydown = e => { if (e.key === 'Enter') apply(inp.value.trim()); };
  if ($('#rnReset')) $('#rnReset').onclick = () => apply('');
  $('#rnCancel').onclick = hideModal;
}

// ---------- future proposals (other venues to pitch later) ----------
const VENUES = ['Burglar alarm', 'Fire alarm', 'Cameras', 'Access control', 'Video monitoring', 'Other'];
function futuresHtml(r) {
  const fs = (r.futures || []).filter(f => f.status === 'open');
  const done = (r.futures || []).filter(f => f.status !== 'open');
  const today = todayStr();
  return `<div class="fu-box future"><div class="lbl" style="display:flex;justify-content:space-between;align-items:center"><span>Future proposals${fs.length ? ' (' + fs.length + ')' : ''}</span><button class="chip" data-act="futAdd">+ Add</button></div>
    ${fs.length ? fs.map(f => `<button class="futrow" data-fut="${f.id}"><span style="flex:1;text-align:left"><b>${esc(f.venue)}</b>${f.notes ? '<br><span class="small">' + esc(f.notes) + '</span>' : ''}</span>
      <span class="small" style="text-align:right">${f.revisit ? `<span style="${f.revisit <= today ? 'color:var(--danger);font-weight:600' : ''}">${fmtDate(f.revisit)}</span>` : ''}${f.monthly || f.install ? '<br>' + [f.install && money(f.install), f.monthly && money(f.monthly) + '/mo'].filter(Boolean).join(' · ') : ''}</span></button>`).join('')
      : '<div class="small">Only went with one thing today? Add the other venues here (fire, cameras, access…) with when to bring them back up.</div>'}
    ${done.length ? `<div class="small" style="margin-top:6px">${done.map(f => esc(f.venue) + ': ' + (f.status === 'won' ? 'won' : 'passed')).join(' · ')}</div>` : ''}</div>`;
}
function futureModal(id, fid) {
  const r = touch(id); r.futures = r.futures || [];
  const f = r.futures.find(x => x.id === fid) || { id: 'f' + Date.now().toString(36), venue: '', notes: '', install: '', monthly: '', revisit: addDays(90), status: 'open' };
  const isNew = !r.futures.includes(f);
  const c = customerOf(id); const suggest = c ? custGaps(c).map(k => ({ 'Burglar alarm': 'Burglar alarm', Fire: 'Fire alarm', Cameras: 'Cameras', 'Access control': 'Access control' }[k.label])) : [];
  showModal(`<h3>${isNew ? 'Add a future proposal' : 'Future proposal'}</h3>
    <div class="field"><label>Venue</label><div class="chips" id="futVen">${VENUES.map(v => `<button class="chip ${f.venue === v ? 'on' : ''}" data-v="${v}">${v}${suggest.includes(v) ? ' ★' : ''}</button>`).join('')}</div>
      ${suggest.length ? '<div class="small">★ = they don\'t have it with Bay Alarm yet</div>' : ''}</div>
    <div class="field"><label>Notes</label><textarea id="futNotes" placeholder="What they said, what it would cover, who decides…">${esc(f.notes)}</textarea></div>
    <div class="two"><div class="field"><label>Est. install $</label><input id="futInst" type="number" inputmode="decimal" value="${esc(f.install)}"></div><div class="field"><label>Est. monthly $</label><input id="futMon" type="number" inputmode="decimal" value="${esc(f.monthly)}"></div></div>
    <div class="field"><label>Bring it back up on</label><input id="futDate" type="date" value="${esc(f.revisit || '')}"><div class="chips">${[['1 month', 30], ['3 months', 90], ['6 months', 180], ['1 year', 365]].map(([l, n]) => `<button class="chip" data-fd="${n}">${l}</button>`).join('')}</div></div>
    <button class="btn block primary" id="futSave">${isNew ? 'Add proposal' : 'Save'}</button>
    ${isNew ? '' : '<div class="two"><button class="btn" id="futWon" style="color:var(--ok)">Won it</button><button class="btn" id="futLost">They passed</button></div><button class="btn block danger" id="futDel">Delete</button>'}
    <button class="btn block ghost" id="futCancel">Cancel</button>`);
  let venue = f.venue;
  $('#futVen').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; venue = b.dataset.v; $('#futVen').querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); };
  $('#modalBody').querySelectorAll('[data-fd]').forEach(b => b.onclick = () => { $('#futDate').value = addDays(+b.dataset.fd); });
  const finish = status => {
    if (!venue) { toast('Pick a venue'); return; }
    Object.assign(f, { venue, notes: $('#futNotes').value.trim(), install: $('#futInst').value, monthly: $('#futMon').value, revisit: $('#futDate').value, status: status || f.status, updatedAt: Date.now() });
    if (isNew) { f.t = Date.now(); r.futures.push(f); }
    r.updatedAt = state.updatedAt = Date.now(); hideModal(); commit(); renderSheet({ tab: 'visit' }); toast(isNew ? 'Future proposal added' : 'Saved');
  };
  $('#futSave').onclick = () => finish();
  $('#futCancel').onclick = hideModal;
  if (!isNew) {
    $('#futWon').onclick = () => finish('won');
    $('#futLost').onclick = () => finish('lost');
    $('#futDel').onclick = () => { r.futures = r.futures.filter(x => x !== f); r.updatedAt = state.updatedAt = Date.now(); hideModal(); commit(); renderSheet({ tab: 'visit' }); };
  }
}
function allFutures() {
  const out = [];
  for (const id in state.records) { const b = bizIndex.get(id); if (!b) continue; for (const f of (state.records[id].futures || [])) if (f.status === 'open') out.push({ b, f }); }
  return out.sort((a, b) => (a.f.revisit || '9999').localeCompare(b.f.revisit || '9999'));
}
function futuresListHtml() {
  const list = allFutures(); if (!list.length) return '';
  const today = todayStr(), soon = addDays(30);
  const mon = list.reduce((a, x) => a + (+x.f.monthly || 0), 0);
  return `<h2 class="sec">Future proposals (${list.length}${mon ? ' · ' + money(mon) + '/mo potential' : ''})</h2>` + list.map(({ b, f }) => `<div class="item" data-id="${b.id}"><span class="pin" style="background:#8b5cf6"></span>
    <div class="main"><div class="nm">${esc(b.name)}: ${esc(f.venue)}</div><div class="sub">${esc(f.notes || [f.install && money(f.install) + ' install', f.monthly && money(f.monthly) + '/mo'].filter(Boolean).join(' · ') || '')}</div></div>
    <div class="right" style="${f.revisit && f.revisit <= today ? 'color:var(--danger);font-weight:600' : f.revisit && f.revisit <= soon ? 'color:var(--ink)' : ''}">${f.revisit ? fmtDate(f.revisit) : 'No date'}</div></div>`).join('');
}

// ---------- walkthrough photos ----------
async function shrinkPhoto(file, max, q) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
async function addPhotos(id, files, apptId) {
  const msg = () => $(apptId ? '#apPhotoMsg' : '#photoMsg');
  let n = 0;
  for (const f of files) {
    n++; if (msg()) msg().textContent = `Saving photo ${n} of ${files.length}…`;
    try {
      const full = await shrinkPhoto(f, 1600, 0.78), thumb = await shrinkPhoto(f, 260, 0.6);
      const t = Date.now() + n, path = 'photos/' + id + '/' + t + '.jpg';
      await kv.set('card:' + path, full); await addPendingPhoto(path);
      const r = touch(id); r.photos = (r.photos || []).concat(Object.assign({ t, path, thumb, caption: '' }, apptId ? { appt: apptId } : {}));
    } catch (err) { toast('Could not read one of the photos'); }
  }
  await commit(); renderSheet({ tab: apptId ? 'appt' : 'notes' }); toast(files.length === 1 ? 'Photo added' : files.length + ' photos added');
}
function showPhoto(id, t) {
  const r = rec(id); const p = (r.photos || []).find(x => String(x.t) === String(t)); if (!p) return;
  showModal(`<h3>${p.appt ? 'Appointment photo' : 'Walkthrough photo'}</h3><p class="small">${fmtWhen(p.t)}</p>
    <img id="phImg" src="${p.thumb}" style="width:100%;border-radius:10px;background:#eee"><p class="small" id="phMsg">Loading full size…</p>
    <div class="field"><label>Caption</label><input id="phCap" value="${esc(p.caption || '')}" placeholder="Panel location, camera spot, back door…"></div>
    <div class="two"><button class="btn danger" id="phDel">Delete photo</button><button class="btn primary" id="phDone">Done</button></div>`);
  (async () => {
    try {
      let src = await kv.get('card:' + p.path);
      if (!src && syncReady()) { const res = await gh(p.path, { headers: { Accept: 'application/vnd.github.raw+json' } }); if (res.ok) src = URL.createObjectURL(await res.blob()); }
      if (src) { $('#phImg').src = src; $('#phMsg').remove(); } else $('#phMsg').textContent = 'Full size is only on the device that took it (it uploads once that device syncs).';
    } catch (e) { const m = $('#phMsg'); if (m) m.textContent = 'Could not load the full-size photo.'; }
  })();
  const back = p.appt ? 'appt' : 'notes';
  $('#phDone').onclick = () => { const cap = $('#phCap').value.trim(); if (cap !== (p.caption || '')) { p.caption = cap; touch(id); commit(); } hideModal(); renderSheet({ tab: back }); };
  $('#phDel').onclick = () => { const rr = touch(id); rr.photos = rr.photos.filter(x => x !== p); commit(); hideModal(); renderSheet({ tab: back }); toast('Photo deleted'); };
}
function customFieldHtml(f, r) {
  const v = (r.custom || {})[f.id];
  const lab = `<label>${esc(f.name)}</label>`;
  if (f.type === 'yesno') return `<div class="field">${lab}<select data-cf="${f.id}"><option value=""></option><option ${v === 'Yes' ? 'selected' : ''}>Yes</option><option ${v === 'No' ? 'selected' : ''}>No</option></select></div>`;
  if (f.type === 'choice') return `<div class="field">${lab}<select data-cf="${f.id}"><option value=""></option>${(f.options || []).map(o => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
  return `<div class="field">${lab}<input data-cf="${f.id}" type="${type}" value="${esc(v || '')}"></div>`;
}

function logOutcome(id, s) {
  const r = touch(id);
  const prev = { status: r.status, statusAt: r.statusAt, followUp: r.followUp };
  const v = { t: Date.now(), s };
  if (me) { const b = bizIndex.get(id); v.d = Math.round(dist(me.lat, me.lon, b.lat, b.lon) * 5280); }
  r.visits = r.visits || []; r.visits.push(v); r.status = s; r.statusAt = v.t;
  let autoFu = false;
  if (s === 'sent') { r.quoteSentAt = v.t; if (!r.followUp || r.followUp < todayStr()) { r.followUp = addDays(3); autoFu = true; } }
  lastUndo = () => { const rr = touch(id); rr.visits = rr.visits.filter(x => x.t !== v.t); rr.status = prev.status; rr.statusAt = prev.statusAt; rr.followUp = prev.followUp; };
  commit(); renderSheet();
  toast('Logged: ' + S[s].label + (autoFu ? '. Follow-up set for ' + fmtDate(r.followUp) : ''), true);
  if (s === 'followup' && !r.followUp) setTimeout(() => { const el = document.querySelector('.fu-box'); el && el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
}

// sheet events
$('#sheet').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t || !current) return;
  const id = current;
  if (t.dataset.out) return logOutcome(id, t.dataset.out);
  if (t.dataset.fu) {
    const r = touch(id); r.followUp = t.dataset.fu === 'clear' ? '' : addDays(+t.dataset.fu);
    commit(); renderSheet(); if (r.followUp) toast('Follow-up set for ' + fmtDate(r.followUp)); return;
  }
  if (t.dataset.delv) {
    const r = touch(id); r.visits = (r.visits || []).filter(v => String(v.t) !== t.dataset.delv);
    const last = r.visits[r.visits.length - 1]; r.status = last ? last.s : 'new';
    commit(); renderSheet(); return;
  }
  const act = t.dataset.act;
  if (act === 'close') closeSheet();
  if (act === 'google') googleLookup(id);
  if (act === 'owner') lookupOwner(id);
  if (act === 'ownerOthers') { const p = rec(id).parcel; showOwnerProperties(p.owner, p.mail); }
  if (act === 'hide') {
    const b = bizIndex.get(id);
    showModal(`<h3>${b.id.startsWith('c') ? 'Delete' : 'Remove'} ${esc(b.name)}?</h3><p class="small">${b.id.startsWith('c') ? 'This deletes the business you added and its history.' : 'Use this for places that closed, aren\'t real businesses, or are duplicates. It hides the pin everywhere.'}</p>
      <button class="btn block danger" id="mOk">Yes, remove it</button><button class="btn block ghost" id="mCancel">Cancel</button>`);
    $('#mOk').onclick = () => {
      if (b.id.startsWith('c')) { delete state.custom[id]; delete state.records[id]; }
      state.hidden[id] = true; state.updatedAt = Date.now(); hideModal(); closeSheet(); reindex(); commit();
    };
    $('#mCancel').onclick = hideModal;
  }
  if (act === 'move') startPlace(id);
  if (t.dataset.stab) { sheetTab = t.dataset.stab; renderSheet(); return; }
  if (act === 'futAdd') { futureModal(id); return; }
  if (act === 'rename') { renameModal(id); return; }
  if (act === 'apStart') { startAppt(id); return; }
  if (act === 'apEnd') { flushAp(id); const r = touch(id), a = (r.appts || []).find(x => x.id === r.activeAppt); if (a) { a.end = Date.now(); a.updatedAt = Date.now(); } delete r.activeAppt; const moved = !['quote', 'sent', 'sold', 'dead'].includes(r.status); if (moved) { r.visits = r.visits || []; r.visits.push({ t: Date.now(), s: 'quote', note: 'Appointment done' }); r.status = 'quote'; r.statusAt = Date.now(); } commit(); renderSheet({ tab: 'appt' }); toast(moved ? 'Appointment saved. Moved to Building quote' : 'Appointment saved'); return; }
  if (act === 'apLog') { flushAp(id); const ta = $('#apText'), v = ta.value.trim(); if (!v) { ta.focus(); return; } const r = touch(id), a = (r.appts || []).find(x => x.id === r.activeAppt); if (!a) return; a.log = (a.log || []).concat({ t: Date.now(), text: v }); commit(); renderSheet({ tab: 'appt' }); setTimeout(() => { const x = $('#apText'); if (x) x.focus(); }, 50); return; }
  if (t.dataset.aplogdel) { const r = touch(id), [aid, tt] = t.dataset.aplogdel.split('|'), a = (r.appts || []).find(x => x.id === aid); if (a) a.log = (a.log || []).filter(n => String(n.t) !== tt); commit(); renderSheet({ tab: 'appt' }); return; }
  if (t.dataset.apven) { flushAp(id); const r = touch(id), a = (r.appts || []).find(x => x.id === r.activeAppt); if (!a) return; const v = t.dataset.apven; a.venues = (a.venues || []).includes(v) ? a.venues.filter(x => x !== v) : (a.venues || []).concat(v); commit(); renderSheet({ tab: 'appt' }); return; }
  if (t.dataset.apopen) { const r = touch(id); if (r.activeAppt) { toast('Finish the current appointment first'); return; } r.activeAppt = t.dataset.apopen; commit(); renderSheet({ tab: 'appt' }); return; }
  if (t.dataset.apdel) { showModal('<h3>Delete this appointment?</h3><p class="small">Its notes are deleted. Photos from it move to Walkthrough photos.</p><div class="two"><button class="btn" id="apdNo">Cancel</button><button class="btn danger" id="apdYes">Delete</button></div>'); const aid = t.dataset.apdel; $('#apdNo').onclick = hideModal; $('#apdYes').onclick = () => { const r = touch(id); r.appts = (r.appts || []).filter(x => x.id !== aid); (r.photos || []).forEach(p => { if (p.appt === aid) delete p.appt; }); if (r.activeAppt === aid) delete r.activeAppt; hideModal(); commit(); renderSheet({ tab: 'appt' }); }; return; }
  if (t.dataset.fut) { futureModal(id, t.dataset.fut); return; }
  if (act === 'qnAdd') { const ta = $('#qnText'), v = ta.value.trim(); if (!v) { ta.focus(); return; } const r = touch(id); r.noteLog = (r.noteLog || []).concat({ t: Date.now(), text: v }); commit(); renderSheet({ tab: 'notes' }); setTimeout(() => { const x = $('#qnText'); if (x) x.focus(); }, 50); return; }
  if (t.dataset.qndel) { const r = touch(id); r.noteLog = (r.noteLog || []).filter(n => String(n.t) !== t.dataset.qndel); commit(); renderSheet({ tab: 'notes' }); return; }
  if (t.dataset.pv) { showPhoto(id, t.dataset.pv); return; }
  if (act === 'next') {
    const b0 = bizIndex.get(id), today = todayStr();
    let best = null, bd = Infinity;
    for (const b of filtered()) {
      if (b.id === id || inCooldown(b.id) || custByBiz.has(b.id)) continue;
      const st = statusOf(b.id), r = rec(b.id);
      if (st !== 'new' && st !== 'closed') continue;
      if (r && r.visits && r.visits.length && ymd(new Date(r.visits[r.visits.length - 1].t)) === today) continue;
      const d = dist(b0.lat, b0.lon, b.lat, b.lon); if (d < bd) { bd = d; best = b; }
    }
    if (!best) { toast('Nothing unvisited nearby'); return; }
    openBiz(best.id); if ($('#view-map').classList.contains('active')) map.setView([best.lat, best.lon], Math.max(map.getZoom(), 17));
    toast(fmtMi(bd) + ' away');
  }
  if (t.dataset.photo) showCardPhoto(t.dataset.photo);
});
let notesTimer; const apTimers = {};
$('#sheet').addEventListener('input', e => {
  const el = e.target; if (!current) return;
  if (el.dataset.ap) { const id = current, k = el.dataset.ap, v = el.value; clearTimeout(apTimers[k]); apTimers[k] = setTimeout(() => { const r = touch(id), a = (r.appts || []).find(x => x.id === r.activeAppt); if (!a) return; a[k] = v.trim(); a.updatedAt = Date.now(); saveLocal(); scheduleSync(); }, 600); return; }
  if (el.dataset.f !== 'notes') return;
  clearTimeout(notesTimer); const id = current, v = el.value;
  notesTimer = setTimeout(() => { const r = touch(id); r.notes = v.trim(); saveLocal(); scheduleSync(); }, 700);
});
$('#sheet').addEventListener('change', e => {
  const el = e.target; if (!current) return;
  if (el.dataset.photos !== undefined && el.files && el.files.length) { const fs = [...el.files]; el.value = ''; addPhotos(current, fs); return; }
  if (el.dataset.aphotos !== undefined && el.files && el.files.length) { flushAp(current); const fs = [...el.files]; el.value = ''; addPhotos(current, fs, (rec(current) || {}).activeAppt); return; }
  if (el.dataset.scan !== undefined && el.files && el.files[0]) { const f = el.files[0]; el.value = ''; scanForBiz(current, f); return; }
  if (el.id === 'fuPick') { const r = touch(current); r.followUp = el.value; commit(); renderSheet(); return; }
  if (el.dataset.f) { const r = touch(current); r[el.dataset.f] = el.value.trim(); commit(); }
  if (el.dataset.cf) { const r = touch(current); r.custom = r.custom || {}; r.custom[el.dataset.cf] = el.value; commit(); }
});
// swipe down to close
(() => { let y0 = null; const sh = $('#sheet');
  sh.addEventListener('touchstart', e => { y0 = sh.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  sh.addEventListener('touchmove', e => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sh.addEventListener('touchend', e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; sh.style.transform = ''; y0 = null; if (dy > 120) closeSheet(); });
})();

// ---------- Google Places (optional, per-tap) ----------
async function googleLookup(id) {
  const b = bizIndex.get(id);
  toast('Checking Google…');
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': settings.gkey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours.weekdayDescriptions,places.businessStatus' },
      body: JSON.stringify({ textQuery: b.name, pageSize: 1, locationBias: { circle: { center: { latitude: b.lat, longitude: b.lon }, radius: 400 } } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
    const p = (j.places || [])[0];
    if (!p) { toast('Google had no match'); return; }
    settings.gcalls = (settings.gcalls || 0) + 1; settings.gmonth = settings.gmonth === todayStr().slice(0, 7) ? settings.gmonth : todayStr().slice(0, 7);
    const rr = touch(id);
    rr.g = { at: Date.now(), name: p.displayName && p.displayName.text, addr: p.formattedAddress, phone: p.nationalPhoneNumber, web: p.websiteUri, hours: p.regularOpeningHours && p.regularOpeningHours.weekdayDescriptions, status: p.businessStatus };
    commit(); renderSheet(); toast('Google info added');
  } catch (err) { toast('Google lookup failed: ' + err.message); }
}

// ---------- add / move business ----------
let placing = null;
function startPlace(id) {
  placing = id || 'new';
  $('#sheet').classList.add('hidden'); switchView('map');
  if (id && id.startsWith('lease:')) { const l = state.leases[id.slice(6)]; map.setView([l.lat, l.lon], 18); }
  else if (id) { const b = bizIndex.get(id); map.setView([b.lat, b.lon], 18); }
  else if (me) map.setView([me.lat, me.lon], 18);
  $('#placeBanner').classList.remove('hidden'); $('#crosshair').classList.remove('hidden');
}
function endPlace() { placing = null; $('#placeBanner').classList.add('hidden'); $('#crosshair').classList.add('hidden'); }
$('#placeCancel').onclick = () => { const id = placing; endPlace(); if (id && id.startsWith('lease:')) openLease(id.slice(6)); else if (id && id !== 'new') openBiz(id); };
$('#placeOk').onclick = () => {
  const c = map.getCenter(); const id = placing; endPlace();
  if (id.startsWith('lease:')) { const l = state.leases[id.slice(6)]; l.lat = +c.lat.toFixed(6); l.lon = +c.lng.toFixed(6); l.updatedAt = state.updatedAt = Date.now(); commit(); openLease(l.id); return; }
  if (id !== 'new') {
    const b = bizIndex.get(id);
    if (id.startsWith('c')) { b.lat = +c.lat.toFixed(6); b.lon = +c.lng.toFixed(6); b.updatedAt = Date.now(); }
    else { const r = touch(id); r.lat = +c.lat.toFixed(6); r.lon = +c.lng.toFixed(6); b.lat = r.lat; b.lon = r.lon; }
    commit(); openBiz(id); return;
  }
  const z = zipOf(c.lat, c.lng);
  let pendingCard = null;
  showModal(`<h3>Add a business</h3>
   <label class="btn block scanbtn">📇 Scan their card to fill this in<input type="file" accept="image/*" id="nbScan" hidden></label>
   <div id="nbScanMsg" class="small"></div>
   <div class="field"><label>Name</label><input id="nbName" placeholder="Business name"></div>
   <div class="field"><label>Type</label><select id="nbCat">${CATS.map(x => `<option>${x}</option>`).join('')}</select></div>
   <div class="field"><label>Address (optional)</label><input id="nbAddr" placeholder="1234 W Bell Rd"></div>
   <div class="field"><label>Phone (optional)</label><input id="nbPhone" type="tel"></div>
   ${z ? '' : '<p class="small err">Heads up: this spot is outside your territory zips.</p>'}
   <button class="btn block primary" id="nbOk">Add it</button><button class="btn block ghost" id="nbCancel">Cancel</button>`);
  setTimeout(() => $('#nbName').focus(), 50);
  $('#nbCancel').onclick = hideModal;
  $('#nbScan').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const res = await CardScan.read(f, m => $('#nbScanMsg').textContent = m);
      const p = CardScan.parse(res.lines, '');
      $('#nbName').value = $('#nbName').value || p.company; $('#nbAddr').value = $('#nbAddr').value || p.addr; $('#nbPhone').value = $('#nbPhone').value || p.phone || p.cell;
      pendingCard = { res, p };
      $('#nbScanMsg').textContent = 'Got it. Check the name, then tap Add it. The contact info goes on the business.';
    } catch (err) { $('#nbScanMsg').textContent = 'Could not read the card: ' + err.message; }
  };
  $('#nbOk').onclick = () => {
    const name = $('#nbName').value.trim(); if (!name) return $('#nbName').focus();
    const nid = 'c' + Date.now().toString(36);
    state.custom[nid] = { id: nid, name, cat: $('#nbCat').value, type: '', lat: +c.lat.toFixed(6), lon: +c.lng.toFixed(6), addr: $('#nbAddr').value.trim(), city: z ? z.city : '', zip: z ? z.zip : '', phone: $('#nbPhone').value.trim(), web: '', hours: '', updatedAt: Date.now() };
    state.updatedAt = Date.now(); hideModal(); reindex(); commit(); openBiz(nid);
    if (pendingCard) reviewCard(nid, pendingCard.res, pendingCard.p);
  };
};
// ---------- business cards ----------
async function scanForBiz(id, file) {
  showModal('<h3>Reading the card…</h3><p class="small" id="scanMsg">Starting…</p>');
  try {
    const res = await CardScan.read(file, m => { const el = $('#scanMsg'); if (el) el.textContent = m; });
    reviewCard(id, res, CardScan.parse(res.lines, bizIndex.get(id).name));
  } catch (err) {
    showModal(`<h3>Couldn't read that card</h3><p class="small">${esc(err.message)}</p><button class="btn block" id="mClose">OK</button>`);
    $('#mClose').onclick = hideModal;
  }
}
function reviewCard(id, res, p) {
  const r = rec(id) || {};
  const f = (k, label, v, type) => `<div class="field"><label>${label}</label><input id="cd_${k}" type="${type || 'text'}" value="${esc(v || '')}"></div>`;
  showModal(`<h3>Check what it read</h3><p class="small">Fix anything that's off, then save.</p>
   <img src="${res.photo}" style="width:100%;border-radius:10px;margin:4px 0 6px" alt="Card photo">
   <div class="two">${f('name', 'Name', p.name)}${f('title', 'Title', p.title)}</div>
   <div class="two">${f('cell', 'Cell', p.cell, 'tel')}${f('phone', 'Office phone', p.phone, 'tel')}</div>
   ${f('email', 'Email', p.email, 'email')}${f('web', 'Website', p.web)}${f('addr', 'Address', p.addr)}
   <label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" id="cd_dm" ${!r.dm || (p.name && r.dm.toLowerCase() === p.name.toLowerCase()) ? 'checked' : ''} style="width:22px;height:22px"> This is the decision maker</label>
   <details><summary>Everything it read</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(res.text)}</pre></details>
   <button class="btn block primary" id="cdSave">Save to ${esc(bizIndex.get(id).name)}</button><button class="btn block ghost" id="cdCancel">Cancel</button>`);
  $('#cdCancel').onclick = hideModal;
  $('#cdSave').onclick = async () => {
    const v = k => $('#cd_' + k).value.trim();
    const t = Date.now();
    const card = { t, name: v('name'), title: v('title'), cell: v('cell'), phone: v('phone'), email: v('email'), web: v('web'), addr: v('addr'), photo: 'cards/' + id + '-' + t + '.jpg' };
    const rr = touch(id);
    rr.cards = (rr.cards || []).concat(card);
    if ($('#cd_dm').checked) {
      if (card.name) rr.dm = card.name; if (card.title) rr.dmTitle = card.title;
      if (card.cell || card.phone) rr.phone = card.cell || card.phone; if (card.email) rr.email = card.email;
    }
    if (card.addr && !bizIndex.get(id).addr) rr.addrCard = card.addr;
    if (card.web && !bizIndex.get(id).web) { const b = bizIndex.get(id); if (b.id.startsWith('c')) b.web = card.web; else rr.webCard = card.web; }
    try { await kv.set('card:' + card.photo, res.photo); } catch (e) {}
    await addPendingPhoto(card.photo);
    hideModal(); commit(); renderSheet({ openDetails: true }); toast('Card saved');
  };
}
async function addPendingPhoto(path) { const list = (await kv.get('pendingPhotos')) || []; if (!list.includes(path)) list.push(path); await kv.set('pendingPhotos', list); }
async function uploadPendingPhotos() {
  if (!syncReady()) return;
  const list = (await kv.get('pendingPhotos')) || []; const left = [];
  for (const path of list) {
    try {
      const data = await kv.get('card:' + path); if (!data) continue;
      const r = await gh(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Card photo', content: data.split(',')[1] }) });
      if (!r.ok && r.status !== 422) left.push(path); // 422 = already there
    } catch (e) { left.push(path); }
  }
  await kv.set('pendingPhotos', left);
}
async function showCardPhoto(path) {
  showModal('<h3>Card photo</h3><p class="small" id="phMsg">Loading…</p><img id="phImg" style="width:100%;border-radius:10px"><button class="btn block" id="phClose">Close</button>');
  $('#phClose').onclick = hideModal;
  try {
    let src = await kv.get('card:' + path);
    if (!src && syncReady()) {
      const r = await gh(path, { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!r.ok) throw new Error('not found (' + r.status + ')');
      src = URL.createObjectURL(await r.blob());
    }
    if (!src) throw new Error('photo is only on the phone that scanned it');
    $('#phImg').src = src; $('#phMsg').remove();
  } catch (err) { const m = $('#phMsg'); if (m) m.textContent = 'Could not load photo: ' + err.message; }
}
function applyMoves() { for (const b of BIZ) { const r = state.records[b.id]; if (r && r.lat) { b.lat = r.lat; b.lon = r.lon; } } }
