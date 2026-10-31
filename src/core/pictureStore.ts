/**
 * The pictures behind past work, kept in this browser only.
 *
 * Work is remembered in the account without its picture; where the same
 * computer still has the picture, it can be opened again without choosing it.
 * Nothing here is sent anywhere, and it does not follow the person to another
 * computer: there the picture has to be chosen again, and checked.
 */

const DB = "litogen-pictures";
const STORE = "pictures";
/** The newest this many are kept. */
const KEEP = 20;

type Stored = { hash: string; name: string; type: string; at: number; blob: Blob };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "hash" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          resolve(req.result);
          db.close();
        };
        tx.onerror = () => {
          reject(tx.error);
          db.close();
        };
      }),
  );
}

/** Keeps a picture under its fingerprint; failures (private windows, a full disk) are not worth reporting. */
export async function keepPicture(hash: string, file: File): Promise<void> {
  try {
    const entry: Stored = { hash, name: file.name, type: file.type, at: Date.now(), blob: file };
    await run("readwrite", (s) => s.put(entry));
    const all = (await run("readonly", (s) => s.getAll())) as Stored[];
    const extra = all.sort((a, b) => b.at - a.at).slice(KEEP);
    for (const e of extra) await run("readwrite", (s) => s.delete(e.hash));
  } catch {
    /* nothing to do */
  }
}

/** The picture with this fingerprint, if this browser still has it. */
export async function findPicture(hash: string): Promise<File | null> {
  try {
    const e = (await run("readonly", (s) => s.get(hash))) as Stored | undefined;
    return e ? new File([e.blob], e.name, { type: e.type }) : null;
  } catch {
    return null;
  }
}

/** Which of these fingerprints this browser has the picture for. */
export async function havePictures(hashes: string[]): Promise<Set<string>> {
  try {
    const keys = (await run("readonly", (s) => s.getAllKeys())) as string[];
    const have = new Set(keys);
    return new Set(hashes.filter((h) => have.has(h)));
  } catch {
    return new Set();
  }
}

export async function forgetPictures(): Promise<void> {
  try {
    await run("readwrite", (s) => s.clear());
  } catch {
    /* nothing to do */
  }
}
