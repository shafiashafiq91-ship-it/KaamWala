'use strict';
// Add-on service requests: extra work a worker finds on site.
//
// Rules (enforced here, never trusted from the client):
//  - An add-on belongs to one booking and is requested by that booking's worker only.
//  - Its price is labour + materials, computed here. Once requested it can't be edited, only
//    withdrawn (while pending, or approved but unpaid) and requested again.
//  - Only the booking's customer can approve or reject it. A decision is final.
//  - Only approved (or disputed) add-ons count towards the approved total. Rejected and withdrawn
//    ones stay on record at Rs 0.
//  - Approving does not take money. Payment is a separate step through JazzCash / EasyPaisa and is
//    only marked paid when the provider confirms it (see escrow.recordPayment).
//  - Every request, decision, payment, refund and dispute is written to price_events with the
//    approved total after it.

const WARN_PERCENT = Number(process.env.ADDON_WARN_PERCENT || 100); // revised total vs original
const WARN_AMOUNT = Number(process.env.ADDON_WARN_AMOUNT || 5000); // add-ons in total, Rs
const MAX_AMOUNT = 500000;
const MAX_PER_BOOKING = 5;

class AddonError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const now = () => new Date().toISOString();

function approvedTotal(db, bookingId) {
  const b = db.prepare('SELECT visit_fee FROM bookings WHERE id = ?').get(bookingId);
  const x = db.prepare("SELECT COALESCE(SUM(amount),0) n FROM extras WHERE booking_id = ? AND status IN ('approved','disputed')").get(bookingId).n;
  return b.visit_fee + x;
}

function logEvent(db, bookingId, extraId, actor, event, amount, note) {
  db.prepare(`INSERT INTO price_events (booking_id,extra_id,actor_id,actor_role,event,amount,approved_total,note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(bookingId, extraId, actor?.id ?? null, actor?.role ?? 'system', event, amount ?? null, approvedTotal(db, bookingId), note ?? null, now());
}

function notify(db, userId, bookingId, extraId, kind, body) {
  db.prepare('INSERT INTO notifications (user_id,booking_id,extra_id,kind,body,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, bookingId, extraId, kind, body, now());
}
const workerUserId = (db, workerId) => db.prepare('SELECT user_id FROM workers WHERE id = ?').get(workerId).user_id;

// Would the booking's total cross the warning line if `extra` were approved?
function warning(db, bookingId, extraAmount) {
  const b = db.prepare('SELECT visit_fee FROM bookings WHERE id = ?').get(bookingId);
  const current = approvedTotal(db, bookingId);
  const revised = current + extraAmount;
  const addonsTotal = revised - b.visit_fee;
  const pct = Math.round((addonsTotal / b.visit_fee) * 100);
  const over = pct > WARN_PERCENT || addonsTotal > WARN_AMOUNT;
  return { over, original: b.visit_fee, current, revised, increase_percent: pct, warn_percent: WARN_PERCENT, warn_amount: WARN_AMOUNT };
}

const int = (v, name) => {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n !== Math.floor(n)) throw new AddonError(`${name} must be a whole number of rupees`);
  return n;
};

function request(db, tx, booking, user, input) {
  return tx(db, () => {
    const worker = db.prepare('SELECT id FROM workers WHERE user_id = ?').get(user.id);
    if (!worker || worker.id !== booking.worker_id) throw new AddonError('Only the worker on this booking can request an add-on', 403);
    if (!['confirmed', 'on_the_way', 'in_progress'].includes(booking.status)) throw new AddonError('Add-ons can only be requested during an active job');
    const e = db.prepare('SELECT state FROM escrows WHERE booking_id = ?').get(booking.id);
    if (e?.state === 'disputed') throw new AddonError('This booking is under dispute');

    const problem = String(input.problem || '').trim();
    const work = String(input.work || '').trim();
    if (problem.length < 5) throw new AddonError('Describe the additional problem you found');
    if (work.length < 5) throw new AddonError('Describe the extra work you propose');
    const labour = int(input.labour, 'Labour');
    const materials = int(input.materials, 'Materials');
    const amount = labour + materials; // never trust a total from the client
    if (amount <= 0) throw new AddonError('Enter the labour and/or material cost');
    if (amount > MAX_AMOUNT) throw new AddonError('Amount is too large; contact support for big jobs');
    const est = input.est_minutes ? int(input.est_minutes, 'Extra time') : null;
    const urgent = input.urgent_safety ? 1 : 0;
    const risk = String(input.safety_risk || '').trim();
    if (urgent && risk.length < 15) throw new AddonError('Explain the safety risk to the customer (what could happen if it is left)');

    const key = input.client_key ? String(input.client_key).slice(0, 64) : null;
    if (key) {
      const dup = db.prepare('SELECT id FROM extras WHERE booking_id = ? AND client_key = ?').get(booking.id, key);
      if (dup) return { id: dup.id, duplicate: true }; // retried submit: return the original, don't add another
    }
    const same = db.prepare("SELECT id FROM extras WHERE booking_id = ? AND status = 'pending' AND lower(work) = lower(?)").get(booking.id, work);
    if (same) throw new AddonError('You already have a pending request for this work. Wait for the customer or withdraw it first.', 409);
    const count = db.prepare("SELECT COUNT(*) n FROM extras WHERE booking_id = ? AND status NOT IN ('cancelled')").get(booking.id).n;
    if (count >= MAX_PER_BOOKING) throw new AddonError(`A booking can have at most ${MAX_PER_BOOKING} add-on requests; contact support`);

    const w = warning(db, booking.id, amount);
    const id = db.prepare(`INSERT INTO extras (booking_id,worker_id,problem,work,labour,materials,amount,est_minutes,urgent_safety,safety_risk,over_threshold,client_key,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(booking.id, worker.id, problem, work, labour, materials, amount, est, urgent, urgent ? risk : null, w.over ? 1 : 0, key, now()).lastInsertRowid;
    logEvent(db, booking.id, id, user, 'addon_requested', amount, work);
    notify(db, booking.customer_id, booking.id, id, urgent ? 'addon_urgent' : 'addon_requested',
      `${urgent ? 'Safety issue: ' : ''}Add-on requested on ${booking.code}: ${work} (Rs ${amount}). Nothing is charged unless you approve.`);
    return { id, duplicate: false };
  });
}

function load(db, extraId) {
  const x = db.prepare('SELECT * FROM extras WHERE id = ?').get(extraId);
  if (!x) throw new AddonError('Add-on not found', 404);
  return { x, b: db.prepare('SELECT * FROM bookings WHERE id = ?').get(x.booking_id) };
}

function decide(db, tx, extraId, user, decision, reason) {
  return tx(db, () => {
    const { x, b } = load(db, extraId);
    if (user.role !== 'customer' || b.customer_id !== user.id) throw new AddonError('Only the customer on this booking can decide', 403);
    if (x.status !== 'pending') throw new AddonError(`This add-on was already ${x.status}`, 409); // stops double approvals
    if (b.status === 'cancelled') throw new AddonError('Booking is cancelled');
    if (!['approve', 'reject'].includes(decision)) throw new AddonError('Unknown decision');
    const status = decision === 'approve' ? 'approved' : 'rejected';
    const r = db.prepare("UPDATE extras SET status = ?, reject_reason = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
      .run(status, decision === 'reject' ? String(reason || '').slice(0, 500) || null : null, user.id, now(), x.id);
    if (r.changes !== 1) throw new AddonError('This add-on was already decided', 409);
    logEvent(db, b.id, x.id, user, `addon_${status}`, x.amount, decision === 'reject' ? reason : null);
    notify(db, workerUserId(db, x.worker_id), b.id, x.id, `addon_${status}`,
      status === 'approved'
        ? `Customer approved the add-on on ${b.code}: ${x.work} (Rs ${x.amount}). Wait for the customer's payment before starting it.`
        : `Customer declined the add-on on ${b.code}: ${x.work}. Continue only with the original job if it is safe to do so.`);
    return status;
  });
}

function cancel(db, tx, extraId, user) {
  return tx(db, () => {
    const { x, b } = load(db, extraId);
    const worker = db.prepare('SELECT id FROM workers WHERE user_id = ?').get(user.id);
    if (!worker || worker.id !== x.worker_id) throw new AddonError('Only the worker who requested it can withdraw it', 403);
    const unpaidApproved = x.status === 'approved' && x.pay_status === 'unpaid';
    if (x.status !== 'pending' && !unpaidApproved) throw new AddonError('Paid or decided add-ons cannot be withdrawn');
    if (db.prepare("SELECT 1 FROM payments WHERE extra_id = ? AND status = 'initiated' AND created_at > ?").get(x.id, new Date(Date.now() - 30 * 60e3).toISOString()))
      throw new AddonError('The customer is paying for this right now; try again shortly');
    db.prepare("UPDATE extras SET status = 'cancelled', decided_at = ? WHERE id = ?").run(now(), x.id);
    logEvent(db, b.id, x.id, user, 'addon_cancelled', x.amount);
    notify(db, b.customer_id, b.id, x.id, 'addon_cancelled', `The worker withdrew the add-on on ${b.code}: ${x.work}. You won't be charged for it.`);
  });
}

function ask(db, extraId, user, body) {
  const { x, b } = load(db, extraId);
  const worker = db.prepare('SELECT id FROM workers WHERE user_id = ?').get(user.id);
  const isCustomer = user.role === 'customer' && b.customer_id === user.id;
  const isWorker = worker && worker.id === x.worker_id;
  if (!isCustomer && !isWorker) throw new AddonError('Not your booking', 403);
  const text = String(body || '').trim();
  if (!text) throw new AddonError('Write your question');
  db.prepare('INSERT INTO addon_messages (extra_id,sender_id,body,created_at) VALUES (?,?,?,?)').run(x.id, user.id, text.slice(0, 1000), now());
  logEvent(db, b.id, x.id, user, isCustomer ? 'clarification_asked' : 'clarification_answered', null, text.slice(0, 200));
  notify(db, isCustomer ? workerUserId(db, x.worker_id) : b.customer_id, b.id, x.id, 'addon_message',
    `${isCustomer ? 'Customer question' : 'Worker reply'} on ${b.code} add-on: ${text.slice(0, 120)}`);
}

// Payment for an add-on confirmed by the provider (called inside escrow's transaction).
function onPaid(db, extraId, amount) {
  const x = db.prepare('SELECT * FROM extras WHERE id = ?').get(extraId);
  db.prepare("UPDATE extras SET pay_status = 'paid' WHERE id = ?").run(extraId);
  logEvent(db, x.booking_id, extraId, null, 'addon_paid', amount, 'Confirmed by payment provider');
  notify(db, workerUserId(db, x.worker_id), x.booking_id, extraId, 'addon_paid', `Payment for add-on "${x.work}" has been paid. You can start it.`);
}

// Spread a refund over the booking's add-ons (dispute about one add-on, or full refund).
function onRefund(db, bookingId, extraId, refund) {
  const rows = extraId
    ? db.prepare("SELECT * FROM extras WHERE id = ? AND pay_status IN ('paid','partly_refunded')").all(extraId)
    : db.prepare("SELECT * FROM extras WHERE booking_id = ? AND pay_status IN ('paid','partly_refunded') ORDER BY id DESC").all(bookingId);
  let left = refund;
  for (const x of rows) {
    if (left <= 0) break;
    const take = Math.min(left, x.amount - x.refunded_amount);
    if (take <= 0) continue;
    const total = x.refunded_amount + take;
    db.prepare('UPDATE extras SET refunded_amount = ?, pay_status = ? WHERE id = ?').run(total, total >= x.amount ? 'refunded' : 'partly_refunded', x.id);
    logEvent(db, bookingId, x.id, null, 'addon_refunded', take);
    left -= take;
  }
  return refund - left;
}

// What the customer and admin see: original + add-ons, with paid / unpaid / refunded per line.
function breakdown(db, bookingId) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  const e = db.prepare('SELECT * FROM escrows WHERE booking_id = ?').get(bookingId);
  const extras = db.prepare('SELECT * FROM extras WHERE booking_id = ? ORDER BY id').all(bookingId);
  const visitPaid = !!db.prepare("SELECT 1 FROM payments WHERE booking_id = ? AND extra_id IS NULL AND status = 'paid'").get(bookingId);
  const addonRefunds = extras.reduce((s, x) => s + x.refunded_amount, 0);
  const visitRefunded = Math.max(0, Math.min(b.visit_fee, (e?.refunded || 0) - addonRefunds));
  const visitStatus = !visitPaid ? 'unpaid' : visitRefunded >= b.visit_fee ? 'refunded' : visitRefunded > 0 ? 'partly_refunded' : 'paid';
  const counted = extras.filter((x) => ['approved', 'disputed'].includes(x.status));
  const total = b.visit_fee + counted.reduce((s, x) => s + x.amount, 0);
  const paid = (visitPaid ? b.visit_fee : 0) + counted.filter((x) => x.pay_status !== 'unpaid').reduce((s, x) => s + x.amount, 0);
  const refunded = e?.refunded || 0;
  return {
    original: { label: 'Original service (visit / inspection)', amount: b.visit_fee, pay_status: visitStatus, refunded: visitRefunded },
    addons: extras.map((x) => ({ ...x, client_key: undefined })),
    approved_total: total,
    labour_total: counted.reduce((s, x) => s + x.labour, 0),
    materials_total: counted.reduce((s, x) => s + x.materials, 0),
    paid,
    refunded,
    unpaid: total - paid,
    net_paid: paid - refunded,
  };
}

module.exports = { AddonError, WARN_PERCENT, WARN_AMOUNT, approvedTotal, warning, request, decide, cancel, ask, onPaid, onRefund, breakdown, logEvent, notify };
