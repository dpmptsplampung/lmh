import { afterEach, describe, expect, it, vi } from 'vitest';
import { unggahKeR2 } from './unggah';

afterEach(() => vi.unstubAllGlobals());

describe('unggah R2', () => {
  it.each(['umkm-draf', 'umkm-photos'] as const)('konfirmasi %s memakai path sesuai kontrak area', async area => {
    const path = 'lokal.jpg';
    const serverPath = '660e8400-e29b-41d4-a716-446655440001.jpg';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        uploadUrl: 'https://r2.example/put', kunci: `${area}/${serverPath}`, headers: { 'Content-Type': 'image/jpeg' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ kunci: `${area}/${serverPath}` }));
    vi.stubGlobal('fetch', fetchMock);
    await unggahKeR2(area, path, new Blob(['foto'], { type: 'image/jpeg' }));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      area, path: area === 'umkm-draf' ? serverPath : path,
    });
  });
});
