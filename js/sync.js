/* Knock Map: Loading businesses from OpenStreetMap and cloud backup/sync through GitHub */
'use strict';

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
  const m = Object.assign(blankState(), remote, local); // keep anything a newer version added
  for (const k of ['records', 'custom', 'permits', 'customers', 'leases']) m[k] = {};
  for (const key of ['records', 'custom', 'permits', 'customers', 'leases']) {
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
  // a cleared plan stays cleared on every device
  m.planClearedAt = Math.max(local.planClearedAt || 0, remote.planClearedAt || 0);
  if (m.plan && (m.plan.at || 0) <= m.planClearedAt) m.plan = null;
  m.prefs = ((local.prefs || {}).at || 0) >= ((remote.prefs || {}).at || 0) ? (local.prefs || {}) : (remote.prefs || {});
  m.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  m.appVer = Math.max(APP_VER, local.appVer || 0, remote.appVer || 0);
  return m;
}
let syncing = false, syncAgain = false;
function oldVersion() {
  // another device saved with a newer version: don't overwrite its data, get this one updated
  if (document.getElementById('oldVer')) return;
  const d = document.createElement('div'); d.id = 'oldVer'; d.className = 'oldver';
  d.innerHTML = 'This device has an older version of Knock Map. <button class="btn primary" id="oldVerGo">Update now</button>';
  document.body.appendChild(d);
  d.querySelector('#oldVerGo').onclick = async () => {
    try { const regs = await navigator.serviceWorker.getRegistrations(); for (const r of regs) await r.unregister(); const ks = await caches.keys(); for (const k of ks) await caches.delete(k); } catch (e) {}
    location.reload();
  };
}
async function sync(manual) {
  if (!syncReady()) { setBadge('off'); return; }
  if (syncing) { syncAgain = true; return; }
  syncing = true; setBadge('busy');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { sha, data } = await pullRemote();
      if (data && (data.appVer || 0) > APP_VER) { oldVersion(); throw new Error('This device has an old version of the app'); }
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
