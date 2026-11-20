/* Knock Map: The map, pins, GPS and filters */
'use strict';

// ---------- map ----------
let map, renderer, markers = new Map(), meMarker, meCircle, zipLayer, baseStreet, baseSat, followMe = false;
function renderLegend() {
  const el = $('#legend'); if (!el) return;
  const open = settings.legendOpen !== false;
  el.innerHTML = open ? `<button class="lg-x" id="lgToggle" aria-label="Hide key">Key ▾</button>${STATUSES.map(s => `<div><i style="background:${s.color}${s.k === 'quote' ? ';border:2px solid #fff;box-shadow:0 0 0 1px ' + s.color : ''}"></i>${s.label}</div>`).join('')}<div><i style="background:#f97316;border:2px solid #fff;box-shadow:0 0 0 1px #f97316"></i>Permit</div><div><i style="background:#ef5b5f;opacity:.3"></i>Cooling off</div><div><i style="background:#fff;border:2px solid #ee2e24"></i>Bay Alarm customer</div><div><i style="background:#0891b2;border-radius:3px"></i>For lease</div><div><i style="background:#eab308;border-radius:3px"></i>Construction site</div>` : '<button class="lg-x" id="lgToggle">Key ▸</button>';
  $('#lgToggle').onclick = () => { settings.legendOpen = !open; saveLocalSoon(); renderLegend(); };
}
function initMap() {
  map = L.map('map', { zoomControl: false, preferCanvas: true, tap: true });
  renderer = L.canvas({ padding: 0.5, tolerance: 8 });
  baseStreet = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  baseSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' });
  zipLayer = L.geoJSON(TERRITORY, {
    style: { color: '#1d4ed8', weight: 2, fill: true, fillOpacity: 0.03, dashArray: '6 5' }, interactive: false,
    onEachFeature: (f, l) => l.bindTooltip(f.properties.zip, { permanent: true, direction: 'center', className: 'ziplabel' }),
  }).addTo(map);
  const saved = settings.view;
  if (saved) map.setView([saved.lat, saved.lon], saved.z); else map.fitBounds(zipLayer.getBounds());
  map.on('moveend', () => { const c = map.getCenter(); settings.view = { lat: c.lat, lon: c.lng, z: map.getZoom() }; saveLocalSoon(); updateMapStats(); });
  map.on('dragstart', () => { if (followMe) { followMe = false; $('#locateBtn').classList.remove('on'); } });
  map.on('zoomend', drawMarkers);
  map.on('moveend', updateLabels);
  map.on('moveend', renderAreaBtn);
  const ab = $('#areaBtn'); if (ab) ab.onclick = showAreas; renderAreaBtn();
}
// ---------- areas (groups of zips hours apart: West Valley, Bullhead City, Kingman…) ----------
const AREAS = [...new Set(TERRITORY.features.map(f => f.properties.area).filter(Boolean))];
const areaZips = a => TERRITORY.features.filter(f => f.properties.area === a);
const areaBounds = a => L.geoJSON({ type: 'FeatureCollection', features: areaZips(a) }).getBounds();
const zipArea = {}; TERRITORY.features.forEach(f => { zipArea[f.properties.zip] = f.properties.area; });
function currentArea() {
  if (!map) return ''; const c = map.getCenter(); let best = '', bd = Infinity;
  for (const a of AREAS) { const b = areaBounds(a); if (b.contains(c)) return a; const d = c.distanceTo(b.getCenter()); if (d < bd) { bd = d; best = a; } }
  return map.getZoom() >= 9 ? best : '';
}
function renderAreaBtn() {
  const el = $('#areaBtn'); if (!el) return;
  if (AREAS.length < 2) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden'); el.innerHTML = `${ICON('locate')}<span>${esc(currentArea() || 'All areas')}</span> ▾`;
}
function showAreas() {
  const stats = {}; AREAS.forEach(a => { stats[a] = { biz: 0, visited: 0, last: 0 }; });
  for (const b of allBiz()) { const a = zipArea[b.zip]; if (!a) continue; stats[a].biz++; const r = state.records[b.id]; const v = r && r.visits && r.visits.length ? r.visits[r.visits.length - 1].t : 0; if (v) { stats[a].visited++; stats[a].last = Math.max(stats[a].last, v); } }
  const ago = t => { if (!t) return 'not worked yet'; const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'worked today' : d === 1 ? 'worked yesterday' : 'last worked ' + d + ' days ago'; };
  const cur = currentArea();
  showModal(`<h3>Jump to an area</h3>
    ${AREAS.map(a => { const s = stats[a], zs = areaZips(a); return `<button class="futrow" data-area="${esc(a)}" style="${a === cur ? 'border-color:var(--accent)' : ''}"><span style="flex:1;text-align:left"><b>${esc(a)}</b><br><span class="small">${zs.map(f => f.properties.zip).join(', ')}</span></span><span class="small" style="text-align:right">${s.biz ? s.biz + ' businesses · ' + s.visited + ' visited' : '<span style="color:var(--danger)">not loaded yet</span>'}<br>${ago(s.last)}</span></button>`; }).join('')}
    <button class="btn block" data-area="*" style="margin-top:10px">Show the whole territory</button>
    <button class="btn block ghost" id="areaCancel">Close</button>`);
  $('#areaCancel').onclick = hideModal;
  $('#modalBody').querySelectorAll('[data-area]').forEach(b => b.onclick = () => { hideModal(); switchView('map'); map.fitBounds(b.dataset.area === '*' ? zipLayer.getBounds() : areaBounds(b.dataset.area), { padding: [20, 20] }); });
}

let slt; function saveLocalSoon() { clearTimeout(slt); slt = setTimeout(saveLocal, 800); }
function radiusForZoom() { const z = map.getZoom(); return z >= 17 ? 9 : z >= 15 ? 7 : z >= 13 ? 5 : 3.5; }
function drawMarkers() {
  const list = filtered();
  const ids = new Set(list.map(b => b.id));
  for (const [id, m] of markers) if (!ids.has(id)) { map.removeLayer(m); markers.delete(id); }
  const r = radiusForZoom(); const hotPins = [];
  for (const b of list) {
    const st = statusOf(b.id), col = S[st].color;
    const cool = inCooldown(b.id);
    const cust = custByBiz.has(b.id);
    const hot = st === 'quote'; // quotes to build stand out like permits
    const style = { radius: id_is(b.id) ? r + 5 : hot ? r + 3 : cust ? r + 1 : r, fillColor: cust && st === 'new' ? '#ffffff' : col, color: id_is(b.id) ? '#0f172a' : hot ? '#fff' : cust ? '#ee2e24' : cool ? 'rgba(15,23,42,.2)' : 'rgba(15,23,42,.55)', weight: id_is(b.id) ? 3 : hot ? 3 : cust ? 3 : 1, fillOpacity: cool ? 0.25 : hot ? 1 : 0.95, renderer };
    let m = markers.get(b.id);
    if (!m) { m = L.circleMarker([b.lat, b.lon], style).addTo(map); m.on('click', () => openBiz(b.id)); markers.set(b.id, m); }
    else { m.setStyle(style); m.setRadius(style.radius); m.setLatLng([b.lat, b.lon]); }
    if (hot) hotPins.push(m);
  }
  hotPins.forEach(m => m.bringToFront());
  drawPermits();
  drawLeases();
  labeled.forEach(id => { if (!markers.has(id)) labeled.delete(id); });
  updateLabels();
  updateMapStats();
}
function id_is(id) { return current === id; }
// Business names next to the pins once you're zoomed in close (only for what's on screen, so it stays fast)
let labeled = new Set();
function updateLabels() {
  if (!map) return;
  const on = map.getZoom() >= 17, bounds = map.getBounds().pad(0.1), want = new Set();
  if (on) {
    // skip names that would overlap one already placed, so dense strip centers stay readable
    const boxes = [];
    const cand = [...markers].filter(([, m]) => bounds.contains(m.getLatLng())).map(([id, m]) => ({ id, pt: map.latLngToContainerPoint(m.getLatLng()) }))
      .sort((x, y) => (x.id === current ? -1 : y.id === current ? 1 : (statusOf(y.id) !== 'new') - (statusOf(x.id) !== 'new')));
    for (const c of cand) {
      const b = bizIndex.get(c.id); if (!b) continue;
      const w = Math.min(26, b.name.length) * 6.2 + 14, box = { x: c.pt.x + 6, y: c.pt.y - 9, w, h: 18 };
      if (boxes.some(o => box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h)) continue;
      boxes.push(box); want.add(c.id);
    }
  }
  for (const id of labeled) if (!want.has(id)) { const m = markers.get(id); if (m) m.unbindTooltip(); labeled.delete(id); }
  for (const id of want) {
    if (labeled.has(id)) continue;
    const b = bizIndex.get(id); if (!b) continue;
    markers.get(id).bindTooltip(esc(b.name.length > 26 ? b.name.slice(0, 25) + '…' : b.name), { permanent: true, direction: 'right', offset: [8, 0], className: 'pinlabel' + (inCooldown(id) ? ' faded' : '') });
    labeled.add(id);
  }
}
function updateMapStats() {
  if (!map) return;
  const bounds = map.getBounds(); let n = 0, v = 0;
  for (const b of filtered()) if (bounds.contains([b.lat, b.lon])) { n++; if (statusOf(b.id) !== 'new') v++; }
  $('#mapStats').textContent = BIZ.length || Object.keys(state.custom).length ? (filters.planOnly ? `Today's plan: ${n} stops · ${v} visited` : `${n} in view · ${v} visited`) : 'No businesses loaded yet. Open Settings to load them.';
}

// ---------- GPS ----------
let gotFirstFix = false;
function startGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(p => {
    me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
    const ll = [me.lat, me.lon];
    if (!meMarker) {
      meCircle = L.circle(ll, { radius: me.acc, color: '#2563eb', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll); meCircle.setRadius(me.acc); }
    if (followMe) map.panTo(ll);
    if (!gotFirstFix) { gotFirstFix = true; if (zipOf(me.lat, me.lon) && $('#view-map').classList.contains('active') && !current) map.setView(ll, Math.max(map.getZoom(), 16)); }
    if ($('#view-list').classList.contains('active') && $('#sortSel').value === 'dist') throttleList();
  }, err => { if (err.code === 1) toast('Location is blocked. Allow location for this site in your browser settings.'); }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
}
let tl; function throttleList() { if (tl) return; tl = setTimeout(() => { tl = null; renderList(); }, 5000); }

// ---------- filtering ----------
function filtered() {
  const q = filters.q.trim().toLowerCase();
  const plan = filters.planOnly && state.plan ? new Set(state.plan.ids) : null;
  return allBiz().filter(b => {
    if (plan && !plan.has(b.id)) return false;
    if (!filters.customers && custByBiz.has(b.id)) return false;
    if (filters.statuses.size && !filters.statuses.has(statusOf(b.id))) return false;
    if (filters.cats.size && !filters.cats.has(b.cat)) return false;
    if (filters.zips.size && !filters.zips.has(b.zip)) return false;
    if (q) {
      const r = rec(b.id);
      const hay = (b.name + ' ' + (b.origName || '') + ' ' + (b.addr || '') + ' ' + (b.type || '') + ' ' + (r ? [r.dm, r.notes, r.provider].join(' ') : '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function filterActive() { return filters.statuses.size || filters.cats.size || filters.zips.size || filters.planOnly || !filters.permits || !filters.customers || !filters.leases || !filters.sites; }
