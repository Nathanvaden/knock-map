/* Knock Map — prospecting tracker for Nathan's Bay Alarm territory */
(function () {
'use strict';

// ---------- constants ----------
const STATUSES = [
  { k: 'new',        label: 'Not visited',     color: '#a3acb8' },
  { k: 'closed',     label: 'Closed / nobody', color: '#d6c29a' },
  { k: 'booted',     label: 'Booted',          color: '#ef5b5f' },
  { k: 'gatekeeper', label: 'Gatekeeper',      color: '#f7a531' },
  { k: 'dm',         label: 'Talked to DM',    color: '#f2df4b' },
  { k: 'followup',   label: 'Follow-up',       color: '#4b8ff7' },
  { k: 'appt',       label: 'Appt set',        color: '#9b6cf6' },
  { k: 'sold',       label: 'Sold',            color: '#22b357' },
  { k: 'dead',       label: 'Not a fit',       color: '#475569' },
];
const S = Object.fromEntries(STATUSES.map(s => [s.k, s]));
const CONVO = new Set(['dm', 'followup', 'appt', 'sold']); // reached a decision maker
const CATS = ['Retail', 'Food & Drink', 'Auto', 'Medical', 'Office', 'Finance', 'Industrial / Trades',
  'Lodging', 'Fitness / Rec', 'Senior / Care', 'School / Childcare', 'Church', 'Storage', 'Other'];
const PROVIDERS = ['None', 'Unknown', 'ADT', 'Brinks', 'Vivint', 'Pye-Barker', 'Johnson Controls / Tyco',
  'Guardian', 'SimpliSafe', 'Ring', 'Verkada', 'Local company', 'Self-monitored'];
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const DATA_FILE = 'data.json';

// ---------- tiny IndexedDB key-value ----------
const kv = (() => {
  let dbp;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('knockmap', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  return {
    async get(k) { const d = await db(); return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
    async set(k, v) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  };
})();

// ---------- state ----------
let BIZ = [];                 // businesses from OpenStreetMap
let bizFetchedAt = 0;
let state = blankState();     // synced data (your knocks)
let settings = {};            // local only (token etc.)
let me = null;                // {lat, lon, acc}
let current = null;           // id of business open in sheet
let filters = { statuses: new Set(), cats: new Set(), zips: new Set(), q: '' };
let lastUndo = null;
let dirty = false;

function blankState() { return { v: 1, records: {}, custom: {}, hidden: {}, fields: [], updatedAt: 0 }; }

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => ymd(new Date());
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
function fmtDate(s) { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: (y !== new Date().getFullYear() ? 'numeric' : undefined) }); }
function fmtWhen(t) {
  const d = new Date(t), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (ymd(d) === ymd(now)) return 'Today ' + time;
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (ymd(d) === ymd(y)) return 'Yesterday ' + time;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + time;
}
function dist(a, b, c, d) { const R = 3958.8, r = Math.PI / 180; const x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return Math.sqrt(x * x + y * y) * R; }
function fmtMi(m) { return m < 0.1 ? Math.round(m * 5280) + ' ft' : m.toFixed(1) + ' mi'; }

// ---------- business helpers ----------
function allBiz() {
  const out = [];
  for (const b of BIZ) if (!state.hidden[b.id]) out.push(b);
  for (const id in state.custom) if (!state.hidden[id]) out.push(state.custom[id]);
  return out;
}
let bizIndex = new Map();
function reindex() { bizIndex = new Map(allBiz().map(b => [b.id, b])); }
function rec(id) { return state.records[id]; }
function statusOf(id) { const r = rec(id); return (r && r.status) || 'new'; }
function touch(id) {
  if (!state.records[id]) state.records[id] = { visits: [] };
  const r = state.records[id]; r.updatedAt = Date.now(); state.updatedAt = r.updatedAt; return r;
}

// ---------- territory ----------
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function inPoly(x, y, coords) { if (!pointInRing(x, y, coords[0])) return false; for (let i = 1; i < coords.length; i++) if (pointInRing(x, y, coords[i])) return false; return true; }
function zipOf(lat, lon) {
  for (const f of TERRITORY.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys) if (inPoly(lon, lat, p)) return f.properties;
  }
  return null;
}
function territoryBBox() {
  let s = 90, w = 180, n = -90, e = -180;
  for (const f of TERRITORY.features) {
    const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys) for (const [x, y] of p[0]) { if (y < s) s = y; if (y > n) n = y; if (x < w) w = x; if (x > e) e = x; }
  }
  return [s, w, n, e];
}

// ---------- OpenStreetMap pull ----------
const SKIP_AMENITY = new Set(['parking', 'parking_space', 'parking_entrance', 'bench', 'toilets', 'waste_basket', 'waste_disposal', 'atm', 'bicycle_parking', 'drinking_water', 'fountain', 'shelter', 'post_box', 'vending_machine', 'charging_station', 'telephone', 'recycling', 'bbq', 'clock', 'compressed_air', 'fire_station', 'police', 'townhall', 'courthouse', 'post_office', 'library', 'grave_yard', 'water_point', 'hunting_stand', 'loading_dock', 'motorcycle_parking', 'letter_box', 'dog_park', 'picnic_table', 'bus_station', 'ferry_terminal', 'taxi', 'public_bookcase', 'give_box', 'mailroom', 'device_charging_station', 'smoking_area', 'watering_place', 'emergency_phone', 'swimming_pool', 'trolley_bay', 'ranger_station', 'sanitary_dump_station', 'polling_station', 'prison']);
function catOf(t) {
  const a = t.amenity, sh = t.shop;
  if (['car', 'car_repair', 'tyres', 'car_parts', 'motorcycle', 'auto_body'].includes(sh) || ['car_wash', 'fuel', 'car_rental', 'vehicle_inspection'].includes(a)) return 'Auto';
  if (sh === 'storage_rental' || a === 'storage_rental' || t.building === 'storage') return 'Storage';
  if (t.healthcare || ['clinic', 'doctors', 'dentist', 'pharmacy', 'hospital', 'veterinary'].includes(a) || ['optician', 'medical_supply', 'hearing_aids'].includes(sh)) return 'Medical';
  if (['social_facility', 'nursing_home', 'retirement_home'].includes(a) || t.social_facility) return 'Senior / Care';
  if (['restaurant', 'fast_food', 'cafe', 'bar', 'pub', 'ice_cream', 'food_court', 'biergarten', 'nightclub'].includes(a)) return 'Food & Drink';
  if (['bank', 'bureau_de_change', 'money_transfer', 'payment_centre'].includes(a) || ['financial', 'insurance', 'tax_advisor', 'accountant'].includes(t.office)) return 'Finance';
  if (['school', 'kindergarten', 'childcare', 'college', 'university', 'driving_school', 'language_school', 'music_school', 'prep_school', 'training'].includes(a)) return 'School / Childcare';
  if (a === 'place_of_worship') return 'Church';
  if (t.tourism) return 'Lodging';
  if (t.leisure || ['gym', 'cinema', 'theatre', 'arts_centre', 'events_venue', 'casino', 'community_centre', 'social_centre', 'conference_centre'].includes(a)) return 'Fitness / Rec';
  if (t.craft || t.industrial || t.man_made === 'works' || ['industrial', 'warehouse'].includes(t.building) || ['trade', 'wholesale', 'doityourself', 'hardware', 'building_materials'].includes(sh)) return 'Industrial / Trades';
  if (t.office) return 'Office';
  if (sh) return 'Retail';
  return 'Other';
}
function typeLabel(t) {
  const v = t.shop || t.amenity || t.office || t.healthcare || t.craft || t.tourism || t.leisure || t.industrial || t.building || '';
  return v && v !== 'yes' ? v.replace(/_/g, ' ') : '';
}
function zipBBox(f) {
  let s = 90, w = 180, n = -90, e = -180;
  const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const p of polys) for (const [x, y] of p[0]) { if (y < s) s = y; if (y > n) n = y; if (x < w) w = x; if (x > e) e = x; }
  return [s, w, n, e].map(v => +v.toFixed(5));
}
function osmQuery([s, w, n, e]) {
  const bb = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:90];(
nwr["name"]["shop"]${bb};nwr["name"]["office"]${bb};nwr["name"]["craft"]${bb};nwr["name"]["healthcare"]${bb};
nwr["name"]["amenity"]${bb};nwr["name"]["tourism"~"hotel|motel|guest_house|hostel"]${bb};
nwr["name"]["leisure"~"fitness_centre|sports_centre|golf_course|bowling_alley|water_park|marina|amusement_arcade|dance|trampoline_park|horse_riding"]${bb};
nwr["name"]["industrial"]${bb};nwr["name"]["man_made"="works"]${bb};
nwr["name"]["building"~"^(commercial|industrial|warehouse|retail|office|hotel|storage)$"]${bb};
);out center tags;`;
}
async function overpass(q) {
  let lastErr;
  for (const url of OVERPASS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 90000);
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
        if (r.status === 429 || r.status === 504) { lastErr = new Error('server busy (' + r.status + ')'); await new Promise(z => setTimeout(z, 5000)); continue; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (j.remark && /error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark.slice(0, 80));
        return j.elements || [];
      } catch (err) { lastErr = err.name === 'AbortError' ? new Error('server took too long') : err; break; }
      finally { clearTimeout(timer); }
    }
  }
  throw lastErr || new Error('No response');
}
function toBiz(els, zip) {
  const out = [];
  for (const el of els) {
    const t = el.tags || {};
    if (!t.name) continue;
    if (t.amenity && SKIP_AMENITY.has(t.amenity) && !t.shop && !t.office) continue;
    if (t.disused || t['disused:shop'] || t.abandoned) continue;
    const lat = el.lat != null ? el.lat : el.center && el.center.lat;
    const lon = el.lon != null ? el.lon : el.center && el.center.lon;
    if (lat == null) continue;
    const z = zipOf(lat, lon);
    if (!z || z.zip !== zip) continue; // each business belongs to exactly one zip
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    out.push({
      id: el.type[0] + el.id, name: t.name, cat: catOf(t), type: typeLabel(t), lat: +lat.toFixed(6), lon: +lon.toFixed(6),
      addr: street, city: t['addr:city'] || z.city, zip: z.zip,
      phone: t.phone || t['contact:phone'] || '', web: t.website || t['contact:website'] || '',
      hours: t.opening_hours || '', brand: t.brand || '',
    });
  }
  // de-duplicate (same name within ~80 m, e.g. a building and the shop inside it)
  out.sort((a, b) => (b.addr ? 1 : 0) - (a.addr ? 1 : 0) || (a.id[0] === 'n' ? -1 : 1));
  const kept = [], seen = new Map();
  for (const b of out) {
    const key = b.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const list = seen.get(key) || [];
    if (list.some(o => dist(o.lat, o.lon, b.lat, b.lon) < 0.05)) continue;
    list.push(b); seen.set(key, list); kept.push(b);
  }
  return kept;
}
// Loads one zip at a time and saves after each one, so a dropped connection never loses progress.
let bizZips = {};            // zip -> time it was last loaded
let loadStatus = { running: false, msg: '', err: false };
function zipsLeft() { return TERRITORY.features.filter(f => !bizZips[f.properties.zip]).length; }
function setLoadMsg(msg, err) { loadStatus.msg = msg; loadStatus.err = !!err; const el = $('#loadMsg'); if (el) { el.textContent = msg; el.style.color = err ? '#e5484d' : ''; } }
async function loadBusinesses(refreshAll_) {
  if (loadStatus.running) return;
  loadStatus.running = true; renderSettingsIfOpen();
  let wake = null; try { wake = await navigator.wakeLock.request('screen'); } catch (e) {}
  const feats = TERRITORY.features.filter(f => refreshAll_ || !bizZips[f.properties.zip]);
  let added = 0;
  try {
    for (let i = 0; i < feats.length; i++) {
      const zp = feats[i].properties;
      setLoadMsg(`Loading ${zp.zip} ${zp.city} (${i + 1} of ${feats.length})… ${BIZ.length} businesses so far`);
      let els;
      try { els = await overpass(osmQuery(zipBBox(feats[i]))); }
      catch (err) { await new Promise(z => setTimeout(z, 8000)); els = await overpass(osmQuery(zipBBox(feats[i]))); }
      const fresh = toBiz(els, zp.zip);
      const freshIds = new Set(fresh.map(b => b.id));
      // keep businesses you've worked even if they dropped off OpenStreetMap
      const keep = BIZ.filter(b => b.zip === zp.zip && !freshIds.has(b.id) && state.records[b.id] && (state.records[b.id].visits || []).length);
      BIZ = BIZ.filter(b => b.zip !== zp.zip).concat(fresh, keep);
      added += fresh.length; bizZips[zp.zip] = Date.now(); bizFetchedAt = Date.now();
      applyMoves();
      await kv.set('biz', BIZ); await kv.set('bizZips', bizZips); await kv.set('bizAt', bizFetchedAt);
      reindex(); drawMarkers();
    }
    setLoadMsg(`Done. ${BIZ.length} businesses on your map. Check the Map tab.`);
    pushBizList();
    toast('Businesses loaded');
  } catch (err) {
    const left = zipsLeft();
    setLoadMsg(`Stopped: ${err.message}. Everything loaded so far is saved. Tap the button to pick up the ${left} zip${left === 1 ? '' : 's'} left.`, true);
  } finally {
    loadStatus.running = false; try { wake && wake.release(); } catch (e) {}
    reindex(); refreshAll(); renderSettingsIfOpen();
  }
}
function renderSettingsIfOpen() { if ($('#view-settings').classList.contains('active')) renderSettings(); }

// ---------- GitHub sync ----------
function syncReady() { return settings.token && settings.owner && settings.repo; }
function b64ToUtf8(b64) { const bin = atob(b64.replace(/\n/g, '')); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); return new TextDecoder().decode(bytes); }
function utf8ToB64(str) { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
async function gh(path, opts = {}) {
  const r = await fetch('https://api.github.com/repos/' + settings.owner + '/' + settings.repo + '/contents/' + path, {
    ...opts, headers: { Authorization: 'Bearer ' + settings.token, Accept: 'application/vnd.github+json', ...(opts.headers || {}) }, cache: 'no-store',
  });
  return r;
}
async function pullRemote() {
  const r = await gh(DATA_FILE);
  if (r.status === 404) return { sha: null, data: null };
  if (!r.ok) throw new Error('GitHub ' + r.status + (r.status === 401 ? ' (token wrong or expired)' : ''));
  const j = await r.json();
  let text;
  if (j.content) text = b64ToUtf8(j.content);
  else { const raw = await gh(DATA_FILE, { headers: { Accept: 'application/vnd.github.raw+json' } }); text = await raw.text(); }
  return { sha: j.sha, data: JSON.parse(text) };
}
// The business list is shared through the data repo too, so a second device doesn't have to pull from OpenStreetMap.
async function pushBizList() {
  if (!syncReady() || !BIZ.length) return;
  try {
    let sha = null; const h = await gh('businesses.json'); if (h.ok) sha = (await h.json()).sha;
    const content = utf8ToB64(JSON.stringify({ at: bizFetchedAt, zips: bizZips, biz: BIZ }));
    await gh('businesses.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Business list', content, ...(sha ? { sha } : {}) }) });
  } catch (e) { console.warn('business list upload failed', e); }
}
async function pullBizList(force) {
  if (!syncReady() || (BIZ.length && !force)) return false;
  try {
    const r = await gh('businesses.json', { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!r.ok) return false;
    const j = await r.json(); if (!j.biz || !j.biz.length) return false;
    BIZ = j.biz; bizZips = j.zips || {}; bizFetchedAt = j.at || Date.now();
    applyMoves(); await kv.set('biz', BIZ); await kv.set('bizZips', bizZips); await kv.set('bizAt', bizFetchedAt);
    reindex(); refreshAll(); renderSettingsIfOpen(); toast(BIZ.length + ' businesses copied from your other device');
    return true;
  } catch (e) { return false; }
}
function mergeInto(local, remote) {
  if (!remote) return local;
  const m = blankState();
  for (const key of ['records', 'custom']) {
    const ids = new Set([...Object.keys(local[key] || {}), ...Object.keys(remote[key] || {})]);
    for (const id of ids) {
      const a = (local[key] || {})[id], b = (remote[key] || {})[id];
      m[key][id] = !a ? b : !b ? a : ((a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b);
    }
  }
  m.hidden = { ...(remote.hidden || {}), ...(local.hidden || {}) };
  for (const id in m.hidden) if (m.hidden[id] === false) delete m.hidden[id];
  m.fields = (local.fieldsAt || 0) >= (remote.fieldsAt || 0) ? (local.fields || []) : (remote.fields || []);
  m.fieldsAt = Math.max(local.fieldsAt || 0, remote.fieldsAt || 0);
  m.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  return m;
}
let syncing = false, syncAgain = false;
async function sync(manual) {
  if (!syncReady()) { setBadge('off'); return; }
  if (syncing) { syncAgain = true; return; }
  syncing = true; setBadge('busy');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { sha, data } = await pullRemote();
      state = mergeInto(state, data);
      const body = JSON.stringify({ message: 'Knock log ' + new Date().toISOString(), content: utf8ToB64(JSON.stringify(state)), ...(sha ? { sha } : {}) });
      const r = await gh(DATA_FILE, { method: 'PUT', body, headers: { 'Content-Type': 'application/json' } });
      if (r.ok) { dirty = false; settings.lastSync = Date.now(); await saveLocal(); setBadge('ok'); if (manual) toast('Synced'); uploadPendingPhotos(); if (!BIZ.length) pullBizList(); else if (!settings.bizPushed) { settings.bizPushed = true; pushBizList(); } break; }
      if (r.status !== 409 && r.status !== 422) throw new Error('GitHub ' + r.status);
    }
    reindex(); refreshAll();
  } catch (err) {
    setBadge('err'); settings.lastSyncErr = String(err.message || err); if (manual) toast('Sync failed: ' + settings.lastSyncErr);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; setTimeout(sync, 500); }
  }
}
let syncTimer;
function scheduleSync() { dirty = true; setBadge('dirty'); clearTimeout(syncTimer); syncTimer = setTimeout(sync, 4000); }
function setBadge(s) { const b = $('#syncBadge'); b.className = 'sync ' + (s === 'busy' ? '' : s); b.textContent = s === 'busy' ? '↻' : '●'; }

async function saveLocal() {
  try { await kv.set('state', state); await kv.set('settings', settings); } catch (e) { console.warn(e); }
}
async function commit() { await saveLocal(); scheduleSync(); refreshAll(); }

// ---------- map ----------
let map, renderer, markers = new Map(), meMarker, meCircle, zipLayer, baseStreet, baseSat, followMe = false;
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
}
let slt; function saveLocalSoon() { clearTimeout(slt); slt = setTimeout(saveLocal, 800); }
function radiusForZoom() { const z = map.getZoom(); return z >= 17 ? 9 : z >= 15 ? 7 : z >= 13 ? 5 : 3.5; }
function drawMarkers() {
  const list = filtered();
  const ids = new Set(list.map(b => b.id));
  for (const [id, m] of markers) if (!ids.has(id)) { map.removeLayer(m); markers.delete(id); }
  const r = radiusForZoom();
  for (const b of list) {
    const st = statusOf(b.id), col = S[st].color;
    const style = { radius: id_is(b.id) ? r + 4 : r, fillColor: col, color: id_is(b.id) ? '#0f172a' : 'rgba(15,23,42,.55)', weight: id_is(b.id) ? 3 : 1, fillOpacity: 0.95, renderer };
    let m = markers.get(b.id);
    if (!m) { m = L.circleMarker([b.lat, b.lon], style).addTo(map); m.on('click', () => openBiz(b.id)); markers.set(b.id, m); }
    else { m.setStyle(style); m.setRadius(style.radius); m.setLatLng([b.lat, b.lon]); }
  }
  updateMapStats();
}
function id_is(id) { return current === id; }
function updateMapStats() {
  if (!map) return;
  const bounds = map.getBounds(); let n = 0, v = 0;
  for (const b of filtered()) if (bounds.contains([b.lat, b.lon])) { n++; if (statusOf(b.id) !== 'new') v++; }
  $('#mapStats').textContent = BIZ.length || Object.keys(state.custom).length ? `${n} in view · ${v} visited` : 'No businesses loaded yet. Go to Setup.';
}

// ---------- GPS ----------
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
    if ($('#view-list').classList.contains('active') && $('#sortSel').value === 'dist') throttleList();
  }, err => { if (err.code === 1) toast('Location is blocked. Allow location for this site in your browser settings.'); }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
}
let tl; function throttleList() { if (tl) return; tl = setTimeout(() => { tl = null; renderList(); }, 5000); }

// ---------- filtering ----------
function filtered() {
  const q = filters.q.trim().toLowerCase();
  return allBiz().filter(b => {
    if (filters.statuses.size && !filters.statuses.has(statusOf(b.id))) return false;
    if (filters.cats.size && !filters.cats.has(b.cat)) return false;
    if (filters.zips.size && !filters.zips.has(b.zip)) return false;
    if (q) {
      const r = rec(b.id);
      const hay = (b.name + ' ' + (b.addr || '') + ' ' + (b.type || '') + ' ' + (r ? [r.dm, r.notes, r.provider].join(' ') : '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function filterActive() { return filters.statuses.size || filters.cats.size || filters.zips.size; }

// ---------- business sheet ----------
function openBiz(id, opts = {}) {
  const b = bizIndex.get(id); if (!b) return;
  const prev = current; current = id;
  if (prev && markers.get(prev)) drawMarkers(); else drawMarkers();
  renderSheet(opts);
  $('#sheet').classList.remove('hidden');
  if (opts.fly) { switchView('map'); map.setView([b.lat, b.lon], Math.max(map.getZoom(), 17)); }
}
function closeSheet() { current = null; $('#sheet').classList.add('hidden'); drawMarkers(); }
function renderSheet(opts = {}) {
  const id = current, b = bizIndex.get(id); if (!b) return closeSheet();
  const r = rec(id) || {}; const st = statusOf(id); const g = r.g || {};
  const phone = r.phone || g.phone || b.phone; const web = g.web || r.webCard || b.web;
  const addr = g.addr || r.addrCard || [b.addr, b.city].filter(Boolean).join(', ');
  const d = me ? fmtMi(dist(me.lat, me.lon, b.lat, b.lon)) : '';
  const lastV = (r.visits || [])[r.visits ? r.visits.length - 1 : 0];
  const navUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + b.lat + ',' + b.lon;
  let h = `<div class="sh-title"><h3>${esc(b.name)}</h3><button class="closex" data-act="close">✕</button></div>
  <div class="meta"><span class="pill" style="background:${S[st].color}">${S[st].label}</span>
   &nbsp;${esc(b.cat)}${b.type ? ' · ' + esc(b.type) : ''}${d ? ' · ' + d : ''}<br>${esc(addr || 'No address on file')} · ${esc(b.zip || '')}
   ${lastV ? '<br>Last visit: ' + fmtWhen(lastV.t) + ' (' + S[lastV.s].label + ')' : ''}</div>
  <div class="actions">
    <a href="${navUrl}" target="_blank" rel="noopener">Directions</a>
    ${phone ? `<a href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">Call</a>` : ''}
    ${web ? `<a href="${esc(/^https?:/.test(web) ? web : 'https://' + web)}" target="_blank" rel="noopener">Website</a>` : ''}
    <a href="https://www.google.com/search?q=${encodeURIComponent(b.name + ' ' + (b.city || ''))}" target="_blank" rel="noopener">Google it</a>
  </div>
  <label class="btn block scanbtn">📇 Scan business card<input type="file" accept="image/*" data-scan hidden></label>
  <div class="small" style="margin-top:6px">Tap what happened. It logs the visit with the time.</div>
  <div class="outcomes">${STATUSES.filter(s => s.k !== 'new').map(s => `<button data-out="${s.k}" style="background:${s.color}${s.k === 'dead' ? ';color:#fff' : ''}" class="${s.k === st ? 'cur' : ''}">${s.label}</button>`).join('')}</div>
  <div class="fu-box"><div class="lbl">Follow-up${r.followUp ? ': <b>' + fmtDate(r.followUp) + '</b>' : ''}</div>
   <div class="chips">
    ${[['Tomorrow', 1], ['3 days', 3], ['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['3 months', 90]].map(([l, n]) => `<button class="chip" data-fu="${n}">${l}</button>`).join('')}
    <input type="date" id="fuPick" class="chip" value="${esc(r.followUp || '')}" style="padding:5px 8px">
    ${r.followUp ? '<button class="chip" data-fu="clear">Clear</button>' : ''}
   </div></div>`;
  // details
  h += `<details ${opts.openDetails || r.dm || r.provider || r.notes ? 'open' : ''}><summary>Details</summary>
   <div class="two"><div class="field"><label>Decision maker</label><input data-f="dm" value="${esc(r.dm || '')}" placeholder="Name"></div>
   <div class="field"><label>Their title</label><input data-f="dmTitle" value="${esc(r.dmTitle || '')}" placeholder="Owner, GM…"></div></div>
   <div class="two"><div class="field"><label>Direct phone</label><input data-f="phone" type="tel" value="${esc(r.phone || '')}" placeholder="${esc(b.phone || g.phone || '')}"></div>
   <div class="field"><label>Email</label><input data-f="email" type="email" value="${esc(r.email || '')}"></div></div>
   <div class="two"><div class="field"><label>Current provider</label><input data-f="provider" list="provList" value="${esc(r.provider || '')}" placeholder="ADT, none…"></div>
   <div class="field"><label>Contract ends</label><input data-f="contractEnd" type="month" value="${esc(r.contractEnd || '')}"></div></div>
   <div class="field"><label>What they have now</label><input data-f="currentSystem" value="${esc(r.currentSystem || '')}" placeholder="Alarm, cameras, access control, fire…"></div>
   ${(state.fields || []).map(f => customFieldHtml(f, r)).join('')}
   ${(r.cards || []).length ? `<div class="field"><label>Business cards (${r.cards.length})</label>${r.cards.map(c => `<div class="cardrow"><div><b>${esc(c.name || 'No name')}</b>${c.title ? ' · ' + esc(c.title) : ''}<br><span class="small">${[c.cell && 'Cell ' + c.cell, c.phone && 'Office ' + c.phone, c.email, c.web].filter(Boolean).map(esc).join(' · ')}</span></div>${c.photo ? `<button class="chip" data-photo="${esc(c.photo)}">Photo</button>` : ''}</div>`).join('')}</div>` : ''}
   <div class="field"><label>Notes</label><textarea data-f="notes" placeholder="Pain points, best time to come back, who to ask for…">${esc(r.notes || '')}</textarea></div>
   <datalist id="provList">${PROVIDERS.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
  </details>`;
  // google
  if (r.g) {
    h += `<div class="gbox"><b>Google info</b> <span class="small">(${fmtDate(ymd(new Date(r.g.at)))})</span>
      ${r.g.name ? `<div>${esc(r.g.name)}</div>` : ''}${r.g.addr ? `<div>${esc(r.g.addr)}</div>` : ''}${r.g.phone ? `<div>📞 ${esc(r.g.phone)}</div>` : ''}
      ${r.g.status && r.g.status !== 'OPERATIONAL' ? `<div class="err">${esc(r.g.status.replace(/_/g, ' ').toLowerCase())}</div>` : ''}
      ${r.g.hours ? `<div class="small">${r.g.hours.map(esc).join('<br>')}</div>` : ''}</div>`;
  } else if (b.hours) h += `<div class="gbox"><b>Hours (OSM):</b> ${esc(b.hours)}</div>`;
  if (settings.gkey) h += `<button class="btn block" data-act="google">${r.g ? 'Refresh Google info' : 'Get phone, hours & address from Google'}</button>`;
  // history
  const vs = (r.visits || []).slice().reverse();
  h += `<div class="hist"><h2 class="sec" style="margin-left:0">Visit history (${vs.length})</h2>
   ${vs.length ? vs.map(v => `<div class="hrow"><div class="when">${fmtWhen(v.t)}</div><div class="what"><span class="pill" style="background:${S[v.s].color}${v.s === 'dead' ? ';color:#fff' : ''}">${S[v.s].label}</span>${v.note ? '<div>' + esc(v.note) + '</div>' : ''}</div><button class="del" data-delv="${v.t}" aria-label="Delete">✕</button></div>`).join('') : '<div class="small">No visits yet.</div>'}
  </div>
  <div class="two" style="margin-top:12px">
   <button class="btn" data-act="move">Move pin</button>
   <button class="btn danger" data-act="hide">${b.id.startsWith('c') ? 'Delete' : 'Not a business'}</button></div>
  ${b.id.startsWith('c') ? '' : `<div class="small" style="margin-top:8px">Source: OpenStreetMap ${esc(b.id)}</div>`}`;
  $('#sheetBody').innerHTML = h;
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
  lastUndo = () => { const rr = touch(id); rr.visits = rr.visits.filter(x => x.t !== v.t); rr.status = prev.status; rr.statusAt = prev.statusAt; rr.followUp = prev.followUp; };
  commit(); renderSheet();
  toast('Logged: ' + S[s].label, true);
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
  if (t.dataset.photo) showCardPhoto(t.dataset.photo);
});
$('#sheet').addEventListener('change', e => {
  const el = e.target; if (!current) return;
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
  if (id) { const b = bizIndex.get(id); map.setView([b.lat, b.lon], 18); }
  else if (me) map.setView([me.lat, me.lon], 18);
  $('#placeBanner').classList.remove('hidden'); $('#crosshair').classList.remove('hidden');
}
function endPlace() { placing = null; $('#placeBanner').classList.add('hidden'); $('#crosshair').classList.add('hidden'); }
$('#placeCancel').onclick = () => { const id = placing; endPlace(); if (id && id !== 'new') openBiz(id); };
$('#placeOk').onclick = () => {
  const c = map.getCenter(); const id = placing; endPlace();
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

// ---------- list view ----------
let listLimit = 100;
function renderList() {
  const sort = $('#sortSel').value;
  let list = filtered().map(b => ({ b, d: me ? dist(me.lat, me.lon, b.lat, b.lon) : null, r: rec(b.id) }));
  if (sort === 'dist' && me) list.sort((x, y) => x.d - y.d);
  else if (sort === 'recent') list = list.filter(x => x.r && x.r.visits && x.r.visits.length).sort((x, y) => y.r.visits[y.r.visits.length - 1].t - x.r.visits[x.r.visits.length - 1].t);
  else list.sort((x, y) => x.b.name.localeCompare(y.b.name));
  $('#listCount').textContent = list.length + ' businesses' + (sort === 'dist' && !me ? ' · waiting for GPS' : '');
  const shown = list.slice(0, listLimit);
  $('#list').innerHTML = shown.length ? shown.map(({ b, d, r }) => {
    const st = statusOf(b.id); const lv = r && r.visits && r.visits[r.visits.length - 1];
    return `<div class="item" data-id="${b.id}"><span class="pin" style="background:${S[st].color}"></span>
     <div class="main"><div class="nm">${esc(b.name)}</div><div class="sub">${esc(b.cat)}${b.addr ? ' · ' + esc(b.addr) : ''}${lv ? ' · ' + fmtWhen(lv.t) : ''}</div></div>
     <div class="right">${d != null ? fmtMi(d) : ''}<br>${S[st].label}</div></div>`;
  }).join('') + (list.length > listLimit ? `<button class="more" id="moreBtn">Show more (${list.length - listLimit} left)</button>` : '')
    : `<div class="empty">${allBiz().length ? 'Nothing matches your search or filters.' : 'No businesses loaded yet. Go to Setup and tap "Load businesses".'}</div>`;
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
  $('#follow').innerHTML = h || '<div class="empty">No follow-ups yet.<br>When you log a visit, tap a follow-up date and it shows up here.</div>';
  const due = groups[0][1].length + groups[1][1].length;
  $('#fuCount').textContent = due; $('#fuCount').classList.toggle('hidden', !due);
}
$('#follow').addEventListener('click', e => { const it = e.target.closest('.item'); if (it) openBiz(it.dataset.id, { fly: false }); });

// ---------- stats ----------
function renderStats() {
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
  let h = `<div class="card"><h3>Today</h3><div class="kpis">
    <div class="kpi"><b>${tv.length}</b><span>Doors</span></div><div class="kpi"><b>${convos(tv)}</b><span>DM convos</span></div><div class="kpi"><b>${appts(tv)}</b><span>Appts</span></div></div></div>
   <div class="card"><h3>This week</h3><div class="kpis">
    <div class="kpi"><b>${wv.length}</b><span>Doors</span></div><div class="kpi"><b>${pct(convos(wv), wv.length)}</b><span>Reach DM</span></div><div class="kpi"><b>${appts(wv)} / ${sold(wv)}</b><span>Appts / Sold</span></div></div></div>
   <div class="card"><h3>Doors per day, last 2 weeks</h3><div class="bars">${perDay.map((n, i) => `<div class="b"><em>${n || ''}</em><i style="height:${n / max * 80}%"></i>${new Date(days[i] + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</div>`).join('')}</div></div>
   <div class="card"><h3>All visits by outcome (${visits.length})</h3>${STATUSES.filter(s => s.k !== 'new').map(s => { const n = mix[s.k] || 0; return `<div class="brow"><span class="l">${s.label}</span><span class="t"><i style="width:${visits.length ? n / visits.length * 100 : 0}%;background:${s.color}"></i></span><span class="n">${n}</span></div>`; }).join('')}</div>
   <div class="card"><h3>Reach-a-DM rate by business type</h3>${Object.keys(cat).length ? Object.entries(cat).sort((a, b) => b[1].n - a[1].n).map(([k, c]) => `<div class="brow"><span class="l">${esc(k)}</span><span class="t"><i style="width:${c.c / c.n * 100}%;background:#4b8ff7"></i></span><span class="n">${c.c}/${c.n}</span></div>`).join('') : '<div class="small">Shows up once you start logging.</div>'}</div>
   <div class="card"><h3>Territory coverage</h3>${Object.entries(z).sort().map(([k, c]) => `<div class="brow"><span class="l">${esc(k)} ${esc(c.city || '')}</span><span class="t"><i style="width:${c.v / c.n * 100}%;background:#22b357"></i></span><span class="n">${c.v}/${c.n}</span></div>`).join('') || '<div class="small">Load businesses in Setup first.</div>'}</div>`;
  $('#stats').innerHTML = h;
}

// ---------- settings ----------
function renderSettings() {
  const cnt = BIZ.length, cust = Object.keys(state.custom).length, hid = Object.keys(state.hidden).length;
  $('#settings').innerHTML = `
  <div class="card"><h3>1. Businesses</h3>
    <p class="small">${cnt ? `${cnt} businesses from OpenStreetMap, last pulled ${fmtWhen(bizFetchedAt)}. ${cust} you added. ${hid} hidden.` : 'Nothing loaded yet. Tap the button to pull every business in your zips from OpenStreetMap. Free.'}</p>
    ${loadStatus.running ? '<button class="btn block primary" disabled>Loading… keep this screen open</button>'
      : zipsLeft() ? `<button class="btn block primary" id="loadBiz">${cnt ? `Finish loading (${zipsLeft()} zips left)` : 'Load businesses'}</button>`
      : '<button class="btn block" id="refreshBiz">Refresh all businesses</button>'}
    <div id="loadMsg" class="small" style="${loadStatus.err ? 'color:#e5484d' : ''}">${esc(loadStatus.msg)}</div>
    <p class="small">Loading saves after each zip, so if it stops you can pick up where it left off. Refreshing keeps all your knocks and notes.</p>
  </div>
  <div class="card"><h3>2. Cloud backup (GitHub)</h3>
    <p class="small">Saves your knocks to your private <b>knock-data</b> repo so nothing is lost if your phone dies, and so they show up on any device.</p>
    <div class="field"><label>GitHub username</label><input id="sOwner" value="${esc(settings.owner || '')}" autocapitalize="off" autocorrect="off"></div>
    <div class="field"><label>Data repo</label><input id="sRepo" value="${esc(settings.repo || 'knock-data')}" autocapitalize="off" autocorrect="off"></div>
    <div class="field"><label>Access token</label><input id="sToken" type="password" value="${esc(settings.token || '')}" placeholder="github_pat_…" autocapitalize="off" autocorrect="off"></div>
    <button class="btn block primary" id="saveSync">Save &amp; sync now</button>
    <p class="small">${settings.lastSync ? 'Last synced ' + fmtWhen(settings.lastSync) : 'Not synced yet.'} ${settings.lastSyncErr && !syncReady() ? '' : ''}</p>
  </div>
  <div class="card"><h3>3. Google details (optional)</h3>
    <p class="small">With a Google Maps API key, each business gets a button that pulls its phone, hours and address. It only calls Google when you tap it.</p>
    <div class="field"><label>Google API key</label><input id="sGkey" type="password" value="${esc(settings.gkey || '')}" autocapitalize="off" autocorrect="off"></div>
    <button class="btn block" id="saveG">Save key</button>
    ${settings.gcalls ? `<p class="small">Google lookups from this phone: ${settings.gcalls}</p>` : ''}
  </div>
  <div class="card"><h3>Your own fields</h3>
    <p class="small">Add anything you want to track on every business. It shows up under Details.</p>
    ${(state.fields || []).map(f => `<div class="brow"><span style="flex:1">${esc(f.name)} <span class="small">(${f.type}${f.options ? ': ' + f.options.map(esc).join(', ') : ''})</span></span><button class="chip" data-delf="${f.id}">Remove</button></div>`).join('') || '<p class="small">None yet.</p>'}
    <div class="two"><div class="field"><label>Field name</label><input id="fName" placeholder="e.g. # of locations"></div>
    <div class="field"><label>Type</label><select id="fType"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="yesno">Yes / No</option><option value="choice">Pick from list</option></select></div></div>
    <div class="field hidden" id="fOptsWrap"><label>Choices (comma separated)</label><input id="fOpts" placeholder="Small, Medium, Large"></div>
    <button class="btn block" id="addField">Add field</button>
  </div>
  <div class="card"><h3>Export</h3>
    <button class="btn block" id="expCsv">Download spreadsheet (CSV)</button>
    <button class="btn block" id="expJson">Download full backup (JSON)</button>
    <label class="btn block" style="text-align:center">Restore from backup<input type="file" id="impJson" accept=".json,application/json" hidden></label>
  </div>
  <div class="card"><h3>Put it on your home screen</h3><p class="small">In Safari tap the Share button, then <b>Add to Home Screen</b>. It opens full screen like an app.</p></div>
  <p class="small" style="text-align:center;margin:20px">Map data © OpenStreetMap contributors · app v5</p>`;
}
$('#settings').addEventListener('click', async e => {
  const t = e.target;
  if (t.id === 'loadBiz') loadBusinesses(false);
  if (t.id === 'refreshBiz') loadBusinesses(true);
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
  const head = ['Name', 'Category', 'Type', 'Address', 'City', 'Zip', 'Status', 'Visits', 'First visit', 'Last visit', 'Follow-up', 'Decision maker', 'Title', 'Phone', 'Email', 'Provider', 'Contract ends', 'Current system', ...fields.map(f => f.name), 'Notes', 'Lat', 'Lon'];
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const rows = [head];
  for (const b of allBiz()) {
    const r = rec(b.id); if (!r || !(r.visits || []).length && !r.notes && !r.followUp) continue;
    const vs = r.visits || [];
    rows.push([b.name, b.cat, b.type, (r.g && r.g.addr) || b.addr, b.city, b.zip, S[statusOf(b.id)].label, vs.length,
      vs[0] ? new Date(vs[0].t).toLocaleString() : '', vs.length ? new Date(vs[vs.length - 1].t).toLocaleString() : '', r.followUp || '',
      r.dm, r.dmTitle, r.phone || (r.g && r.g.phone) || b.phone, r.email, r.provider, r.contractEnd, r.currentSystem,
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
   <div class="two" style="margin-top:14px"><button class="btn ghost" id="fClear">Clear all</button><button class="btn primary" id="fDone">Done</button></div>`);
  $('#modalBody').onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.set) { const set = t.dataset.set === 's' ? filters.statuses : t.dataset.set === 'c' ? filters.cats : filters.zips; set.has(t.dataset.val) ? set.delete(t.dataset.val) : set.add(t.dataset.val); t.classList.toggle('on'); }
    if (t.id === 'fClear') { filters.statuses.clear(); filters.cats.clear(); filters.zips.clear(); $('#modalBody').querySelectorAll('.chip.on').forEach(c => c.classList.remove('on')); }
    if (t.id === 'fDone') { hideModal(); $('#modalBody').onclick = null; }
    $('#filterDot').classList.toggle('hidden', !filterActive()); refreshAll();
  };
};
let st; $('#search').addEventListener('input', e => { clearTimeout(st); st = setTimeout(() => { filters.q = e.target.value; listLimit = 100; refreshAll(); if (filters.q && $('#view-map').classList.contains('active')) switchView('list'); }, 250); });

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
$('#addBtn').onclick = () => startPlace(null);

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
  } catch (e) { console.warn('storage unavailable', e); }
  applyMoves(); reindex();
  initMap(); drawMarkers(); renderFollow();
  setBadge(syncReady() ? 'ok' : 'off');
  startGPS();
  if (syncReady()) sync();
  if (!BIZ.length) { switchView('settings'); toast('Start here: tap "Load businesses"'); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__km = { get state() { return state; }, get BIZ() { return BIZ; }, logOutcome, openBiz, sync, mergeInto, zipOf, loadBusinesses };
})();
})();
