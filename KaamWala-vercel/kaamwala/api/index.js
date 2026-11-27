'use strict';
// Vercel entry point. vercel.json sends every request here.
//
// Vercel does not keep a server running: it starts a copy of this file when requests come in, may run
// several copies at once, freezes a copy between requests, and throws it away after a while. Its disk is
// read-only except /tmp, which is wiped with the copy. So on Vercel:
//   - Firebase (Cloud Firestore) is required. It is the only lasting place for data and uploaded files.
//   - Each copy keeps a working SQLite database in memory, loaded from Firestore when the copy starts.
//   - Before each /api or /pay request, the copy checks whether another copy saved changes since, and
//     reloads from Firestore if so (one Firestore read when nothing changed).
//   - Every response waits until its changes are saved to Firestore, because a frozen copy cannot save later.
//   - Escrow auto-release (72 h) runs on requests, at most every 10 minutes, instead of on a timer.
// Uploaded files are cached in /tmp and fetched back from Firestore when a new copy needs them.
const { createApp } = require('../src/server');
const firestore = require('../src/firestore');
const escrow = require('../src/escrow');

const RELEASE_EVERY = 10 * 60 * 1000;
const SETUP_MSG = 'KaamWala is not set up yet: add FIREBASE_SERVICE_ACCOUNT_JSON in Vercel (Settings > Environment Variables) and redeploy. See VERCEL.md.';

function createHandler(env = process.env, { fetchImpl = fetch, log = console } = {}) {
  env = { ...env };
  // Payment return links need the public address. Vercel tells us the production domain if BASE_URL is not set.
  if (!env.BASE_URL && env.VERCEL_PROJECT_PRODUCTION_URL) env.BASE_URL = `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  let ready = null;
  let lastRelease = 0;

  async function init() {
    if (!firestore.enabled(env)) throw Object.assign(new Error(SETUP_MSG), { setup: true });
    const app = createApp({ dbFile: ':memory:', env, fetchImpl });
    const sync = await firestore.attach(app.db, env, { fetchImpl, log, shared: true });
    sync.stop(); // no background timer: saving happens before each response instead
    return { app, sync };
  }

  const send = (res, status, msg, html) => {
    res.writeHead(status, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json' });
    res.end(html ? `<!doctype html><meta charset="utf-8"><title>KaamWala</title><p style="font:16px sans-serif;max-width:40em;margin:3em auto">${msg}</p>` : JSON.stringify({ error: msg }));
  };

  return async function handler(req, res) {
    // Vercel adds lazy req.body / req.query helpers; the app reads the raw request itself.
    for (const p of ['body', 'query', 'cookies']) {
      try { Object.defineProperty(req, p, { value: undefined, writable: true, configurable: true, enumerable: true }); } catch {}
    }
    const pathname = new URL(req.url, 'http://x').pathname;
    const isPage = req.method === 'GET' && !/^\/(api|pay)\//.test(pathname);

    let st;
    try {
      st = await (ready ||= init().catch((e) => { ready = null; throw e; }));
    } catch (e) {
      log.error(e.message);
      return send(res, 503, e.setup ? SETUP_MSG : 'KaamWala could not reach its database (Firebase). Please try again in a minute.', isPage);
    }

    if (!isPage) {
      try { await st.sync.refresh(); } catch (e) {
        log.error('Firestore: could not check for changes.', e.message);
        return send(res, 503, 'Could not reach the database. Please try again.', false);
      }
      if (Date.now() - lastRelease > RELEASE_EVERY) {
        lastRelease = Date.now();
        try { escrow.autoRelease(st.app.db); } catch (e) { log.error('Auto-release failed:', e.message); }
      }
    }

    // Hold the end of the response until this request's changes are in Firestore.
    const end = res.end.bind(res);
    res.end = (...args) => {
      st.sync.flush().catch((e) => log.error('Firestore: could not save changes, will retry on the next request.', e.message)).finally(() => end(...args));
      return res;
    };
    await st.app.handle(req, res);
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
