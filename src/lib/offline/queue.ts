// src/lib/offline/queue.ts — IndexedDB offline action queue (I9.2)
// Antrean offline HANYA untuk Front Office (audit T3): pendaftaran walk-in ('fo_walkin') yang ditulis saat
// jaringan putus. Diputar ulang oleh replay.ts (saat 'online', saat halaman dibuka, atau Background Sync).
// Pengunjung tidak lagi menulis apa pun dari klien, sehingga tipe lama ('checkin', 'investasi_lead',
// 'umkm_inquiry') tidak dibuat lagi; rekaman lama di perangkat dibuang oleh replay.

export type ActionType = 'fo_walkin';

export interface QueuedAction {
  id: string;
  /** Bisa berisi tipe lama dari versi aplikasi sebelumnya (dibuang saat replay). */
  type: ActionType | (string & {});
  payload: Record<string, unknown>;
  created_at: number;
  synced: 0 | 1;
  /** Auth user id pemilik antrean — item milik akun lain di perangkat bersama TIDAK diputar ulang. */
  owner_user_id?: string | null;
}

const DB_NAME = 'lmh-offline';
const DB_VERSION = 2;
const STORE_NAME = 'queue';

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      } else {
        store = request.transaction!.objectStore(STORE_NAME);
      }
      if (!store.indexNames.contains('owner_user_id')) {
        store.createIndex('owner_user_id', 'owner_user_id', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export async function enqueueAction(
  action: { type: ActionType; payload: Record<string, unknown>; owner_user_id: string },
): Promise<string> {
  if (!action.owner_user_id) throw new Error('owner_user_id wajib untuk antrean offline');
  const id = generateId();
  const record: QueuedAction = {
    id,
    type: action.type,
    payload: action.payload,
    created_at: Date.now(),
    synced: 0,
    owner_user_id: action.owner_user_id,
  };
  const db = await openDB();
  return new Promise<string>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(record);
    tx.oncomplete = () => {
      db.close();
      resolve(id);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('enqueue failed'));
    };
  });
}

export async function getQueue(): Promise<QueuedAction[]> {
  if (!isIndexedDBAvailable()) return [];
  try {
    const db = await openDB();
    return new Promise<QueuedAction[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        db.close();
        resolve((req.result as QueuedAction[]) ?? []);
      };
      req.onerror = () => {
        db.close();
        reject(req.error ?? new Error('getQueue failed'));
      };
    });
  } catch {
    return [];
  }
}

/**
 * `ownerUserId` tidak diberikan (undefined) = semua item (hanya untuk diagnosis). Diberikan tetapi kosong/null
 * (pemilik tidak diketahui) = TIDAK ADA item: jangan pernah memutar ulang antrean orang lain (audit T3c).
 */
export async function getPending(ownerUserId?: string | null): Promise<QueuedAction[]> {
  const all = await getQueue();
  const pending = all.filter((a) => a.synced === 0);
  if (ownerUserId === undefined) return pending;
  if (ownerUserId === null || ownerUserId === '') return [];
  return pending.filter((a) => a.owner_user_id === ownerUserId);
}

export async function markSynced(id: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result as QueuedAction | undefined;
      if (record) {
        record.synced = 1;
        store.put(record);
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('markSynced failed'));
    };
  });
}

export async function removeSynced(): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const idx = store.index('synced');
    const req = idx.openCursor(IDBKeyRange.only(1));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('removeSynced failed'));
    };
  });
}

export async function clearQueue(): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('clearQueue failed'));
    };
  });
}
