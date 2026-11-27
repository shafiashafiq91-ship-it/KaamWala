'use strict';
// Accounts, roles, customer and worker profiles, verification and privacy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { start, PHONES } = require('./helpers');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

const CUSTOMER = { role: 'customer', name: 'Sara Malik', phone: '+92 321 5550101', password: 'secret123', email: 'sara@example.com', city: 'Lahore' };
const WORKER = {
  role: 'worker', name: 'Zain Abbas', phone: '0321-5550202', password: 'tools2024', city: 'Lahore', areas: 'Johar Town', category: 'plumber',
  skills: 'geysers, leaks', exp_years: 5, bio: 'Careful plumber', visit_fee: 650, hours_from: '09:00', hours_to: '18:00', work_days: ['Mon', 'Tue', 'Sat'],
};

async function register(t, body) {
  await t.call(null, '/api/otp', { phone: body.phone, purpose: 'register' });
  return t.call(null, '/api/register', { ...body, otp: '1234' });
}
const doc = (t, token, kind, buf = PNG, type = 'image/png') => fetch(`${t.base}/api/worker/documents?kind=${kind}`, { method: 'POST', headers: { 'Content-Type': type, Authorization: `Bearer ${token}` }, body: buf })
  .then(async (r) => ({ status: r.status, data: await r.json() }));
const raw = (t, token, path) => fetch(t.base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('customer registers with +92 number, OTP and a hashed password; logs in with the password', async () => {
  const t = await start();
  try {
    const r = await register(t, CUSTOMER);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.user.phone, '03215550101');
    assert.equal(r.data.user.phone_display, '+92 321 5550101');
    assert.deepEqual(r.data.roles, ['customer']);
    assert.equal(r.data.user.password_hash, undefined, 'hash is never sent to the app');
    const row = t.db.prepare('SELECT password_hash FROM users WHERE phone = ?').get('03215550101');
    assert.match(row.password_hash, /^scrypt\$/);
    assert.ok(!row.password_hash.includes('secret123'));
    // session tokens are stored hashed
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM sessions WHERE token = ?').get(r.data.token).n, 0);

    const ok = await t.call(null, '/api/login', { phone: '03215550101', password: 'secret123' });
    assert.equal(ok.status, 200);
    const me = await t.call(ok.data.token, '/api/me');
    assert.equal(me.data.customer.city, 'Lahore');
    assert.equal(me.data.user.email, 'sara@example.com');

    const bad = await t.call(null, '/api/login', { phone: '03215550101', password: 'nope1234' });
    assert.equal(bad.status, 400);
  } finally { t.close(); }
});

test('registration validation: duplicate phone, weak password, wrong code, bad phone', async () => {
  const t = await start();
  try {
    assert.equal((await register(t, { ...CUSTOMER, phone: PHONES.ahmed })).status, 409, 'no duplicate accounts');
    assert.equal((await t.call(null, '/api/otp', { phone: PHONES.ahmed, purpose: 'register' })).status, 409);
    assert.equal((await register(t, { ...CUSTOMER, password: 'short' })).status, 400);
    assert.equal((await register(t, { ...CUSTOMER, password: 'onlyletters' })).status, 400);
    assert.equal((await register(t, { ...CUSTOMER, phone: '12345' })).status, 400);
    assert.equal((await register(t, { ...CUSTOMER, email: 'not-an-email' })).status, 400);
    assert.equal((await t.call(null, '/api/register', { ...CUSTOMER, otp: '9999' })).status, 400);
    assert.equal(t.db.prepare("SELECT COUNT(*) n FROM users WHERE phone = '03215550101'").get().n, 0);
  } finally { t.close(); }
});

test('five wrong passwords lock the number for a while', async () => {
  const t = await start();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await t.call(null, '/api/login', { phone: PHONES.ahmed, password: 'wrong123' })).status, 400);
    const locked = await t.call(null, '/api/login', { phone: PHONES.ahmed, password: 'kaam1234' });
    assert.equal(locked.status, 429);
  } finally { t.close(); }
});

test('OTP codes are single use and expire when an SMS provider is configured', async () => {
  const t = await start({ SMS_API_URL: 'http://127.0.0.1:9/sms', SMS_API_KEY: 'x' });
  try {
    // With a provider set, the demo code no longer works and sending fails cleanly (no gateway here).
    assert.equal((await t.call(null, '/api/login', { phone: PHONES.ahmed, otp: '1234' })).status, 400);
    const auth = require('../src/auth');
    t.db.prepare('INSERT INTO otp_codes (phone,purpose,code_hash,expires_at,created_at) VALUES (?,?,?,?,?)')
      .run(PHONES.ahmed, 'login', auth.tokenHash(`${PHONES.ahmed}:482913`), new Date(Date.now() + 60e3).toISOString(), new Date().toISOString());
    assert.equal((await t.call(null, '/api/login', { phone: PHONES.ahmed, otp: '482913' })).status, 200);
    assert.equal((await t.call(null, '/api/login', { phone: PHONES.ahmed, otp: '482913' })).status, 400, 'used code');
    t.db.prepare('INSERT INTO otp_codes (phone,purpose,code_hash,expires_at,created_at) VALUES (?,?,?,?,?)')
      .run(PHONES.ahmed, 'login', auth.tokenHash(`${PHONES.ahmed}:111222`), new Date(Date.now() - 1).toISOString(), new Date().toISOString());
    assert.equal((await t.call(null, '/api/login', { phone: PHONES.ahmed, otp: '111222' })).status, 400, 'expired code');
  } finally { t.close(); }
});

test('worker registers: pending, hidden from customers, no badge; upload alone does not verify', async () => {
  const t = await start();
  try {
    const r = await register(t, WORKER);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const tok = r.data.token;
    let me = (await t.call(tok, '/api/me')).data;
    assert.equal(me.user.role, 'worker');
    assert.equal(me.worker.verification, 'unsubmitted');
    assert.equal(me.worker.id_verified, false);
    assert.deepEqual(me.worker.work_days, ['Mon', 'Tue', 'Sat']);
    assert.deepEqual(me.worker.slots, ['9:00', '1:00', '5:00']);
    const wid = me.worker.id;

    const cust = await t.login(PHONES.ahmed);
    const list = (await t.call(cust, '/api/workers?category=plumber')).data.workers;
    assert.ok(!list.some((w) => w.id === wid), 'not listed before verification');
    assert.equal((await t.call(cust, `/api/workers/${wid}`)).status, 404);
    const book = await t.call(cust, '/api/bookings', { worker_id: wid, problem: 'Leak', date: 'Mon 1 Jan', slot: '9:00', address: 'House 1', provider: 'jazzcash' });
    assert.equal(book.status, 404);

    assert.equal((await doc(t, tok, 'cnic_front')).status, 200);
    me = (await t.call(tok, '/api/me')).data;
    assert.equal(me.worker.verification, 'pending');
    assert.equal(me.worker.id_verified, false, 'uploading is not verification');
    assert.ok(!(await t.call(cust, '/api/workers?category=plumber')).data.workers.some((w) => w.id === wid));
    assert.equal((await doc(t, tok, 'cnic_front', Buffer.from('x'), 'text/plain')).status, 400);
    assert.equal((await doc(t, tok, 'passport')).status, 400);
  } finally { t.close(); }
});

test('verification documents are private: owner and admin only, never via public media links', async () => {
  const t = await start();
  try {
    const tok = (await register(t, WORKER)).data.token;
    const up = await doc(t, tok, 'cnic_front');
    const id = up.data.id;
    assert.equal((await raw(t, null, `/api/documents/${id}`)).status, 401);
    assert.equal((await raw(t, await t.login(PHONES.ahmed), `/api/documents/${id}`)).status, 404, 'customer');
    assert.equal((await raw(t, await t.login(PHONES.ali), `/api/documents/${id}`)).status, 404, 'other worker');
    assert.equal((await raw(t, null, `/api/media/${id}`)).status, 404, 'not a public media id');
    const own = await raw(t, tok, `/api/documents/${id}`);
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('cache-control'), 'no-store');
    const adm = await raw(t, await t.login(PHONES.admin), `/api/documents/${id}`);
    assert.equal(adm.status, 200);
    assert.deepEqual(Buffer.from(await adm.arrayBuffer()), PNG);
    // stored outside the public folder
    const p = t.db.prepare('SELECT path FROM worker_documents WHERE id = ?').get(id).path;
    assert.ok(!p.includes('/public/') && fs.existsSync(p));
    // public profile never lists documents or payout wallet
    const pub = await t.call(await t.login(PHONES.ahmed), '/api/workers/1');
    assert.equal(pub.data.worker.payout_wallet, undefined);
    assert.equal(pub.data.worker.documents, undefined);
    const list = await t.call(null, '/api/workers');
    assert.ok(list.data.workers.every((w) => w.payout_wallet === undefined));
  } finally { t.close(); }
});

test('admin verifies (needs both CNIC sides) or rejects with a reason; badge only after verification', async () => {
  const t = await start();
  try {
    const tok = (await register(t, WORKER)).data.token;
    const wid = (await t.call(tok, '/api/me')).data.worker.id;
    const admin = await t.login(PHONES.admin);
    await doc(t, tok, 'cnic_front');
    assert.equal((await t.call(admin, `/api/admin/workers/${wid}/verification`, { decision: 'verified' })).status, 400, 'back side missing');
    assert.equal((await t.call(admin, `/api/admin/workers/${wid}/verification`, { decision: 'rejected' })).status, 400, 'reason required');
    assert.equal((await t.call(tok, `/api/admin/workers/${wid}/verification`, { decision: 'verified' })).status, 403, 'worker cannot verify themself');
    const rej = await t.call(admin, `/api/admin/workers/${wid}/verification`, { decision: 'rejected', note: 'CNIC photo is blurry' });
    assert.equal(rej.data.worker.verification, 'rejected');
    let me = (await t.call(tok, '/api/me')).data;
    assert.equal(me.worker.verification_note, 'CNIC photo is blurry');
    await doc(t, tok, 'cnic_back');
    me = (await t.call(tok, '/api/me')).data;
    assert.equal(me.worker.verification, 'pending', 'new upload goes back into review');

    const queue = (await t.call(admin, '/api/admin/verifications')).data.workers;
    assert.equal(queue[0].id, wid);
    assert.equal(queue[0].documents.length, 2);

    const ok = await t.call(admin, `/api/admin/workers/${wid}/verification`, { decision: 'verified' });
    assert.equal(ok.data.worker.verification, 'verified');
    const cust = await t.login(PHONES.ahmed);
    const listed = (await t.call(cust, '/api/workers?category=plumber')).data.workers.find((w) => w.id === wid);
    assert.ok(listed && listed.id_verified);
    assert.ok((await t.call(tok, '/api/notifications')).data.notifications.some((n) => n.kind === 'verification'));
    assert.equal((await t.call(tok, '/api/worker/documents/' + queue[0].documents[0].id, null, 'DELETE')).status, 400, 'documents kept after verification');
  } finally { t.close(); }
});

test('one account, two roles: add worker role, switch, role survives logout/login, profiles separate', async () => {
  const t = await start();
  try {
    const reg = await register(t, CUSTOMER);
    const tok = reg.data.token;
    const { role: _, name, phone, password, email, ...work } = WORKER;
    const add = await t.call(tok, '/api/me/roles', { role: 'worker', ...work });
    assert.equal(add.status, 200, JSON.stringify(add.data));
    assert.deepEqual(add.data.roles.sort(), ['customer', 'worker']);
    assert.equal(add.data.user.role, 'worker');
    assert.equal(add.data.worker.verification, 'unsubmitted');
    assert.equal(t.db.prepare("SELECT COUNT(*) n FROM users WHERE phone = '03215550101'").get().n, 1, 'still one account');
    assert.equal((await t.call(tok, '/api/me/roles', { role: 'worker', ...work })).status, 409);

    // RBAC follows the active role
    assert.equal((await t.call(tok, '/api/addresses')).status, 403);
    assert.equal((await t.call(tok, '/api/worker/profile')).status, 200);
    await t.call(tok, '/api/logout', {});
    const again = await t.call(null, '/api/login', { phone: '03215550101', password: 'secret123' });
    assert.equal(again.data.user.role, 'worker', 'last role is remembered');

    const sw = await t.call(again.data.token, '/api/me/role', { role: 'customer' });
    assert.equal(sw.data.user.role, 'customer');
    assert.equal((await t.call(again.data.token, '/api/worker/profile')).status, 403);
    assert.equal((await t.call(again.data.token, '/api/addresses')).status, 200);
    // customer photo and worker photo are separate
    const av = await t.upload(again.data.token, PNG, 'image/png');
    assert.equal(av.status, 403, 'default upload is add-on photos (workers only)');
    const avatar = await fetch(`${t.base}/api/uploads?purpose=avatar`, { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${again.data.token}` }, body: PNG }).then((r) => r.json());
    const me = await t.call(again.data.token, '/api/me', { photo_id: avatar.id }, 'PATCH');
    assert.ok(me.data.customer.photo_url);
    assert.equal(me.data.worker.photo_url, null);

    const admin = await t.login(PHONES.admin);
    assert.equal((await t.call(admin, '/api/me/role', { role: 'customer' })).status, 403);
    const onlyCustomer = await t.login(PHONES.ahmed);
    assert.equal((await t.call(onlyCustomer, '/api/me/role', { role: 'worker' })).status, 403);
  } finally { t.close(); }
});

test('dual-role worker cannot book themself; own profile hidden from their customer search', async () => {
  const t = await start();
  try {
    const ali = await t.login(PHONES.ali); // seeded with worker + customer roles
    const me = (await t.call(ali, '/api/me')).data;
    assert.deepEqual(me.roles.sort(), ['customer', 'worker']);
    await t.call(ali, '/api/me/role', { role: 'customer' });
    const list = (await t.call(ali, '/api/workers?category=electrician')).data.workers;
    assert.ok(!list.some((w) => w.id === me.worker.id));
    const r = await t.call(ali, '/api/bookings', { worker_id: me.worker.id, problem: 'x', date: 'Mon', slot: '11:00', address: 'Home', provider: 'jazzcash' });
    assert.equal(r.status, 400);
  } finally { t.close(); }
});

test('customer: saved addresses, favourites, reviews given and payment history', async () => {
  const t = await start();
  try {
    const c = await t.login(PHONES.ahmed);
    let a = (await t.call(c, '/api/addresses')).data.addresses;
    assert.equal(a.length, 2);
    assert.equal(a[0].is_default, 1);
    a = (await t.call(c, '/api/addresses', { label: 'Parents', line: '7 Canal View, Lahore', area: 'Canal View', city: 'Lahore', is_default: true })).data.addresses;
    assert.equal(a[0].label, 'Parents');
    assert.equal(a.filter((x) => x.is_default).length, 1);
    assert.equal((await t.call(c, '/api/addresses', { label: '', line: 'x', city: 'Lahore' })).status, 400);
    const other = await t.login('03215550000');
    assert.equal((await t.call(other, `/api/addresses/${a[0].id}`, null, 'DELETE')).status, 404, 'cannot touch someone else’s address');
    a = (await t.call(c, `/api/addresses/${a[0].id}`, null, 'DELETE')).data.addresses;
    assert.equal(a.length, 2);
    assert.equal(a.filter((x) => x.is_default).length, 1, 'a default remains');

    let fav = (await t.call(c, '/api/favourites')).data.workers;
    assert.equal(fav.length, 2);
    await t.call(c, '/api/favourites/4', {});
    fav = (await t.call(c, '/api/favourites')).data.workers;
    assert.equal(fav.length, 3);
    assert.equal((await t.call(c, '/api/workers/4')).data.worker.favourite, true);
    await t.call(c, '/api/favourites/4', null, 'DELETE');
    assert.equal((await t.call(c, '/api/favourites')).data.workers.length, 2);

    const pays = (await t.call(c, '/api/me/payments')).data;
    assert.ok(pays.payments.length >= 3);
    assert.ok(pays.payments.every((p) => ['initiated', 'paid', 'failed'].includes(p.status)));
    assert.deepEqual((await t.call(c, '/api/me/reviews')).data.reviews, []);
  } finally { t.close(); }
});

test('reviews only from the booking’s customer, only after completion', async () => {
  const t = await start();
  try {
    const c = await t.login(PHONES.ahmed);
    const bookings = (await t.call(c, '/api/bookings')).data.bookings;
    const done = bookings.find((b) => b.code === 'KW-1025');
    const active = bookings.find((b) => b.code === 'KW-1024');
    assert.equal(done.stage, 'awaiting_approval');
    assert.equal(active.stage, 'in_progress');
    assert.equal((await t.call(c, `/api/bookings/${active.id}/review`, { rating: 5 })).status, 400);
    assert.equal((await t.call(await t.login('03215550000'), `/api/bookings/${done.id}/review`, { rating: 1 })).status, 403);
    assert.equal((await t.call(await t.login(PHONES.faisal), `/api/bookings/${done.id}/review`, { rating: 5 })).status, 403);
    assert.equal((await t.call(c, `/api/bookings/${done.id}/review`, { rating: 5, comment: 'Great work' })).status, 200);
    const mine = (await t.call(c, '/api/me/reviews')).data.reviews;
    assert.equal(mine[0].code, 'KW-1025');
    // release moves the stage to completed
    await t.call(c, `/api/bookings/${done.id}/release`, {});
    assert.equal((await t.call(c, `/api/bookings/${done.id}`)).data.booking.stage, 'completed');
  } finally { t.close(); }
});

test('booking with photos; worker sees customer phone and address only after accepting', async () => {
  const t = await start();
  try {
    const c = await t.login(PHONES.ahmed);
    const photo = await fetch(`${t.base}/api/uploads?purpose=booking`, { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${c}` }, body: PNG }).then((r) => r.json());
    const w = await t.login(PHONES.ali);
    const bad = await fetch(`${t.base}/api/uploads?purpose=booking`, { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${w}` }, body: PNG });
    assert.equal(bad.status, 403, 'workers cannot upload booking photos');
    const r = await t.call(c, '/api/bookings', { worker_id: 1, problem: 'Fan not working', date: 'Mon', slot: '11:00', address: 'House 12, Block G', provider: 'jazzcash', media_ids: [photo.id] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.booking.photos.length, 1);
    assert.equal(r.data.booking.stage, 'pending');
    const id = r.data.booking.id;
    assert.equal((await t.call(c, '/api/bookings', { worker_id: 1, problem: 'x', date: 'Mon', slot: '11:00', address: 'y', provider: 'jazzcash', media_ids: [photo.id] })).status, 400, 'photo reused');

    let wb = (await t.call(w, `/api/bookings/${id}`)).data.booking;
    assert.equal(wb.customer.phone, null);
    assert.equal(wb.address, null);
    assert.equal(wb.customer_hidden, true);
    assert.equal(wb.photos.length, 1, 'worker sees the problem photos');
    assert.equal((await t.call(w, '/api/bookings')).data.bookings.find((b) => b.id === id).address, null);
    assert.ok((await t.call(w, '/api/notifications')).data.notifications.some((n) => n.kind === 'booking_new'));

    await t.simulate(r.data.payment.txn_ref, 'pay');
    await t.call(w, `/api/bookings/${id}/status`, { status: 'confirmed' });
    wb = (await t.call(w, `/api/bookings/${id}`)).data.booking;
    assert.equal(wb.customer.phone, PHONES.ahmed);
    assert.equal(wb.address, 'House 12, Block G');
    assert.equal(wb.stage, 'accepted');
    assert.ok((await t.call(c, '/api/notifications')).data.notifications.some((n) => n.kind === 'booking_confirmed'));
  } finally { t.close(); }
});

test('blocking hides the worker, stops new bookings and messages, and can be undone', async () => {
  const t = await start();
  try {
    const c = await t.login(PHONES.ahmed);
    const usman = 4;
    assert.equal((await t.call(c, '/api/blocks', { worker_id: usman, reason: 'Rude on the phone' })).status, 200);
    assert.ok(!(await t.call(c, '/api/workers?category=plumber')).data.workers.some((w) => w.id === usman));
    assert.equal((await t.call(c, '/api/bookings', { worker_id: usman, problem: 'x', date: 'Mon', slot: '11:00', address: 'y', provider: 'jazzcash' })).status, 403);
    const kw1024 = (await t.call(c, '/api/bookings')).data.bookings.find((b) => b.code === 'KW-1024');
    assert.equal((await t.call(c, `/api/bookings/${kw1024.id}/messages`, { body: 'hi' })).status, 403);
    assert.ok(t.db.prepare("SELECT 1 FROM reports WHERE body LIKE 'Blocked:%'").get(), 'reason goes to the admin complaints list');
    const blocked = (await t.call(c, '/api/blocks')).data.blocked;
    assert.equal(blocked.length, 1);
    await t.call(c, `/api/blocks/${blocked[0].user_id}`, null, 'DELETE');
    assert.ok((await t.call(c, '/api/workers?category=plumber')).data.workers.some((w) => w.id === usman));

    // A worker can block a customer who booked them, not random users.
    const w = await t.login(PHONES.usman);
    const ahmedId = t.db.prepare('SELECT id FROM users WHERE phone = ?').get(PHONES.ahmed).id;
    assert.equal((await t.call(w, '/api/blocks', { user_id: ahmedId })).status, 200);
    await t.login('03215550000');
    const stranger = t.db.prepare('SELECT id FROM users WHERE phone = ?').get('03215550000').id;
    assert.equal((await t.call(w, '/api/blocks', { user_id: stranger })).status, 403);
    assert.ok(!(await t.call(c, '/api/workers?category=plumber')).data.workers.some((x) => x.id === usman), 'hidden both ways');
  } finally { t.close(); }
});

test('worker updates prices and availability; existing bookings keep their price; off = not bookable', async () => {
  const t = await start();
  try {
    const w = await t.login(PHONES.ali);
    const c = await t.login(PHONES.ahmed);
    const b = await t.call(c, '/api/bookings', { worker_id: 1, problem: 'Socket', date: 'Mon', slot: '11:00', address: 'y', provider: 'jazzcash' });
    const p = await t.call(w, '/api/worker', { visit_fee: 950, hours_from: '10:00', hours_to: '20:00', work_days: ['Mon', 'Sun'], bio: 'Updated' }, 'PATCH');
    assert.equal(p.status, 200, JSON.stringify(p.data));
    assert.equal(p.data.worker.visit_fee, 950);
    assert.deepEqual(p.data.worker.slots, ['10:00', '3:00', '7:00']);
    assert.equal((await t.call(c, `/api/bookings/${b.data.booking.id}`)).data.booking.visit_fee, 800, 'agreed price unchanged');
    assert.equal((await t.call(w, '/api/worker', { visit_fee: 5 }, 'PATCH')).status, 400);
    assert.equal((await t.call(w, '/api/worker', { hours_from: '20:00', hours_to: '09:00' }, 'PATCH')).status, 400);
    assert.equal((await t.call(w, '/api/worker', { category: 'plumber' }, 'PATCH')).status, 400, 'verified category is locked');
    assert.equal((await t.call(c, '/api/worker', { visit_fee: 1 }, 'PATCH')).status, 403, 'customers cannot edit workers');

    await t.call(w, '/api/worker', { available: false }, 'PATCH');
    assert.ok(!(await t.call(c, '/api/workers?category=electrician')).data.workers.some((x) => x.id === 1));
    assert.equal((await t.call(c, '/api/bookings', { worker_id: 1, problem: 'x', date: 'Mon', slot: '11:00', address: 'y', provider: 'jazzcash' })).status, 404);
    await t.call(w, '/api/worker', { available: true }, 'PATCH');
    assert.ok((await t.call(c, '/api/workers?category=electrician')).data.workers.some((x) => x.id === 1));

    const earn = (await t.call(w, '/api/worker/earnings')).data;
    assert.ok('this_month' in earn && 'payout_pending' in earn && 'completed_jobs' in earn);
  } finally { t.close(); }
});

test('portfolio photos show on the public profile; only the owner can remove them', async () => {
  const t = await start();
  try {
    const w = await t.login(PHONES.ali);
    const up = await fetch(`${t.base}/api/uploads?purpose=portfolio`, { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${w}` }, body: PNG }).then((r) => r.json());
    const c = await t.login(PHONES.ahmed);
    const pub = (await t.call(c, '/api/workers/1')).data.worker;
    assert.equal(pub.portfolio.length, 1);
    assert.equal((await raw(t, null, pub.portfolio[0].url)).status, 200);
    assert.equal((await t.call(await t.login(PHONES.usman), `/api/worker/portfolio/${up.id}`, null, 'DELETE')).status, 404);
    assert.equal((await t.call(w, `/api/worker/portfolio/${up.id}`, null, 'DELETE')).status, 200);
    assert.equal((await t.call(c, '/api/workers/1')).data.worker.portfolio.length, 0);
  } finally { t.close(); }
});

test('changing the password signs out other devices; old databases gain the new columns', async () => {
  const t = await start();
  try {
    const a = (await t.call(null, '/api/login', { phone: PHONES.ahmed, password: 'kaam1234' })).data.token;
    const b = (await t.call(null, '/api/login', { phone: PHONES.ahmed, password: 'kaam1234' })).data.token;
    assert.equal((await t.call(a, '/api/me/password', { current: 'wrong', password: 'newpass99' })).status, 400);
    assert.equal((await t.call(a, '/api/me/password', { current: 'kaam1234', password: 'newpass99' })).status, 200);
    assert.equal((await t.call(b, '/api/me')).status, 401);
    assert.equal((await t.call(a, '/api/me')).status, 200);
    const cols = t.db.prepare('PRAGMA table_info(workers)').all().map((c) => c.name);
    for (const c of ['verification', 'bio', 'hours_from', 'available', 'photo_id']) assert.ok(cols.includes(c));
  } finally { t.close(); }
});
