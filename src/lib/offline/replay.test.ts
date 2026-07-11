// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('@/lib/offline/queue', () => ({
  getPending: vi.fn(),
  markSynced: vi.fn(),
  removeSynced: vi.fn(),
}));

import { replayQueue } from './replay';
import { getPending, markSynced, removeSynced } from './queue';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

describe('I9.3 replayQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns synced=0, failed=0 when queue is empty', async () => {
    (getPending as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await replayQueue();
    expect(result).toEqual({ synced: 0, failed: 0 });
  });

  it('replays checkin action via POST /api/checkin', async () => {
    (getPending as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a1', type: 'checkin', payload: { nama: 'Budi' }, created_at: 1, synced: 0 },
    ]);
    mockFetch.mockResolvedValue({ ok: true });
    const result = await replayQueue();
    expect(mockFetch).toHaveBeenCalledWith('/api/checkin', expect.objectContaining({ method: 'POST' }));
    expect(markSynced).toHaveBeenCalledWith('a1');
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('replays investasi_lead via POST /api/investasi/lead', async () => {
    (getPending as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a2', type: 'investasi_lead', payload: { doc_id: 'd1' }, created_at: 2, synced: 0 },
    ]);
    mockFetch.mockResolvedValue({ ok: true });
    await replayQueue();
    expect(mockFetch).toHaveBeenCalledWith('/api/investasi/lead', expect.objectContaining({ method: 'POST' }));
  });

  it('replays umkm_inquiry via POST /api/umkm/inquiry', async () => {
    (getPending as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a3', type: 'umkm_inquiry', payload: { listing_id: 'l1' }, created_at: 3, synced: 0 },
    ]);
    mockFetch.mockResolvedValue({ ok: true });
    await replayQueue();
    expect(mockFetch).toHaveBeenCalledWith('/api/umkm/inquiry', expect.objectContaining({ method: 'POST' }));
  });

  it('leaves failed actions in queue (does not markSynced)', async () => {
    (getPending as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a4', type: 'checkin', payload: {}, created_at: 4, synced: 0 },
    ]);
    mockFetch.mockResolvedValue({ ok: false });
    const result = await replayQueue();
    expect(markSynced).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
  });

  it('removes synced entries after replay', async () => {
    (getPending as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await replayQueue();
    expect(removeSynced).toHaveBeenCalled();
  });

  it('handles fetch throw as failure', async () => {
    (getPending as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a5', type: 'checkin', payload: {}, created_at: 5, synced: 0 },
    ]);
    mockFetch.mockRejectedValue(new Error('network'));
    const result = await replayQueue();
    expect(result.failed).toBe(1);
    expect(markSynced).not.toHaveBeenCalled();
  });
});
