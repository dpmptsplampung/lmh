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

describe('I9.2 offline queue (IndexedDB) — hanya pendaftaran walk-in FO', () => {
  beforeEach(() => {
    // Reset fake-indexeddb state between tests
    return clearQueue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueueAction stores an action and returns an id', async () => {
    const id = await enqueueAction({
      type: 'fo_walkin',
      payload: { p_nama: 'Budi' },
      owner_user_id: 'user-a',
    });
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('menolak antrean tanpa pemilik (T3c)', async () => {
    await expect(
      enqueueAction({ type: 'fo_walkin', payload: {}, owner_user_id: '' }),
    ).rejects.toThrow(/owner_user_id/);
    expect(await getQueue()).toHaveLength(0);
  });

  it('enqueued action appears in getQueue', async () => {
    const id = await enqueueAction({
      type: 'fo_walkin',
      payload: { p_nama: 'Siti' },
      owner_user_id: 'user-a',
    });
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    const action = queue[0] as QueuedAction;
    expect(action.id).toBe(id);
    expect(action.type).toBe('fo_walkin');
    expect(action.payload.p_nama).toBe('Siti');
    expect(action.synced).toBe(0);
    expect(action.owner_user_id).toBe('user-a');
    expect(action.created_at).toBeGreaterThan(0);
  });

  it('getPending returns only synced=0 actions', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: { p_nama: 'A' }, owner_user_id: 'u' });
    const id2 = await enqueueAction({ type: 'fo_walkin', payload: { p_nama: 'B' }, owner_user_id: 'u' });
    await markSynced(id2);

    const pending = await getPending();
    expect(pending).toHaveLength(1);
    expect((pending[0] as QueuedAction).payload.p_nama).toBe('A');
  });

  it('markSynced moves action out of getPending', async () => {
    const id = await enqueueAction({ type: 'fo_walkin', payload: {}, owner_user_id: 'u' });
    expect(await getPending()).toHaveLength(1);

    await markSynced(id);
    expect(await getPending()).toHaveLength(0);

    const all = await getQueue();
    expect(all).toHaveLength(1);
    expect((all[0] as QueuedAction).synced).toBe(1);
  });

  it('removeSynced removes only synced entries', async () => {
    const id1 = await enqueueAction({ type: 'fo_walkin', payload: { p_nama: 'X' }, owner_user_id: 'u' });
    const id2 = await enqueueAction({ type: 'fo_walkin', payload: { p_nama: 'Y' }, owner_user_id: 'u' });
    await markSynced(id1);

    await removeSynced();

    const all = await getQueue();
    expect(all).toHaveLength(1);
    expect((all[0] as QueuedAction).id).toBe(id2);
    expect((all[0] as QueuedAction).synced).toBe(0);
  });

  it('clearQueue empties the store', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: {}, owner_user_id: 'u' });
    await enqueueAction({ type: 'fo_walkin', payload: {}, owner_user_id: 'u' });

    await clearQueue();
    expect(await getQueue()).toHaveLength(0);
  });

  it('getQueue returns empty array when IndexedDB unavailable', async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulate private mode
    globalThis.indexedDB = undefined;
    try {
      expect(await getQueue()).toEqual([]);
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it('getPending(owner) returns only that owner actions', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: { p_nama: 'A' }, owner_user_id: 'user-a' });
    await enqueueAction({ type: 'fo_walkin', payload: { p_nama: 'B' }, owner_user_id: 'user-b' });

    const pendingA = await getPending('user-a');
    expect(pendingA).toHaveLength(1);
    expect(pendingA[0]?.payload.p_nama).toBe('A');

    expect(await getPending()).toHaveLength(2); // tanpa argumen = semua (diagnosis)
  });

  it('getPending(null | "") TIDAK mengembalikan apa pun: pemilik tak diketahui jangan memutar antrean orang lain (T3c)', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: {}, owner_user_id: 'user-a' });
    expect(await getPending(null)).toEqual([]);
    expect(await getPending('')).toEqual([]);
  });
});
