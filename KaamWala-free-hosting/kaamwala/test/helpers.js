'use strict';
const http = require('node:http');
const { createApp } = require('../src/server');

async function start(env = {}, dbFile = ':memory:', fetchImpl = fetch) {
  const app = createApp({ dbFile, env: { BASE_URL: 'http://test', ...env }, fetchImpl });
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
  const upload = (token, buf, type) => fetch(`${base}/api/uploads`, { method: 'POST', headers: { 'Content-Type': type, Authorization: `Bearer ${token}` }, body: buf }).then(async (r) => ({ status: r.status, data: await r.json() }));
  return { app, db: app.db, server, base, call, login, simulate, upload, close: () => server.close() };
}

const PHONES = { ahmed: '03001234567', usman: '03044444444', faisal: '03066666666', ali: '03011111111', admin: '03000000000' };

module.exports = { start, PHONES };
