'use strict';
// Easypaisa Hosted Checkout ("Easypay" plug-in, page redirection).
// Step 1: browser posts storeId/amount/... + merchantHashedReq to Index.jsf.
// Step 2: Easypaisa redirects back to postBackURL with auth_token; we post it to Confirm.jsf.
// Step 3: Easypaisa redirects to postBackURL with status + orderRefNumber; we confirm with the
//         Inquire Transaction API before trusting it (the redirect itself is not signed).
const crypto = require('node:crypto');

const HOSTS = {
  sandbox: 'https://easypaystg.easypaisa.com.pk',
  live: 'https://easypay.easypaisa.com.pk',
};

function config(env = process.env) {
  return {
    storeId: env.EASYPAISA_STORE_ID,
    hashKey: env.EASYPAISA_HASH_KEY, // 16-char key from the Easypaisa merchant portal
    username: env.EASYPAISA_API_USERNAME,
    password: env.EASYPAISA_API_PASSWORD,
    accountNum: env.EASYPAISA_ACCOUNT_NUM,
    mode: env.EASYPAISA_MODE === 'live' ? 'live' : 'sandbox',
  };
}

const configured = (env) => { const c = config(env); return !!(c.storeId && c.hashKey); };

// merchantHashedReq = base64(AES-128-ECB/PKCS5(hashKey, "k1=v1&k2=v2..." in ascending key order))
function hashRequest(params, hashKey) {
  const plain = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(hashKey, 'utf8'), null);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

function expiry(d) {
  const p = new Date(d.getTime() + 5 * 3600 * 1000 + 24 * 3600 * 1000); // PKT, +1 day
  const iso = p.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')} ${iso.slice(11, 19)}`; // yyyyMMdd HHmmss
}

function buildCheckout({ txnRef, amount, returnUrl, mobile, email }, env) {
  const c = config(env);
  const params = {
    amount: Number(amount).toFixed(1),
    autoRedirect: '1',
    emailAddr: email || '',
    expiryDate: expiry(new Date()),
    mobileNum: mobile || '',
    orderRefNum: txnRef,
    paymentMethod: 'MA_PAYMENT_METHOD', // mobile account (wallet)
    postBackURL: returnUrl,
    storeId: c.storeId,
  };
  return { action: `${HOSTS[c.mode]}/easypay/Index.jsf`, fields: { ...params, merchantHashedReq: hashRequest(params, c.hashKey) } };
}

// Step 2 form: the auth_token Easypaisa hands back after step 1.
function buildConfirm(authToken, returnUrl, env) {
  const c = config(env);
  return { action: `${HOSTS[c.mode]}/easypay/Confirm.jsf`, fields: { auth_token: authToken, postBackURL: returnUrl } };
}

// Server-to-server status check. Returns { ok, providerRef, amount, message }.
async function inquire(txnRef, env) {
  const c = config(env);
  const res = await fetch(`${HOSTS[c.mode]}/easypay-service/rest/v4/inquire-transaction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Credentials: Buffer.from(`${c.username}:${c.password}`).toString('base64'),
    },
    body: JSON.stringify({ orderId: txnRef, storeId: c.storeId, accountNum: c.accountNum }),
  });
  const data = await res.json();
  return {
    ok: data.responseCode === '0000' && ['PAID', 'SUCCESS'].includes(String(data.transactionStatus).toUpperCase()),
    providerRef: data.transactionId,
    amount: Number(data.transactionAmount),
    message: data.responseDesc,
  };
}

module.exports = { configured, buildCheckout, buildConfirm, inquire, hashRequest };
