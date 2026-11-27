'use strict';
// Escrow rules. Money the customer pays (visit fee, then any approved extra work) is held per
// booking and only leaves escrow when:
//   - the customer confirms the job is done           -> released to the worker, minus commission
//   - nobody acts for AUTO_RELEASE_HOURS after completion and there is no dispute -> same
//   - the booking is cancelled before the worker sets off -> refunded to the customer
//   - an admin resolves a dispute                      -> refunded, released, or split
// Every movement is written to the ledger. Outgoing transfers (worker payouts, refunds) are
// recorded with payout_status 'pending' until an admin marks them sent.

const addons = require('./addons');

const COMMISSION_RATE = Number(process.env.COMMISSION_RATE || 0.10);
const AUTO_RELEASE_HOURS = Number(process.env.AUTO_RELEASE_HOURS || 72);

const now = () => new Date().toISOString();

class EscrowError extends Error {}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const get = (db, bookingId) => db.prepare('SELECT * FROM escrows WHERE booking_id = ?').get(bookingId);

function open(db, bookingId) {
  db.prepare('INSERT INTO escrows (booking_id, updated_at) VALUES (?, ?)').run(bookingId, now());
}

function ledger(db, bookingId, type, amount, provider, note, payoutStatus = null) {
  db.prepare('INSERT INTO ledger (booking_id,type,amount,provider,note,payout_status,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(bookingId, type, amount, provider, note, payoutStatus, now());
}

// Called once a provider confirms a payment. Idempotent per payment.
function recordPayment(db, paymentId, providerRef, raw) {
  return tx(db, () => {
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!p) throw new EscrowError('Payment not found');
    if (p.status === 'paid') return p;
    const e = get(db, p.booking_id);
    if (['released', 'refunded', 'split'].includes(e.state)) {
      // Escrow already closed (e.g. booking cancelled while the customer was paying): refund straight away.
      db.prepare("UPDATE payments SET status='paid', provider_ref=?, raw=?, updated_at=? WHERE id=?").run(providerRef, raw, now(), p.id);
      ledger(db, p.booking_id, 'refund', p.amount, p.provider, 'Paid after escrow closed', 'pending');
      db.prepare('UPDATE escrows SET refunded = refunded + ?, updated_at=? WHERE booking_id=?').run(p.amount, now(), p.booking_id);
      return p;
    }
    db.prepare("UPDATE payments SET status='paid', provider_ref=?, raw=?, updated_at=? WHERE id=?").run(providerRef, raw, now(), p.id);
    if (p.extra_id) {
      const x = db.prepare('SELECT status, pay_status FROM extras WHERE id = ?').get(p.extra_id);
      if (x.status !== 'approved' || x.pay_status !== 'unpaid') {
        // Withdrawn or already paid while the customer was at the wallet: give the money straight back.
        db.prepare(`UPDATE escrows SET held = held + ?, refunded = refunded + ?, updated_at=? WHERE booking_id=?`).run(p.amount, p.amount, now(), p.booking_id);
        ledger(db, p.booking_id, 'hold', p.amount, p.provider, 'Add-on payment');
        ledger(db, p.booking_id, 'refund', p.amount, p.provider, 'Add-on no longer payable', 'pending');
        return p;
      }
    }
    db.prepare(`UPDATE escrows SET held = held + ?, state = CASE WHEN state='awaiting_payment' THEN 'held' ELSE state END,
      updated_at=? WHERE booking_id=?`).run(p.amount, now(), p.booking_id);
    ledger(db, p.booking_id, 'hold', p.amount, p.provider, p.extra_id ? 'Approved add-on' : 'Visit / inspection fee');
    if (p.extra_id) addons.onPaid(db, p.extra_id, p.amount);
    return p;
  });
}

function failPayment(db, paymentId, raw) {
  db.prepare("UPDATE payments SET status='failed', raw=?, updated_at=? WHERE id=? AND status='initiated'").run(raw, now(), paymentId);
}

function provider(db, bookingId) {
  const p = db.prepare("SELECT provider FROM payments WHERE booking_id=? AND status='paid' ORDER BY id LIMIT 1").get(bookingId);
  return p ? p.provider : null;
}

// Pay `releaseAmount` to the worker (less commission) and refund `refundAmount` to the customer.
function settle(db, bookingId, refundAmount, note, extraId = null) {
  const e = get(db, bookingId);
  const available = e.held - e.released - e.refunded - e.commission;
  if (refundAmount < 0 || refundAmount > available) throw new EscrowError('Refund amount out of range');
  const releaseGross = available - refundAmount;
  const commission = Math.round(releaseGross * COMMISSION_RATE);
  const prov = provider(db, bookingId);
  if (refundAmount > 0) {
    ledger(db, bookingId, 'refund', refundAmount, prov, note, 'pending');
    addons.onRefund(db, bookingId, extraId, refundAmount);
  }
  if (releaseGross > 0) {
    ledger(db, bookingId, 'commission', commission, prov, `${Math.round(COMMISSION_RATE * 100)}% platform commission`);
    ledger(db, bookingId, 'release', releaseGross - commission, prov, note, 'pending');
  }
  const state = releaseGross === 0 ? 'refunded' : refundAmount === 0 ? 'released' : 'split';
  db.prepare(`UPDATE escrows SET state=?, released = released + ?, refunded = refunded + ?, commission = commission + ?,
    auto_release_at = NULL, updated_at=? WHERE booking_id=?`)
    .run(state, releaseGross - commission, refundAmount, commission, now(), bookingId);
  return get(db, bookingId);
}

function onCompleted(db, bookingId) {
  const at = new Date(Date.now() + AUTO_RELEASE_HOURS * 3600 * 1000).toISOString();
  db.prepare("UPDATE escrows SET auto_release_at=?, updated_at=? WHERE booking_id=? AND state='held'").run(at, now(), bookingId);
}

function confirmRelease(db, bookingId) {
  return tx(db, () => {
    const e = get(db, bookingId);
    const b = db.prepare('SELECT status FROM bookings WHERE id=?').get(bookingId);
    if (b.status !== 'completed') throw new EscrowError('The worker has not marked this job completed yet');
    if (e.state !== 'held') throw new EscrowError(`Escrow is ${e.state}, nothing to release`);
    return settle(db, bookingId, 0, 'Customer confirmed the job');
  });
}

function refundAll(db, bookingId, note) {
  return tx(db, () => {
    const e = get(db, bookingId);
    if (e.state === 'disputed') throw new EscrowError('Booking is under dispute');
    if (['released', 'refunded', 'split'].includes(e.state)) return e;
    return settle(db, bookingId, e.held - e.released - e.refunded - e.commission, note);
  });
}

function raiseDispute(db, bookingId, user, reason, extraId = null) {
  return tx(db, () => {
    const e = get(db, bookingId);
    if (e.state !== 'held') throw new EscrowError('Disputes can be raised only before the payment is released');
    if (extraId) {
      const x = db.prepare('SELECT * FROM extras WHERE id = ? AND booking_id = ?').get(extraId, bookingId);
      if (!x || x.status !== 'approved') throw new EscrowError('Only an approved add-on can be disputed');
      db.prepare("UPDATE extras SET status = 'disputed' WHERE id = ?").run(extraId);
      addons.logEvent(db, bookingId, extraId, user, 'addon_disputed', x.amount, reason);
    }
    db.prepare("UPDATE escrows SET state='disputed', auto_release_at=NULL, updated_at=? WHERE booking_id=?").run(now(), bookingId);
    return db.prepare('INSERT INTO disputes (booking_id,raised_by,reason,extra_id,created_at) VALUES (?,?,?,?,?)').run(bookingId, user.id, reason, extraId, now()).lastInsertRowid;
  });
}

function resolveDispute(db, disputeId, refundAmount, resolution) {
  return tx(db, () => {
    const d = db.prepare('SELECT * FROM disputes WHERE id=?').get(disputeId);
    if (!d || d.status !== 'open') throw new EscrowError('Dispute not open');
    const e = settle(db, d.booking_id, refundAmount, `Dispute resolved: ${resolution}`, d.extra_id);
    db.prepare("UPDATE disputes SET status='resolved', resolution=?, refund_amount=?, resolved_at=? WHERE id=?").run(resolution, refundAmount, now(), disputeId);
    return e;
  });
}

// Run periodically: release escrow for completed jobs whose confirmation window has passed.
function autoRelease(db, at = now()) {
  const due = db.prepare("SELECT booking_id FROM escrows WHERE state='held' AND auto_release_at IS NOT NULL AND auto_release_at <= ?").all(at);
  for (const { booking_id } of due) tx(db, () => settle(db, booking_id, 0, `Auto-released ${AUTO_RELEASE_HOURS}h after completion`));
  return due.length;
}

function available(e) { return e.held - e.released - e.refunded - e.commission; }

module.exports = {
  tx, EscrowError, COMMISSION_RATE, AUTO_RELEASE_HOURS, open, get, available, recordPayment, failPayment,
  onCompleted, confirmRelease, refundAll, raiseDispute, resolveDispute, autoRelease,
};
