// @vitest-environment node
// Mode {faqId}: pemrosesan satu FAQ yang baru disimpan oleh Admin/petugas/Front Office (poin 4 perbaikan produk).
// Pembatasan utama: hanya SATU FAQ, hanya yang masih menunggu diproses, dan hanya yang masuk lingkup penyimpan
// (selaras RLS/faq-scope: admin semua, petugas = layanannya, Front Office = FAQ umum).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

const gemini = { embedThrow: false };
vi.mock('@/lib/gemini', () => ({
  getGenerativeClient: () => ({}),
  getEmbeddingModel: () => ({
    embedContent: async () => {
      if (gemini.embedThrow) throw new Error('Gemini down');
      return { embedding: { values: new Array(8).fill(0.1) } };
    },
  }),
}));

const FAQ_ID = '11111111-1111-4111-8111-111111111111';
const LAYANAN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LAYANAN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface Skenario {
  user?: { id: string } | null;
  petugas?: { role: string; aktif: boolean; layanan_id: string | null } | null;
  faq?: { id: string; layanan_id: string | null; pertanyaan: string; jawaban: string } | null;
  pending?: boolean;
  updateRows?: Array<{ id: string }>;
}

async function siapkan(s: Skenario) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.GEMINI_API_KEY = 'k';
  delete process.env.CRON_SECRET;

  const serverMod = await import('@/lib/supabase/server');
  vi.mocked(serverMod.createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: s.user === undefined ? { id: 'u-1' } : s.user }, error: null }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: s.petugas ?? null, error: null }),
        }),
      }),
    }),
  } as never);

  const updates: unknown[] = [];
  const bacaFaq = vi.fn().mockResolvedValue({ data: s.faq ?? null, error: null });
  const bacaPending = vi.fn().mockResolvedValue({ data: s.pending === false ? null : { id: FAQ_ID }, error: null });
  const service = {
    from: vi.fn((tabel: string) => {
      if (tabel !== 'faq_knowledge_base') throw new Error(`tabel tak terduga: ${tabel}`);
      return {
        select: vi.fn((kolom: string) => {
          if (kolom === 'id, layanan_id, pertanyaan, jawaban') {
            return { eq: () => ({ maybeSingle: bacaFaq }) };
          }
          // select('id').eq('id', ..).or('embedding.is.null,perlu_embed_ulang.eq.true').maybeSingle()
          return { eq: () => ({ or: () => ({ maybeSingle: bacaPending }) }) };
        }),
        update: vi.fn((nilai: unknown) => {
          updates.push(nilai);
          const query = {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({ data: s.updateRows ?? [{ id: FAQ_ID }], error: null }),
          };
          return query;
        }),
      };
    }),
  };
  const supa = await import('@supabase/supabase-js');
  vi.mocked(supa.createClient).mockReturnValue(service as never);
  return { service, updates, bacaFaq, bacaPending };
}

const panggil = async (body: unknown, route?: typeof import('./route')) => {
  const { POST } = route ?? (await import('./route'));
  return POST(
    new Request('http://localhost/api/admin/faq/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
};

const faqUmum = { id: FAQ_ID, layanan_id: null, pertanyaan: 'Jam buka?', jawaban: 'Senin sampai Jumat.' };
const faqA = { id: FAQ_ID, layanan_id: LAYANAN_A, pertanyaan: 'Syarat NIB?', jawaban: 'KTP dan NPWP.' };

describe('POST /api/admin/faq/embed mode {faqId}', () => {
  beforeEach(() => {
    vi.resetModules();
    gemini.embedThrow = false;
  });

  it('401 tanpa sesi', async () => {
    await siapkan({ user: null });
    expect((await panggil({ faqId: FAQ_ID })).status).toBe(401);
  });

  it('403 untuk akun tanpa baris petugas atau nonaktif', async () => {
    await siapkan({ petugas: null, faq: faqUmum });
    expect((await panggil({ faqId: FAQ_ID })).status).toBe(403);
    vi.resetModules();
    await siapkan({ petugas: { role: 'front_office', aktif: false, layanan_id: null }, faq: faqUmum });
    expect((await panggil({ faqId: FAQ_ID })).status).toBe(403);
  });

  it('403 untuk peran selain admin/petugas/front_office', async () => {
    await siapkan({ petugas: { role: 'mitra', aktif: true, layanan_id: null }, faq: faqUmum });
    expect((await panggil({ faqId: FAQ_ID })).status).toBe(403);
  });

  it('400 bila faqId bukan UUID dan tidak menyentuh data', async () => {
    const { bacaFaq } = await siapkan({ petugas: { role: 'admin', aktif: true, layanan_id: null } });
    expect((await panggil({ faqId: 'bukan-uuid' })).status).toBe(400);
    expect(bacaFaq).not.toHaveBeenCalled();
  });

  it('404 bila FAQ tidak ada', async () => {
    await siapkan({ petugas: { role: 'admin', aktif: true, layanan_id: null }, faq: null });
    expect((await panggil({ faqId: FAQ_ID })).status).toBe(404);
  });

  it('Front Office boleh memproses FAQ umum miliknya', async () => {
    const { updates } = await siapkan({ petugas: { role: 'front_office', aktif: true, layanan_id: null }, faq: faqUmum });
    const res = await panggil({ faqId: FAQ_ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ embedded: 1, failed: 0 });
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0] as object).sort()).toEqual(['embedding', 'embedding_updated_at', 'perlu_embed_ulang']);
  });

  it('Front Office TIDAK bisa memicu FAQ layanan (403, tanpa embedding, tanpa update)', async () => {
    const { updates, bacaPending } = await siapkan({ petugas: { role: 'front_office', aktif: true, layanan_id: null }, faq: faqA });
    const res = await panggil({ faqId: FAQ_ID });
    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
    expect(bacaPending).not.toHaveBeenCalled();
  });

  it('petugas boleh memproses FAQ layanannya sendiri', async () => {
    await siapkan({ petugas: { role: 'petugas', aktif: true, layanan_id: LAYANAN_A }, faq: faqA });
    const res = await panggil({ faqId: FAQ_ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ embedded: 1 });
  });

  it('petugas TIDAK bisa memicu FAQ layanan lain', async () => {
    const { updates } = await siapkan({ petugas: { role: 'petugas', aktif: true, layanan_id: LAYANAN_B }, faq: faqA });
    expect((await panggil({ faqId: FAQ_ID })).status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it('petugas TIDAK bisa memicu FAQ umum', async () => {
    const { updates } = await siapkan({ petugas: { role: 'petugas', aktif: true, layanan_id: LAYANAN_A }, faq: faqUmum });
    expect((await panggil({ faqId: FAQ_ID })).status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it('petugas tanpa layanan tidak bisa memicu FAQ umum maupun FAQ layanan', async () => {
    await siapkan({ petugas: { role: 'petugas', aktif: true, layanan_id: null }, faq: faqUmum });
    expect((await panggil({ faqId: FAQ_ID })).status).toBe(403);
  });

  it('Admin boleh memproses FAQ mana pun', async () => {
    await siapkan({ petugas: { role: 'admin', aktif: true, layanan_id: null }, faq: faqA });
    expect((await panggil({ faqId: FAQ_ID })).status).toBe(200);
  });

  it('FAQ yang sudah diproses (bukan pending) ditolak 409 tanpa memanggil Gemini atau menulis', async () => {
    const { updates } = await siapkan({
      petugas: { role: 'front_office', aktif: true, layanan_id: null },
      faq: faqUmum,
      pending: false,
    });
    const res = await panggil({ faqId: FAQ_ID });
    expect(res.status).toBe(409);
    expect(updates).toHaveLength(0);
  });

  it('Gemini gagal: 502 dengan pesan jelas, FAQ tetap tersimpan (tidak ada update)', async () => {
    gemini.embedThrow = true;
    const { updates } = await siapkan({ petugas: { role: 'front_office', aktif: true, layanan_id: null }, faq: faqUmum });
    const res = await panggil({ faqId: FAQ_ID });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.failed).toBe(1);
    expect(json.error).toMatch(/diproses/i);
    expect(updates).toHaveLength(0);
  });

  it('update 0 baris (FAQ dihapus saat diproses) = 502, bukan sukses palsu', async () => {
    await siapkan({
      petugas: { role: 'front_office', aktif: true, layanan_id: null },
      faq: faqUmum,
      updateRows: [],
    });
    const res = await panggil({ faqId: FAQ_ID });
    expect(res.status).toBe(502);
  });

  it('pembatas laju per pengguna: permintaan ke-31 dalam sepuluh menit mendapat 429', async () => {
    await siapkan({ petugas: { role: 'front_office', aktif: true, layanan_id: null }, faq: faqUmum });
    const route = await import('./route');
    for (let i = 0; i < 30; i++) {
      expect((await panggil({ faqId: FAQ_ID }, route)).status).toBe(200);
    }
    const res = await panggil({ faqId: FAQ_ID }, route);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('mode {faqId} tidak menjalankan pemrosesan massal (tak pernah mengambil daftar pending)', async () => {
    const { service } = await siapkan({ petugas: { role: 'admin', aktif: true, layanan_id: null }, faq: faqUmum });
    await panggil({ faqId: FAQ_ID });
    // Hanya tiga pemanggilan from(): baca FAQ, periksa pending, update. Tak ada hitung sisa/limit(50).
    expect(service.from).toHaveBeenCalledTimes(3);
  });
});
