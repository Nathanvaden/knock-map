/* Knock Map: Daily log for HubSpot and the Stats tab */
'use strict';

// ---------- daily log (for entering the day into HubSpot) ----------
let logDate = null;
function dayEntries(day) {
  const out = [];
  for (const id in state.records) {
    const r = state.records[id], b = bizIndex.get(id); if (!b) continue;
    const vs = (r.visits || []).filter(v => ymd(new Date(v.t)) === day);
    const cards = (r.cards || []).filter(c => ymd(new Date(c.t)) === day);
    const pics = (r.photos || []).filter(p => !p.appt && ymd(new Date(p.t)) === day);
    const qn = (r.noteLog || []).filter(n => ymd(new Date(n.t)) === day);
    const ap = (r.appts || []).filter(a => ymd(new Date(a.t)) === day);
    if (!vs.length && !cards.length && !pics.length && !qn.length && !ap.length) continue;
    out.push({ b, r, vs, cards, pics, qn, ap, first: Math.min(...vs.map(v => v.t), ...cards.map(c => c.t), ...pics.map(p => p.t), ...qn.map(n => n.t), ...ap.map(a => a.t)) });
  }
  return out.sort((a, b) => a.first - b.first);
}
function entryText(e) {
  const { b, r, vs, cards } = e, g = r.g || {};
  const tm = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const addr = g.addr || r.addrCard || [b.addr, b.city, b.zip].filter(Boolean).join(', ');
  const L = [`${b.name}${addr ? ' - ' + addr : ''}`];
  for (const v of vs) L.push(`${tm(v.t)}: ${S[v.s].label}${v.note ? ' - ' + v.note : ''}`);
  const contact = [r.dm, r.dmTitle && '(' + r.dmTitle + ')', r.phone, r.email].filter(Boolean).join(' ');
  if (contact) L.push('Contact: ' + contact);
  for (const c of cards) if (c.name && c.name !== r.dm) L.push('Card: ' + [c.name, c.title && '(' + c.title + ')', c.cell || c.phone, c.email].filter(Boolean).join(' '));
  if (r.provider || r.contractEnd) L.push('Current provider: ' + [r.provider, r.contractEnd && 'contract ends ' + new Date(r.contractEnd + '-15T12:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })].filter(Boolean).join(', '));
  if (r.currentSystem) L.push('Has now: ' + r.currentSystem);
  for (const f of (state.fields || [])) { const v = (r.custom || {})[f.id]; if (v) L.push(f.name + ': ' + v); }
  if (r.dealInstall || r.dealMonthly) L.push('Deal: ' + [r.dealInstall && money(r.dealInstall) + ' install', r.dealMonthly && money(r.dealMonthly) + '/mo'].filter(Boolean).join(', '));
  if (r.followUp) L.push('Follow-up: ' + fmtDate(r.followUp));
  const futs = (r.futures || []).filter(f => f.t && ymd(new Date(f.t)) === ymd(new Date(e.first)));
  for (const f of futs) L.push(`Future proposal: ${f.venue}${f.revisit ? ', revisit ' + fmtDate(f.revisit) : ''}${f.monthly ? ', est. ' + money(f.monthly) + '/mo' : ''}${f.notes ? ' - ' + f.notes : ''}`);
  for (const a of (e.ap || [])) L.push(apptText(a, r));
  if (e.qn && e.qn.length) { L.push('Notes from today:'); for (const n of e.qn) L.push('  ' + new Date(n.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' - ' + n.text); }
  if (r.notes) L.push('Notes: ' + r.notes);
  if (e.pics && e.pics.length) L.push(`Walkthrough photos: ${e.pics.length}` + (e.pics.some(p => p.caption) ? ' (' + e.pics.filter(p => p.caption).map(p => p.caption).join('; ') + ')' : ''));
  return L.join('\n');
}
function renderLog() {
  const day = logDate || todayStr(), es = dayEntries(day);
  const counts = {}; es.forEach(e => e.vs.forEach(v => counts[v.s] = (counts[v.s] || 0) + 1));
  const isToday = day === todayStr();
  const leasesDay = liveLeases().filter(l => ymd(new Date(l.t)) === day);
  $('#stats').innerHTML = `<div class="page-title">Daily log</div><div class="page-sub">Everything you logged on a day, ready to copy into HubSpot.</div>
   <div class="card"><div style="display:flex;gap:8px;align-items:center">
     <button class="btn" data-day="-1" aria-label="Previous day">‹</button>
     <input type="date" id="logDay" value="${day}" max="${todayStr()}" style="flex:1;padding:9px;border:1px solid var(--line);border-radius:8px;font-size:16px">
     <button class="btn" data-day="1" ${isToday ? 'disabled' : ''} aria-label="Next day">›</button></div>
     <p class="small" style="margin:10px 0 0">${es.length} business${es.length === 1 ? '' : 'es'} · ${Object.values(counts).reduce((a, b) => a + b, 0)} visits${Object.keys(counts).length ? ' · ' + STATUSES.filter(s => counts[s.k]).map(s => counts[s.k] + ' ' + s.label).join(', ') : ''}</p>
     ${es.length ? `<div class="two" style="margin-top:10px"><button class="btn primary" id="logCopyAll">Copy all</button><button class="btn" id="logCsv">Download spreadsheet</button></div>` : ''}
     <button class="btn block ghost" id="logBack" style="margin-top:10px">Back to stats</button></div>
   ${es.length ? es.map((e, i) => `<div class="card logentry"><div style="display:flex;gap:8px;align-items:flex-start;justify-content:space-between">
       <div style="min-width:0"><b style="font-size:15px">${esc(e.b.name)}</b><div class="small">${esc([e.b.addr, e.b.city].filter(Boolean).join(', '))}</div></div>
       <button class="chip" data-copy="${i}">Copy</button></div>
     <div style="margin-top:8px">${e.vs.map(v => `<span class="pill" style="--c:${S[v.s].color};margin:0 6px 4px 0">${new Date(v.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${S[v.s].label}</span>`).join('')}</div>
     <pre class="logtext">${esc(entryText(e).split('\n').slice(1 + e.vs.length).join('\n')) || '<span class="small">No contact info or notes yet.</span>'}</pre>
     <button class="chip" data-open="${e.b.id}">Open business</button></div>`).join('')
     : `<div class="empty"><b>Nothing logged ${isToday ? 'yet today' : 'this day'}</b>Visits you log show up here.</div>`}
   ${leasesDay.length ? `<div class="card"><h3>Spotted while driving (${leasesDay.length})</h3>${leasesDay.map(l => `<div class="brow"><span style="flex:1"><b>${spotKind(l).pill}:</b> ${esc(l.project ? l.project + ' · ' : '')}${esc(l.addr || 'No address')}</span><span class="small">${esc([l.company, l.phone].filter(Boolean).join(' · '))}</span></div>`).join('')}</div>` : ''}`;
  const st = $('#stats');
  st.onclick = async ev => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.id === 'logBack') { logDate = null; logOpen = false; renderStats(); return; }
    if (t.dataset.day) { const d = new Date(day + 'T12:00'); d.setDate(d.getDate() + +t.dataset.day); logDate = ymd(d); renderLog(); return; }
    if (t.dataset.open) { switchView('map'); openBiz(t.dataset.open, { fly: true }); return; }
    if (t.dataset.copy) return copyText(entryText(es[+t.dataset.copy]), 'Copied. Paste it into HubSpot.');
    if (t.id === 'logCopyAll') return copyText(`Prospecting ${fmtDate(day)}\n\n` + es.map(entryText).join('\n\n'), 'Copied all ' + es.length);
    if (t.id === 'logCsv') {
      const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const rows = [['Time', 'Business', 'Address', 'City', 'Zip', 'Outcome', 'Decision maker', 'Title', 'Phone', 'Email', 'Provider', 'Contract ends', 'Follow-up', 'Install $', 'Monthly $', 'Notes']];
      for (const e of es) for (const v of e.vs) rows.push([new Date(v.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), e.b.name, e.b.addr, e.b.city, e.b.zip, S[v.s].label, e.r.dm, e.r.dmTitle, e.r.phone, e.r.email, e.r.provider, e.r.contractEnd, e.r.followUp, e.r.dealInstall, e.r.dealMonthly, e.r.notes]);
      download('prospecting-' + day + '.csv', rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv');
    }
  };
  st.onchange = ev => { if (ev.target.id === 'logDay' && ev.target.value) { logDate = ev.target.value; renderLog(); } };
}
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(msg); } catch (e2) { toast('Could not copy'); } ta.remove(); }
}
let logOpen = false;

// ---------- stats ----------
function renderStats() {
  if (logOpen) return renderLog();
  const visits = [];
  for (const id in state.records) for (const v of (state.records[id].visits || [])) if (bizIndex.has(id)) visits.push({ id, ...v });
  const today = todayStr();
  const startWeek = new Date(); startWeek.setHours(0, 0, 0, 0); startWeek.setDate(startWeek.getDate() - ((startWeek.getDay() + 6) % 7)); // Monday
  const inDay = v => ymd(new Date(v.t)) === today;
  const inWeek = v => v.t >= startWeek.getTime();
  const tv = visits.filter(inDay), wv = visits.filter(inWeek);
  const convos = arr => arr.filter(v => CONVO.has(v.s)).length;
  const appts = arr => arr.filter(v => v.s === 'appt').length;
  const sold = arr => arr.filter(v => v.s === 'sold').length;
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
  // last 14 days bars
  const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(ymd(d)); }
  const perDay = days.map(d => visits.filter(v => ymd(new Date(v.t)) === d).length);
  const max = Math.max(1, ...perDay);
  // outcome mix (all time)
  const mix = {}; for (const v of visits) mix[v.s] = (mix[v.s] || 0) + 1;
  // coverage by zip
  const z = {}; for (const b of allBiz()) { const k = b.zip || '—'; z[k] = z[k] || { n: 0, v: 0, city: b.city }; z[k].n++; if (statusOf(b.id) !== 'new') z[k].v++; }
  // by category conversion
  const cat = {}; for (const v of visits) { const b = bizIndex.get(v.id); if (!b) continue; const c = cat[b.cat] = cat[b.cat] || { n: 0, c: 0 }; c.n++; if (CONVO.has(v.s)) c.c++; }
  // pipeline
  const nowD = new Date(), mStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime();
  const pipe = { n: 0, inst: 0, mon: 0 }, soldM = { n: 0, inst: 0, mon: 0 }, soldAll = { n: 0, inst: 0, mon: 0 };
  for (const id in state.records) {
    const r = state.records[id]; if (!bizIndex.has(id)) continue;
    const inst = +r.dealInstall || 0, mon = +r.dealMonthly || 0;
    if (['dm', 'followup', 'appt', 'quote', 'sent'].includes(r.status) && (inst || mon)) { pipe.n++; pipe.inst += inst; pipe.mon += mon; }
    if (r.status === 'sold') { soldAll.n++; soldAll.inst += inst; soldAll.mon += mon; if ((r.statusAt || 0) >= mStart) { soldM.n++; soldM.inst += inst; soldM.mon += mon; } }
  }
  const dealCard = `<div class="card"><h3>Deals</h3><div class="kpis">
    <div class="kpi"><b>${soldM.n}</b><span>Sold this month</span></div><div class="kpi"><b>${money(soldM.inst)}</b><span>Install this month</span></div><div class="kpi"><b>${money(soldM.mon)}</b><span>Monthly added</span></div></div>
    <div class="kpis" style="margin-top:8px"><div class="kpi"><b>${pipe.n}</b><span>Open deals</span></div><div class="kpi"><b>${money(pipe.inst)}</b><span>Install in pipeline</span></div><div class="kpi"><b>${money(pipe.mon)}</b><span>Monthly in pipeline</span></div></div>
    <p class="small">Right now: ${['appt', 'quote', 'sent'].map(k => Object.values(state.records).filter(r => r.status === k).length + ' ' + S[k].label.toLowerCase()).join(' · ')}</p>
    ${allFutures().length ? `<p class="small">Future proposals: ${allFutures().length} open · ${money(allFutures().reduce((a, x) => a + (+x.f.install || 0), 0))} install · ${money(allFutures().reduce((a, x) => a + (+x.f.monthly || 0), 0))}/mo potential</p>` : ''}
    <p class="small" style="margin-bottom:0">All time sold: ${soldAll.n} · ${money(soldAll.inst)} install · ${money(soldAll.mon)}/mo. Add $ on any deal from its Deal box.</p></div>`;
  let h = `<div class="page-title">Stats</div><div class="page-sub">How your prospecting is going. Updates as you log visits.</div>
   <div class="card" style="display:flex;align-items:center;gap:12px"><div style="flex:1"><h3 style="margin:0 0 2px">Daily log</h3><div class="small">Everything from today in one place, ready to copy into HubSpot.</div></div><button class="btn primary" id="openLog">Open</button></div>
   <div class="card"><h3>Today</h3><div class="kpis">
    <div class="kpi"><b>${tv.length}</b><span>Doors</span></div><div class="kpi"><b>${convos(tv)}</b><span>DM convos</span></div><div class="kpi"><b>${appts(tv)}</b><span>Appts</span></div></div></div>
   <div class="card"><h3>This week</h3><div class="kpis">
    <div class="kpi"><b>${wv.length}</b><span>Doors</span></div><div class="kpi"><b>${pct(convos(wv), wv.length)}</b><span>Reach DM</span></div><div class="kpi"><b>${appts(wv)} / ${sold(wv)}</b><span>Appts / Sold</span></div></div></div>
   ${dealCard}
   <div class="card"><h3>Doors per day, last 2 weeks</h3><div class="bars">${perDay.map((n, i) => `<div class="b"><em>${n || ''}</em><i style="height:${n / max * 80}%"></i>${new Date(days[i] + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</div>`).join('')}</div></div>
   <div class="card"><h3>All visits by outcome (${visits.length})</h3>${STATUSES.filter(s => s.k !== 'new').map(s => { const n = mix[s.k] || 0; return `<div class="brow"><span class="l">${s.label}</span><span class="t"><i style="width:${visits.length ? n / visits.length * 100 : 0}%;background:${s.color}"></i></span><span class="n">${n}</span></div>`; }).join('')}</div>
   <div class="card"><h3>Reach-a-DM rate by business type</h3>${Object.keys(cat).length ? Object.entries(cat).sort((a, b) => b[1].n - a[1].n).map(([k, c]) => `<div class="brow"><span class="l">${esc(k)}</span><span class="t"><i style="width:${c.c / c.n * 100}%;background:var(--brand)"></i></span><span class="n">${c.c}/${c.n}</span></div>`).join('') : '<div class="small">Shows up once you start logging.</div>'}</div>
   <div class="card"><h3>Territory coverage</h3>${Object.entries(z).sort().map(([k, c]) => `<div class="brow"><span class="l">${esc(k)} ${esc(c.city || '')}</span><span class="t"><i style="width:${c.v / c.n * 100}%;background:var(--ok)"></i></span><span class="n">${c.v}/${c.n}</span></div>`).join('') || '<div class="small">Load businesses in Settings first.</div>'}</div>`;
  $('#stats').innerHTML = h;
  $('#stats').onclick = e => { if (e.target.id === 'openLog') { logOpen = true; logDate = null; renderLog(); $('#view-stats').scrollTop = 0; } };
  $('#stats').onchange = null;
}
