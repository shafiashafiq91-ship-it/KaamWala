'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createApp } = require('../src/server');
const jazzcash = require('../src/payments/jazzcash');
const easypaisa = require('../src/payments/easypaisa');
const escrow = require('../src/escrow');

async function start(env = {}) {
  const app = createApp({ dbFile: ':memory:', env: { BASE_URL: 'http://test', ...env } });
  const server = http.createServer(app.handle);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (token, path, body, method) => {
    const res = await fetch(base + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, location: res.headers.get('location') };
  };
  const login = async (phone) => (await call(null, '/api/login', { phone, otp: '1234' })).data.token;
  const simulate = (ref, result) => fetch(`${base}/pay/simulate/${ref}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `result=${result}`, redirect: 'manual' });
  return { app, server, call, login, simulate, close: () => server.close() };
}

async function book(t, customer, workerId = 1) {
  const r = await t.call(customer, '/api/bookings', { worker_id: workerId, problem: 'Fan not working', date: 'Sat 24 Oct', slot: '2:00', address: 'House 12, Block G', provider: 'jazzcash' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

test('seeded workers match the demo profile', async () => {
  const t = await start();
  const { data } = await t.call(null, '/api/workers?category=electrician');
  const ali = data.workers.find((w) => w.name === 'Ali Raza');
  assert.equal(ali.rating, 4.8);
  assert.equal(ali.review_count, 36);
  assert.equal(ali.visit_fee, 800);
  assert.equal(data.workers.length, 3);
  t.close();
});

test('full escrow flow: pay, work, extra, confirm, release with commission', async () => {
  const t = await start();
  const cust = await t.login('03001234567');
  const wrk = await t.login('03011111111');
  const { booking, payment } = await book(t, cust);
  assert.equal(booking.code, 'KW-1026'); // KW-1024/1025 are demo bookings
  assert.equal(booking.escrow.state, 'awaiting_payment');

  // worker cannot accept before money is in escrow
  assert.equal((await t.call(wrk, `/api/bookings/${booking.id}/status`, { status: 'confirmed' })).status, 400);

  const pay = await t.simulate(payment.txn_ref, 'pay');
  assert.equal(pay.status, 303);
  let b = (await t.call(cust, `/api/bookings/${booking.id}`)).data.booking;
  assert.equal(b.escrow.state, 'held');
  assert.equal(b.escrow.held, 800);

  for (const s of ['confirmed', 'on_the_way', 'in_progress']) assert.equal((await t.call(wrk, `/api/bookings/${booking.id}/status`, { status: s, eta_min: 15 })).status, 200);

  // extra work must be approved (paid) before completion
  const add = await t.call(wrk, `/api/bookings/${booking.id}/addons`, { problem: 'Switch is burnt', work: 'Replace switch', labour: 300, materials: 200 });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  assert.equal((await t.call(wrk, `/api/bookings/${booking.id}/status`, { status: 'completed' })).status, 400);
  const xp = (await t.call(cust, `/api/addons/${add.data.addon.id}/approve`, { provider: 'easypaisa' })).data.payment;
  await t.simulate(xp.txn_ref, 'pay');
  assert.equal((await t.call(wrk, `/api/bookings/${booking.id}/status`, { status: 'completed' })).status, 200);

  // customer cannot release twice; worker cannot release at all
  assert.equal((await t.call(wrk, `/api/bookings/${booking.id}/release`, {})).status, 403);
  assert.equal((await t.call(cust, `/api/bookings/${booking.id}/release`, {})).status, 200);
  assert.equal((await t.call(cust, `/api/bookings/${booking.id}/release`, {})).status, 400);

  b = (await t.call(cust, `/api/bookings/${booking.id}`)).data.booking;
  assert.equal(b.escrow.state, 'released');
  assert.equal(b.escrow.held, 1300);
  assert.equal(b.escrow.commission, 130);
  assert.equal(b.escrow.released, 1170);
  assert.equal(b.escrow.available, 0);
  assert.deepEqual(b.ledger.map((l) => l.type), ['hold', 'hold', 'commission', 'release']);

  // review only after completion
  assert.equal((await t.call(cust, `/api/bookings/${booking.id}/review`, { rating: 5, comment: 'Great' })).status, 200);
  t.close();
});

test('cancel before worker sets off refunds in full', async () => {
  const t = await start();
  const cust = await t.login('03001234567');
  const { booking, payment } = await book(t, cust);
  await t.simulate(payment.txn_ref, 'pay');
  const r = await t.call(cust, `/api/bookings/${booking.id}/cancel`, {});
  assert.equal(r.data.booking.escrow.state, 'refunded');
  assert.equal(r.data.booking.escrow.refunded, 800);
  assert.equal(r.data.booking.status, 'cancelled');
  t.close();
});

test('failed payment leaves escrow awaiting payment and can be retried', async () => {
  const t = await start();
  const cust = await t.login('03001234567');
  const { booking, payment } = await book(t, cust);
  const res = await t.simulate(payment.txn_ref, 'cancel');
  assert.match(res.headers.get('location'), /payment=failed/);
  const retry = await t.call(cust, `/api/bookings/${booking.id}/pay`, { provider: 'easypaisa' });
  assert.equal(retry.status, 200);
  await t.simulate(retry.data.payment.txn_ref, 'pay');
  const b = (await t.call(cust, `/api/bookings/${booking.id}`)).data.booking;
  assert.equal(b.escrow.state, 'held');
  t.close();
});

test('dispute freezes funds; admin split resolves it', async () => {
  const t = await start();
  const cust = await t.login('03001234567');
  const wrk = await t.login('03011111111');
  const admin = await t.login('03000000000');
  const { booking, payment } = await book(t, cust);
  await t.simulate(payment.txn_ref, 'pay');
  for (const s of ['confirmed', 'on_the_way', 'in_progress', 'completed']) await t.call(wrk, `/api/bookings/${booking.id}/status`, { status: s });
  assert.equal((await t.call(cust, `/api/bookings/${booking.id}/dispute`, { reason: 'Leak came back' })).status, 200);
  assert.equal((await t.call(cust, `/api/bookings/${booking.id}/release`, {})).status, 400);
  assert.equal(t.app.db.prepare("SELECT COUNT(*) n FROM escrows WHERE state='disputed'").get().n, 1);

  const ov = (await t.call(admin, '/api/admin/overview')).data;
  const d = ov.disputes[0];
  assert.equal(d.available, 800);
  // admin cannot refund more than is held
  assert.equal((await t.call(admin, `/api/admin/disputes/${d.id}/resolve`, { refund_amount: 900, resolution: 'x' })).status, 400);
  const r = await t.call(admin, `/api/admin/disputes/${d.id}/resolve`, { refund_amount: 300, resolution: 'Half refund' });
  assert.equal(r.data.escrow.state, 'split');
  assert.equal(r.data.escrow.refunded, 300);
  assert.equal(r.data.escrow.commission, 50);
  assert.equal(r.data.escrow.released, 450);
  t.close();
});

test('auto-release after the confirmation window', async () => {
  const t = await start();
  const cust = await t.login('03001234567');
  const wrk = await t.login('03011111111');
  const { booking, payment } = await book(t, cust);
  await t.simulate(payment.txn_ref, 'pay');
  for (const s of ['confirmed', 'on_the_way', 'in_progress', 'completed']) await t.call(wrk, `/api/bookings/${booking.id}/status`, { status: s });
  escrow.autoRelease(t.app.db);
  assert.equal(escrow.get(t.app.db, booking.id).state, 'held', 'not before the window ends');
  assert.ok(escrow.autoRelease(t.app.db, new Date(Date.now() + 73 * 3600e3).toISOString()) >= 1);
  assert.equal(escrow.get(t.app.db, booking.id).state, 'released');
  t.close();
});

test('other customers cannot see a booking', async () => {
  const t = await start();
  const cust = await t.login('03001234567');
  const other = await t.login('03219999999');
  const { booking } = await book(t, cust);
  assert.equal((await t.call(other, `/api/bookings/${booking.id}`)).status, 403);
  t.close();
});

test('JazzCash: checkout is signed and a forged callback is rejected', async () => {
  const env = { JAZZCASH_MERCHANT_ID: 'MC123', JAZZCASH_PASSWORD: 'pw', JAZZCASH_INTEGRITY_SALT: 'salt123' };
  const t = await start(env);
  const cust = await t.login('03001234567');
  const { booking, payment } = await book(t, cust);
  const page = await t.call(cust, payment.pay_url);
  assert.match(page.data, /sandbox\.jazzcash\.com\.pk/);
  assert.match(page.data, /pp_SecureHash/);

  // simulator is locked once real credentials exist
  assert.equal((await t.simulate(payment.txn_ref, 'pay')).status, 403);

  const cb = { pp_TxnRefNo: payment.txn_ref, pp_ResponseCode: '000', pp_Amount: '80000', pp_ResponseMessage: 'Thank you', pp_RetreivalReferenceNo: 'R1' };
  const post = (fields) => fetch(`http://127.0.0.1:${t.server.address().port}/pay/jazzcash/return`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(), redirect: 'manual' });
  assert.equal((await post({ ...cb, pp_SecureHash: 'DEADBEEF' })).status, 400);
  assert.equal(escrow.get(t.app.db, booking.id).state, 'awaiting_payment');
  const ok = await post({ ...cb, pp_SecureHash: jazzcash.secureHash(cb, 'salt123') });
  assert.equal(ok.status, 303);
  assert.equal(escrow.get(t.app.db, booking.id).state, 'held');
  t.close();
});

test('JazzCash secure hash follows the documented recipe', () => {
  const fields = { pp_Amount: '100', pp_TxnRefNo: 'T1', pp_Empty: '', other: 'x' };
  const expected = crypto.createHmac('sha256', 's').update('s&100&T1').digest('hex').toUpperCase();
  assert.equal(jazzcash.secureHash(fields, 's'), expected);
});

test('EasyPaisa merchantHashedReq decrypts to the sorted parameter string', () => {
  const key = '0123456789ABCDEF';
  const enc = easypaisa.hashRequest({ storeId: '1', amount: '10.0', orderRefNum: 'T1' }, key);
  const d = crypto.createDecipheriv('aes-128-ecb', Buffer.from(key), null);
  const plain = Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString();
  assert.equal(plain, 'amount=10.0&orderRefNum=T1&storeId=1');
});
