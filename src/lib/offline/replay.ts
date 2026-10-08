// src/lib/offline/replay.ts — Replays queued offline actions (I9.3)
// Called on 'online' event or when service worker posts REPLAY_QUEUE.

import { getPending, markSynced, removeSynced, type QueuedAction } from './queue';

export interface ReplayResult {
  synced: number;
  failed: number;
  /** Check-in offline ditolak karena layanan sudah tutup (dibuang dari antrean). Ada hanya bila > 0. */
  ditolak?: number;
}

async function replayOne(action: QueuedAction): Promise<boolean | 'ditolak'> {
  try {
    let res: Response;
    if (action.type === 'checkin') {
      res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.payload),
      });
    } else if (action.type === 'investasi_lead') {
      res = await fetch('/api/investasi/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.payload),
      });
    } else if (action.type === 'umkm_inquiry') {
      res = await fetch('/api/umkm/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.payload),
      });
    } else {
      return false;
    }
    if (res.status === 409 && action.type === 'checkin') {
      const body = await res.json().catch(() => null);
      if (body?.code === 'LAYANAN_TUTUP') return 'ditolak'; // jangan diulang besok pagi
    }
    return res.ok;
  } catch {
    return false;
  }
}

export async function replayQueue(ownerUserId?: string | null): Promise<ReplayResult> {
  const pending = await getPending(ownerUserId);
  let synced = 0;
  let failed = 0;
  let ditolak = 0;

  for (const action of pending) {
    const ok = await replayOne(action);
    if (ok === 'ditolak') {
      await markSynced(action.id);
      ditolak += 1;
    } else if (ok) {
      await markSynced(action.id);
      synced += 1;
    } else {
      failed += 1;
    }
  }

  await removeSynced();
  return ditolak > 0 ? { synced, failed, ditolak } : { synced, failed };
}
