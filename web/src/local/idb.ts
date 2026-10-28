// Tiny IndexedDB wrapper for the on-device edition. Every record lives only in
// this browser (per device); nothing is sent anywhere except AI requests.

const DB_NAME = "jarvis";
const STORES = ["conversations", "messages", "tasks", "events", "notes", "memories", "kv"] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        if (name === "kv") db.createObjectStore(name);
        else db.createObjectStore(name, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Storage is blocked by another JARVIS tab. Close it and retry."));
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? new Error("Storage transaction aborted (device storage may be full)."));
      }),
  );
}

export function table<T extends { id: number }>(name: Exclude<StoreName, "kv">) {
  return {
    all: () => run<T[]>(name, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
    get: (id: number) => run<T | undefined>(name, "readonly", (s) => s.get(id) as IDBRequest<T | undefined>),
    /** Inserts (when id is absent) or replaces; resolves to the full record. */
    async put(record: Omit<T, "id"> & { id?: number }): Promise<T> {
      const id = await run<IDBValidKey>(name, "readwrite", (s) => s.put(record));
      return { ...record, id: Number(id) } as T;
    },
    delete: (id: number) => run(name, "readwrite", (s) => s.delete(id)),
    clear: () => run(name, "readwrite", (s) => s.clear()),
  };
}

export const kv = {
  get: <T>(key: string) => run<T | undefined>("kv", "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  set: (key: string, value: unknown) => run("kv", "readwrite", (s) => s.put(value, key)),
  delete: (key: string) => run("kv", "readwrite", (s) => s.delete(key)),
};

export async function eraseEverything() {
  for (const name of STORES) await run(name, "readwrite", (s) => s.clear());
}

/** Ask the browser not to evict our data under storage pressure. */
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
