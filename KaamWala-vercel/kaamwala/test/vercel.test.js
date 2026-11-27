'use strict';
// The Vercel entry (api/index.js): several short-lived copies of the app sharing one Firebase database.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const { createHandler } = require('../api/index');
const { ENV, ROOT, quiet, fakeGoogle } = require('./fake-google');
const { PHONES } = require('./helpers');

async function copy(env, g) {
  const server = http.createServer(createHandler({ BASE_URL: 'http://test', ...env }, { fetchImpl: g?.fetch, log: quiet }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (token, path, body, method) => {
    const res = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, type: res.headers.get('content-type') };
  };
  return { base, call, close: () => server.close() };
}

test('without Firebase settings, Vercel shows a clear setup message', async () => {
  const a = await copy({});
  try {
    const page = await a.call(null, '/');
    assert.strictEqual(page.status, 503);
    assert.match(page.data, /FIREBASE_SERVICE_ACCOUNT_JSON/);
    assert.strictEqual((await a.call(null, '/api/workers')).status, 503);
  } finally { a.close(); }
});

test('two Vercel copies share one Firebase database: data is saved before each response and seen by the other copy', async () => {
  const g = fakeGoogle();
  const a = await copy(ENV, g);
  const b = await copy(ENV, g);
  try {
    const home = await a.call(null, '/');
    assert.strictEqual(home.status, 200);
    assert.match(home.type, /text\/html/);

    // a new customer registered on copy A is in Firebase as soon as the response arrives
    const reg = await a.call(null, '/api/register', { role: 'customer', name: 'Sara Malik', phone: '03111234567', password: 'secret123', city: 'Lahore', otp: '1234' });
    assert.strictEqual(reg.status, 200, JSON.stringify(reg.data));
    assert.strictEqual(g.docs.get(`${ROOT}/users/${reg.data.user.id}`).name.stringValue, 'Sara Malik');

    // copy B (started on another machine) can log her in, and copy A accepts B's login
    const login = await b.call(null, '/api/login', { phone: '03111234567', otp: '1234' });
    assert.strictEqual(login.status, 200, JSON.stringify(login.data));
    const me = await a.call(login.data.token, '/api/me');
    assert.strictEqual(me.status, 200);
    assert.strictEqual((me.data.user || me.data).name, 'Sara Malik');

    // a change on A shows up on B
    const ahmed = (await a.call(null, '/api/login', { phone: PHONES.ahmed, otp: '1234' })).data.token;
    assert.strictEqual((await a.call(ahmed, '/api/me', { name: 'Ahmed K.' }, 'PATCH')).status, 200);
    const seen = await b.call(ahmed, '/api/me');
    assert.strictEqual((seen.data.user || seen.data).name, 'Ahmed K.');

    // a photo uploaded through A can be opened through B (B has never seen the file on its disk)
    const photo = crypto.randomBytes(1_200_000);
    const up = await fetch(`${a.base}/api/uploads?purpose=booking`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${ahmed}` }, body: photo }).then(async (r) => ({ status: r.status, data: await r.json() }));
    assert.strictEqual(up.status, 200, JSON.stringify(up.data));
    const got = await fetch(b.base + up.data.url, { headers: { Authorization: `Bearer ${ahmed}` } });
    assert.strictEqual(got.status, 200);
    assert.ok(Buffer.from(await got.arrayBuffer()).equals(photo));

    // when nothing changed, a request costs one small Firestore read, not a reload
    const before = g.docs.size;
    assert.strictEqual((await b.call(ahmed, '/api/me')).status, 200);
    assert.strictEqual(g.docs.size, before);
  } finally { a.close(); b.close(); }
});

test('if Firebase is down, API requests fail clearly instead of using stale data', async () => {
  const g = fakeGoogle();
  const a = await copy(ENV, g);
  try {
    assert.notStrictEqual((await a.call(null, '/api/workers')).status, 503);
    g.down = true;
    const r = await a.call(null, '/api/workers');
    assert.strictEqual(r.status, 503);
    g.down = false;
    assert.notStrictEqual((await a.call(null, '/api/workers')).status, 503);
  } finally { a.close(); }
});
