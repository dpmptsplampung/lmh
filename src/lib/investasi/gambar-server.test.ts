// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/storage/r2', () => ({ getObjectBytes: vi.fn(), headObject: vi.fn(), putObject: vi.fn(), deleteObjects: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));
import { deleteObjects, getObjectBytes, headObject, putObject } from '@/lib/storage/r2';
import { kunciMentahSah, olahGambarIpro } from './gambar-server';
import { ID, LAIN_ID } from '@/app/api/admin/ipro/uji-fixture';
const raw = `ipro-mentah/${ID}/${LAIN_ID}.jpg`;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(headObject).mockResolvedValue({ size: 100, contentType: 'image/jpeg' });
  vi.mocked(deleteObjects).mockResolvedValue(undefined); vi.mocked(putObject).mockResolvedValue(undefined); });
it('menghasilkan WebP dan mini, menghapus metadata serta mentah', async () => {
  const bytes = await sharp({ create: { width: 1800, height: 900, channels: 3, background: 'red' } })
    .withMetadata({ exif: { IFD0: { Copyright: 'Lembaga' } } }).jpeg().toBuffer();
  vi.mocked(getObjectBytes).mockResolvedValue(bytes);
  const r = await olahGambarIpro(ID, raw);
  expect(r).toMatchObject({ lebar: 1600, tinggi: 800 });
  expect(r.kunci_mini).toMatch(/-640.webp$/);
  const [utama, mini] = vi.mocked(putObject).mock.calls;
  const meta = await sharp(utama[2]).metadata();
  expect(meta.format).toBe('webp'); expect(meta.exif).toBeUndefined(); expect(meta.icc).toBeUndefined();
  expect((await sharp(mini[2]).metadata()).width).toBe(640);
  expect(deleteObjects).toHaveBeenCalledWith('private', [raw]);
});
it('menolak IDOR/path berbahaya sebelum R2', async () => {
  expect(kunciMentahSah(raw, LAIN_ID)).toBe(false);
  await expect(olahGambarIpro(LAIN_ID, raw)).rejects.toThrow('INPUT_TIDAK_VALID');
  expect(getObjectBytes).not.toHaveBeenCalled();
});
it.each(['<svg><script>alert(1)</script></svg>', '<html>skrip</html>', 'RIFF0000WEBPbroken'])('menghapus input yang gagal decode %s', async teks => {
  vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(teks));
  await expect(olahGambarIpro(ID, raw)).rejects.toThrow('INPUT_TIDAK_VALID');
  expect(deleteObjects).toHaveBeenCalledWith('private', [raw]);
  expect(putObject).not.toHaveBeenCalled();
});
it('menolak ukuran mentah berlebih sebelum mengambil bytes', async () => {
  vi.mocked(headObject).mockResolvedValue({ size: 8 * 1024 * 1024 + 1, contentType: 'image/jpeg' });
  await expect(olahGambarIpro(ID, raw)).rejects.toThrow('INPUT_TIDAK_VALID');
  expect(getObjectBytes).not.toHaveBeenCalled();
});
it('membatasi tinggi hasil 4000 dan memperbaiki orientasi EXIF', async () => {
  vi.mocked(getObjectBytes).mockResolvedValue(await sharp({ create: { width: 20, height: 5000, channels: 3, background: 'red' } }).jpeg().toBuffer());
  const tegak = await olahGambarIpro(ID, raw);
  expect(tegak.tinggi).toBe(4000); expect(tegak.lebar).toBe(16);
  vi.mocked(getObjectBytes).mockResolvedValue(await sharp({ create: { width: 960, height: 480, channels: 3, background: 'red' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer());
  const putar = await olahGambarIpro(ID, raw);
  expect(putar.lebar).toBe(480); expect(putar.tinggi).toBe(960);
});
it('membersihkan hasil parsial ketika penyimpanan gagal', async () => {
  vi.mocked(getObjectBytes).mockResolvedValue(await sharp({ create: { width: 10, height: 10, channels: 3, background: 'blue' } }).png().toBuffer());
  vi.mocked(putObject).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('gagal'));
  await expect(olahGambarIpro(ID, raw)).rejects.toThrow('GAGAL_INTERNAL');
  expect(deleteObjects).toHaveBeenCalledWith('public', [expect.stringMatching(/\.webp$/), expect.stringMatching(/-640.webp$/)]);
});
