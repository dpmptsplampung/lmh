// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

// Audit T7 (daftar layanan palsu), S14 (FAQ gagal tampil kosong senyap) dan S1 (consent PDP
// tidak boleh gagal diam-diam). supabase-js tidak melempar: kegagalan kembali sebagai `{ error }`,
// jadi mock di sini mengembalikan `{ error }` (dan, untuk jalur defensif, promise yang menolak).
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import PublicChatPage from './page';
import { createClient } from '@/lib/supabase/client';

type Hasil = { data: unknown; error: unknown };
type Sisipan = { table: string; payload: unknown };

const LAYANAN_ID = '11111111-1111-4111-8111-111111111111';
const LAYANAN_LAIN_ID = '22222222-2222-4222-8222-222222222222';
const LAYANAN_OK: Hasil = {
  data: [{ id: LAYANAN_ID, nama: 'Bank Lampung', chatbot_aktif: true }],
  error: null,
};
const GALAT_DB = { message: 'permission denied for view v_layanan_publik', code: '42501' };

// Implementasi tiap tabel dapat diganti di tengah tes (mis. gagal dulu, lalu berhasil saat "Coba lagi").
function siapkanSupabase() {
  const impl = {
    layanan: (): PromiseLike<Hasil> => Promise.resolve(LAYANAN_OK),
    faq: (): PromiseLike<Hasil> => Promise.resolve({ data: [], error: null }),
    consent: (): PromiseLike<Hasil> => Promise.resolve({ data: null, error: null }),
    sesi: (): PromiseLike<Hasil> => Promise.resolve({ data: { id: 'sesi-1', status: 'bot' }, error: null }),
    // Daftar sesi milik pengunjung (cadangan daftar percakapan bila RPC chat_percakapan_saya belum ada).
    sesiList: (): PromiseLike<Hasil> => Promise.resolve({ data: [], error: null }),
    getUser: (): PromiseLike<unknown> =>
      Promise.resolve({ data: { user: { id: 'auth-user-1' } }, error: null }),
  };
  const inserts: Sisipan[] = [];
  const filterFaq: string[] = [];

  const dari = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'neq', 'order']) b[k] = () => b;
    b.or = (filter: string) => {
      if (table === 'faq_knowledge_base') filterFaq.push(filter);
      return b;
    };
    b.single = () => {
      if (table === 'pengunjung') return Promise.resolve({ data: { id: 'peng-1', nama: 'Budi' }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    b.insert = (payload: unknown) => {
      inserts.push({ table, payload });
      if (table === 'consent_log') return impl.consent();
      const sesudah: Record<string, unknown> = {};
      sesudah.select = () => sesudah;
      sesudah.single = () => (table === 'chat_sesi' ? impl.sesi() : Promise.resolve({ data: null, error: null }));
      return sesudah;
    };
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const hasil =
        table === 'v_layanan_publik'
          ? impl.layanan()
          : table === 'faq_knowledge_base'
            ? impl.faq()
            : table === 'chat_sesi'
              ? impl.sesiList()
              : Promise.resolve({ data: [], error: null });
      return Promise.resolve(hasil).then(resolve, reject);
    };
    return b;
  };

  const saluran: Record<string, unknown> = {};
  saluran.on = () => saluran;
  saluran.subscribe = () => saluran;

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    auth: { getUser: () => impl.getUser(), signInWithOAuth: vi.fn() },
    from: dari,
    channel: () => saluran,
    removeChannel: vi.fn(),
  });

  return { impl, inserts, filterFaq };
}

async function pilihLayananDanSetuju() {
  await waitFor(() => expect(screen.getByRole('option', { name: 'Bank Lampung' })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Layanan yang Ditanyakan'), { target: { value: LAYANAN_ID } });
  fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));
}

async function tekanMulaiSesi() {
  const tombol = screen.getByRole('button', { name: /mulai sesi chat/i });
  await waitFor(() => expect(tombol).toBeEnabled());
  fireEvent.click(tombol);
}

async function mulaiSesiChat() {
  await pilihLayananDanSetuju();
  await tekanMulaiSesi();
}

describe('chat pengunjung: daftar layanan gagal dimuat (T7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ messages: [] }) })));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('{error} pada layanan -> ErrorRetry + tombol, tanpa layanan palsu atau pesan koneksi menyesatkan', async () => {
    const { impl } = siapkanSupabase();
    impl.layanan = () => Promise.resolve({ data: null, error: GALAT_DB });

    render(<PublicChatPage />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Daftar layanan belum dapat dimuat');
    expect(screen.getByRole('button', { name: /coba lagi/i })).toBeEnabled();

    // Tidak ada daftar cadangan: dropdown hanya berisi placeholder, tak ada id/nama palsu.
    const select = screen.getByLabelText('Layanan yang Ditanyakan') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['']);
    expect(document.body.innerHTML).not.toContain('fallback-');
    expect(screen.queryByRole('option', { name: /halal|nib|bank lampung/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/periksa koneksi internet/i);

    // Pengunjung tidak bisa memulai sesi dengan layanan yang tidak ada.
    expect(screen.getByRole('button', { name: /mulai sesi chat/i })).toBeDisabled();
  });

  it('promise yang menolak (jalur defensif) juga menampilkan ErrorRetry, bukan daftar cadangan', async () => {
    const { impl } = siapkanSupabase();
    impl.layanan = () => Promise.reject(new TypeError('Failed to fetch'));

    render(<PublicChatPage />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Daftar layanan belum dapat dimuat');
    expect(document.body.innerHTML).not.toContain('fallback-');
  });

  it('Coba lagi memuat ulang: tombol nonaktif selama memuat, lalu layanan tampil dan alert hilang', async () => {
    const { impl } = siapkanSupabase();
    impl.layanan = () => Promise.resolve({ data: null, error: GALAT_DB });
    render(<PublicChatPage />);
    await screen.findByRole('alert');

    let selesai!: (h: Hasil) => void;
    const layananSpy = vi.fn(
      () =>
        new Promise<Hasil>((resolve) => {
          selesai = resolve;
        }),
    );
    impl.layanan = layananSpy;
    fireEvent.click(screen.getByRole('button', { name: /coba lagi/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /memuat/i })).toBeDisabled());
    expect(layananSpy).toHaveBeenCalledTimes(1);

    selesai(LAYANAN_OK);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bank Lampung' })).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /coba lagi/i })).toBeNull();
  });

  it('gagal lagi saat Coba lagi: alert tetap tampil dan tombol aktif kembali', async () => {
    const { impl } = siapkanSupabase();
    impl.layanan = () => Promise.resolve({ data: null, error: GALAT_DB });
    render(<PublicChatPage />);
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: /coba lagi/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /coba lagi/i })).toBeEnabled());
    expect(screen.getByRole('alert').textContent).toContain('Daftar layanan belum dapat dimuat');
  });

  it('layanan berhasil dimuat: dropdown berisi layanan dari database dan tanpa alert', async () => {
    siapkanSupabase();
    render(<PublicChatPage />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bank Lampung' })).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('chat pengunjung: FAQ cepat (S14 + FAQ umum)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ messages: [] }) })));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('FAQ gagal dimuat -> pesan + Coba lagi (bukan daftar kosong atau FAQ hardcoded)', async () => {
    const { impl } = siapkanSupabase();
    impl.faq = () => Promise.resolve({ data: null, error: GALAT_DB });

    render(<PublicChatPage />);
    await mulaiSesiChat();

    await screen.findByText('Mode Chatbot FAQ Aktif');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('FAQ belum dapat dimuat');
    expect(screen.getByRole('button', { name: /coba lagi/i })).toBeEnabled();
    expect(screen.queryByText('FAQ Cepat:')).toBeNull();
    // Blok FAQ hardcoded lama (klaim "Halal GRATIS", dst.) tidak boleh muncul.
    expect(document.body.textContent).not.toMatch(/GRATIS|syarat membuat NIB|BPJS/);
  });

  it('FAQ yang promise-nya menolak juga menampilkan pesan + Coba lagi', async () => {
    const { impl } = siapkanSupabase();
    impl.faq = () => Promise.reject(new TypeError('Failed to fetch'));

    render(<PublicChatPage />);
    await mulaiSesiChat();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('FAQ belum dapat dimuat');
    expect(document.body.textContent).not.toMatch(/GRATIS/);
  });

  it('Coba lagi pada FAQ memuat ulang dan menampilkan chip', async () => {
    const { impl } = siapkanSupabase();
    impl.faq = () => Promise.resolve({ data: null, error: GALAT_DB });
    render(<PublicChatPage />);
    await mulaiSesiChat();
    await screen.findByRole('alert');

    impl.faq = () =>
      Promise.resolve({
        data: [{ id: 'f1', pertanyaan: 'Jam buka loket?', jawaban: 'A', layanan_id: LAYANAN_ID, urutan: 1 }],
        error: null,
      });
    fireEvent.click(screen.getByRole('button', { name: /coba lagi/i }));

    expect(await screen.findByRole('button', { name: 'Jam buka loket?' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('FAQ umum (layanan_id NULL) ikut tampil, FAQ layanan lebih dulu lalu urutan; filter .or memuat UUID', async () => {
    const { impl, filterFaq } = siapkanSupabase();
    // Urutan DB murni menurut `urutan`: umum bercampur dengan FAQ layanan.
    impl.faq = () =>
      Promise.resolve({
        data: [
          { id: 'u1', pertanyaan: 'Umum A', jawaban: 'x', layanan_id: null, urutan: 1 },
          { id: 'l2', pertanyaan: 'Layanan B', jawaban: 'x', layanan_id: LAYANAN_ID, urutan: 3 },
          { id: 'l1', pertanyaan: 'Layanan A', jawaban: 'x', layanan_id: LAYANAN_ID, urutan: 2 },
          { id: 'u2', pertanyaan: 'Umum B', jawaban: 'x', layanan_id: null, urutan: 4 },
        ],
        error: null,
      });

    render(<PublicChatPage />);
    await mulaiSesiChat();

    await screen.findByText('FAQ Cepat:');
    const chip = ['Layanan A', 'Layanan B', 'Umum A', 'Umum B'].map((nama) => screen.getByRole('button', { name: nama }));
    const urutanDom = chip.map((el) => Array.from(document.querySelectorAll('button')).indexOf(el as HTMLButtonElement));
    expect([...urutanDom].sort((a, b) => a - b)).toEqual(urutanDom); // sudah terurut di DOM
    expect(filterFaq).toEqual([`layanan_id.eq.${LAYANAN_ID},layanan_id.is.null`]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('FAQ umum saja (layanan belum punya FAQ) tetap tampil', async () => {
    const { impl } = siapkanSupabase();
    impl.faq = () =>
      Promise.resolve({
        data: [{ id: 'u1', pertanyaan: 'Di mana alamat kantor?', jawaban: 'x', layanan_id: null, urutan: 1 }],
        error: null,
      });
    render(<PublicChatPage />);
    await mulaiSesiChat();
    expect(await screen.findByRole('button', { name: 'Di mana alamat kantor?' })).toBeInTheDocument();
  });

  it('id layanan percakapan yang bukan UUID TIDAK masuk filter .or (cegah injeksi filter)', async () => {
    const { impl, filterFaq } = siapkanSupabase();
    impl.sesiList = () =>
      Promise.resolve({
        data: [{ id: 'sesi-1', layanan_id: 'x),aktif.eq.false,(y', status: 'bot', created_at: '2026-10-01T00:00:00Z' }],
        error: null,
      });

    render(<PublicChatPage />);

    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan/i }));
    // Layanan tak dikenal -> percakapan hanya-baca; id bukan UUID tidak pernah dipakai di filter PostgREST.
    expect(await screen.findByText(/tidak lagi melayani chat/i)).toBeInTheDocument();
    expect(filterFaq).toEqual([]);
  });

  it('percakapan dibuka dari daftar: FAQ dimuat untuk layanan milik percakapan', async () => {
    const { impl, filterFaq } = siapkanSupabase();
    impl.sesiList = () =>
      Promise.resolve({
        data: [{ id: 'sesi-1', layanan_id: LAYANAN_LAIN_ID, status: 'bot', created_at: '2026-10-01T00:00:00Z' }],
        error: null,
      });

    render(<PublicChatPage />);

    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan/i }));
    await waitFor(() => expect(filterFaq.length).toBeGreaterThan(0));
    expect(filterFaq[0]).toBe(`layanan_id.eq.${LAYANAN_LAIN_ID},layanan_id.is.null`);
  });
});

describe('chat pengunjung: consent PDP memblokir (S1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ messages: [] }) })));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('sukses: consent_log dicatat lalu sesi chat dibuat', async () => {
    const { inserts } = siapkanSupabase();
    render(<PublicChatPage />);
    await mulaiSesiChat();

    await screen.findByText('Mode Chatbot FAQ Aktif');
    const tabel = inserts.map((i) => i.table);
    expect(tabel).toEqual(['consent_log', 'chat_sesi']); // consent SEBELUM sesi
    expect(inserts[0].payload).toMatchObject({
      subjek_ref: 'peng-1',
      tujuan: 'chat_followup',
      disetujui: true,
      versi_kebijakan: '1.0',
    });
    // Percakapan diturunkan dari database, bukan localStorage.
    expect(localStorage.getItem('lmh_chat_sesi_id')).toBeNull();
  });

  it('consent_log mengembalikan {error} -> sesi TIDAK dibuat, tampil pesan + Coba lagi', async () => {
    const { impl, inserts } = siapkanSupabase();
    impl.consent = () =>
      Promise.resolve({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } });

    render(<PublicChatPage />);
    await mulaiSesiChat();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Persetujuan belum tercatat');
    expect(screen.getByRole('button', { name: /coba lagi/i })).toBeEnabled();
    expect(inserts.some((i) => i.table === 'chat_sesi')).toBe(false);
    expect(localStorage.getItem('lmh_chat_sesi_id')).toBeNull();
    // Tetap di formulir awal; tidak masuk ke ruang chat.
    expect(screen.queryByText('Mode Chatbot FAQ Aktif')).toBeNull();
    expect(screen.getByLabelText('Layanan yang Ditanyakan')).toBeInTheDocument();
  });

  it('consent_log promise menolak (jaringan) -> sesi TIDAK dibuat, pesan menyebut koneksi', async () => {
    const { impl, inserts } = siapkanSupabase();
    impl.consent = () => Promise.reject(new TypeError('Failed to fetch'));

    render(<PublicChatPage />);
    await mulaiSesiChat();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Persetujuan belum tercatat');
    expect(alert.textContent).toMatch(/koneksi/i);
    expect(inserts.some((i) => i.table === 'chat_sesi')).toBe(false);
  });

  it('Coba lagi mengulang pencatatan consent lalu melanjutkan membuat sesi bila berhasil', async () => {
    const { impl, inserts } = siapkanSupabase();
    impl.consent = () => Promise.resolve({ data: null, error: { message: 'boom', code: 'XX000' } });

    render(<PublicChatPage />);
    await mulaiSesiChat();
    await screen.findByRole('alert');
    expect(inserts.filter((i) => i.table === 'consent_log')).toHaveLength(1);

    impl.consent = () => Promise.resolve({ data: null, error: null });
    fireEvent.click(screen.getByRole('button', { name: /coba lagi/i }));

    await screen.findByText('Mode Chatbot FAQ Aktif');
    expect(inserts.filter((i) => i.table === 'consent_log')).toHaveLength(2);
    expect(inserts.filter((i) => i.table === 'chat_sesi')).toHaveLength(1);
    expect(screen.queryByText(/persetujuan belum tercatat/i)).toBeNull();
  });

  it('akun tak dapat dikenali saat mulai (getUser tanpa user) -> consent tak bisa dicatat, sesi TIDAK dibuat', async () => {
    const { impl, inserts } = siapkanSupabase();
    let panggilan = 0;
    impl.getUser = () => {
      panggilan += 1;
      // Pertama (saat halaman dibuka) ada user; kedua (saat mulai sesi) sesi login sudah hilang.
      return Promise.resolve({ data: { user: panggilan === 1 ? { id: 'auth-user-1' } : null }, error: null });
    };
    // Tanpa baris pengunjung agar consentRef bergantung pada getUser saat mulai.
    const klien = (createClient as unknown as () => { from: (t: string) => Record<string, unknown> })();
    const dariAsli = klien.from;
    klien.from = (t: string) => {
      const b = dariAsli(t);
      if (t === 'pengunjung') b.single = () => Promise.resolve({ data: null, error: null });
      return b;
    };

    render(<PublicChatPage />);
    await mulaiSesiChat();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Persetujuan belum tercatat');
    expect(inserts.some((i) => i.table === 'consent_log')).toBe(false);
    expect(inserts.some((i) => i.table === 'chat_sesi')).toBe(false);
  });

  it('gagal membuat sesi (bukan jaringan): pesan tidak menyalahkan koneksi internet', async () => {
    const { impl } = siapkanSupabase();
    impl.sesi = () => Promise.resolve({ data: null, error: { message: 'duplicate key', code: '23505' } });

    render(<PublicChatPage />);
    await mulaiSesiChat();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Gagal memulai sesi chat');
    expect(alert.textContent).not.toMatch(/koneksi internet/i);
  });

  it('gagal membuat sesi karena jaringan: pesan menyebut koneksi', async () => {
    const { impl } = siapkanSupabase();
    impl.sesi = () => Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch', code: '', status: 0 } });

    render(<PublicChatPage />);
    await mulaiSesiChat();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Gagal memulai sesi chat');
    expect(alert.textContent).toMatch(/koneksi/i);
  });
});
