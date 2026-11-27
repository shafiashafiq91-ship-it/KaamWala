'use strict';
// Accounts: registration and login, one account with a customer role, a worker role or both,
// customer profile (addresses, favourites, blocks, payment history), worker profile (services,
// prices, availability, portfolio), private verification documents and admin verification.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const auth = require('./auth');
const firebase = require('./firebase');

const CATEGORIES = ['electrician', 'plumber', 'ac', 'carpenter', 'painter', 'appliance', 'cleaning'];
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Gujranwala', 'Sialkot', 'Quetta'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOC_KINDS = ['cnic_front', 'cnic_back', 'selfie', 'certificate', 'other'];
const DOC_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
const MAX_DOCS = 12;

const blockedBetween = (db, a, b) => !!db.prepare('SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)').get(a, b, b, a);

// Fields customers must never see on a worker profile.
const PRIVATE = ['payout_wallet', 'payout_provider', 'verification_note', 'verified_by', 'photo_id', 'phone'];
const stripPrivate = (w) => { const out = { ...w }; for (const k of PRIVATE) delete out[k]; return out; };

const publicUser = (u) => u && { id: u.id, role: u.role, name: u.name, phone: u.phone, phone_display: auth.displayPhone(u.phone), email: u.email, area: u.area, lang: u.lang, has_password: !!u.password_hash, created_at: u.created_at };

function publicWorker(db, w, viewer) {
  const out = viewer && (viewer.id === w.user_id || viewer.role === 'admin') ? { ...w } : stripPrivate(w);
  out.portfolio = db.prepare("SELECT id, mime FROM media WHERE owner_id = ? AND purpose = 'portfolio' ORDER BY created_at DESC").all(w.user_id).map((m) => ({ ...m, url: `/api/media/${m.id}` }));
  out.completed_jobs = db.prepare("SELECT COUNT(*) n FROM bookings WHERE worker_id = ? AND status = 'completed'").get(w.id).n;
  out.reviews = db.prepare(`SELECT r.rating, r.comment, r.created_at, u.name AS customer FROM reviews r JOIN bookings b ON b.id = r.booking_id
    JOIN users u ON u.id = b.customer_id WHERE r.worker_id = ? AND r.comment IS NOT NULL ORDER BY r.created_at DESC LIMIT 10`).all(w.id)
    .map((r) => ({ ...r, customer: r.customer.split(' ')[0] })); // first name only
  if (viewer) {
    out.favourite = !!db.prepare('SELECT 1 FROM favourites WHERE user_id = ? AND worker_id = ?').get(viewer.id, w.id);
    out.blocked = blockedBetween(db, viewer.id, w.user_id);
  }
  return out;
}

class Invalid extends Error {}
const str = (v, name, { min = 0, max = 200, required = false } = {}) => {
  const s = String(v ?? '').trim();
  if (!s && required) throw new Invalid(`Please enter ${name}`);
  if (s && s.length < min) throw new Invalid(`${name[0].toUpperCase() + name.slice(1)} is too short`);
  if (s.length > max) throw new Invalid(`${name[0].toUpperCase() + name.slice(1)} is too long`);
  return s;
};
const intIn = (v, name, lo, hi) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Invalid(`${name} must be a whole number from ${lo} to ${hi}`);
  return n;
};
const email = (v) => {
  const s = str(v, 'email', { max: 120 }).toLowerCase();
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw new Invalid('Enter a valid email address, or leave it empty');
  return s || null;
};
const city = (v) => { if (!CITIES.includes(v)) throw new Invalid('Choose your city'); return v; };
const hhmm = (v, name) => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) throw new Invalid(`Enter ${name} like 09:00`); return String(v); };

// Booking slots shown to customers, made from working hours (e.g. 09:00–18:00 → 9:00, 1:00, 5:00).
function slotsFor(from, to) {
  const a = +from.slice(0, 2), b = +to.slice(0, 2) - 1;
  const hours = [...new Set([a, Math.round((a + b) / 2), b])].filter((h) => h >= a && h <= b);
  return hours.map((h) => `${h % 12 || 12}:${from.slice(3)}`);
}

// Worker profile fields. `partial` = only validate what was sent (profile edits).
function workerFields(body, partial) {
  const f = {};
  const has = (k) => !partial || k in body;
  if (has('category')) { if (!CATEGORIES.includes(body.category)) throw new Invalid('Choose your main service'); f.category = body.category; }
  if (has('skills')) f.skills = str(body.skills, 'additional skills', { max: 300 });
  if (has('exp_years')) f.exp_years = intIn(body.exp_years, 'Years of experience', 0, 60);
  if (has('bio')) f.bio = str(body.bio, 'a short bio', { max: 600 });
  if (has('visit_fee')) f.visit_fee = intIn(body.visit_fee, 'Starting price', 100, 50000);
  if ('extra_rates' in body) f.extra_rates = str(body.extra_rates, 'price notes', { max: 120 });
  if (has('city')) f.city = city(body.city);
  if (has('areas')) f.areas = str(body.areas, 'your service area', { required: true, min: 3, max: 120 });
  if ('preferred_locations' in body) f.preferred_locations = str(body.preferred_locations, 'preferred locations', { max: 200 });
  if (has('hours_from')) f.hours_from = hhmm(body.hours_from ?? '09:00', 'the start time');
  if (has('hours_to')) f.hours_to = hhmm(body.hours_to ?? '18:00', 'the end time');
  if (f.hours_from && f.hours_to && f.hours_from >= f.hours_to) throw new Invalid('Working hours must end after they start');
  if ('work_days' in body) {
    const days = Array.isArray(body.work_days) ? body.work_days.filter((d) => DAYS.includes(d)) : [];
    if (!days.length) throw new Invalid('Choose at least one working day');
    f.work_days = JSON.stringify(DAYS.filter((d) => days.includes(d)));
  }
  if ('available' in body) f.available = body.available === true || body.available === 1 || body.available === '1' ? 1 : 0;
  if ('payout_provider' in body) { if (!['jazzcash', 'easypaisa'].includes(body.payout_provider)) throw new Invalid('Choose JazzCash or EasyPaisa'); f.payout_provider = body.payout_provider; }
  if ('payout_wallet' in body) {
    const p = auth.normalizePhone(body.payout_wallet);
    if (!p) throw new Invalid('Enter the wallet mobile number like 03001234567');
    f.payout_wallet = p;
  }
  if ('slots' in body) {
    if (!Array.isArray(body.slots) || body.slots.some((x) => !/^\d{1,2}:\d{2}$/.test(x))) throw new Invalid('Invalid time slots');
    f.slots = JSON.stringify(body.slots.slice(0, 8));
  }
  return f;
}

function mount({ db, env, route, need, fail, now, workerOf, workerRow, ratingSql, mediaUrl, uploadDir, keepFile = async () => {}, dropFile = async () => {}, notify }) {
  const lock = auth.throttle();
  const wrap = (fn) => async (req) => { try { return await fn(req); } catch (e) { if (e instanceof Invalid) fail(400, e.message); throw e; } };
  const r = (method, pattern, fn) => route(method, pattern, wrap(fn));
  const rolesOf = (userId) => db.prepare('SELECT role FROM user_roles WHERE user_id = ? ORDER BY created_at').all(userId).map((x) => x.role);
  const phoneOf = (v) => auth.normalizePhone(v) || fail(400, 'Enter a Pakistani mobile number like +92 300 1234567');
  const ownMedia = (id, user, purpose) => {
    if (id == null || id === '') return null;
    const m = db.prepare('SELECT * FROM media WHERE id = ?').get(String(id));
    if (!m || m.owner_id !== user.id || m.purpose !== purpose) fail(400, 'Upload the photo again');
    return m.id;
  };

  const startSession = (user) => {
    const token = auth.newToken();
    db.prepare('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)')
      .run(auth.tokenHash(token), user.id, now(), new Date(Date.now() + auth.SESSION_DAYS * 864e5).toISOString());
    return { token, user: publicUser(user), roles: rolesOf(user.id) };
  };

  const me = (u) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    const roles = rolesOf(u.id);
    const cp = roles.includes('customer') ? db.prepare('SELECT * FROM customer_profiles WHERE user_id = ?').get(u.id) : null;
    const w = roles.includes('worker') ? workerOf(u.id) : null;
    return {
      user: publicUser(user),
      roles,
      customer: cp && { city: cp.city, photo_url: mediaUrl(cp.photo_id), member_since: cp.created_at },
      worker: w ? workerRow(db.prepare(`SELECT w.*, u.name, ${ratingSql} FROM workers w JOIN users u ON u.id = w.user_id WHERE w.id = ?`).get(w.id)) : null,
    };
  };

  // ---------- one-time codes, registration, login ----------
  // With Firebase set up, Firebase sends and checks the SMS code and we check its signed token.
  // Without it, our own codes are used (fixed demo code until an SMS gateway is set).
  r('GET', '/api/auth-config', () => firebase.clientConfig(env));
  const codeOk = async (phone, b) => {
    if (!firebase.enabled(env)) return auth.checkOtp(db, env, phone, b.otp);
    try { return (await firebase.verifyPhoneToken(env, b.firebase_token)) === phone; } catch { return false; }
  };

  r('POST', '/api/otp', async (req) => {
    const phone = phoneOf(req.body.phone);
    const purpose = req.body.purpose === 'register' ? 'register' : 'login';
    if (purpose === 'register' && db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone))
      fail(409, 'An account with this number already exists. Log in, then add the other role from your profile.');
    if (firebase.enabled(env)) return { sent: false, firebase: true }; // the app asks Firebase directly
    const out = await auth.issueOtp(db, env, phone, purpose);
    if (out.error) fail(429, out.error);
    return out;
  });

  r('POST', '/api/register', async (req) => {
    const b = req.body;
    const role = b.role;
    if (!['customer', 'worker'].includes(role)) fail(400, 'Choose customer or worker');
    const phone = phoneOf(b.phone);
    const name = str(b.name, 'your full name', { required: true, min: 3, max: 60 });
    const mail = email(b.email);
    const cityName = city(b.city);
    const pwErr = auth.checkPasswordRules(b.password);
    if (pwErr) fail(400, pwErr);
    const worker = role === 'worker' ? workerFields({ ...b, city: cityName }, false) : null;
    if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) fail(409, 'An account with this number already exists. Log in, then add the other role from your profile.');
    if (lock.locked(phone)) fail(429, 'Too many wrong codes. Try again in 15 minutes.');
    if (!(await codeOk(phone, b))) { lock.fail(phone); fail(400, 'Wrong or expired code'); }
    lock.ok(phone);
    const t = now();
    const id = db.prepare('INSERT INTO users (role,name,phone,email,password_hash,area,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(role, name, phone, mail, auth.hashPassword(b.password), str(b.area, 'area', { max: 60 }) || (cityName === 'Lahore' ? 'Johar Town' : cityName), t).lastInsertRowid;
    db.prepare('INSERT INTO user_roles (user_id, role, created_at) VALUES (?,?,?)').run(id, role, t);
    if (role === 'customer') db.prepare('INSERT INTO customer_profiles (user_id, city, created_at) VALUES (?,?,?)').run(id, cityName, t);
    else createWorker(id, phone, worker);
    return startSession(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  });

  // New worker profiles start unverified and hidden from customers until an admin verifies them.
  function createWorker(userId, phone, f) {
    const cols = { ...f, user_id: userId, status: 'pending', verification: 'unsubmitted', cnic_verified: 0, distance_km: Math.round((1.5 + Math.random() * 3.5) * 10) / 10,
      slots: JSON.stringify(slotsFor(f.hours_from, f.hours_to)), payout_wallet: phone, payout_provider: 'jazzcash', created_at: now(), exp_documented: 0 };
    const keys = Object.keys(cols);
    db.prepare(`INSERT INTO workers (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => cols[k]));
  }

  // Password login, or one-time code login. A code login for a new number creates a basic customer account.
  r('POST', '/api/login', async (req) => {
    const phone = phoneOf(req.body.phone);
    if (lock.locked(phone)) fail(429, 'Too many wrong attempts. Try again in 15 minutes.');
    let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (req.body.password != null && req.body.password !== '') {
      if (!user || !auth.verifyPassword(req.body.password, user.password_hash)) { lock.fail(phone); fail(400, 'Wrong mobile number or password'); }
    } else {
      if (!(await codeOk(phone, req.body))) { lock.fail(phone); fail(400, 'Wrong code'); }
      if (!user) {
        const id = db.prepare("INSERT INTO users (role,name,phone,created_at) VALUES ('customer',?,?,?)").run(str(req.body.name, 'name', { max: 60 }) || 'New customer', phone, now()).lastInsertRowid;
        db.prepare("INSERT INTO user_roles (user_id, role, created_at) VALUES (?, 'customer', ?)").run(id, now());
        db.prepare('INSERT INTO customer_profiles (user_id, created_at) VALUES (?,?)').run(id, now());
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      }
    }
    lock.ok(phone);
    return startSession(user);
  });

  r('POST', '/api/logout', (req) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(auth.tokenHash((req.headers.authorization || '').replace(/^Bearer /, '')));
    return { ok: true };
  });

  // ---------- my account ----------
  r('GET', '/api/me', (req) => me(need(req)));
  r('PATCH', '/api/me', (req) => {
    const u = need(req);
    const b = req.body;
    const set = {};
    if ('name' in b) set.name = str(b.name, 'your full name', { required: true, min: 3, max: 60 });
    if ('email' in b) set.email = email(b.email);
    if ('lang' in b) { if (!['en', 'ur'].includes(b.lang)) fail(400, 'Unknown language'); set.lang = b.lang; }
    if ('area' in b) set.area = str(b.area, 'area', { max: 60 });
    for (const [k, v] of Object.entries(set)) db.prepare(`UPDATE users SET ${k} = ? WHERE id = ?`).run(v, u.id);
    const isCustomer = rolesOf(u.id).includes('customer');
    if ('city' in b && isCustomer) db.prepare('UPDATE customer_profiles SET city = ? WHERE user_id = ?').run(city(b.city), u.id);
    if ('photo_id' in b && isCustomer) db.prepare('UPDATE customer_profiles SET photo_id = ? WHERE user_id = ?').run(ownMedia(b.photo_id, u, 'avatar'), u.id);
    return me(u);
  });
  r('POST', '/api/me/password', (req) => {
    const u = need(req);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    if (user.password_hash && !auth.verifyPassword(req.body.current || '', user.password_hash)) fail(400, 'Your current password is wrong');
    const err = auth.checkPasswordRules(req.body.password);
    if (err) fail(400, err);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(req.body.password), u.id);
    // Sign out other devices.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(u.id, auth.tokenHash((req.headers.authorization || '').replace(/^Bearer /, '')));
    return { ok: true };
  });

  // Add the other role to the same account (no second account, same phone and login).
  r('POST', '/api/me/roles', (req) => {
    const u = need(req, 'customer', 'worker');
    const role = req.body.role;
    if (!['customer', 'worker'].includes(role)) fail(400, 'Choose customer or worker');
    if (rolesOf(u.id).includes(role)) fail(409, 'You already have this role');
    if (role === 'worker') {
      const f = workerFields(req.body, false);
      if (workerOf(u.id)) fail(409, 'A worker profile already exists for this account');
      createWorker(u.id, u.phone, f);
    } else {
      db.prepare('INSERT OR IGNORE INTO customer_profiles (user_id, city, created_at) VALUES (?,?,?)').run(u.id, req.body.city ? city(req.body.city) : (workerOf(u.id)?.city || 'Lahore'), now());
    }
    db.prepare('INSERT INTO user_roles (user_id, role, created_at) VALUES (?,?,?)').run(u.id, role, now());
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id); // start using the new role
    return me(u);
  });
  // Switch between my roles. Saved on the account, so it is the same after logging out and in again.
  r('POST', '/api/me/role', (req) => {
    const u = need(req, 'customer', 'worker');
    if (!['customer', 'worker'].includes(req.body.role) || !rolesOf(u.id).includes(req.body.role)) fail(403, 'This account does not have that role yet');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, u.id);
    return me(u);
  });

  // ---------- customer: saved addresses ----------
  const addressFields = (b, partial) => {
    const f = {};
    if (!partial || 'label' in b) f.label = str(b.label, 'a label (e.g. Home)', { required: true, max: 30 });
    if (!partial || 'line' in b) f.line = str(b.line, 'the address', { required: true, min: 5, max: 200 });
    if ('area' in b) f.area = str(b.area, 'area', { max: 60 });
    if (!partial || 'city' in b) f.city = city(b.city || 'Lahore');
    return f;
  };
  const myAddresses = (uid) => db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id').all(uid);
  const setDefault = (uid, id) => { db.prepare('UPDATE addresses SET is_default = (id = ?) WHERE user_id = ?').run(id, uid); };
  r('GET', '/api/addresses', (req) => ({ addresses: myAddresses(need(req, 'customer').id) }));
  r('POST', '/api/addresses', (req) => {
    const u = need(req, 'customer');
    if (myAddresses(u.id).length >= 10) fail(400, 'You can save up to 10 addresses');
    const f = addressFields(req.body, false);
    const id = db.prepare('INSERT INTO addresses (user_id,label,line,area,city,created_at) VALUES (?,?,?,?,?,?)').run(u.id, f.label, f.line, f.area || null, f.city, now()).lastInsertRowid;
    if (req.body.is_default || myAddresses(u.id).length === 1) setDefault(u.id, id);
    return { addresses: myAddresses(u.id) };
  });
  const ownAddress = (req) => {
    const u = need(req, 'customer');
    const a = db.prepare('SELECT * FROM addresses WHERE id = ?').get(req.params.id);
    if (!a || a.user_id !== u.id) fail(404, 'Address not found');
    return { u, a };
  };
  r('PATCH', '/api/addresses/:id', (req) => {
    const { u, a } = ownAddress(req);
    const f = addressFields(req.body, true);
    for (const [k, v] of Object.entries(f)) db.prepare(`UPDATE addresses SET ${k} = ? WHERE id = ?`).run(v, a.id);
    if (req.body.is_default) setDefault(u.id, a.id);
    return { addresses: myAddresses(u.id) };
  });
  r('DELETE', '/api/addresses/:id', (req) => {
    const { u, a } = ownAddress(req);
    db.prepare('DELETE FROM addresses WHERE id = ?').run(a.id);
    const left = myAddresses(u.id);
    if (a.is_default && left.length) setDefault(u.id, left[0].id);
    return { addresses: myAddresses(u.id) };
  });

  // ---------- customer: favourite workers ----------
  r('GET', '/api/favourites', (req) => {
    const u = need(req, 'customer');
    return { workers: db.prepare(`SELECT w.*, u.name, ${ratingSql} FROM favourites f JOIN workers w ON w.id = f.worker_id JOIN users u ON u.id = w.user_id
      WHERE f.user_id = ? ORDER BY f.created_at DESC`).all(u.id).map((w) => ({ ...stripPrivate(workerRow(w)), bookable: w.status === 'active' && w.verification === 'verified' && !!w.available })) };
  });
  r('POST', '/api/favourites/:id', (req) => {
    const u = need(req, 'customer');
    const w = db.prepare("SELECT id FROM workers WHERE id = ? AND verification = 'verified' AND status = 'active'").get(req.params.id);
    if (!w) fail(404, 'Worker not found');
    db.prepare('INSERT OR IGNORE INTO favourites (user_id, worker_id, created_at) VALUES (?,?,?)').run(u.id, w.id, now());
    return { favourite: true };
  });
  r('DELETE', '/api/favourites/:id', (req) => {
    db.prepare('DELETE FROM favourites WHERE user_id = ? AND worker_id = ?').run(need(req, 'customer').id, req.params.id);
    return { favourite: false };
  });

  // ---------- blocking (customers block workers, workers block customers) ----------
  r('GET', '/api/blocks', (req) => {
    const u = need(req, 'customer', 'worker');
    return { blocked: db.prepare('SELECT b.blocked_id AS user_id, u.name, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.created_at DESC').all(u.id) };
  });
  r('POST', '/api/blocks', (req) => {
    const u = need(req, 'customer', 'worker');
    let target = Number(req.body.user_id);
    if (req.body.worker_id) target = db.prepare('SELECT user_id FROM workers WHERE id = ?').get(req.body.worker_id)?.user_id;
    const t = target && db.prepare('SELECT id, role FROM users WHERE id = ?').get(target);
    if (!t || t.id === u.id || t.role === 'admin') fail(400, 'This person cannot be blocked');
    // Workers can only block customers they have had a booking with.
    if (u.role === 'worker' && !db.prepare('SELECT 1 FROM bookings WHERE customer_id = ? AND worker_id = ?').get(t.id, workerOf(u.id).id)) fail(403, 'You can only block customers who booked you');
    db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?,?,?)').run(u.id, t.id, now());
    if (req.body.reason) db.prepare('INSERT INTO reports (reporter_id,worker_id,booking_id,body,created_at) VALUES (?,?,?,?,?)')
      .run(u.id, req.body.worker_id || null, req.body.booking_id || null, `Blocked: ${str(req.body.reason, 'reason', { max: 500 })}`, now());
    return { blocked: true };
  });
  r('DELETE', '/api/blocks/:userId', (req) => {
    db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(need(req, 'customer', 'worker').id, req.params.userId);
    return { blocked: false };
  });

  // ---------- customer: reviews given and payment history ----------
  r('GET', '/api/me/reviews', (req) => {
    const u = need(req, 'customer');
    return { reviews: db.prepare(`SELECT r.*, b.code, b.id AS booking_id, wu.name AS worker_name, w.category FROM reviews r JOIN bookings b ON b.id = r.booking_id
      JOIN workers w ON w.id = r.worker_id JOIN users wu ON wu.id = w.user_id WHERE b.customer_id = ? ORDER BY r.created_at DESC`).all(u.id) };
  });
  // Status comes only from the payment record, which only the provider callback marks as paid.
  r('GET', '/api/me/payments', (req) => {
    const u = need(req, 'customer');
    const payments = db.prepare(`SELECT p.id, p.booking_id, p.extra_id, p.provider, p.amount, p.status, p.txn_ref, p.provider_ref, p.created_at, p.updated_at,
        b.code, x.work AS addon_work FROM payments p JOIN bookings b ON b.id = p.booking_id LEFT JOIN extras x ON x.id = p.extra_id
      WHERE b.customer_id = ? ORDER BY p.id DESC`).all(u.id);
    const refunds = db.prepare(`SELECT l.id, l.booking_id, l.amount, l.provider, l.note, l.payout_status, l.created_at, b.code FROM ledger l
      JOIN bookings b ON b.id = l.booking_id WHERE b.customer_id = ? AND l.type = 'refund' ORDER BY l.id DESC`).all(u.id);
    return { payments, refunds };
  });

  // ---------- worker: own profile, edits, documents, portfolio ----------
  const ownWorker = (req) => {
    const u = need(req, 'worker');
    const w = workerOf(u.id);
    if (!w) fail(404, 'No worker profile');
    return { u, w };
  };
  const workerProfile = (u, w) => ({
    worker: publicWorker(db, workerRow(db.prepare(`SELECT w.*, u.name, ${ratingSql} FROM workers w JOIN users u ON u.id = w.user_id WHERE w.id = ?`).get(w.id)), u),
    documents: db.prepare('SELECT id, kind, mime, size, created_at FROM worker_documents WHERE worker_id = ? ORDER BY created_at').all(w.id).map((d) => ({ ...d, url: `/api/documents/${d.id}` })),
  });
  r('GET', '/api/worker/profile', (req) => { const { u, w } = ownWorker(req); return workerProfile(u, w); });
  r('PATCH', '/api/worker', (req) => {
    const { u, w } = ownWorker(req);
    const f = workerFields(req.body, true);
    if (f.category && f.category !== w.category && w.verification === 'verified') fail(400, 'Your main service was verified. Contact support to change it.');
    if ('photo_id' in req.body) f.photo_id = ownMedia(req.body.photo_id, u, 'avatar');
    if ((f.hours_from || f.hours_to) && !('slots' in req.body)) f.slots = JSON.stringify(slotsFor(f.hours_from || w.hours_from, f.hours_to || w.hours_to));
    if ((f.hours_from && !f.hours_to && f.hours_from >= w.hours_to) || (f.hours_to && !f.hours_from && w.hours_from >= f.hours_to)) fail(400, 'Working hours must end after they start');
    if ('name' in req.body) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(str(req.body.name, 'your full name', { required: true, min: 3, max: 60 }), u.id);
    for (const [k, v] of Object.entries(f)) db.prepare(`UPDATE workers SET ${k} = ? WHERE id = ?`).run(v, w.id);
    // Prices apply to new bookings only; existing bookings keep the price agreed at booking time.
    return { ...workerProfile(u, workerOf(u.id)), worker_row: workerRow(workerOf(u.id)) };
  });

  r('POST', '/api/worker/documents', async (req) => {
    const { w } = ownWorker(req);
    const kind = req.query.kind;
    if (!DOC_KINDS.includes(kind)) fail(400, 'Choose what this document is');
    const mime = (req.headers['content-type'] || '').split(';')[0];
    if (!DOC_TYPES[mime]) fail(400, 'Upload a photo (JPG, PNG, WebP) or a PDF');
    const buf = req.rawBody;
    if (!buf?.length) fail(400, 'Empty file');
    if (buf.length > 8e6) fail(413, 'File too large (max 8 MB)');
    if (db.prepare('SELECT COUNT(*) n FROM worker_documents WHERE worker_id = ?').get(w.id).n >= MAX_DOCS) fail(400, 'Too many documents. Remove one first.');
    const dir = path.join(uploadDir, 'private');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = crypto.randomBytes(16).toString('hex');
    const file = path.join(dir, id + DOC_TYPES[mime]);
    fs.writeFileSync(file, buf, { mode: 0o600 });
    await keepFile(file, buf);
    db.prepare('INSERT INTO worker_documents (id,worker_id,kind,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)').run(id, w.id, kind, mime, buf.length, file, now());
    // Uploading puts the profile in the review queue. It never verifies the worker by itself.
    if (['unsubmitted', 'rejected'].includes(w.verification)) db.prepare("UPDATE workers SET verification = 'pending', verification_note = NULL WHERE id = ?").run(w.id);
    return { id, kind, url: `/api/documents/${id}`, verification: workerOf(w.user_id).verification };
  });
  r('DELETE', '/api/worker/documents/:id', (req) => {
    const { w } = ownWorker(req);
    const d = db.prepare('SELECT * FROM worker_documents WHERE id = ? AND worker_id = ?').get(req.params.id, w.id);
    if (!d) fail(404, 'Document not found');
    if (w.verification === 'verified') fail(400, 'Documents of a verified profile are kept for the record. Contact support to change them.');
    db.prepare('DELETE FROM worker_documents WHERE id = ?').run(d.id);
    fs.rmSync(d.path, { force: true });
    dropFile(d.path);
    return { ok: true };
  });
  // Private: only the worker who uploaded it and admins. Never cached, never linked from public pages.
  r('GET', '/api/documents/:id', (req) => {
    const u = need(req);
    const d = db.prepare('SELECT d.*, w.user_id FROM worker_documents d JOIN workers w ON w.id = d.worker_id WHERE d.id = ?').get(req.params.id);
    if (!d || (u.role !== 'admin' && d.user_id !== u.id)) fail(404, 'Not found');
    return { file: d.path, mime: d.mime, headers: { 'Cache-Control': 'no-store', 'Content-Disposition': `inline; filename="${d.kind}${path.extname(d.path)}"` } };
  });
  r('DELETE', '/api/worker/portfolio/:id', (req) => {
    const { u } = ownWorker(req);
    const m = db.prepare("SELECT * FROM media WHERE id = ? AND owner_id = ? AND purpose = 'portfolio'").get(req.params.id, u.id);
    if (!m) fail(404, 'Photo not found');
    db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
    fs.rmSync(m.path, { force: true });
    dropFile(m.path);
    return { ok: true };
  });

  // ---------- admin: worker verification ----------
  r('GET', '/api/admin/verifications', (req) => {
    need(req, 'admin');
    const rows = db.prepare(`SELECT w.*, u.name, u.phone, u.email FROM workers w JOIN users u ON u.id = w.user_id
      ORDER BY CASE w.verification WHEN 'pending' THEN 0 WHEN 'unsubmitted' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END, w.id DESC`).all();
    return {
      workers: rows.map((w) => ({ ...workerRow(w), documents: db.prepare('SELECT id, kind, mime, size, created_at FROM worker_documents WHERE worker_id = ? ORDER BY created_at').all(w.id) })),
    };
  });
  r('POST', '/api/admin/workers/:id/verification', (req) => {
    const admin = need(req, 'admin');
    const w = db.prepare('SELECT * FROM workers WHERE id = ?').get(req.params.id);
    if (!w) fail(404, 'Worker not found');
    const note = str(req.body.note, 'a note', { max: 500 });
    if (req.body.decision === 'verified') {
      const kinds = db.prepare('SELECT kind FROM worker_documents WHERE worker_id = ?').all(w.id).map((d) => d.kind);
      if (!kinds.includes('cnic_front') || !kinds.includes('cnic_back')) fail(400, 'Both sides of the CNIC are needed before verifying');
      db.prepare(`UPDATE workers SET verification = 'verified', cnic_verified = 1, verification_note = ?, verified_at = ?, verified_by = ?,
        status = CASE WHEN status = 'suspended' THEN status ELSE 'active' END WHERE id = ?`).run(note || null, now(), admin.id, w.id);
      notify(db, w.user_id, null, null, 'verification', 'Your KaamWala profile is verified. Customers can now find and book you.');
    } else if (req.body.decision === 'rejected') {
      if (!note) fail(400, 'Tell the worker what to fix');
      db.prepare(`UPDATE workers SET verification = 'rejected', cnic_verified = 0, verification_note = ?, verified_at = NULL, verified_by = ?,
        status = CASE WHEN status = 'suspended' THEN status ELSE 'pending' END WHERE id = ?`).run(note, admin.id, w.id);
      notify(db, w.user_id, null, null, 'verification', `Your verification was not approved: ${note}. Upload clearer documents to try again.`);
    } else fail(400, 'Choose verified or rejected');
    return { worker: workerRow(db.prepare('SELECT * FROM workers WHERE id = ?').get(w.id)) };
  });
}

module.exports = { mount, blockedBetween, publicWorker, stripPrivate, publicUser, CITIES, CATEGORIES, DAYS, slotsFor };
