// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  enqueueAction,
  getQueue,
  getPending,
  markSynced,
  removeSynced,
  clearQueue,
  type QueuedAction,
} from './queue';

describe('I9.2 offline queue (IndexedDB)', () => {
  beforeEach(() => {
    // Reset fake-indexeddb state between tests
    return clearQueue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueueAction stores an action and returns an id', async () => {
    const id = await enqueueAction({
      type: 'checkin',
      payload: { nama: 'Budi', layanan_id: 'lay-1' },
    });
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('enqueued action appears in getQueue', async () => {
    const id = await enqueueAction({
      type: 'checkin',
      payload: { nama: 'Siti' },
    });
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    const action = queue[0] as QueuedAction;
    expect(action.id).toBe(id);
    expect(action.type).toBe('checkin');
    expect(action.payload.nama).toBe('Siti');
    expect(action.synced).toBe(0);
    expect(action.created_at).toBeGreaterThan(0);
  });

  it('getPending returns only synced=0 actions', async () => {
    await enqueueAction({ type: 'checkin', payload: { nama: 'A' } });
    const id2 = await enqueueAction({ type: 'checkin', payload: { nama: 'B' } });
    await markSynced(id2);

    const pending = await getPending();
    expect(pending).toHaveLength(1);
    expect((pending[0] as QueuedAction).payload.nama).toBe('A');
  });

  it('markSynced moves action out of getPending', async () => {
    const id = await enqueueAction({
      type: 'investasi_lead',
      payload: { doc_id: 'd-1' },
    });
    let pending = await getPending();
    expect(pending).toHaveLength(1);

    await markSynced(id);
    pending = await getPending();
    expect(pending).toHaveLength(0);

    const all = await getQueue();
    expect(all).toHaveLength(1);
    expect((all[0] as QueuedAction).synced).toBe(1);
  });

  it('removeSynced removes only synced entries', async () => {
    const id1 = await enqueueAction({ type: 'checkin', payload: { nama: 'X' } });
    const id2 = await enqueueAction({ type: 'checkin', payload: { nama: 'Y' } });
    await markSynced(id1);

    await removeSynced();

    const all = await getQueue();
    expect(all).toHaveLength(1);
    expect((all[0] as QueuedAction).id).toBe(id2);
    expect((all[0] as QueuedAction).synced).toBe(0);
  });

  it('clearQueue empties the store', async () => {
    await enqueueAction({ type: 'checkin', payload: {} });
    await enqueueAction({ type: 'umkm_inquiry', payload: {} });
    await enqueueAction({ type: 'investasi_lead', payload: {} });

    await clearQueue();
    const queue = await getQueue();
    expect(queue).toHaveLength(0);
  });

  it('getQueue returns empty array when IndexedDB unavailable', async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulate private mode
    globalThis.indexedDB = undefined;
    try {
      const queue = await getQueue();
      expect(queue).toEqual([]);
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it('stores owner_user_id when provided on enqueue', async () => {
    const id = await enqueueAction({
      type: 'checkin',
      payload: { nama: 'Owned' },
      owner_user_id: 'user-a',
    });
    const queue = await getQueue();
    const action = queue.find((a) => a.id === id) as QueuedAction;
    expect(action.owner_user_id).toBe('user-a');
  });

  it('getPending(owner) returns only that owner actions', async () => {
    await enqueueAction({
      type: 'checkin',
      payload: { nama: 'A' },
      owner_user_id: 'user-a',
    });
    await enqueueAction({
      type: 'checkin',
      payload: { nama: 'B' },
      owner_user_id: 'user-b',
    });
    await enqueueAction({
      type: 'checkin',
      payload: { nama: 'Anon' },
    });

    const pendingA = await getPending('user-a');
    expect(pendingA).toHaveLength(1);
    expect(pendingA[0]?.payload.nama).toBe('A');

    const pendingAll = await getPending();
    expect(pendingAll).toHaveLength(3);
  });
});
