/* KaamWala customer + worker app. Plain JS, hash routing, no build step. */
(() => {
  'use strict';

  const AREAS = ['Johar Town', 'Model Town', 'DHA', 'Gulberg', 'Wapda Town', 'Faisal Town', 'Bahria Town'];
  const CATS = ['electrician', 'plumber', 'ac', 'carpenter', 'painter', 'appliance', 'cleaning'];
  const PILOT = ['electrician', 'plumber']; // highlighted tiles, as in the demo
  const FLOW = ['requested', 'confirmed', 'on_the_way', 'in_progress', 'completed'];

  // ---------- icons (stroke icons, 24px grid) ----------
  const P = {
    shield: '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    bell: '<path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.9 1.9 0 003.4 0"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    electrician: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    plumber: '<path d="M12 3s6 6.5 6 11a6 6 0 11-12 0c0-4.5 6-11 6-11z"/>',
    ac: '<path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5"/>',
    carpenter: '<path d="M14 6l4 4-9 9-4-4z"/><path d="M14 6l2-2 4 4-2 2"/><path d="M5 15l-2 6 6-2"/>',
    painter: '<rect x="4" y="3" width="14" height="6" rx="1.5"/><path d="M18 6h2v5h-8v3"/><rect x="10.5" y="14" width="3" height="7" rx="1"/>',
    appliance: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M7 6.5h2"/>',
    cleaning: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M18.5 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z"/>',
    more: '<path d="M9 6l6 6-6 6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    x: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    msg: '<path d="M4 5h16v11H9l-5 4z"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/>',
    headset: '<path d="M4 15v-3a8 8 0 0116 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.7-2.5 2-2.5 4M12 17v.01"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
    toolbox: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V6a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18M10 13v2h4v-2"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    card: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12h18"/>',
  };
  const icon = (n, s = 22, extra = '') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${P[n] || ''}</svg>`;
  const star = (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round">${P.star}</svg>`;

  // ---------- state ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  const S = { token: store.get('kw_token'), me: null, roles: [], customer: null, worker: null, lang: store.get('kw_lang') || 'en', area: store.get('kw_area') || 'Johar Town', filters: { verified: true, rating: false, today: false } };

  const t = (k, vars = {}) => String((I18N[S.lang] || I18N.en)[k] ?? I18N.en[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
  const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const rs = (n) => Number(n).toLocaleString('en-PK');
  const $ = (sel) => document.querySelector(sel);
  const app = $('#app');

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logout(); throw new Error(data.error); }
    if (!res.ok) throw new Error(data.error || 'Error');
    return data;
  }

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (err) { toast(err.message, 'err'); } };

  // Firebase Phone Login. Only used when the server has Firebase keys (GET /api/auth-config);
  // otherwise the app's own codes are used (demo code 1234). Google's script loads on first use.
  const FB_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  let fbConf; // undefined until asked, then the config or null
  const loadJs = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error(t('fb_load_failed'))); document.head.appendChild(s); });
  async function fbAuth() {
    if (fbConf === undefined) fbConf = (await api('/api/auth-config').catch(() => ({}))).firebase || null;
    if (!fbConf) return null;
    if (!window.firebase?.auth) { await loadJs(FB_SDK + 'firebase-app-compat.js'); await loadJs(FB_SDK + 'firebase-auth-compat.js'); }
    if (!firebase.apps.length) firebase.initializeApp(fbConf);
    const a = firebase.auth();
    a.languageCode = S.lang === 'ur' ? 'ur' : 'en';
    return a;
  }
  const fbError = (err) => {
    const c = err?.code || '';
    if (c === 'auth/invalid-verification-code' || c === 'auth/missing-verification-code') return new Error(t('fb_wrong_code'));
    if (c === 'auth/code-expired') return new Error(t('fb_code_expired'));
    if (c === 'auth/too-many-requests' || c === 'auth/quota-exceeded') return new Error(t('fb_too_many'));
    if (c === 'auth/invalid-phone-number') return new Error(t('err_phone'));
    return new Error(err?.message || 'Error');
  };
  // Sends the SMS through Firebase. Returns confirm(code) -> token for the server, or null when Firebase is off.
  async function fbSendCode(phone) {
    const a = await fbAuth();
    if (!a) return null;
    try { window._kwCaptcha?.clear(); } catch {}
    document.getElementById('kw-captcha')?.remove();
    const box = document.createElement('div'); box.id = 'kw-captcha'; document.body.appendChild(box);
    window._kwCaptcha = new firebase.auth.RecaptchaVerifier(box, { size: 'invisible' });
    const intl = phone.startsWith('92') ? '+' + phone : '+92' + phone.replace(/^0/, '');
    let conf;
    try { conf = await a.signInWithPhoneNumber(intl, window._kwCaptcha); } catch (err) { throw fbError(err); }
    let token = null; // kept so a retry after a server-side error doesn't reuse the (already used) SMS code
    const confirm = async (code) => {
      if (token) return token;
      try { const cred = await conf.confirm(String(code || '').trim()); token = await cred.user.getIdToken(); } catch (err) { throw fbError(err); }
      a.signOut().catch(() => {}); // the app's own session takes over from here
      return token;
    };
    return { phone, confirm };
  }

  function sheet(title, bodyHtml, onMount) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" dir="${S.lang === 'ur' ? 'rtl' : 'ltr'}"><h3>${e(title)}</h3>${bodyHtml}</div>`;
    bg.addEventListener('click', (ev) => { if (ev.target === bg) bg.remove(); });
    document.body.appendChild(bg);
    onMount?.(bg, () => bg.remove());
  }

  function applyLang() {
    document.documentElement.lang = S.lang === 'ur' ? 'ur' : 'en';
    document.documentElement.dir = S.lang === 'ur' ? 'rtl' : 'ltr';
  }
  async function setLang(l) {
    S.lang = l; store.set('kw_lang', l); applyLang();
    if (S.token) api('/api/me', { method: 'PATCH', body: { lang: l } }).catch(() => {});
    render();
  }
  function logout() {
    if (S.token) fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${S.token}` } }).catch(() => {});
    S.token = null; S.me = null; S.worker = null; S.customer = null; store.set('kw_token', null); location.hash = '#/login'; render();
  }

  // ---------- formatting ----------
  const catName = (c) => t(c);
  const shortName = (n) => { const [a, b] = n.split(' '); return b ? `${a} ${b[0]}.` : a; };
  const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const dayLabel = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  const when = (iso) => `${dayLabel(new Date(iso))}, ${timeOf(iso)}`;
  function slotRange(s) {
    const [h, m] = s.split(':').map(Number);
    const pm = h < 8 || h === 12;
    const end = h === 12 ? 1 : h + 1;
    return `${s}–${end}:${String(m).padStart(2, '0')} ${pm || end === 12 ? 'pm' : 'am'}`;
  }

  const ratingHtml = (w, s = 14) => `<span class="rating">${star(s)}${w.rating ?? '–'} (${w.review_count})</span>`;
  const verifiedTick = `<span style="color:var(--teal);display:inline-flex">${icon('check', 17)}</span>`;

  function tabs(active) {
    const worker = S.me?.role === 'worker';
    const items = [['home', 'home', '#/home'], ['bookings', worker ? 'briefcase' : 'cal', '#/bookings', worker ? 'jobs' : 'bookings'], ['messages', 'msg', '#/messages'], ['profile', 'user', '#/profile']];
    return `<nav class="tabs">${items.map(([k, ic, href, label]) => `<button class="tab ${active === k ? 'on' : ''}" data-go="${href}">${icon(ic, 22)}<span>${t(label || k)}</span></button>`).join('')}</nav>`;
  }
  const topbar = (title, back = 'back') => `<div class="topbar"><button class="back" data-back="${back}" aria-label="Back">‹</button><span>${title}</span></div>`;

  // ---------- screens ----------
  const langToggle = () => `<button class="lang" data-lang>${S.lang === 'en' ? '<span class="on">EN</span> | <span class="off">اردو</span>' : '<span class="off">EN</span> | <span class="on">اردو</span>'}</button>`;

  async function screenHome() {
    if (S.me.role === 'worker') return screenWorkerHome();
    const [{ workers }, { unread }] = await Promise.all([api(`/api/workers?area=${encodeURIComponent(S.area)}`), api('/api/notifications')]);
    // Closest worker per category, pilot categories first (as in the demo: Ali R., Usman K.)
    const all = workers.length ? workers : (await api('/api/workers')).workers;
    const nearby = CATS.map((c) => all.find((w) => w.category === c)).filter(Boolean);
    app.innerHTML = `<div class="screen">
      <div class="hero">
        <div class="hero-top">
          <div class="logo"><span class="logo-mark">${icon('shield', 20)}</span><span>Kaam<b>Wala</b></span></div>
          <span class="spacer"></span>${langToggle()}
          ${bell(unread)}
        </div>
        <label class="loc">${icon('pin', 15)}<span>${e(S.area)}, Lahore ▾</span><select id="area" aria-label="${t('area')}">${AREAS.map((a) => `<option ${a === S.area ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        <form class="search" id="sf">${icon('search', 18)}<input name="q" placeholder="${t('search')}" autocomplete="off"></form>
      </div>
      <h2 class="section">${t('services')}</h2>
      <div class="grid">
        ${CATS.map((c) => `<button class="cat ${PILOT.includes(c) ? 'pilot' : ''}" data-go="#/list/${c}"><span class="tile">${icon(c, 24)}</span>${catName(c)}</button>`).join('')}
        <button class="cat" data-go="#/list/all"><span class="tile">${icon('more', 24)}</span>${t('more')}</button>
      </div>
      <h2 class="section">${t('nearby')} <a href="#/list/all">${t('see_all')}</a></h2>
      ${nearby.slice(0, 4).map((w) => `
        <div class="card nearby">
          <a class="list-item" href="#/worker/${w.id}">
            <div class="row">${avatar(w.photo_url)}
              <div><div class="name"><bdi>${e(shortName(w.name))}</bdi> ${w.id_verified ? verifiedTick : ''}</div><div class="sub">${catName(w.category)} · <bdi>${w.distance_km} km</bdi></div></div>
            </div>${ratingHtml(w)}
          </a>
          <div class="nb-foot"><span class="sub">${t('from_visit', { n: rs(w.visit_fee) })} · ${icon('clock', 13)} ${t('next_slot', { s: e(w.slots[0] || '—') })}</span>
            <button class="btn sm" data-go="#/book/${w.id}?slot=${encodeURIComponent(w.slots[0] || '')}">${t('book_now')}</button></div>
        </div>`).join('') || `<div class="empty">${t('no_workers_area')}</div>`}
      ${tabs('home')}
    </div>`;
    $('#area').onchange = (ev) => { S.area = ev.target.value; store.set('kw_area', S.area); api('/api/me', { method: 'PATCH', body: { area: S.area } }).catch(() => {}); render(); };
    $('#sf').onsubmit = (ev) => { ev.preventDefault(); const q = new FormData(ev.target).get('q').trim(); if (q) location.hash = `#/list/all?q=${encodeURIComponent(q)}`; };
  }

  async function screenList(cat, query) {
    const qs = new URLSearchParams();
    if (cat !== 'all') qs.set('category', cat);
    if (query.q) qs.set('q', query.q);
    if (S.filters.rating) qs.set('min_rating', '4.5');
    if (S.filters.today) qs.set('today', '1');
    const { workers } = await api(`/api/workers?${qs}`);
    const plural = cat === 'all' ? (S.lang === 'ur' ? 'کاریگر' : 'workers') : t(`${cat}_pl`);
    const title = query.q ? t('search_results', { x: e(query.q) }) : t('near_you', { x: cat === 'all' ? (S.lang === 'ur' ? 'کاریگر' : 'Workers') : plural });
    const docYrs = (w) => (w.exp_documented ? t('yrs_doc', { n: w.exp_years }) : t('yrs_self', { n: w.exp_years }));
    app.innerHTML = `<div class="screen">
      ${topbar(title)}
      <div class="chips">
        <button class="chip ${S.filters.verified ? 'on' : ''}" data-f="verified">${t('verified_id')}</button>
        <button class="chip ${S.filters.rating ? 'on' : ''}" data-f="rating">${t('rating45')}</button>
        <button class="chip ${S.filters.today ? 'on' : ''}" data-f="today">${t('today')}</button>
      </div>
      <div class="count">${t('n_verified', { n: workers.length, x: plural.toLowerCase(), area: S.area })}</div>
      ${workers.map((w) => `
        <div class="card">
          <div class="row" style="align-items:flex-start">
            ${avatar(w.photo_url)}
            <div style="flex:1">
              <div class="row" style="justify-content:space-between"><div class="name">${e(w.name)}</div>${ratingHtml(w)}</div>
              ${w.id_verified ? `<span class="badge">${icon('check', 13)} ${t('id_verified')}</span>` : ''}
              <div class="sub">${cat === 'all' ? catName(w.category) + ' · ' : ''}${docYrs(w)}</div>
            </div>
          </div>
          <div class="price-row"><span>${t('from_visit', { n: rs(w.visit_fee) })}</span><button class="btn sm" data-go="#/worker/${w.id}">${t('view')}</button></div>
        </div>`).join('') || `<div class="empty">—</div>`}
      ${tabs('home')}
    </div>`;
    app.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => {
      const f = b.dataset.f;
      if (f === 'verified') return toast(S.lang === 'ur' ? 'کام والا صرف تصدیق شدہ شناخت والے کاریگر دکھاتا ہے' : 'KaamWala only lists ID-verified workers');
      S.filters[f] = !S.filters[f]; render();
    }));
  }

  async function screenWorker(id, query) {
    const { worker: w } = await api(`/api/workers/${id}`);
    const c = w.checks;
    const own = S.worker && S.worker.id === w.id;
    const chk = (ok, wait, text) => `<li>${ok ? `<span class="ok">${icon('check', 17)}</span>` : wait ? `<span class="wait">${icon('clock', 17)}</span>` : `<span class="no">${icon('x', 17)}</span>`}${text}</li>`;
    const selected = query.slot || w.slots[1] || w.slots[0];
    const canBook = !own && S.me.role === 'customer' && w.available && w.id_verified && !w.blocked;
    app.innerHTML = `<div class="screen">
      <div class="phead">
        <div class="top"><button class="back" data-back aria-label="Back">‹</button><span class="pill-amber">${catName(w.category)}</span><span class="spacer"></span>
          ${S.me.role === 'customer' && !own ? `<button class="icon-btn fav ${w.favourite ? 'on' : ''}" id="fav" aria-label="${t('favourite')}">${icon('heart', 22)}</button>` : ''}</div>
        <div class="who">${avatar(w.photo_url, 36, 'lg')}
          <div><div class="name" style="font-size:18px">${e(w.name)} ${w.id_verified ? verifiedTick : ''}</div><div class="sub">${catName(w.category)} · ${e(w.areas)}</div>
          <div class="rating">${star(14)} ${t('reviews_from_jobs', { r: w.rating ?? '–', n: w.review_count })}</div>
          ${w.id_verified ? `<span class="badge">${icon('shield', 13)} ${t('verified_worker')}</span>` : verBadge(w.verification)}</div>
        </div>
      </div>
      ${own ? `<div class="card info"><div class="sub" style="margin:0;color:var(--navy)">${t('preview_own')}</div></div>` : ''}
      <div class="mini-stats">
        <div><b>${w.completed_jobs}</b><span>${t('completed_jobs')}</span></div>
        <div><b>${w.exp_years} ${S.lang === 'ur' ? 'سال' : 'yrs'}</b><span>${t(w.exp_documented ? 'documented' : 'self_reported')}</span></div>
        <div><b>Rs ${rs(w.visit_fee)}</b><span>${t('visit')}</span></div>
      </div>
      ${w.bio ? `<div class="card"><h3>${t('about')}</h3><div class="sub" style="color:var(--text)">${e(w.bio)}</div></div>` : ''}
      <div class="card"><h3>${t('verification_status')}</h3><ul class="checks">
        ${chk(c.cnic && w.id_verified, false, t(c.cnic && w.id_verified ? 'chk_cnic' : 'chk_cnic_no'))}
        ${chk(c.phone_address, false, t(c.phone_address ? 'chk_phone' : 'chk_phone_no'))}
        ${chk(c.references > 0, false, c.references ? t('chk_refs', { n: c.references }) : t('chk_refs_no'))}
        ${chk(c.skill === 'passed', c.skill === 'pending', t(`chk_skill_${c.skill}`))}
      </ul></div>
      <div class="card kv">
        <div>${t('skills')}: ${e(w.skills) || '—'}</div>
        <div class="lbl mt8">${t('est_charges')}</div>
        <div><b>${t('visit')} Rs ${rs(w.visit_fee)}${w.extra_rates ? ` · ${e(w.extra_rates)}` : ''}</b></div>
        <div class="lbl mt8">${t('working_hours')}</div><div>${hoursText(w)}</div>
      </div>
      ${w.portfolio.length ? `<div class="card"><h3>${t('portfolio')}</h3><div class="thumbs mt">${w.portfolio.map((p) => `<a href="${p.url}" target="_blank"><img src="${p.url}" alt="${t('photo')}"></a>`).join('')}</div></div>` : ''}
      ${w.reviews.length ? `<div class="card"><h3>${t('reviews')}</h3>${w.reviews.map((r) => `<div class="review"><div class="row" style="justify-content:space-between"><b>${e(r.customer)}</b><span class="rating">${star(12)} ${r.rating}</span></div><div class="sub">${e(r.comment)}</div></div>`).join('')}</div>` : ''}
      ${canBook ? `<h2 class="section" style="margin-top:6px">${t('slots_today')}</h2>
      <div class="slots">${w.slots.map((s) => `<button class="slot ${s === selected ? 'on' : ''}" data-slot="${s}">${s}</button>`).join('')}</div>
      <div class="field"><button class="btn navy" id="book">${t('book_now')}</button></div>`
        : !own ? `<div class="card"><div class="sub" style="margin:0">${t(w.blocked ? 'blocked_worker_note' : S.me.role !== 'customer' ? 'switch_to_book' : 'not_available_now')}</div></div>` : ''}
      ${own ? '' : `<div class="field row" style="justify-content:center;gap:18px"><button class="link-btn inline" id="report">${t('report_worker')}</button>
        ${w.blocked ? '' : `<button class="link-btn inline danger-txt" id="block">${t('block')}</button>`}</div>`}
      ${tabs('home')}
    </div>`;
    let slot = selected;
    app.querySelectorAll('[data-slot]').forEach((b) => (b.onclick = () => { slot = b.dataset.slot; app.querySelectorAll('[data-slot]').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#book') && ($('#book').onclick = () => (location.hash = `#/book/${w.id}?slot=${encodeURIComponent(slot)}`));
    $('#report') && ($('#report').onclick = () => reportSheet({ worker_id: w.id }));
    $('#block') && ($('#block').onclick = () => blockSheet({ worker_id: w.id }, () => (location.hash = '#/home')));
    $('#fav') && ($('#fav').onclick = guard(async () => {
      const on = $('#fav').classList.contains('on');
      await api(`/api/favourites/${w.id}`, { method: on ? 'DELETE' : 'POST', body: on ? undefined : {} });
      $('#fav').classList.toggle('on', !on); toast(t(on ? 'fav_removed' : 'fav_added'), 'ok');
    }));
  }

  function reportSheet(target) {
    sheet(t('support'), `<div class="field"><textarea id="rb" placeholder="${t('dispute_reason')}"></textarea></div><div class="field"><button class="btn" id="rs">${t('submit')}</button></div>`, (el, close) => {
      el.querySelector('#rs').onclick = guard(async () => {
        await api('/api/reports', { body: { ...target, body: el.querySelector('#rb').value } });
        close(); toast(t('report_sent'), 'ok');
      });
    });
  }

  async function screenBook(id, query) {
    const [{ worker: w }, { addresses }] = await Promise.all([api(`/api/workers/${id}`), api('/api/addresses')]);
    const def = addresses.find((a) => a.is_default);
    const files = [];
    const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return dayLabel(d); });
    let provider = store.get('kw_wallet') || 'jazzcash';
    app.innerHTML = `<div class="screen">
      ${topbar(t('confirm_booking'))}
      <form id="bf">
        <div class="field"><label>${t('service')}</label><input value="${catName(w.category)} · ${e(w.name)}${w.id_verified ? ` (${t('id_verified')})` : ''}" readonly></div>
        <div class="field"><label>${t('describe')}</label><textarea name="problem" required placeholder="${t('describe_ph')}"></textarea></div>
        <div class="field"><label>${t('date_time')}</label><div class="two">
          <select name="date">${days.map((d) => `<option>${d}</option>`).join('')}</select>
          <select name="slot">${w.slots.map((s) => `<option value="${s}" ${s === query.slot ? 'selected' : ''}>${slotRange(s)}</option>`).join('')}</select></div></div>
        <div class="field"><label>${t('problem_photos')} <span class="opt">(${t('optional')})</span></label>
          <label class="upload">${icon('camera', 22)}<span>${t('add_photos')}</span><input id="files" type="file" accept="image/*" multiple hidden></label>
          <div class="thumbs" id="thumbs"></div></div>
        <div class="field"><label>${t('address')}</label>
          ${addresses.length ? `<div class="chips" style="padding:0 0 8px">${addresses.map((a) => `<button type="button" class="chip ${a === def ? 'on' : ''}" data-addr="${e(a.line)}">${icon('pin', 12)} ${e(a.label)}</button>`).join('')}</div>` : ''}
          <input name="address" required placeholder="${t('address_ph')}" value="${e(def?.line || store.get('kw_address') || '')}"></div>
        <div class="fee-box">
          <div class="line"><span>${t('visit_fee')}</span><b>Rs ${rs(w.visit_fee)}</b></div>
          <div class="line"><span>${t('repair_cost')}</span><b>${t('quoted_on_site')}</b></div>
          <div class="note">${icon('shield', 17)}<span>${t('extra_needs_approval')}</span></div>
        </div>
        <h2 class="section" style="margin-top:4px">${t('pay_escrow_with')}</h2>
        <div class="methods">${['jazzcash', 'easypaisa'].map((p) => `<button type="button" class="method ${p === provider ? 'on' : ''}" data-p="${p}">${walletLogo(p)}${t(p)}</button>`).join('')}</div>
        <div class="escrow-note">${icon('lock', 20)}<span>${t('escrow_explainer', { n: rs(w.visit_fee) })}</span></div>
        <div class="field"><button class="btn">${t('confirm_and_pay')}</button></div>
      </form>
      ${tabs('bookings')}
    </div>`;
    app.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { provider = b.dataset.p; app.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b)); }));
    app.querySelectorAll('[data-addr]').forEach((b) => (b.onclick = () => { $('#bf').address.value = b.dataset.addr; app.querySelectorAll('[data-addr]').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#files').onchange = (ev) => {
      for (const file of ev.target.files) if (files.length < 5) files.push(file);
      $('#thumbs').innerHTML = files.map((file, i) => `<div class="thumb"><img src="${URL.createObjectURL(file)}" alt=""><button type="button" data-rm="${i}" aria-label="Remove">×</button></div>`).join('');
      $('#thumbs').querySelectorAll('[data-rm]').forEach((btn) => (btn.onclick = () => { files.splice(+btn.dataset.rm, 1); $('#files').dispatchEvent(new Event('change')); }));
      ev.target.value = '';
    };
    $('#bf').onsubmit = guard(async (ev) => {
      ev.preventDefault();
      const btn = ev.target.querySelector('button:not([type])');
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const f = Object.fromEntries(new FormData(ev.target));
        store.set('kw_address', f.address); store.set('kw_wallet', provider);
        const media_ids = [];
        for (let i = 0; i < files.length; i++) { btn.textContent = t('uploading', { i: i + 1, n: files.length }); media_ids.push(await uploadFile(files[i], 'booking')); }
        const r = await api('/api/bookings', { body: { worker_id: w.id, ...f, provider, media_ids } });
        location.href = r.payment.pay_url;
      } catch (err) { btn.disabled = false; btn.textContent = t('confirm_and_pay'); throw err; }
    });
  }
  const walletLogo = (p) => `<span class="wallet-logo ${p}">${p === 'jazzcash' ? 'JC' : 'ep'}</span>`;

  async function screenBooking(id, query) {
    const { booking: b } = await api(`/api/bookings/${id}`);
    if (query.payment) { toast(t(query.payment === 'success' ? 'payment_success' : 'payment_failed'), query.payment === 'success' ? 'ok' : 'err'); history.replaceState(null, '', `#/booking/${id}`); }
    const isWorker = S.me.role === 'worker';
    const es = b.escrow;
    const idx = FLOW.indexOf(b.status);
    const tl = FLOW.map((s, i) => {
      const done = b.history[s] && (i < idx || s === 'completed');
      const now = i === idx && s !== 'completed';
      const sub = b.history[s] ? (s === 'on_the_way' && now && b.eta_min ? t('eta', { n: b.eta_min }) : timeOf(b.history[s])) : '';
      return `<div class="tl ${done ? 'done' : ''} ${now && b.status !== 'requested' ? 'now' : ''} ${now && b.status === 'requested' ? 'done' : ''}">
        <span class="dotc">${done || (now && b.status === 'requested') ? icon('tick', 13, 'stroke-width="3"') : ''}</span>
        <div><div class="t">${t(`st_${s}`)}</div><div class="s">${sub}</div></div></div>`;
    }).join('');

    const other = isWorker ? b.customer : { name: b.worker.name, phone: b.worker.phone };
    const photos = b.photos.length ? `<div class="thumbs mt">${b.photos.map((m) => `<a href="${m.url}" target="_blank"><img src="${m.url}" alt="${t('photo')}"></a>`).join('')}</div>` : '';
    const paidVia = b.payments.find((p) => p.status === 'paid');
    const stateColor = { held: 'badge', disputed: 'badge amber', awaiting_payment: 'badge amber', released: 'badge navy', refunded: 'badge navy', split: 'badge navy' }[es.state];
    const ledgerLabel = { hold: S.lang === 'ur' ? 'رقم موصول' : 'Payment received', release: S.lang === 'ur' ? 'کاریگر کو جاری' : 'Released to worker', commission: S.lang === 'ur' ? 'کمیشن' : 'KaamWala commission', refund: S.lang === 'ur' ? 'واپسی' : 'Refund to customer' };

    let escrowActions = '';
    if (!isWorker) {
      if (es.state === 'awaiting_payment' && b.status !== 'cancelled') {
        escrowActions = `<div class="sub mt">${t('pay_now', { n: rs(b.visit_fee) })}</div><div class="methods" style="margin:8px 0 0">${['jazzcash', 'easypaisa'].map((p) => `<button class="method" data-pay="${p}">${walletLogo(p)}${t(p)}</button>`).join('')}</div>`;
      } else if (es.state === 'held' && b.status === 'completed') {
        escrowActions = `<button class="btn mt" id="release">${t('confirm_release', { n: rs(es.available) })}</button>
          <button class="btn danger" id="dispute">${t('raise_dispute')}</button>
          ${es.auto_release_at ? `<div class="sub mt">${t('auto_release', { when: when(es.auto_release_at) })}</div>` : ''}`;
      } else if (es.state === 'held' && b.status !== 'cancelled') {
        escrowActions = `<button class="link-btn" id="dispute">${t('raise_dispute')}</button>`;
      }
    } else if (es.state === 'awaiting_payment' && b.status !== 'cancelled') {
      escrowActions = `<div class="sub mt">${t('waiting_payment')}</div>`;
    } else if (es.state === 'held' && b.status === 'completed' && es.auto_release_at) {
      escrowActions = `<div class="sub mt">${t('waiting_confirm', { when: when(es.auto_release_at) })}</div>`;
    }
    const disputeNote = b.dispute ? `<div class="sub mt" style="color:var(--navy)">${b.dispute.status === 'open' ? t('dispute_open') : t('dispute_resolved', { x: e(b.dispute.resolution) })}</div>` : '';

    const pendingForMe = !isWorker && b.extras.filter((x) => x.status === 'pending');
    const addonAlert = pendingForMe && pendingForMe.length ? pendingForMe.map((x) => `
      <a class="card alert ${x.urgent_safety ? 'danger' : ''}" href="#/addon/${x.id}">
        <span class="alert-ic">${icon(x.urgent_safety ? 'alert' : 'plus', 20)}</span>
        <div style="flex:1"><div class="name">${t(x.urgent_safety ? 'addon_urgent_title' : 'addon_needs_you')}</div>
        <div class="sub">${e(x.work)} · Rs ${rs(x.amount)}</div></div><span>›</span></a>`).join('') : '';
    const extras = priceCard(b, isWorker);
    let workerActions = '';
    if (isWorker && b.status !== 'cancelled' && b.status !== 'completed' && es.state !== 'disputed') {
      const next = FLOW[idx + 1];
      const label = next === 'confirmed' ? t('accept') : t(`next_${next}`);
      workerActions = `<div class="field">
        ${next === 'on_the_way' ? `<label>${t('eta_min')}</label><input id="eta" type="number" value="15" min="1" style="margin-bottom:10px">` : ''}
        <button class="btn" id="next" ${next === 'confirmed' && es.state !== 'held' ? 'disabled' : ''}>${label}</button>
        ${['confirmed', 'on_the_way', 'in_progress'].includes(b.status) ? `<button class="btn ghost addon-btn" data-go="#/addon-new/${b.id}">${icon('plus', 18)} ${t('request_addon')}</button>` : ''}
        ${b.status === 'requested' ? `<button class="btn danger" id="cancel">${t('decline_booking')}</button>` : ''}</div>`;
    }
    const canCancel = !isWorker && ['requested', 'confirmed'].includes(b.status);
    const reviewBox = !isWorker && b.status === 'completed' ? (b.review
      ? `<div class="card"><h3>${t('your_review')}</h3><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button class="${n <= b.review.rating ? 'on' : ''}" disabled>${star(22)}</button>`).join('')}</div>${b.review.comment ? `<div class="sub">${e(b.review.comment)}</div>` : ''}</div>`
      : `<div class="card"><h3>${t('rate_job')}</h3><div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}">${star(26)}</button>`).join('')}</div>
         <div class="field" style="margin:0 0 10px"><input id="rc" placeholder="${t('comment_ph')}"></div><button class="btn sm" id="rv">${t('submit')}</button></div>`) : '';

    app.innerHTML = `<div class="screen">
      ${topbar(t('booking_n', { x: b.code }), '#/bookings')}
      ${addonAlert}
      <div class="card"><div class="row" style="align-items:flex-start">${avatar(isWorker ? b.customer.photo_url : b.worker.photo_url)}<div style="flex:1;min-width:0">
        <div class="name">${isWorker ? `${e(b.customer.name)}` : `${e(b.worker.name)} · ${catName(b.worker.category)}`}</div>
        <div class="sub">${e(b.date)} · ${e(b.slot)} ${b.slot.startsWith('11') ? 'am' : 'pm'}</div>
        ${isWorker ? `<div class="sub">${b.customer_hidden ? `${icon('lock', 12)} ${e(b.customer.area || '')} · ${t('details_after_accept')}` : e(b.address)}</div>` : ''}
        <div class="sub" style="color:var(--text)">${e(b.problem)}</div>
        <div class="chips-row">${stageBadge(b.stage)}</div>${photos}</div></div></div>
      ${b.status === 'cancelled' ? `<div class="card"><span class="badge red">${t('st_cancelled')}</span></div>` : `<div class="timeline">${tl}</div>`}
      <div class="actions2">${other.phone ? `<a class="btn" href="tel:${e(other.phone)}">${icon('phone', 17)} ${t('call')}</a>` : `<button class="btn" disabled>${icon('lock', 17)} ${t('call')}</button>`}<button class="btn" id="support">${icon('headset', 17)} ${t('support')}</button></div>
      ${workerActions}
      ${extras}
      <div class="card escrow-card">
        <div class="row" style="justify-content:space-between"><h3>${icon('lock', 15)} ${t('escrow')}</h3><span class="${stateColor}">${t(`es_${es.state}`)}</span></div>
        <div class="amount">Rs ${rs(es.held)}</div>
        <div class="sub">${paidVia ? t('paid_via', { x: t(paidVia.provider) }) : t('visit_fee') + ' Rs ' + rs(b.visit_fee)}${isWorker ? ` · ${t('commission_note', { p: Math.round(es.commission_rate * 100) })}` : ''}</div>
        ${escrowActions}${disputeNote}
        ${b.ledger.length ? `<div class="ledger">${b.ledger.map((l) => `<div><span>${ledgerLabel[l.type]}${l.payout_status === 'pending' ? ' ⋯' : ''}</span><span>Rs ${rs(l.amount)}</span></div>`).join('')}</div>` : ''}
      </div>
      ${reviewBox}
      <div class="field"><button class="btn ghost" data-go="#/chat/${b.id}">${icon('msg', 16)} ${t('messages')}</button>
      ${canCancel ? `<button class="link-btn" id="cancel">${t('cancel_booking')}</button>` : ''}
      ${b.blocked ? `<div class="sub center mt">${t('blocked_booking_note')}</div>` : `<button class="link-btn danger-txt" id="blockp">${t(isWorker ? 'block_customer' : 'block_worker')}</button>`}</div>
      ${tabs('bookings')}
    </div>`;

    const reload = () => render();
    app.querySelectorAll('[data-pay]').forEach((btn) => (btn.onclick = guard(async () => {
      const r = await api(`/api/bookings/${b.id}/pay`, { body: { provider: btn.dataset.pay } });
      location.href = r.payment.pay_url;
    })));
    $('#release') && ($('#release').onclick = guard(async () => { await api(`/api/bookings/${b.id}/release`, { body: {} }); reload(); }));
    $('#dispute') && ($('#dispute').onclick = () => sheet(t('raise_dispute'), `<div class="field"><textarea id="dr" placeholder="${t('dispute_reason')}"></textarea></div><div class="field"><button class="btn amber" id="ds">${t('submit')}</button></div>`, (el, close) => {
      el.querySelector('#ds').onclick = guard(async () => { await api(`/api/bookings/${b.id}/dispute`, { body: { reason: el.querySelector('#dr').value } }); close(); reload(); });
    }));
    $('#support').onclick = () => reportSheet({ booking_id: b.id, worker_id: b.worker_id });
    $('#blockp') && ($('#blockp').onclick = () => blockSheet(isWorker ? { user_id: b.customer.id, booking_id: b.id } : { worker_id: b.worker_id, booking_id: b.id }, reload));
    $('#cancel') && ($('#cancel').onclick = guard(async () => { await api(`/api/bookings/${b.id}/cancel`, { body: {} }); reload(); }));
    $('#next') && ($('#next').onclick = guard(async () => {
      await api(`/api/bookings/${b.id}/status`, { body: { status: FLOW[idx + 1], eta_min: $('#eta')?.value } }); reload();
    }));
    let rating = 0;
    app.querySelectorAll('[data-star]').forEach((btn) => (btn.onclick = () => { rating = +btn.dataset.star; app.querySelectorAll('[data-star]').forEach((x) => x.classList.toggle('on', +x.dataset.star <= rating)); }));
    $('#rv') && ($('#rv').onclick = guard(async () => { await api(`/api/bookings/${b.id}/review`, { body: { rating, comment: $('#rc').value } }); toast(t('thanks_review'), 'ok'); reload(); }));
  }

  const BOOKING_TABS = {
    customer: { upcoming: ['pending', 'accepted', 'on_the_way', 'in_progress', 'awaiting_approval', 'disputed'], completed: ['completed'], cancelled: ['cancelled'] },
    worker: { new: ['pending'], upcoming: ['accepted'], ongoing: ['on_the_way', 'in_progress', 'awaiting_approval', 'disputed'], completed: ['completed'], cancelled: ['cancelled'] },
  };
  async function screenBookings(query) {
    const { bookings } = await api('/api/bookings');
    const groups = BOOKING_TABS[S.me.role] || BOOKING_TABS.customer;
    const tab = groups[query.tab] ? query.tab : Object.keys(groups)[0];
    const shown = bookings.filter((b) => groups[tab].includes(b.stage));
    app.innerHTML = `<div class="screen">
      <div class="topbar">${t(S.me.role === 'worker' ? 'my_jobs' : 'my_bookings')}</div>
      <div class="chips">${Object.keys(groups).map((k) => { const n = bookings.filter((b) => groups[k].includes(b.stage)).length; return `<button class="chip ${k === tab ? 'on' : ''}" data-go="#/bookings?tab=${k}">${t(`tab_${k}`)}${n ? ` · ${n}` : ''}</button>`; }).join('')}</div>
      ${shown.map(bookingCard).join('') || `<div class="empty">${t(`empty_${tab}`)}</div>`}
      ${tabs('bookings')}
    </div>`;
  }
  const bookingCard = (b) => `
    <a class="card list-item" href="#/booking/${b.id}" style="color:inherit;text-decoration:none">
      <div><div class="name">#${e(b.code)} · ${S.me.role === 'worker' ? e(b.customer_name) : e(b.worker_name)}</div>
      <div class="sub">${catName(b.category)} · ${e(b.date)} · ${e(b.slot)}</div>
      ${stageBadge(b.stage)}
      <span class="badge ${b.escrow_state === 'awaiting_payment' || b.escrow_state === 'disputed' ? 'amber' : 'navy'}">${icon('lock', 11)} ${t(`es_${b.escrow_state}`)}</span></div>
      <span style="color:var(--muted)">›</span>
    </a>`;

  async function screenMessages() {
    const { conversations } = await api('/api/conversations');
    app.innerHTML = `<div class="screen">
      <div class="topbar">${t('messages')}</div>
      ${conversations.map((c) => `<a class="card list-item" href="#/chat/${c.id}" style="color:inherit;text-decoration:none">
        <div class="row"><span class="avatar">${icon('user', 20)}</span><div><div class="name">${e(S.me.role === 'worker' ? c.customer_name : c.worker_name)}</div>
        <div class="sub">#${e(c.code)} · ${e(c.last || t(`st_${c.status}`))}</div></div></div><span style="color:var(--muted)">›</span></a>`).join('') || `<div class="empty">${t('no_messages')}</div>`}
      ${tabs('messages')}
    </div>`;
  }

  async function screenChat(id) {
    const [{ messages }, { booking: b }] = await Promise.all([api(`/api/bookings/${id}/messages`), api(`/api/bookings/${id}`)]);
    const title = S.me.role === 'worker' ? b.customer.name : b.worker.name;
    app.innerHTML = `<div class="screen" style="padding-bottom:140px">
      ${topbar(`${e(title)} · #${e(b.code)}`)}
      <div class="chat" id="chat">${messages.map((m) => `<div class="bubble ${m.sender_id === S.me.id ? 'me' : ''}">${e(m.body)}<div class="time">${timeOf(m.created_at)}</div></div>`).join('')}</div>
      <form class="composer" id="cf"><input name="body" placeholder="${t('type_message')}" autocomplete="off"><button class="btn sm">${t('send')}</button></form>
      ${tabs('messages')}
    </div>`;
    window.scrollTo(0, document.body.scrollHeight);
    $('#cf').onsubmit = guard(async (ev) => {
      ev.preventDefault();
      const body = new FormData(ev.target).get('body').trim();
      if (!body) return;
      await api(`/api/bookings/${id}/messages`, { body: { body } });
      render();
    });
  }

  const screenProfile = () => (S.me.role === 'worker' ? screenWorkerProfile() : screenCustomerProfile());

  async function screenWorkerHome() {
    const [{ bookings }, earn, { unread }] = await Promise.all([api('/api/bookings'), api('/api/worker/earnings'), api('/api/notifications')]);
    const w = S.worker;
    const fresh = bookings.filter((b) => b.stage === 'pending');
    const active = bookings.filter((b) => BOOKING_TABS.worker.upcoming.concat(BOOKING_TABS.worker.ongoing).includes(b.stage));
    app.innerHTML = `<div class="screen">
      <div class="hero">
        <div class="hero-top">${brand()}<span class="spacer"></span>${langToggle()}${bell(unread)}</div>
        <div class="row mt">${avatar(w.photo_url, 22, 'on-dark')}
          <div style="flex:1;min-width:0"><div class="name">${e(S.me.name)} ${w.id_verified ? `<span style="color:var(--teal);display:inline-flex">${icon('check', 17)}</span>` : ''}</div>
          <div class="sub" style="color:rgba(255,255,255,.7)">${catName(w.category)} · ${e(w.areas)}</div></div></div>
        <div class="stat-row four">
          <div class="stat"><div class="v">Rs ${rs(earn.in_escrow)}</div><div class="l">${t('in_escrow')}</div></div>
          <div class="stat"><div class="v">Rs ${rs(earn.this_month)}</div><div class="l">${t('released_month')}</div></div>
          <div class="stat"><div class="v">${earn.completed_jobs}</div><div class="l">${t('completed_jobs')}</div></div>
          <div class="stat"><div class="v">${star(13)} ${w.rating ?? '–'}</div><div class="l">${t('n_reviews', { n: w.review_count })}</div></div>
        </div>
      </div>
      ${w.verification !== 'verified' ? `<a class="card alert ${w.verification === 'rejected' ? 'danger' : ''}" href="#/documents"><span class="alert-ic">${icon('doc', 20)}</span>
        <div style="flex:1"><div class="name">${t(`ver_banner_${w.verification}`)}</div><div class="sub">${t(`ver_help_${w.verification}`)}</div></div><span>›</span></a>` : ''}
      <div class="card avail"><label class="switch-row"><span><b>${t('available_new')}</b><span class="sub">${hoursText(w)}</span></span>
        <input type="checkbox" id="avail" class="sw" ${w.available ? 'checked' : ''}></label>
        <button class="link-btn inline" data-go="#/worker-edit">${t('edit_hours_prices')}</button></div>
      <h2 class="section">${t('new_requests')}${fresh.length ? ` · ${fresh.length}` : ''}</h2>
      ${fresh.map((b) => `<div class="card req">
        <a class="list-item" href="#/booking/${b.id}"><div><div class="name">#${e(b.code)} · ${e(b.customer_name)}</div>
          <div class="sub">${e(b.date)} · ${e(b.slot)} · Rs ${rs(b.visit_fee)}</div><div class="sub" style="color:var(--text)">${e(b.problem)}</div></div><span class="chev">›</span></a>
        ${b.escrow_state === 'held' ? `<div class="two mt"><button class="btn danger sm-full" data-decline="${b.id}">${t('decline')}</button><button class="btn sm-full" data-accept="${b.id}">${t('accept')}</button></div>`
          : `<div class="sub mt">${icon('clock', 13)} ${t('waiting_payment')}</div>`}
      </div>`).join('') || `<div class="empty small">${t('no_new_requests')}</div>`}
      <h2 class="section">${t('upcoming_ongoing')} <a href="#/bookings?tab=upcoming">${t('see_all')}</a></h2>
      ${active.map(bookingCard).join('') || `<div class="empty small">${t('no_active_jobs')}</div>`}
      <div class="card earn"><h3>${icon('card', 15)} ${t('earnings_payouts')}</h3>
        <div class="cmp mt"><span>${t('in_escrow')}</span><b>Rs ${rs(earn.in_escrow)}</b></div>
        <div class="cmp"><span>${t('payout_pending')}</span><b>Rs ${rs(earn.payout_pending)}</b></div>
        <div class="cmp"><span>${t('payout_sent')}</span><b>Rs ${rs(earn.payout_sent)}</b></div>
        <div class="sub">${t('commission_note', { p: Math.round(earn.commission_rate * 100) })} · ${t('payout_to', { x: t(w.payout_provider || 'jazzcash') })}</div></div>
      <div class="menu">
        <a class="menu-item" href="#/bookings?tab=completed">${icon('star', 20)}<span>${t('completed_reviews')}</span><span class="chev">›</span></a>
        <button class="menu-item" id="disp">${icon('headset', 20)}<span>${t('disputes_support')}</span><span class="chev">›</span></button>
      </div>
      ${tabs('home')}
    </div>`;
    $('#avail').onchange = guard(async (ev) => {
      await api('/api/worker', { method: 'PATCH', body: { available: ev.target.checked } });
      S.worker.available = ev.target.checked ? 1 : 0;
      toast(t(ev.target.checked ? 'now_available' : 'now_unavailable'), 'ok');
    });
    app.querySelectorAll('[data-accept]').forEach((b) => (b.onclick = guard(async () => { await api(`/api/bookings/${b.dataset.accept}/status`, { body: { status: 'confirmed' } }); toast(t('accepted_toast'), 'ok'); render(); })));
    app.querySelectorAll('[data-decline]').forEach((b) => (b.onclick = guard(async () => { await api(`/api/bookings/${b.dataset.decline}/cancel`, { body: {} }); render(); })));
    $('#disp').onclick = () => reportSheet({});
  }

  // ---------- add-on service requests ----------
  const bell = (n) => `<button class="icon-btn" data-go="#/notifications" aria-label="Notifications">${icon('bell', 22)}${n ? `<span class="bell-n">${n}</span>` : ''}</button>`;
  const ADDON_BADGE = { pending: 'amber', approved: '', rejected: 'red', cancelled: 'navy', disputed: 'amber' };
  const PAY_BADGE = { unpaid: 'amber', paid: '', refunded: 'navy', partly_refunded: 'navy' };
  const addonBadge = (x, isWorker) => `<span class="badge ${ADDON_BADGE[x.status]}">${t(x.status === 'pending' ? (isWorker ? 'pending_customer' : 'addon_needs_you_short') : `ad_${x.status}`)}</span>`;
  const payBadge = (st) => `<span class="badge ${PAY_BADGE[st]}">${t(`pay_${st}`)}</span>`;
  const counts = (x) => ['approved', 'disputed'].includes(x.status);

  function priceCard(b, isWorker) {
    const p = b.price;
    const rows = b.extras.map((x) => `
      <a class="price-line link" href="#/addon/${x.id}">
        <div style="flex:1;min-width:0"><div class="pl-title ${counts(x) || x.status === 'pending' ? '' : 'struck'}">${icon('plus', 14)} ${e(x.work)}</div>
          <div class="chips-row">${addonBadge(x, isWorker)}${counts(x) ? payBadge(x.pay_status) : ''}${x.urgent_safety ? `<span class="badge red">${t('safety')}</span>` : ''}</div></div>
        <div class="pl-amt ${counts(x) ? '' : 'muted'}">${counts(x) ? '' : x.status === 'pending' ? '+' : ''}Rs ${rs(counts(x) || x.status === 'pending' ? x.amount : 0)}</div>
      </a>`).join('');
    return `<div class="card">
      <div class="row" style="justify-content:space-between"><h3>${icon('receipt', 15)} ${t('price_breakdown')}</h3>
        <button class="btn sm ghost" data-go="#/invoice/${b.id}">${t(b.status === 'completed' ? 'view_invoice' : 'details')}</button></div>
      <div class="price-line"><div style="flex:1"><div class="pl-title">${t('original_service')}</div><div class="chips-row">${payBadge(p.original.pay_status)}</div></div><div class="pl-amt">Rs ${rs(p.original.amount)}</div></div>
      ${rows}
      <div class="price-total"><span>${t('approved_total')}</span><span>Rs ${rs(p.approved_total)}</span></div>
      ${p.unpaid > 0 && b.status !== 'cancelled' ? `<div class="sub" style="color:#9a5b00">${t('unpaid_amount', { n: rs(p.unpaid) })}</div>` : ''}
    </div>`;
  }

  async function screenAddonNew(bookingId) {
    const { booking: b } = await api(`/api/bookings/${bookingId}`);
    const key = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random();
    const files = [];
    const rules = b.addon_rules;
    app.innerHTML = `<div class="screen">
      ${topbar(t('request_addon'), `#/booking/${b.id}`)}
      <div class="card info"><div class="row" style="align-items:flex-start">${icon('shield', 20)}<div class="sub" style="margin:0;color:var(--navy)">${t('addon_rule_worker')}</div></div></div>
      <div class="card" style="padding:12px 14px"><div class="sub" style="margin:0">${t('booking_n', { x: b.code })} · ${e(b.customer.name)}</div><div style="font-weight:700;margin-top:3px">${e(b.problem)}</div></div>
      <form id="af" novalidate>
        <div class="field"><label>${t('addon_problem')}</label><textarea name="problem" required minlength="5" placeholder="${t('addon_problem_ph')}"></textarea></div>
        <div class="field"><label>${t('addon_work')}</label><textarea name="work" required minlength="5" placeholder="${t('addon_work_ph')}"></textarea></div>
        <div class="field"><div class="two">
          <div><label>${t('labour')} (Rs)</label><input name="labour" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></div>
          <div><label>${t('materials')} (Rs)</label><input name="materials" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></div></div></div>
        <div class="field"><label>${t('extra_time')}</label><select name="est_minutes">${[15, 30, 45, 60, 90, 120, 180, 240].map((m) => `<option value="${m}" ${m === 45 ? 'selected' : ''}>${m < 60 ? `${m} min` : `${m / 60} ${S.lang === 'ur' ? 'گھنٹے' : m === 60 ? 'hour' : 'hours'}`}</option>`).join('')}</select></div>
        <div class="field"><label>${t('photos')}</label>
          <label class="upload">${icon('camera', 22)}<span>${t('add_photos')}</span><input id="files" type="file" accept="image/*,video/*" capture="environment" multiple hidden></label>
          <div class="thumbs" id="thumbs"></div></div>
        <div class="field"><label class="toggle"><input type="checkbox" name="urgent_safety" id="urgent"> <span>${t('urgent_label')}</span></label>
          <div id="riskbox" hidden><textarea name="safety_risk" placeholder="${t('risk_ph')}"></textarea><div class="sub">${t('emergency_policy')}</div></div></div>
        <div class="card summary" id="sum"></div>
        <div class="field"><button class="btn" id="send">${t('send_to_customer')}</button></div>
      </form>
      ${tabs('bookings')}
    </div>`;
    const f = $('#af');
    const summary = () => {
      const labour = Math.max(0, Math.floor(+f.labour.value || 0));
      const materials = Math.max(0, Math.floor(+f.materials.value || 0));
      const amt = labour + materials;
      const revised = b.price.approved_total + amt;
      const pct = Math.round(((revised - b.visit_fee) / b.visit_fee) * 100);
      const over = pct > rules.warn_percent || revised - b.visit_fee > rules.warn_amount;
      $('#sum').innerHTML = `
        <div class="cmp"><span>${t('current_total')}</span><b>Rs ${rs(b.price.approved_total)}</b></div>
        <div class="cmp"><span>${t('this_addon')} (${t('labour').toLowerCase()} + ${t('materials').toLowerCase()})</span><b>+ Rs ${rs(amt)}</b></div>
        <div class="cmp total"><span>${t('new_total_if')}</span><b>Rs ${rs(revised)}</b></div>
        ${over && amt ? `<div class="warn">${icon('alert', 16)} ${t('worker_over_warn', { p: pct })}</div>` : ''}`;
    };
    f.addEventListener('input', summary); summary();
    f.urgent.onchange = () => { $('#riskbox').hidden = !f.urgent.checked; };
    $('#files').onchange = (ev) => {
      for (const file of ev.target.files) if (files.length < 5) files.push(file);
      $('#thumbs').innerHTML = files.map((file, i) => `<div class="thumb">${file.type.startsWith('video') ? `<video src="${URL.createObjectURL(file)}" muted></video>` : `<img src="${URL.createObjectURL(file)}" alt="">`}<button type="button" data-rm="${i}" aria-label="Remove">×</button></div>`).join('');
      $('#thumbs').querySelectorAll('[data-rm]').forEach((btn) => (btn.onclick = () => { files.splice(+btn.dataset.rm, 1); $('#files').dispatchEvent(new Event('change')); }));
      ev.target.value = '';
    };
    f.onsubmit = guard(async (ev) => {
      ev.preventDefault();
      const btn = $('#send');
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const media_ids = [];
        for (let i = 0; i < files.length; i++) {
          btn.textContent = t('uploading', { i: i + 1, n: files.length });
          const res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': files[i].type, Authorization: `Bearer ${S.token}` }, body: files[i] });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error);
          media_ids.push(d.id);
        }
        btn.textContent = t('sending');
        const body = Object.fromEntries(new FormData(f));
        body.urgent_safety = f.urgent.checked;
        const r = await api(`/api/bookings/${b.id}/addons`, { body: { ...body, media_ids, client_key: key } });
        toast(t('addon_sent'), 'ok');
        location.hash = `#/addon/${r.addon.id}`;
      } catch (err) {
        btn.disabled = false; btn.textContent = t('send_to_customer');
        throw err;
      }
    });
  }

  async function screenAddon(id, query) {
    const d = await api(`/api/addons/${id}`);
    if (query.payment) { toast(t(query.payment === 'success' ? 'payment_success' : 'payment_failed'), query.payment === 'success' ? 'ok' : 'err'); history.replaceState(null, '', `#/addon/${id}`); }
    const x = d.addon, c = d.comparison, isWorker = S.me.role === 'worker';
    const pending = x.status === 'pending';
    const already = c.current - c.original;
    let provider = store.get('kw_wallet') || 'jazzcash';
    const walletPick = `<div class="methods" style="margin:0 0 10px">${['jazzcash', 'easypaisa'].map((p) => `<button type="button" class="method ${p === provider ? 'on' : ''}" data-p="${p}">${walletLogo(p)}${t(p)}</button>`).join('')}</div>`;
    let actions = '';
    if (!isWorker && pending) {
      actions = `<div class="card"><h3>${t('your_decision')}</h3><div class="sub" style="margin:4px 0 12px">${t('decision_help')}</div>
        <div class="sub" style="margin-bottom:6px">${t('pay_escrow_with')}</div>${walletPick}
        <button class="btn" id="approve">${icon('tick', 16)} ${t('approve_pay', { n: rs(x.amount) })}</button>
        <button class="btn ghost" id="askq">${icon('help', 16)} ${t('ask_clarification')}</button>
        <button class="btn danger" id="reject">${t('reject_addon')}</button>
        <div class="sub mt">${t('approve_note')}</div></div>`;
    } else if (!isWorker && x.status === 'approved' && x.pay_status === 'unpaid') {
      actions = `<div class="card"><h3>${t('pay_approved')}</h3><div class="sub" style="margin:4px 0 12px">${t('pay_approved_help')}</div>${walletPick}
        <button class="btn" id="pay">${t('pay_now', { n: rs(x.amount) })}</button></div>`;
    } else if (!isWorker && x.status === 'approved') {
      actions = `<div class="field"><button class="btn danger" id="disp">${t('report_charge')}</button></div>`;
    } else if (isWorker && (pending || (x.status === 'approved' && x.pay_status === 'unpaid'))) {
      actions = `<div class="field"><button class="btn danger" id="withdraw">${t('withdraw')}</button><div class="sub mt">${t(pending ? 'worker_wait' : 'worker_wait_pay')}</div></div>`;
    }
    const media = x.media.length ? `<div class="thumbs mt">${x.media.map((m) => m.mime.startsWith('video')
      ? `<video src="${m.url}" controls preload="metadata"></video>` : `<a href="${m.url}" target="_blank"><img src="${m.url}" alt="${t('photo')}"></a>`).join('')}</div>` : `<div class="sub mt">${t('no_photos')}</div>`;
    const decided = x.decided_at ? `<div class="sub">${t(`ad_${x.status}`)} · ${when(x.decided_at)}${x.reject_reason ? ` · “${e(x.reject_reason)}”` : ''}</div>` : '';
    app.innerHTML = `<div class="screen">
      ${topbar(t('addon_title'), `#/booking/${d.booking.id}`)}
      ${x.urgent_safety ? `<div class="card alert danger static"><span class="alert-ic">${icon('alert', 20)}</span><div><div class="name">${t('safety_reported')}</div>
        <div class="sub" style="color:var(--text)">${e(x.safety_risk)}</div><div class="sub mt">${t('emergency_policy')}</div></div></div>` : ''}
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="sub" style="margin:0">${t('booking_n', { x: d.booking.code })} · ${e(d.worker.name)}</div>
          <div class="name" style="margin-top:4px">${e(x.work)}</div></div>${addonBadge(x, isWorker)}</div>
        ${decided}
        <div class="kv mt"><div class="lbl">${t('addon_problem')}</div><div>${e(x.problem)}</div>
        <div class="lbl" style="margin-top:8px">${t('extra_time')}</div><div>${x.est_minutes ? `${x.est_minutes} min` : '—'}</div></div>
        ${media}
      </div>
      <div class="card">
        <h3>${t('price_compare')}</h3>
        <div class="cmp mt"><span>${t('original_booking')}</span><b>Rs ${rs(c.original)}</b></div>
        ${already > 0 ? `<div class="cmp"><span>${t('approved_addons_before')}</span><b>Rs ${rs(already)}</b></div>` : ''}
        <div class="cmp"><span>${e(x.work)} · ${t('labour').toLowerCase()}</span><b>Rs ${rs(x.labour)}</b></div>
        <div class="cmp"><span>${t('materials')}</span><b>Rs ${rs(x.materials)}</b></div>
        <div class="cmp total"><span>${pending ? t('new_total_if') : t('approved_total')}</span><b>Rs ${rs(c.revised)}</b></div>
        ${pending ? `<div class="sub">${t('increase', { n: rs(c.revised - c.current), p: Math.round(((c.revised - c.current) / c.current) * 100) })}</div>` : ''}
        ${counts(x) ? `<div class="chips-row mt">${payBadge(x.pay_status)}</div>` : ''}
        ${x.status === 'rejected' || x.status === 'cancelled' ? `<div class="sub mt">${t('not_charged')}</div>` : ''}
      </div>
      ${pending && c.over ? `<div class="card warn-card">${icon('alert', 20)}<div>${t('over_warn', { p: c.increase_percent, wp: c.warn_percent, wa: rs(c.warn_amount) })}</div></div>` : ''}
      ${actions}
      <div class="card" id="qa"><h3>${t('questions')}</h3>
        <div class="chat" style="padding:0;margin-top:10px">${x.messages.map((m) => `<div class="bubble ${m.sender_id === S.me.id ? 'me' : ''}">${e(m.body)}<div class="time">${e(m.name)} · ${timeOf(m.created_at)}</div></div>`).join('') || `<div class="sub">${t('no_questions')}</div>`}</div>
        <form id="qf" class="row mt"><input name="body" placeholder="${t(isWorker ? 'reply_ph' : 'question_ph')}" style="flex:1;border:1px solid var(--line);border-radius:999px;padding:10px 14px"><button class="btn sm">${t('send')}</button></form>
      </div>
      ${tabs('bookings')}
    </div>`;
    const reload = () => render();
    app.querySelectorAll('[data-p]').forEach((btn) => (btn.onclick = () => { provider = btn.dataset.p; store.set('kw_wallet', provider); app.querySelectorAll('[data-p]').forEach((y) => y.classList.toggle('on', y === btn)); }));
    const busy = (btn, fn) => guard(async () => { if (btn.disabled) return; btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } });
    $('#approve') && ($('#approve').onclick = busy($('#approve'), async () => {
      const r = await api(`/api/addons/${x.id}/approve`, { body: { provider } });
      toast(t('approved_toast'), 'ok');
      location.href = r.payment.pay_url;
    }));
    $('#pay') && ($('#pay').onclick = busy($('#pay'), async () => { const r = await api(`/api/addons/${x.id}/pay`, { body: { provider } }); location.href = r.payment.pay_url; }));
    $('#reject') && ($('#reject').onclick = () => sheet(t('reject_addon'), `<div class="sub" style="margin:0 16px 10px">${t('reject_help')}</div><div class="field"><textarea id="rr" placeholder="${t('reject_reason_ph')}"></textarea></div><div class="field"><button class="btn danger" id="rs">${t('reject_addon')}</button></div>`, (el, close) => {
      el.querySelector('#rs').onclick = busy(el.querySelector('#rs'), async () => { await api(`/api/addons/${x.id}/reject`, { body: { reason: el.querySelector('#rr').value } }); close(); toast(t('rejected_toast'), 'ok'); reload(); });
    }));
    $('#askq') && ($('#askq').onclick = () => { $('#qa').scrollIntoView({ behavior: 'smooth' }); $('#qf input').focus(); });
    $('#withdraw') && ($('#withdraw').onclick = busy($('#withdraw'), async () => { await api(`/api/addons/${x.id}/cancel`, { body: {} }); reload(); }));
    $('#disp') && ($('#disp').onclick = () => disputeAddonSheet(x));
    $('#qf').onsubmit = guard(async (ev) => {
      ev.preventDefault();
      const body = new FormData(ev.target).get('body').trim();
      if (!body) return;
      await api(`/api/addons/${x.id}/messages`, { body: { body } });
      reload();
    });
  }

  function disputeAddonSheet(x, extras) {
    const pick = extras ? `<div class="field"><label>${t('which_charge')}</label><select id="dx">${extras.map((y) => `<option value="${y.id}">${e(y.work)} · Rs ${rs(y.amount)}</option>`).join('')}</select></div>` : '';
    sheet(t('report_charge'), `<div class="sub" style="margin:0 16px 10px">${t('report_charge_help')}</div>${pick}<div class="field"><textarea id="dr" placeholder="${t('dispute_reason')}"></textarea></div><div class="field"><button class="btn amber" id="ds">${t('submit')}</button></div>`, (el, close) => {
      el.querySelector('#ds').onclick = guard(async () => {
        const id = extras ? el.querySelector('#dx').value : x.id;
        const r = await api(`/api/addons/${id}/dispute`, { body: { reason: el.querySelector('#dr').value } });
        close(); toast(t(r.reported ? 'report_sent' : 'dispute_open'), 'ok'); render();
      });
    });
  }

  const EVENT_LABEL = {
    booking_created: 'ev_booking_created', addon_requested: 'ev_addon_requested', addon_approved: 'ev_addon_approved', addon_rejected: 'ev_addon_rejected',
    addon_cancelled: 'ev_addon_cancelled', addon_paid: 'ev_addon_paid', addon_refunded: 'ev_addon_refunded', addon_disputed: 'ev_addon_disputed',
    addon_reported: 'ev_addon_reported', clarification_asked: 'ev_clarification_asked', clarification_answered: 'ev_clarification_answered',
  };

  async function screenInvoice(id) {
    const { booking: b } = await api(`/api/bookings/${id}`);
    const p = b.price, isWorker = S.me.role === 'worker';
    const charged = b.extras.filter(counts);
    const notCharged = b.extras.filter((x) => !counts(x));
    app.innerHTML = `<div class="screen invoice">
      ${topbar(t(b.status === 'completed' ? 'invoice' : 'price_breakdown'), `#/booking/${b.id}`)}
      <div class="card">
        <div class="row" style="justify-content:space-between"><div class="logo" style="font-size:17px;color:var(--navy)"><span class="logo-mark" style="width:28px;height:28px;color:#fff">${icon('shield', 16)}</span><span>Kaam<b>Wala</b></span></div>
          <div style="text-align:end"><div class="name" style="justify-content:flex-end">#${e(b.code)}</div><div class="sub">${e(b.date)}</div></div></div>
        <div class="kv mt"><div><span class="lbl">${t('customer')}:</span> ${e(b.customer.name)}</div><div><span class="lbl">${t('worker')}:</span> ${e(b.worker.name)} · ${catName(b.worker.category)}</div><div><span class="lbl">${t('address')}:</span> ${e(b.address)}</div></div>
      </div>
      <div class="card">
        <div class="inv-head"><span>${t('item')}</span><span>${t('amount_col')}</span></div>
        <div class="inv-row"><div><div class="pl-title">${t('original_service')}</div><div class="sub">${e(b.problem)}</div><div class="chips-row">${payBadge(p.original.pay_status)}</div></div><b>Rs ${rs(p.original.amount)}</b></div>
        ${charged.map((x) => `<div class="inv-row"><div><div class="pl-title">${t('addon')}: ${e(x.work)}</div>
          <div class="sub">${t('labour')} Rs ${rs(x.labour)} · ${t('materials')} Rs ${rs(x.materials)}</div>
          <div class="sub">${t('approved_by_you_at', { when: x.decided_at ? when(x.decided_at) : '—' })}</div>
          <div class="chips-row">${addonBadge(x, isWorker)}${payBadge(x.pay_status)}${x.refunded_amount ? `<span class="badge navy">${t('refunded_n', { n: rs(x.refunded_amount) })}</span>` : ''}</div></div><b>Rs ${rs(x.amount)}</b></div>`).join('')}
        ${notCharged.length ? `<div class="inv-sub">${t('not_charged_items')}</div>${notCharged.map((x) => `<div class="inv-row muted"><div><div class="pl-title struck">${e(x.work)}</div><div class="chips-row">${addonBadge(x, isWorker)}</div></div><span>Rs 0</span></div>`).join('')}` : ''}
        <div class="inv-tot"><span>${t('addon_labour')}</span><span>Rs ${rs(p.labour_total)}</span></div>
        <div class="inv-tot"><span>${t('addon_materials')}</span><span>Rs ${rs(p.materials_total)}</span></div>
        <div class="inv-tot grand"><span>${t('final_total')}</span><span>Rs ${rs(p.approved_total)}</span></div>
        <div class="inv-tot"><span>${t('paid_escrow')}</span><span>Rs ${rs(p.paid)}</span></div>
        ${p.refunded ? `<div class="inv-tot"><span>${t('refunded')}</span><span>− Rs ${rs(p.refunded)}</span></div>` : ''}
        ${p.unpaid > 0 ? `<div class="inv-tot" style="color:#9a5b00"><span>${t('unpaid')}</span><span>Rs ${rs(p.unpaid)}</span></div>` : ''}
        <div class="sub mt">${t('escrow')}: ${t(`es_${b.escrow.state}`)}</div>
      </div>
      <div class="card"><h3>${t('price_history')}</h3><div class="history">${b.price_events.map((ev) => `
        <div class="h-row"><div><div>${t(EVENT_LABEL[ev.event] || ev.event)}${ev.amount != null ? ` · Rs ${rs(ev.amount)}` : ''}</div><div class="sub">${when(ev.created_at)}${ev.note && !ev.event.startsWith('clarification') ? ` · ${e(ev.note)}` : ''}</div></div>
        <div class="h-tot">Rs ${rs(ev.approved_total)}</div></div>`).join('')}</div><div class="sub mt">${t('history_note')}</div></div>
      <div class="field no-print">
        ${!isWorker && charged.some((x) => x.status === 'approved') ? `<button class="btn danger" id="rep">${t('report_unauthorized')}</button>` : ''}
        <button class="btn ghost" onclick="window.print()">${t('print')}</button></div>
      ${tabs('bookings')}
    </div>`;
    $('#rep') && ($('#rep').onclick = () => disputeAddonSheet(null, charged.filter((x) => x.status === 'approved')));
  }

  async function screenNotifications() {
    const { notifications } = await api('/api/notifications');
    api('/api/notifications/read', { body: {} }).catch(() => {});
    app.innerHTML = `<div class="screen">
      ${topbar(t('notifications'), '#/home')}
      ${notifications.map((n) => `<a class="card list-item ${n.read_at ? '' : 'unread'}" href="${n.extra_id ? `#/addon/${n.extra_id}` : n.booking_id ? `#/booking/${n.booking_id}` : '#/profile'}" style="color:inherit;text-decoration:none">
        <div class="row" style="align-items:flex-start"><span class="alert-ic ${n.kind === 'addon_urgent' ? 'red' : ''}">${icon(n.kind === 'addon_urgent' ? 'alert' : n.kind.startsWith('addon') ? 'plus' : n.kind === 'verification' ? 'shield' : n.kind.startsWith('booking') ? 'cal' : 'bell', 18)}</span>
        <div><div style="font-size:13.5px">${e(n.body)}</div><div class="sub">${when(n.created_at)}</div></div></div></a>`).join('') || `<div class="empty">${t('no_notifications')}</div>`}
      ${tabs('home')}
    </div>`;
  }

  // ---------- accounts: welcome, login, registration ----------
  const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Gujranwala', 'Sialkot', 'Quetta'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const brand = () => `<div class="logo"><span class="logo-mark">${icon('shield', 20)}</span><span>Kaam<b>Wala</b></span></div>`;
  const avatar = (url, size = 22, cls = '') => `<span class="avatar ${cls}">${url ? `<img src="${e(url)}" alt="">` : icon('user', size)}</span>`;
  // Typed as "300 1234567" after a fixed +92; also accepts 0300… or 92300… pasted in.
  const fullPhone = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.startsWith('0') || d.startsWith('92') ? d : '0' + d; };
  const phoneInput = (name, value = '') => `<div class="phone-in"><span dir="ltr">+92</span><input name="${name}" dir="ltr" inputmode="tel" autocomplete="tel" placeholder="300 1234567" value="${e(value)}" required></div>`;
  const pwInput = (name, auto = 'new-password', ph = '') => `<div class="pw-in"><input name="${name}" type="password" autocomplete="${auto}" placeholder="${e(ph)}" required><button type="button" data-showpw aria-label="${t('show')}">${t('show')}</button></div>`;
  const pwProblem = (p) => (p.length < 8 ? t('pw_rule_len') : !/[A-Za-z]/.test(p) || !/\d/.test(p) ? t('pw_rule_mix') : '');
  const STAGE_BADGE = { pending: 'amber', accepted: '', on_the_way: '', in_progress: '', awaiting_approval: 'amber', completed: 'navy', cancelled: 'red', disputed: 'amber' };
  const stageBadge = (st) => `<span class="badge ${STAGE_BADGE[st] ?? ''}">${t(`sg_${st}`)}</span>`;
  const VER = { verified: ['', 'check'], pending: ['amber', 'clock'], unsubmitted: ['amber', 'clock'], rejected: ['red', 'x'] };
  const verBadge = (v) => `<span class="badge ${VER[v][0]}">${icon(VER[v][1], 13)} ${t(`ver_${v}`)}</span>`;
  const hoursText = (w) => `${(w.work_days || []).map((d) => t(`day_${d}`)).join(', ')} · ${w.hours_from}–${w.hours_to}`;

  async function uploadFile(file, purpose) {
    const res = await fetch(`/api/uploads?purpose=${purpose}`, { method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${S.token}` }, body: file });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Upload failed');
    return d.id;
  }
  // Private documents need the login token, so they are fetched and opened as a local blob.
  async function viewDoc(url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${S.token}` } });
    if (!res.ok) throw new Error(t('not_found'));
    window.open(URL.createObjectURL(await res.blob()), '_blank');
  }
  function enter(r) {
    S.token = r.token; store.set('kw_token', r.token); S.me = null;
    if (r.user.role === 'admin') { location.href = '/admin.html'; return; }
    if (location.hash === '#/home') render(); else location.hash = '#/home';
  }
  const photoPicker = (url, label) => `<label class="photo-pick">${avatar(url, 30, 'lg')}<span>${label}</span><input type="file" accept="image/*" id="photo" hidden></label>`;
  const bindPhotoPicker = (onFile) => {
    const inp = $('#photo');
    if (inp) inp.onchange = () => { const f = inp.files[0]; if (!f) return; onFile(f); inp.closest('.photo-pick').querySelector('.avatar').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`; };
  };

  function screenWelcome() {
    app.innerHTML = `<div class="screen welcome">
      <div class="hero welcome-hero">
        <div class="hero-top">${brand()}<span class="spacer"></span>${langToggle()}</div>
        <div class="welcome-mark">${icon('shield', 40)}</div>
        <h1>${t('welcome_tag')}</h1>
        <p>${t('welcome_sub')}</p>
      </div>
      <div class="choices">
        <button class="choice" data-go="#/register/customer">
          <span class="choice-ic">${icon('home', 26)}</span>
          <span class="choice-t">${t('need_service')}</span>
          <span class="choice-d">${t('need_service_d')}</span>
          <span class="btn">${t('continue_customer')}</span>
        </button>
        <button class="choice" data-go="#/register/worker">
          <span class="choice-ic amber">${icon('toolbox', 26)}</span>
          <span class="choice-t">${t('provide_service')}</span>
          <span class="choice-d">${t('provide_service_d')}</span>
          <span class="btn navy">${t('continue_worker')}</span>
        </button>
      </div>
      <p class="hint center">${t('have_account')} <a href="#/login">${t('login')}</a></p>
    </div>`;
  }

  function screenLogin(query) {
    let mode = S.loginMode || 'password';
    const draw = () => {
      app.innerHTML = `<div class="screen login">
        <div class="hero"><div class="hero-top">${brand()}<span class="spacer"></span>${langToggle()}</div>
          <h1>${t('login_title')}</h1><p>${t('welcome_tag')}</p></div>
        <div class="seg"><button type="button" class="${mode === 'password' ? 'on' : ''}" data-mode="password">${t('with_password')}</button><button type="button" class="${mode === 'otp' ? 'on' : ''}" data-mode="otp">${t('with_code')}</button></div>
        <form id="lf" novalidate>
          <div class="field"><label>${t('phone')}</label>${phoneInput('phone', query.phone || S.loginPhone || '')}</div>
          ${mode === 'password'
            ? `<div class="field"><label>${t('password')}</label>${pwInput('password', 'current-password')}</div>`
            : `<div class="field"><label>${t('otp')}</label><div class="row"><input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••" style="flex:1"><button type="button" class="btn sm ghost" id="sendcode">${t('send_code')}</button></div></div>`}
          <div class="field"><button class="btn">${t('login')}</button></div>
        </form>
        <p class="hint center">${t('new_here')} <a href="#/welcome">${t('create_account')}</a></p>
        <p class="hint center">${t('demo_hint2')}</p>
      </div>`;
      app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { S.loginPhone = $('#lf').phone.value; mode = S.loginMode = b.dataset.mode; draw(); }));
      $('#sendcode') && ($('#sendcode').onclick = guard(async () => {
        const phone = fullPhone($('#lf').phone.value);
        const fb = await fbSendCode(phone);
        if (fb) { S.fbLogin = fb; toast(t('code_sent'), 'ok'); return; }
        const r = await api('/api/otp', { body: { phone, purpose: 'login' } });
        toast(r.demo ? t('code_demo', { otp: '1234' }) : t('code_sent'), 'ok');
      }));
      $('#lf').onsubmit = guard(async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        const body = { phone: fullPhone(f.get('phone')) };
        if (mode === 'password') body.password = f.get('password');
        else if (await fbAuth()) {
          if (!S.fbLogin || S.fbLogin.phone !== body.phone) throw new Error(t('fb_send_first'));
          body.firebase_token = await S.fbLogin.confirm(f.get('otp'));
        } else body.otp = f.get('otp');
        enter(await api('/api/login', { body }));
      });
    };
    draw();
  }

  // Worker service details: used in worker registration, "become a worker" and profile editing.
  const workFieldsHtml = (d, { lockCategory = false } = {}) => `
    <div class="field"><label>${t('city')}</label><select name="city">${CITIES.map((c) => `<option ${c === d.city ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field"><label>${t('service_area')}</label><input name="areas" required minlength="3" value="${e(d.areas || '')}" placeholder="${t('service_area_ph')}"></div>
    <div class="field"><label>${t('main_service')}</label><select name="category" ${lockCategory ? 'disabled' : ''}>${CATS.map((c) => `<option value="${c}" ${c === d.category ? 'selected' : ''}>${catName(c)}</option>`).join('')}</select>
      ${lockCategory ? `<div class="sub">${t('category_locked')}</div>` : ''}</div>
    <div class="field"><label>${t('extra_skills')}</label><input name="skills" value="${e(d.skills || '')}" placeholder="${t('extra_skills_ph')}"></div>
    <div class="field"><div class="two">
      <div><label>${t('years_exp')}</label><input name="exp_years" type="number" min="0" max="60" inputmode="numeric" required value="${e(d.exp_years ?? '')}"></div>
      <div><label>${t('start_price')} (Rs)</label><input name="visit_fee" type="number" min="100" max="50000" inputmode="numeric" required value="${e(d.visit_fee ?? '')}" placeholder="800"></div></div></div>
    <div class="field"><label>${t('bio')}</label><textarea name="bio" maxlength="600" placeholder="${t('bio_ph')}">${e(d.bio || '')}</textarea></div>
    <div class="field"><label>${t('work_days')}</label><div class="day-picks">${DAYS.map((x) => `<label class="day ${(d.work_days || []).includes(x) ? 'on' : ''}"><input type="checkbox" name="work_days" value="${x}" ${(d.work_days || []).includes(x) ? 'checked' : ''} hidden>${t(`day_${x}`)}</label>`).join('')}</div></div>
    <div class="field"><label>${t('working_hours')}</label><div class="two"><input name="hours_from" type="time" value="${e(d.hours_from || '09:00')}" required><input name="hours_to" type="time" value="${e(d.hours_to || '18:00')}" required></div></div>
    <div class="field"><label>${t('preferred_locations')} <span class="opt">(${t('optional')})</span></label><input name="preferred_locations" value="${e(d.preferred_locations || '')}" placeholder="${t('preferred_ph')}"></div>`;
  const readWorkFields = (form) => {
    const f = Object.fromEntries(new FormData(form));
    f.work_days = [...form.querySelectorAll('[name=work_days]:checked')].map((x) => x.value);
    if (f.exp_years !== undefined) f.exp_years = Number(f.exp_years);
    if (f.visit_fee !== undefined) f.visit_fee = Number(f.visit_fee);
    return f;
  };
  const bindDays = () => app.querySelectorAll('.day input').forEach((c) => (c.onchange = () => c.parentElement.classList.toggle('on', c.checked)));

  function screenRegister(role) {
    if (!['customer', 'worker'].includes(role)) { location.hash = '#/welcome'; return; }
    const R = S.reg && S.reg.role === role ? S.reg : (S.reg = { role, step: 1, d: { city: 'Lahore', category: 'electrician', hours_from: '09:00', hours_to: '18:00', work_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }, photo: null });
    const total = role === 'worker' ? 4 : 2;
    const otpStep = role === 'worker' ? 3 : 2;
    const head = (title) => `<div class="topbar"><button class="back" data-regback aria-label="Back">‹</button><span>${title}</span></div>
      <div class="steps">${[...Array(total)].map((_, i) => `<span class="${i < R.step ? 'on' : ''}"></span>`).join('')}</div>
      <div class="sub step-label">${t('step_n', { i: R.step, n: total })}</div>`;
    const draw = () => {
      if (R.step === 1) {
        app.innerHTML = `<div class="screen">${head(t(role === 'worker' ? 'join_worker' : 'join_customer'))}
          <form id="rf" novalidate>
            ${photoPicker(R.photoUrl, t('add_photo_opt'))}
            <div class="field"><label>${t('full_name')}</label><input name="name" required minlength="3" autocomplete="name" value="${e(R.d.name || '')}"></div>
            <div class="field"><label>${t('phone')}</label>${phoneInput('phone', R.d.phone || '')}</div>
            <div class="field"><label>${t('email')} <span class="opt">(${t('optional')})</span></label><input name="email" type="email" autocomplete="email" value="${e(R.d.email || '')}"></div>
            <div class="field"><label>${t('password')}</label>${pwInput('password', 'new-password', t('pw_ph'))}<div class="sub">${t('pw_rules')}</div></div>
            ${role === 'customer' ? `<div class="field"><label>${t('city')}</label><select name="city">${CITIES.map((c) => `<option ${c === R.d.city ? 'selected' : ''}>${c}</option>`).join('')}</select></div>` : ''}
            <div class="field"><button class="btn">${t('continue')}</button></div>
          </form>
          <p class="hint center">${t('have_account')} <a href="#/login">${t('login')}</a></p></div>`;
        if (R.d.password) $('#rf').password.value = R.d.password;
        bindPhotoPicker((f) => { R.photo = f; R.photoUrl = URL.createObjectURL(f); });
        $('#rf').onsubmit = guard(async (ev) => {
          ev.preventDefault();
          const f = Object.fromEntries(new FormData(ev.target));
          if (f.name.trim().length < 3) throw new Error(t('err_name'));
          if (!/^0?3\d{9}$|^923\d{9}$/.test(fullPhone(f.phone))) throw new Error(t('err_phone'));
          const p = pwProblem(f.password);
          if (p) throw new Error(p);
          Object.assign(R.d, f);
          R.step = 2; draw();
        });
      } else if (role === 'worker' && R.step === 2) {
        app.innerHTML = `<div class="screen">${head(t('your_work'))}
          <form id="rf" novalidate>${workFieldsHtml(R.d)}<div class="field"><button class="btn">${t('continue')}</button></div></form></div>`;
        bindDays();
        $('#rf').onsubmit = guard(async (ev) => {
          ev.preventDefault();
          const f = readWorkFields(ev.target);
          if (f.areas.trim().length < 3) throw new Error(t('err_area'));
          if (!(f.exp_years >= 0) || ev.target.exp_years.value === '') throw new Error(t('err_years'));
          if (!(f.visit_fee >= 100)) throw new Error(t('err_price'));
          if (!f.work_days.length) throw new Error(t('err_days'));
          Object.assign(R.d, f);
          R.step = 3; draw();
        });
      } else if (R.step === otpStep) {
        app.innerHTML = `<div class="screen">${head(t('verify_phone'))}
          <div class="card"><div class="sub" style="margin:0">${t('code_sent_to', { phone: `<bdi dir="ltr">+92 ${e(fullPhone(R.d.phone).slice(1, 4))} ${e(fullPhone(R.d.phone).slice(4))}</bdi>` })}</div><div class="sub" id="demo"></div></div>
          <form id="of" novalidate>
            <div class="field"><label>${t('otp')}</label><input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••" required></div>
            <div class="field"><label class="toggle consent"><input type="checkbox" name="agree" required> <span>${t(role === 'worker' ? 'agree_worker' : 'agree_customer')}</span></label></div>
            <div class="field"><button class="btn">${t('create_account')}</button><button type="button" class="link-btn" id="resend">${t('resend_code')}</button></div>
          </form></div>`;
        const send = guard(async () => {
          try {
            const r = await api('/api/otp', { body: { phone: fullPhone(R.d.phone), purpose: 'register' } });
            if (r.firebase) R.fb = await fbSendCode(fullPhone(R.d.phone));
            $('#demo').textContent = r.demo ? t('code_demo', { otp: '1234' }) : '';
          } catch (err) { R.step = 1; draw(); throw err; }
        });
        send();
        $('#resend').onclick = send;
        $('#of').onsubmit = guard(async (ev) => {
          ev.preventDefault();
          const btn = ev.target.querySelector('.btn');
          if (!ev.target.agree.checked) throw new Error(t('err_agree'));
          btn.disabled = true;
          try {
            const proof = (await fbAuth())
              ? { firebase_token: R.fb && R.fb.phone === fullPhone(R.d.phone) ? await R.fb.confirm(ev.target.otp.value) : (() => { throw new Error(t('fb_send_first')); })() }
              : { otp: ev.target.otp.value };
            const r = await api('/api/register', { body: { ...R.d, role, phone: fullPhone(R.d.phone), ...proof } });
            S.token = r.token; store.set('kw_token', r.token);
            if (R.photo) {
              const id = await uploadFile(R.photo, 'avatar').catch(() => null);
              if (id) await api(role === 'worker' ? '/api/worker' : '/api/me', { method: 'PATCH', body: { photo_id: id } }).catch(() => {});
            }
            S.reg = null; S.me = null;
            toast(t('welcome_name', { name: r.user.name.split(' ')[0] }), 'ok');
            location.hash = role === 'worker' ? '#/documents?onboard=1' : '#/home';
          } catch (err) { btn.disabled = false; throw err; }
        });
      }
      app.querySelector('[data-regback]').onclick = () => { if (R.step > 1) { R.step--; draw(); } else { S.reg = null; location.hash = '#/welcome'; } };
    };
    draw();
  }

  // ---------- worker: verification documents ----------
  async function screenDocuments(query) {
    const d = await api('/api/worker/profile');
    const w = d.worker;
    const onboard = !!query.onboard;
    const kinds = [['cnic_front', true], ['cnic_back', true], ['selfie', false], ['certificate', false]];
    app.innerHTML = `<div class="screen">
      ${onboard ? `<div class="topbar"><span>${t('verify_identity')}</span></div><div class="steps">${'<span class="on"></span>'.repeat(4)}</div><div class="sub step-label">${t('step_n', { i: 4, n: 4 })}</div>` : topbar(t('verification_docs'), '#/profile')}
      <div class="card info"><div class="row" style="align-items:flex-start">${icon('lock', 20)}<div class="sub" style="margin:0;color:var(--navy)">${t('docs_private')}</div></div></div>
      <div class="card"><div class="row" style="justify-content:space-between"><h3>${t('verification_status')}</h3>${verBadge(w.verification)}</div>
        <div class="sub mt">${t(`ver_help_${w.verification}`)}</div>
        ${w.verification === 'rejected' && w.verification_note ? `<div class="warn mt">${icon('alert', 16)} ${e(w.verification_note)}</div>` : ''}</div>
      ${kinds.map(([k, req]) => {
        const have = d.documents.filter((x) => x.kind === k);
        return `<div class="card doc-row">
          <span class="alert-ic">${icon(k === 'selfie' ? 'camera' : 'doc', 18)}</span>
          <div style="flex:1;min-width:0"><div class="name">${t(`doc_${k}`)}</div>
            <div class="sub">${have.length ? t('uploaded_on', { when: when(have[have.length - 1].created_at) }) : t(req ? 'required' : 'optional')}</div>
            ${have.length ? `<button class="link-btn inline" data-view="${have[have.length - 1].url}">${t('view_private')}</button>` : ''}</div>
          ${w.verification !== 'verified' ? `<label class="btn sm ${have.length ? 'ghost' : ''} upl">${t(have.length ? 'replace' : 'upload')}<input type="file" accept="image/*,application/pdf" data-kind="${k}" data-old="${have.map((x) => x.id).join(',')}" hidden></label>`
            : `<span class="badge">${icon('check', 13)} ${t('uploaded')}</span>`}
        </div>`;
      }).join('')}
      <div class="field">${onboard ? `<button class="btn" data-go="#/home">${t('finish')}</button><div class="sub mt center">${t('upload_later')}</div>` : ''}</div>
      ${onboard ? '' : tabs('profile')}
    </div>`;
    app.querySelectorAll('[data-view]').forEach((b) => (b.onclick = guard(() => viewDoc(b.dataset.view))));
    app.querySelectorAll('input[data-kind]').forEach((inp) => (inp.onchange = guard(async () => {
      const file = inp.files[0];
      if (!file) return;
      const lbl = inp.closest('label');
      lbl.firstChild.textContent = t('uploading', { i: 1, n: 1 });
      const res = await fetch(`/api/worker/documents?kind=${inp.dataset.kind}`, { method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${S.token}` }, body: file });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { render(); throw new Error(out.error || 'Upload failed'); }
      for (const old of inp.dataset.old.split(',').filter(Boolean)) await api(`/api/worker/documents/${old}`, { method: 'DELETE' }).catch(() => {});
      S.me = null; toast(t('doc_uploaded'), 'ok'); render();
    })));
  }

  // ---------- customer profile ----------
  async function screenCustomerProfile() {
    const me = S.me, c = S.customer || {};
    const item = (go, ic, label, extra = '') => `<a class="menu-item" href="${go}">${icon(ic, 20)}<span>${label}</span>${extra}<span class="chev">›</span></a>`;
    app.innerHTML = `<div class="screen">
      <div class="phead"><div class="who">${avatar(c.photo_url, 36, 'lg')}
        <div style="min-width:0"><div class="name" style="font-size:18px">${e(me.name)}</div><div class="sub"><bdi dir="ltr">${e(me.phone_display)}</bdi></div>
        <div class="sub">${e(c.city || '')}${me.email ? ` · ${e(me.email)}` : ''}</div></div></div>
        <button class="btn sm ghost edit-btn" data-go="#/edit-profile">${icon('edit', 15)} ${t('edit_profile')}</button></div>
      ${roleCard()}
      <div class="menu">
        ${item('#/bookings', 'cal', t('my_bookings'))}
        ${item('#/addresses', 'pin', t('saved_addresses'))}
        ${item('#/favourites', 'heart', t('favourite_workers'))}
        ${item('#/my-reviews', 'star', t('reviews_given'))}
        ${item('#/payments', 'card', t('payment_history'))}
      </div>
      <div class="menu">
        ${item('#/help', 'help', t('help_support'))}
        <button class="menu-item" id="rep">${icon('alert', 20)}<span>${t('report_problem')}</span><span class="chev">›</span></button>
        ${item('#/blocked', 'ban', t('blocked_people'))}
        ${item('#/password', 'key', t(me.has_password ? 'change_password' : 'set_password'))}
      </div>
      ${settingsBlock()}
      ${tabs('profile')}
    </div>`;
    bindSettings();
    $('#rep').onclick = () => reportSheet({});
  }

  // Role switch / activation card, shown on both profiles.
  function roleCard() {
    const other = S.me.role === 'worker' ? 'customer' : 'worker';
    const has = S.roles.includes(other);
    return `<div class="card role-card"><span class="choice-ic ${other === 'worker' ? 'amber' : ''}">${icon(other === 'worker' ? 'toolbox' : 'home', 22)}</span>
      <div style="flex:1"><div class="name">${t(has ? `switch_to_${other}` : `become_${other}`)}</div><div class="sub">${t(has ? `switch_to_${other}_d` : `become_${other}_d`)}</div></div>
      <button class="btn sm" id="role">${t(has ? 'switch' : 'start')}</button></div>`;
  }
  function settingsBlock() {
    return `<div class="field mt"><label>${t('language')}</label><div class="two">
        <button class="btn ${S.lang === 'en' ? '' : 'ghost'}" data-setlang="en">English</button><button class="btn ${S.lang === 'ur' ? '' : 'ghost'}" data-setlang="ur" style="margin:0">اردو</button></div></div>
      <div class="field"><button class="btn ghost" id="lo">${icon('out', 16)} ${t('logout')}</button></div>`;
  }
  function bindSettings() {
    app.querySelectorAll('[data-setlang]').forEach((b) => (b.onclick = () => setLang(b.dataset.setlang)));
    $('#lo').onclick = logout;
    const other = S.me.role === 'worker' ? 'customer' : 'worker';
    $('#role') && ($('#role').onclick = guard(async () => {
      if (S.roles.includes(other)) {
        await api('/api/me/role', { body: { role: other } });
        S.me = null; toast(t(`now_${other}`), 'ok');
        location.hash === '#/home' ? render() : (location.hash = '#/home');
      } else if (other === 'worker') location.hash = '#/become-worker';
      else sheet(t('become_customer'), `<div class="sub" style="margin:0 16px 10px">${t('become_customer_d')}</div>
          <div class="field"><label>${t('city')}</label><select id="bc">${CITIES.map((c) => `<option ${c === (S.worker?.city || 'Lahore') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="field"><button class="btn" id="bcs">${t('start')}</button></div>`, (el, close) => {
        el.querySelector('#bcs').onclick = guard(async () => {
          await api('/api/me/roles', { body: { role: 'customer', city: el.querySelector('#bc').value } });
          close(); S.me = null; toast(t('now_customer'), 'ok'); location.hash = '#/home';
        });
      });
    }));
  }

  async function screenEditProfile() {
    const me = S.me, c = S.customer || {};
    let photo = null;
    app.innerHTML = `<div class="screen">${topbar(t('edit_profile'), '#/profile')}
      <form id="ef">
        ${photoPicker(c.photo_url, t('change_photo'))}
        <div class="field"><label>${t('full_name')}</label><input name="name" required minlength="3" value="${e(me.name)}"></div>
        <div class="field"><label>${t('phone')}</label><input value="${e(me.phone_display)}" dir="ltr" readonly><div class="sub">${t('phone_locked')}</div></div>
        <div class="field"><label>${t('email')} <span class="opt">(${t('optional')})</span></label><input name="email" type="email" value="${e(me.email || '')}"></div>
        <div class="field"><label>${t('city')}</label><select name="city">${CITIES.map((x) => `<option ${x === c.city ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="field"><label>${t('area')}</label><select name="area">${AREAS.map((a) => `<option ${a === S.area ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
        <div class="field"><button class="btn">${t('save')}</button></div>
      </form>${tabs('profile')}</div>`;
    bindPhotoPicker((f) => { photo = f; });
    $('#ef').onsubmit = guard(async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target));
      if (photo) body.photo_id = await uploadFile(photo, 'avatar');
      await api('/api/me', { method: 'PATCH', body });
      S.area = body.area; store.set('kw_area', S.area);
      S.me = null; toast(t('saved'), 'ok'); location.hash = '#/profile';
    });
  }

  async function screenAddresses() {
    const { addresses } = await api('/api/addresses');
    app.innerHTML = `<div class="screen">${topbar(t('saved_addresses'), '#/profile')}
      ${addresses.map((a) => `<div class="card">
        <div class="row" style="justify-content:space-between;align-items:flex-start"><div style="min-width:0"><div class="name">${icon('pin', 15)} ${e(a.label)} ${a.is_default ? `<span class="badge">${t('default')}</span>` : ''}</div>
        <div class="sub">${e(a.line)}</div><div class="sub">${e([a.area, a.city].filter(Boolean).join(', '))}</div></div></div>
        <div class="row mt" style="gap:14px">${a.is_default ? '' : `<button class="link-btn inline" data-def="${a.id}">${t('make_default')}</button>`}<button class="link-btn inline danger-txt" data-del="${a.id}">${t('delete')}</button></div>
      </div>`).join('') || `<div class="empty">${t('no_addresses')}</div>`}
      <h2 class="section">${t('add_address')}</h2>
      <form id="af">
        <div class="field"><div class="chips" style="padding:0">${['Home', 'Office', 'Other'].map((l, i) => `<label class="chip ${i === 0 ? 'on' : ''}"><input type="radio" name="label" value="${l}" ${i === 0 ? 'checked' : ''} hidden>${t(`lbl_${l}`)}</label>`).join('')}</div></div>
        <div class="field"><label>${t('address')}</label><input name="line" required minlength="5" placeholder="${t('address_ph')}"></div>
        <div class="field"><div class="two"><select name="area">${AREAS.map((a) => `<option ${a === S.area ? 'selected' : ''}>${a}</option>`).join('')}</select>
          <select name="city">${CITIES.map((c) => `<option>${c}</option>`).join('')}</select></div></div>
        <div class="field"><button class="btn">${t('save_address')}</button></div>
      </form>${tabs('profile')}</div>`;
    app.querySelectorAll('input[name=label]').forEach((r) => (r.onchange = () => app.querySelectorAll('input[name=label]').forEach((x) => x.parentElement.classList.toggle('on', x.checked))));
    app.querySelectorAll('[data-def]').forEach((b) => (b.onclick = guard(async () => { await api(`/api/addresses/${b.dataset.def}`, { method: 'PATCH', body: { is_default: true } }); render(); })));
    app.querySelectorAll('[data-del]').forEach((b) => (b.onclick = guard(async () => { await api(`/api/addresses/${b.dataset.del}`, { method: 'DELETE' }); render(); })));
    $('#af').onsubmit = guard(async (ev) => {
      ev.preventDefault();
      await api('/api/addresses', { body: Object.fromEntries(new FormData(ev.target)) });
      toast(t('saved'), 'ok'); render();
    });
  }

  const workerCard = (w, extra = '') => `
    <div class="card">
      <a class="row" href="#/worker/${w.id}" style="align-items:flex-start;color:inherit;text-decoration:none">${avatar(w.photo_url)}
        <div style="flex:1;min-width:0"><div class="row" style="justify-content:space-between"><div class="name"><bdi>${e(w.name)}</bdi> ${w.id_verified ? verifiedTick : ''}</div>${ratingHtml(w)}</div>
          <div class="sub">${catName(w.category)} · ${t('from_visit', { n: rs(w.visit_fee) })}</div></div></a>${extra}
    </div>`;

  async function screenFavourites() {
    const { workers } = await api('/api/favourites');
    app.innerHTML = `<div class="screen">${topbar(t('favourite_workers'), '#/profile')}
      ${workers.map((w) => workerCard(w, `<div class="price-row"><button class="link-btn inline danger-txt" data-unfav="${w.id}">${icon('heart', 14)} ${t('remove')}</button>
        ${w.bookable ? `<button class="btn sm" data-go="#/book/${w.id}">${t('book_now')}</button>` : `<span class="sub">${t('not_available_now')}</span>`}</div>`)).join('') || `<div class="empty">${t('no_favourites')}</div>`}
      ${tabs('profile')}</div>`;
    app.querySelectorAll('[data-unfav]').forEach((b) => (b.onclick = guard(async () => { await api(`/api/favourites/${b.dataset.unfav}`, { method: 'DELETE' }); render(); })));
  }

  async function screenMyReviews() {
    const { reviews } = await api('/api/me/reviews');
    app.innerHTML = `<div class="screen">${topbar(t('reviews_given'), '#/profile')}
      ${reviews.map((r) => `<a class="card" href="#/booking/${r.booking_id}" style="display:block;color:inherit;text-decoration:none">
        <div class="row" style="justify-content:space-between"><div class="name">${e(r.worker_name)}</div><span class="rating">${star(14)} ${r.rating}</span></div>
        <div class="sub">#${e(r.code)} · ${catName(r.category)} · ${when(r.created_at)}</div>${r.comment ? `<div class="mt">“${e(r.comment)}”</div>` : ''}</a>`).join('') || `<div class="empty">${t('no_reviews_given')}</div>`}
      ${tabs('profile')}</div>`;
  }

  async function screenPayments() {
    const { payments, refunds } = await api('/api/me/payments');
    const ST = { paid: ['', 'pst_paid'], initiated: ['amber', 'pst_initiated'], failed: ['red', 'pst_failed'] };
    app.innerHTML = `<div class="screen">${topbar(t('payment_history'), '#/profile')}
      <div class="card info"><div class="row" style="align-items:flex-start">${icon('shield', 20)}<div class="sub" style="margin:0;color:var(--navy)">${t('payments_note')}</div></div></div>
      ${payments.map((p) => `<a class="card list-item" href="#/booking/${p.booking_id}">
        <div class="row" style="min-width:0">${walletLogo(p.provider)}<div style="min-width:0"><div class="name">#${e(p.code)} · ${p.extra_id ? `${t('addon')}: ${e(p.addon_work)}` : t('visit_fee')}</div>
          <div class="sub">${when(p.created_at)}</div><span class="badge ${ST[p.status][0]}">${t(ST[p.status][1], { x: t(p.provider) })}</span></div></div>
        <b>Rs ${rs(p.amount)}</b></a>`).join('') || `<div class="empty">${t('no_payments')}</div>`}
      ${refunds.length ? `<h2 class="section">${t('refunds')}</h2>${refunds.map((r) => `<div class="card list-item"><div><div class="name">#${e(r.code)} · ${e(r.note || t('refund'))}</div>
        <div class="sub">${when(r.created_at)}</div><span class="badge ${r.payout_status === 'sent' ? '' : 'amber'}">${t(r.payout_status === 'sent' ? 'refund_sent' : 'refund_pending')}</span></div><b>Rs ${rs(r.amount)}</b></div>`).join('')}` : ''}
      ${tabs('profile')}</div>`;
  }

  async function screenBlocked() {
    const { blocked } = await api('/api/blocks');
    app.innerHTML = `<div class="screen">${topbar(t('blocked_people'), '#/profile')}
      <div class="hint">${t('blocked_help')}</div>
      ${blocked.map((b) => `<div class="card list-item"><div class="row">${avatar(null, 20)}<div><div class="name">${e(b.name)}</div><div class="sub">${when(b.created_at)}</div></div></div>
        <button class="btn sm ghost" data-unblock="${b.user_id}">${t('unblock')}</button></div>`).join('') || `<div class="empty">${t('no_blocked')}</div>`}
      ${tabs('profile')}</div>`;
    app.querySelectorAll('[data-unblock]').forEach((b) => (b.onclick = guard(async () => { await api(`/api/blocks/${b.dataset.unblock}`, { method: 'DELETE' }); toast(t('unblocked'), 'ok'); render(); })));
  }
  function blockSheet(body, after) {
    sheet(t('block_title'), `<div class="sub" style="margin:0 16px 10px">${t('block_help')}</div><div class="field"><textarea id="br" placeholder="${t('block_reason_ph')}"></textarea></div>
      <div class="field"><button class="btn danger" id="bs">${t('block')}</button></div>`, (el, close) => {
      el.querySelector('#bs').onclick = guard(async () => {
        await api('/api/blocks', { body: { ...body, reason: el.querySelector('#br').value || undefined } });
        close(); toast(t('blocked_toast'), 'ok'); after?.();
      });
    });
  }

  function screenHelp() {
    const qa = ['escrow', 'addon', 'verify', 'cancel', 'privacy'];
    app.innerHTML = `<div class="screen">${topbar(t('help_support'), '#/profile')}
      ${qa.map((k) => `<details class="card faq"><summary>${t(`faq_${k}_q`)}</summary><div class="sub">${t(`faq_${k}_a`)}</div></details>`).join('')}
      <div class="field"><button class="btn" id="contact">${icon('headset', 16)} ${t('contact_support')}</button><button class="btn ghost" id="rep">${icon('alert', 16)} ${t('report_problem')}</button></div>
      ${tabs('profile')}</div>`;
    $('#contact').onclick = () => reportSheet({});
    $('#rep').onclick = () => reportSheet({});
  }

  function screenPassword() {
    app.innerHTML = `<div class="screen">${topbar(t(S.me.has_password ? 'change_password' : 'set_password'), '#/profile')}
      <form id="pf" novalidate>
        ${S.me.has_password ? `<div class="field"><label>${t('current_password')}</label>${pwInput('current', 'current-password')}</div>` : ''}
        <div class="field"><label>${t('new_password')}</label>${pwInput('password')}<div class="sub">${t('pw_rules')}</div></div>
        <div class="field"><label>${t('confirm_password')}</label>${pwInput('confirm')}</div>
        <div class="field"><button class="btn">${t('save')}</button><div class="sub mt">${t('pw_other_devices')}</div></div>
      </form>${tabs('profile')}</div>`;
    $('#pf').onsubmit = guard(async (ev) => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      const p = pwProblem(f.password);
      if (p) throw new Error(p);
      if (f.password !== f.confirm) throw new Error(t('pw_mismatch'));
      await api('/api/me/password', { body: { current: f.current, password: f.password } });
      S.me = null; toast(t('saved'), 'ok'); location.hash = '#/profile';
    });
  }

  function screenBecomeWorker() {
    const d = { city: S.customer?.city || 'Lahore', category: 'electrician', hours_from: '09:00', hours_to: '18:00', work_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
    app.innerHTML = `<div class="screen">${topbar(t('become_worker'), '#/profile')}
      <div class="card info"><div class="row" style="align-items:flex-start">${icon('toolbox', 20)}<div class="sub" style="margin:0;color:var(--navy)">${t('become_worker_help')}</div></div></div>
      <form id="wf" novalidate>${workFieldsHtml(d)}
        <div class="field"><label class="toggle consent"><input type="checkbox" name="agree"> <span>${t('agree_worker')}</span></label></div>
        <div class="field"><button class="btn navy">${t('create_worker_profile')}</button></div></form>${tabs('profile')}</div>`;
    bindDays();
    $('#wf').onsubmit = guard(async (ev) => {
      ev.preventDefault();
      if (!ev.target.agree.checked) throw new Error(t('err_agree'));
      const { agree, ...body } = readWorkFields(ev.target);
      await api('/api/me/roles', { body: { role: 'worker', ...body } });
      S.me = null; toast(t('now_worker'), 'ok'); location.hash = '#/documents?onboard=1';
    });
  }

  // ---------- worker profile (own) ----------
  async function screenWorkerProfile() {
    const { worker: w, documents } = await api('/api/worker/profile');
    const me = S.me;
    app.innerHTML = `<div class="screen">
      <div class="phead"><div class="who">${avatar(w.photo_url, 36, 'lg')}
        <div style="min-width:0"><div class="name" style="font-size:18px">${e(w.name)} ${w.id_verified ? verifiedTick : ''}</div><div class="sub">${catName(w.category)} · <bdi dir="ltr">${e(me.phone_display)}</bdi></div>
        ${verBadge(w.verification)}</div></div>
        <button class="btn sm ghost edit-btn" data-go="#/worker-edit">${icon('edit', 15)} ${t('edit_profile')}</button></div>
      <div class="mini-stats">
        <div><b>${star(14)} ${w.rating ?? '–'}</b><span>${t('n_reviews', { n: w.review_count })}</span></div>
        <div><b>${w.completed_jobs}</b><span>${t('completed_jobs')}</span></div>
        <div><b>${w.exp_years}</b><span>${t('years_exp')}</span></div>
      </div>
      ${w.verification !== 'verified' ? `<a class="card alert ${w.verification === 'rejected' ? 'danger' : ''}" href="#/documents"><span class="alert-ic">${icon('doc', 20)}</span>
        <div style="flex:1"><div class="name">${t(`ver_banner_${w.verification}`)}</div><div class="sub">${t(`ver_help_${w.verification}`)}</div></div><span>›</span></a>` : ''}
      <div class="card kv">
        <div class="lbl">${t('bio')}</div><div>${e(w.bio) || '—'}</div>
        <div class="lbl mt8">${t('services_skills')}</div><div><b>${catName(w.category)}</b>${w.skills ? ` · ${e(w.skills)}` : ''}</div>
        <div class="lbl mt8">${t('service_area')}</div><div>${e(w.areas)}, ${e(w.city)}${w.preferred_locations ? ` · ${t('prefers')}: ${e(w.preferred_locations)}` : ''}</div>
        <div class="lbl mt8">${t('prices')}</div><div>${t('from_visit', { n: rs(w.visit_fee) })}${w.extra_rates ? ` · ${e(w.extra_rates)}` : ''}</div>
        <div class="lbl mt8">${t('working_hours')}</div><div>${hoursText(w)} · ${w.available ? `<span class="ok-txt">${t('available')}</span>` : `<span class="danger-txt">${t('unavailable')}</span>`}</div>
      </div>
      <div class="card"><div class="row" style="justify-content:space-between"><h3>${icon('image', 15)} ${t('portfolio')}</h3>
        <label class="btn sm ghost upl">${icon('plus', 14)} ${t('add')}<input type="file" accept="image/*" id="pf" hidden multiple></label></div>
        ${w.portfolio.length ? `<div class="thumbs mt">${w.portfolio.map((p) => `<div class="thumb"><img src="${p.url}" alt=""><button type="button" data-rmp="${p.id}" aria-label="${t('remove')}">×</button></div>`).join('')}</div>` : `<div class="sub mt">${t('portfolio_empty')}</div>`}</div>
      <a class="card list-item" href="#/documents"><div class="row">${icon('lock', 20)}<div><div class="name">${t('verification_docs')}</div><div class="sub">${t('n_docs_private', { n: documents.length })}</div></div></div><span class="chev">›</span></a>
      ${w.reviews.length ? `<div class="card"><h3>${t('reviews')}</h3>${w.reviews.map((r) => `<div class="review"><div class="row" style="justify-content:space-between"><b>${e(r.customer)}</b><span class="rating">${star(12)} ${r.rating}</span></div><div class="sub">${e(r.comment)}</div></div>`).join('')}</div>` : ''}
      <div class="field"><label>${t('payout_wallet')}</label><div class="two">
        <select id="pp">${['jazzcash', 'easypaisa'].map((p) => `<option value="${p}" ${w.payout_provider === p ? 'selected' : ''}>${t(p)}</option>`).join('')}</select>
        <input id="pw" value="${e(w.payout_wallet || '')}" inputmode="tel" dir="ltr"></div>
        <button class="btn sm mt" id="psave">${t('save')}</button></div>
      ${roleCard()}
      <div class="menu">
        <a class="menu-item" href="#/help">${icon('help', 20)}<span>${t('help_support')}</span><span class="chev">›</span></a>
        <a class="menu-item" href="#/blocked">${icon('ban', 20)}<span>${t('blocked_people')}</span><span class="chev">›</span></a>
        <a class="menu-item" href="#/password">${icon('key', 20)}<span>${t(me.has_password ? 'change_password' : 'set_password')}</span><span class="chev">›</span></a>
      </div>
      ${settingsBlock()}
      ${tabs('profile')}
    </div>`;
    bindSettings();
    $('#psave').onclick = guard(async () => {
      await api('/api/worker', { method: 'PATCH', body: { payout_provider: $('#pp').value, payout_wallet: $('#pw').value } });
      S.me = null; toast(t('saved'), 'ok');
    });
    $('#pf').onchange = guard(async (ev) => {
      for (const f of ev.target.files) await uploadFile(f, 'portfolio');
      toast(t('saved'), 'ok'); render();
    });
    app.querySelectorAll('[data-rmp]').forEach((b) => (b.onclick = guard(async () => { await api(`/api/worker/portfolio/${b.dataset.rmp}`, { method: 'DELETE' }); render(); })));
  }

  async function screenWorkerEdit() {
    const { worker: w } = await api('/api/worker/profile');
    let photo = null;
    app.innerHTML = `<div class="screen">${topbar(t('edit_profile'), '#/profile')}
      <form id="wf" novalidate>
        ${photoPicker(w.photo_url, t('change_photo'))}
        <div class="field"><label>${t('full_name')}</label><input name="name" required minlength="3" value="${e(w.name)}"></div>
        <div class="field"><label class="toggle switch"><input type="checkbox" name="available" ${w.available ? 'checked' : ''}> <span>${t('available_new')}</span></label></div>
        ${workFieldsHtml(w, { lockCategory: w.verification === 'verified' })}
        <div class="field"><label>${t('price_notes')} <span class="opt">(${t('optional')})</span></label><input name="extra_rates" value="${e(w.extra_rates || '')}" placeholder="${t('price_notes_ph')}"></div>
        <div class="sub hint">${t('price_change_note')}</div>
        <div class="field"><button class="btn">${t('save')}</button></div>
      </form>${tabs('profile')}</div>`;
    bindDays();
    bindPhotoPicker((f) => { photo = f; });
    $('#wf').onsubmit = guard(async (ev) => {
      ev.preventDefault();
      const body = readWorkFields(ev.target);
      body.available = ev.target.available.checked;
      if (photo) body.photo_id = await uploadFile(photo, 'avatar');
      if (w.verification === 'verified') delete body.category;
      await api('/api/worker', { method: 'PATCH', body });
      S.me = null; toast(t('saved'), 'ok'); location.hash = '#/profile';
    });
  }

  // ---------- router ----------
  async function render() {
    applyLang();
    document.querySelectorAll('.sheet-bg').forEach((el) => el.remove()); // close any open sheet when the screen changes
    const [path, qs] = (location.hash.slice(1) || '/home').split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    const parts = path.split('/').filter(Boolean);
    if (!S.token) {
      if (parts[0] === 'login') return screenLogin(query);
      if (parts[0] === 'register') return screenRegister(parts[1]);
      if (parts[0] !== 'welcome') history.replaceState(null, '', '#/welcome');
      return screenWelcome();
    }
    try {
      if (!S.me) {
        const r = await api('/api/me');
        S.me = r.user; S.roles = r.roles; S.worker = r.worker; S.customer = r.customer;
        if (S.me.role === 'admin') { location.href = '/admin.html'; return; }
        if (!store.get('kw_lang') && r.user.lang) { S.lang = r.user.lang; applyLang(); }
      }
      const [name, id] = parts;
      const screens = {
        home: screenHome, login: screenHome, welcome: screenHome, register: screenHome, list: () => screenList(id || 'all', query), worker: () => screenWorker(id, query), book: () => screenBook(id, query),
        booking: () => screenBooking(id, query), bookings: () => screenBookings(query),
        documents: () => (S.me.role === 'worker' ? screenDocuments(query) : screenHome()), 'worker-edit': () => (S.me.role === 'worker' ? screenWorkerEdit() : screenHome()),
        'edit-profile': () => (S.me.role === 'customer' ? screenEditProfile() : screenWorkerEdit()), addresses: screenAddresses, favourites: screenFavourites,
        'my-reviews': screenMyReviews, payments: screenPayments, blocked: screenBlocked, help: screenHelp, password: screenPassword, 'become-worker': screenBecomeWorker,
        'addon-new': () => screenAddonNew(id), addon: () => screenAddon(id, query), invoice: () => screenInvoice(id), notifications: screenNotifications, messages: screenMessages, chat: () => screenChat(id), profile: screenProfile,
      };
      await (screens[name] || screenHome)();
      window.scrollTo?.(0, name === 'chat' ? document.body.scrollHeight : 0);
    } catch (err) {
      if (S.token) toast(err.message, 'err');
    }
  }

  // Delegated navigation
  document.addEventListener('click', (ev) => {
    const go = ev.target.closest('[data-go]');
    if (go) { ev.preventDefault(); location.hash = go.dataset.go; return; }
    const back = ev.target.closest('[data-back]');
    if (back) { ev.preventDefault(); const to = back.dataset.back; to && to.startsWith('#') ? (location.hash = to) : history.length > 1 ? history.back() : (location.hash = '#/home'); return; }
    if (ev.target.closest('[data-lang]')) setLang(S.lang === 'en' ? 'ur' : 'en');
    const pw = ev.target.closest('[data-showpw]');
    if (pw) { const inp = pw.previousElementSibling; inp.type = inp.type === 'password' ? 'text' : 'password'; pw.textContent = t(inp.type === 'password' ? 'show' : 'hide'); }
  });
  window.addEventListener('hashchange', render);
  render();
})();
