'use strict';
// Firebase database (Cloud Firestore) storage for all app data.
//
// How it works: the app keeps running its fast local SQLite database exactly as before, and Firestore
// is the permanent copy. Every SQLite table is a Firestore collection (users, bookings, payments, ...)
// and every row is a document.
//   - On start: if Firestore already has data, the local database is replaced with it. If Firestore is
//     empty (first run), everything in the local database is uploaded.
//   - While running: SQLite triggers note every inserted / changed / deleted row, and those rows are
//     written to Firestore about once a second (and on shutdown).
// So the app can run on a host with no permanent disk and still keep its data, and you can see all
// data live in the Firebase console. Run one copy of the server at a time.
//
// Talks to Firestore's REST API with a service account key; no npm packages needed.
const fs = require('node:fs');
const crypto = require('node:crypto');

const SCOPE = 'https://www.googleapis.com/auth/datastore';

function serviceAccount(env) {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (env.FIREBASE_SERVICE_ACCOUNT) return JSON.parse(fs.readFileSync(env.FIREBASE_SERVICE_ACCOUNT, 'utf8'));
  return null;
}
const enabled = (env) => !!(env.FIREBASE_SERVICE_ACCOUNT || env.FIREBASE_SERVICE_ACCOUNT_JSON || (env.FIRESTORE_EMULATOR_HOST && env.FIREBASE_PROJECT_ID));

// ---------- value conversion (SQLite row <-> Firestore fields) ----------
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'bigint') return { integerValue: String(v) };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { integerValue: v ? '1' : '0' };
  if (v instanceof Uint8Array) return { bytesValue: Buffer.from(v).toString('base64') };
  return { stringValue: String(v) };
}
function fromValue(v) {
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue ? 1 : 0;
  if ('bytesValue' in v) return Buffer.from(v.bytesValue, 'base64');
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  return JSON.stringify(v); // maps/arrays someone added by hand in the console
}

// ---------- Firestore REST client ----------
function client(env, fetchImpl = fetch) {
  const sa = serviceAccount(env);
  const project = env.FIREBASE_PROJECT_ID || sa?.project_id;
  if (!project) throw new Error('Firestore: set FIREBASE_PROJECT_ID or use a service account key file');
  const emu = env.FIRESTORE_EMULATOR_HOST;
  const base = emu ? `http://${emu}/v1` : 'https://firestore.googleapis.com/v1';
  const root = `projects/${project}/databases/${env.FIRESTORE_DATABASE || '(default)'}/documents`;

  const reach = (url, opts) => fetchImpl(url, opts).catch((e) => { throw new Error(`Could not reach Firebase (${e.cause?.code || e.message}). Check the internet connection and the Firebase settings in .env.`); });
  let cached = null;
  async function token() {
    if (emu) return 'owner';
    if (cached && cached.exp > Date.now() + 60e3) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
    const unsigned = `${b({ alg: 'RS256', typ: 'JWT' })}.${b({ iss: sa.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 })}`;
    const jwt = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url')}`;
    const res = await reach(aud, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Firestore login failed: ${data.error_description || data.error || res.status}`);
    cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
    return cached.token;
  }
  async function call(method, url, body) {
    const res = await reach(`${base}/${url}`, { method, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Firestore ${res.status}: ${data.error?.message || 'request failed'}`);
    return data;
  }
  const docName = (coll, id) => `${root}/${coll}/${id}`;
  return {
    project,
    docName,
    async list(coll) {
      const out = [];
      let pageToken = '';
      do {
        const d = await call('GET', `${root}/${coll}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
        out.push(...(d.documents || []));
        pageToken = d.nextPageToken || '';
      } while (pageToken);
      return out;
    },
    // One document, or null if it does not exist.
    async get(coll, id) {
      try { return await call('GET', `${root}/${coll}/${encodeURIComponent(id)}`); } catch (e) { if (e.message.startsWith('Firestore 404')) return null; throw e; }
    },
    async hasAny(coll) { return !!(await call('GET', `${root}/${coll}?pageSize=1`)).documents?.length; },
    async commit(writes) { for (let i = 0; i < writes.length; i += 500) await call('POST', `${root}:commit`, { writes: writes.slice(i, i + 500) }); },
  };
}

// ---------- SQLite side ----------
const q = (name) => `"${name.replace(/"/g, '""')}"`;
function tablesOf(db) {
  return db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((t) => {
    const cols = db.prepare(`PRAGMA main.table_info(${q(t.name)})`).all();
    const pk = cols.filter((c) => c.pk);
    // A single INTEGER PRIMARY KEY column *is* the rowid, so it must not be inserted twice.
    const rowidAlias = pk.length === 1 && pk[0].type.toUpperCase() === 'INTEGER' ? pk[0].name : null;
    return { name: t.name, cols: cols.map((c) => c.name), rowidAlias };
  });
}
const rowToFields = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== '__rid').map(([k, v]) => [k, toValue(v)]));

function installTriggers(db, tables) {
  db.exec('CREATE TEMP TABLE IF NOT EXISTS _fs_changes (tbl TEXT NOT NULL, rid INTEGER NOT NULL, PRIMARY KEY (tbl, rid))');
  for (const t of tables) {
    const lit = `'${t.name.replace(/'/g, "''")}'`;
    const n = (op) => q(`_fs_${t.name}_${op}`);
    db.exec(`
      CREATE TEMP TRIGGER IF NOT EXISTS ${n('i')} AFTER INSERT ON main.${q(t.name)} BEGIN INSERT OR IGNORE INTO _fs_changes VALUES (${lit}, NEW.rowid); END;
      CREATE TEMP TRIGGER IF NOT EXISTS ${n('u')} AFTER UPDATE ON main.${q(t.name)} BEGIN
        INSERT OR IGNORE INTO _fs_changes VALUES (${lit}, NEW.rowid); INSERT OR IGNORE INTO _fs_changes VALUES (${lit}, OLD.rowid); END;
      CREATE TEMP TRIGGER IF NOT EXISTS ${n('d')} AFTER DELETE ON main.${q(t.name)} BEGIN INSERT OR IGNORE INTO _fs_changes VALUES (${lit}, OLD.rowid); END;`);
  }
}

// Replace everything in the local database with what Firestore holds.
function loadInto(db, tables, docsByTable) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    try {
      for (const t of tables) {
        db.exec(`DELETE FROM main.${q(t.name)}`);
        for (const d of docsByTable[t.name] || []) {
          const rid = Number(d.name.split('/').pop());
          if (!Number.isSafeInteger(rid)) continue;
          const fields = Object.fromEntries(Object.entries(d.fields || {}).filter(([k]) => t.cols.includes(k)).map(([k, v]) => [k, fromValue(v)]));
          if (t.rowidAlias) fields[t.rowidAlias] = rid;
          const keys = Object.keys(fields);
          const names = [...(t.rowidAlias ? [] : ['rowid']), ...keys];
          const vals = [...(t.rowidAlias ? [] : [rid]), ...keys.map((k) => fields[k])];
          db.prepare(`INSERT INTO main.${q(t.name)} (${names.map(q).join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...vals);
        }
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  } finally { db.exec('PRAGMA foreign_keys = ON'); }
}

// Connect a running app's database to Firestore. Resolves once the data is in place; returns { flush, stop, refresh }.
// shared: true is for hosts that may run several copies at once (Vercel). Every save then also writes a
// version stamp (_meta/version), and refresh() reloads the local copy when another copy has saved since.
async function attach(db, env, { fetchImpl = fetch, intervalMs = 1000, log = console, shared = false } = {}) {
  const fsc = client(env, fetchImpl);
  const tables = tablesOf(db);
  const META = ['_meta', 'version'];
  const stamp = () => ({ update: { name: fsc.docName(...META), fields: { v: toValue(crypto.randomUUID()) } } });
  const versionOf = async () => (await fsc.get(...META))?.fields?.v?.stringValue ?? null;
  let seen = null;

  if (await fsc.hasAny('users')) {
    const docs = {};
    if (shared) seen = await versionOf();
    for (const t of tables) docs[t.name] = await fsc.list(t.name);
    loadInto(db, tables, docs);
    log.log(`Firestore: loaded data from Firebase project ${fsc.project}`);
  } else {
    const writes = [];
    for (const t of tables) for (const row of db.prepare(`SELECT rowid AS __rid, * FROM main.${q(t.name)}`).all())
      writes.push({ update: { name: fsc.docName(t.name, row.__rid), fields: rowToFields(row) } });
    if (shared) { const s = stamp(); writes.push(s); seen = s.update.fields.v.stringValue; }
    await fsc.commit(writes);
    log.log(`Firestore: Firebase project ${fsc.project} was empty, uploaded ${writes.length} records`);
  }
  installTriggers(db, tables);

  const pending = db.prepare('SELECT tbl, rid FROM _fs_changes LIMIT 2000');
  const drop = db.prepare('DELETE FROM _fs_changes WHERE tbl = ? AND rid = ?');
  const readd = db.prepare('INSERT OR IGNORE INTO _fs_changes VALUES (?, ?)');
  const readers = {};
  const read = (tbl, rid) => (readers[tbl] ||= db.prepare(`SELECT rowid AS __rid, * FROM main.${q(tbl)} WHERE rowid = ?`)).get(rid);

  let running = null;
  async function flushOnce() {
    const changes = pending.all();
    if (!changes.length) return 0;
    const writes = changes.map(({ tbl, rid }) => {
      const row = read(tbl, rid);
      return row ? { update: { name: fsc.docName(tbl, rid), fields: rowToFields(row) } } : { delete: fsc.docName(tbl, rid) };
    });
    let s = null;
    if (shared) { s = stamp(); writes.push(s); } // same commit, so data and stamp are saved together
    for (const c of changes) drop.run(c.tbl, c.rid);
    try { await fsc.commit(writes); if (s) seen = s.update.fields.v.stringValue; } catch (e) { for (const c of changes) readd.run(c.tbl, c.rid); throw e; }
    return changes.length;
  }
  // Writes everything changed so far. Safe to call any time; calls never overlap.
  async function flush() {
    while (running) await running.catch(() => {});
    running = (async () => { while ((await flushOnce()) === 2000); })();
    try { await running; } finally { running = null; }
  }
  // shared mode: if another copy of the app saved since we last looked, reload everything from Firestore.
  // Costs one Firestore read when nothing changed. Returns true if the data was reloaded.
  async function refresh() {
    for (let tries = 0; tries < 3; tries++) {
      const v = await versionOf();
      if (v === seen) return false;
      await flush(); // our own unsaved changes go first, so the reload includes them
      const docs = {};
      for (const t of tables) docs[t.name] = await fsc.list(t.name);
      if (pending.all().length) continue; // a request changed data while we were reading; read again
      loadInto(db, tables, docs);
      db.exec('DELETE FROM _fs_changes'); // the reload itself is not a change to save
      seen = v;
      return true;
    }
    return false;
  }
  let failing = false;
  const timer = setInterval(() => flush().then(() => { if (failing) log.log('Firestore: saving works again'); failing = false; },
    (e) => { if (!failing) log.error(`Firestore: could not save changes, will keep retrying. ${e.message}`); failing = true; }), intervalMs);
  timer.unref();
  return { flush, refresh, stop: () => clearInterval(timer), project: fsc.project };
}

module.exports = { enabled, attach, client, toValue, fromValue };
