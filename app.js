/* Knock Map — prospecting tracker for Nathan's Bay Alarm territory */
(function () {
'use strict';

// ---------- constants ----------
const STATUSES = [
  { k: 'new',        label: 'Not visited',     color: '#9aa5b4', hint: 'Haven\'t been in yet' },
  { k: 'closed',     label: 'Closed / nobody', color: '#c9a86a', hint: 'Locked, or no one there' },
  { k: 'booted',     label: 'Booted',          color: '#e5484d', hint: 'Asked to leave' },
  { k: 'gatekeeper', label: 'Gatekeeper',      color: '#f59e0b', hint: 'Talked to front desk only' },
  { k: 'dm',         label: 'Talked to DM',    color: '#0ea5a4', hint: 'Reached the decision maker' },
  { k: 'followup',   label: 'Follow-up',       color: '#3b82f6', hint: 'Coming back' },
  { k: 'appt',       label: 'Appt set',        color: '#8b5cf6', hint: 'Meeting on the books' },
  { k: 'sold',       label: 'Sold',            color: '#16a34a', hint: 'Closed the deal' },
  { k: 'dead',       label: 'Not a fit',       color: '#334155', hint: 'Don\'t come back' },
];
const S = Object.fromEntries(STATUSES.map(s => [s.k, s]));
const CONVO = new Set(['dm', 'followup', 'appt', 'sold']); // reached a decision maker
const ICON = n => `<svg class="ico"><use href="#i-${n}"/></svg>`;
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
let filters = { statuses: new Set(), cats: new Set(), zips: new Set(), q: '', planOnly: false, permits: true };
let lastUndo = null;
let dirty = false;

function blankState() { return { v: 1, records: {}, custom: {}, hidden: {}, fields: [], permits: {}, plan: null, prefs: {}, updatedAt: 0 }; }

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
function cooldownDays() { const p = state.prefs || {}; return p.cooldownDays != null ? +p.cooldownDays : 60; }
function inCooldown(id) { const r = rec(id); if (!r || r.status !== 'booted' || !r.statusAt || !cooldownDays()) return 0; const until = r.statusAt + cooldownDays() * 864e5; return until > Date.now() ? until : 0; }
function money(n) { n = +n || 0; return '$' + Math.round(n).toLocaleString(); }
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
  for (const key of ['records', 'custom', 'permits']) {
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
  m.plan = ((local.plan && local.plan.at) || 0) >= ((remote.plan && remote.plan.at) || 0) ? (local.plan || null) : (remote.plan || null);
  m.prefs = ((local.prefs || {}).at || 0) >= ((remote.prefs || {}).at || 0) ? (local.prefs || {}) : (remote.prefs || {});
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
function setBadge(s) {
  const b = $('#syncBadge'); b.className = 'sync ' + s;
  b.title = { ok: 'Backed up to the cloud', dirty: 'Saving…', busy: 'Syncing…', err: 'Cloud backup failed. Check Settings.', off: 'Not connected to cloud backup. Set it up in Settings.' }[s] || '';
}

async function saveLocal() {
  try { await kv.set('state', state); await kv.set('settings', settings); } catch (e) { console.warn(e); }
}
async function commit() { await saveLocal(); scheduleSync(); refreshAll(); }

// ---------- map ----------
let map, renderer, markers = new Map(), meMarker, meCircle, zipLayer, baseStreet, baseSat, followMe = false;
function renderLegend() {
  const el = $('#legend'); if (!el) return;
  const open = settings.legendOpen !== false;
  el.innerHTML = open ? `<button class="lg-x" id="lgToggle" aria-label="Hide key">Key ▾</button>${STATUSES.map(s => `<div><i style="background:${s.color}"></i>${s.label}</div>`).join('')}<div><i style="background:#f97316;border:2px solid #fff;box-shadow:0 0 0 1px #f97316"></i>Permit</div><div><i style="background:#ef5b5f;opacity:.3"></i>Cooling off</div>` : '<button class="lg-x" id="lgToggle">Key ▸</button>';
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
    const cool = inCooldown(b.id);
    const style = { radius: id_is(b.id) ? r + 4 : r, fillColor: col, color: id_is(b.id) ? '#0f172a' : cool ? 'rgba(15,23,42,.2)' : 'rgba(15,23,42,.55)', weight: id_is(b.id) ? 3 : 1, fillOpacity: cool ? 0.25 : 0.95, renderer };
    let m = markers.get(b.id);
    if (!m) { m = L.circleMarker([b.lat, b.lon], style).addTo(map); m.on('click', () => openBiz(b.id)); markers.set(b.id, m); }
    else { m.setStyle(style); m.setRadius(style.radius); m.setLatLng([b.lat, b.lon]); }
  }
  drawPermits();
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
function filterActive() { return filters.statuses.size || filters.cats.size || filters.zips.size || filters.planOnly || !filters.permits; }

// ---------- business sheet ----------
function openBiz(id, opts = {}) {
  const b = bizIndex.get(id); if (!b) return;
  currentPermit = null;
  const prev = current; current = id;
  if (prev && markers.get(prev)) drawMarkers(); else drawMarkers();
  renderSheet(opts);
  $('#sheet').classList.remove('hidden');
  if (opts.fly) { switchView('map'); map.setView([b.lat, b.lon], Math.max(map.getZoom(), 17)); }
}
function closeSheet() { current = null; currentPermit = null; $('#sheet').classList.add('hidden'); drawMarkers(); }
function renderSheet(opts = {}) {
  const id = current, b = bizIndex.get(id); if (!b) return closeSheet();
  const r = rec(id) || {}; const st = statusOf(id); const g = r.g || {};
  const phone = r.phone || g.phone || b.phone; const web = g.web || r.webCard || b.web;
  const addr = g.addr || r.addrCard || [b.addr, b.city].filter(Boolean).join(', ');
  const d = me ? fmtMi(dist(me.lat, me.lon, b.lat, b.lon)) : '';
  const lastV = (r.visits || [])[r.visits ? r.visits.length - 1 : 0];
  const navUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + b.lat + ',' + b.lon;
  let h = `<div class="sh-title"><h3>${esc(b.name)}</h3><button class="closex" data-act="close" aria-label="Close">${ICON('x')}</button></div>
  <div class="meta"><span class="pill" style="--c:${S[st].color}">${S[st].label}</span>
   &nbsp;${esc(b.cat)}${b.type ? ' · ' + esc(b.type) : ''}${d ? ' · ' + d : ''}<br>${esc(addr || 'No address on file')} · ${esc(b.zip || '')}
   ${lastV ? '<br>Last visit: ' + fmtWhen(lastV.t) + ' (' + S[lastV.s].label + ')' : ''}
   ${inCooldown(id) ? '<br><b>Cooling off</b> until ' + new Date(inCooldown(id)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '. Skipped in day plans till then.' : ''}</div>
  <div class="actions">
    <a href="${navUrl}" target="_blank" rel="noopener">${ICON('nav')}Directions</a>
    ${phone ? `<a href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">${ICON('phone')}Call</a>` : ''}
    ${web ? `<a href="${esc(/^https?:/.test(web) ? web : 'https://' + web)}" target="_blank" rel="noopener">${ICON('globe')}Website</a>` : ''}
    <a href="https://www.google.com/search?q=${encodeURIComponent(b.name + ' ' + (b.city || ''))}" target="_blank" rel="noopener">${ICON('search')}Google</a>
  </div>
  <label class="btn block scanbtn">${ICON('card')}Scan a business card<input type="file" accept="image/*" data-scan hidden></label>
  <div class="sec-label"><span>Log this visit</span>${lastV && ymd(new Date(lastV.t)) === todayStr() ? `<button class="btn primary" data-act="next" style="padding:7px 12px;text-transform:none;letter-spacing:0">Next closest ${ICON('arrow')}</button>` : ''}</div>
  <div class="outcomes">${STATUSES.filter(s => s.k !== 'new').map(s => `<button data-out="${s.k}" style="--c:${s.color}" class="${s.k === st ? 'cur' : ''}" title="${s.hint}">${s.label}</button>`).join('')}</div>
  <div class="fu-box"><div class="lbl">Follow-up${r.followUp ? ': <b>' + fmtDate(r.followUp) + '</b>' : ''}</div>
   <div class="chips">
    ${[['Tomorrow', 1], ['3 days', 3], ['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['3 months', 90]].map(([l, n]) => `<button class="chip" data-fu="${n}">${l}</button>`).join('')}
    <input type="date" id="fuPick" class="chip" value="${esc(r.followUp || '')}" style="padding:5px 8px">
    ${r.followUp ? '<button class="chip" data-fu="clear">Clear</button>' : ''}
   </div></div>
  ${['dm', 'followup', 'appt', 'sold'].includes(st) || r.dealInstall || r.dealMonthly ? `<div class="fu-box deal"><div class="lbl">Deal ${st === 'sold' ? '(sold)' : '(in pipeline)'}</div>
   <div class="two"><div class="field" style="margin:4px 0"><label>Install $</label><input data-f="dealInstall" type="number" inputmode="decimal" value="${esc(r.dealInstall || '')}" placeholder="0"></div>
   <div class="field" style="margin:4px 0"><label>Monthly $</label><input data-f="dealMonthly" type="number" inputmode="decimal" value="${esc(r.dealMonthly || '')}" placeholder="0"></div></div></div>` : ''}`;
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
  // property owner
  h += r.parcel ? ownerBoxHtml(r) : `<button class="btn block" data-act="owner">Who owns this property?</button>`;
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
   ${vs.length ? vs.map(v => `<div class="hrow"><div class="when">${fmtWhen(v.t)}</div><div class="what"><span class="pill" style="--c:${S[v.s].color}">${S[v.s].label}</span>${v.note ? '<div>' + esc(v.note) + '</div>' : ''}</div><button class="del" data-delv="${v.t}" aria-label="Delete">✕</button></div>`).join('') : '<div class="small">No visits yet.</div>'}
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
  if (act === 'next') {
    const b0 = bizIndex.get(id), today = todayStr();
    let best = null, bd = Infinity;
    for (const b of filtered()) {
      if (b.id === id || inCooldown(b.id)) continue;
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
     <div class="right">${d != null ? fmtMi(d) : ''}<br>${S[st].label}</div></div>`;
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
  $('#follow').innerHTML = '<div class="page-title">Plan</div><div class="page-sub">Today\'s route, follow-ups that are due, expiring contracts, new permits and landlords.</div>' + planHtml() + (h || '<div class="empty"><b>No follow-ups yet</b>When you log a visit, pick a follow-up date and it shows up here.</div>') + landlordsHtml();
  const due = groups[0][1].length + groups[1][1].length;
  $('#fuCount').textContent = due; $('#fuCount').classList.toggle('hidden', !due);
}
$('#follow').addEventListener('click', e => {
  const t = e.target;
  if (t.id === 'planBtn' || t.id === 'planNew') return openPlanModal();
  if (t.id === 'planMap') {
    filters.planOnly = !filters.planOnly; $('#filterDot').classList.toggle('hidden', !filterActive());
    if (filters.planOnly) { switchView('map'); const pts = state.plan.ids.map(id => bizIndex.get(id)).filter(Boolean).map(b => [b.lat, b.lon]); if (pts.length) map.fitBounds(pts, { padding: [40, 40] }); }
    refreshAll(); renderFollow(); return;
  }
  if (t.id === 'llLoad') return loadLandlords();
  if (t.id === 'pmNoise') { settings.showNoisePermits = !settings.showNoisePermits; saveLocal(); renderFollow(); drawMarkers(); return; }
  const lg = t.closest('[data-ll-group]'); if (lg) return showLandlordGroup(+lg.dataset.llGroup);
  const pm = t.closest('[data-permit]'); if (pm) return openPermit(pm.dataset.permit, true);
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
   ${legs.length ? `<p class="small" style="margin:10px 0 4px">Open in Google Maps (9 stops at a time):</p><div class="chips">${legs.map((l, i) => `<a class="chip" href="${legUrl(l)}" target="_blank" rel="noopener">Stops ${done + i * 9 + 1}–${done + i * 9 + l.length}</a>`).join('')}</div>` : '<p class="small ok">All done. Nice work.</p>'}
   <div style="margin-top:8px">${items.map((b, i) => { const r = rec(b.id), due = r && r.followUp && r.followUp <= todayStr(); return `<div class="item" data-id="${b.id}" style="padding:10px 0;${planDone(b.id) ? 'opacity:.45' : ''}"><span class="pnum">${planDone(b.id) ? '✓' : i + 1}</span>
     <div class="main"><div class="nm">${esc(b.name)}</div><div class="sub">${due ? '<b style="color:#2563eb">Follow-up</b> · ' : ''}${esc(b.cat)}${b.addr ? ' · ' + esc(b.addr) : ''}</div></div>
     <div class="right"><span class="pin" style="background:${S[statusOf(b.id)].color};display:inline-block"></span></div></div>`; }).join('')}</div></div>`;
}

// ---------- permits ----------
let currentPermit = null;
let permitMsg = { text: '', err: false };
const TERR_CITIES = /\b(peoria|surprise|el mirage|sun city west|sun city|youngtown)\b/i;
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
function permitNoise(p) { return p.kind === 'residential' || PERMIT_NOISE.test([p.type, p.desc].join(' ')); }
function permitScore(p) { const t = [p.type, p.desc].join(' '); return /\bsigns?\b|letters|pylon|monument/i.test(t) ? 3 : /tenant|\bT\.?I\.?\b|remodel|alteration|new construction|new building|shell|addition|build-?out|suite/i.test(t) ? 2 : 1; }
function permitTime(p) { const m = String(p.date || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], +m[1] - 1, +m[2]).getTime() : (p.importedAt || 0); }
function allNewPermits() { return Object.values(state.permits || {}).filter(p => p.status === 'new' && !p.outside); }
function livePermits() { return allNewPermits().filter(p => settings.showNoisePermits || !permitNoise(p)); }
let permitMarkers = new Map();
function drawPermits() {
  const show = filters.permits && !filters.planOnly ? livePermits().filter(p => p.lat != null) : [];
  const ids = new Set(show.map(p => p.id));
  for (const [id, m] of permitMarkers) if (!ids.has(id)) { map.removeLayer(m); permitMarkers.delete(id); }
  const r = radiusForZoom() + 2;
  for (const p of show) {
    const sel = currentPermit === p.id;
    const style = { radius: sel ? r + 4 : r, fillColor: '#f97316', color: sel ? '#0f172a' : '#fff', weight: sel ? 3 : 2, fillOpacity: 1, renderer };
    let m = permitMarkers.get(p.id);
    if (!m) { m = L.circleMarker([p.lat, p.lon], style).addTo(map); m.on('click', () => openPermit(p.id)); permitMarkers.set(p.id, m); }
    else { m.setStyle(style); m.setRadius(style.radius); }
    m.bringToFront();
  }
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
  $('#sheetBody').innerHTML = `<div class="sh-title"><h3>${esc(permitTitle(p))}</h3><button class="closex" data-pact="close" aria-label="Close">${ICON('x')}</button></div>
   <div class="meta"><span class="pill" style="--c:#f97316">Permit${p.kind === 'commercial' ? ' · commercial' : ''}</span> ${esc(permitAddr(p))}${p.city ? ', ' + esc(p.city) : ''} ${esc(p.zip || '')}</div>
   ${row('Permit #', p.permit)}${row('Issued', p.date)}${row('Type', p.type)}${row('Work', p.desc)}${row('Value', permitValue(p))}${row('Owner', permitOwner(p))}${row('Contractor', p.contractor)}${row('GC phone', p.cphone)}${row('GC email', p.cemail)}${row('Parcel', p.parcel)}
   ${p.lat == null ? '<p class="small">Not on the map yet' + (p.geoFail ? ': the address lookup came up empty. Tap Directions to find it in Google Maps.' : '.') + '</p>' : p.approx ? '<p class="small">Pin is on the right street but the exact spot is a guess.</p>' : ''}
   <div class="actions"><a href="${nav}" target="_blank" rel="noopener">${ICON('nav')}Directions</a>${p.cphone ? `<a href="tel:${esc(p.cphone.replace(/[^\d+]/g, '').slice(0, 11))}">${ICON('phone')}Call GC</a>` : ''}<a href="https://www.google.com/search?q=${encodeURIComponent((p.contractor || p.owner || p.addr) + ' ' + (p.city || 'AZ'))}" target="_blank" rel="noopener">${ICON('search')}Google</a></div>
   <p class="small">Something's being built or remodeled here. Stop by while it's under construction and ask who's handling security, cameras, access control and fire.</p>
   <button class="btn block primary" data-pact="convert">Turn into a prospect</button>
   <button class="btn block ghost" data-pact="dismiss">Not worth it, hide this permit</button>`;
  $('#sheet').classList.remove('hidden'); drawMarkers();
  if (fly && p.lat != null) { filters.planOnly = false; $('#filterDot').classList.toggle('hidden', !filterActive()); switchView('map'); $('#sheet').classList.remove('hidden'); map.setView([p.lat, p.lon], 17); }
}
$('#sheet').addEventListener('click', e => {
  const t = e.target.closest('[data-pact]'); if (!t || !currentPermit) return;
  const p = state.permits[currentPermit];
  if (t.dataset.pact === 'close') { currentPermit = null; $('#sheet').classList.add('hidden'); drawMarkers(); }
  if (t.dataset.pact === 'dismiss') { p.status = 'dismissed'; p.updatedAt = state.updatedAt = Date.now(); currentPermit = null; $('#sheet').classList.add('hidden'); commit(); toast('Permit hidden'); }
  if (t.dataset.pact === 'convert') {
    const lat = p.lat != null ? p.lat : (me ? me.lat : map.getCenter().lat), lon = p.lon != null ? p.lon : (me ? me.lon : map.getCenter().lng);
    const z = zipOf(lat, lon); const nid = 'c' + Date.now().toString(36);
    state.custom[nid] = { id: nid, name: permitOwner(p) && !/^(c\/o)/i.test(permitOwner(p)) && /\b(llc|inc|corp|church|clinic|dental|school|center|co)\b/i.test(permitOwner(p)) ? permitOwner(p) : permitTitle(p), cat: 'Other', type: 'under construction', lat, lon, addr: permitAddr(p), city: p.city || (z ? z.city : ''), zip: p.zip || (z ? z.zip : ''), phone: '', web: '', hours: '', updatedAt: Date.now() };
    const r = touch(nid);
    r.notes = `From permit ${p.permit || ''}${p.date ? ' (' + p.date + ')' : ''}: ${[p.type, p.desc].filter(Boolean).join(' – ')}${p.value ? '. Value ' + p.value : ''}${p.contractor ? '. Contractor: ' + p.contractor + (p.cphone ? ' ' + p.cphone : '') + (p.cemail ? ' ' + p.cemail : '') : ''}${p.owner ? '. Owner: ' + p.owner : ''}`;
    p.status = 'converted'; p.bizId = nid; p.updatedAt = state.updatedAt = Date.now();
    currentPermit = null; reindex(); commit(); openBiz(nid, { openDetails: true }); toast('Added as a prospect. Rename it once you know the business name.');
  }
});
function permitsListHtml() {
  const list = livePermits().sort((a, b) => permitScore(b) - permitScore(a) || permitTime(b) - permitTime(a));
  const hidden = allNewPermits().filter(permitNoise).length;
  if (!list.length && !hidden) return '';
  const tag = p => permitScore(p) === 3 ? '<span class="pill" style="--c:#f97316;margin-right:6px">Sign</span>' : permitScore(p) === 2 ? '<span class="pill" style="--c:#8b5cf6;margin-right:6px">Build-out</span>' : '';
  return `<h2 class="sec" style="display:flex;justify-content:space-between;align-items:center">New permits (${list.length})${hidden ? `<button class="chip" id="pmNoise" style="text-transform:none;letter-spacing:0">${settings.showNoisePermits ? 'Hide' : 'Show'} ${hidden} low-value</button>` : ''}</h2>` + list.slice(0, 60).map(p => `<div class="item" data-permit="${p.id}" style="${permitNoise(p) ? 'opacity:.55' : ''}"><span class="pin" style="background:#f97316"></span>
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
  // pipeline
  const nowD = new Date(), mStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime();
  const pipe = { n: 0, inst: 0, mon: 0 }, soldM = { n: 0, inst: 0, mon: 0 }, soldAll = { n: 0, inst: 0, mon: 0 };
  for (const id in state.records) {
    const r = state.records[id]; if (!bizIndex.has(id)) continue;
    const inst = +r.dealInstall || 0, mon = +r.dealMonthly || 0;
    if (['dm', 'followup', 'appt'].includes(r.status) && (inst || mon)) { pipe.n++; pipe.inst += inst; pipe.mon += mon; }
    if (r.status === 'sold') { soldAll.n++; soldAll.inst += inst; soldAll.mon += mon; if ((r.statusAt || 0) >= mStart) { soldM.n++; soldM.inst += inst; soldM.mon += mon; } }
  }
  const dealCard = `<div class="card"><h3>Deals</h3><div class="kpis">
    <div class="kpi"><b>${soldM.n}</b><span>Sold this month</span></div><div class="kpi"><b>${money(soldM.inst)}</b><span>Install this month</span></div><div class="kpi"><b>${money(soldM.mon)}</b><span>Monthly added</span></div></div>
    <div class="kpis" style="margin-top:8px"><div class="kpi"><b>${pipe.n}</b><span>Open deals</span></div><div class="kpi"><b>${money(pipe.inst)}</b><span>Install in pipeline</span></div><div class="kpi"><b>${money(pipe.mon)}</b><span>Monthly in pipeline</span></div></div>
    <p class="small" style="margin-bottom:0">All time sold: ${soldAll.n} · ${money(soldAll.inst)} install · ${money(soldAll.mon)}/mo. Add $ on any deal from its Deal box.</p></div>`;
  let h = `<div class="page-title">Stats</div><div class="page-sub">How your prospecting is going. Updates as you log visits.</div><div class="card"><h3>Today</h3><div class="kpis">
    <div class="kpi"><b>${tv.length}</b><span>Doors</span></div><div class="kpi"><b>${convos(tv)}</b><span>DM convos</span></div><div class="kpi"><b>${appts(tv)}</b><span>Appts</span></div></div></div>
   <div class="card"><h3>This week</h3><div class="kpis">
    <div class="kpi"><b>${wv.length}</b><span>Doors</span></div><div class="kpi"><b>${pct(convos(wv), wv.length)}</b><span>Reach DM</span></div><div class="kpi"><b>${appts(wv)} / ${sold(wv)}</b><span>Appts / Sold</span></div></div></div>
   ${dealCard}
   <div class="card"><h3>Doors per day, last 2 weeks</h3><div class="bars">${perDay.map((n, i) => `<div class="b"><em>${n || ''}</em><i style="height:${n / max * 80}%"></i>${new Date(days[i] + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</div>`).join('')}</div></div>
   <div class="card"><h3>All visits by outcome (${visits.length})</h3>${STATUSES.filter(s => s.k !== 'new').map(s => { const n = mix[s.k] || 0; return `<div class="brow"><span class="l">${s.label}</span><span class="t"><i style="width:${visits.length ? n / visits.length * 100 : 0}%;background:${s.color}"></i></span><span class="n">${n}</span></div>`; }).join('')}</div>
   <div class="card"><h3>Reach-a-DM rate by business type</h3>${Object.keys(cat).length ? Object.entries(cat).sort((a, b) => b[1].n - a[1].n).map(([k, c]) => `<div class="brow"><span class="l">${esc(k)}</span><span class="t"><i style="width:${c.c / c.n * 100}%;background:var(--brand)"></i></span><span class="n">${c.c}/${c.n}</span></div>`).join('') : '<div class="small">Shows up once you start logging.</div>'}</div>
   <div class="card"><h3>Territory coverage</h3>${Object.entries(z).sort().map(([k, c]) => `<div class="brow"><span class="l">${esc(k)} ${esc(c.city || '')}</span><span class="t"><i style="width:${c.v / c.n * 100}%;background:var(--ok)"></i></span><span class="n">${c.v}/${c.n}</span></div>`).join('') || '<div class="small">Load businesses in Settings first.</div>'}</div>`;
  $('#stats').innerHTML = h;
}

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
    <div id="loadMsg" class="small" style="${loadStatus.err ? 'color:#e5484d' : ''}">${esc(loadStatus.msg)}</div>
    <p class="small">Loading saves after each zip, so if it stops you can pick up where it left off. Refreshing keeps all your knocks and notes.</p>
  </div>
  <div class="card"><h3><span class="step ${settings.lastSync ? 'done' : ''}">${settings.lastSync ? '✓' : '2'}</span>Cloud backup</h3>
    <p class="small">Saves your knocks to your private <b>knock-data</b> repo so nothing is lost if your phone dies, and so they show up on any device.</p>
    <div class="field"><label>GitHub username</label><input id="sOwner" value="${esc(settings.owner || '')}" autocapitalize="off" autocorrect="off"></div>
    <div class="field"><label>Data repo</label><input id="sRepo" value="${esc(settings.repo || 'knock-data')}" autocapitalize="off" autocorrect="off"></div>
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
  <p class="footer-note">Knock Map v14 · Map data © OpenStreetMap contributors</p>`;
}
$('#settings').addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('more')) { settings.moreOpen = e.target.open; saveLocalSoon(); } }, true);
$('#settings').addEventListener('click', async e => {
  const t = e.target;
  if (t.id === 'helpLink') { e.preventDefault(); showHelp(); return; }
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
  if (e.target.id === 'cdDays') { state.prefs = { ...(state.prefs || {}), cooldownDays: Math.max(0, +e.target.value || 0), at: Date.now() }; state.updatedAt = Date.now(); commit(); toast('Saved'); }
  if (e.target.id === 'pmFile') {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const msg = $('#pmMsg'); msg.textContent = 'Reading spreadsheet…'; msg.style.color = '';
    try {
      const r = await importPermits(f, $('#pmCom').checked);
      permitMsg = { text: `Read ${r.seen} permits. ${r.added} new in your zips. Skipped ${r.skippedArea} outside your territory${$('#pmCom').checked ? ' and ' + r.skippedRes + ' residential in your zips' : ''}.${!r.added && r.skippedRes ? ' No commercial permits in your area this time.' : ''}`, err: false };
      if (!r.seen) permitMsg = { text: "Couldn't find the permit rows in that file (no address column found). Send me the file and I'll adjust it.", err: true };
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
  const head = ['Name', 'Category', 'Type', 'Address', 'City', 'Zip', 'Status', 'Visits', 'First visit', 'Last visit', 'Follow-up', 'Decision maker', 'Title', 'Phone', 'Email', 'Provider', 'Contract ends', 'Current system', 'Install $', 'Monthly $', 'Property owner', 'Owner mailing address', ...fields.map(f => f.name), 'Notes', 'Lat', 'Lon'];
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const rows = [head];
  for (const b of allBiz()) {
    const r = rec(b.id); if (!r || !(r.visits || []).length && !r.notes && !r.followUp) continue;
    const vs = r.visits || [];
    rows.push([b.name, b.cat, b.type, (r.g && r.g.addr) || b.addr, b.city, b.zip, S[statusOf(b.id)].label, vs.length,
      vs[0] ? new Date(vs[0].t).toLocaleString() : '', vs.length ? new Date(vs[vs.length - 1].t).toLocaleString() : '', r.followUp || '',
      r.dm, r.dmTitle, r.phone || (r.g && r.g.phone) || b.phone, r.email, r.provider, r.contractEnd, r.currentSystem, r.dealInstall, r.dealMonthly, r.parcel && r.parcel.owner, r.parcel && [r.parcel.mail, r.parcel.mailCity].filter(Boolean).join(', '),
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
   <h2 class="sec" style="margin-left:0">Other</h2><div class="checkgrid"><button class="chip ${filters.permits ? 'on' : ''}" data-tog="permits"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f97316;margin-right:5px"></span>Permits</button>${state.plan && state.plan.date === todayStr() ? `<button class="chip ${filters.planOnly ? 'on' : ''}" data-tog="planOnly">Today's plan only</button>` : ''}</div>
   <div class="two" style="margin-top:14px"><button class="btn ghost" id="fClear">Clear all</button><button class="btn primary" id="fDone">Done</button></div>`);
  $('#modalBody').onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.set) { const set = t.dataset.set === 's' ? filters.statuses : t.dataset.set === 'c' ? filters.cats : filters.zips; set.has(t.dataset.val) ? set.delete(t.dataset.val) : set.add(t.dataset.val); t.classList.toggle('on'); }
    if (t.dataset.tog) { filters[t.dataset.tog] = !filters[t.dataset.tog]; t.classList.toggle('on'); }
    if (t.id === 'fClear') { filters.statuses.clear(); filters.cats.clear(); filters.zips.clear(); filters.planOnly = false; filters.permits = true; $('#modalBody').querySelectorAll('.chip.on').forEach(c => c.classList.remove('on')); const pc = $('#modalBody').querySelector('[data-tog=permits]'); if (pc) pc.classList.add('on'); }
    if (t.id === 'fDone') { hideModal(); $('#modalBody').onclick = null; }
    $('#filterDot').classList.toggle('hidden', !filterActive()); refreshAll();
  };
};
let st; $('#search').addEventListener('input', e => { clearTimeout(st); st = setTimeout(() => { filters.q = e.target.value; listLimit = 100; refreshAll(); if (filters.q && $('#view-map').classList.contains('active')) switchView('list'); }, 250); });

// ---------- help ----------
function showHelp() {
  showModal(`<div class="help"><h3>How Knock Map works</h3>
   <p>A map of every business in the territory. Walk in, tap the pin, tap what happened. That's it.</p>
   <h4>Pin colors</h4>
   <ul class="plain">${STATUSES.map(s => `<li><span class="pill" style="--c:${s.color}">${s.label}</span> ${s.hint}</li>`).join('')}<li><span class="pill" style="--c:#f97316">Permit</span> Something's being built or remodeled</li></ul>
   <h4>At the door</h4>
   <ul><li>Tap a pin (or a name in <b>Nearby</b>) to open the business.</li><li>Tap what happened under <b>Log this visit</b>. It saves the time. Tapped the wrong one? Hit <b>Undo</b>.</li><li>Set a follow-up date, fill in the decision maker, or <b>Scan a business card</b> to fill it in for you.</li><li><b>Next closest</b> jumps to the nearest place you haven't hit yet.</li></ul>
   <h4>Planning</h4>
   <ul><li><b>Plan</b> tab → <b>Plan my day</b> builds a route: follow-ups first, then the closest new doors. Open it in Google Maps 9 stops at a time.</li><li>Follow-ups that are due, contracts ending soon, and new permits all show up there too.</li><li><b>Landlords &amp; property managers</b> (bottom of Plan) lists who owns the most commercial buildings in the territory. On any business, <b>Who owns this property?</b> pulls the owner from county records.</li></ul>
   <h4>Good to know</h4>
   <ul><li>Booted somewhere? The pin fades and it's left out of plans for 60 days (change it in Settings → More).</li><li>Business missing from the map? Tap <b>+</b> on the map to add it.</li><li>The cloud icon at the top turns green when everything is backed up. Your data shows up on every device you connect.</li><li>Add it to your home screen so it opens like an app.</li></ul>
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
    landlordCache = (await kv.get('landlords')) || null;
  } catch (e) { console.warn('storage unavailable', e); }
  applyMoves(); reindex();
  initMap(); renderLegend(); drawMarkers(); renderFollow();
  setBadge(syncReady() ? 'ok' : 'off');
  startGPS();
  if (syncReady()) sync();
  if (!settings.geoRetry9) { settings.geoRetry9 = true; for (const p of Object.values(state.permits || {})) if (p.geoFail) { p.geoFail = false; p.updatedAt = Date.now(); } }
  setTimeout(() => { if (Object.values(state.permits || {}).some(p => p.status === 'new' && p.lat == null && !p.geoFail)) geocodePermits(); }, 5000);
  if (!BIZ.length) switchView('settings');
  if (!settings.seenHelp) { settings.seenHelp = true; saveLocalSoon(); setTimeout(showHelp, 600); }
  else if (!BIZ.length) toast('Start here: tap "Load businesses"');
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__km = { get state() { return state; }, get BIZ() { return BIZ; }, logOutcome, openBiz, sync, mergeInto, zipOf, loadBusinesses };
})();
})();
