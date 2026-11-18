/* Business card scanning: reads the card on the phone (Tesseract.js, free, no key) and pulls out the useful bits. */
(function () {
'use strict';
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let loading;
function loadTess() {
  if (window.Tesseract) return Promise.resolve();
  if (!loading) loading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = TESS; s.onload = res; s.onerror = () => { loading = null; rej(new Error('Could not load the card reader. Check your signal.')); };
    document.head.appendChild(s);
  });
  return loading;
}

// Shrink + clean up the photo: smaller is faster, grayscale + contrast reads better.
async function prepImage(file) {
  const bmp = await createImageBitmap(file);
  const max = 1800, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, w, h);
  // small color copy to keep as the card photo
  const ps = Math.min(1, 1000 / Math.max(w, h));
  const pc = document.createElement('canvas'); pc.width = Math.round(w * ps); pc.height = Math.round(h * ps);
  pc.getContext('2d').drawImage(c, 0, 0, pc.width, pc.height);
  const photo = pc.toDataURL('image/jpeg', 0.72);
  const d = x.getImageData(0, 0, w, h), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    let g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    g = Math.max(0, Math.min(255, (g - 128) * 1.5 + 128));
    p[i] = p[i + 1] = p[i + 2] = g;
  }
  x.putImageData(d, 0, 0);
  return { canvas: c, photo };
}

async function read(file, onProgress) {
  onProgress && onProgress('Loading card reader… (first time takes a few seconds)');
  await loadTess();
  const { canvas, photo } = await prepImage(file);
  const res = await Tesseract.recognize(canvas, 'eng', {
    logger: m => { if (m.status === 'recognizing text' && onProgress) onProgress('Reading card… ' + Math.round(m.progress * 100) + '%'); },
  });
  const lines = (res.data.lines || []).map(l => ({ text: l.text.trim(), h: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0 })).filter(l => l.text.length > 1);
  return { text: res.data.text, lines, photo };
}

const TITLE_RE = /\b(owner|co-?owner|president|vice president|vp|ceo|coo|cfo|cto|founder|partner|principal|director|manager|gm|general manager|supervisor|superintendent|coordinator|administrator|admin|executive|officer|operations|sales|agent|broker|realtor|consultant|specialist|associate|representative|rep|technician|estimator|foreman|dds|dmd|md|do|dvm|cpa|esq|attorney|pharmacist|office|chief|head|lead|controller|bookkeeper|receptionist|team|account)\b/i;
const COMPANY_RE = /\b(llc|l\.l\.c|inc|corp|co\.|company|group|services|service|solutions|enterprises|associates|partners|clinic|dental|medical|center|centre|studio|salon|shop|store|restaurant|grill|cafe|church|auto|motors|repair|plumbing|electric|roofing|construction|landscap|pest|insurance|realty|properties|storage|fitness|academy|school|bank|credit union|&)\b/i;
const STREET_RE = /\d+.*\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pkwy|parkway|hwy|highway|pl|place|cir|circle|trl|trail|suite|ste|unit|#)\b/i;
const PHONE_RE = /(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}(\s*(x|ext\.?)\s*\d+)?/gi;

function fmtPhone(s) { const d = s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s.trim(); }
function words(s) { return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); }

function parse(lines, bizName) {
  const out = { name: '', title: '', cell: '', phone: '', email: '', web: '', addr: '', company: '' };
  const used = new Set();
  const all = lines.map(l => l.text);
  // email
  for (let i = 0; i < all.length; i++) {
    const m = all[i].replace(/\s+@\s+/g, '@').match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
    if (m) { out.email = m[0].toLowerCase(); used.add(i); break; }
  }
  // website
  for (let i = 0; i < all.length; i++) {
    if (all[i].includes('@')) continue;
    const m = all[i].match(/((https?:\/\/)?(www\.)?[a-z0-9\-]+\.(com|net|org|biz|us|co|info|io|law|dental|health)(\/\S*)?)\b/i);
    if (m) { out.web = m[1].toLowerCase(); used.add(i); break; }
  }
  // phones, using labels when there are any
  const phones = [];
  all.forEach((t, i) => {
    const ms = t.match(PHONE_RE); if (!ms) return;
    used.add(i);
    ms.forEach((num, k) => {
      const before = (t.slice(0, t.indexOf(num)).slice(-14) + ' ').toLowerCase();
      let kind = 'other';
      if (/\b(c|cell|m|mobile|mob)\b[\s:.]*$/.test(before.trim()) || /(cell|mobile)/.test(before)) kind = 'cell';
      else if (/\b(f|fax)\b[\s:.]*$/.test(before.trim()) || /fax/.test(before)) kind = 'fax';
      else if (/(o|office|p|ph|phone|t|tel|main|direct|d)\b[\s:.]*$/.test(before.trim())) kind = 'office';
      phones.push({ num: fmtPhone(num), kind });
    });
  });
  const cell = phones.find(p => p.kind === 'cell');
  const office = phones.find(p => p.kind === 'office') || phones.find(p => p.kind === 'other');
  if (cell) out.cell = cell.num;
  if (office && (!cell || office.num !== cell.num)) out.phone = office.num;
  // address (street line, plus a city/state/zip line right after it)
  for (let i = 0; i < all.length; i++) {
    if (used.has(i)) continue;
    if (STREET_RE.test(all[i])) {
      out.addr = all[i]; used.add(i);
      if (all[i + 1] && /\b(AZ|Arizona)\b.*\d{5}/i.test(all[i + 1])) { out.addr += ', ' + all[i + 1]; used.add(i + 1); }
      break;
    }
  }
  if (!out.addr) for (let i = 0; i < all.length; i++) if (!used.has(i) && /\b(AZ|Arizona)\b\s*\d{5}/i.test(all[i])) { out.addr = all[i]; used.add(i); break; }
  // title
  let titleIdx = -1;
  for (let i = 0; i < all.length; i++) {
    if (used.has(i)) continue;
    if (TITLE_RE.test(all[i]) && all[i].split(/\s+/).length <= 6 && !COMPANY_RE.test(all[i].replace(/\b(sales|office|services?)\b/ig, ''))) { out.title = all[i]; titleIdx = i; used.add(i); break; }
  }
  // person's name: 2 to 4 words, letters only, not the company. Prefer the line right above the title.
  const bizW = new Set(words(bizName || ''));
  const looksLikeName = t => {
    const w = t.replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean);
    if (w.length < 2 || w.length > 4) return false;
    if (!w.every(x => /^[A-Za-z][A-Za-z'\-]*$/.test(x))) return false;
    if (COMPANY_RE.test(t) || TITLE_RE.test(t)) return false;
    const ww = words(t); if (ww.filter(x => bizW.has(x)).length >= Math.ceil(ww.length / 2)) return false;
    return true;
  };
  const order = [];
  if (titleIdx > 0) order.push(titleIdx - 1);
  if (titleIdx >= 0 && titleIdx + 1 < all.length) order.push(titleIdx + 1);
  for (let i = 0; i < all.length; i++) order.push(i);
  for (const i of order) if (!used.has(i) && looksLikeName(all[i])) { out.name = all[i].replace(/\s+/g, ' '); used.add(i); break; }
  // company: tallest unused line, or one with LLC/Inc/etc.
  let best = null;
  lines.forEach((l, i) => { if (used.has(i)) return; const score = l.h + (COMPANY_RE.test(l.text) ? 40 : 0); if (!best || score > best.score) best = { i, score }; });
  if (best) out.company = all[best.i];
  return out;
}

window.CardScan = { read, parse, fmtPhone };
})();
