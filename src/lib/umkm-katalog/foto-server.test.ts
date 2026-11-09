// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({
  r2Tersedia: vi.fn(), bucketTerpisah: vi.fn(), headObject: vi.fn(), copyObject: vi.fn(), deleteObjects: vi.fn(),
  urlPublik: (key: string) => `https://foto.example/${key}`,
}));
import { revalidateTag } from 'next/cache';
import { bucketTerpisah, r2Tersedia, headObject, copyObject, deleteObjects } from '@/lib/storage/r2';
import { hapusFotoPublik, publikasiFoto, setelahPutusan, setelahVisibilitas } from './foto-server';
const id = '660e8400-e29b-41d4-a716-446655440001';
const fotoId = '660e8400-e29b-41d4-a716-446655440002';
type JawabanRpc = {
  data: { status?: string; dipegang_saya?: boolean; foto?: unknown[];
    foto_disetujui?: { id: string; asal: string; perlu_review: boolean; tersembunyi: boolean;
      r2_key: string; r2_key_publik: string | null }[];
    total?: number; items?: { id: string; r2_key_publik: string }[]; id?: string } | null;
  error: { message: string } | null;
};
let rpc: ReturnType<typeof vi.fn<(nama: string, args?: Record<string, string>) => Promise<JawabanRpc>>>;
let urutan: string[];
const client = () => ({ rpc } as unknown as SupabaseClient);
beforeEach(() => {
  vi.clearAllMocks(); urutan = [];
  vi.mocked(r2Tersedia).mockReturnValue(true);
  vi.mocked(bucketTerpisah).mockReturnValue(true);
  vi.mocked(headObject).mockResolvedValue({ etag: '"abcd"', size: 120, contentType: 'image/jpeg' });
  vi.mocked(copyObject).mockImplementation(async () => { urutan.push('salin'); });
  vi.mocked(deleteObjects).mockResolvedValue();
  rpc = vi.fn(async (nama: string) => {
    urutan.push(nama);
    if (nama==='umkm_detail_tugas') return { data: { status: 'terbit', dipegang_saya: true,
      foto: [], foto_disetujui: [{ id: fotoId, asal: 'unggahan', perlu_review: false, tersembunyi: false,
        r2_key: `umkm-draf/${fotoId}.jpg`, r2_key_publik: null }] }, error: null };
    if (nama==='umkm_antrian_hapus_foto') return { data: { items: [{ id: fotoId,
      r2_key_publik: `umkm-katalog/${fotoId}.jpg` }] }, error: null };
    return { data: { id: fotoId }, error: null };
  });
});
describe('publikasi foto sesudah keputusan commit', () => {
  it('salin bersyarat bukti ETag lalu tautkan dahulu sebelum hapus copy lama', async () => {
    expect(await publikasiFoto(client(), id)).toEqual({ status: 'selesai', tertunda: 0, hapus_tertunda: 0 });
    expect(rpc).toHaveBeenCalledWith('umkm_bukti_foto', {
      p_profil_id: id, p_foto_id: fotoId, p_etag: '"abcd"', p_ukuran: 120, p_tipe: 'image/jpeg',
    });
    expect(copyObject).toHaveBeenCalledWith('private', `umkm-draf/${fotoId}.jpg`, 'public',
      expect.stringMatching(/^umkm-katalog\/[a-f0-9-]{36}\.jpg$/), '"abcd"');
    expect(urutan.indexOf('umkm_rencana_foto')).toBeLessThan(urutan.indexOf('salin'));
    expect(urutan.indexOf('umkm_terbitkan_foto')).toBeLessThan(urutan.indexOf('umkm_antrian_hapus_foto'));
    expect(revalidateTag).toHaveBeenCalledWith('umkm-katalog', { expire: 0 });
  });
  it.each(['tanpa-konfigurasi', 'salin-gagal'])('%s tetap mengembalikan keputusan terbit', async keadaan => {
    if (keadaan==='tanpa-konfigurasi') vi.mocked(r2Tersedia).mockReturnValue(false);
    else vi.mocked(copyObject).mockRejectedValue(new Error('rincian privat penyimpanan'));
    const hasil = await setelahPutusan({ id, status: 'terbit', versi: 3 }, client());
    expect(hasil).toMatchObject({ id, status: 'terbit', versi: 3,
      foto_publikasi: { status: 'tertunda', tertunda: 1,
        hapus_tertunda: keadaan === 'tanpa-konfigurasi' ? 1 : 0 } });
    expect(JSON.stringify(hasil)).not.toContain('rincian privat');
    expect(rpc.mock.calls.map(c => c[0])).not.toContain('umkm_terbitkan_foto');
  });
  it.each([
    { size: 120, contentType: 'image/jpeg' },
    { etag: '"abcd"', size: 2097153, contentType: 'image/jpeg' },
    { etag: '"abcd"', size: 120, contentType: 'application/pdf' },
  ])('menolak bukti HEAD yang hilang atau tidak sesuai', async head => {
    vi.mocked(headObject).mockResolvedValue(head);
    expect(await publikasiFoto(client(), id)).toEqual({ status: 'tertunda', tertunda: 1, hapus_tertunda: 0 });
    expect(copyObject).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(c => c[0])).not.toContain('umkm_bukti_foto');
  });
});

describe('pemulihan foto tanpa menghapus pointer aktif', () => {
  it.each([true, false])('penautan commit=%s dengan respons hilang tetap memakai antrean', async commit => {
    const semula = rpc.getMockImplementation()!;
    let pointer: string | null = null;
    rpc.mockImplementation(async (nama: string, args?: Record<string, string>) => {
      if (nama === 'umkm_antrian_hapus_foto') return { data: { items: [] }, error: null };
      if (nama === 'umkm_terbitkan_foto') {
        if (commit) pointer = args!.p_r2_key_publik;
        return { data: null, error: { message: 'Koneksi terputus' } };
      }
      const hasil = await semula(nama);
      if (nama === 'umkm_detail_tugas' && pointer && hasil.data?.foto_disetujui) {
        hasil.data.foto_disetujui[0].r2_key_publik = pointer;
      }
      return hasil;
    });
    expect((await publikasiFoto(client(), id)).tertunda).toBe(1);
    expect(deleteObjects).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('umkm_rencana_foto', expect.objectContaining({ p_foto_id: fotoId }));
    const salinan = vi.mocked(copyObject).mock.calls.length;
    const ulang = await publikasiFoto(client(), id);
    expect(ulang.tertunda).toBe(commit ? 0 : 1);
    expect(copyObject).toHaveBeenCalledTimes(salinan + (commit ? 0 : 1));
    expect(deleteObjects).not.toHaveBeenCalled();
  });
  it('rencana gagal mencegah penyalinan', async () => {
    const semula = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (nama: string) => nama === 'umkm_rencana_foto'
      ? { error: { message: 'Gagal mencatat rencana' }, data: null } : semula(nama));
    expect((await publikasiFoto(client(), id)).tertunda).toBe(1);
    expect(copyObject).not.toHaveBeenCalled();
  });
  it('hapus yang gagal tetap dihitung pada retry', async () => {
    vi.mocked(deleteObjects).mockRejectedValue(new Error('Penyimpanan gagal'));
    expect(await publikasiFoto(client(), id)).toEqual({ status: 'tertunda', tertunda: 0, hapus_tertunda: 1 });
    expect(rpc.mock.calls.map(c => c[0])).not.toContain('umkm_selesai_hapus_foto');
  });
  it('penutupan FO ditolak sesudah objek terhapus tidak dihitung gagal', async () => {
    const semula = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (nama: string) => nama === 'umkm_selesai_hapus_foto'
      ? { error: { message: 'DILARANG' }, data: null } : semula(nama));
    expect(await hapusFotoPublik(client(), id)).toBe(0);
    expect(await setelahVisibilitas({ id }, client())).toMatchObject({ id,
      foto_publikasi: { status: 'selesai', tertunda: 0, hapus_tertunda: 0 } });
  });
  it('galat membaca antrean dihitung tertunda', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Koneksi putus' } });
    expect(await hapusFotoPublik(client(), id)).toBe(1);
  });
  it('penyimpanan tidak tersedia menghitung semua item antrean', async () => {
    vi.mocked(r2Tersedia).mockReturnValue(false);
    expect(await hapusFotoPublik(client(), id)).toBe(1);
    expect(deleteObjects).not.toHaveBeenCalled();
  });
});

it('bucket sama tidak membaca atau menyalin draf', async () => {
  vi.mocked(bucketTerpisah).mockReturnValue(false);
  expect((await publikasiFoto(client(), id)).tertunda).toBe(1);
  expect(headObject).not.toHaveBeenCalled();
  expect(copyObject).not.toHaveBeenCalled();
});

it('sisa antrean di luar batas batch tetap dihitung tertunda', async () => {
  rpc.mockResolvedValue({ data: { total: 3, items: [{ id: fotoId, r2_key_publik: 'umkm-katalog/lama.jpg' }] },
    error: null });
  expect(await hapusFotoPublik(client(), id)).toBe(2);
});
it('galat transport penutupan antrean tetap terlihat untuk dicoba lagi', async () => {
  const semula = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (nama: string) => nama === 'umkm_selesai_hapus_foto'
    ? { data: null, error: { message: 'Koneksi putus' } } : semula(nama));
  expect(await hapusFotoPublik(client(), id)).toBe(1);
});
