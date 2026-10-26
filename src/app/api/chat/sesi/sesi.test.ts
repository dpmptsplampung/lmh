import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Tahap C: route /api/chat/sesi hanya meneruskan aksi staf ke RPC chat_ambil / chat_teruskan / chat_selesai lewat
// klien ber-JWT pengguna (bukan service_role) dan menerjemahkan galat RPC ke status HTTP + pesan Indonesia.
// Kontrak: docs/analysis/FO-CHAT-KONTRAK-RPC.md §2, §5.

const state = vi.hoisted(() => ({
  callerId: 'auth-staff-1' as string | null,
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: state.callerId ? { id: state.callerId } : null },
        error: null,
      })),
    },
    rpc: state.rpc,
    from: () => {
      throw new Error('route tidak boleh menulis/membaca tabel langsung');
    },
  })),
}));

// Service-role TIDAK boleh dibuat: bila dipanggil, test gagal.
const serviceCreate = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({ createClient: serviceCreate }));

const SESI = '3f2504e0-4f89-41d3-8a0c-0305e82c3301';
const LAYANAN = '5b6d3e5a-9f4a-4b0b-8a5c-2f1d7c9e1a11';
const TOPIK = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function buildReq(body: unknown) {
  return new NextRequest('http://localhost/api/chat/sesi', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function panggil(body: unknown) {
  const { POST } = await import('./route');
  return POST(buildReq(body));
}

const sukses = (data: Record<string, unknown>) => ({ data: { ok: true, ...data }, error: null });
const galatRpc = (message: string, code: string) => ({ data: null, error: { message, code } });

describe('POST /api/chat/sesi (RPC chat)', () => {
  beforeEach(() => {
    vi.resetModules();
    state.callerId = 'auth-staff-1';
    state.rpc.mockReset();
    serviceCreate.mockReset();
  });

  it('menolak tanpa login dengan 401 dan tidak memanggil RPC', async () => {
    state.callerId = null;
    const res = await panggil({ sesi_id: SESI, aksi: 'takeover' });
    expect(res.status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('JSON rusak -> 400; badan tidak sesuai skema -> 422', async () => {
    const { POST } = await import('./route');
    const rusak = new NextRequest('http://localhost/api/chat/sesi', { method: 'POST', body: '{x', headers: { 'Content-Type': 'application/json' } });
    expect((await POST(rusak)).status).toBe(400);
    expect((await panggil({ sesi_id: 'bukan-uuid', aksi: 'takeover' })).status).toBe(422);
    expect((await panggil({ sesi_id: SESI, aksi: 'selesaikan' })).status).toBe(422); // topik_id & catatan wajib
    expect((await panggil({ sesi_id: SESI, aksi: 'teruskan', topik_id: TOPIK, catatan: 'x' })).status).toBe(422); // layanan_id
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('takeover memanggil chat_ambil(p_sesi_id, p_alasan=null) dan mengembalikan data RPC', async () => {
    state.rpc.mockResolvedValue(sukses({ sudah_milik_anda: false, ambil_alih: false, peran_tahap: 'fo', sesi_id: SESI }));
    const res = await panggil({ sesi_id: SESI, aksi: 'takeover' });
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('chat_ambil', { p_sesi_id: SESI, p_alasan: null });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, aksi: 'takeover', data: { peran_tahap: 'fo' } });
  });

  it('takeover Admin ambil alih meneruskan alasan (dipangkas)', async () => {
    state.rpc.mockResolvedValue(sukses({ ambil_alih: true }));
    await panggil({ sesi_id: SESI, aksi: 'takeover', alasan: '  Petugas sedang cuti  ' });
    expect(state.rpc).toHaveBeenCalledWith('chat_ambil', { p_sesi_id: SESI, p_alasan: 'Petugas sedang cuti' });
  });

  it('teruskan memanggil chat_teruskan dan mengembalikan petugas_hadir', async () => {
    state.rpc.mockResolvedValue(sukses({ layanan_nama: 'Helpdesk OSS', petugas_hadir: false, notifikasi_diantrekan: 0 }));
    const res = await panggil({ sesi_id: SESI, aksi: 'teruskan', layanan_id: LAYANAN, topik_id: TOPIK, catatan: ' Tanya NIB ' });
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('chat_teruskan', {
      p_sesi_id: SESI, p_layanan_id: LAYANAN, p_topik_id: TOPIK, p_catatan: 'Tanya NIB',
    });
    expect((await res.json()).data.petugas_hadir).toBe(false);
  });

  it('selesaikan memanggil chat_selesai(topik, catatan)', async () => {
    state.rpc.mockResolvedValue(sukses({ kunjungan_status: 'selesai' }));
    const res = await panggil({ sesi_id: SESI, aksi: 'selesaikan', topik_id: TOPIK, catatan: 'Selesai dijawab' });
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('chat_selesai', { p_sesi_id: SESI, p_topik_id: TOPIK, p_catatan: 'Selesai dijawab' });
  });

  describe('selesaikan dengan Pendataan Khusus / identitas (Fase 4, migrasi 202610300002)', () => {
    const FIELD = '8d9c7a2e-0000-4000-8000-000000000001';

    it('khusus atau identitas -> chat_selesai_khusus dengan p_khusus/p_identitas; yang tidak ada dikirim null', async () => {
      state.rpc.mockResolvedValue(sukses({ khusus_tersimpan: 1, identitas_diubah: ['email'] }));
      const res = await panggil({
        sesi_id: SESI, aksi: 'selesaikan', topik_id: TOPIK, catatan: ' Selesai ',
        khusus: { [FIELD]: 'abc' }, identitas: { email: 'a@b.id' },
      });
      expect(res.status).toBe(200);
      expect(state.rpc).toHaveBeenCalledWith('chat_selesai_khusus', {
        p_sesi_id: SESI, p_topik_id: TOPIK, p_catatan: 'Selesai', p_khusus: { [FIELD]: 'abc' }, p_identitas: { email: 'a@b.id' },
      });
      state.rpc.mockClear();
      await panggil({ sesi_id: SESI, aksi: 'selesaikan', topik_id: TOPIK, catatan: 'x', identitas: { nama: 'Budi Santoso' } });
      expect(state.rpc).toHaveBeenCalledWith('chat_selesai_khusus', expect.objectContaining({ p_khusus: null, p_identitas: { nama: 'Budi Santoso' } }));
    });

    it('tanpa keduanya tetap chat_selesai (alur lama tidak berubah)', async () => {
      state.rpc.mockResolvedValue(sukses({}));
      await panggil({ sesi_id: SESI, aksi: 'selesaikan', topik_id: TOPIK, catatan: 'x' });
      expect(state.rpc).toHaveBeenCalledWith('chat_selesai', { p_sesi_id: SESI, p_topik_id: TOPIK, p_catatan: 'x' });
    });

    it('kolom identitas asing ditolak 422 dan RPC tidak dipanggil', async () => {
      const res = await panggil({ sesi_id: SESI, aksi: 'selesaikan', topik_id: TOPIK, catatan: 'x', identitas: { role: 'admin' } });
      expect(res.status).toBe(422);
      expect(state.rpc).not.toHaveBeenCalled();
    });

    it.each([
      ['KHUSUS_WAJIB: isian "X" wajib diisi', 'KHUSUS_WAJIB'],
      ['KHUSUS_TIDAK_VALID: isian "X"', 'KHUSUS_TIDAK_VALID'],
      ['KHUSUS_TIDAK_BERLAKU: hanya layanan', 'KHUSUS_TIDAK_BERLAKU'],
      ['DATA_TIDAK_VALID: email tidak valid', 'DATA_TIDAK_VALID'],
    ])('galat DB %s -> 422 dengan kode dan pesan Indonesia (pesan teknis tidak bocor)', async (message, kode) => {
      state.rpc.mockResolvedValue(galatRpc(message, '22023'));
      const res = await panggil({ sesi_id: SESI, aksi: 'selesaikan', topik_id: TOPIK, catatan: 'x', khusus: {} });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.kode).toBe(kode);
      expect(body.error).not.toContain('"X"');
    });

    it('fungsi belum ada (migrasi belum diterapkan) -> 409 MIGRASI_BELUM_DITERAPKAN', async () => {
      state.rpc.mockResolvedValue(galatRpc('Could not find the function', 'PGRST202'));
      const res = await panggil({ sesi_id: SESI, aksi: 'selesaikan', topik_id: TOPIK, catatan: 'x', khusus: {} });
      expect(res.status).toBe(409);
      expect((await res.json()).kode).toBe('MIGRASI_BELUM_DITERAPKAN');
    });
  });

  it('kembali_ke_bot tidak lagi didukung: 410 dengan pesan jelas, RPC tidak dipanggil', async () => {
    const res = await panggil({ sesi_id: SESI, aksi: 'kembali_ke_bot' });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.kode).toBe('AKSI_TIDAK_DIDUKUNG');
    expect(body.error).toMatch(/tidak lagi didukung/);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('tidak membuat klien service-role dan tidak menulis tabel langsung', async () => {
    state.rpc.mockResolvedValue(sukses({}));
    await panggil({ sesi_id: SESI, aksi: 'takeover' });
    expect(serviceCreate).not.toHaveBeenCalled();
  });

  describe('pemetaan galat RPC -> HTTP + pesan Indonesia', () => {
    const kasus: [string, string, number, RegExp][] = [
      ['SUDAH_DIAMBIL: chat sudah ditangani staf lain', 'P0001', 409, /baru saja diambil staf lain/],
      ['BUKAN_PEMILIK: chat ini ditangani staf lain', '42501', 403, /dipegang staf lain/],
      ['SESI_TIDAK_SAH: sesi tidak valid', '42501', 401, /masuk kembali/],
      ['ALASAN_WAJIB: alasan ambil alih chat wajib 5-500 karakter', '22023', 422, /Alasan ambil alih wajib/],
      ['FORBIDDEN: chat ini bukan untuk layanan Anda', '42501', 403, /tidak berwenang/],
      ['NOT_FOUND: sesi chat tidak ditemukan', 'P0002', 404, /tidak ditemukan/],
      ['INVALID_STATUS: sesi chat sudah selesai', 'P0001', 409, /Status chat sudah berubah/],
      ['BUKAN_TAHAP_FO: chat ini sedang ditangani petugas layanan', 'P0001', 409, /petugas layanan/],
      ['TOPIK_WAJIB: topik wajib', '22023', 422, /Topik wajib/],
      ['CATATAN_WAJIB: catatan wajib', '22023', 422, /Catatan wajib/],
      ['LAYANAN_TIDAK_VALID: layanan tujuan tidak valid', '22023', 422, /Layanan tujuan tidak dapat dipakai/],
      ['CHAT_HARUS_RPC: status sesi chat', '42501', 403, /ditolak oleh sistem/],
    ];
    it.each(kasus)('%s -> status %i', async (message, code, status, pola) => {
      void code;
      state.rpc.mockResolvedValue(galatRpc(message, code));
      const res = await panggil({ sesi_id: SESI, aksi: 'takeover' });
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body.error).toMatch(pola);
      expect(body.kode).toBe(message.split(':')[0]);
      // Pesan database mentah tidak bocor ke klien.
      expect(body.error).not.toContain(message.split(': ')[1] ?? '###');
    });

    let errSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { errSpy.mockRestore(); });

    it('galat tak dikenal -> 500 pesan baku, dicatat dengan kode (tanpa pesan teknis)', async () => {
      state.rpc.mockResolvedValue(galatRpc('deadlock detected secret-xyz', '40P01'));
      const res = await panggil({ sesi_id: SESI, aksi: 'selesaikan', topik_id: TOPIK, catatan: 'x' });
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toContain('secret-xyz');
      const log = (errSpy.mock.calls as unknown[][])
        .map((c) => { try { return JSON.parse(String(c[0])) as Record<string, unknown>; } catch { return null; } })
        .find((e: Record<string, unknown> | null) => e?.operation === 'chat.sesi.selesaikan');
      expect(log).toMatchObject({ kode: 'database', asalCode: '40P01' });
      expect(JSON.stringify(log)).not.toContain('secret-xyz');
    });

    it('kegagalan jaringan -> 503 dengan pesan koneksi', async () => {
      state.rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
      const res = await panggil({ sesi_id: SESI, aksi: 'takeover' });
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/Koneksi bermasalah/);
    });

    it('balasan tanpa ok:true -> 500 (bukan sukses palsu)', async () => {
      state.rpc.mockResolvedValue({ data: { ok: false }, error: null });
      const res = await panggil({ sesi_id: SESI, aksi: 'takeover' });
      expect(res.status).toBe(500);
    });
  });
});
