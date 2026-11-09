// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const { rpc, invalidasiKatalog } = vi.hoisted(() => ({ rpc: vi.fn(), invalidasiKatalog: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, auth: {
  getUser: async () => ({ data: { user: { id: 'uid' } }, error: null }),
} }) }));
vi.mock('@/lib/umkm-katalog/foto-server', () => ({ invalidasiKatalog }));
import { GET, POST } from './route';
import { GET as CSV } from './export/route';
beforeEach(() => { vi.clearAllMocks(); });
it('sakelar admin menginvalidasi cache, laporan meneruskan cursor ke DB', async () => {
  rpc.mockResolvedValue({ data: { telemetri_opsional_aktif: false }, error: null });
  const r = await POST(new Request('https://lmh.example/api/admin/umkm-laporan', {
    method: 'POST', body: JSON.stringify({ aktif: false, versi_naskah: 'v1', kebijakan_terbit: false }),
  }));
  expect(r.status).toBe(200);
  expect(invalidasiKatalog).toHaveBeenCalledOnce();
  rpc.mockResolvedValue({ data: { profil_statistik: [], next_cursor: null }, error: null });
  expect((await GET(new Request('https://lmh.example/api/admin/umkm-laporan'))).status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith('umkm_laporan_statistik', { p_cursor: null });
  rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'DILARANG' } });
  expect((await GET(new Request('https://lmh.example/api/admin/umkm-laporan'))).status).toBe(403);
});
it('CSV sekali unduh, formula dinetralkan, angka mati berlabel dan tidak memuat kontak', async () => {
  rpc.mockResolvedValue({ data: { profil: { terbit: 1 }, suka: 2, dilihat: null, tanpa_hasil: null,
    pesan: { baru: 1, ditangani: 2 }, laporan: { baru: 0, ditangani: 1 },
    profil_statistik: [{ id: 'profil', nama: '=1+1', suka: 2, dilihat: null, klik_formulir: null }],
    kelompok_tanpa_hasil: [], next_cursor: null }, error: null });
  const r = await CSV(new Request('https://lmh.example/api/admin/umkm-laporan/export'));
  expect(r.headers.get('content-type')).toContain('text/csv');
  expect(r.headers.get('X-Next-Cursor')).toBeNull();
  const csv = await r.text();
  expect(csv).toContain("'=1+1");
  expect(csv).toContain('belum dicatat');
  expect(csv).toContain('masa simpan 180 hari');
  expect(csv).not.toMatch(/nomor|kontak|aktor_uid/);
  expect(rpc).toHaveBeenCalledWith('umkm_ekspor_statistik', {});
});
