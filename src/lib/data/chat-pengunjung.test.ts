// @vitest-environment node
// Kontrak lapisan data chat pengunjung (tugas 6.2): kolom eksplisit, hasil HasilChat (tidak pernah melempar), jenis galat
// yang dipakai halaman (jaringan vs selainnya), cadangan daftar percakapan, dan pembungkus fetch berbatas waktu 65 dtk.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MutasiError } from '@/lib/supabase/mutate';
import {
  BATAS_WAKTU_CHAT_MS,
  KOLOM_FAQ_CHAT,
  KOLOM_LAYANAN_CHAT,
  KOLOM_SESI_BARU,
  KOLOM_SESI_DAFTAR,
  ambilPenggunaChat,
  ambilStatusLayananChat,
  buatSesiChat,
  catatPersetujuan,
  kirimLampiranChat,
  kirimPesanChat,
  mintaPetugasChat,
  muatDaftarPercakapan,
  muatFaqChat,
  muatLayananChat,
  muatProfilPengunjung,
  muatRiwayatChat,
  sinkronPesanChat,
  tanyaBotChat,
} from './chat-pengunjung';

const L = '11111111-1111-4111-8111-111111111111';
type Hasil = { data: unknown; error: unknown };

/** Klien tiruan: tiap tabel menjawab `hasil(table)`; semua panggilan builder dicatat. */
function klien(opsi: { hasil?: (t: string) => Hasil | Promise<Hasil>; rpc?: (n: string) => Hasil | Promise<Hasil>; tanpaRpc?: boolean } = {}) {
  const log: Array<{ table: string; op: string; args: unknown[] }> = [];
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'neq', 'or', 'order', 'insert', 'single']) {
      b[op] = (...args: unknown[]) => {
        log.push({ table, op, args });
        return b;
      };
    }
    b.then = (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) =>
      Promise.resolve(opsi.hasil ? opsi.hasil(table) : { data: [], error: null }).then(ok, no);
    return b;
  };
  const sb: Record<string, unknown> = { from, auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })) } };
  if (!opsi.tanpaRpc) sb.rpc = vi.fn(async (n: string) => (opsi.rpc ? opsi.rpc(n) : { data: null, error: { code: 'PGRST202' } }));
  return { sb: sb as never, log };
}
const kolomDari = (log: Array<{ table: string; op: string; args: unknown[] }>, table: string) =>
  log.find((l) => l.table === table && l.op === 'select')?.args[0];

describe('kueri Supabase: kolom eksplisit dan hasil bertipe', () => {
  it('layanan: kolom eksplisit, modul publik dikecualikan, punya_chat=false dibuang; galat -> error', async () => {
    const { sb, log } = klien({
      hasil: () => ({ data: [{ id: 'a', nama: 'A', chatbot_aktif: true }, { id: 'b', nama: 'B', chatbot_aktif: true, punya_chat: false }], error: null }),
    });
    const h = await muatLayananChat(sb);
    expect(h.data?.map((l) => l.id)).toEqual(['a']);
    expect(kolomDari(log, 'v_layanan_publik')).toBe(KOLOM_LAYANAN_CHAT);
    expect(log).toContainEqual({ table: 'v_layanan_publik', op: 'neq', args: ['tipe', 'modul_publik'] });

    const gagal = await muatLayananChat(klien({ hasil: () => ({ data: null, error: { message: 'denied', code: '42501' } }) }).sb);
    expect(gagal).toMatchObject({ data: null, error: { jenis: 'database', pesan: 'denied' } });
    const tolak = await muatLayananChat(klien({ hasil: () => Promise.reject(new TypeError('Failed to fetch')) }).sb);
    expect(tolak.error?.jenis).toBe('jaringan');
  });

  it('FAQ: id bukan UUID ditolak tanpa kueri; filter .or memuat FAQ layanan + umum', async () => {
    const { sb, log } = klien({ hasil: () => ({ data: [{ id: 'f' }], error: null }) });
    expect((await muatFaqChat(sb, 'x),aktif.eq.false,(y')).error?.jenis).toBe('tidak_valid');
    expect(log).toEqual([]);
    const h = await muatFaqChat(sb, L);
    expect(h.data).toEqual([{ id: 'f' }]);
    expect(kolomDari(log, 'faq_knowledge_base')).toBe(KOLOM_FAQ_CHAT);
    expect(log).toContainEqual({ table: 'faq_knowledge_base', op: 'or', args: [`layanan_id.eq.${L},layanan_id.is.null`] });
  });

  it('profil: tanpa baris (galat .single) = null tanpa error; hanya penolakan yang menjadi error', async () => {
    expect(await muatProfilPengunjung(klien({ hasil: () => ({ data: null, error: { code: 'PGRST116' } }) }).sb, 'u1')).toEqual({ data: null, error: null });
    expect((await muatProfilPengunjung(klien({ hasil: () => Promise.reject(new Error('x')) }).sb, 'u1')).error?.jenis).toBe('jaringan');
  });

  it('pengguna: null bila belum masuk; penolakan = error', async () => {
    const { sb } = klien();
    expect((await ambilPenggunaChat(sb)).data).toEqual({ id: 'u1' });
    (sb as unknown as { auth: { getUser: ReturnType<typeof vi.fn> } }).auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(await ambilPenggunaChat(sb)).toEqual({ data: null, error: null });
    (sb as unknown as { auth: { getUser: ReturnType<typeof vi.fn> } }).auth.getUser.mockRejectedValueOnce(new Error('boom'));
    expect((await ambilPenggunaChat(sb)).error?.pesan).toBe('boom');
  });
});

describe('daftar percakapan: RPC lalu cadangan chat_sesi', () => {
  const baris = { layanan_id: L, layanan_nama: 'Bank', sesi_terakhir_id: 's2', sesi_terbuka_id: 's2', status_terakhir: 'bot' };

  it('RPC chat_percakapan_saya dipakai bila ada', async () => {
    const { sb, log } = klien({ rpc: () => ({ data: [baris], error: null }) });
    const h = await muatDaftarPercakapan(sb, { pengunjungId: 'p1', layanan: [] });
    expect(h.data?.[0]).toMatchObject({ layananId: L, sesiTerbukaId: 's2' });
    expect(log).toEqual([]);
  });

  it('RPC galat/tidak ada: sesi milik pengunjung dikelompokkan per Layanan (kolom eksplisit)', async () => {
    const { sb, log } = klien({
      tanpaRpc: true,
      hasil: () => ({ data: [{ id: 's1', layanan_id: L, status: 'bot', created_at: '2026-10-01T00:00:00Z' }], error: null }),
    });
    const h = await muatDaftarPercakapan(sb, { pengunjungId: 'p1', layanan: [{ id: L, nama: 'Bank', chatbot_aktif: true }] });
    expect(h.data?.[0]).toMatchObject({ layananId: L, layananNama: 'Bank', sesiTerbukaId: 's1' });
    expect(kolomDari(log, 'chat_sesi')).toBe(KOLOM_SESI_DAFTAR);
    expect(log).toContainEqual({ table: 'chat_sesi', op: 'eq', args: ['pengunjung_id', 'p1'] });
  });

  it('tanpa pengunjung: daftar kosong; cadangan galat = error', async () => {
    expect(await muatDaftarPercakapan(klien().sb, { pengunjungId: null, layanan: [] })).toEqual({ data: [], error: null });
    const h = await muatDaftarPercakapan(klien({ hasil: () => ({ data: null, error: { message: 'x' } }) }).sb, { pengunjungId: 'p', layanan: [] });
    expect(h.error?.jenis).toBe('database');
  });
});

describe('persetujuan dan sesi', () => {
  it('consent_log: sukses; galat RLS = ditolak; penolakan fetch = jaringan', async () => {
    const baris = { subjek_ref: 'p1', tujuan: 'chat_followup', disetujui: true as const, versi_kebijakan: '1.0' };
    const ok = klien();
    expect(await catatPersetujuan(ok.sb, baris)).toEqual({ data: true, error: null });
    expect(ok.log).toContainEqual({ table: 'consent_log', op: 'insert', args: [baris] });
    const rls = await catatPersetujuan(klien({ hasil: () => ({ data: null, error: { message: 'row-level security', code: '42501' } }) }).sb, baris);
    expect(rls.error?.jenis).toBe('ditolak');
    const net = await catatPersetujuan(klien({ hasil: () => Promise.reject(new TypeError('Failed to fetch')) }).sb, baris);
    expect(net.error?.jenis).toBe('jaringan');
  });

  it('chat_sesi: pengunjung_id hanya bila diketahui; status menurut chatbot; tanpa baris = MutasiError database', async () => {
    const a = klien({ hasil: () => ({ data: { id: 's', status: 'bot' }, error: null }) });
    expect(await buatSesiChat(a.sb, { layananId: L, kontak: 'Budi', chatbotAktif: true, pengunjungId: 'p1' })).toEqual({ data: { id: 's', status: 'bot' }, error: null });
    expect(a.log.find((l) => l.op === 'insert')?.args[0]).toEqual({ layanan_id: L, kontak_pengunjung: 'Budi', status: 'bot', pengunjung_id: 'p1' });
    expect(kolomDari(a.log, 'chat_sesi')).toBe(KOLOM_SESI_BARU);

    const b = klien({ hasil: () => ({ data: null, error: null }) });
    const h = await buatSesiChat(b.sb, { layananId: L, kontak: 'Budi', chatbotAktif: false, pengunjungId: null });
    expect(b.log.find((l) => l.op === 'insert')?.args[0]).toEqual({ layanan_id: L, kontak_pengunjung: 'Budi', status: 'eskalasi' });
    expect(h.error?.jenis).toBe('database');
    expect(h.error?.asli).toBeInstanceOf(MutasiError);
  });
});

describe('route /api/chat/*', () => {
  const balas = (status: number, json: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('riwayat: URL dengan sebelum ter-encode; bukan ok / bukan JSON = error', async () => {
    fetchMock.mockResolvedValue(balas(200, { messages: [{ id: 'm' }], ada_lebih: true, status: 'bot' }));
    const h = await muatRiwayatChat({ sesiId: 's1', sebelum: '2026-10-30T01:00:00Z' });
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/chat/messages?sesi_id=s1&riwayat=1&sebelum=${encodeURIComponent('2026-10-30T01:00:00Z')}`);
    expect(h.data).toEqual({ messages: [{ id: 'm' }], adaLebih: true, status: 'bot' });
    fetchMock.mockResolvedValue(balas(500, {}));
    expect((await muatRiwayatChat({ sesiId: 's1' })).error?.jenis).toBe('http');
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } });
    expect((await muatRiwayatChat({ sesiId: 's1' })).error?.jenis).toBe('tidak_valid');
  });

  it('sinkron: pesan/status opsional', async () => {
    fetchMock.mockResolvedValue(balas(200, { status: 'aktif' }));
    expect((await sinkronPesanChat('s1')).data).toEqual({ messages: null, status: 'aktif' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat/messages?sesi_id=s1');
  });

  it('kirim pesan: POST JSON; gagal HTTP = error; lampiran memakai pesan galat route', async () => {
    fetchMock.mockResolvedValue(balas(201, { message: { id: 'srv' } }));
    expect((await kirimPesanChat({ sesiId: 's1', isi: 'Halo', clientUuid: 'c1' })).data).toEqual({ message: { id: 'srv' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/chat/messages');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ sesi_id: 's1', pengirim: 'pengunjung', isi: 'Halo', client_uuid: 'c1' });
    fetchMock.mockResolvedValue(balas(500, {}));
    expect((await kirimPesanChat({ sesiId: 's1', isi: 'Halo' })).error?.jenis).toBe('http');
    fetchMock.mockResolvedValue(balas(413, { error: 'Ukuran maksimal 5 MB' }));
    const lampiran = { kunci: 'k', nama: 'a.jpg', mime: 'image/jpeg', ukuran: 1 } as never;
    expect((await kirimLampiranChat({ sesiId: 's1', lampiran, clientUuid: 'c' })).error?.pesan).toBe('Ukuran maksimal 5 MB');
    fetchMock.mockResolvedValue(balas(500, null));
    expect((await kirimLampiranChat({ sesiId: 's1', lampiran, clientUuid: 'c' })).error?.pesan).toBe('Foto gagal dikirim');
  });

  it('bot: 429, balasan gagal, jawaban dengan status/eskalasi/minta petugas luar jam', async () => {
    fetchMock.mockResolvedValue(balas(429, {}));
    expect((await tanyaBotChat({ pertanyaan: 'q', layananId: L, sesiId: 's' })).data).toEqual({ jenis: 'terlalu_cepat' });
    fetchMock.mockResolvedValue(balas(500, { error: 'x' }));
    expect((await tanyaBotChat({ pertanyaan: 'q', layananId: L, sesiId: 's' })).data).toEqual({ jenis: 'tidak_tersedia' });
    fetchMock.mockResolvedValue(balas(200, { reason: 'minta_petugas', buka: false, eskalasi: true }));
    expect((await tanyaBotChat({ pertanyaan: 'q', layananId: L, sesiId: 's' })).data).toEqual({
      jenis: 'jawaban', pesan: null, mintaPetugasLuarJam: true, status: null, eskalasi: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ pertanyaan: 'q', layanan_id: L, sesi_id: 's' });
  });

  it('minta petugas: 409 migrasi, ditolak dengan pesan route, diterima', async () => {
    fetchMock.mockResolvedValue(balas(409, { kode: 'MIGRASI_BELUM_DITERAPKAN' }));
    expect((await mintaPetugasChat('s')).data).toEqual({ jenis: 'migrasi_belum' });
    fetchMock.mockResolvedValue(balas(403, { error: 'Tidak boleh' }));
    expect((await mintaPetugasChat('s')).data).toEqual({ jenis: 'ditolak', pesan: 'Tidak boleh' });
    fetchMock.mockResolvedValue(balas(200, { buka: false, status: 'eskalasi' }));
    expect((await mintaPetugasChat('s')).data).toEqual({ jenis: 'diterima', pesan: null, menungguLuarJam: true, status: 'eskalasi' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat/petugas');
  });

  it('status layanan: hanya status dengan `buka` boolean yang sah', async () => {
    fetchMock.mockResolvedValue(balas(200, { status: { buka: false, tanggal: '2026-11-13' } }));
    expect((await ambilStatusLayananChat(L)).data).toMatchObject({ buka: false });
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/chat/status?layanan_id=${L}`);
    fetchMock.mockResolvedValue(balas(200, { status: null }));
    expect(await ambilStatusLayananChat(L)).toEqual({ data: null, error: null });
  });

  it('batas waktu 65 dtk: permintaan dibatalkan dan galat bertanda waktu_habis', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_u: string, init: RequestInit) =>
      new Promise((_r, tolak) => init.signal?.addEventListener('abort', () => tolak(new DOMException('aborted', 'AbortError')))),
    );
    const janji = tanyaBotChat({ pertanyaan: 'q', layananId: L, sesiId: 's' });
    await vi.advanceTimersByTimeAsync(BATAS_WAKTU_CHAT_MS - 1);
    let selesai = false;
    void janji.then(() => (selesai = true));
    await Promise.resolve();
    expect(selesai).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await janji).error?.jenis).toBe('waktu_habis');
  });

  it('signal pemanggil dibatalkan: galat jaringan (bukan waktu habis)', async () => {
    fetchMock.mockImplementation((_u: string, init: RequestInit) =>
      new Promise((_r, tolak) => init.signal?.addEventListener('abort', () => tolak(new DOMException('aborted', 'AbortError')))),
    );
    const ac = new AbortController();
    const janji = muatRiwayatChat({ sesiId: 's', signal: ac.signal });
    ac.abort();
    expect((await janji).error?.jenis).toBe('jaringan');
  });
});
