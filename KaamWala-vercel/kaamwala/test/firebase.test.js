'use strict';
// Firebase Phone Login: the server only accepts a Firebase ID token that Google signed for this
// project, that is fresh, and whose phone number matches. Google's certificate URL is faked here.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const firebase = require('../src/firebase');
const { start, PHONES } = require('./helpers');

const PID = 'kaamwala-test';
const ENV = { FIREBASE_PROJECT_ID: PID, FIREBASE_API_KEY: 'test-key' };
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const certs = { k1: publicKey.export({ type: 'spki', format: 'pem' }) };

const realFetch = globalThis.fetch;
globalThis.fetch = (url, ...rest) => String(url).includes('securetoken@system.gserviceaccount.com')
  ? Promise.resolve(new Response(JSON.stringify(certs), { headers: { 'cache-control': 'max-age=3600' } }))
  : realFetch(url, ...rest);

const nowS = () => Math.floor(Date.now() / 1000);
function token(claims = {}, { key = privateKey, kid = 'k1' } = {}) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = nowS();
  const body = { iss: `https://securetoken.google.com/${PID}`, aud: PID, sub: 'uid1', iat: t, exp: t + 3600, auth_time: t, phone_number: '+923001234567', ...claims };
  const head = `${b({ alg: 'RS256', kid })}.${b(body)}`;
  return `${head}.${crypto.sign('RSA-SHA256', Buffer.from(head), key).toString('base64url')}`;
}

test('accepts a good token and returns the local phone number', async () => {
  firebase._resetCache();
  assert.strictEqual(await firebase.verifyPhoneToken(ENV, token()), '03001234567');
});

test('rejects tampered, foreign, expired, stale and phoneless tokens', async () => {
  const bad = [
    token({}, { key: other.privateKey }),
    token({}, { kid: 'nope' }),
    token({ aud: 'someone-else', iss: 'https://securetoken.google.com/someone-else' }),
    token({ exp: nowS() - 10 }),
    token({ auth_time: nowS() - 3600 }),
    token({ phone_number: undefined }),
    'not-a-token',
  ];
  for (const t of bad) await assert.rejects(firebase.verifyPhoneToken(ENV, t));
});

test('login and register go through Firebase when it is set up; 1234 stops working', async () => {
  const s = await start(ENV);
  try {
    const cfg = await s.call(null, '/api/auth-config');
    assert.deepStrictEqual(cfg.data.firebase, { apiKey: 'test-key', authDomain: `${PID}.firebaseapp.com`, projectId: PID });
    assert.strictEqual((await s.call(null, '/api/otp', { phone: PHONES.ahmed })).data.firebase, true);

    assert.strictEqual((await s.call(null, '/api/login', { phone: PHONES.ahmed, otp: '1234' })).status, 400);
    assert.strictEqual((await s.call(null, '/api/login', { phone: PHONES.ali, firebase_token: token() })).status, 400, 'token for another number');
    const ok = await s.call(null, '/api/login', { phone: PHONES.ahmed, firebase_token: token() });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.data.user.phone, PHONES.ahmed);
    // passwords still work
    assert.strictEqual((await s.call(null, '/api/login', { phone: PHONES.ahmed, password: 'kaam1234' })).status, 200);

    const reg = { role: 'customer', name: 'Sara Malik', phone: '03111234567', password: 'secret123', city: 'Lahore' };
    assert.strictEqual((await s.call(null, '/api/register', { ...reg, otp: '1234' })).status, 400);
    const r = await s.call(null, '/api/register', { ...reg, firebase_token: token({ phone_number: '+923111234567' }) });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  } finally { s.close(); }
});

test('without Firebase keys the demo code 1234 still works', async () => {
  const s = await start();
  try {
    assert.strictEqual((await s.call(null, '/api/auth-config')).data.firebase, null);
    assert.strictEqual((await s.call(null, '/api/login', { phone: PHONES.ahmed, otp: '1234' })).status, 200);
  } finally { s.close(); }
});
