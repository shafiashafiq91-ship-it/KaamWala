'use strict';
// Uploaded photos/videos and private CNIC documents, kept in Firebase (Cloud Firestore) as well as on disk.
//
// Free hosts like Render wipe the disk on every restart. When the Firestore database is switched on
// (FIREBASE_SERVICE_ACCOUNT / FIREBASE_SERVICE_ACCOUNT_JSON), every uploaded file is also saved to the
// Firestore collection "_files", split into pieces under Firestore's 1 MB document limit. The disk is then
// only a cache: if a file is missing (after a restart), it is downloaded back from Firestore the first
// time someone opens it. Files stay private: they are only served through the app's own checked routes.
// Without Firebase settings nothing changes and files live on disk only.
const fs = require('node:fs');
const path = require('node:path');
const firestore = require('./firestore');

const COLL = '_files';
const PIECE = 900_000; // bytes per Firestore document (limit is 1 MiB including field names)

// "private/abc.pdf" -> "private__abc.pdf": stable across hosts, whatever the upload folder is.
const keyOf = (file) => (path.basename(path.dirname(file)) === 'private' ? 'private__' : '') + path.basename(file);

function create(env, { fetchImpl = fetch } = {}) {
  if (!firestore.enabled(env)) return { remote: false, async save() {}, async restore() { return false; }, async remove() {} };
  const fsc = firestore.client(env, fetchImpl);
  const doc = (id, fields) => ({ update: { name: fsc.docName(COLL, id), fields } });
  return {
    remote: true,
    async save(file, buf) {
      const key = keyOf(file);
      const parts = Math.max(1, Math.ceil(buf.length / PIECE));
      for (let i = 0; i < parts; i++)
        await fsc.commit([doc(`${key}.${i}`, { data: firestore.toValue(buf.subarray(i * PIECE, (i + 1) * PIECE)) })]);
      await fsc.commit([doc(key, { parts: firestore.toValue(parts), size: firestore.toValue(buf.length) })]);
    },
    // Brings a missing file back from Firestore. Returns false if Firestore does not have it either.
    async restore(file) {
      const key = keyOf(file);
      const meta = await fsc.get(COLL, key);
      if (!meta) return false;
      const parts = Number(meta.fields.parts.integerValue);
      const bufs = [];
      for (let i = 0; i < parts; i++) {
        const p = await fsc.get(COLL, `${key}.${i}`);
        if (!p) return false;
        bufs.push(firestore.fromValue(p.fields.data));
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, Buffer.concat(bufs), { mode: 0o600 });
      fs.renameSync(tmp, file);
      return true;
    },
    async remove(file) {
      const key = keyOf(file);
      const meta = await fsc.get(COLL, key);
      const parts = meta ? Number(meta.fields.parts.integerValue) : 0;
      await fsc.commit([key, ...Array.from({ length: parts }, (_, i) => `${key}.${i}`)].map((id) => ({ delete: fsc.docName(COLL, id) })));
    },
  };
}

module.exports = { create, keyOf };
