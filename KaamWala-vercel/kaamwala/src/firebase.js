'use strict';
// Firebase Phone Login. When FIREBASE_PROJECT_ID and FIREBASE_API_KEY are set, the app screens ask
// Firebase to send the SMS code and the customer types it in. Firebase checks the code and gives the
// app a signed ID token. The server checks that token here (Google's signature, this project, fresh,
// and the phone number matches) before it logs anyone in. No npm packages: plain node:crypto.
const crypto = require('node:crypto');
const { normalizePhone } = require('./auth');

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const MAX_AGE_S = 10 * 60; // the SMS sign-in must have happened in the last 10 minutes

const enabled = (env) => !!(env.FIREBASE_PROJECT_ID && env.FIREBASE_API_KEY);

// What the app screens need to start Firebase. These values are public by design (they are in every
// Firebase web app); the real protection is the token check below plus the authorized domains list.
function clientConfig(env) {
  if (!enabled(env)) return { firebase: null };
  return {
    firebase: {
      apiKey: env.FIREBASE_API_KEY,
      authDomain: env.FIREBASE_AUTH_DOMAIN || `${env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
      projectId: env.FIREBASE_PROJECT_ID,
      ...(env.FIREBASE_APP_ID ? { appId: env.FIREBASE_APP_ID } : {}),
    },
  };
}

// Google's signing certificates rotate; cache them for as long as Google says (Cache-Control max-age).
let certCache = { at: 0, maxAge: 0, certs: {} };
async function getCerts(fetchImpl) {
  if (Date.now() - certCache.at < certCache.maxAge * 1000) return certCache.certs;
  const res = await fetchImpl(CERTS_URL);
  if (!res.ok) throw new Error('Could not reach Google to check the login');
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  certCache = { at: Date.now(), maxAge: m ? Number(m[1]) : 3600, certs: await res.json() };
  return certCache.certs;
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

// Returns the verified phone number (03xxxxxxxxx) or throws.
async function verifyPhoneToken(env, idToken, { fetchImpl = fetch, nowS = Math.floor(Date.now() / 1000) } = {}) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Missing login token');
  const header = b64json(parts[0]);
  const claims = b64json(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Bad login token');
  const certs = await getCerts(fetchImpl);
  const pem = certs[header.kid];
  if (!pem) throw new Error('Bad login token');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey(pem), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('Bad login token');
  const pid = env.FIREBASE_PROJECT_ID;
  if (claims.aud !== pid || claims.iss !== `https://securetoken.google.com/${pid}`) throw new Error('Login token is for another app');
  if (!claims.sub || claims.exp <= nowS || claims.iat > nowS + 60) throw new Error('Login token expired');
  if (!(claims.auth_time > nowS - MAX_AGE_S)) throw new Error('Login code is too old. Ask for a new code.');
  const phone = normalizePhone(claims.phone_number);
  if (!phone) throw new Error('Login token has no Pakistani mobile number');
  return phone;
}

module.exports = { enabled, clientConfig, verifyPhoneToken, _resetCache: () => { certCache = { at: 0, maxAge: 0, certs: {} }; } };
