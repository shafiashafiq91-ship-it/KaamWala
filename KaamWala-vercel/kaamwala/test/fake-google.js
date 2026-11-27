'use strict';
// In-memory fake of Google's OAuth token endpoint and Firestore REST API, shared by the Firebase tests.
const crypto = require('node:crypto');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { project_id: 'kw-test', client_email: 'app@kw-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };
const ENV = { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(SA) };
const ROOT = 'projects/kw-test/databases/(default)/documents';
const quiet = { log() {}, error() {} };

// Fake Google: the OAuth token endpoint (checks the signed JWT) and Firestore list/commit.
function fakeGoogle() {
  const docs = new Map(); // full doc name -> fields
  const g = { docs, down: false, commits: 0 };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  g.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url === SA.token_uri) {
      const jwt = new URLSearchParams(opts.body).get('assertion').split('.');
      const ok = crypto.verify('RSA-SHA256', Buffer.from(`${jwt[0]}.${jwt[1]}`), publicKey, Buffer.from(jwt[2], 'base64url'));
      const claims = JSON.parse(Buffer.from(jwt[1], 'base64url'));
      if (!ok || claims.iss !== SA.client_email || !claims.scope.includes('datastore')) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'tok', expires_in: 3600 });
    }
    if (opts.headers?.Authorization !== 'Bearer tok') return json({ error: { message: 'unauthenticated' } }, 401);
    if (g.down) return json({ error: { message: 'unavailable' } }, 503);
    const path = url.replace('https://firestore.googleapis.com/v1/', '');
    if (opts.method === 'POST' && path === `${ROOT}:commit`) {
      g.commits++;
      for (const w of JSON.parse(opts.body).writes) w.delete ? docs.delete(w.delete) : docs.set(w.update.name, w.update.fields);
      return json({});
    }
    if (!path.includes('?')) { // get one document
      const name = decodeURIComponent(path);
      return docs.has(name) ? json({ name, fields: docs.get(name) }) : json({ error: { message: 'not found' } }, 404);
    }
    const u = new URL('http://x/' + path);
    const coll = decodeURIComponent(u.pathname.slice(1));
    const size = Number(u.searchParams.get('pageSize'));
    const from = Number(u.searchParams.get('pageToken') || 0);
    const all = [...docs.entries()].filter(([n]) => n.startsWith(coll + '/') && !n.slice(coll.length + 1).includes('/'));
    const page = all.slice(from, from + size).map(([name, fields]) => ({ name, fields }));
    return json({ documents: page, ...(from + size < all.length ? { nextPageToken: String(from + size) } : {}) });
  };
  g.coll = (c) => [...docs.keys()].filter((n) => n.startsWith(`${ROOT}/${c}/`));
  return g;
}

module.exports = { SA, ENV, ROOT, quiet, fakeGoogle };
