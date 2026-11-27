'use strict';
// Add-on service requests: approval, rejection, price changes, duplicates and fraud prevention.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start, PHONES } = require('./helpers');
const { open } = require('../src/db');

// Demo booking KW-1024: Ahmed + plumber Usman, tap repair Rs 1,000, job in progress, Rs 1,000 held in escrow,
// with a pending add-on: pipe repair Rs 700 labour + Rs 300 materials.
async function demo() {
  const t = await start();
  const cust = await t.login(PHONES.ahmed);
  const wrk = await t.login(PHONES.usman);
  const b = t.db.prepare("SELECT * FROM bookings WHERE code = 'KW-1024'").get();
  const pending = t.db.prepare("SELECT * FROM extras WHERE booking_id = ? AND status = 'pending'").get(b.id);
  const get = async () => (await t.call(cust, `/api/bookings/${b.id}`)).data.booking;
  const addon = (token, body) => t.call(token, `/api/bookings/${b.id}/addons`, body);
  return { t, cust, wrk, b, pending, get, addon };
}

test('spec example: Rs 1,000 + Rs 700 labour + Rs 300 materials = Rs 2,000 after approval and payment', async () => {
  const { t, cust, pending, get } = await demo();
  let bk = await get();
  assert.equal(bk.price.approved_total, 1000, 'pending add-on does not count yet');

  const r = await t.call(cust, `/api/addons/${pending.id}/approve`, { provider: 'jazzcash' });
  assert.equal(r.status, 200);
  assert.equal(r.data.addon.status, 'approved');
  assert.equal(r.data.addon.pay_status, 'unpaid', 'approval alone never takes money');
  assert.equal(r.data.payment.pay_url.startsWith('/pay/'), true);
  bk = await get();
  assert.equal(bk.price.approved_total, 2000);
  assert.equal(bk.price.unpaid, 1000);
  assert.equal(bk.escrow.held, 1000);

  await t.simulate(r.data.payment.txn_ref, 'pay');
  bk = await get();
  const x = bk.extras.find((y) => y.id === pending.id);
  assert.equal(x.pay_status, 'paid');
  assert.equal(bk.escrow.held, 2000);
  assert.deepEqual([bk.price.original.amount, x.labour, x.materials, bk.price.approved_total], [1000, 700, 300, 2000]);
  assert.equal(bk.price.unpaid, 0);
  assert.equal(x.decided_by, t.db.prepare('SELECT id FROM users WHERE phone = ?').get(PHONES.ahmed).id);
  assert.ok(x.decided_at);

  const events = bk.price_events.map((e) => [e.event, e.approved_total]);
  assert.deepEqual(events, [['booking_created', 1000], ['addon_requested', 1000], ['addon_approved', 2000], ['addon_paid', 2000]]);
  t.close();
});

test('the server computes the price; totals sent by the client are ignored', async () => {
  const { t, wrk, addon } = await demo();
  const r = await addon(wrk, { problem: 'Drain blocked further down', work: 'Clear the drain line', labour: 400, materials: 150, amount: 1, total: 1, revised_total: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.data.addon.amount, 550);
  for (const bad of [{ labour: -100 }, { labour: 99.5 }, { labour: 'abc' }, { labour: 0, materials: 0 }, { labour: 9e9 }]) {
    const res = await addon(wrk, { problem: 'Something else found', work: `Work ${JSON.stringify(bad)}`, ...bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  t.close();
});

test('reject: stays on record at Rs 0, total unchanged, cannot be approved or paid later', async () => {
  const { t, cust, pending, get } = await demo();
  const r = await t.call(cust, `/api/addons/${pending.id}/reject`, { reason: 'Will get it done later' });
  assert.equal(r.data.addon.status, 'rejected');
  const bk = await get();
  assert.equal(bk.price.approved_total, 1000);
  assert.equal(bk.extras.length, 1);
  assert.equal(bk.extras[0].reject_reason, 'Will get it done later');
  assert.equal((await t.call(cust, `/api/addons/${pending.id}/approve`, {})).status, 409);
  assert.equal((await t.call(cust, `/api/addons/${pending.id}/pay`, { provider: 'jazzcash' })).status, 400);
  t.close();
});

test('repeated or simultaneous approvals count the add-on once', async () => {
  const { t, cust, pending, get } = await demo();
  const results = await Promise.all([1, 2, 3].map(() => t.call(cust, `/api/addons/${pending.id}/approve`, {})));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
  assert.equal((await get()).price.approved_total, 2000);
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM price_events WHERE event = 'addon_approved' AND extra_id = ?").get(pending.id).n, 1);
  t.close();
});

test('duplicate requests: a retried submit returns the original, the same pending work is refused', async () => {
  const { t, wrk, addon, b } = await demo();
  const body = { problem: 'Second tap also drips', work: 'Replace washer on bathroom tap', labour: 200, materials: 50, client_key: 'abc-123' };
  const a = await addon(wrk, body);
  const again = await addon(wrk, body);
  assert.equal(again.data.addon.id, a.data.addon.id);
  assert.equal(again.data.duplicate, true);
  const sameWork = await addon(wrk, { ...body, client_key: 'other' });
  assert.equal(sameWork.status, 409);
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM extras WHERE booking_id = ? AND work LIKE 'Replace washer%'").get(b.id).n, 1);
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'addon_requested' AND body LIKE '%washer%'").get().n, 1);
  t.close();
});

test('only the right people can act: worker cannot approve, other customers and workers are locked out', async () => {
  const { t, wrk, pending, addon } = await demo();
  const otherCustomer = await t.login('03215550000');
  const otherWorker = await t.login(PHONES.ali);
  const cust = await t.login(PHONES.ahmed);
  assert.equal((await t.call(wrk, `/api/addons/${pending.id}/approve`, {})).status, 403, 'worker approving their own request');
  assert.equal((await t.call(otherCustomer, `/api/addons/${pending.id}/approve`, {})).status, 403);
  assert.equal((await t.call(otherCustomer, `/api/addons/${pending.id}`)).status, 403);
  assert.equal((await addon(otherWorker, { problem: 'Fake problem here', work: 'Fake work here', labour: 500 })).status, 403);
  assert.equal((await addon(cust, { problem: 'Customer cannot', work: 'Customer cannot', labour: 500 })).status, 403);
  assert.equal((await t.call(otherWorker, `/api/addons/${pending.id}/cancel`, {})).status, 403);
  t.close();
});

test('approved amounts cannot be changed; paid add-ons cannot be withdrawn; unpaid ones can', async () => {
  const { t, cust, wrk, pending, get } = await demo();
  const r = await t.call(cust, `/api/addons/${pending.id}/approve`, {});
  assert.equal(r.status, 200);
  for (const m of ['PATCH', 'PUT']) assert.equal((await t.call(wrk, `/api/addons/${pending.id}`, { labour: 5000 }, m)).status, 404);
  // approved but unpaid: worker may withdraw, total drops back
  assert.equal((await t.call(wrk, `/api/addons/${pending.id}/cancel`, {})).status, 200);
  assert.equal((await get()).price.approved_total, 1000);
  // a new one, approved and paid, cannot be withdrawn
  const n = await t.call(wrk, `/api/bookings/${pending.booking_id}/addons`, { problem: 'Pipe cracked again', work: 'Replace pipe section (2nd try)', labour: 700, materials: 300 });
  const pay = await t.call(cust, `/api/addons/${n.data.addon.id}/approve`, { provider: 'easypaisa' });
  await t.simulate(pay.data.payment.txn_ref, 'pay');
  assert.equal((await t.call(wrk, `/api/addons/${n.data.addon.id}/cancel`, {})).status, 400);
  assert.equal((await get()).price.approved_total, 2000);
  t.close();
});

test('payment is only marked paid by the provider; the amount always comes from the record', async () => {
  const { t, cust, wrk, pending, get } = await demo();
  await t.call(cust, `/api/addons/${pending.id}/approve`, {});
  const p = await t.call(cust, `/api/addons/${pending.id}/pay`, { provider: 'jazzcash', amount: 1 });
  assert.equal(t.db.prepare('SELECT amount FROM payments WHERE txn_ref = ?').get(p.data.payment.txn_ref).amount, 1000);
  // worker has no way to mark it paid
  assert.equal((await t.call(wrk, `/api/addons/${pending.id}/pay`, { provider: 'jazzcash' })).status, 403);
  // a failed or cancelled wallet payment leaves it unpaid
  await t.simulate(p.data.payment.txn_ref, 'cancel');
  let x = (await get()).extras.find((y) => y.id === pending.id);
  assert.equal(x.pay_status, 'unpaid');
  // with real JazzCash credentials, a forged callback is rejected (see flow.test.js); here the simulator confirms it
  const p2 = await t.call(cust, `/api/addons/${pending.id}/pay`, { provider: 'jazzcash' });
  await t.simulate(p2.data.payment.txn_ref, 'pay');
  x = (await get()).extras.find((y) => y.id === pending.id);
  assert.equal(x.pay_status, 'paid');
  assert.equal((await t.call(cust, `/api/addons/${pending.id}/pay`, { provider: 'jazzcash' })).status, 400, 'cannot pay twice');
  t.close();
});

test('job cannot be completed with a pending or approved-but-unpaid add-on', async () => {
  const { t, cust, wrk, pending, b } = await demo();
  const complete = () => t.call(wrk, `/api/bookings/${b.id}/status`, { status: 'completed' });
  assert.equal((await complete()).status, 400);
  await t.call(cust, `/api/addons/${pending.id}/approve`, {});
  assert.equal((await complete()).status, 400);
  const p = await t.call(cust, `/api/addons/${pending.id}/pay`, { provider: 'easypaisa' });
  await t.simulate(p.data.payment.txn_ref, 'pay');
  assert.equal((await complete()).status, 200);
  t.close();
});

test('large increases are flagged to the customer and admins', async () => {
  const { t, cust, wrk, addon } = await demo();
  const small = await addon(wrk, { problem: 'Loose tap handle', work: 'Tighten tap handle', labour: 200 });
  assert.equal(small.data.addon.over_threshold, 0);
  assert.equal(small.data.comparison.over, false);
  const big = await addon(wrk, { problem: 'Whole kitchen line is rusted', work: 'Replace kitchen water line', labour: 3000, materials: 4000 });
  assert.equal(big.data.addon.over_threshold, 1);
  const seen = (await t.call(cust, `/api/addons/${big.data.addon.id}`)).data.comparison;
  assert.equal(seen.over, true);
  assert.equal(seen.original, 1000);
  assert.equal(seen.revised, 8000);
  const admin = await t.login(PHONES.admin);
  const ov = (await t.call(admin, '/api/admin/addons')).data;
  assert.ok(ov.addons.find((x) => x.id === big.data.addon.id).flags.includes('over price limit'));
  t.close();
});

test('safety hazards need an explanation and still need the customer\'s approval', async () => {
  const { t, wrk, addon, b } = await demo();
  assert.equal((await addon(wrk, { problem: 'Exposed live wire', work: 'Re-insulate wire', labour: 300, urgent_safety: true })).status, 400);
  const r = await addon(wrk, { problem: 'Exposed live wire near the sink', work: 'Re-insulate and box the wire', labour: 300, materials: 200, urgent_safety: true,
    safety_risk: 'Water near a live wire can cause electric shock. I have switched off this circuit for now.' });
  assert.equal(r.status, 200);
  assert.equal(r.data.addon.status, 'pending', 'never auto-approved');
  assert.equal(t.db.prepare("SELECT kind FROM notifications WHERE extra_id = ?").get(r.data.addon.id).kind, 'addon_urgent');
  assert.equal(t.db.prepare('SELECT 1 FROM bookings WHERE id = ?').get(b.id) !== undefined, true);
  t.close();
});

test('ask for clarification: customer asks, worker answers, both notified, still pending', async () => {
  const { t, cust, wrk, pending } = await demo();
  await t.call(cust, `/api/addons/${pending.id}/messages`, { body: 'Can you show me the crack?' });
  const r = await t.call(wrk, `/api/addons/${pending.id}/messages`, { body: 'Yes, photo attached on the request.' });
  assert.equal(r.data.addon.messages.length, 2);
  assert.equal(r.data.addon.status, 'pending');
  const wUser = t.db.prepare('SELECT id FROM users WHERE phone = ?').get(PHONES.usman).id;
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND kind = 'addon_message'").get(wUser).n, 1);
  t.close();
});

test('disputing an add-on freezes escrow; admin refund is applied to that add-on', async () => {
  const { t, cust, pending, get } = await demo();
  const ap = await t.call(cust, `/api/addons/${pending.id}/approve`, { provider: 'jazzcash' });
  await t.simulate(ap.data.payment.txn_ref, 'pay');
  const d = await t.call(cust, `/api/addons/${pending.id}/dispute`, { reason: 'Pipe was not replaced, only taped' });
  assert.equal(d.data.addon.status, 'disputed');
  let bk = await get();
  assert.equal(bk.escrow.state, 'disputed');
  assert.equal(bk.price.approved_total, 2000);
  const admin = await t.login(PHONES.admin);
  const dispute = (await t.call(admin, '/api/admin/overview')).data.disputes[0];
  assert.equal(dispute.addon_work, pending.work);
  await t.call(admin, `/api/admin/disputes/${dispute.id}/resolve`, { refund_amount: 1000, resolution: 'Add-on refunded' });
  bk = await get();
  const x = bk.extras[0];
  assert.equal(x.pay_status, 'refunded');
  assert.equal(x.refunded_amount, 1000);
  assert.equal(bk.price.original.pay_status, 'paid');
  assert.equal(bk.price.refunded, 1000);
  t.close();
});

test('cancelling the booking refunds paid add-ons too', async () => {
  const { t, cust, wrk } = await demo();
  const ali = await t.login(PHONES.ali);
  const nb = await t.call(cust, '/api/bookings', { worker_id: 1, problem: 'Fan', date: 'x', slot: '2:00', address: 'a', provider: 'jazzcash' });
  await t.simulate(nb.data.payment.txn_ref, 'pay');
  await t.call(ali, `/api/bookings/${nb.data.booking.id}/status`, { status: 'confirmed' });
  const a = await t.call(ali, `/api/bookings/${nb.data.booking.id}/addons`, { problem: 'Regulator broken', work: 'Replace fan regulator', labour: 200, materials: 400 });
  const ap = await t.call(cust, `/api/addons/${a.data.addon.id}/approve`, { provider: 'jazzcash' });
  await t.simulate(ap.data.payment.txn_ref, 'pay');
  const c = await t.call(cust, `/api/bookings/${nb.data.booking.id}/cancel`, {});
  assert.equal(c.data.booking.escrow.refunded, 1400);
  assert.equal(c.data.booking.extras[0].pay_status, 'refunded');
  assert.equal(c.data.booking.price.original.pay_status, 'refunded');
  void wrk;
  t.close();
});

test('money paid for an add-on that was withdrawn meanwhile goes straight back', async () => {
  const { t, cust, wrk, pending, get } = await demo();
  const ap = await t.call(cust, `/api/addons/${pending.id}/approve`, { provider: 'jazzcash' });
  assert.equal((await t.call(wrk, `/api/addons/${pending.id}/cancel`, {})).status, 400, 'blocked while the customer is paying');
  t.db.prepare("UPDATE payments SET created_at = '2000-01-01' WHERE txn_ref = ?").run(ap.data.payment.txn_ref);
  assert.equal((await t.call(wrk, `/api/addons/${pending.id}/cancel`, {})).status, 200);
  await t.simulate(ap.data.payment.txn_ref, 'pay');
  const bk = await get();
  assert.equal(bk.price.approved_total, 1000);
  assert.equal(bk.escrow.available, 1000);
  assert.ok(bk.ledger.some((l) => l.type === 'refund' && l.amount === 1000));
  t.close();
});

test('at most 5 add-ons per booking', async () => {
  const { t, wrk, addon } = await demo();
  for (let i = 0; i < 4; i++) assert.equal((await addon(wrk, { problem: `Problem number ${i}`, work: `Extra job number ${i}`, labour: 100 })).status, 200);
  assert.equal((await addon(wrk, { problem: 'One too many', work: 'Sixth request', labour: 100 })).status, 400);
  t.close();
});

test('photos: workers upload, attach their own files only, customer can view', async () => {
  const { t, cust, wrk, addon } = await demo();
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  assert.equal((await t.upload(cust, png, 'image/png')).status, 403, 'customers do not upload add-on evidence');
  assert.equal((await t.upload(wrk, png, 'text/html')).status, 400);
  const up = await t.upload(wrk, png, 'image/png');
  assert.equal(up.status, 200);
  const ali = await t.login(PHONES.ali);
  const stolen = await t.call(ali, `/api/bookings/${t.db.prepare("SELECT id FROM bookings WHERE code='KW-1024'").get().id}/addons`, { problem: 'x'.repeat(10), work: 'y'.repeat(10), labour: 1, media_ids: [up.data.id] });
  assert.equal(stolen.status, 403, 'another worker cannot touch this booking at all');
  const r = await addon(wrk, { problem: 'Cracked pipe, see photo', work: 'Replace cracked pipe', labour: 500, media_ids: [up.data.id] });
  assert.equal(r.data.addon.media.length, 1);
  const reuse = await addon(wrk, { problem: 'Reusing an old photo', work: 'Some other work here', labour: 500, media_ids: [up.data.id] });
  assert.equal(reuse.status, 400, 'a photo can only back one request');
  const img = await fetch(t.base + r.data.addon.media[0].url);
  assert.equal(img.headers.get('content-type'), 'image/png');
  void cust;
  t.close();
});

test('admins see repeated misuse', async () => {
  const { t, cust, wrk, addon, pending } = await demo();
  await t.call(cust, `/api/addons/${pending.id}/reject`, {});
  for (let i = 0; i < 2; i++) {
    const a = await addon(wrk, { problem: `Extra issue ${i} found`, work: `Unneeded work ${i}`, labour: 100 });
    await t.call(cust, `/api/addons/${a.data.addon.id}/reject`, {});
  }
  const admin = await t.login(PHONES.admin);
  const w = (await t.call(admin, '/api/admin/addons')).data.workers.find((x) => x.name === 'Usman Khalid');
  assert.equal(w.rejected, 3);
  assert.equal(w.flagged, true);
  assert.equal((await t.call(cust, '/api/admin/addons')).status, 403);
  t.close();
});

test('databases from before add-ons are upgraded in place', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kw-mig-')), 'old.db');
  let db = open(file);
  const b = db.prepare("SELECT id FROM bookings WHERE code = 'KW-1024'").get().id;
  db.exec('PRAGMA foreign_keys = OFF; DROP TABLE extras; ALTER TABLE disputes DROP COLUMN extra_id;');
  db.exec(`CREATE TABLE extras (id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id), description TEXT NOT NULL,
    amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), created_at TEXT NOT NULL)`);
  db.prepare("INSERT INTO extras (booking_id, description, amount, status, created_at) VALUES (?, 'Old extra', 500, 'approved', '2026-10-01')").run(b);
  db.close();
  db = open(file);
  const x = db.prepare("SELECT * FROM extras WHERE work = 'Old extra'").get();
  assert.equal(x.labour, 500);
  assert.equal(x.amount, 500);
  assert.ok(db.prepare('PRAGMA table_info(disputes)').all().some((c) => c.name === 'extra_id'));
  db.close();
});
