/* Knock Map: Statuses, storage, app state and business lookups */
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
  { k: 'quote',      label: 'Building quote',  color: '#ec4899', hint: 'Had the appointment, putting the quote together' },
  { k: 'sent',       label: 'Quote sent',      color: '#84cc16', hint: 'Quote is in their hands, waiting on a yes' },
  { k: 'sold',       label: 'Sold',            color: '#16a34a', hint: 'Closed the deal' },
  { k: 'dead',       label: 'Not a fit',       color: '#334155', hint: 'Don\'t come back' },
];
const S = Object.fromEntries(STATUSES.map(s => [s.k, s]));
const CONVO = new Set(['dm', 'followup', 'appt', 'quote', 'sent', 'sold']);
const DEAL_STAGES = ['appt', 'quote', 'sent'];
const DOOR = ['closed', 'booted', 'gatekeeper', 'dm', 'followup', 'appt'], STAGE = ['quote', 'sent', 'sold', 'dead']; // reached a decision maker
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
// Each rep's copy sets window.KM_USER in its own index.html (e.g. brooke/). Nathan's copy has none.
const KM_USER = window.KM_USER || {};
const KM_ID = KM_USER.id || '';
const KM_BASE = KM_USER.base || '';

// ---------- tiny IndexedDB key-value ----------
const kv = (() => {
  let dbp;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(KM_ID ? 'knockmap-' + KM_ID : 'knockmap', 1);
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
let filters = { statuses: new Set(), cats: new Set(), zips: new Set(), q: '', planOnly: false, permits: true, customers: true, resCustomers: true, leases: true, sites: true };
let lastUndo = null;
let dirty = false;

const APP_VER = 29;
function blankState() { return { v: 1, records: {}, custom: {}, hidden: {}, fields: [], permits: {}, customers: {}, leases: {}, plan: null, prefs: {}, updatedAt: 0 }; }

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
  // names you've corrected (saved on the record so they sync)
  return out.map(b => { const r = state.records[b.id]; return r && r.rename ? Object.assign({}, b, { name: r.rename, origName: b.name }) : b; });
}
let bizIndex = new Map();
function reindex() { bizIndex = new Map(allBiz().map(b => [b.id, b])); if (typeof reindexCustomers === 'function') reindexCustomers(); }
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
