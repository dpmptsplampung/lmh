// Perkakas uji halaman /chat (Fase 5): tiruan klien Supabase + router fetch ke route /api/chat/*.
import { vi } from 'vitest';

export const L_BANK = '11111111-1111-4111-8111-111111111111';
export const L_BPJS = '22222222-2222-4222-8222-222222222222';

export interface OpsiHarness {
  layanan?: Array<{ id: string; nama: string; chatbot_aktif: boolean; punya_chat?: boolean }>;
  /** Hasil RPC chat_percakapan_saya; undefined = RPC belum ada (cadangan select chat_sesi). */
  rpcDaftar?: unknown[];
  /** Baris chat_sesi untuk cadangan daftar. */
  sesiRows?: unknown[];
  sesiBaru?: { id: string; status: string } | { error: unknown };
  /** Respons route GET /api/chat/messages. */
  messages?: (url: string) => unknown;
  /** Respons GET /api/chat/status (objek `status` klien) atau null = gagal. */
  status?: Record<string, unknown> | null;
  petugas?: { status: number; body: unknown };
  ai?: { status: number; body: unknown };
  postPesan?: (body: { sesi_id: string; isi: string }) => { status: number; body: unknown };
}

export function siapkanHarness(
  createClient: unknown,
  opsi: OpsiHarness = {},
) {
  const layanan = opsi.layanan ?? [
    { id: L_BANK, nama: 'Bank Lampung', chatbot_aktif: true },
    { id: L_BPJS, nama: 'BPJS Kesehatan', chatbot_aktif: true },
  ];
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const dari = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'neq', 'order', 'or']) b[k] = () => b;
    b.single = () =>
      Promise.resolve({ data: table === 'pengunjung' ? { id: 'peng-1', nama: 'Budi' } : null, error: null });
    b.insert = (payload: unknown) => {
      inserts.push({ table, payload });
      const sesudah: Record<string, unknown> = {};
      sesudah.select = () => sesudah;
      sesudah.single = () => {
        if (table !== 'chat_sesi') return Promise.resolve({ data: null, error: null });
        const s = opsi.sesiBaru ?? { id: 'sesi-baru', status: 'bot' };
        return 'error' in s ? Promise.resolve({ data: null, error: s.error }) : Promise.resolve({ data: s, error: null });
      };
      return Object.assign(Promise.resolve({ data: null, error: null }), sesudah);
    };
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const data =
        table === 'v_layanan_publik' ? layanan : table === 'chat_sesi' ? (opsi.sesiRows ?? []) : [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return b;
  };
  const saluran: Record<string, unknown> = {};
  saluran.on = () => saluran;
  saluran.subscribe = () => saluran;
  const rpc = vi.fn(async (nama: string) => {
    if (nama === 'chat_percakapan_saya' && opsi.rpcDaftar !== undefined) return { data: opsi.rpcDaftar, error: null };
    return { data: null, error: { code: 'PGRST202', message: 'tidak ada' } };
  });
  (createClient as ReturnType<typeof vi.fn>).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'auth-1' } }, error: null }), signInWithOAuth: vi.fn() },
    from: dari,
    rpc,
    channel: () => saluran,
    removeChannel: vi.fn(),
  });

  const panggilan: Array<{ url: string; method: string; body?: unknown }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    panggilan.push({ url, method, body });
    const balas = (status: number, json: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
    if (url.startsWith('/api/chat/status')) {
      return opsi.status === null || opsi.status === undefined ? balas(500, {}) : balas(200, { status: opsi.status });
    }
    if (url.startsWith('/api/chat/petugas')) return balas(opsi.petugas?.status ?? 200, opsi.petugas?.body ?? { ok: true });
    if (url.startsWith('/api/chat/ai')) return balas(opsi.ai?.status ?? 200, opsi.ai?.body ?? { jawaban: 'ok', eskalasi: false, pesan: null });
    if (url.startsWith('/api/chat/messages') && method === 'POST') {
      const r = opsi.postPesan?.(body as { sesi_id: string; isi: string });
      if (r) return balas(r.status, r.body);
      return balas(201, {
        message: { id: `srv-${panggilan.length}`, pengirim: 'pengunjung', isi: (body as { isi: string }).isi, created_at: new Date().toISOString(), client_uuid: (body as { client_uuid?: string }).client_uuid },
      });
    }
    if (url.startsWith('/api/chat/messages')) return balas(200, opsi.messages?.(url) ?? { messages: [], status: 'bot' });
    return balas(404, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return { inserts, rpc, panggilan, fetchMock };
}

export const STATUS_BUKA = {
  buka: true, tanggal: '2026-10-28', liburKeterangan: null, hariTanpaLayanan: false, bukaBerikutnya: null, sumber: 'jadwal',
};
export const STATUS_TUTUP = {
  buka: false, tanggal: '2026-10-31', liburKeterangan: null, hariTanpaLayanan: true,
  bukaBerikutnya: { tanggal: '2026-11-02', jam: '08:00' }, sumber: 'jadwal',
};

export function barisRpc(over: Record<string, unknown> = {}) {
  return {
    layanan_id: L_BANK, layanan_nama: 'Bank Lampung', layanan_aktif: true, punya_chat: true, chatbot_aktif: true,
    jumlah_sesi: 2, sesi_terakhir_id: 'sesi-2', sesi_terbuka_id: 'sesi-2', status_terakhir: 'bot',
    last_pesan: 'Syarat KUR adalah ...', last_pesan_at: '2026-10-30T02:00:00Z', last_pengirim: 'bot', ...over,
  };
}
