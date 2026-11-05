// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));
const { embedContent } = vi.hoisted(() => ({ embedContent: vi.fn() }));
vi.mock('@/lib/gemini', () => ({
  getGenerativeClient: () => ({}),
  getEmbeddingModel: () => ({ embedContent }),
}));

const ID = '11111111-1111-4111-8111-111111111111';
const panggil = async () => {
  const { POST } = await import('./route');
  return POST(new Request('http://localhost/api/admin/faq/embed', {
    method: 'POST', body: JSON.stringify({ faqId: ID }),
  }));
};

async function siapkan() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  delete process.env.CRON_SECRET;
  const row = { id: ID, layanan_id: null, pertanyaan: 'Jam buka?', jawaban: 'Versi A', perlu_embed_ulang: true, embedding: null as string | null };
  const { createClient } = await import('@/lib/supabase/server');
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin', aktif: true } }) }) }) }),
  } as never);
  const { createClient: service } = await import('@supabase/supabase-js');
  vi.mocked(service).mockReturnValue({
    from: () => ({
      select: (cols: string) => ({ eq: () => ({
        maybeSingle: async () => ({ data: { ...row }, error: null }),
        or: () => ({ maybeSingle: async () => ({ data: row.perlu_embed_ulang ? { id: ID } : null, error: null }) }),
      }), or: () => cols === '*' ? Promise.resolve({ count: row.perlu_embed_ulang ? 1 : 0 }) : ({ limit: async () => ({ data: [{ ...row }], error: null }) }) }),
      update: (patch: object) => {
        const filters: [string, unknown][] = [];
        const q = {
          eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
          select: async () => {
            const matches = filters.every(([k, v]) => row[k as keyof typeof row] === v);
            if (matches) Object.assign(row, patch);
            return { data: matches ? [{ id: ID }] : [], error: null };
          },
        };
        return q;
      },
    }),
  } as never);
  return row;
}

function tungguModel() {
  let selesai!: (r: { embedding: { values: number[] } }) => void;
  const promise = new Promise<{ embedding: { values: number[] } }>((resolve) => { selesai = resolve; });
  return { promise, selesai };
}

describe('embedding FAQ hanya untuk teks sumber yang sama', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it.each(['pertanyaan', 'jawaban'] as const)('perubahan %s saat model berjalan tetap pending', async (kolom) => {
    const row = await siapkan();
    const model = tungguModel();
    embedContent.mockReturnValueOnce(model.promise);
    const request = panggil();
    await vi.waitFor(() => expect(embedContent).toHaveBeenCalledTimes(1));
    row[kolom] = 'Versi B';
    model.selesai({ embedding: { values: [0.1] } });
    const res = await request;
    expect(row.perlu_embed_ulang).toBe(true);
    expect(row.embedding).toBeNull();
    expect(res.status).toBe(502);
  });

  it('batch terjadwal tidak menandai selesai sumber yang berubah', async () => {
    const row = await siapkan();
    const model = tungguModel();
    embedContent.mockReturnValueOnce(model.promise);
    const { POST } = await import('./route');
    const request = POST();
    await vi.waitFor(() => expect(embedContent).toHaveBeenCalledTimes(1));
    row.jawaban = 'Versi B';
    model.selesai({ embedding: { values: [0.1] } });
    const res = await request;
    expect(await res.json()).toEqual({ embedded: 0, failed: 1, remaining: 1 });
    expect(row.perlu_embed_ulang).toBe(true);
    expect(row.embedding).toBeNull();
  });

  it('dua penyimpanan selesai terbalik mempertahankan embedding versi terbaru', async () => {
    const row = await siapkan();
    const lama = tungguModel();
    const baru = tungguModel();
    embedContent.mockReturnValueOnce(lama.promise).mockReturnValueOnce(baru.promise);
    const a = panggil();
    await vi.waitFor(() => expect(embedContent).toHaveBeenCalledTimes(1));
    row.jawaban = 'Versi B';
    const b = panggil();
    await vi.waitFor(() => expect(embedContent).toHaveBeenCalledTimes(2));
    baru.selesai({ embedding: { values: [0.2] } });
    expect((await b).status).toBe(200);
    lama.selesai({ embedding: { values: [0.1] } });
    expect((await a).status).toBe(502);
    expect(row.embedding).toBe('[0.2]');
    expect(row.perlu_embed_ulang).toBe(false);
  });
});
