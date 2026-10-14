import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  GalatAksiChat,
  PESAN_GALAT_CHAT,
  batasCatatanChat,
  kirimAksiChat,
  kodeChatPerluMuatUlang,
  kodeGalatChat,
  pesanGalatChat,
  statusHttpGalatChat,
  validasiAlasanAmbilAlih,
  validasiTopikCatatanChat,
} from './chat-staf';

describe('kodeGalatChat', () => {
  it('membaca kode di awal pesan RPC (string, {message}, objek ber-asal)', () => {
    expect(kodeGalatChat('SUDAH_DIAMBIL: chat sudah ditangani staf lain')).toBe('SUDAH_DIAMBIL');
    expect(kodeGalatChat({ message: 'ALASAN_WAJIB: alasan ambil alih chat wajib 5-500 karakter' })).toBe('ALASAN_WAJIB');
    expect(kodeGalatChat({ asal: { message: 'BUKAN_PEMILIK: chat ini ditangani staf lain' } })).toBe('BUKAN_PEMILIK');
    expect(kodeGalatChat({ kode: 'DIVERGENSI' })).toBe('DIVERGENSI');
    expect(kodeGalatChat('CHAT_HARUS_RPC: status sesi chat bot -> aktif hanya lewat RPC chat')).toBe('CHAT_HARUS_RPC');
  });
  it('null untuk kode tak dikenal / bukan pola kode', () => {
    expect(kodeGalatChat('deadlock detected')).toBeNull();
    expect(kodeGalatChat('TIDAK_DIKENAL: x')).toBeNull();
    expect(kodeGalatChat(null)).toBeNull();
    expect(kodeGalatChat(42)).toBeNull();
  });
});

describe('pesan & status HTTP', () => {
  it('setiap kode punya pesan Indonesia tanpa jargon teknis dan status HTTP yang masuk akal', () => {
    for (const [kode, pesan] of Object.entries(PESAN_GALAT_CHAT)) {
      expect(pesan.length).toBeGreaterThan(10);
      expect(pesan).not.toMatch(/RPC|SQL|postgres|P0001|42501/i);
      expect(statusHttpGalatChat(kode as keyof typeof PESAN_GALAT_CHAT)).toBeGreaterThanOrEqual(401);
    }
    expect(statusHttpGalatChat('SESI_TIDAK_SAH')).toBe(401);
    expect(statusHttpGalatChat('SUDAH_DIAMBIL')).toBe(409);
    expect(statusHttpGalatChat('ALASAN_WAJIB')).toBe(422);
    expect(statusHttpGalatChat(null)).toBe(500);
    // 202610140012 #13: chat_ambil / chat_teruskan pada hari tanpa pelayanan
    expect(kodeGalatChat('HARI_TANPA_LAYANAN: chat tidak dapat diambil pada hari tanpa pelayanan')).toBe('HARI_TANPA_LAYANAN');
    expect(statusHttpGalatChat('HARI_TANPA_LAYANAN')).toBe(409);
    expect(PESAN_GALAT_CHAT.HARI_TANPA_LAYANAN).toMatch(/Sabtu\/Minggu\/hari libur/);
    expect(pesanGalatChat('SUDAH_DIAMBIL')).toBe(PESAN_GALAT_CHAT.SUDAH_DIAMBIL);
    expect(pesanGalatChat('XYZ', 'cadangan')).toBe('cadangan');
  });
  it('galat yang berarti tampilan basi memicu muat ulang; galat isian tidak', () => {
    for (const k of ['SUDAH_DIAMBIL', 'INVALID_STATUS', 'NOT_FOUND', 'BUKAN_PEMILIK', 'BUKAN_TAHAP_FO']) {
      expect(kodeChatPerluMuatUlang(k)).toBe(true);
    }
    for (const k of ['TOPIK_WAJIB', 'CATATAN_WAJIB', 'ALASAN_WAJIB', 'SESI_TIDAK_SAH', null]) {
      expect(kodeChatPerluMuatUlang(k)).toBe(false);
    }
  });
});

describe('validasi isian', () => {
  it('batas catatan: FO 200, layanan 1000 (K10)', () => {
    expect(batasCatatanChat('fo')).toBe(200);
    expect(batasCatatanChat('layanan')).toBe(1000);
  });
  it('topik wajib, catatan wajib (spasi saja = kosong), catatan > batas ditolak', () => {
    expect(validasiTopikCatatanChat('', 'x', 'fo')).toBe(PESAN_GALAT_CHAT.TOPIK_WAJIB);
    expect(validasiTopikCatatanChat('t', '   ', 'fo')).toBe(PESAN_GALAT_CHAT.CATATAN_WAJIB);
    expect(validasiTopikCatatanChat('t', 'a'.repeat(200), 'fo')).toBeNull();
    expect(validasiTopikCatatanChat('t', 'a'.repeat(201), 'fo')).toMatch(/maksimal 200/);
    expect(validasiTopikCatatanChat('t', 'a'.repeat(1000), 'layanan')).toBeNull();
    expect(validasiTopikCatatanChat('t', 'a'.repeat(1001), 'layanan')).toMatch(/maksimal 1000/);
  });
  it('alasan ambil alih 5-500 karakter setelah dipangkas', () => {
    expect(validasiAlasanAmbilAlih('  abcd ')).toBe(PESAN_GALAT_CHAT.ALASAN_WAJIB);
    expect(validasiAlasanAmbilAlih('abcde')).toBeNull();
    expect(validasiAlasanAmbilAlih('a'.repeat(500))).toBeNull();
    expect(validasiAlasanAmbilAlih('a'.repeat(501))).toBe(PESAN_GALAT_CHAT.ALASAN_WAJIB);
  });
});

describe('kirimAksiChat', () => {
  afterEach(() => vi.unstubAllGlobals());
  const SESI = '3f2504e0-4f89-41d3-8a0c-0305e82c3301';

  it('mengirim POST JSON dan mengembalikan data RPC', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { peran_tahap: 'fo' } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const hasil = await kirimAksiChat({ sesi_id: SESI, aksi: 'takeover' });
    expect(hasil).toEqual({ peran_tahap: 'fo' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/sesi',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ sesi_id: SESI, aksi: 'takeover' }) }),
    );
  });
  it('galat server dipetakan ke GalatAksiChat dengan kode dan pesan Indonesia (bukan pesan mentah server)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'mentah', kode: 'SUDAH_DIAMBIL' }) })));
    const err = await kirimAksiChat({ sesi_id: SESI, aksi: 'takeover' }).catch((e) => e);
    expect(err).toBeInstanceOf(GalatAksiChat);
    expect(err.kode).toBe('SUDAH_DIAMBIL');
    expect(err.pesan).toBe(PESAN_GALAT_CHAT.SUDAH_DIAMBIL);
    expect(err.status).toBe(409);
  });
  it('galat tanpa kode memakai pesan server; tanpa pesan memakai pesan baku; jaringan putus -> pesan koneksi', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Gagal memproses chat' }) })));
    expect((await kirimAksiChat({ sesi_id: SESI, aksi: 'takeover' }).catch((e) => e)).pesan).toBe('Gagal memproses chat');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('bukan json'); } })));
    expect((await kirimAksiChat({ sesi_id: SESI, aksi: 'takeover' }).catch((e) => e)).pesan).toMatch(/coba lagi/i);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await kirimAksiChat({ sesi_id: SESI, aksi: 'takeover' }).catch((e) => e);
    expect(err.pesan).toMatch(/Koneksi bermasalah/);
    expect(err.status).toBe(0);
  });
});
