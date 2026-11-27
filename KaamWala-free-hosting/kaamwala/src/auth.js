'use strict';
// Passwords, phone numbers, session tokens, one-time codes and login throttling.
const crypto = require('node:crypto');

const now = () => new Date().toISOString();

// scrypt with a per-user random salt. Stored as "scrypt$N$r$p$salt$hash" so the cost can be raised later.
const SCRYPT = { N: 16384, r: 8, p: 1 };
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, N, r, p, salt, hash] = stored.split('$');
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(want, got);
}
function checkPasswordRules(password) {
  const p = String(password || '');
  if (p.length < 8) return 'Use at least 8 characters for your password';
  if (p.length > 128) return 'Password is too long';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Use letters and numbers in your password';
  return null;
}

// Accepts 03001234567, 3001234567, 923001234567, +92 300 1234567. Stored as 03001234567.
function normalizePhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.startsWith('0092')) d = d.slice(4);
  if (d.startsWith('92') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('3')) d = '0' + d;
  return /^03\d{9}$/.test(d) ? d : null;
}
const displayPhone = (p) => (p && /^03\d{9}$/.test(p) ? `+92 ${p.slice(1, 4)} ${p.slice(4)}` : p);

// Session tokens: the client keeps the random token, the database only keeps its SHA-256.
const newToken = () => crypto.randomBytes(24).toString('hex');
const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const SESSION_DAYS = 30;

// One-time codes. With an SMS provider configured the code is random and sent by SMS; without one
// (demo / development) the code is DEMO_OTP. Either way only a hash is stored, codes expire after
// 5 minutes and allow 5 attempts.
const OTP_TTL_MS = 5 * 60e3;
const smsConfigured = (env) => !!(env.SMS_API_URL && env.SMS_API_KEY);
async function sendSms(env, phone, text) {
  // Generic JSON SMS gateway hook. Replace the body with your provider's format once you have an account.
  const res = await fetch(env.SMS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SMS_API_KEY}` },
    body: JSON.stringify({ to: '+92' + phone.slice(1), text, sender: env.SMS_SENDER || 'KaamWala' }),
  });
  if (!res.ok) throw new Error('SMS could not be sent');
}
async function issueOtp(db, env, phone, purpose) {
  const recent = db.prepare('SELECT COUNT(*) n FROM otp_codes WHERE phone = ? AND created_at > ?').get(phone, new Date(Date.now() - 3600e3).toISOString()).n;
  if (recent >= 5) return { error: 'Too many codes requested. Try again in an hour.' };
  const demo = !smsConfigured(env);
  const code = demo ? String(env.DEMO_OTP || '1234') : String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  db.prepare('INSERT INTO otp_codes (phone,purpose,code_hash,expires_at,created_at) VALUES (?,?,?,?,?)')
    .run(phone, purpose, tokenHash(`${phone}:${code}`), new Date(Date.now() + OTP_TTL_MS).toISOString(), now());
  if (!demo) await sendSms(env, phone, `Your KaamWala code is ${code}. It expires in 5 minutes. Never share it.`);
  return { sent: true, demo };
}
// Returns true and uses up the code if it matches an unexpired code for this phone.
function checkOtp(db, env, phone, code) {
  const rows = db.prepare('SELECT * FROM otp_codes WHERE phone = ? AND used_at IS NULL AND expires_at > ? AND attempts < 5 ORDER BY id DESC LIMIT 3').all(phone, now());
  const h = tokenHash(`${phone}:${String(code || '').trim()}`);
  const hit = rows.find((r) => r.code_hash === h);
  if (hit) { db.prepare('UPDATE otp_codes SET used_at = ? WHERE id = ?').run(now(), hit.id); return true; }
  for (const r of rows) db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(r.id);
  // Demo mode keeps the old "always 1234" login working without asking for a code first.
  return !smsConfigured(env) && String(code) === String(env.DEMO_OTP || '1234');
}

// Wrong passwords / codes: 5 failures lock that phone for 15 minutes.
const LOCK_AFTER = 5, LOCK_MS = 15 * 60e3;
function throttle() {
  const fails = new Map();
  return {
    locked(phone) { const f = fails.get(phone); return !!(f && f.count >= LOCK_AFTER && Date.now() - f.at < LOCK_MS); },
    fail(phone) { const f = fails.get(phone); const fresh = !f || Date.now() - f.at > LOCK_MS; fails.set(phone, { count: fresh ? 1 : f.count + 1, at: Date.now() }); },
    ok(phone) { fails.delete(phone); },
  };
}

module.exports = { hashPassword, verifyPassword, checkPasswordRules, normalizePhone, displayPhone, newToken, tokenHash, SESSION_DAYS, issueOtp, checkOtp, smsConfigured, throttle };
