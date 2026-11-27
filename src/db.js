'use strict';
// SQLite schema and seed data (node:sqlite, built into Node 22+, so no native deps).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);
  upgradeAccounts(db);
  if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) seed(db);
  syncProfiles(db);
  return db;
}

function migrate(db) {
  upgradeOldExtras(db);
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('customer','worker','admin')),
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    area TEXT DEFAULT 'Johar Town',
    lang TEXT DEFAULT 'en'
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    category TEXT NOT NULL,
    areas TEXT NOT NULL,
    exp_years INTEGER NOT NULL,
    exp_documented INTEGER NOT NULL DEFAULT 0,
    skills TEXT NOT NULL DEFAULT '',
    visit_fee INTEGER NOT NULL,
    extra_rates TEXT NOT NULL DEFAULT '',
    distance_km REAL NOT NULL DEFAULT 1,
    cnic_verified INTEGER NOT NULL DEFAULT 0,
    phone_address_verified INTEGER NOT NULL DEFAULT 0,
    references_checked INTEGER NOT NULL DEFAULT 0,
    skill_assessment TEXT NOT NULL DEFAULT 'pending' CHECK (skill_assessment IN ('pending','passed','none')),
    slots TEXT NOT NULL DEFAULT '["11:00","2:00","5:30"]',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','suspended')),
    payout_wallet TEXT,
    payout_provider TEXT
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES users(id),
    worker_id INTEGER NOT NULL REFERENCES workers(id),
    problem TEXT NOT NULL,
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    address TEXT NOT NULL,
    visit_fee INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested'
      CHECK (status IN ('requested','confirmed','on_the_way','in_progress','completed','cancelled')),
    eta_min INTEGER,
    history TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  -- Add-on service requests ("extras"): extra work a worker finds on site. Every one is tied to
  -- its booking, priced on the server (labour + materials) and only counts once the customer approves.
  CREATE TABLE IF NOT EXISTS extras (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    worker_id INTEGER NOT NULL REFERENCES workers(id),
    problem TEXT NOT NULL,
    work TEXT NOT NULL,
    labour INTEGER NOT NULL CHECK (labour >= 0),
    materials INTEGER NOT NULL DEFAULT 0 CHECK (materials >= 0),
    amount INTEGER NOT NULL CHECK (amount > 0),
    est_minutes INTEGER,
    urgent_safety INTEGER NOT NULL DEFAULT 0,
    safety_risk TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','approved','rejected','cancelled','disputed')),
    pay_status TEXT NOT NULL DEFAULT 'unpaid'
      CHECK (pay_status IN ('unpaid','paid','refunded','partly_refunded')),
    refunded_amount INTEGER NOT NULL DEFAULT 0,
    over_threshold INTEGER NOT NULL DEFAULT 0,
    reject_reason TEXT,
    client_key TEXT,
    decided_by INTEGER REFERENCES users(id),
    decided_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (booking_id, client_key)
  );
  -- Audit trail: every price change or decision on a booking, with the approved total after it.
  CREATE TABLE IF NOT EXISTS price_events (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    extra_id INTEGER REFERENCES extras(id),
    actor_id INTEGER REFERENCES users(id),
    actor_role TEXT,
    event TEXT NOT NULL,
    amount INTEGER,
    approved_total INTEGER NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS addon_messages (
    id INTEGER PRIMARY KEY,
    extra_id INTEGER NOT NULL REFERENCES extras(id),
    sender_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    extra_id INTEGER REFERENCES extras(id),
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    booking_id INTEGER REFERENCES bookings(id),
    extra_id INTEGER REFERENCES extras(id),
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    extra_id INTEGER REFERENCES extras(id),
    provider TEXT NOT NULL CHECK (provider IN ('jazzcash','easypaisa')),
    amount INTEGER NOT NULL,
    txn_ref TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','paid','failed')),
    provider_ref TEXT,
    raw TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  -- One escrow account per booking. Amounts in whole rupees.
  CREATE TABLE IF NOT EXISTS escrows (
    booking_id INTEGER PRIMARY KEY REFERENCES bookings(id),
    state TEXT NOT NULL DEFAULT 'awaiting_payment'
      CHECK (state IN ('awaiting_payment','held','disputed','released','refunded','split')),
    held INTEGER NOT NULL DEFAULT 0,
    released INTEGER NOT NULL DEFAULT 0,
    refunded INTEGER NOT NULL DEFAULT 0,
    commission INTEGER NOT NULL DEFAULT 0,
    auto_release_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    type TEXT NOT NULL CHECK (type IN ('hold','release','commission','refund')),
    amount INTEGER NOT NULL,
    provider TEXT,
    note TEXT,
    payout_status TEXT CHECK (payout_status IN ('pending','sent')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS disputes (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    raised_by INTEGER NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
    resolution TEXT,
    refund_amount INTEGER,
    extra_id INTEGER REFERENCES extras(id),
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS reviews (
    booking_id INTEGER PRIMARY KEY REFERENCES bookings(id),
    worker_id INTEGER NOT NULL REFERENCES workers(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    sender_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY,
    reporter_id INTEGER NOT NULL REFERENCES users(id),
    worker_id INTEGER REFERENCES workers(id),
    booking_id INTEGER REFERENCES bookings(id),
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL
  );`);
}

// Accounts: passwords, several roles per person, separate customer / worker profiles, worker verification.
const addColumn = (db, table, col, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
function upgradeAccounts(db) {
  addColumn(db, 'users', 'email', 'TEXT');
  addColumn(db, 'users', 'password_hash', 'TEXT');
  addColumn(db, 'users', 'created_at', 'TEXT');
  addColumn(db, 'sessions', 'expires_at', 'TEXT');
  // Worker profile fields from registration. verification is the only thing that earns the Verified badge.
  addColumn(db, 'workers', 'verification', "TEXT NOT NULL DEFAULT 'unsubmitted'");
  addColumn(db, 'workers', 'verification_note', 'TEXT');
  addColumn(db, 'workers', 'verified_at', 'TEXT');
  addColumn(db, 'workers', 'verified_by', 'INTEGER REFERENCES users(id)');
  addColumn(db, 'workers', 'bio', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'workers', 'city', "TEXT NOT NULL DEFAULT 'Lahore'");
  addColumn(db, 'workers', 'hours_from', "TEXT NOT NULL DEFAULT '09:00'");
  addColumn(db, 'workers', 'hours_to', "TEXT NOT NULL DEFAULT '18:00'");
  addColumn(db, 'workers', 'work_days', `TEXT NOT NULL DEFAULT '["Mon","Tue","Wed","Thu","Fri","Sat"]'`);
  addColumn(db, 'workers', 'preferred_locations', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'workers', 'available', 'INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'workers', 'photo_id', 'TEXT');
  addColumn(db, 'workers', 'created_at', 'TEXT');
  addColumn(db, 'media', 'purpose', "TEXT NOT NULL DEFAULT 'addon'");
  addColumn(db, 'media', 'booking_id', 'INTEGER REFERENCES bookings(id)');
  // Workers that existed before verification statuses were added were checked by hand (cnic_verified).
  db.exec("UPDATE workers SET verification = 'verified' WHERE verification = 'unsubmitted' AND cnic_verified = 1");
  db.exec(`
  CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('customer','worker','admin')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, role)
  );
  CREATE TABLE IF NOT EXISTS customer_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    city TEXT NOT NULL DEFAULT 'Lahore',
    photo_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    label TEXT NOT NULL,
    line TEXT NOT NULL,
    area TEXT,
    city TEXT NOT NULL DEFAULT 'Lahore',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS favourites (
    user_id INTEGER NOT NULL REFERENCES users(id),
    worker_id INTEGER NOT NULL REFERENCES workers(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, worker_id)
  );
  CREATE TABLE IF NOT EXISTS blocks (
    user_id INTEGER NOT NULL REFERENCES users(id),
    blocked_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, blocked_id)
  );
  -- Identity / verification documents. Stored outside the public folder and only served to the
  -- worker who uploaded them and to admins.
  CREATE TABLE IF NOT EXISTS worker_documents (
    id TEXT PRIMARY KEY,
    worker_id INTEGER NOT NULL REFERENCES workers(id),
    kind TEXT NOT NULL CHECK (kind IN ('cnic_front','cnic_back','selfie','certificate','other')),
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS otp_codes (
    id INTEGER PRIMARY KEY,
    phone TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );`);
}

// Every user has their current role in user_roles, and every customer has a customer profile.
function syncProfiles(db) {
  const t = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role, created_at) SELECT id, role, ? FROM users').run(t);
  db.prepare("INSERT OR IGNORE INTO customer_profiles (user_id, created_at) SELECT user_id, ? FROM user_roles WHERE role = 'customer'").run(t);
}

// Databases made before add-on requests had a simpler extras table; rebuild it in place.
function upgradeOldExtras(db) {
  const t = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='extras'").get();
  if (!t || t.sql.includes('labour')) return;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`ALTER TABLE extras RENAME TO extras_v1`);
  migrate(db); // creates the new extras table
  db.exec(`INSERT INTO extras (id, booking_id, worker_id, problem, work, labour, materials, amount, status, pay_status, created_at)
    SELECT x.id, x.booking_id, b.worker_id, x.description, x.description, x.amount, 0, x.amount, x.status,
      CASE WHEN EXISTS (SELECT 1 FROM payments p WHERE p.extra_id = x.id AND p.status = 'paid') THEN 'paid' ELSE 'unpaid' END, x.created_at
    FROM extras_v1 x JOIN bookings b ON b.id = x.booking_id;
    DROP TABLE extras_v1;`);
  const cols = db.prepare('PRAGMA table_info(disputes)').all().map((c) => c.name);
  if (!cols.includes('extra_id')) db.exec('ALTER TABLE disputes ADD COLUMN extra_id INTEGER REFERENCES extras(id)');
  db.exec('PRAGMA foreign_keys = ON');
}

// Seed reviews give each worker the rating shown in the deck (e.g. Ali Raza 4.8 from 36 jobs).
function seed(db) {
  const now = new Date().toISOString();
  const { hashPassword } = require('./auth');
  const addUser = db.prepare('INSERT INTO users (role,name,phone,area) VALUES (?,?,?,?)');
  addUser.run('admin', 'KaamWala Admin', '03000000000', 'Johar Town');
  addUser.run('customer', 'Ahmed Khan', '03001234567', 'Johar Town');
  const pastId = addUser.run('customer', 'Past customers (seed)', '03000000001', 'Johar Town').lastInsertRowid;

  const workers = [
    // name, phone, category, areas, yrs, documented, skills, fee, extra, km, cnic, phone/addr, refs, skill, rating, count
    ['Ali Raza', '03011111111', 'electrician', 'Johar Town & Model Town', 8, 1, 'wiring, DB boards, fans, UPS', 800, 'Fan fitting Rs 500+', 2.1, 1, 1, 2, 'pending', 4.8, 36],
    ['Bilal Ahmed', '03022222222', 'electrician', 'Johar Town & Wapda Town', 5, 1, 'wiring, lights, breakers', 700, 'Breaker change Rs 400+', 2.8, 1, 1, 1, 'passed', 4.7, 22],
    ['Hamza Tariq', '03033333333', 'electrician', 'Johar Town', 3, 0, 'switches, sockets, fans', 600, 'Socket fitting Rs 300+', 3.9, 1, 0, 0, 'pending', 4.5, 9],
    ['Usman Khalid', '03044444444', 'plumber', 'Johar Town & Faisal Town', 6, 1, 'geysers, leaks, taps, motors', 700, 'Tap change Rs 400+', 3.4, 1, 1, 2, 'passed', 4.6, 21],
    ['Imran Shah', '03055555555', 'plumber', 'Model Town', 4, 0, 'pipes, drains, tanks', 600, 'Drain cleaning Rs 800+', 4.2, 1, 1, 0, 'pending', 4.4, 12],
    ['Faisal Iqbal', '03066666666', 'ac', 'Johar Town & DHA', 7, 1, 'split AC service, gas refill, install', 1000, 'Gas refill Rs 3,500+', 2.6, 1, 1, 2, 'passed', 4.9, 41],
    ['Naveed Akhtar', '03077777777', 'carpenter', 'Johar Town', 10, 1, 'doors, locks, furniture repair', 700, 'Lock change Rs 500+', 3.1, 1, 1, 1, 'pending', 4.6, 18],
    ['Shahid Mehmood', '03088888888', 'painter', 'Johar Town & Gulberg', 9, 1, 'interior, exterior, weather shield', 900, 'Per room Rs 8,000+', 4.8, 1, 1, 1, 'none', 4.5, 14],
    ['Kashif Ali', '03099999999', 'appliance', 'Johar Town', 6, 1, 'washing machines, fridges, ovens', 800, 'Part cost extra', 3.6, 1, 1, 2, 'passed', 4.7, 19],
    ['Sajid Hussain', '03101010101', 'cleaning', 'Johar Town & Model Town', 4, 0, 'deep cleaning, sofa, tanks', 1500, 'Water tank Rs 2,500+', 2.4, 1, 1, 0, 'pending', 4.4, 11],
  ];
  const addWorker = db.prepare(`INSERT INTO workers (user_id,category,areas,exp_years,exp_documented,skills,visit_fee,extra_rates,distance_km,
    cnic_verified,phone_address_verified,references_checked,skill_assessment,payout_wallet,payout_provider) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const addBooking = db.prepare(`INSERT INTO bookings (code,customer_id,worker_id,problem,date,slot,address,visit_fee,status,history,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const addReview = db.prepare('INSERT INTO reviews (booking_id,worker_id,rating,comment,created_at) VALUES (?,?,?,?,?)');
  let n = 0;
  for (const w of workers) {
    const uid = addUser.run('worker', w[0], w[1], 'Johar Town').lastInsertRowid;
    const wid = addWorker.run(uid, w[2], w[3], w[4], w[5], w[6], w[7], w[8], w[9], w[10], w[11], w[12], w[13], w[1], 'jazzcash').lastInsertRowid;
    // Spread ratings so the average, truncated to one decimal (see ratingSql), shows the target.
    const [target, count] = [w[14], w[15]];
    let total = Math.ceil(target * count - 1e-9);
    for (let i = 0; i < count; i++) {
      const left = count - i;
      const r = Math.max(1, Math.min(5, Math.round(total / left)));
      total -= r;
      const bid = addBooking.run(`KW-H${(++n).toString().padStart(3, '0')}`, pastId, wid, 'Past job', '2026-09-01', '11:00', 'Johar Town', w[7], 'completed', '{}', now).lastInsertRowid;
      addReview.run(bid, wid, r, null, now);
    }
  }
  seedAddonDemo(db);
  // Demo accounts that can also log in with a password (all others use the demo code).
  const pw = (phone) => db.prepare('UPDATE users SET password_hash = ? WHERE phone = ?').run(hashPassword('kaam1234'), phone);
  ['03000000000', '03001234567', '03011111111'].forEach(pw);
  db.prepare("UPDATE workers SET bio = 'Experienced ' || category || ' working in ' || areas || '. Clean work, fair prices, on time.', created_at = ?").run(now);
  db.prepare("UPDATE workers SET bio = 'Licensed electrician with 8 years in house wiring, DB boards and UPS installs. I explain the fault and the price before starting.' WHERE user_id = (SELECT id FROM users WHERE phone = '03011111111')").run();
  db.exec("UPDATE workers SET verification = CASE WHEN cnic_verified = 1 THEN 'verified' ELSE 'pending' END");
  // Ali Raza also books services for his own home: one account, two roles (worker active).
  const ali = db.prepare("SELECT id FROM users WHERE phone = '03011111111'").get().id;
  db.prepare("INSERT INTO user_roles (user_id, role, created_at) VALUES (?, 'customer', ?)").run(ali, now);
  const ahmed = db.prepare("SELECT id FROM users WHERE phone = '03001234567'").get().id;
  db.prepare("UPDATE users SET email = 'ahmed.khan@example.com' WHERE id = ?").run(ahmed);
  db.prepare("INSERT INTO addresses (user_id,label,line,area,city,is_default,created_at) VALUES (?,?,?,?,?,?,?)").run(ahmed, 'Home', 'House 12, Block G, Johar Town', 'Johar Town', 'Lahore', 1, now);
  db.prepare("INSERT INTO addresses (user_id,label,line,area,city,is_default,created_at) VALUES (?,?,?,?,?,?,?)").run(ahmed, 'Office', '3rd floor, 45 Main Boulevard, Gulberg', 'Gulberg', 'Lahore', 0, now);
  db.prepare("INSERT INTO favourites (user_id, worker_id, created_at) SELECT ?, w.id, ? FROM workers w JOIN users u ON u.id = w.user_id WHERE u.phone IN ('03011111111','03066666666')").run(ahmed, now);
  db.prepare('UPDATE users SET created_at = ?').run(now);
}

// Two demo bookings for the customer Ahmed that show add-on requests (the tap/pipe example from the spec):
//  KW-1024 plumber Usman, job in progress, an add-on waiting for Ahmed's decision.
//  KW-1025 AC technician Faisal, completed: one add-on approved and paid (over the warning line), one rejected.
function seedAddonDemo(db) {
  const ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
  const ahmed = db.prepare("SELECT id FROM users WHERE phone = '03001234567'").get().id;
  const wk = (phone) => db.prepare('SELECT w.id, w.user_id FROM workers w JOIN users u ON u.id = w.user_id WHERE u.phone = ?').get(phone);
  const usman = wk('03044444444');
  const faisal = wk('03066666666');
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');

  const booking = (code, w, problem, status, history, at) => db.prepare(`INSERT INTO bookings (code,customer_id,worker_id,problem,date,slot,address,visit_fee,status,history,created_at)
    VALUES (?,?,?,?,?,?,?,1000,?,?,?)`).run(code, ahmed, w.id, problem, today, '11:00', 'House 12, Block G, Johar Town', status, JSON.stringify(history), at).lastInsertRowid;
  const pay = (bid, extraId, provider, amount, ref, at) => {
    db.prepare(`INSERT INTO payments (booking_id,extra_id,provider,amount,txn_ref,status,provider_ref,raw,created_at,updated_at) VALUES (?,?,?,?,?,'paid',?,?,?,?)`)
      .run(bid, extraId, provider, amount, ref, 'SEED-' + ref, '{"seed":true}', at, at);
    db.prepare("INSERT INTO ledger (booking_id,type,amount,provider,note,created_at) VALUES (?,'hold',?,?,?,?)").run(bid, amount, provider, extraId ? 'Approved add-on' : 'Visit / inspection fee', at);
  };
  const event = (bid, xid, actor, role, ev, amount, total, note, at) => db.prepare(`INSERT INTO price_events (booking_id,extra_id,actor_id,actor_role,event,amount,approved_total,note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(bid, xid, actor, role, ev, amount, total, note, at);
  const extra = (bid, w, f, at) => db.prepare(`INSERT INTO extras (booking_id,worker_id,problem,work,labour,materials,amount,est_minutes,status,pay_status,over_threshold,reject_reason,decided_by,decided_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(bid, w.id, f.problem, f.work, f.labour, f.materials, f.labour + f.materials, f.est, f.status, f.pay || 'unpaid', f.over ? 1 : 0, f.reason || null, f.decided ? ahmed : null, f.decided || null, at).lastInsertRowid;

  // KW-1024: pending add-on
  const b1 = booking('KW-1024', usman, 'Kitchen tap leaking', 'in_progress', { requested: ago(120), confirmed: ago(115), on_the_way: ago(60), in_progress: ago(30) }, ago(120));
  db.prepare("INSERT INTO escrows (booking_id,state,held,updated_at) VALUES (?,'held',1000,?)").run(b1, ago(118));
  pay(b1, null, 'jazzcash', 1000, 'TSEED1', ago(118));
  event(b1, null, ahmed, 'customer', 'booking_created', 1000, 1000, 'Original price: tap repair (estimate)', ago(120));
  const x1 = extra(b1, usman, { problem: 'The pipe under the sink is cracked and also leaking', work: 'Replace the damaged pipe section and joint', labour: 700, materials: 300, est: 45, status: 'pending', over: false }, ago(5));
  event(b1, x1, usman.user_id, 'worker', 'addon_requested', 1000, 1000, 'Replace the damaged pipe section and joint', ago(5));
  db.prepare("INSERT INTO notifications (user_id,booking_id,extra_id,kind,body,created_at) VALUES (?,?,?,'addon_requested',?,?)")
    .run(ahmed, b1, x1, 'Add-on requested on KW-1024: Replace the damaged pipe section and joint (Rs 1000). Nothing is charged unless you approve.', ago(5));

  // KW-1025: completed with approved + rejected add-ons
  const b2 = booking('KW-1025', faisal, 'Split AC not cooling', 'completed',
    { requested: ago(300), confirmed: ago(295), on_the_way: ago(260), in_progress: ago(240), completed: ago(150) }, ago(300));
  db.prepare("INSERT INTO escrows (booking_id,state,held,auto_release_at,updated_at) VALUES (?,'held',4500,?,?)").run(b2, new Date(Date.now() + 70 * 3600e3).toISOString(), ago(150));
  pay(b2, null, 'easypaisa', 1000, 'TSEED2', ago(298));
  event(b2, null, ahmed, 'customer', 'booking_created', 1000, 1000, 'Original price: AC inspection', ago(300));
  const x2 = extra(b2, faisal, { problem: 'Gas pressure is very low; small leak at the outdoor valve', work: 'Fix valve leak and refill R32 gas', labour: 1500, materials: 2000, est: 60, status: 'approved', pay: 'paid', over: true, decided: ago(225) }, ago(230));
  event(b2, x2, faisal.user_id, 'worker', 'addon_requested', 3500, 1000, 'Fix valve leak and refill R32 gas', ago(230));
  event(b2, x2, ahmed, 'customer', 'addon_approved', 3500, 4500, null, ago(225));
  pay(b2, x2, 'easypaisa', 3500, 'TSEED3', ago(224));
  event(b2, x2, null, 'system', 'addon_paid', 3500, 4500, 'Confirmed by payment provider', ago(224));
  const x3 = extra(b2, faisal, { problem: 'Fan capacitor looks weak', work: 'Replace outdoor fan capacitor', labour: 500, materials: 1200, est: 20, status: 'rejected', over: true, reason: 'Fan is working fine for now', decided: ago(200) }, ago(205));
  event(b2, x3, faisal.user_id, 'worker', 'addon_requested', 1700, 4500, 'Replace outdoor fan capacitor', ago(205));
  event(b2, x3, ahmed, 'customer', 'addon_rejected', 1700, 4500, 'Fan is working fine for now', ago(200));
}

module.exports = { open };
