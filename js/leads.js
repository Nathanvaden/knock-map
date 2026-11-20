/* Knock Map: Lead sources: permits, property owners/landlords, Bay Alarm customers, For Lease and construction pins */
'use strict';

// ---------- permits ----------
let currentPermit = null;
let permitMsg = { text: '', err: false };
let custMsg = '';
const TERR_CITIES = new RegExp('\\b(' + [...new Set(TERRITORY.features.map(f => f.properties.city.toLowerCase()))].sort((a, b) => b.length - a.length).join('|') + ')\\b', 'i');
const RES_RE = /\b(residential|single[- ]?family|sfr|sfd|pool|spa|patio|solar|pv|dwelling|duplex|fence|wall|re-?roof|reroof|water heater|mobile home|manufactured|casita|garage conversion|carport|res\b|addition-res)/i;
const COM_RE = /\b(commercial|tenant|t\.?i\.?\b|retail|office|restaurant|industrial|warehouse|shell|business|church|school|medical|clinic|dental|hotel|storage|bank|store|suite|ste\b|com\b|comm\b|multi-?family|apartment|assembly|mercantile)/i;
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('could not load the spreadsheet reader')); document.head.appendChild(s); });
}
function findCol(headers, re, taken) { for (let i = 0; i < headers.length; i++) if (!taken.has(i) && re.test(headers[i])) { taken.add(i); return i; } return -1; }
async function importPermits(file, commercialOnly) {
  await loadSheetJS();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  let added = 0, seen = 0, skippedArea = 0, skippedRes = 0;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
    // header row = first row (in the top 20) with 3+ recognizable column names
    let hi = -1;
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const hits = rows[i].filter(c => /permit|address|location|desc|type|valu|date|owner|contractor|zip|city|parcel|apn|work|scope/i.test(String(c))).length;
      if (hits >= 3) { hi = i; break; }
    }
    if (hi < 0) continue;
    const H = rows[hi].map(c => String(c).trim().toLowerCase()); const taken = new Set();
    if (H.includes('acct') || H.includes('msr') || H.includes('venue')) return { added: 0, seen: 0, skippedArea: 0, skippedRes: 0, customerList: true };
    const col = {
      permit: findCol(H, /permit.*(no|num|#|id)|^permit$|^record|case.*(no|num)|^number$/, taken),
      date: findCol(H, /issue.*date|date.*issue|^issued|^date/, taken),
      addr: findCol(H, /address|location|site/, taken),
      city: findCol(H, /city|town|community/, taken),
      zip: findCol(H, /zip/, taken),
      desc: findCol(H, /desc|scope/, taken),
      type: findCol(H, /type|categor|occupancy/, taken),
      work: findCol(H, /work class|class|use/, taken),
      value: findCol(H, /valu|cost|amount/, taken),
      owner: findCol(H, /owner|applicant|tenant|business|dba/, taken),
      cphone: findCol(H, /contractor.*phone|phone/, taken),
      cemail: findCol(H, /contractor.*email|email/, taken),
      contractor: findCol(H, /contractor|builder/, taken),
      parcel: findCol(H, /parcel|apn/, taken),
    };
    if (col.desc < 0) col.desc = findCol(H, /work|project|name/, taken);
    if (col.addr < 0) continue;
    const g = (row, k) => col[k] >= 0 ? String(row[col[k]] || '').trim() : '';
    for (const row of rows.slice(hi + 1)) {
      const addrFull = g(row, 'addr'); if (!addrFull) continue;
      const addr = addrFull.split(/\n/)[0].trim();
      seen++;
      const text = [g(row, 'type'), g(row, 'work'), g(row, 'desc')].join(' ');
      let zip = g(row, 'zip').slice(0, 5); if (!/^\d{5}$/.test(zip)) { const m = (addrFull + ' ' + g(row, 'city')).match(/\b(85\d{3})\b/); zip = m ? m[1] : ''; }
      const city = g(row, 'city');
      const myZips = TERRITORY.features.map(f => f.properties.zip);
      if (zip && !myZips.includes(zip)) { skippedArea++; continue; }
      if (!zip && city && !TERR_CITIES.test(city)) { skippedArea++; continue; }
      const tcol = g(row, 'type');
      // trust an explicit Residential/Commercial permit type when the file has one
      // not a business moving in or building out: skip
      if (/compliance inspection|stormwater|grading|infrastructure/i.test(tcol) || /^(fences?|wireless tower.*|annual facilities.*|demolition)$/i.test(g(row, 'work'))) { skippedRes++; continue; }
      const isRes = /residential/i.test(tcol) ? true : /commercial/i.test(tcol) ? false : (RES_RE.test(text) && !COM_RE.test(text));
      if (commercialOnly && isRes) { skippedRes++; continue; }
      const permit = g(row, 'permit');
      if (!permit && !g(row, 'date') && !g(row, 'type') && !g(row, 'work')) { seen--; continue; }
      const id = 'p' + (permit ? permit.replace(/[^A-Za-z0-9]/g, '') : (addr + text).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40));
      const old = state.permits[id];
      state.permits[id] = { ...(old || {}), id, permit, date: g(row, 'date'), addr, city, zip, type: [g(row, 'type'), g(row, 'work')].filter(Boolean).join(' · '), desc: g(row, 'desc'), value: g(row, 'value'),
        owner: g(row, 'owner'), contractor: g(row, 'contractor'), cphone: g(row, 'cphone'), cemail: g(row, 'cemail'), parcel: g(row, 'parcel'), kind: isRes ? 'residential' : (/commercial/i.test(tcol) || COM_RE.test(text)) ? 'commercial' : 'other',
        geoFail: false, ...(old && old.geoFail ? { lat: null, lon: null } : {}), status: (old && old.status) || 'new', importedAt: (old && old.importedAt) || Date.now(), updatedAt: Date.now() };
      if (!old) added++;
    }
  }
  state.updatedAt = Date.now(); await commit();
  return { added, seen, skippedArea, skippedRes };
}
let geocoding = false;
function jsonp(url, ms) {
  return new Promise((res, rej) => {
    const cb = '__geo' + Math.random().toString(36).slice(2); const sc = document.createElement('script');
    const t = setTimeout(() => { cleanup(); rej(new Error('timeout')); }, ms || 8000);
    function cleanup() { clearTimeout(t); delete window[cb]; sc.remove(); }
    window[cb] = d => { cleanup(); res(d); };
    sc.onerror = () => { cleanup(); rej(new Error('failed')); };
    sc.src = url + '&callback=' + cb; document.head.appendChild(sc);
  });
}
async function nominatim(params) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&' + params, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('geocoder busy');
  const j = await r.json(); return j[0] ? { lat: +j[0].lat, lon: +j[0].lon } : null;
}
// Tries several free geocoders, most precise first. Returns {lat, lon, approx}.
async function geocodeAddress(p) {
  const street = p.addr.split(/\n/)[0].replace(/[,\s]+(ste|suite|unit|bldg|building|#|apt|spc|space)\b.*$/i, '').trim();
  const city = (p.city || '').trim(), zip = p.zip || '';
  const enc = encodeURIComponent;
  let hit = await nominatim(`street=${enc(street)}&city=${enc(city)}&state=AZ&postalcode=${enc(zip)}`);
  if (hit) return hit;
  await new Promise(z => setTimeout(z, 1100));
  try {
    const d = await jsonp('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=jsonp&address=' + enc(`${street}, ${city}, AZ ${zip}`));
    const m = d && d.result && d.result.addressMatches && d.result.addressMatches[0];
    if (m) return { lat: m.coordinates.y, lon: m.coordinates.x };
  } catch (e) { /* census lookup unavailable, keep going */ }
  hit = await nominatim('q=' + enc(`${street}, ${city}, AZ ${zip}`));
  if (hit) return hit;
  await new Promise(z => setTimeout(z, 1100));
  const roadOnly = street.replace(/^\d+\s+/, '');
  hit = await nominatim(`street=${enc(roadOnly)}&city=${enc(city)}&state=AZ`);
  return hit ? { ...hit, approx: true } : null;
}
async function geocodePermits(onProgress) {
  if (geocoding) return; geocoding = true;
  try {
    const todo = Object.values(state.permits).filter(p => p.lat == null && !p.geoFail && p.status === 'new');
    for (let i = 0; i < todo.length; i++) {
      const p = todo[i];
      onProgress && onProgress(`Finding permits on the map (${i + 1} of ${todo.length})…`);
      let hit;
      try { hit = await geocodeAddress(p); } catch (e) { break; /* offline or rate-limited: try again later */ }
      const pp = state.permits[p.id]; if (!pp) continue;
      if (hit) {
        const lat = +hit.lat.toFixed(6), lon = +hit.lon.toFixed(6), z = zipOf(lat, lon);
        pp.lat = lat; pp.lon = lon; pp.approx = !!hit.approx; if (!z && !hit.approx) pp.outside = true; else if (!pp.zip && z) pp.zip = z.zip;
      } else pp.geoFail = true;
      pp.updatedAt = Date.now();
      if (i % 5 === 4) { await saveLocal(); drawMarkers(); }
      await new Promise(z => setTimeout(z, 1100)); // be polite to the free geocoders
    }
    state.updatedAt = Date.now(); await commit();
  } finally { geocoding = false; onProgress && onProgress(''); renderSettingsIfOpen(); }
}
// Permits that aren't a business moving in or building out: hidden unless "show hidden" is on
const PERMIT_NOISE = /annual facilities|\bAFP\b|\bfences?\b|propane|photovoltaic|\bsolar\b|\bPV\b|battery storage|well ?head|water treatment|\bEPCOR\b|wireless|cell tower|\bWCF\b|utility|compliance inspection|irrigation|\bpools?\b|\bspa\b|demolition|re-?roof|water heater|hvac|backflow/i;
function permitNoise(p) { return p.kind !== 'commercial' || PERMIT_NOISE.test([p.type, p.desc].join(' ')); }
function permitScore(p) { const t = [p.type, p.desc].join(' '); return /\bsigns?\b|letters|pylon|monument/i.test(t) ? 3 : /tenant|\bT\.?I\.?\b|remodel|alteration|new construction|new building|shell|addition|build-?out|suite/i.test(t) ? 2 : 1; }
function permitTime(p) { const m = String(p.date || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], +m[1] - 1, +m[2]).getTime() : (p.importedAt || 0); }
// A real permit has a permit number, an issue date or a permit type. Rows without any of those
// (e.g. a customer list loaded through the permit import by mistake) are not permits.
function isRealPermit(p) { return !!(p.permit || p.date || p.type); }
function allNewPermits() { return Object.values(state.permits || {}).filter(p => p.status === 'new' && !p.outside && isRealPermit(p)); }
function cleanJunkPermits() {
  let n = 0; for (const p of Object.values(state.permits || {})) if (p.status === 'new' && !isRealPermit(p)) { p.status = 'junk'; p.updatedAt = Date.now(); n++; }
  if (n) { state.updatedAt = Date.now(); commit(); } return n;
}
function livePermits() { return allNewPermits().filter(p => settings.showNoisePermits || !permitNoise(p)); }
let permitMarkers = new Map();
// Permits at the same spot (a big project often has one permit per building) share one pin with a count.
const permitSpot = p => p.lat.toFixed(4) + ',' + p.lon.toFixed(4);
let permitGroup = null;
function drawPermits() {
  const show = filters.permits && !filters.planOnly ? livePermits().filter(p => p.lat != null) : [];
  const groups = new Map();
  for (const p of show) { const k = permitSpot(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  for (const [k, m] of permitMarkers) { const g = groups.get(k); if (!g || (m._kmCount || 1) !== g.length) { map.removeLayer(m); permitMarkers.delete(k); } }
  const r = radiusForZoom() + 2;
  for (const [k, g] of groups) {
    const sel = g.some(p => p.id === currentPermit);
    let m = permitMarkers.get(k);
    if (g.length === 1) {
      const style = { radius: sel ? r + 4 : r, fillColor: '#f97316', color: sel ? '#0f172a' : '#fff', weight: sel ? 3 : 2, fillOpacity: 1, renderer };
      if (!m) { m = L.circleMarker([g[0].lat, g[0].lon], style).addTo(map); m.on('click', () => { permitGroup = null; openPermit(g[0].id); }); permitMarkers.set(k, m); }
      else { m.setStyle(style); m.setRadius(style.radius); }
      m.bringToFront();
    } else {
      const ids = g.map(p => p.id);
      const icon = L.divIcon({ className: '', html: `<div class="permit-stack${sel ? ' sel' : ''}">${g.length}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
      if (!m) { m = L.marker([g[0].lat, g[0].lon], { icon, zIndexOffset: 500 }).addTo(map); m._kmCount = g.length; permitMarkers.set(k, m); }
      else m.setIcon(icon);
      m.off('click'); m.on('click', () => openPermitGroup(ids));
    }
  }
}
function openPermitGroup(ids) {
  const ps = ids.map(id => state.permits[id]).filter(Boolean); if (!ps.length) return;
  permitGroup = ids; current = null; currentPermit = ps[0].id;
  const addrs = [...new Set(ps.map(permitAddr))];
  $('#sheetBody').innerHTML = `<div class="sh-title"><h3>${ps.length} permits here</h3><button class="closex" data-pact="close" aria-label="Close">${ICON('x')}</button></div>
   <div class="meta"><span class="pill" style="--c:#f97316">Permits</span> ${esc(addrs.slice(0, 2).join(' · '))}${addrs.length > 2 ? ' +' + (addrs.length - 2) : ''}</div>
   <p class="small">Usually one project with a permit for each building or phase. Tap one for the details.</p>
   ${ps.sort((a, b) => permitScore(b) - permitScore(a)).map(p => `<button class="futrow" data-pact="open" data-pid="${p.id}"><span style="flex:1;text-align:left"><b>${esc(permitTitle(p))}</b><br><span class="small">${esc(permitAddr(p))}${p.date ? ' · ' + esc(p.date) : ''}</span></span><span class="small" style="white-space:nowrap">${permitValue(p)}</span></button>`).join('')}`;
  $('#sheet').classList.remove('hidden'); drawMarkers();
}
function permitTitle(p) {
  const d = (p.desc || '').replace(/\s+/g, ' ').trim();
  const t = d && d.length > 3 && !/^(signs?|accessory|addition|alteration, remodel, repair)$/i.test(d) ? d : (p.type || '').split(' · ').pop() || d;
  return (t.length > 70 ? t.slice(0, 68) + '…' : t) || 'Permit ' + (p.permit || '');
}
function permitOwner(p) { const o = (p.owner || '').replace(/^[\s,]+/, '').trim(); return /^(n\/a\s*)+$/i.test(o) ? '' : o; }
function permitAddr(p) { return (p.addr || '').split(/\n/)[0].replace(/\s+/g, ' ').replace(/\s+(SUN CITY WEST|SUN CITY|SURPRISE|PEORIA|EL MIRAGE),?\s*AZ.*$/i, '').trim(); }
function permitValue(p) { const n = parseFloat(String(p.value || '').replace(/[^0-9.]/g, '')); return n ? money(n) : ''; }
function openPermit(id, fly) {
  const p = state.permits[id]; if (!p) return;
  current = null; currentPermit = id;
  const nav = p.lat != null ? 'https://www.google.com/maps/dir/?api=1&destination=' + p.lat + ',' + p.lon : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.addr + ' ' + (p.city || '') + ' AZ');
  const row = (k, v) => v ? `<div class="brow"><span class="l" style="width:92px;color:#64748b">${k}</span><span style="flex:1">${esc(v)}</span></div>` : '';
  if (permitGroup && !permitGroup.includes(id)) permitGroup = null;
  $('#sheetBody').innerHTML = `${permitGroup && permitGroup.length > 1 ? `<button class="chip" data-pact="back" style="margin-bottom:8px">← All ${permitGroup.length} permits here</button>` : ''}<div class="sh-title"><h3>${esc((p.desc || '').replace(/\s+/g, ' ').trim().length > 3 ? (p.desc || '').replace(/\s+/g, ' ').trim() : permitTitle(p))}</h3><button class="closex" data-pact="close" aria-label="Close">${ICON('x')}</button></div>
   <div class="meta"><span class="pill" style="--c:#f97316">Permit${p.kind === 'commercial' ? ' · commercial' : ''}</span> ${esc(permitAddr(p))}${p.city ? ', ' + esc(p.city) : ''} ${esc(p.zip || '')}</div>
   ${row('Permit #', p.permit)}${row('Issued', p.date)}${row('Type', p.type)}${row('Work', p.desc)}${row('Value', permitValue(p))}${row('Owner', permitOwner(p))}${row('Contractor', p.contractor)}${row('GC phone', p.cphone)}${row('GC email', p.cemail)}${row('Parcel', p.parcel)}
   ${p.lat == null ? '<p class="small">Not on the map yet' + (p.geoFail ? ': the address lookup came up empty. Tap Directions to find it in Google Maps.' : '.') + '</p>' : p.approx ? '<p class="small">Pin is on the right street but the exact spot is a guess.</p>' : ''}
   <div class="actions"><a href="${nav}" target="_blank" rel="noopener">${ICON('nav')}Directions</a>${p.cphone ? `<a href="tel:${esc(p.cphone.replace(/[^\d+]/g, '').slice(0, 11))}">${ICON('phone')}Call GC</a>` : ''}<a href="https://www.google.com/search?q=${encodeURIComponent((p.contractor || p.owner || p.addr) + ' ' + (p.city || 'AZ'))}" target="_blank" rel="noopener">${ICON('search')}Google</a>${p.permit ? `<a href="https://www.google.com/search?q=${encodeURIComponent('"' + p.permit + '" ' + (p.city || '') + ' AZ permit')}" target="_blank" rel="noopener">${ICON('search')}Permit #</a>` : ''}</div>
   <p class="small">Something's being built or remodeled here. Stop by while it's under construction and ask who's handling security, cameras, access control and fire.</p>
   <button class="btn block primary" data-pact="convert">Turn into a prospect</button>
   <button class="btn block ghost" data-pact="dismiss">Not worth it, hide this permit</button>`;
  $('#sheet').classList.remove('hidden'); drawMarkers();
  if (fly && p.lat != null) { filters.planOnly = false; $('#filterDot').classList.toggle('hidden', !filterActive()); switchView('map'); $('#sheet').classList.remove('hidden'); map.setView([p.lat, p.lon], 17); }
}
$('#sheet').addEventListener('click', e => {
  const t = e.target.closest('[data-pact]'); if (!t || !currentPermit) return;
  const p = state.permits[currentPermit];
  if (t.dataset.pact === 'open') { openPermit(t.dataset.pid); return; }
  if (t.dataset.pact === 'back') { openPermitGroup(permitGroup); return; }
  if (t.dataset.pact === 'close') { permitGroup = null; currentPermit = null; $('#sheet').classList.add('hidden'); drawMarkers(); }
  if (t.dataset.pact === 'dismiss') { p.status = 'dismissed'; p.updatedAt = state.updatedAt = Date.now(); currentPermit = null; $('#sheet').classList.add('hidden'); commit(); toast('Permit hidden'); }
  if (t.dataset.pact === 'convert') {
    const lat = p.lat != null ? p.lat : (me ? me.lat : map.getCenter().lat), lon = p.lon != null ? p.lon : (me ? me.lon : map.getCenter().lng);
    const z = zipOf(lat, lon); const nid = 'c' + Date.now().toString(36);
    state.custom[nid] = { id: nid, name: permitOwner(p) && !/^(c\/o)/i.test(permitOwner(p)) && /\b(llc|inc|corp|church|clinic|dental|school|center|co)\b/i.test(permitOwner(p)) ? permitOwner(p) : permitTitle(p), cat: 'Other', type: 'under construction', lat, lon, addr: permitAddr(p), city: p.city || (z ? z.city : ''), zip: p.zip || (z ? z.zip : ''), phone: '', web: '', hours: '', updatedAt: Date.now() };
    const r = touch(nid);
    r.notes = `From permit ${p.permit || ''}${p.date ? ' (' + p.date + ')' : ''}: ${[p.type, p.desc].filter(Boolean).join(' – ')}${p.value ? '. Value ' + p.value : ''}${p.contractor ? '. Contractor: ' + p.contractor + (p.cphone ? ' ' + p.cphone : '') + (p.cemail ? ' ' + p.cemail : '') : ''}${p.owner ? '. Owner: ' + p.owner : ''}`;
    p.status = 'converted'; p.bizId = nid; p.updatedAt = state.updatedAt = Date.now();
    currentPermit = null; reindex(); commit(); openBiz(nid, { tab: 'notes' }); toast('Added as a prospect. Rename it once you know the business name.');
  }
});
function permitsListHtml() {
  const list = livePermits().sort((a, b) => permitScore(b) - permitScore(a) || permitTime(b) - permitTime(a));
  const hidden = allNewPermits().filter(permitNoise).length;
  if (!list.length && !hidden) return '';
  const tag = p => permitScore(p) === 3 ? '<span class="pill" style="--c:#f97316;margin-right:6px">Sign</span>' : permitScore(p) === 2 ? '<span class="pill" style="--c:#8b5cf6;margin-right:6px">Build-out</span>' : '';
  return `<h2 class="sec" style="display:flex;justify-content:space-between;align-items:center">New permits (${list.length})${hidden ? `<button class="chip" id="pmNoise" style="text-transform:none;letter-spacing:0">${settings.showNoisePermits ? 'Hide' : 'Show'} ${hidden} low-value</button>` : ''}</h2>` + list.slice(0, 60).map(p => `<div class="item" data-permit="${p.id}" data-q="${esc([p.desc, p.type, p.addr, p.city, p.owner, p.contractor, p.permit, p.parcel].filter(Boolean).join(' ').toLowerCase())}" style=""${permitNoise(p) ? 'opacity:.55' : ''}"><span class="pin" style="background:#f97316"></span>
    <div class="main"><div class="nm">${tag(p)}${esc(permitTitle(p))}</div><div class="sub">${esc(permitAddr(p))}${p.city ? ', ' + esc(p.city) : ''}${permitOwner(p) ? ' · ' + esc(permitOwner(p)) : ''}${p.contractor ? ' · GC: ' + esc(p.contractor) : ''}</div></div>
    <div class="right">${esc(p.date || '')}${permitValue(p) ? '<br>' + permitValue(p) : ''}</div></div>`).join('');
}

// ---------- property owners (Maricopa County Assessor parcel data, public, free) ----------
const PARCEL_URL = 'https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Parcel_Data_View/FeatureServer/0/query';
const PARCEL_FIELDS = 'APNDash,PropertyFullStreetAddress,PropertyCity,PropertyZipCode,OwnerName,OwnerAddressLine1,OwnerAddressLine2,OwnerCity,OwnerState,OwnerZipCode,PropertyUseDescription,ConstructionYear,LotSize_Acre,SaleDate,SalePrice,AssessorWebLink,Latitude_DD,Longitude_DD';
async function parcelQuery(params) {
  const body = new URLSearchParams({ f: 'json', returnGeometry: 'false', outFields: PARCEL_FIELDS, ...params });
  const r = await fetch(PARCEL_URL, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!r.ok) throw new Error('county data HTTP ' + r.status);
  const j = await r.json(); if (j.error) throw new Error(j.error.message || 'county data error');
  return j;
}
function cleanParcel(a) {
  const mail = [a.OwnerAddressLine1, a.OwnerAddressLine2].filter(Boolean).join(', ').replace(/\s+/g, ' ').trim();
  return { apn: a.APNDash, addr: (a.PropertyFullStreetAddress || '').replace(/\s+/g, ' ').trim(), city: a.PropertyCity, zip: a.PropertyZipCode,
    owner: (a.OwnerName || '').trim(), mail, mailCity: [a.OwnerCity, a.OwnerState, a.OwnerZipCode].filter(Boolean).join(' '),
    use: a.PropertyUseDescription || '', built: a.ConstructionYear || '', acres: a.LotSize_Acre ? +(+a.LotSize_Acre).toFixed(2) : '',
    saleDate: a.SaleDate ? new Date(a.SaleDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '', salePrice: a.SalePrice || '',
    link: a.AssessorWebLink || '', lat: a.Latitude_DD, lon: a.Longitude_DD };
}
// "C/O ACME PROPERTY MGMT" style lines name the manager; otherwise the mailing address itself is the lead
function managerOf(p) {
  const m = (p.mail || '').match(/\b(?:C\/O|ATTN:?|ATTENTION)\s+(.+)/i);
  if (m) return m[1].split(',')[0].trim();
  if (/\b(management|mgmt|property|properties|realty|real estate|partners|asset|holdings)\b/i.test(p.mail)) return p.mail.split(',')[0];
  return '';
}
async function lookupOwner(id) {
  const b = bizIndex.get(id); toast('Checking county records…');
  try {
    const j = await parcelQuery({ where: '1=1', geometry: `${b.lon},${b.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: '25', units: 'esriSRUnit_Meter', resultRecordCount: '10' });
    const ps = (j.features || []).map(f => cleanParcel(f.attributes));
    if (!ps.length) { toast('No parcel found at this pin. Try moving the pin onto the building.'); return; }
    ps.sort((x, y) => dist(b.lat, b.lon, x.lat, x.lon) - dist(b.lat, b.lon, y.lat, y.lon));
    const r = touch(id); r.parcel = { ...ps[0], at: Date.now() };
    commit(); renderSheet({ openOwner: true }); toast('Owner found');
  } catch (err) { toast('County lookup failed: ' + err.message); }
}
function ownerBoxHtml(r) {
  const p = r.parcel; if (!p) return '';
  const mgr = managerOf(p);
  const row = (k, v) => v ? `<div class="brow"><span class="l" style="width:96px;color:var(--muted)">${k}</span><span style="flex:1">${esc(v)}</span></div>` : '';
  return `<div class="fu-box owner"><div class="lbl">Property owner</div>
    ${row('Owner', p.owner)}${mgr ? row('Managed by', mgr) : ''}${row('Mailing', [p.mail, p.mailCity].filter(Boolean).join(', '))}
    ${row('Property', p.use)}${row('Built', p.built)}${row('Last sold', p.saleDate)}${row('Parcel', p.apn)}
    <div class="chips" style="margin-top:8px"><button class="chip" data-act="ownerOthers">Other properties they own here</button>${p.link ? `<a class="chip" href="${esc(p.link)}" target="_blank" rel="noopener">County record</a>` : ''}<a class="chip" href="https://www.google.com/search?q=${encodeURIComponent((mgr || p.owner) + ' Arizona')}" target="_blank" rel="noopener">Google owner</a></div>
    <p class="small" style="margin:6px 0 0">From the county assessor. The mailing address is often the property manager's office.</p></div>`;
}
function territoryZipList() { return TERRITORY.features.map(f => `'${f.properties.zip}'`).join(','); }
async function showOwnerProperties(owner, mail) {
  showModal(`<h3>${esc(owner)}</h3><p class="small" id="opMsg">Looking up their properties…</p><div id="opList"></div><button class="btn block ghost" id="opClose">Close</button>`);
  $('#opClose').onclick = hideModal;
  try {
    const q = s => s.replace(/'/g, "''");
    const where = `PropertyZipCode IN (${territoryZipList()}) AND (OwnerName = '${q(owner)}'${mail ? ` OR OwnerAddressLine1 = '${q(mail.split(',')[0])}'` : ''})`;
    const j = await parcelQuery({ where, resultRecordCount: '200', orderByFields: 'PropertyFullStreetAddress' });
    const ps = (j.features || []).map(f => cleanParcel(f.attributes)).filter(p => p.addr);
    $('#opMsg').textContent = `${ps.length} propert${ps.length === 1 ? 'y' : 'ies'} in your territory with this owner or mailing address.`;
    $('#opList').innerHTML = ps.map(p => { const bz = bizAtParcel(p); return `<div class="item" ${bz ? `data-id="${bz.id}"` : `data-ll="${p.lat},${p.lon}"`} style="padding:10px 0">
      <div class="main"><div class="nm">${esc(bz ? bz.name : p.addr)}</div><div class="sub">${esc(bz ? p.addr + ' · ' : '')}${esc(p.use)}${p.owner !== owner ? ' · ' + esc(p.owner) : ''}</div></div><div class="right">${esc(p.zip || '')}</div></div>`; }).join('');
    $('#opList').onclick = e => { const it = e.target.closest('.item'); if (!it) return; hideModal(); if (it.dataset.id) openBiz(it.dataset.id, { fly: true }); else { const [la, lo] = it.dataset.ll.split(','); switchView('map'); map.setView([+la, +lo], 18); } };
  } catch (err) { $('#opMsg').textContent = 'County lookup failed: ' + err.message; }
}
function bizAtParcel(p) {
  if (!p.lat) return null;
  let best = null, bd = 0.04; // within ~200 ft of the parcel center
  for (const b of allBiz()) { const d = dist(p.lat, p.lon, b.lat, b.lon); if (d < bd) { bd = d; best = b; } }
  return best;
}
// Top landlords / managers: every commercial parcel in the territory, grouped by mailing address
let landlordState = { running: false, msg: '' };
async function loadLandlords() {
  if (landlordState.running) return; landlordState.running = true; landlordState.msg = 'Pulling commercial parcels from the county…'; renderFollow();
  try {
    const all = []; let lastId = 0;
    // page by OBJECTID (works on every ArcGIS server, unlike offsets)
    for (let page = 0; page < 40; page++) {
      const j = await parcelQuery({ where: `PropertyZipCode IN (${territoryZipList()}) AND ImprovementLegalClassCode LIKE '1%' AND OBJECTID > ${lastId}`, orderByFields: 'OBJECTID ASC', outFields: PARCEL_FIELDS + ',OBJECTID' });
      const feats = j.features || [];
      for (const f of feats) { all.push(cleanParcel(f.attributes)); if (f.attributes.OBJECTID > lastId) lastId = f.attributes.OBJECTID; }
      landlordState.msg = `Pulled ${all.length} commercial parcels…`; renderFollow();
      if (!feats.length || !j.exceededTransferLimit) break;
    }
    const groups = new Map();
    for (const p of all) {
      if (!p.owner || /\b(CITY OF|COUNTY|STATE OF|SCHOOL DIST|UNITED STATES|ARIZONA PUBLIC SERVICE|SALT RIVER)\b/i.test(p.owner)) continue;
      const key = (p.mail || p.owner).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const g = groups.get(key) || { key, mail: p.mail, mailCity: p.mailCity, mgr: managerOf(p), owners: new Set(), parcels: [] };
      g.owners.add(p.owner); g.parcels.push(p); groups.set(key, g);
    }
    const top = [...groups.values()].filter(g => g.parcels.length >= 2).sort((a, b) => b.parcels.length - a.parcels.length).slice(0, 60)
      .map(g => ({ key: g.key, mail: g.mail, mailCity: g.mailCity, mgr: g.mgr, owners: [...g.owners].slice(0, 4), count: g.parcels.length, parcels: g.parcels.map(p => ({ addr: p.addr, use: p.use, lat: p.lat, lon: p.lon, owner: p.owner, zip: p.zip })) }));
    landlordCache = { at: Date.now(), total: all.length, top }; await kv.set('landlords', landlordCache);
    landlordState.msg = '';
  } catch (err) { landlordState.msg = 'County lookup failed: ' + err.message; }
  finally { landlordState.running = false; renderFollow(); }
}
let landlordCache = null;
function landlordsHtml() {
  const d = landlordCache;
  return `<div class="card"><h3>Landlords &amp; property managers</h3>
    <p class="small">Who owns the commercial buildings in your territory, grouped by mailing address (usually the owner's office or their property manager). One manager can open doors to a whole strip center.</p>
    ${landlordState.msg ? `<p class="small">${esc(landlordState.msg)}</p>` : ''}
    ${d ? `<p class="small">${d.total} commercial parcels checked ${fmtWhen(d.at)}. Top ${Math.min(d.top.length, 15)} by number of properties:</p>
      ${d.top.slice(0, 15).map((g, i) => `<div class="item" data-ll-group="${i}" style="padding:10px 0"><span class="pnum" style="background:var(--accent)">${g.count}</span>
        <div class="main"><div class="nm">${esc(g.mgr || g.owners[0])}</div><div class="sub">${esc([g.mail, g.mailCity].filter(Boolean).join(', '))}${g.owners.length > 1 ? ' · ' + g.owners.length + ' owner names' : ''}</div></div></div>`).join('')}` : ''}
    <button class="btn block ${d ? '' : 'primary'}" id="llLoad" ${landlordState.running ? 'disabled' : ''}>${d ? 'Refresh' : 'Find the biggest landlords'}</button></div>`;
}
function showLandlordGroup(i) {
  const g = landlordCache.top[i];
  showModal(`<h3>${esc(g.mgr || g.owners[0])}</h3><p class="small">${esc([g.mail, g.mailCity].filter(Boolean).join(', '))}<br>Owner names: ${g.owners.map(esc).join(', ')}${g.owners.length >= 4 ? '…' : ''}</p>
    <div class="chips"><a class="chip" href="https://www.google.com/search?q=${encodeURIComponent((g.mgr || g.owners[0]) + ' ' + (g.mailCity || 'Arizona'))}" target="_blank" rel="noopener">Google them</a></div>
    <h2 class="sec" style="margin-left:0">${g.count} properties in your territory</h2>
    <div id="lgList">${g.parcels.map((p, k) => { const bz = bizAtParcel(p); return `<div class="item" data-k="${k}" style="padding:10px 0"><div class="main"><div class="nm">${esc(bz ? bz.name : p.addr || 'No street address')}</div><div class="sub">${esc(bz ? p.addr + ' · ' : '')}${esc(p.use)}</div></div><div class="right">${esc(p.zip || '')}</div></div>`; }).join('')}</div>
    <button class="btn block ghost" id="lgClose">Close</button>`);
  $('#lgClose').onclick = hideModal;
  $('#lgList').onclick = e => { const it = e.target.closest('.item'); if (!it) return; const p = g.parcels[+it.dataset.k]; const bz = bizAtParcel(p); hideModal(); if (bz) openBiz(bz.id, { fly: true }); else { switchView('map'); map.setView([p.lat, p.lon], 18); } };
}

// ---------- Bay Alarm customers (imported from a company account export) ----------
// Each site = one business location; it can have several accounts/services.
const SERVICE_KINDS = [
  { k: 'burg', label: 'Burglar alarm', re: /BURG|\bBA\b/i },
  { k: 'fire', label: 'Fire', re: /FIRE|\bFA\b/i },
  { k: 'cctv', label: 'Cameras', re: /CCTV|EBVM|LVM|VIDEO|CAMERA/i },
  { k: 'access', label: 'Access control', re: /ACCESS/i },
];
let custByBiz = new Map();
function reindexCustomers() { custByBiz = new Map(); for (const c of Object.values(state.customers || {})) if (c.bizId) custByBiz.set(c.bizId, c); }
function customerOf(id) { return custByBiz.get(id); }
function custServices(c) { const v = c.services.map(s => s.venue).join(' '); return SERVICE_KINDS.filter(k => k.re.test(v)); }
function custGaps(c) { if (!c.services.some(s => s.venue)) return []; const have = new Set(custServices(c).map(k => k.k)); return SERVICE_KINDS.filter(k => !have.has(k.k)); }
function streetBase(a) {
  // "15396 N 83RD AVE 303" -> "15396 N 83RD AVE"; normalizes spacing and common suffixes
  a = String(a || '').toUpperCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
  a = a.replace(/^(\d+)\s+(NORTH|SOUTH|EAST|WEST)\b/, (m, n, d) => n + ' ' + d[0]);
  a = a.replace(/\b(STE|SUITE|UNIT|BLDG|SPC|SPACE|APT)\b.*$/, '').trim();
  const m = a.match(/^(\d+\s+(?:[NSEW]\s+)?.*?\b(AVE|AVENUE|RD|ROAD|ST|STREET|DR|DRIVE|BLVD|LN|LANE|WAY|PKWY|PKW|PARKWAY|CT|PL|CIR|TRL|HWY|LOOP)\b)/);
  return (m ? m[1] : a).replace(/\bAVENUE\b/, 'AVE').replace(/\bROAD\b/, 'RD').replace(/\bSTREET\b/, 'ST').replace(/\bDRIVE\b/, 'DR').replace(/\bLANE\b/, 'LN').replace(/\b(PARKWAY|PKW)\b/, 'PKWY');
}
const NAME_STOP = new Set(['THE', 'LLC', 'INC', 'CO', 'AND', 'OF', 'AZ', 'ARIZONA', 'CORP', 'CENTER', 'STORE', 'GROUP']);
function nameTokens(n) { return new Set(String(n || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !NAME_STOP.has(w))); }
function nameOverlap(a, b) { const A = nameTokens(a), B = nameTokens(b); let n = 0; for (const w of A) if (B.has(w) || [...B].some(x => x.startsWith(w) || w.startsWith(x))) n++; return n; }
async function importCustomers(file, includeRes) {
  await loadSheetJS();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
  let hi = rows.findIndex(r => r.some(c => /^name$/i.test(String(c).trim())) && r.some(c => /address/i.test(String(c))));
  if (hi < 0) throw new Error('no NAME and ADDRESS columns found');
  const H = rows[hi].map(c => String(c).trim().toLowerCase());
  const col = k => H.findIndex(h => k.test(h));
  const C = { acct: col(/^acct|account/), name: col(/^name$|company/), venue: col(/venue|service|type/), loc: col(/alias|location/), key: col(/^key$|class|segment/), msr: col(/msr|monthly|rmr|amount/), addr: col(/address/), city: col(/city/), zip: col(/zip/) };
  const g = (r, k) => C[k] >= 0 ? String(r[C[k]] || '').trim() : '';
  const myZips = new Set(TERRITORY.features.map(f => f.properties.zip));
  let read = 0, skippedRes = 0, skippedArea = 0;
  const sites = new Map();
  for (const r of rows.slice(hi + 1)) {
    const name = g(r, 'name'), addr = g(r, 'addr'); if (!name || !addr) continue;
    read++;
    const kind = g(r, 'key').toUpperCase();
    if (!includeRes && /^(RES|EMP)$/.test(kind)) { skippedRes++; continue; }
    const zip = g(r, 'zip').slice(0, 5); if (zip && !myZips.has(zip)) { skippedArea++; continue; }
    const base = streetBase(addr);
    // same building + similar name = same site (names are cut off at ~22 characters in the export)
    const key = base + '|' + [...nameTokens(name)].slice(0, 2).join(' ');
    const site = sites.get(key) || { id: 'k' + key.replace(/[^A-Z0-9]/g, '').slice(0, 40), name, addr: base, suites: new Set(), city: g(r, 'city'), zip, kind, services: [] };
    const suite = addr.toUpperCase().replace(/\s+/g, ' ').trim().slice(base.length).trim(); if (suite) site.suites.add(suite);
    const msr = parseFloat(g(r, 'msr').replace(/[^0-9.]/g, '')) || 0;
    site.services.push({ acct: g(r, 'acct'), venue: g(r, 'venue'), msr, ...(g(r, 'loc') ? { loc: g(r, 'loc') } : {}) });
    if (kind === 'KEY' || (kind === 'COM' && site.kind !== 'KEY')) site.kind = kind;
    sites.set(key, site);
  }
  state.customers = state.customers || {};
  let added = 0;
  for (const s of sites.values()) {
    const old = state.customers[s.id];
    state.customers[s.id] = { ...(old || {}), id: s.id, name: s.name, addr: s.addr, suites: [...s.suites], city: s.city, zip: s.zip, kind: s.kind,
      services: s.services, msr: +s.services.reduce((a, x) => a + x.msr, 0).toFixed(2), updatedAt: Date.now() };
    if (!old) added++;
  }
  matchCustomersByAddress();
  state.updatedAt = Date.now(); reindexCustomers(); await commit();
  return { read, sites: sites.size, added, skippedRes, skippedArea };
}
function matchCustomersByAddress() {
  const byBase = new Map();
  for (const b of allBiz()) if (b.addr) { const k = streetBase(b.addr); (byBase.get(k) || byBase.set(k, []).get(k)).push(b); }
  for (const c of Object.values(state.customers || {})) {
    if (c.bizId && bizIndex.has(c.bizId)) continue;
    const cands = byBase.get(c.addr) || [];
    const hit = cands.find(b => nameOverlap(b.name, c.name) > 0) || (cands.length === 1 ? cands[0] : null);
    if (hit) { c.bizId = hit.id; c.lat = hit.lat; c.lon = hit.lon; c.updatedAt = Date.now(); }
  }
}
let custGeocoding = false;
async function placeCustomers(onProgress) {
  if (custGeocoding) return; custGeocoding = true;
  try {
    const todo = Object.values(state.customers || {}).filter(c => !c.bizId && !c.geoFail);
    for (let i = 0; i < todo.length; i++) {
      const c = todo[i]; onProgress && onProgress(`Placing customers on the map (${i + 1} of ${todo.length})…`);
      let hit; try { hit = await geocodeAddress({ addr: c.addr, city: c.city, zip: c.zip }); } catch (e) { break; }
      const cc = state.customers[c.id]; if (!cc) continue;
      if (!hit) { cc.geoFail = true; cc.updatedAt = Date.now(); continue; }
      // a business already on the map nearby with a similar name? link to it. Otherwise add the customer as a business.
      let best = null, bd = 0.06;
      for (const b of allBiz()) { const d = dist(hit.lat, hit.lon, b.lat, b.lon); if (d < bd && nameOverlap(b.name, cc.name) > 0) { bd = d; best = b; } }
      if (best) cc.bizId = best.id;
      else {
        const nid = 'c' + Date.now().toString(36) + i; const z = zipOf(hit.lat, hit.lon);
        state.custom[nid] = { id: nid, name: titleCase(cc.name), cat: 'Other', type: 'Bay Alarm customer', lat: +hit.lat.toFixed(6), lon: +hit.lon.toFixed(6), addr: titleCase(cc.addr), city: titleCase(cc.city || (z ? z.city : '')), zip: cc.zip || (z ? z.zip : ''), phone: '', web: '', hours: '', updatedAt: Date.now() };
        cc.bizId = nid;
      }
      cc.lat = hit.lat; cc.lon = hit.lon; cc.updatedAt = Date.now();
      if (i % 5 === 4) { reindex(); reindexCustomers(); await saveLocal(); drawMarkers(); }
      await new Promise(z => setTimeout(z, 1100));
    }
    state.updatedAt = Date.now(); reindex(); reindexCustomers(); await commit();
  } finally { custGeocoding = false; onProgress && onProgress(''); renderSettingsIfOpen(); }
}
function titleCase(s) { return String(s || '').toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Llc|Inc|Az|Ste|Nw|Ne|Sw|Se)\b/g, m => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, a, b) => a + b.toLowerCase()); }
function custBoxHtml(id) {
  const c = customerOf(id); if (!c) return '';
  const gaps = custGaps(c), billingOnly = !c.msr && c.services.every(s => /BILLING/i.test(s.venue));
  return `<div class="fu-box cust"><div class="lbl" style="display:flex;justify-content:space-between"><span>Bay Alarm customer${c.kind === 'KEY' ? ' · key account' : ''}</span><span>${c.msr ? money(c.msr) + '/mo' : ''}</span></div>
    ${c.services.map(s => `<div class="brow" style="margin:3px 0"><span style="flex:1">${esc([s.venue, s.loc].filter(Boolean).join(' · ') || 'Account')}</span><span class="small">#${esc(s.acct)}</span><span class="n">${s.msr ? '$' + s.msr.toFixed(2) : '–'}</span></div>`).join('')}
    ${c.suites && c.suites.length ? `<div class="small">Suites: ${c.suites.map(esc).join(', ')}</div>` : ''}
    ${billingOnly ? '<p class="small" style="margin:6px 0 0"><b>Billing only, $0 monitoring.</b> Could be a win-back.</p>'
      : !c.services.some(s => s.venue) ? '<p class="small" style="margin:6px 0 0">Which services they have isn\'t in this list. Check the account before pitching.</p>'
      : gaps.length ? `<p class="small" style="margin:6px 0 0">Not on: <b>${gaps.map(k => k.label).join(', ')}</b>. Upsell chance.</p>` : ''}</div>`;
}

// ---------- For Lease signs spotted while driving ----------
let currentLease = null;
const LEASE_COLOR = '#0891b2', SITE_COLOR = '#eab308';
// one marker type for things you spot while driving: kind 'lease' (For Lease sign) or 'site' (construction site)
const SPOT = {
  lease: { title: 'For Lease', pill: 'For lease', color: LEASE_COLOR, letter: 'L', company: 'Management / broker', companyPh: 'CBRE, Vestar…', phone: 'Phone on the sign', snap: 'Snap the sign (fills in phone &amp; company)', notesPh: "Size, which suite, how long it's been empty…", gone: 'Leased / remove', added: 'For Lease marked' },
  site: { title: 'Construction', pill: 'Construction site', color: SITE_COLOR, letter: 'C', company: 'General contractor / builder', companyPh: 'Willmeng, Okland…', phone: 'Phone on the sign', snap: 'Snap the job sign (fills in GC &amp; phone)', notesPh: "What's going in, how far along, who to ask for on site…", gone: 'Finished / remove', added: 'Construction site marked' },
};
const spotKind = l => SPOT[l.kind || 'lease'];
function liveLeases(kind) { return Object.values(state.leases || {}).filter(l => l.status !== 'gone' && (!kind || (l.kind || 'lease') === kind)); }
function addLeaseHere(kind) {
  kind = kind || 'lease';
  const at = me ? { lat: me.lat, lon: me.lon } : (() => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; })();
  const id = 'l' + Date.now().toString(36);
  const z = zipOf(at.lat, at.lon);
  state.leases = state.leases || {};
  state.leases[id] = { id, kind, t: Date.now(), lat: +at.lat.toFixed(6), lon: +at.lon.toFixed(6), zip: z ? z.zip : '', city: z ? z.city : '', addr: '', company: '', phone: '', contact: '', notes: '', status: 'active', updatedAt: Date.now() };
  state.updatedAt = Date.now(); commit();
  switchView('map'); map.setView([at.lat, at.lon], Math.max(map.getZoom(), 17));
  openLease(id);
  toast(SPOT[kind].added + (me ? ' where you are' : ' at the map center (no GPS)'));
  reverseAddress(id);
}
async function reverseAddress(id) {
  const l = state.leases[id]; if (!l || l.addr) return;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${l.lat}&lon=${l.lon}`, { headers: { Accept: 'application/json' } });
    const j = await r.json(); const a = j.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    if (street && state.leases[id]) { state.leases[id].addr = street; state.leases[id].updatedAt = Date.now(); commit(); if (currentLease === id) openLease(id); }
  } catch (e) { /* no address, that's fine */ }
}
function drawLeases() {
  const show = filters.planOnly ? [] : liveLeases().filter(l => (l.kind || 'lease') === 'site' ? filters.sites : filters.leases);
  const ids = new Set(show.map(l => l.id));
  for (const [id, m] of leaseMarkers) if (!ids.has(id)) { map.removeLayer(m); leaseMarkers.delete(id); }
  for (const l of show) {
    const sel = currentLease === l.id;
    let m = leaseMarkers.get(l.id);
    const html = `<div class="lease-pin ${l.kind || 'lease'}${sel ? ' sel' : ''}">${spotKind(l).letter}</div>`;
    if (!m) { m = L.marker([l.lat, l.lon], { icon: L.divIcon({ className: '', html, iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 500 }).addTo(map); m.on('click', () => openLease(l.id)); leaseMarkers.set(l.id, m); }
    else { m.setLatLng([l.lat, l.lon]); m.setIcon(L.divIcon({ className: '', html, iconSize: [24, 24], iconAnchor: [12, 12] })); }
  }
}
const leaseMarkers = new Map();
function openLease(id) {
  const l = state.leases[id]; if (!l) return;
  const K = spotKind(l);
  current = null; currentPermit = null; currentLease = id;
  const nav = 'https://www.google.com/maps/dir/?api=1&destination=' + l.lat + ',' + l.lon;
  const f = (k, label, type, ph) => `<div class="field"><label>${label}</label><input data-lf="${k}" type="${type || 'text'}" value="${esc(l[k] || '')}" placeholder="${ph || ''}"></div>`;
  $('#sheetBody').innerHTML = `<div class="sh-title"><h3>${K.title}${l.addr ? ': ' + esc(l.addr) : ''}</h3><button class="closex" data-lact="close" aria-label="Close">${ICON('x')}</button></div>
   <div class="meta"><span class="pill" style="--c:${K.color}">${K.pill}</span> Spotted ${fmtWhen(l.t)}${l.zip ? ' · ' + esc(l.zip) + ' ' + esc(l.city || '') : ''}</div>
   <div class="actions"><a href="${nav}" target="_blank" rel="noopener">${ICON('nav')}Directions</a>${l.phone ? `<a href="tel:${esc(l.phone.replace(/[^\d+]/g, ''))}">${ICON('phone')}Call</a>` : ''}<a href="https://www.google.com/search?q=${encodeURIComponent((l.company || (l.kind === 'site' ? 'construction' : 'for lease')) + ' ' + (l.addr || '') + ' ' + (l.city || 'AZ'))}" target="_blank" rel="noopener">${ICON('search')}Google</a></div>
   <label class="btn block primary">${ICON('camera')}${K.snap}<input type="file" accept="image/*" data-leasesign hidden></label>
   <div id="leaseMsg" class="small"></div>
   ${l.thumb ? `<img src="${l.thumb}" style="width:100%;border-radius:10px;margin:6px 0" alt="Sign photo">` : ''}
   ${l.kind === 'site' ? f('project', "What's being built", 'text', 'New retail building, medical office…') : ''}
   <div class="two">${f('phone', K.phone, 'tel', '(602) 555-1234')}${f('company', K.company, 'text', K.companyPh)}</div>
   ${f('contact', 'Contact name')}${f('addr', 'Address', 'text', 'Street address')}
   <div class="field"><label>Notes</label><textarea data-lf="notes" placeholder="${K.notesPh}">${esc(l.notes || '')}</textarea></div>
   <button class="btn block" data-lact="owner">Who owns this property?</button>
   ${l.parcel ? `<div class="fu-box owner"><div class="lbl">Property owner</div><div>${esc(l.parcel.owner)}</div>${managerOf(l.parcel) ? `<div><b>Managed by:</b> ${esc(managerOf(l.parcel))}</div>` : ''}<div class="small">${esc([l.parcel.mail, l.parcel.mailCity].filter(Boolean).join(', '))}</div></div>` : ''}
   <div class="two" style="margin-top:10px"><button class="btn" data-lact="move">Move pin</button><button class="btn danger" data-lact="gone">${K.gone}</button></div>
   <p class="small">Tip: mark it with one tap while driving, fill in the rest when you're parked.</p>`;
  $('#sheet').classList.remove('hidden'); drawMarkers();
}
async function readLeaseSign(id, file) {
  const msg = $('#leaseMsg'); if (msg) msg.textContent = 'Reading the sign…';
  try {
    const res = await CardScan.read(file, m => { const el = $('#leaseMsg'); if (el) el.textContent = m; });
    const lines = res.lines.filter(x => !/\b(for\s+lease|for\s+sale|available|now\s+leasing|lease|retail|office|space|sq\.?\s*ft|sf|coming\s+soon|future\s+home|general\s+contractor|contractor|architect|construction|site|hard\s+hat|ppe|no\s+trespassing|permit)\b/i.test(x.text) || /\d{3}\D?\d{3}\D?\d{4}/.test(x.text));
    const p = CardScan.parse(lines, '');
    const l = state.leases[id]; if (!l) return;
    if (!l.phone) l.phone = p.phone || p.cell || '';
    if (!l.company) l.company = (p.company || '').replace(/[^\w&.,'\- ]/g, '').trim();
    if (!l.contact && p.name) l.contact = p.name;
    if (p.web && !l.notes) l.notes = p.web;
    l.thumb = await shrinkPhoto(file, 700, 0.7); l.updatedAt = state.updatedAt = Date.now();
    await commit(); openLease(id);
    toast(l.phone || l.company ? 'Got it. Check the phone and company.' : "Couldn't read much. Type it in.");
  } catch (err) { if ($('#leaseMsg')) $('#leaseMsg').textContent = 'Could not read the sign: ' + err.message; }
}
$('#sheet').addEventListener('click', async e => {
  const t = e.target.closest('[data-lact]'); if (!t || !currentLease) return;
  const id = currentLease, l = state.leases[id];
  if (t.dataset.lact === 'close') { currentLease = null; $('#sheet').classList.add('hidden'); drawMarkers(); }
  if (t.dataset.lact === 'gone') { l.status = 'gone'; l.updatedAt = state.updatedAt = Date.now(); currentLease = null; $('#sheet').classList.add('hidden'); commit(); toast('Removed'); }
  if (t.dataset.lact === 'move') { currentLease = null; $('#sheet').classList.add('hidden'); startPlace('lease:' + id); }
  if (t.dataset.lact === 'owner') {
    toast('Checking county records…');
    try {
      const j = await parcelQuery({ where: '1=1', geometry: `${l.lon},${l.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: '30', units: 'esriSRUnit_Meter', resultRecordCount: '5' });
      const ps = (j.features || []).map(f => cleanParcel(f.attributes));
      if (!ps.length) { toast('No parcel found here. Move the pin onto the building.'); return; }
      ps.sort((x, y) => dist(l.lat, l.lon, x.lat, x.lon) - dist(l.lat, l.lon, y.lat, y.lon));
      l.parcel = ps[0]; if (!l.addr && ps[0].addr) l.addr = ps[0].addr; l.updatedAt = state.updatedAt = Date.now(); commit(); openLease(id);
    } catch (err) { toast('County lookup failed: ' + err.message); }
  }
});
$('#sheet').addEventListener('change', e => {
  const el = e.target; if (!currentLease) return;
  const l = state.leases[currentLease]; if (!l) return;
  if (el.dataset.leasesign !== undefined && el.files && el.files[0]) { const f = el.files[0]; el.value = ''; readLeaseSign(currentLease, f); return; }
  if (el.dataset.lf) { l[el.dataset.lf] = el.value.trim(); l.updatedAt = state.updatedAt = Date.now(); commit(); }
});
function leasesHtml() {
  const block = (kind, heading) => {
    const list = liveLeases(kind).sort((a, b) => b.t - a.t);
    if (!list.length) return '';
    return `<h2 class="sec">${heading} (${list.length})</h2>` + list.map(l => `<div class="item" data-lease="${l.id}"><span class="pin" style="background:${SPOT[kind].color};border-radius:3px"></span>
      <div class="main"><div class="nm">${esc((kind === 'site' && l.project) || l.addr || SPOT[kind].pill)}</div><div class="sub">${esc([kind === 'site' && l.project ? l.addr : '', l.company, l.phone].filter(Boolean).join(' · ') || 'No phone or company yet')}</div></div>
      <div class="right">${new Date(l.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div></div>`).join('');
  };
  const gone = Object.values(state.leases || {}).filter(l => l.status === 'gone').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return block('site', 'Construction sites') + block('lease', 'For lease') + (gone.length ? `<details class="gonebox"><summary>Removed pins (${gone.length})</summary>${gone.map(l => `<div class="item"><span class="pin" style="background:${SPOT[l.kind || 'lease'].color};border-radius:3px;opacity:.5"></span><div class="main"><div class="nm">${esc((l.kind === 'site' && l.project) || l.addr || SPOT[l.kind || 'lease'].pill)}</div><div class="sub">${SPOT[l.kind || 'lease'].pill} · removed ${new Date(l.updatedAt || l.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div></div><button class="chip" data-unlease="${l.id}">Bring back</button></div>`).join('')}</details>` : '');
}
function chooseAdd() {
  showModal(`<h3>Add to the map</h3>
   <button class="btn block primary" id="addLease" style="justify-content:flex-start;padding:14px">For Lease sign here<span class="small" style="color:#fff;opacity:.85;margin-left:auto">one tap</span></button>
   <button class="btn block primary" id="addSite" style="justify-content:flex-start;padding:14px;background:#1c1c1e;border-color:#1c1c1e">Construction site here<span class="small" style="color:#fff;opacity:.85;margin-left:auto">one tap</span></button>
   <button class="btn block" id="addBiz" style="justify-content:flex-start;padding:14px">A business that's missing</button>
   <button class="btn block ghost" id="addCancel">Cancel</button>`);
  $('#addLease').onclick = () => { hideModal(); addLeaseHere('lease'); };
  $('#addSite').onclick = () => { hideModal(); addLeaseHere('site'); };
  $('#addBiz').onclick = () => { hideModal(); startPlace(null); };
  $('#addCancel').onclick = hideModal;
}
