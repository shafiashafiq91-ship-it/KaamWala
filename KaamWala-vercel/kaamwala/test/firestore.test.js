'use strict';
// Firebase database (Firestore) storage, tested against an in-memory fake of Firestore's REST API.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const firestore = require('../src/firestore');
const { start, PHONES } = require('./helpers');

const { SA, ENV, ROOT, quiet, fakeGoogle } = require('./fake-google');

test('value conversion keeps numbers, text, null and decimals', () => {
  for (const v of [0, 42, -7, 3.25, 'Rs 1,500 / اردو', null, '']) assert.strictEqual(firestore.fromValue(firestore.toValue(v)), v);
});

test('first start uploads everything, changes are saved, and a fresh server loads them back', async () => {
  const g = fakeGoogle();
  const a = await start();
  try {
    const sync = await firestore.attach(a.db, ENV, { fetchImpl: g.fetch, intervalMs: 1e9, log: quiet });
    const users = a.db.prepare('SELECT COUNT(*) n FROM users').get().n;
    assert.ok(users > 3);
    assert.strictEqual(g.coll('users').length, users, 'all users uploaded');
    assert.strictEqual(g.coll('workers').length, a.db.prepare('SELECT COUNT(*) n FROM workers').get().n);

    // a new account and a login are saved to Firebase
    const token = await a.login(PHONES.ahmed);
    const reg = await a.call(null, '/api/register', { role: 'customer', name: 'Sara Malik', phone: '03111234567', password: 'secret123', city: 'Lahore', otp: '1234' });
    assert.strictEqual(reg.status, 200);
    await a.call(token, '/api/me', { name: 'Ahmed K.' }, 'PATCH');
    await sync.flush();
    const sara = g.docs.get(`${ROOT}/users/${reg.data.user.id}`);
    assert.strictEqual(sara.name.stringValue, 'Sara Malik');
    assert.strictEqual(sara.phone.stringValue, '03111234567');
    const ahmedId = a.db.prepare('SELECT id FROM users WHERE phone = ?').get(PHONES.ahmed).id;
    assert.strictEqual(g.docs.get(`${ROOT}/users/${ahmedId}`).name.stringValue, 'Ahmed K.');

    // logging out deletes the session row, and its Firestore document
    const sessionsBefore = g.coll('sessions').length;
    await a.call(reg.data.token, '/api/logout', {});
    await sync.flush();
    assert.strictEqual(g.coll('sessions').length, sessionsBefore - 1);
    sync.stop();

    // A brand new server (its own fresh demo data) picks up everything from Firebase.
    const b = await start();
    try {
      await firestore.attach(b.db, ENV, { fetchImpl: g.fetch, intervalMs: 1e9, log: quiet });
      assert.strictEqual(b.db.prepare('SELECT name FROM users WHERE phone = ?').get(PHONES.ahmed).name, 'Ahmed K.');
      assert.ok(b.db.prepare("SELECT 1 FROM users WHERE phone = '03111234567'").get(), 'Sara is there');
      for (const t of ['users', 'workers', 'bookings', 'payments', 'escrows', 'ledger', 'user_roles', 'sessions'])
        assert.strictEqual(b.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, g.coll(t).length, t);
      // Ahmed's login from the first server still works on the second one
      assert.strictEqual((await b.call(token, '/api/me')).status, 200);
      // and new ids don't clash with old ones
      const r2 = await b.call(null, '/api/register', { role: 'customer', name: 'Bilal Ahmad', phone: '03121234567', password: 'secret123', city: 'Lahore', otp: '1234' });
      assert.strictEqual(r2.status, 200);
      assert.ok(r2.data.user.id > reg.data.user.id);
    } finally { b.close(); }
  } finally { a.close(); }
});

test('if Firebase is down, changes wait and are saved once it is back', async () => {
  const g = fakeGoogle();
  const a = await start();
  try {
    const sync = await firestore.attach(a.db, ENV, { fetchImpl: g.fetch, intervalMs: 1e9, log: quiet });
    const ahmedId = a.db.prepare('SELECT id FROM users WHERE phone = ?').get(PHONES.ahmed).id;
    const token = await a.login(PHONES.ahmed);
    g.down = true;
    await a.call(token, '/api/me', { name: 'Offline Edit' }, 'PATCH');
    await assert.rejects(sync.flush());
    assert.notStrictEqual(g.docs.get(`${ROOT}/users/${ahmedId}`).name.stringValue, 'Offline Edit');
    g.down = false;
    await sync.flush();
    assert.strictEqual(g.docs.get(`${ROOT}/users/${ahmedId}`).name.stringValue, 'Offline Edit');
    sync.stop();
  } finally { a.close(); }
});

test('a bad service account key is reported clearly', async () => {
  const g = fakeGoogle();
  const a = await start();
  const wrong = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  try {
    await assert.rejects(firestore.attach(a.db, { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...SA, private_key: wrong }) }, { fetchImpl: g.fetch, log: quiet }), /Firestore login failed/);
  } finally { a.close(); }
});

test('uploaded photos and CNIC documents are kept in Firebase and come back after the disk is wiped', async () => {
  const fs = require('node:fs');
  const g = fakeGoogle();
  const a = await start(ENV, ':memory:', g.fetch);
  try {
    const worker = a.db.prepare("SELECT u.phone FROM users u JOIN workers w ON w.user_id = u.id ORDER BY u.id LIMIT 1").get().phone;
    const token = await a.login(worker);
    const photo = crypto.randomBytes(2_000_000); // bigger than one Firestore document
    const up = await a.upload(token, photo, 'image/jpeg');
    assert.strictEqual(up.status, 200);
    assert.strictEqual(g.coll('_files').length, 1 + 3, 'one info record + 3 pieces');

    // the host restarts with an empty disk: the photo is fetched back from Firebase
    const file = a.db.prepare('SELECT path FROM media WHERE id = ?').get(up.data.id).path;
    fs.rmSync(file);
    const res = await fetch(a.base + up.data.url, { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(res.status, 200);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(photo));
    assert.ok(fs.existsSync(file), 'cached on disk again');

    // a private CNIC document is saved too
    const cnic = crypto.randomBytes(5000);
    const d = await fetch(`${a.base}/api/worker/documents?kind=cnic_front`, { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` }, body: cnic }).then((r) => r.json());
    assert.ok(d.id, JSON.stringify(d));
    assert.ok(g.coll('_files').some((n) => n.includes(`/private__${d.id}`)));

    // deleting a portfolio photo deletes it from Firebase too
    const pf = await fetch(`${a.base}/api/uploads?purpose=portfolio`, { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` }, body: cnic }).then((r) => r.json());
    assert.ok(g.coll('_files').some((n) => n.includes(`/${pf.id}`)));
    assert.strictEqual((await a.call(token, `/api/worker/portfolio/${pf.id}`, null, 'DELETE')).status, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(!g.coll('_files').some((n) => n.includes(`/${pf.id}`)), 'removed from Firebase');

    // if Firebase is down, the upload fails clearly instead of being lost later
    g.down = true;
    assert.strictEqual((await a.upload(token, photo, 'image/jpeg')).status, 503);
  } finally { a.close(); }
});
