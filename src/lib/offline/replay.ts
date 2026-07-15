// src/lib/offline/replay.ts — Replays queued offline actions (I9.3)
// Called on 'online' event or when service worker posts REPLAY_QUEUE.

import { getPending, markSynced, removeSynced, type QueuedAction } from './queue';

export interface ReplayResult {
  synced: number;
  failed: number;
}

async function replayOne(action: QueuedAction): Promise<boolean> {
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
    return res.ok;
  } catch {
    return false;
  }
}

export async function replayQueue(ownerUserId?: string | null): Promise<ReplayResult> {
  const pending = await getPending(ownerUserId);
  let synced = 0;
  let failed = 0;

  for (const action of pending) {
    const ok = await replayOne(action);
    if (ok) {
      await markSynced(action.id);
      synced += 1;
    } else {
      failed += 1;
    }
  }

  await removeSynced();
  return { synced, failed };
}
