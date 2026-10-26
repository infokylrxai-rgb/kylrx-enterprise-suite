/**
 * Lists the composite indexes the code's Firestore queries need and reports those missing from
 * firestore.indexes.json. Run: node scripts/check-indexes.js (exit 1 when something is missing).
 * It reads client query(...) calls and server db.collection(..).where(..).orderBy(..) chains, and checks them
 * as written and with orgId added (tenant read scoping adds where('orgId' ==) to every query).
 * Blind spot: a query built over several statements (let q = ...; q = q.where(...)) is not seen; routes/data.js
 * attendance is one, its indexes are in the file by hand.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'netlify_site', 'tests', 'assets', 'vendor']);
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(d, e.name)); }
    else if (/\.(js|mjs|html)$/.test(e.name) && e.name !== 'check-indexes.js') files.push(path.join(d, e.name));
  }
})(ROOT);

function balanced(src, open) { // index of the matching ')' for '(' at open, skipping strings
  let depth = 0, q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function splitArgs(s) {
  const out = []; let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i]; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const lit = (s) => { const m = /^['"`]([^'"`]*)['"`]$/.exec((s || '').trim()); return m ? m[1] : null; };
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

function lastCollectionName(args) { // args of collection(db, 'a', x, 'b') or collection('a')
  const strs = args.map(lit);
  const names = strs.filter((x, i) => x !== null && !(i === 0 && /^db$/.test(args[0])));
  return names.length ? names[names.length - 1] : '(dynamic)';
}

const found = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  // client: query(base, ...constraints)
  const reQ = /(?<![\w.])query\(/g;
  let m;
  while ((m = reQ.exec(src))) {
    const open = m.index + 'query'.length;
    const close = balanced(src, open);
    if (close < 0) continue;
    const args = splitArgs(src.slice(open + 1, close));
    if (!/collection(Group)?\(/.test(args[0] || '')) continue;
    const baseArgs = splitArgs((args[0].match(/collection(?:Group)?\((.*)\)\s*$/s) || [])[1] || '');
    const col = lastCollectionName(baseArgs);
    const cons = args.slice(1).map(a => {
      let w = /^where\((.*)\)$/s.exec(a); if (w) { const p = splitArgs(w[1]); return { t: 'where', f: lit(p[0]) || p[0], op: lit(p[1]) || p[1] }; }
      if (/^whereMyOrg\(\)/.test(a)) return { t: 'where', f: 'orgId', op: '==' };
      let o = /^orderBy\((.*)\)$/s.exec(a); if (o) { const p = splitArgs(o[1]); return { t: 'order', f: lit(p[0]) || p[0], dir: (lit(p[1]) || 'asc').toLowerCase() }; }
      return null;
    }).filter(Boolean);
    found.push({ file: rel, line: lineOf(src, m.index), col, cons, kind: 'client' });
  }
  // server: .collection('x') chains
  const reC = /(?:db|firestore\(\)|rawCollection)\.collection\(|\.collection\(/g;
  while ((m = reC.exec(src))) {
    const open = m.index + m[0].length - 1;
    const close = balanced(src, open);
    if (close < 0) continue;
    const col = lastCollectionName(splitArgs(src.slice(open + 1, close)));
    let pos = close + 1; const cons = [];
    for (;;) {
      const rest = src.slice(pos);
      const cm = /^\s*\.(where|orderBy|limit|offset|select|startAfter|startAt|endAt|endBefore|get|count|onSnapshot|doc|stream)\(/.exec(rest);
      if (!cm) break;
      const o = pos + cm[0].length - 1;
      const c = balanced(src, o);
      if (c < 0) break;
      const p = splitArgs(src.slice(o + 1, c));
      if (cm[1] === 'where') cons.push({ t: 'where', f: lit(p[0]) || p[0], op: lit(p[1]) || p[1] });
      if (cm[1] === 'orderBy') cons.push({ t: 'order', f: lit(p[0]) || p[0], dir: (lit(p[1]) || 'asc').toLowerCase() });
      if (cm[1] === 'doc') break;
      pos = c + 1;
      if (/^(get|count|onSnapshot|stream)$/.test(cm[1])) break;
    }
    if (cons.length) found.push({ file: rel, line: lineOf(src, m.index), col, cons, kind: 'server' });
  }
}

const EQ = new Set(['==', 'in', 'array-contains', 'array-contains-any']);
const INEQ = new Set(['<', '<=', '>', '>=', '!=', 'not-in']);
function needs(q, withOrg) {
  const eq = new Set(), ineq = new Set(), ord = [], arr = new Set();
  for (const c of q.cons) {
    if (c.t === 'where') { if (EQ.has(c.op)) { eq.add(c.f); if (c.op === 'array-contains') arr.add(c.f); } else if (INEQ.has(c.op)) ineq.add(c.f); }
    else ord.push(c);
  }
  if (withOrg) eq.add('orgId');
  const orderFields = ord.filter(o => !eq.has(o.f) || true);
  const extra = orderFields.filter(o => !(eq.has(o.f) && ord.length === 1 && false));
  const fields = [];
  const eqFields = [...eq].filter(f => !ord.some(o => o.f === f) && !ineq.has(f)).sort();
  const needComposite = (ord.filter(o => !ineq.has(o.f)).length > 0 && (eqFields.length > 0 || ineq.size > 0)) || (ineq.size > 0 && eqFields.length > 0) || ord.length > 1;
  if (!needComposite) return null;
  eqFields.forEach(f => fields.push(arr.has(f) ? { fieldPath: f, arrayConfig: 'CONTAINS' } : { fieldPath: f, order: 'ASCENDING' }));
  ineq.forEach(f => { if (!ord.some(o => o.f === f)) fields.push({ fieldPath: f, order: 'ASCENDING' }); });
  ord.forEach(o => { if (!eqFields.includes(o.f)) fields.push({ fieldPath: o.f, order: o.dir === 'desc' ? 'DESCENDING' : 'ASCENDING' }); });
  return fields;
}

const existing = JSON.parse(fs.readFileSync(path.join(ROOT, 'firestore.indexes.json'), 'utf8')).indexes;
// the equality prefix can be in any order; the last field is the ordered one
const sig = (col, fields) => { const k = fields.map(f => `${f.fieldPath}:${f.order || f.arrayConfig}`); return col + '|' + k.slice(0, -1).sort().join(',') + '|' + k[k.length - 1]; };
const have = new Set(existing.map(i => sig(i.collectionGroup, i.fields)));
const report = new Map();
for (const q of found) {
  const orgInQuery = q.cons.some(c => c.t === 'where' && c.f === 'orgId');
  // today: as written. When tenant read scoping is on (client TENANT_READ_SCOPING / server wrapper), orgId is added to every query
  for (const [mode, withOrg] of [['as written', false], ['with orgId added', true]]) {
    if (q.col === '(dynamic)') continue;
    const f = needs(q, withOrg);
    if (!f) continue;
    const s = sig(q.col, f);
    const key = s + '|' + mode;
    if (!report.has(key)) report.set(key, { col: q.col, fields: f, mode, have: have.has(s), where: [] });
    report.get(key).where.push(`${q.file}:${q.line}${q.kind === 'server' ? ' (server)' : ''}`);
  }
}
const rows = [...report.values()].sort((a, b) => a.col.localeCompare(b.col));
console.log(`queries scanned: ${found.length}, files: ${files.length}`);
for (const mode of ['as written', 'with orgId added']) {
  console.log(`\n=== ${mode}: composite indexes the queries need ===`);
  for (const r of rows.filter(r => r.mode === mode)) {
    console.log(`${r.have ? 'HAVE   ' : 'MISSING'} ${r.col}  (${r.fields.map(f => f.fieldPath + ' ' + (f.order || f.arrayConfig)[0]).join(', ')})  <- ${r.where.slice(0, 3).join('; ')}${r.where.length > 3 ? ` +${r.where.length - 3}` : ''}`);
  }
}
const dyn = found.filter(q => q.col === '(dynamic)' && q.cons.length > 1);
console.log(`\n(dynamic collection, not analysed: ${dyn.length})`);
dyn.forEach(q => console.log(`  ${q.file}:${q.line} ${JSON.stringify(q.cons.map(c => c.f + (c.op || c.dir || '')))}`));
const missing = rows.filter(r => !r.have);
console.log(missing.length ? `\n${missing.length} MISSING from firestore.indexes.json` : '\nAll needed composite indexes are in firestore.indexes.json');
module.exports = { missing };
if (require.main === module) process.exit(missing.length ? 1 : 0);
