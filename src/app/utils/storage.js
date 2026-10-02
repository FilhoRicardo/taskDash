// Device-local state (timer, saved filters, write backups). localStorage and
// IndexedDB are shared across every vault on a device, so all keys and the
// database name are namespaced by a scope the host sets (the plugin passes the
// vault's app id; the web/demo build leaves it empty).
let scope = '';
export function setStorageScope(id) {
  scope = id ? String(id) : '';
}
const scoped = k => (scope ? `${scope}:${k}` : k);

const DB = 'taskdash_v1', ST = 'handles';
const openDB = () => new Promise((res, rej) => {
  const r = indexedDB.open(scope ? `${DB}_${scope}` : DB, 1);
  r.onupgradeneeded = e => e.target.result.createObjectStore(ST);
  r.onsuccess = e => res(e.target.result);
  r.onerror = () => rej(r.error);
});
export async function idbSet(k, v) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(ST, 'readwrite');
    tx.objectStore(ST).put(v, k);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
export async function idbGet(k) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(ST, 'readonly');
    const r = tx.objectStore(ST).get(k);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function idbDel(k) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(ST, 'readwrite');
    tx.objectStore(ST).delete(k);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
export const lsGet = k => { try { const v = localStorage.getItem(scoped(k)); return v ? JSON.parse(v) : null; } catch { return null; } };
export const lsSet = (k, v) => { try { localStorage.setItem(scoped(k), JSON.stringify(v)); } catch {} };
export const lsDel = k => { try { localStorage.removeItem(scoped(k)); } catch {} };
