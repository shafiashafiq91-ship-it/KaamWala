'use strict';
// KaamWala server: JSON API + static app + payment redirects. No npm dependencies (Node 22.5+).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { open } = require('./db');
const os = require('node:os');
const escrow = require('./escrow');
const addons = require('./addons');
const jazzcash = require('./payments/jazzcash');
const easypaisa = require('./payments/easypaisa');
const auth = require('./auth');
const accounts = require('./accounts');
const filestore = require('./filestore');

const PUBLIC = path.join(__dirname, '..', 'public');

const CATEGORIES = ['electrician', 'plumber', 'ac', 'carpenter', 'painter', 'appliance', 'cleaning'];
const FLOW = ['requested', 'confirmed', 'on_the_way', 'in_progress', 'completed'];
// What customers and workers see. "Awaiting customer approval" = job marked done, money still held
// until the customer confirms (or the auto-release time passes).
const stageOf = (status, escrowState) => {
  if (status === 'cancelled') return 'cancelled';
  if (escrowState === 'disputed') return 'disputed';
  if (status === 'completed') return escrowState === 'held' ? 'awaiting_approval' : 'completed';
  return { requested: 'pending', confirmed: 'accepted' }[status] || status;
};

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const now = () => new Date().toISOString();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function createApp({ dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'kaamwala.db'), env = process.env, fetchImpl = fetch } = {}) {
  const db = open(dbFile);
  const uploadDir = env.UPLOAD_DIR || (dbFile === ':memory:' ? fs.mkdtempSync(path.join(os.tmpdir(), 'kw-up-')) : path.join(path.dirname(dbFile), 'uploads'));
  fs.mkdirSync(uploadDir, { recursive: true });
  // With Firebase switched on, uploads are also kept in Firestore so they survive a host that wipes its disk.
  const files = filestore.create(env, { fetchImpl });
  const keepFile = async (file, buf) => {
    try { await files.save(file, buf); } catch (e) {
      fs.rmSync(file, { force: true });
      console.error('Upload not saved to Firebase:', e.message);
      fail(503, 'The file could not be saved. Please try again.');
    }
  };
  const baseUrl = () => (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, '');
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };

  // ---------- helpers ----------
  const userFrom = (req) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) return null;
    return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND (s.expires_at IS NULL OR s.expires_at > ?)')
      .get(auth.tokenHash(token), now()) || null;
  };
  const need = (req, ...roles) => {
    if (!req.user) fail(401, 'Please log in');
    if (roles.length && !roles.includes(req.user.role)) fail(403, 'Not allowed');
    return req.user;
  };
  const workerOf = (userId) => db.prepare('SELECT * FROM workers WHERE user_id = ?').get(userId);

  const ratingSql = `(SELECT CAST(AVG(rating) * 10 + 1e-9 AS INTEGER) / 10.0 FROM reviews r WHERE r.worker_id = w.id) AS rating,
                     (SELECT COUNT(*) FROM reviews r WHERE r.worker_id = w.id) AS review_count`;
  const mediaUrl = (id) => (id ? `/api/media/${id}` : null);
  const workerRow = (w) => w && ({
    ...w,
    slots: JSON.parse(w.slots),
    work_days: JSON.parse(w.work_days || '[]'),
    photo_url: mediaUrl(w.photo_id),
    // The badge needs the platform's own check; uploading a document is never enough.
    id_verified: w.verification === 'verified' && !!w.cnic_verified,
    checks: {
      cnic: !!w.cnic_verified,
      phone_address: !!w.phone_address_verified,
      references: w.references_checked,
      skill: w.skill_assessment,
    },
  });

  const loadBooking = (id, user) => {
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!b) fail(404, 'Booking not found');
    if (user.role === 'customer' && b.customer_id !== user.id) fail(403, 'Not your booking');
    if (user.role === 'worker' && b.worker_id !== workerOf(user.id)?.id) fail(403, 'Not your booking');
    return b;
  };

  // A worker sees the customer's phone and full address only once they have accepted the job.
  const hidesCustomer = (b, viewer) => viewer?.role === 'worker' && !JSON.parse(b.history).confirmed;
  const bookingDetail = (b, viewer) => {
    const w = db.prepare(`SELECT w.*, u.name, u.phone, ${ratingSql} FROM workers w JOIN users u ON u.id = w.user_id WHERE w.id = ?`).get(b.worker_id);
    const customer = db.prepare('SELECT u.id, u.name, u.phone, u.area, cp.photo_id FROM users u LEFT JOIN customer_profiles cp ON cp.user_id = u.id WHERE u.id = ?').get(b.customer_id);
    customer.photo_url = mediaUrl(customer.photo_id);
    const hidden = hidesCustomer(b, viewer);
    if (hidden) customer.phone = null;
    const e = escrow.get(db, b.id);
    return {
      ...b,
      address: hidden ? null : b.address,
      customer_hidden: hidden,
      stage: stageOf(b.status, e?.state),
      photos: db.prepare("SELECT id, mime FROM media WHERE booking_id = ? AND purpose = 'booking' ORDER BY created_at").all(b.id).map((m) => ({ ...m, url: mediaUrl(m.id) })),
      blocked: viewer ? accounts.blockedBetween(db, b.customer_id, w.user_id) : false,
      history: JSON.parse(b.history),
      worker: workerRow(w),
      customer,
      escrow: e && { ...e, available: escrow.available(e), commission_rate: escrow.COMMISSION_RATE, auto_release_hours: escrow.AUTO_RELEASE_HOURS },
      extras: db.prepare('SELECT * FROM extras WHERE booking_id = ? ORDER BY id').all(b.id).map(addonRow),
      price: addons.breakdown(db, b.id),
      addon_rules: { warn_percent: addons.WARN_PERCENT, warn_amount: addons.WARN_AMOUNT },
      price_events: db.prepare('SELECT * FROM price_events WHERE booking_id = ? ORDER BY id').all(b.id),
      payments: db.prepare('SELECT id, extra_id, provider, amount, status, txn_ref, provider_ref, created_at FROM payments WHERE booking_id = ? ORDER BY id').all(b.id),
      ledger: db.prepare('SELECT * FROM ledger WHERE booking_id = ? ORDER BY id').all(b.id),
      dispute: db.prepare('SELECT * FROM disputes WHERE booking_id = ? ORDER BY id DESC LIMIT 1').get(b.id) || null,
      review: db.prepare('SELECT * FROM reviews WHERE booking_id = ?').get(b.id) || null,
    };
  };

  const addonRow = (x) => ({
    ...x,
    client_key: undefined,
    media: db.prepare('SELECT id, mime FROM media WHERE extra_id = ? ORDER BY created_at').all(x.id).map((m) => ({ ...m, url: `/api/media/${m.id}` })),
    messages: db.prepare('SELECT m.*, u.name, u.role FROM addon_messages m JOIN users u ON u.id = m.sender_id WHERE extra_id = ? ORDER BY m.id').all(x.id),
  });

  const newPayment = (bookingId, extraId, provider, amount) => {
    if (!['jazzcash', 'easypaisa'].includes(provider)) fail(400, 'Choose JazzCash or EasyPaisa');
    const txnRef = 'T' + new Date().toISOString().replace(/\D/g, '').slice(2, 14) + crypto.randomBytes(3).toString('hex').toUpperCase();
    const id = db.prepare('INSERT INTO payments (booking_id,extra_id,provider,amount,txn_ref,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(bookingId, extraId, provider, amount, txnRef, now(), now()).lastInsertRowid;
    return { id, txn_ref: txnRef, pay_url: `/pay/${txnRef}` };
  };

  const setStatus = (b, status, extra = {}) => {
    const history = JSON.parse(b.history);
    history[status] = now();
    db.prepare('UPDATE bookings SET status = ?, history = ?, eta_min = COALESCE(?, eta_min) WHERE id = ?')
      .run(status, JSON.stringify(history), extra.eta_min ?? null, b.id);
  };

  // ---------- accounts: login, registration, roles, profiles (src/accounts.js) ----------
  accounts.mount({ db, env, route, need, fail, now, workerOf, workerRow, ratingSql, mediaUrl, uploadDir, keepFile, dropFile: (f) => files.remove(f).catch((e) => console.error('Firebase file not deleted:', e.message)), stageOf, notify: addons.notify });

  // ---------- discovery ----------
  const LISTED = "w.status = 'active' AND w.cnic_verified = 1 AND w.verification = 'verified' AND w.available = 1";
  route('GET', '/api/categories', () => ({
    categories: CATEGORIES.map((c) => ({
      id: c,
      workers: db.prepare(`SELECT COUNT(*) n FROM workers w WHERE category = ? AND ${LISTED}`).get(c).n,
    })),
  }));

  route('GET', '/api/workers', (req) => {
    const { query } = req;
    const where = [LISTED]; // only verified, active, available profiles are shown
    const args = [];
    if (req.user) { // hide my own worker profile and anyone on either side of a block
      where.push('w.user_id <> ?', 'w.user_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ? UNION SELECT user_id FROM blocks WHERE blocked_id = ?)');
      args.push(req.user.id, req.user.id, req.user.id);
    }
    if (query.category) { where.push('w.category = ?'); args.push(query.category); }
    if (query.q) { where.push("(u.name LIKE ? OR w.skills LIKE ? OR w.category LIKE ?)"); args.push(...Array(3).fill(`%${query.q}%`)); }
    if (query.area) { where.push('w.areas LIKE ?'); args.push(`%${query.area}%`); }
    let rows = db.prepare(`SELECT w.*, u.name, ${ratingSql} FROM workers w JOIN users u ON u.id = w.user_id
      WHERE ${where.join(' AND ')} ORDER BY w.distance_km`).all(...args).map((w) => accounts.stripPrivate(workerRow(w)));
    if (query.min_rating) rows = rows.filter((w) => (w.rating || 0) >= Number(query.min_rating));
    if (query.today === '1') rows = rows.filter((w) => w.slots.length > 0);
    if (query.sort === 'rating') rows.sort((a, b) => b.rating - a.rating);
    return { workers: rows };
  });

  route('GET', '/api/workers/:id', (req) => {
    const w = db.prepare(`SELECT w.*, u.name, ${ratingSql} FROM workers w JOIN users u ON u.id = w.user_id WHERE w.id = ?`).get(req.params.id);
    const own = req.user && w && req.user.id === w.user_id;
    // Unverified or suspended profiles are not public (the worker themself and admins can still open them).
    if (!w || (!own && req.user?.role !== 'admin' && (w.status !== 'active' || w.verification !== 'verified'))) fail(404, 'Worker not found');
    return { worker: accounts.publicWorker(db, workerRow(w), req.user) };
  });

  // ---------- bookings ----------
  route('POST', '/api/bookings', (req) => {
    const u = need(req, 'customer');
    const { worker_id, problem, date, slot, address, provider } = req.body;
    if (!problem || !date || !slot || !address) fail(400, 'Please fill in the problem, time and address');
    const w = db.prepare(`SELECT * FROM workers w WHERE id = ? AND ${LISTED}`).get(worker_id);
    if (!w) fail(404, 'Worker not available');
    if (w.user_id === u.id) fail(400, 'You cannot book yourself');
    if (accounts.blockedBetween(db, u.id, w.user_id)) fail(403, 'You cannot book this worker');
    const photoIds = Array.isArray(req.body.media_ids) ? req.body.media_ids.slice(0, 5) : [];
    for (const m of photoIds) {
      const row = db.prepare('SELECT owner_id, purpose, booking_id FROM media WHERE id = ?').get(m);
      if (!row || row.owner_id !== u.id || row.purpose !== 'booking' || row.booking_id) fail(400, 'A photo could not be attached; please upload it again');
    }
    const seq = db.prepare("SELECT COUNT(*) n FROM bookings WHERE code NOT LIKE 'KW-H%'").get().n;
    const code = `KW-${1024 + seq}`;
    const history = JSON.stringify({ requested: now() });
    const id = db.prepare(`INSERT INTO bookings (code,customer_id,worker_id,problem,date,slot,address,visit_fee,history,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(code, u.id, w.id, problem, date, slot, address, w.visit_fee, history, now()).lastInsertRowid;
    escrow.open(db, id);
    addons.logEvent(db, id, null, u, 'booking_created', w.visit_fee, 'Original price: visit / inspection fee');
    const payment = newPayment(id, null, provider, w.visit_fee);
    for (const m of photoIds) db.prepare('UPDATE media SET booking_id = ? WHERE id = ?').run(id, m);
    addons.notify(db, w.user_id, id, null, 'booking_new', `New booking request ${code}: ${String(problem).slice(0, 80)} (${date}, ${slot}). It shows as paid once the customer has paid.`);
    return { booking: bookingDetail(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id), u), payment };
  });

  route('GET', '/api/bookings', (req) => {
    const u = need(req);
    const sql = `SELECT b.*, u.name AS worker_name, w.category, c.name AS customer_name, e.state AS escrow_state, e.held AS escrow_held
      FROM bookings b JOIN workers w ON w.id = b.worker_id JOIN users u ON u.id = w.user_id JOIN users c ON c.id = b.customer_id
      LEFT JOIN escrows e ON e.booking_id = b.id`;
    const out = (rows) => ({ bookings: rows.map((b) => ({ ...b, stage: stageOf(b.status, b.escrow_state), address: hidesCustomer(b, u) ? null : b.address })) });
    if (u.role === 'customer') return out(db.prepare(`${sql} WHERE b.customer_id = ? ORDER BY b.id DESC`).all(u.id));
    if (u.role === 'worker') return out(db.prepare(`${sql} WHERE b.worker_id = ? AND b.code NOT LIKE 'KW-H%' ORDER BY b.id DESC`).all(workerOf(u.id).id));
    return out(db.prepare(`${sql} WHERE b.code NOT LIKE 'KW-H%' ORDER BY b.id DESC`).all());
  });

  route('GET', '/api/bookings/:id', (req) => ({ booking: bookingDetail(loadBooking(req.params.id, need(req)), req.user) }));

  // Retry or switch provider for an unpaid visit fee.
  route('POST', '/api/bookings/:id/pay', (req) => {
    const b = loadBooking(req.params.id, need(req, 'customer'));
    const e = escrow.get(db, b.id);
    if (e.state !== 'awaiting_payment' || b.status === 'cancelled') fail(400, 'This booking is already paid');
    return { payment: newPayment(b.id, null, req.body.provider, b.visit_fee) };
  });

  route('POST', '/api/bookings/:id/status', (req) => {
    const u = need(req, 'worker', 'admin');
    const b = loadBooking(req.params.id, u);
    const next = req.body.status;
    if (FLOW.indexOf(next) !== FLOW.indexOf(b.status) + 1 || b.status === 'cancelled') fail(400, `Cannot move from ${b.status} to ${next}`);
    const e = escrow.get(db, b.id);
    if (next === 'confirmed' && e.state !== 'held') fail(400, 'Wait until the customer has paid');
    if (next === 'completed' && db.prepare("SELECT COUNT(*) n FROM extras WHERE booking_id = ? AND status = 'pending'").get(b.id).n)
      fail(400, 'An add-on request is still waiting for the customer. Wait for their answer or withdraw it.');
    if (next === 'completed' && db.prepare("SELECT COUNT(*) n FROM extras WHERE booking_id = ? AND status = 'approved' AND pay_status = 'unpaid'").get(b.id).n)
      fail(400, 'An approved add-on has not been paid yet. Ask the customer to pay, or withdraw it.');
    if (e.state === 'disputed') fail(400, 'Booking is under dispute');
    setStatus(b, next, { eta_min: next === 'on_the_way' ? Number(req.body.eta_min || 15) : null });
    if (next === 'completed') escrow.onCompleted(db, b.id);
    const msg = { confirmed: 'accepted your booking', on_the_way: 'is on the way', in_progress: 'has started the job', completed: 'marked the job as done. Please check the work and confirm to release payment, or raise a dispute.' }[next];
    addons.notify(db, b.customer_id, b.id, null, `booking_${next}`, `${b.code}: your worker ${msg}`);
    return { booking: bookingDetail(loadBooking(b.id, u), u) };
  });

  route('POST', '/api/bookings/:id/cancel', (req) => {
    const u = need(req);
    const b = loadBooking(req.params.id, u);
    const allowed = u.role === 'admin' || (u.role === 'customer' && ['requested', 'confirmed'].includes(b.status))
      || (u.role === 'worker' && b.status === 'requested');
    if (!allowed) fail(400, 'This booking can no longer be cancelled here; please contact support');
    escrow.refundAll(db, b.id, u.role === 'worker' ? 'Worker declined the booking' : 'Booking cancelled');
    setStatus(b, 'cancelled');
    const wUser = db.prepare('SELECT user_id FROM workers WHERE id = ?').get(b.worker_id).user_id;
    if (u.role === 'worker') addons.notify(db, b.customer_id, b.id, null, 'booking_declined', `${b.code}: the worker could not take this booking. Any payment is refunded.`);
    else addons.notify(db, wUser, b.id, null, 'booking_cancelled', `${b.code} was cancelled.`);
    return { booking: bookingDetail(loadBooking(b.id, u), u) };
  });

  // ---------- add-on service requests ----------
  const loadAddon = (id, user) => {
    const x = db.prepare('SELECT * FROM extras WHERE id = ?').get(id);
    if (!x) fail(404, 'Add-on not found');
    return { x, b: loadBooking(x.booking_id, user) }; // also checks the user belongs to the booking
  };
  const addonDetail = (x, b) => ({
    addon: addonRow(db.prepare('SELECT * FROM extras WHERE id = ?').get(x.id)),
    booking: { id: b.id, code: b.code, status: b.status, problem: b.problem, visit_fee: b.visit_fee },
    worker: db.prepare('SELECT u.name, w.category FROM workers w JOIN users u ON u.id = w.user_id WHERE w.id = ?').get(b.worker_id),
    // The comparison the customer sees: what they had agreed vs. the total if they approve this.
    comparison: x.status === 'pending' ? addons.warning(db, b.id, x.amount) : { ...addons.warning(db, b.id, 0), revised: addons.approvedTotal(db, b.id) },
    price: addons.breakdown(db, b.id),
  });

  route('POST', '/api/bookings/:id/addons', (req) => {
    const u = need(req, 'worker');
    const b = loadBooking(req.params.id, u);
    const mediaIds = Array.isArray(req.body.media_ids) ? req.body.media_ids.slice(0, 5) : [];
    for (const m of mediaIds) {
      const row = db.prepare('SELECT owner_id, extra_id, purpose FROM media WHERE id = ?').get(m);
      if (!row || row.owner_id !== u.id || row.extra_id || row.purpose !== 'addon') fail(400, 'A photo could not be attached; please upload it again');
    }
    const r = addons.request(db, escrow.tx, b, u, req.body);
    if (!r.duplicate) for (const m of mediaIds) db.prepare('UPDATE media SET extra_id = ? WHERE id = ?').run(r.id, m);
    const x = db.prepare('SELECT * FROM extras WHERE id = ?').get(r.id);
    return { ...addonDetail(x, b), duplicate: r.duplicate };
  });

  route('GET', '/api/addons/:id', (req) => {
    const u = need(req);
    const { x, b } = loadAddon(req.params.id, u);
    if (u.role === 'customer') db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND extra_id = ? AND read_at IS NULL').run(now(), u.id, x.id);
    return addonDetail(x, b);
  });

  // Approval records consent only. Paying is a separate, explicit step through the wallet.
  route('POST', '/api/addons/:id/approve', (req) => {
    const u = need(req, 'customer');
    const { x, b } = loadAddon(req.params.id, u);
    addons.decide(db, escrow.tx, x.id, u, 'approve');
    const out = addonDetail(x, b);
    if (req.body.provider) out.payment = newPayment(b.id, x.id, req.body.provider, x.amount);
    return out;
  });
  route('POST', '/api/addons/:id/reject', (req) => {
    const u = need(req, 'customer');
    const { x, b } = loadAddon(req.params.id, u);
    addons.decide(db, escrow.tx, x.id, u, 'reject', req.body.reason);
    return addonDetail(x, b);
  });
  route('POST', '/api/addons/:id/pay', (req) => {
    const u = need(req, 'customer');
    const { x, b } = loadAddon(req.params.id, u);
    const cur = db.prepare('SELECT status, pay_status FROM extras WHERE id = ?').get(x.id);
    if (cur.status !== 'approved' || cur.pay_status !== 'unpaid') fail(400, cur.pay_status === 'paid' ? 'Already paid' : 'Only an approved add-on can be paid');
    return { payment: newPayment(b.id, x.id, req.body.provider, x.amount) }; // amount from the record, never from the client
  });
  route('POST', '/api/addons/:id/cancel', (req) => {
    const u = need(req, 'worker');
    const { x, b } = loadAddon(req.params.id, u);
    addons.cancel(db, escrow.tx, x.id, u);
    return addonDetail(x, b);
  });
  route('POST', '/api/addons/:id/messages', (req) => {
    const u = need(req, 'customer', 'worker');
    const { x, b } = loadAddon(req.params.id, u);
    addons.ask(db, x.id, u, req.body.body);
    return addonDetail(x, b);
  });
  route('POST', '/api/addons/:id/dispute', (req) => {
    const u = need(req, 'customer');
    const { x, b } = loadAddon(req.params.id, u);
    if (!String(req.body.reason || '').trim()) fail(400, 'Tell us what is wrong with this charge');
    const e = escrow.get(db, b.id);
    if (e.state !== 'held') {
      // Money already released or refunded: record it as a complaint for the admin team instead.
      db.prepare('INSERT INTO reports (reporter_id,worker_id,booking_id,body,created_at) VALUES (?,?,?,?,?)')
        .run(u.id, b.worker_id, b.id, `Add-on charge disputed after release (${x.work}, Rs ${x.amount}): ${req.body.reason}`, now());
      addons.logEvent(db, b.id, x.id, u, 'addon_reported', x.amount, req.body.reason);
      return { ...addonDetail(x, b), reported: true };
    }
    escrow.raiseDispute(db, b.id, u, req.body.reason, x.id);
    return addonDetail(x, b);
  });

  // Photos / short videos of the problem. Raw body upload; ids are random and unguessable.
  const MEDIA = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };
  // purpose: addon (worker, default), booking (customer's problem photos), avatar (anyone), portfolio (worker).
  const UPLOAD_ROLES = { addon: ['worker'], booking: ['customer'], avatar: ['customer', 'worker'], portfolio: ['worker'] };
  route('POST', '/api/uploads', async (req) => {
    const purpose = req.query.purpose || 'addon';
    if (!UPLOAD_ROLES[purpose]) fail(400, 'Unknown upload type');
    const u = need(req, ...UPLOAD_ROLES[purpose]);
    const mime = (req.headers['content-type'] || '').split(';')[0];
    if (!MEDIA[mime]) fail(400, 'Upload a photo (JPG, PNG, WebP) or a short video (MP4, WebM, MOV)');
    if (purpose !== 'addon' && !mime.startsWith('image/')) fail(400, 'Upload a photo (JPG, PNG, WebP)');
    if (purpose === 'portfolio' && db.prepare("SELECT COUNT(*) n FROM media WHERE owner_id = ? AND purpose = 'portfolio'").get(u.id).n >= 12) fail(400, 'Your portfolio already has 12 photos. Remove one first.');
    const max = mime.startsWith('video/') ? 20e6 : 8e6;
    const buf = req.rawBody;
    if (!buf.length) fail(400, 'Empty file');
    if (buf.length > max) fail(413, `File too large (max ${max / 1e6} MB)`);
    const id = crypto.randomBytes(16).toString('hex');
    const file = path.join(uploadDir, id + MEDIA[mime]);
    fs.writeFileSync(file, buf);
    await keepFile(file, buf);
    db.prepare('INSERT INTO media (id,owner_id,mime,size,path,created_at,purpose) VALUES (?,?,?,?,?,?,?)').run(id, u.id, mime, buf.length, file, now(), purpose);
    return { id, url: `/api/media/${id}`, mime };
  });
  route('GET', '/api/media/:id', ({ params }) => {
    const m = db.prepare('SELECT * FROM media WHERE id = ?').get(params.id);
    if (!m || !/^[0-9a-f]{32}$/.test(params.id)) fail(404, 'Not found');
    return { file: m.path, mime: m.mime };
  });

  // ---------- notifications ----------
  route('GET', '/api/notifications', (req) => {
    const u = need(req);
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(u.id);
    return { notifications: rows, unread: rows.filter((n) => !n.read_at).length };
  });
  route('POST', '/api/notifications/read', (req) => {
    const u = need(req);
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), u.id);
    return { ok: true };
  });

  route('POST', '/api/bookings/:id/release', (req) => {
    const u = need(req, 'customer');
    const b = loadBooking(req.params.id, u);
    escrow.confirmRelease(db, b.id);
    return { booking: bookingDetail(b, u) };
  });

  route('POST', '/api/bookings/:id/dispute', (req) => {
    const u = need(req, 'customer', 'worker');
    const b = loadBooking(req.params.id, u);
    if (!req.body.reason) fail(400, 'Tell us what went wrong');
    escrow.raiseDispute(db, b.id, u, req.body.reason);
    return { booking: bookingDetail(b, u) };
  });

  route('POST', '/api/bookings/:id/review', (req) => {
    const u = need(req, 'customer');
    const b = loadBooking(req.params.id, u);
    const rating = Number(req.body.rating);
    if (b.status !== 'completed') fail(400, 'Reviews are only for completed jobs');
    if (!(rating >= 1 && rating <= 5)) fail(400, 'Choose 1 to 5 stars');
    db.prepare('INSERT OR REPLACE INTO reviews (booking_id,worker_id,rating,comment,created_at) VALUES (?,?,?,?,?)')
      .run(b.id, b.worker_id, rating, req.body.comment || null, now());
    return { booking: bookingDetail(b, u) };
  });

  // ---------- messages ----------
  route('GET', '/api/conversations', (req) => {
    const u = need(req);
    const mine = u.role === 'customer' ? 'b.customer_id = ?' : 'b.worker_id = ?';
    const arg = u.role === 'customer' ? u.id : workerOf(u.id)?.id;
    return {
      conversations: db.prepare(`SELECT b.id, b.code, b.status, wu.name AS worker_name, c.name AS customer_name,
        (SELECT body FROM messages m WHERE m.booking_id = b.id ORDER BY m.id DESC LIMIT 1) AS last,
        (SELECT created_at FROM messages m WHERE m.booking_id = b.id ORDER BY m.id DESC LIMIT 1) AS last_at
        FROM bookings b JOIN workers w ON w.id = b.worker_id JOIN users wu ON wu.id = w.user_id JOIN users c ON c.id = b.customer_id
        WHERE ${mine} AND b.code NOT LIKE 'KW-H%' ORDER BY COALESCE(last_at, b.created_at) DESC`).all(arg),
    };
  });
  route('GET', '/api/bookings/:id/messages', (req) => {
    const b = loadBooking(req.params.id, need(req));
    return { messages: db.prepare('SELECT m.*, u.name, u.role FROM messages m JOIN users u ON u.id = m.sender_id WHERE booking_id = ? ORDER BY m.id').all(b.id) };
  });
  route('POST', '/api/bookings/:id/messages', (req) => {
    const u = need(req);
    const b = loadBooking(req.params.id, u);
    if (!String(req.body.body || '').trim()) fail(400, 'Empty message');
    if (accounts.blockedBetween(db, b.customer_id, db.prepare('SELECT user_id FROM workers WHERE id = ?').get(b.worker_id).user_id)) fail(403, 'Messaging is blocked between you and this person');
    db.prepare('INSERT INTO messages (booking_id,sender_id,body,created_at) VALUES (?,?,?,?)').run(b.id, u.id, String(req.body.body).slice(0, 2000), now());
    return { ok: true };
  });

  route('POST', '/api/reports', (req) => {
    const u = need(req);
    if (!req.body.body) fail(400, 'Describe the problem');
    db.prepare('INSERT INTO reports (reporter_id,worker_id,booking_id,body,created_at) VALUES (?,?,?,?,?)')
      .run(u.id, req.body.worker_id || null, req.body.booking_id || null, req.body.body, now());
    return { ok: true };
  });

  // ---------- worker ----------
  route('GET', '/api/worker/earnings', (req) => {
    const w = workerOf(need(req, 'worker').id);
    const rows = db.prepare(`SELECT l.*, b.code FROM ledger l JOIN bookings b ON b.id = l.booking_id
      WHERE b.worker_id = ? AND l.type = 'release' ORDER BY l.id DESC`).all(w.id);
    const held = db.prepare(`SELECT COALESCE(SUM(e.held - e.released - e.refunded - e.commission),0) n FROM escrows e
      JOIN bookings b ON b.id = e.booking_id WHERE b.worker_id = ? AND e.state IN ('held','disputed')`).get(w.id).n;
    const month = new Date().toISOString().slice(0, 7);
    const jobs = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE worker_id = ? AND status = 'completed' AND code NOT LIKE 'KW-H%'`).get(w.id).n;
    return {
      releases: rows, in_escrow: held, commission_rate: escrow.COMMISSION_RATE,
      this_month: rows.filter((r) => r.created_at.startsWith(month)).reduce((s, r) => s + r.amount, 0),
      payout_pending: rows.filter((r) => r.payout_status === 'pending').reduce((s, r) => s + r.amount, 0),
      payout_sent: rows.filter((r) => r.payout_status === 'sent').reduce((s, r) => s + r.amount, 0),
      completed_jobs: jobs,
    };
  });

  // ---------- admin ----------
  route('GET', '/api/admin/overview', (req) => {
    need(req, 'admin');
    return {
      workers: db.prepare(`SELECT w.*, u.name, u.phone, ${ratingSql} FROM workers w JOIN users u ON u.id = w.user_id ORDER BY w.id`).all().map(workerRow),
      disputes: db.prepare(`SELECT d.*, b.code, e.held - e.released - e.refunded - e.commission AS available, u.name AS raised_by_name,
          x.work AS addon_work, x.amount AS addon_amount
        FROM disputes d JOIN bookings b ON b.id = d.booking_id JOIN escrows e ON e.booking_id = d.booking_id JOIN users u ON u.id = d.raised_by
        LEFT JOIN extras x ON x.id = d.extra_id
        ORDER BY d.status = 'open' DESC, d.id DESC`).all(),
      escrows: db.prepare(`SELECT e.*, b.code, b.status FROM escrows e JOIN bookings b ON b.id = e.booking_id ORDER BY e.booking_id DESC`).all(),
      payouts: db.prepare(`SELECT l.*, b.code, wu.name AS worker_name, w.payout_wallet, w.payout_provider, c.name AS customer_name, c.phone AS customer_phone
        FROM ledger l JOIN bookings b ON b.id = l.booking_id JOIN workers w ON w.id = b.worker_id JOIN users wu ON wu.id = w.user_id
        JOIN users c ON c.id = b.customer_id WHERE l.payout_status IS NOT NULL ORDER BY l.payout_status = 'pending' DESC, l.id DESC`).all(),
      reports: db.prepare('SELECT r.*, u.name AS reporter FROM reports r JOIN users u ON u.id = r.reporter_id ORDER BY r.id DESC').all(),
      totals: db.prepare(`SELECT COALESCE(SUM(held - released - refunded - commission),0) AS in_escrow, COALESCE(SUM(commission),0) AS commission FROM escrows`).get(),
      providers: { jazzcash: jazzcash.configured(env) ? 'configured' : 'simulator', easypaisa: easypaisa.configured(env) ? 'configured' : 'simulator' },
    };
  });
  // Add-ons that need a human look: over the price warning line, safety-flagged, disputed,
  // or from workers whose requests keep getting rejected or disputed.
  route('GET', '/api/admin/addons', (req) => {
    need(req, 'admin');
    const since = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
    const workers = db.prepare(`SELECT w.id, u.name, w.status,
        COUNT(x.id) AS requested,
        SUM(x.status = 'approved') AS approved,
        SUM(x.status = 'rejected') AS rejected,
        SUM(x.status = 'disputed') AS disputed,
        SUM(x.over_threshold) AS over_threshold,
        COALESCE(SUM(CASE WHEN x.status IN ('approved','disputed') THEN x.amount END),0) AS approved_amount
      FROM workers w JOIN users u ON u.id = w.user_id JOIN extras x ON x.worker_id = w.id
      WHERE x.created_at >= ? GROUP BY w.id ORDER BY SUM(x.status IN ('rejected','disputed')) DESC, SUM(x.over_threshold) DESC`).all(since)
      .map((w) => ({ ...w, flagged: w.rejected + w.disputed >= 3 || w.over_threshold >= 3 }));
    const addonsList = db.prepare(`SELECT x.*, b.code, b.visit_fee, wu.name AS worker_name, c.name AS customer_name,
        (SELECT COUNT(*) FROM addon_messages m WHERE m.extra_id = x.id) AS message_count
      FROM extras x JOIN bookings b ON b.id = x.booking_id JOIN workers w ON w.id = x.worker_id JOIN users wu ON wu.id = w.user_id
      JOIN users c ON c.id = b.customer_id ORDER BY (x.status = 'disputed') DESC, x.over_threshold DESC, x.urgent_safety DESC, x.id DESC LIMIT 200`).all()
      .map((x) => ({ ...x, client_key: undefined, increase_percent: Math.round((x.amount / x.visit_fee) * 100),
        flags: [x.over_threshold && 'over price limit', x.urgent_safety && 'safety', x.status === 'disputed' && 'disputed'].filter(Boolean) }));
    return { workers, addons: addonsList, warn_percent: addons.WARN_PERCENT, warn_amount: addons.WARN_AMOUNT };
  });
  route('GET', '/api/admin/bookings/:id/history', (req) => {
    need(req, 'admin');
    return {
      events: db.prepare(`SELECT pe.*, u.name AS actor_name FROM price_events pe LEFT JOIN users u ON u.id = pe.actor_id WHERE booking_id = ? ORDER BY pe.id`).all(req.params.id),
      price: addons.breakdown(db, Number(req.params.id)),
    };
  });

  route('PATCH', '/api/admin/workers/:id', (req) => {
    need(req, 'admin');
    const allowed = ['cnic_verified', 'phone_address_verified', 'references_checked', 'skill_assessment', 'status', 'exp_documented'];
    for (const k of allowed) if (k in req.body) db.prepare(`UPDATE workers SET ${k} = ? WHERE id = ?`).run(req.body[k], req.params.id);
    return { ok: true };
  });
  route('POST', '/api/admin/disputes/:id/resolve', (req) => {
    need(req, 'admin');
    if (!req.body.resolution) fail(400, 'Write the resolution');
    return { escrow: escrow.resolveDispute(db, Number(req.params.id), Math.round(Number(req.body.refund_amount || 0)), req.body.resolution) };
  });
  route('POST', '/api/admin/ledger/:id/sent', (req) => {
    need(req, 'admin');
    db.prepare("UPDATE ledger SET payout_status = 'sent' WHERE id = ? AND payout_status = 'pending'").run(req.params.id);
    return { ok: true };
  });
  route('POST', '/api/admin/auto-release', (req) => { need(req, 'admin'); return { released: escrow.autoRelease(db) }; });

  // ---------- payment pages ----------
  const paymentByRef = (ref) => db.prepare('SELECT * FROM payments WHERE txn_ref = ?').get(ref);
  const backTo = (p, ok) => ({ redirect: `/#/${p.extra_id ? `addon/${p.extra_id}` : `booking/${p.booking_id}`}?payment=${ok ? 'success' : 'failed'}` });
  const autoForm = ({ action, fields }, title) => ({
    html: `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body onload="document.forms[0].submit()" style="font-family:sans-serif;text-align:center;padding-top:40vh">
    <p>${esc(title)}…</p><form method="post" action="${esc(action)}">${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}
    <noscript><button>Continue</button></noscript></form></body>`,
  });

  route('GET', '/pay/:ref', ({ params }) => {
    const p = paymentByRef(params.ref);
    if (!p || p.status !== 'initiated') fail(404, 'Payment link expired');
    const b = db.prepare('SELECT code FROM bookings WHERE id = ?').get(p.booking_id);
    const desc = `KaamWala ${b.code}${p.extra_id ? ' add-on service' : ' visit fee'}`;
    if (p.provider === 'jazzcash' && jazzcash.configured(env)) {
      return autoForm(jazzcash.buildCheckout({ txnRef: p.txn_ref, amount: p.amount, description: desc, billRef: b.code, returnUrl: `${baseUrl()}/pay/jazzcash/return` }, env), 'Opening JazzCash');
    }
    if (p.provider === 'easypaisa' && easypaisa.configured(env)) {
      return autoForm(easypaisa.buildCheckout({ txnRef: p.txn_ref, amount: p.amount, returnUrl: `${baseUrl()}/pay/easypaisa/return` }, env), 'Opening EasyPaisa');
    }
    return { redirect: `/pay.html#${p.txn_ref}` }; // sandbox simulator when no credentials are set
  });
  route('GET', '/api/pay/:ref', ({ params }) => {
    const p = paymentByRef(params.ref);
    if (!p) fail(404, 'Not found');
    const b = db.prepare('SELECT code FROM bookings WHERE id = ?').get(p.booking_id);
    return { payment: { provider: p.provider, amount: p.amount, status: p.status, txn_ref: p.txn_ref, code: b.code, extra: !!p.extra_id } };
  });
  route('POST', '/pay/simulate/:ref', ({ params, body }) => {
    const p = paymentByRef(params.ref);
    if (!p) fail(404, 'Not found');
    if ((p.provider === 'jazzcash' && jazzcash.configured(env)) || (p.provider === 'easypaisa' && easypaisa.configured(env)))
      fail(403, 'Simulator is disabled once real credentials are set');
    if (body.result === 'pay') escrow.recordPayment(db, p.id, 'SIM-' + crypto.randomBytes(4).toString('hex').toUpperCase(), JSON.stringify(body));
    else escrow.failPayment(db, p.id, JSON.stringify(body));
    return backTo(p, body.result === 'pay');
  });

  route('POST', '/pay/jazzcash/return', ({ body }) => {
    let r;
    try { r = jazzcash.verifyCallback(body, env); } catch (err) { fail(400, err.message); }
    const p = paymentByRef(r.txnRef);
    if (!p) fail(404, 'Unknown transaction');
    if (r.ok && Math.round(r.amount) === p.amount) escrow.recordPayment(db, p.id, r.providerRef, JSON.stringify(body));
    else escrow.failPayment(db, p.id, JSON.stringify(body));
    return backTo(p, r.ok);
  });

  const easypaisaReturn = async ({ body, query }) => {
    const data = { ...query, ...body };
    if (data.auth_token) return autoForm(easypaisa.buildConfirm(data.auth_token, `${baseUrl()}/pay/easypaisa/return`, env), 'Confirming with EasyPaisa');
    const p = paymentByRef(data.orderRefNumber);
    if (!p) fail(404, 'Unknown transaction');
    const r = await easypaisa.inquire(p.txn_ref, env); // never trust the redirect alone
    if (r.ok && Math.round(r.amount) === p.amount) escrow.recordPayment(db, p.id, r.providerRef, JSON.stringify({ redirect: data, inquiry: r }));
    else escrow.failPayment(db, p.id, JSON.stringify({ redirect: data, inquiry: r }));
    return backTo(p, r.ok);
  };
  route('GET', '/pay/easypaisa/return', easypaisaReturn);
  route('POST', '/pay/easypaisa/return', easypaisaReturn);

  // ---------- http plumbing ----------
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

  async function readRaw(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > limit) fail(413, 'Too large'); chunks.push(c); }
    return Buffer.concat(chunks);
  }
  async function readBody(req) {
    const raw = (await readRaw(req, 1e6)).toString();
    if (!raw) return {};
    if ((req.headers['content-type'] || '').includes('application/json')) return JSON.parse(raw);
    return Object.fromEntries(new URLSearchParams(raw));
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      for (const r of routes) {
        const m = r.method === req.method && url.pathname.match(r.re);
        if (!m) continue;
        req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        req.query = Object.fromEntries(url.searchParams);
        if (req.method === 'POST' && (url.pathname === '/api/uploads' || url.pathname === '/api/worker/documents')) { req.rawBody = await readRaw(req, 21e6); req.body = {}; }
        else req.body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
        req.user = userFrom(req);
        const out = await r.handler(req);
        if (out.redirect) { res.writeHead(303, { Location: out.redirect }); return res.end(); }
        if (out.file) {
          if (!fs.existsSync(out.file) && !(await files.restore(out.file))) fail(404, 'Not found');
          res.writeHead(200, { 'Content-Type': out.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', ...out.headers });
          return fs.createReadStream(out.file).pipe(res);
        }
        if (out.html) { res.writeHead(200, { 'Content-Type': MIME['.html'] }); return res.end(out.html); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(out));
      }
      if (req.method !== 'GET') fail(404, 'Not found');
      const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) fail(404, 'Not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      const status = e.status || (e instanceof escrow.EscrowError || e instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error(e);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong' : e.message }));
    }
  }

  return { db, handle };
}

if (require.main === module) {
  (async () => {
    const app = createApp();
    // Firebase database: load data from Firestore (or upload it the first time) before taking requests.
    const firestore = require('./firestore');
    const sync = firestore.enabled(process.env) ? await firestore.attach(app.db, process.env) : null;
    const port = Number(process.env.PORT || 3000);
    const server = http.createServer(app.handle).listen(port, () => console.log(`KaamWala running on http://localhost:${port}`));
    // Free hosts put the app to sleep when nobody uses it, so also check for due escrow releases on every start.
    escrow.autoRelease(app.db);
    setInterval(() => escrow.autoRelease(app.db), 10 * 60 * 1000).unref();
    const shutdown = async () => {
      server.close();
      if (sync) { sync.stop(); await sync.flush().catch((e) => console.error('Firestore: last changes not saved.', e.message)); }
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { createApp };
