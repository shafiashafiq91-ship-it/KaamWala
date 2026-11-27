'use strict';
// JazzCash Hosted Checkout (Page Redirection, API v1.1).
// The browser posts a signed form to JazzCash; JazzCash posts the result back to pp_ReturnURL.
// Docs: JazzCash Online Payment Gateway Integration Guide, "Page Redirection" + "Secure Hash".
const crypto = require('node:crypto');

const URLS = {
  sandbox: 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
  live: 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
};

function config(env = process.env) {
  return {
    merchantId: env.JAZZCASH_MERCHANT_ID,
    password: env.JAZZCASH_PASSWORD,
    salt: env.JAZZCASH_INTEGRITY_SALT,
    mode: env.JAZZCASH_MODE === 'live' ? 'live' : 'sandbox',
  };
}

const configured = (env) => { const c = config(env); return !!(c.merchantId && c.password && c.salt); };

// pp_SecureHash = HMAC-SHA256(salt, salt & v1 & v2 ...) over every non-empty pp_* field
// (except pp_SecureHash itself) in ascending key order, upper-case hex.
function secureHash(fields, salt) {
  const values = Object.keys(fields)
    .filter((k) => k.toLowerCase().startsWith('pp') && k !== 'pp_SecureHash' && fields[k] !== '' && fields[k] != null)
    .sort()
    .map((k) => fields[k]);
  return crypto.createHmac('sha256', salt).update([salt, ...values].join('&')).digest('hex').toUpperCase();
}

const stamp = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14); // yyyyMMddHHmmss (UTC here; JazzCash accepts PKT too)

function pktStamp(d) {
  return stamp(new Date(d.getTime() + 5 * 3600 * 1000)); // Pakistan is UTC+5, no DST
}

// Returns { action, fields } for an auto-submitting form.
function buildCheckout({ txnRef, amount, description, billRef, returnUrl }, env) {
  const c = config(env);
  const now = new Date();
  const fields = {
    pp_Version: '1.1',
    pp_TxnType: '', // empty lets the customer choose wallet or card on the JazzCash page
    pp_Language: 'EN',
    pp_MerchantID: c.merchantId,
    pp_SubMerchantID: '',
    pp_Password: c.password,
    pp_BankID: 'TBANK',
    pp_ProductID: 'RETL',
    pp_TxnRefNo: txnRef,
    pp_Amount: String(Math.round(amount * 100)), // paisa
    pp_TxnCurrency: 'PKR',
    pp_TxnDateTime: pktStamp(now),
    pp_BillReference: billRef,
    pp_Description: description.slice(0, 100),
    pp_TxnExpiryDateTime: pktStamp(new Date(now.getTime() + 24 * 3600 * 1000)),
    pp_ReturnURL: returnUrl,
    ppmpf_1: '', ppmpf_2: '', ppmpf_3: '', ppmpf_4: '', ppmpf_5: '',
  };
  fields.pp_SecureHash = secureHash(fields, c.salt);
  return { action: URLS[c.mode], fields };
}

// Validates the POST JazzCash sends to pp_ReturnURL.
// Returns { txnRef, ok, providerRef, message } or throws if the hash does not match.
function verifyCallback(body, env) {
  const c = config(env);
  const expected = secureHash(body, c.salt);
  const got = String(body.pp_SecureHash || '').toUpperCase();
  if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got))) {
    throw new Error('JazzCash secure hash mismatch');
  }
  return {
    txnRef: body.pp_TxnRefNo,
    ok: body.pp_ResponseCode === '000',
    amount: Number(body.pp_Amount) / 100,
    providerRef: body.pp_RetreivalReferenceNo || body.pp_TxnRefNo,
    message: body.pp_ResponseMessage,
  };
}

module.exports = { configured, buildCheckout, verifyCallback, secureHash };
