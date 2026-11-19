// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/storage/r2', () => ({ listObjects: vi.fn(), deleteObjects: vi.fn(async () => {}) }));
vi.mock('@/lib/time', () => ({ nowServer: () => new Date('2026-11-20T00:00:00Z') }));
import { listObjects, deleteObjects } from '@/lib/storage/r2';
import { bersihkanRawLama } from './unggahan';
const path = 'investment-docs/raw/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/11111111-1111-4111-8111-111111111111.pdf';
beforeEach(() => { vi.clearAllMocks(); });
describe('rekonsiliasi raw yang tertinggal', () => {
  it('hanya menghapus raw sah lebih tua dari 24 jam, mengembalikan cursor tanpa memindai tak terbatas', async () => {
    vi.mocked(listObjects).mockResolvedValueOnce({ items: [
      { key: path, lastModified: new Date('2026-11-18T23:59:59Z') },
      { key: path.replace('11111111', '22222222'), lastModified: new Date('2026-11-19T00:00:00Z') },
      { key: path.replace('11111111', '33333333'), lastModified: new Date('2026-11-19T23:59:00Z') },
      { key: 'investment-docs/src/document.pdf', lastModified: new Date('2020-01-01') },
      { key: 'investment-docs/raw/tidak-sah.pdf', lastModified: new Date('2020-01-01') },
    ], nextCursor: 'lanjutan' });
    expect(await bersihkanRawLama('mulai')).toEqual({ dihapus: 1, cursor: 'lanjutan' });
    expect(listObjects).toHaveBeenCalledExactlyOnceWith('private', 'investment-docs/raw/', 'mulai');
    expect(deleteObjects).toHaveBeenCalledExactlyOnceWith('private', [path]);
  });
  it('kegagalan hapus dapat dicoba kembali dari cursor yang sama', async () => {
    vi.mocked(listObjects).mockResolvedValue({ items: [{ key: path, lastModified: new Date('2020-01-01') }], nextCursor: null });
    vi.mocked(deleteObjects).mockRejectedValueOnce(new Error('storage gagal'));
    await expect(bersihkanRawLama()).rejects.toThrow('storage gagal');
    expect(await bersihkanRawLama()).toEqual({ dihapus: 1, cursor: null });
  });
});
