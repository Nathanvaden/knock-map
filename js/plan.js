/* Knock Map: Nearby list, Plan tab (follow-ups, plan my day) and Pipeline tab */
'use strict';

// ---------- list view ----------
let listLimit = 100;
function renderList() {
  const sort = $('#sortSel').value;
  let list = filtered().filter(b => filters.q || filters.statuses.has('booted') || !inCooldown(b.id)).map(b => ({ b, d: me ? dist(me.lat, me.lon, b.lat, b.lon) : null, r: rec(b.id) }));
  if (sort === 'dist' && me) list.sort((x, y) => x.d - y.d);
  else if (sort === 'recent') list = list.filter(x => x.r && x.r.visits && x.r.visits.length).sort((x, y) => y.r.visits[y.r.visits.length - 1].t - x.r.visits[x.r.visits.length - 1].t);
  else list.sort((x, y) => x.b.name.localeCompare(y.b.name));
  $('#listCount').textContent = list.length + ' businesses' + (sort === 'dist' && !me ? ' · waiting for GPS' : '');
  const shown = list.slice(0, listLimit);
  $('#list').innerHTML = shown.length ? shown.map(({ b, d, r }) => {
    const st = statusOf(b.id); const lv = r && r.visits && r.visits[r.visits.length - 1];
    return `<div class="item" data-id="${b.id}"><span class="pin" style="background:${S[st].color}"></span>
     <div class="main"><div class="nm">${esc(b.name)}</div><div class="sub">${esc(b.cat)}${b.addr ? ' · ' + esc(b.addr) : ''}${lv ? ' · ' + fmtWhen(lv.t) : ''}</div></div>
     <div class="right">${d != null ? fmtMi(d) : ''}<br>${custByBiz.has(b.id) ? '<b style="color:var(--accent)">Customer</b>' : S[st].label}</div></div>`;
  }).join('') + (list.length > listLimit ? `<button class="showmore" id="moreBtn">Show more (${list.length - listLimit} left)</button>` : '')
    : `<div class="empty">${allBiz().length ? '<b>No matches</b>Try a different search, or clear your filters.' : '<b>No businesses yet</b>Open Settings and tap "Load businesses".'}</div>`;
}
$('#list').addEventListener('click', e => {
  if (e.target.id === 'moreBtn') { listLimit += 100; renderList(); return; }
  const it = e.target.closest('.item'); if (it) openBiz(it.dataset.id);
});
$('#sortSel').onchange = () => { listLimit = 100; renderList(); };

// ---------- follow-ups ----------
function renderFollow() {
  const today = todayStr(), wk = addDays(7);
  const rows = [];
  for (const id in state.records) {
    const r = state.records[id], b = bizIndex.get(id);
    if (!b || !r.followUp) continue;
    if (r.status === 'sold' || r.status === 'dead') continue;
    rows.push({ b, r });
  }
  rows.sort((x, y) => x.r.followUp.localeCompare(y.r.followUp));
  const groups = [
    ['Overdue', rows.filter(x => x.r.followUp < today), true],
    ['Today', rows.filter(x => x.r.followUp === today)],
    ['Next 7 days', rows.filter(x => x.r.followUp > today && x.r.followUp <= wk)],
    ['Later', rows.filter(x => x.r.followUp > wk)],
  ];
  // contracts ending soon
  const soon = []; const now = new Date(); const lim = new Date(); lim.setMonth(lim.getMonth() + 6);
  for (const id in state.records) {
    const r = state.records[id], b = bizIndex.get(id);
    if (!b || !r.contractEnd || r.status === 'sold' || r.status === 'dead') continue;
    const [y, m] = r.contractEnd.split('-').map(Number); const end = new Date(y, m, 0);
    if (end >= new Date(now.getFullYear(), now.getMonth(), 1) && end <= lim) soon.push({ b, r, end });
  }
  soon.sort((a, b) => a.end - b.end);
  const item = ({ b, r }, right) => `<div class="item" data-id="${b.id}"><span class="pin" style="background:${S[statusOf(b.id)].color}"></span>
    <div class="main"><div class="nm">${esc(b.name)}</div><div class="sub">${esc(r.dm ? r.dm + ' · ' : '')}${esc(r.notes || b.cat)}</div></div>
    <div class="right">${right}</div></div>`;
  let h = '';
  for (const [name, list, warn] of groups) if (list.length) h += `<h2 class="sec ${warn ? 'warn' : ''}">${name} (${list.length})</h2>` + list.map(x => item(x, fmtDate(x.r.followUp))).join('');
  if (soon.length) h += `<h2 class="sec">Contracts ending in the next 6 months (${soon.length})</h2>` + soon.map(x => item(x, esc(x.r.provider || '') + '<br>' + x.end.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }))).join('');
  h += permitsListHtml();
  $('#follow').innerHTML = '<div class="page-title">Plan</div><div class="page-sub">Where to go: today\'s route, follow-ups that are due, expiring contracts, new permits, construction, for lease signs and landlords.</div>' + planHtml() + (h || '<div class="empty"><b>No follow-ups yet</b>When you log a visit, pick a follow-up date and it shows up here.</div>') + leasesHtml() + landlordsHtml();
  const due = groups[0][1].length + groups[1][1].length;
  $('#fuCount').textContent = due; $('#fuCount').classList.toggle('hidden', !due);
  renderPipe(); searchPage($('#follow'));
}
$('#follow').addEventListener('click', e => {
  const t = e.target;
  if (t.id === 'planBtn' || t.id === 'planNew') return openPlanModal();
  if (t.id === 'planClear') { state.plan = null; state.planClearedAt = Date.now(); filters.planOnly = false; state.updatedAt = Date.now(); $('#filterDot').classList.toggle('hidden', !filterActive()); commit(); renderFollow(); toast('Plan cleared'); return; }
  if (t.id === 'planMap') {
    filters.planOnly = !filters.planOnly; $('#filterDot').classList.toggle('hidden', !filterActive());
    if (filters.planOnly) { switchView('map'); const pts = state.plan.ids.map(id => bizIndex.get(id)).filter(Boolean).map(b => [b.lat, b.lon]); if (pts.length) map.fitBounds(pts, { padding: [40, 40] }); }
    refreshAll(); renderFollow(); return;
  }
  if (t.id === 'llLoad') return loadLandlords();
  if (t.id === 'pmNoise') { settings.showNoisePermits = !settings.showNoisePermits; saveLocal(); renderFollow(); drawMarkers(); return; }
  const lg = t.closest('[data-ll-group]'); if (lg) return showLandlordGroup(+lg.dataset.llGroup);
  const pm = t.closest('[data-permit]'); if (pm) return openPermit(pm.dataset.permit, true);
  if (t.dataset.unlease) { const l = state.leases[t.dataset.unlease]; l.status = 'active'; l.updatedAt = state.updatedAt = Date.now(); commit(); toast('Pin is back on the map'); return; }
  const ls = t.closest('[data-lease]'); if (ls) { const l = state.leases[ls.dataset.lease]; switchView('map'); map.setView([l.lat, l.lon], 17); return openLease(l.id); }
  const it = t.closest('.item'); if (it && it.dataset.id) openBiz(it.dataset.id, { fly: false });
});

// ---------- plan my day ----------
function planDone(id) { const r = rec(id); const v = r && r.visits && r.visits[r.visits.length - 1]; return !!(v && ymd(new Date(v.t)) === state.plan.date); }
function buildPlan(start, n, useFilters) {
  const today = todayStr();
  const isDue = b => { const r = rec(b.id); return !!(r && r.followUp && r.followUp <= today); };
  const pool = (useFilters ? filtered() : allBiz()).filter(b => {
    const st = statusOf(b.id), r = rec(b.id);
    if (st === 'sold' || st === 'dead' || inCooldown(b.id)) return false;
    if (isDue(b)) return true;
    if (custByBiz.has(b.id)) return false;
    if (r && r.visits && r.visits.length && ymd(new Date(r.visits[r.visits.length - 1].t)) === today) return false;
    return st === 'new' || st === 'closed';
  }).map(b => ({ b, d: dist(start.lat, start.lon, b.lat, b.lon), due: isDue(b) }));
  const pick = pool.filter(x => x.due && x.d < 6).sort((a, b) => a.d - b.d).slice(0, n);
  for (const x of pool.filter(x => !x.due).sort((a, b) => a.d - b.d)) { if (pick.length >= n) break; pick.push(x); }
  const order = []; let cur = start; const left = pick.slice();
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((x, i) => { const d = dist(cur.lat, cur.lon, x.b.lat, x.b.lon); if (d < bd) { bd = d; bi = i; } });
    const x = left.splice(bi, 1)[0]; order.push(x.b.id); cur = x.b;
  }
  return order;
}
function openPlanModal() {
  const zips = TERRITORY.features.map(f => f.properties).sort((a, b) => a.zip.localeCompare(b.zip));
  showModal(`<h3>Plan my day</h3>
   <p class="small">Builds a route: follow-ups that are due first, then the closest places you haven't hit. Skips sold, not-a-fit, and anyone who booted you in the last ${cooldownDays()} days.</p>
   <div class="field"><label>Start from</label><select id="plStart">${me ? '<option value="me">Where I am now</option>' : ''}${zips.map(z => `<option value="${z.zip}">${z.zip} ${esc(z.city)}</option>`).join('')}</select></div>
   <div class="field"><label>How many stops</label><div class="chips">${[15, 25, 40, 60].map(n => `<button class="chip ${n === 25 ? 'on' : ''}" data-n="${n}">${n}</button>`).join('')}</div></div>
   ${filterActive() ? '<label style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="plFilt" checked style="width:22px;height:22px"> Only businesses that match my current filters</label>' : ''}
   <button class="btn block primary" id="plGo">Build my plan</button><button class="btn block ghost" id="plCancel">Cancel</button>`);
  let n = 25;
  $('#modalBody').querySelectorAll('[data-n]').forEach(c => c.onclick = () => { n = +c.dataset.n; $('#modalBody').querySelectorAll('[data-n]').forEach(x => x.classList.toggle('on', x === c)); });
  $('#plCancel').onclick = hideModal;
  $('#plGo').onclick = () => {
    const v = $('#plStart').value; let start;
    if (v === 'me') start = { lat: me.lat, lon: me.lon };
    else { const f = TERRITORY.features.find(f => f.properties.zip === v); const bb = L.geoJSON(f).getBounds().getCenter(); start = { lat: bb.lat, lon: bb.lng }; }
    const ids = buildPlan(start, n, !!($('#plFilt') && $('#plFilt').checked));
    if (!ids.length) { toast('Nothing left to plan around there. Try another start or clear filters.'); return; }
    state.plan = { date: todayStr(), at: Date.now(), ids, start }; state.updatedAt = Date.now();
    hideModal(); commit(); renderFollow(); toast('Plan ready: ' + ids.length + ' stops');
  };
}
function planHtml() {
  const p = state.plan;
  if (!p || p.date !== todayStr()) return `<div class="card"><h3>Today's plan</h3><p class="small">Get a route of follow-ups and fresh doors, in order.</p><button class="btn block primary" id="planBtn">Plan my day</button></div>`;
  const items = p.ids.map(id => bizIndex.get(id)).filter(Boolean);
  const done = items.filter(b => planDone(b.id)).length;
  const left = items.filter(b => !planDone(b.id));
  const legs = []; for (let i = 0; i < left.length; i += 9) legs.push(left.slice(i, i + 9));
  const legUrl = leg => 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + leg[leg.length - 1].lat + ',' + leg[leg.length - 1].lon +
    (leg.length > 1 ? '&waypoints=' + leg.slice(0, -1).map(b => b.lat + ',' + b.lon).join('%7C') : '');
  return `<div class="card"><h3>Today's plan · ${done} of ${items.length} done</h3>
   <div class="two"><button class="btn" id="planMap">${filters.planOnly ? 'Show everything' : 'Show on map'}</button><button class="btn" id="planNew">New plan</button></div>
   <button class="btn block ghost" id="planClear">Clear plan</button>
   ${legs.length ? `<p class="small" style="margin:10px 0 4px">Open in Google Maps (9 stops at a time):</p><div class="chips">${legs.map((l, i) => `<a class="chip" href="${legUrl(l)}" target="_blank" rel="noopener">Stops ${done + i * 9 + 1}–${done + i * 9 + l.length}</a>`).join('')}</div>` : '<p class="small ok">All done. Nice work.</p>'}
   <div style="margin-top:8px">${items.map((b, i) => { const r = rec(b.id), due = r && r.followUp && r.followUp <= todayStr(); return `<div class="item" data-id="${b.id}" style="padding:10px 0;${planDone(b.id) ? 'opacity:.45' : ''}"><span class="pnum">${planDone(b.id) ? '✓' : i + 1}</span>
     <div class="main"><div class="nm">${esc(b.name)}</div><div class="sub">${due ? '<b style="color:#2563eb">Follow-up</b> · ' : ''}${esc(b.cat)}${b.addr ? ' · ' + esc(b.addr) : ''}</div></div>
     <div class="right"><span class="pin" style="background:${S[statusOf(b.id)].color};display:inline-block"></span></div></div>`; }).join('')}</div></div>`;
}

// ---------- pipeline (appointments → quotes → sold, plus future proposals) ----------
function renderPipe() {
  const el = $('#pipe'); if (!el) return;
  const rows = { appt: [], quote: [], sent: [], sold: [] }, monthAgo = Date.now() - 30 * 864e5;
  for (const id in state.records) { const r = state.records[id], b = bizIndex.get(id); if (!b || !rows[r.status]) continue; if (r.status === 'sold' && (r.statusAt || 0) < monthAgo) continue; rows[r.status].push({ b, r }); }
  const ago = t => { const d = Math.floor((Date.now() - (t || Date.now())) / 864e5); return d <= 0 ? 'today' : d === 1 ? '1 day ago' : d + ' days ago'; };
  const $$ = r => [r.dealInstall && money(r.dealInstall), r.dealMonthly && money(r.dealMonthly) + '/mo'].filter(Boolean).join(' + ');
  const line = ({ b, r }) => {
    const nextAppt = r.status === 'appt' && r.followUp ? 'meeting ' + fmtDate(r.followUp) : '';
    const right = r.status === 'sent' ? `sent ${ago(r.quoteSentAt || r.statusAt)}` : r.status === 'appt' ? (nextAppt || 'set ' + ago(r.statusAt)) : r.status === 'quote' ? 'since ' + ago(r.statusAt).replace(' ago', '') : 'sold ' + ago(r.statusAt);
    const stale = r.status === 'sent' && Date.now() - (r.quoteSentAt || r.statusAt || 0) > 7 * 864e5;
    return `<div class="item" data-id="${b.id}"><span class="pin" style="background:${S[r.status].color}"></span>
    <div class="main"><div class="nm">${esc(b.name)}</div><div class="sub">${esc([r.dm, $$(r)].filter(Boolean).join(' · ') || b.cat)}</div></div>
    <div class="right" style="${stale ? 'color:var(--danger);font-weight:600' : ''}">${right}</div></div>`;
  };
  const open = [...rows.appt, ...rows.quote, ...rows.sent];
  const inst = open.reduce((a, x) => a + (+x.r.dealInstall || 0), 0), mon = open.reduce((a, x) => a + (+x.r.dealMonthly || 0), 0);
  let h = `<div class="page-title">Pipeline</div><div class="page-sub">Every deal from appointment to signed, plus the other venues to pitch later.</div>
   <div class="card"><div class="kpis"><div class="kpi"><b>${rows.appt.length}</b><span>Appts set</span></div><div class="kpi"><b>${rows.quote.length}</b><span>Quotes to build</span></div><div class="kpi"><b>${rows.sent.length}</b><span>Quotes out</span></div></div>
   <p class="small" style="margin:10px 0 0">Open: ${money(inst)} install · ${money(mon)}/mo${rows.sold.length ? ` &nbsp;|&nbsp; Sold last 30 days: ${rows.sold.length}` : ''}</p></div>`;
  const sec = (k, label, sort) => rows[k].length ? `<h2 class="sec">${label} (${rows[k].length})</h2>` + rows[k].sort(sort).map(line).join('') : '';
  const byAt = (a, b) => (a.r.statusAt || 0) - (b.r.statusAt || 0);
  h += sec('quote', 'Quotes to build', byAt) + sec('sent', 'Quotes out, waiting on a yes', (a, b) => (a.r.quoteSentAt || a.r.statusAt || 0) - (b.r.quoteSentAt || b.r.statusAt || 0)) + sec('appt', 'Appointments set', (a, b) => (a.r.followUp || '9').localeCompare(b.r.followUp || '9')) + sec('sold', 'Sold in the last 30 days', (a, b) => b.r.statusAt - a.r.statusAt);
  if (!open.length && !rows.sold.length) h += '<div class="empty"><b>No deals yet</b>Tap <b>Appt set</b> on a business and it shows up here. It moves to Building quote when you end the appointment.</div>';
  h += futuresListHtml();
  el.innerHTML = h; searchPage(el);
  const badge = rows.quote.length + allFutures().filter(x => x.f.revisit && x.f.revisit <= todayStr()).length;
  $('#pipeCount').textContent = badge; $('#pipeCount').classList.toggle('hidden', !badge);
}
$('#pipe').addEventListener('click', e => { const it = e.target.closest('.item'); if (it && it.dataset.id) openBiz(it.dataset.id, { fly: false }); });
