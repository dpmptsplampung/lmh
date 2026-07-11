// src/lib/offline/queue.ts — IndexedDB offline action queue (I9.2)
// Stores user actions (checkin, investasi_lead, umkm_inquiry) when offline,
// replayed by replay.ts when connection is restored or background sync fires.

export type ActionType = 'checkin' | 'investasi_lead' | 'umkm_inquiry';

export interface QueuedAction {
  id: string;
  type: ActionType;
  payload: Record<string, unknown>;
  created_at: number;
  synced: 0 | 1;
}

const DB_NAME = 'lmh-offline';
const DB_VERSION = 1;
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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('type', 'type', { unique: false });
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
  action: Omit<QueuedAction, 'id' | 'created_at' | 'synced'>,
): Promise<string> {
  const id = generateId();
  const record: QueuedAction = {
    id,
    type: action.type,
    payload: action.payload,
    created_at: Date.now(),
    synced: 0,
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

export async function getPending(): Promise<QueuedAction[]> {
  const all = await getQueue();
  return all.filter((a) => a.synced === 0);
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
