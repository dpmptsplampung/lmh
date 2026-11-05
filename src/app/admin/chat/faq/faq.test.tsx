// @vitest-environment jsdom
// Kelola FAQ (poin 4 perbaikan produk): daftar penuh + dialog tambah/ubah/hapus, panel lipat Pengaturan bot,
// lencana status, pemrosesan bot otomatis. Dipertahankan dari tes lama: RBAC bot hanya Admin, cakupan per peran
// selaras RLS (T2a), setiap mutasi dicek (tanpa sukses palsu), kegagalan memuat tidak disamarkan.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';

type ErrorDb = { message: string; code?: string };
type Hasil = { data: unknown; error: ErrorDb | null; status?: number };
type Filter = [op: 'eq' | 'is', kolom: string, nilai: unknown];
type Panggilan = {
  table: string;
  op: string;
  values: unknown;
  filters: Filter[];
  selected: boolean;
  kolom: unknown;
  urut: unknown;
  menunggu: boolean;
  rentang?: [number, number];
  urutanSemua: unknown[];
};

const h = vi.hoisted(() => {
  const ok = (data: unknown): { data: unknown; error: null } => ({ data, error: null });
  const defaults = () => ({
    role: 'petugas' as string | null, // null = baris petugas tidak ditemukan
    layananGagal: false,
    petugasGagal: 0,
    faqGagalDari: null as number | null,
    faqGagal: 0, // jumlah muat daftar FAQ yang gagal sebelum pulih
    layananPetugasId: 'l1' as string | null,
    layanan: [{ id: 'l1', nama: 'Helpdesk OSS', chatbot_aktif: true }] as Array<{
      id: string;
      nama: string;
      chatbot_aktif: boolean;
    }>,
    faq: [] as Array<Record<string, unknown>>,
    menunggu: [] as Array<{ id: string }>,
    menungguGagal: false,
    updateResult: ok([{ id: 'l1' }]) as Hasil,
    faqUpdateResult: ok([{ id: 'f1' }]) as Hasil,
    faqDeleteResult: ok([{ id: 'f1' }]) as Hasil,
    faqInsertResult: ok([{ id: 'baru' }]) as Hasil,
  });
  return {
    toast: vi.fn(),
    layananUpdate: vi.fn(),
    faqInsert: vi.fn(),
    fetch: vi.fn(),
    calls: [] as Array<unknown>,
    defaults,
    state: defaults(),
  };
});

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => {
  const builder = (table: string) => {
    let op: 'select' | 'update' | 'delete' | 'insert' = 'select';
    let values: unknown;
    const filters: Filter[] = [];
    let kolom: unknown;
    let urut: unknown;
    const urutanSemua: unknown[] = [];
    let rentang: [number, number] | undefined;
    let menunggu = false;
    // Seperti supabase-js: UPDATE/DELETE tanpa .select() TIDAK mengembalikan baris (data null), sehingga
    // mutasiWajibBaris melempar tidak_ada_baris. Baris hasil hanya tersedia setelah .select dipanggil.
    let selected = false;
    const tanpaBaris = (r: Hasil): Hasil => (selected ? r : { ...r, data: null });
    const potong = <T,>(data: T[]) => rentang ? data.slice(rentang[0], rentang[1] + 1) : data.slice(0, 1000);
    const result = (): Hasil => {
      if (table === 'layanan') {
        if (op === 'update') return tanpaBaris(h.state.updateResult);
        if (h.state.layananGagal) {
          return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 };
        }
        return { data: h.state.layanan, error: null };
      }
      if (table === 'faq_knowledge_base') {
        if (op === 'update') return tanpaBaris(h.state.faqUpdateResult);
        if (op === 'delete') return tanpaBaris(h.state.faqDeleteResult);
        if (op === 'insert') return tanpaBaris(h.state.faqInsertResult);
        if (menunggu) {
          return h.state.menungguGagal
            ? { data: null, error: { message: 'kolom tidak ada', code: '42703' } }
            : { data: potong(h.state.menunggu), error: null };
        }
        if (h.state.faqGagalDari !== null && rentang && rentang[0] >= h.state.faqGagalDari) {
          return { data: null, error: { message: 'Gagal memuat batch lanjutan' } };
        }
        if (h.state.faqGagal > 0) {
          h.state.faqGagal -= 1;
          return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 };
        }
        return { data: potong(h.state.faq), error: null };
      }
      return { data: [], error: null };
    };
    const b: Record<string, unknown> = {};
    b.select = (k?: unknown) => {
      selected = true;
      kolom = k;
      return b;
    };
    b.eq = (k: string, nilai: unknown) => {
      filters.push(['eq', k, nilai]);
      return b;
    };
    b.is = (k: string, nilai: unknown) => {
      filters.push(['is', k, nilai]);
      return b;
    };
    b.or = () => {
      menunggu = true;
      return b;
    };
    b.order = (k: string, o: unknown) => {
      urut ??= [k, o];
      urutanSemua.push([k, o]);
      return b;
    };
    b.range = (de: number, ate: number) => {
      rentang = [de, ate];
      return b;
    };
    b.update = (v: unknown) => {
      op = 'update';
      values = v;
      if (table === 'layanan') h.layananUpdate(table, v);
      return b;
    };
    b.delete = () => {
      op = 'delete';
      return b;
    };
    b.insert = (v: unknown) => {
      op = 'insert';
      values = v;
      h.faqInsert(table, v);
      return b;
    };
    b.maybeSingle = () => {
      h.calls.push({ table, op, values, filters: [...filters], selected, kolom, urut, menunggu, rentang, urutanSemua });
      if (table === 'petugas' && h.state.petugasGagal > 0) {
        h.state.petugasGagal -= 1;
        return Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
      }
      return Promise.resolve({
        data:
          table === 'petugas' && h.state.role
            ? { role: h.state.role, layanan_id: h.state.layananPetugasId }
            : null,
        error: null,
      });
    };
    b.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => {
      h.calls.push({ table, op, values, filters: [...filters], selected, kolom, urut, menunggu, rentang, urutanSemua });
      return Promise.resolve(result()).then(r, j);
    };
    return b;
  };
  return {
    createClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      from: builder,
    }),
  };
});

import AdminFAQPage from './page';

const ERR_JARINGAN: ErrorDb = { message: 'TypeError: Failed to fetch', code: '' };
const ERR_RLS: ErrorDb = { message: 'new row violates row-level security policy for table "faq_knowledge_base"', code: '42501' };

const FAQ_1 = {
  id: 'f1',
  layanan_id: 'l1',
  pertanyaan: 'Syarat NIB?',
  jawaban: 'KTP dan NPWP.',
  dasar_hukum: null,
  aktif: true,
  urutan: 7,
  updated_at: '2026-11-02T03:00:00Z',
};
const FAQ_UMUM = {
  id: 'u1',
  layanan_id: null,
  pertanyaan: 'Jam buka kantor?',
  jawaban: 'Senin sampai Jumat.',
  dasar_hukum: 'Perda No. 1',
  aktif: false,
  updated_at: '2026-11-01T03:00:00Z',
};

const panggilan = (op: string, table = 'faq_knowledge_base'): Panggilan[] =>
  (h.calls as Panggilan[]).filter((c) => c.table === table && c.op === op);
const muatDaftar = () => panggilan('select').filter((c) => !c.menunggu);
const tidakAdaToastSukses = () => expect(h.toast.mock.calls.filter((c) => c[1] === 'success')).toEqual([]);
const bukaPanelBot = () => {
  const d = screen.getByText('Pengaturan bot').closest('details') as HTMLDetailsElement;
  d.open = true;
  return d;
};
const panggilanEmbed = () => h.fetch.mock.calls.filter((c) => c[0] === '/api/admin/faq/embed');

const bukaTambah = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Tambah pertanyaan/ }));
  return screen.findByRole('dialog');
};
const isiDialog = (dialog: HTMLElement, pertanyaan: string, jawaban: string) => {
  fireEvent.change(within(dialog).getByLabelText(/Pertanyaan pengunjung/), { target: { value: pertanyaan } });
  fireEvent.change(within(dialog).getByLabelText(/Jawaban bot/), { target: { value: jawaban } });
};
const simpan = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));

beforeEach(() => {
  h.toast.mockClear();
  h.layananUpdate.mockClear();
  h.faqInsert.mockClear();
  h.fetch.mockReset();
  h.fetch.mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ embedded: 1, failed: 0 }) }));
  h.calls.length = 0;
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  h.state = h.defaults();
  vi.stubGlobal('fetch', h.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('halaman: penjelasan, bahasa, dan susunan', () => {
  it('membuka dengan kalimat cara kerja bot dan tombol Tambah pertanyaan', async () => {
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    expect(await screen.findByText(/Saat pengunjung bertanya di Live Chat, bot mencari FAQ yang paling mirip/)).toBeTruthy();
    expect(screen.getByText(/Tulis pertanyaan sebagaimana pengunjung biasa menanyakannya/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tambah pertanyaan/ })).toBeTruthy();
  });

  it('tanpa istilah lama: Urutan, chatbot, auto-reply, Q:/A:, Generate Embedding, em dash', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    h.state.menunggu = [{ id: 'f1' }];
    const { container } = render(<AdminFAQPage />);
    await screen.findByText('Syarat NIB?');
    bukaPanelBot();
    const teks = container.textContent ?? '';
    expect(teks).not.toMatch(/Urutan/i);
    expect(teks).not.toMatch(/chatbot|auto-reply|knowledge base|embedding/i);
    expect(teks).not.toMatch(/\bQ:|\bA:/);
    expect(teks).not.toContain('—');
  });

  it('daftar diurutkan menurut yang terbaru diubah (updated_at menurun), bukan urutan', async () => {
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    await screen.findByText('Syarat NIB?');
    const q = muatDaftar().at(-1)!;
    expect(q.urut).toEqual(['updated_at', { ascending: false }]);
    expect(String(q.kolom)).toMatch(/urutan/);
  });

  it('keadaan memuat tampil lalu daftar; tampil cakupan, tanggal diubah, dan dasar hukum', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1, FAQ_UMUM];
    render(<AdminFAQPage />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByText('Syarat NIB?')).toBeTruthy();
    expect(screen.getByText('Dasar hukum: Perda No. 1')).toBeTruthy();
    expect(screen.getByText('Semua layanan', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText(/Diubah 2 November 2026/)).toBeTruthy();
  });

  it('daftar kosong: pesan dan ajakan menambah; Front Office: pesan FAQ umum', async () => {
    render(<AdminFAQPage />);
    expect(await screen.findByText(/Belum ada FAQ\. Tambahkan pertanyaan pertama/)).toBeTruthy();
    cleanup();
    h.state.role = 'front_office';
    render(<AdminFAQPage />);
    expect(await screen.findByText('Belum ada FAQ umum.')).toBeTruthy();
  });
});

describe('pencarian dan filter', () => {
  beforeEach(() => {
    h.state.role = 'admin';
    h.state.layanan = [
      { id: 'l1', nama: 'Helpdesk OSS', chatbot_aktif: true },
      { id: 'l2', nama: 'Non OSS', chatbot_aktif: true },
    ];
    h.state.faq = [FAQ_1, FAQ_UMUM, { ...FAQ_1, id: 'f2', layanan_id: 'l2', pertanyaan: 'Biaya izin?', jawaban: 'Gratis.' }];
  });

  it('pencarian menyaring pertanyaan dan jawaban; tanpa hasil menawarkan hapus filter', async () => {
    render(<AdminFAQPage />);
    await screen.findByText('Syarat NIB?');
    fireEvent.change(screen.getByLabelText('Cari FAQ'), { target: { value: 'gratis' } });
    expect(screen.queryByText('Syarat NIB?')).toBeNull();
    expect(screen.getByText('Biaya izin?')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Cari FAQ'), { target: { value: 'tidak-ada-kata-ini' } });
    expect(screen.getByText(/Tidak ada FAQ yang cocok/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Hapus pencarian dan filter/ }));
    expect(screen.getByText('Syarat NIB?')).toBeTruthy();
  });

  it('filter status Aktif/Nonaktif', async () => {
    render(<AdminFAQPage />);
    await screen.findByText('Syarat NIB?');
    fireEvent.click(screen.getByRole('button', { name: 'Nonaktif' }));
    expect(screen.getByText('Jam buka kantor?')).toBeTruthy();
    expect(screen.queryByText('Syarat NIB?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Aktif' }));
    expect(screen.queryByText('Jam buka kantor?')).toBeNull();
    expect(screen.getByText('Syarat NIB?')).toBeTruthy();
  });

  it('filter cakupan: FAQ umum atau per layanan', async () => {
    render(<AdminFAQPage />);
    await screen.findByText('Syarat NIB?');
    fireEvent.change(screen.getByLabelText('Untuk'), { target: { value: '__umum__' } });
    expect(screen.getByText('Jam buka kantor?')).toBeTruthy();
    expect(screen.queryByText('Syarat NIB?')).toBeNull();
    fireEvent.change(screen.getByLabelText('Untuk'), { target: { value: 'l2' } });
    expect(screen.getByText('Biaya izin?')).toBeTruthy();
    expect(screen.queryByText('Jam buka kantor?')).toBeNull();
  });
});

describe('FAQ melampaui batas PostgREST', () => {
  it('batch penuh terakhir dilanjutkan sampai hasil kosong', async () => {
    h.state.faq = Array.from({ length: 500 }, (_, i) => ({ ...FAQ_1, id: `f-${i}`, pertanyaan: `Tanya ${i}` }));
    render(<AdminFAQPage />);
    await screen.findByText('500 FAQ');
    expect(muatDaftar().map((q) => q.rentang)).toEqual([[0, 499], [500, 999]]);
  });

  it('galat batch lanjutan tidak menampilkan daftar parsial sebagai sukses', async () => {
    h.state.faq = Array.from({ length: 501 }, (_, i) => ({ ...FAQ_1, id: `f-${i}` }));
    h.state.faqGagalDari = 500;
    render(<AdminFAQPage />);
    expect(await screen.findByText('Daftar FAQ belum dapat dimuat')).toBeTruthy();
    expect(screen.queryByText('Syarat NIB?')).toBeNull();
  });

  it('melampaui batas keamanan 10000 baris menampilkan galat, tanpa daftar parsial', async () => {
    h.state.faq = Array.from({ length: 10001 }, (_, i) => ({ ...FAQ_1, id: `f-${i}` }));
    render(<AdminFAQPage />);
    expect(await screen.findByText('Daftar FAQ belum dapat dimuat')).toBeTruthy();
    expect(screen.queryByText('Syarat NIB?')).toBeNull();
    expect(muatDaftar()).toHaveLength(21);
  });

  it('memuat lebih dari 1000 FAQ dan penanda menunggu tanpa kehilangan pencarian atau cakupan', async () => {
    h.state.role = 'front_office';
    h.state.faq = Array.from({ length: 1001 }, (_, i) => ({ ...FAQ_UMUM, id: `faq-${i}`, pertanyaan: `Pertanyaan ${i}` }));
    h.state.menunggu = h.state.faq.map((r) => ({ id: String(r.id) }));
    render(<AdminFAQPage />);
    await screen.findByText('Pertanyaan 0');
    fireEvent.change(screen.getByLabelText('Cari FAQ'), { target: { value: 'Pertanyaan 1000' } });
    expect(screen.getByText('Pertanyaan 1000')).toBeTruthy();
    expect(screen.getByText('Menunggu diproses bot')).toBeTruthy();
    for (const q of panggilan('select')) {
      expect(q.filters).toEqual([['is', 'layanan_id', null]]);
      expect(q.rentang).toBeDefined();
      expect(q.urutanSemua).toContainEqual(['id', { ascending: true }]);
    }
  });
});

describe('Pengaturan bot: hanya Admin yang mengubah', () => {
  it('petugas: panel berisi status read-only dan penjelasan, tanpa tombol ubah dan tanpa Proses sekarang', async () => {
    h.state.role = 'petugas';
    render(<AdminFAQPage />);
    await screen.findByText(/Belum ada FAQ/);
    bukaPanelBot();
    expect(screen.getByText(/Pengaturan bot dikelola Admin/)).toBeTruthy();
    expect(screen.getByText(/gunakan tombol Ambil alih di Live Chat/)).toBeTruthy();
    expect(screen.getByTestId('bot-status').textContent).toBe('Aktif');
    expect(screen.queryByRole('button', { name: /Klik untuk mengubah/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Proses sekarang/ })).toBeNull();
    expect(h.layananUpdate).not.toHaveBeenCalled();
  });

  it('front_office: tidak ada panel Pengaturan bot', async () => {
    h.state.role = 'front_office';
    render(<AdminFAQPage />);
    await screen.findByText(/Belum ada FAQ umum/);
    expect(screen.queryByText('Pengaturan bot')).toBeNull();
    expect(screen.getByText(/Anda mengelola FAQ umum/)).toBeTruthy();
  });

  it('role tidak terbukti (baris petugas tidak ada): pesan tanpa akses, tanpa panel dan tanpa memuat FAQ', async () => {
    h.state.role = null;
    render(<AdminFAQPage />);
    expect(await screen.findByTestId('faq-tanpa-akses')).toBeTruthy();
    expect(screen.queryByText('Pengaturan bot')).toBeNull();
    expect(muatDaftar()).toHaveLength(0);
  });

  it('admin: tombol status bot memperbarui layanan.chatbot_aktif', async () => {
    h.state.role = 'admin';
    render(<AdminFAQPage />);
    await screen.findByText(/Belum ada FAQ/);
    bukaPanelBot();
    fireEvent.click(screen.getByRole('button', { name: /Bot Helpdesk OSS: Aktif/ }));
    await waitFor(() => expect(h.layananUpdate).toHaveBeenCalledWith('layanan', { chatbot_aktif: false }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Bot layanan ini dinonaktifkan.', 'success'));
    expect(screen.getByRole('button', { name: /Bot Helpdesk OSS: Nonaktif/ })).toBeTruthy();
  });

  it('admin: update 0 baris (ditolak RLS diam-diam) memberi galat jujur dan status tidak berubah', async () => {
    h.state.role = 'admin';
    h.state.updateResult = { data: [], error: null };
    render(<AdminFAQPage />);
    await screen.findByText(/Belum ada FAQ/);
    bukaPanelBot();
    fireEvent.click(screen.getByRole('button', { name: /Bot Helpdesk OSS: Aktif/ }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal memperbarui status bot'), 'error'));
    tidakAdaToastSukses();
    expect(screen.getByRole('button', { name: /Bot Helpdesk OSS: Aktif/ })).toBeTruthy();
  });

  it('admin: galat jaringan pada saklar bot memberi galat dan status tidak berubah', async () => {
    h.state.role = 'admin';
    h.state.updateResult = { data: null, error: ERR_JARINGAN };
    render(<AdminFAQPage />);
    await screen.findByText(/Belum ada FAQ/);
    bukaPanelBot();
    fireEvent.click(screen.getByRole('button', { name: /Bot Helpdesk OSS: Aktif/ }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal memperbarui status bot'), 'error'));
    tidakAdaToastSukses();
  });
});

describe('cakupan per peran selaras RLS (T2a)', () => {
  it('admin: FAQ dimuat tanpa pembatas layanan; dialog Tambah menawarkan Semua layanan lalu tiap layanan', async () => {
    h.state.role = 'admin';
    h.state.layanan = [
      { id: 'l1', nama: 'Helpdesk OSS', chatbot_aktif: true },
      { id: 'l2', nama: 'Non OSS', chatbot_aktif: true },
    ];
    render(<AdminFAQPage />);
    const dialog = await bukaTambah();
    expect(muatDaftar().at(-1)!.filters).toEqual([]);
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((r) => (r.closest('label') as HTMLElement).textContent)).toEqual([
      expect.stringContaining('Semua layanan'),
      expect.stringContaining('Helpdesk OSS'),
      expect.stringContaining('Non OSS'),
    ]);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
  });

  it('petugas: daftar dimuat dengan eq layanan_id dirinya; dialog tanpa pilihan cakupan (hanya layanannya)', async () => {
    h.state.role = 'petugas';
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    await screen.findByText('Syarat NIB?');
    expect(muatDaftar().at(-1)!.filters).toEqual([['eq', 'layanan_id', 'l1']]);
    const dialog = await bukaTambah();
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
    expect(within(dialog).getByText('Helpdesk OSS')).toBeTruthy();
    expect(screen.queryByLabelText('Untuk')).toBeNull();
  });

  it('petugas tanpa layanan_id: tidak ada akses, tidak memuat FAQ layanan mana pun', async () => {
    h.state.role = 'petugas';
    h.state.layananPetugasId = null;
    render(<AdminFAQPage />);
    expect(await screen.findByTestId('faq-tanpa-akses')).toBeTruthy();
    expect(muatDaftar()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Tambah pertanyaan/ })).toBeNull();
  });

  it('front_office: FAQ dimuat dengan IS NULL (bukan eq); dialog hanya untuk Semua layanan', async () => {
    h.state.role = 'front_office';
    h.state.faq = [FAQ_UMUM];
    render(<AdminFAQPage />);
    await screen.findByText('Jam buka kantor?');
    expect(muatDaftar().at(-1)!.filters).toEqual([['is', 'layanan_id', null]]);
    const dialog = await bukaTambah();
    expect(within(dialog).getByText('Semua layanan')).toBeTruthy();
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
  });

  it('admin memilih Semua layanan: insert memakai layanan_id null; memilih layanan: memakai id layanan itu', async () => {
    h.state.role = 'admin';
    render(<AdminFAQPage />);
    let dialog = await bukaTambah();
    isiDialog(dialog, 'Jam buka?', 'Senin sampai Jumat.');
    simpan(dialog);
    await waitFor(() => expect(h.faqInsert).toHaveBeenCalledTimes(1));
    expect(h.faqInsert.mock.calls[0][1]).toMatchObject({ layanan_id: null, pertanyaan: 'Jam buka?', aktif: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dialog = await bukaTambah();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Helpdesk OSS/ }));
    isiDialog(dialog, 'Syarat NIB?', 'KTP dan NPWP.');
    simpan(dialog);
    await waitFor(() => expect(h.faqInsert).toHaveBeenCalledTimes(2));
    expect(h.faqInsert.mock.calls[1][1]).toMatchObject({ layanan_id: 'l1' });
  });

  it('insert menyimpan urutan FAQ yang dipilih', async () => {
    h.state.role = 'admin';
    render(<AdminFAQPage />);
    const dialog = await bukaTambah();
    isiDialog(dialog, 'A?', 'B.');
    expect(within(dialog).getByRole('spinbutton', { name: 'Urutan' })).toHaveValue(1);
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Urutan' }), { target: { value: '12' } });
    simpan(dialog);
    await waitFor(() => expect(h.faqInsert).toHaveBeenCalled());
    expect(h.faqInsert.mock.calls[0][1]).toMatchObject({ urutan: 12 });
  });
});

describe('dialog tambah/ubah', () => {
  it('lima langkah berurutan, hitungan karakter, keterangan dasar hukum, dengan isian urutan', async () => {
    h.state.role = 'admin';
    render(<AdminFAQPage />);
    const dialog = await bukaTambah();
    expect(within(dialog).getByRole('heading', { name: 'Tambah pertanyaan' })).toBeTruthy();
    expect(within(dialog).getByText(/Untuk siapa FAQ ini\?/)).toBeTruthy();
    expect(within(dialog).getByLabelText(/Pertanyaan pengunjung/)).toBeTruthy();
    expect(within(dialog).getByText(/Tulis seperti pengunjung biasa menanyakannya/)).toBeTruthy();
    expect(within(dialog).getByLabelText(/Jawaban bot/)).toBeTruthy();
    expect(within(dialog).getByText('0 karakter')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Jawaban bot/), { target: { value: 'Halo' } });
    expect(within(dialog).getByText('4 karakter')).toBeTruthy();
    expect(within(dialog).getByLabelText(/Dasar hukum \(opsional\)/)).toBeTruthy();
    expect(within(dialog).getByText('Ditampilkan bot sebagai rujukan.')).toBeTruthy();
    expect(within(dialog).getByRole('spinbutton', { name: 'Urutan' })).toBeTruthy();
    expect(within(dialog).queryByText(/cara lain/i)).toBeNull();
  });

  it('pertanyaan atau jawaban kosong: galat di dialog, tidak menyimpan', async () => {
    h.state.role = 'admin';
    render(<AdminFAQPage />);
    const dialog = await bukaTambah();
    simpan(dialog);
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toMatch(/wajib diisi/);
    expect(h.faqInsert).not.toHaveBeenCalled();
  });

  it('Batal menutup dialog tanpa menyimpan', async () => {
    h.state.role = 'admin';
    render(<AdminFAQPage />);
    const dialog = await bukaTambah();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.faqInsert).not.toHaveBeenCalled();
  });

  it('Ubah membuka dialog yang sama, terisi, dengan cakupan tetap (tidak bisa dipindah)', async () => {
    h.state.role = 'admin';
    h.state.layanan = [
      { id: 'l1', nama: 'Helpdesk OSS', chatbot_aktif: true },
      { id: 'l2', nama: 'Non OSS', chatbot_aktif: true },
    ];
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ubah FAQ: Syarat NIB?' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Ubah pertanyaan' })).toBeTruthy();
    expect((within(dialog).getByLabelText(/Pertanyaan pengunjung/) as HTMLInputElement).value).toBe('Syarat NIB?');
    expect((within(dialog).getByLabelText(/Jawaban bot/) as HTMLTextAreaElement).value).toBe('KTP dan NPWP.');
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
    expect(within(dialog).getAllByText('Helpdesk OSS').length).toBeGreaterThan(0);
  });

  it('prefill dari Log AI Chat membuka dialog Tambah dengan pertanyaan dan catatan asal', async () => {
    h.state.role = 'admin';
    window.history.replaceState({}, '', '/admin/chat/faq?prefill_pertanyaan=Bagaimana%20cara%20daftar%20OSS%3F');
    render(<AdminFAQPage />);
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText(/Pertanyaan pengunjung/) as HTMLInputElement).value).toBe('Bagaimana cara daftar OSS?');
    expect(within(dialog).getByText('Pertanyaan ini terisi dari Log AI Chat.')).toBeTruthy();
  });
});

describe('petugas wajib menyatakan tanggung jawab (sekali per sesi)', () => {
  it('tanpa centang simpan ditolak; setelah dicentang tersimpan dan tidak ditanya lagi', async () => {
    h.state.role = 'petugas';
    render(<AdminFAQPage />);
    let dialog = await bukaTambah();
    isiDialog(dialog, 'Syarat NIB?', 'KTP dan NPWP.');
    expect(within(dialog).getByText(/bertanggung jawab atas isi FAQ ini/)).toBeTruthy();
    simpan(dialog);
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/pernyataan tanggung jawab/);
    expect(h.faqInsert).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('checkbox'));
    simpan(dialog);
    await waitFor(() => expect(h.faqInsert).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dialog = await bukaTambah();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
  });

  it('petugas tidak melihat tombol Hapus; admin tidak ditanya pernyataan', async () => {
    h.state.role = 'petugas';
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    await screen.findByText('Syarat NIB?');
    expect(screen.queryByRole('button', { name: /Hapus FAQ/ })).toBeNull();
    cleanup();
    h.state.role = 'admin';
    render(<AdminFAQPage />);
    const dialog = await bukaTambah();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
  });
});

describe('mutasi dicek, tidak ada sukses palsu (T2a)', () => {
  it('ubah: berhasil memperbarui, membaca dan menyimpan kolom urutan, dialog tertutup, toast singkat', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ubah FAQ: Syarat NIB?' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('spinbutton', { name: 'Urutan' })).toHaveValue(7);
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Urutan' }), { target: { value: '3' } });
    fireEvent.change(within(dialog).getByLabelText(/Dasar hukum/), { target: { value: 'UU 6/2023' } });
    simpan(dialog);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Perubahan disimpan.', 'success'));
    const update = panggilan('update')[0];
    expect(update.selected).toBe(true);
    expect(update.filters).toEqual([['eq', 'id', 'f1']]);
    expect(update.values).toMatchObject({ dasar_hukum: 'UU 6/2023' });
    expect(update.values).toMatchObject({ urutan: 3 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ubah: ditolak RLS (0 baris) = galat di dialog, dialog tetap terbuka dengan isian, tanpa toast sukses', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    h.state.faqUpdateResult = { data: [], error: null };
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ubah FAQ: Syarat NIB?' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Jawaban bot/), { target: { value: 'Tulisan baru saya' } });
    simpan(dialog);
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    tidakAdaToastSukses();
    expect((within(dialog).getByLabelText(/Jawaban bot/) as HTMLTextAreaElement).value).toBe('Tulisan baru saya');
    expect(panggilanEmbed()).toHaveLength(0);
  });

  it('ubah: galat jaringan = galat di dialog, tanpa toast sukses, tanpa pemrosesan bot', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    h.state.faqUpdateResult = { data: null, error: ERR_JARINGAN };
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ubah FAQ: Syarat NIB?' }));
    const dialog = await screen.findByRole('dialog');
    simpan(dialog);
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    tidakAdaToastSukses();
    expect(panggilanEmbed()).toHaveLength(0);
  });

  it('tambah: ditolak RLS memuat ulang daftar dan menampilkan galat, tanpa sukses palsu', async () => {
    h.state.role = 'petugas';
    h.state.faqInsertResult = { data: null, error: ERR_RLS };
    render(<AdminFAQPage />);
    const dialog = await bukaTambah();
    isiDialog(dialog, 'Syarat NIB?', 'KTP dan NPWP.');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    const muatSebelum = muatDaftar().length;
    simpan(dialog);
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    tidakAdaToastSukses();
    await waitFor(() => expect(muatDaftar().length).toBeGreaterThan(muatSebelum));
  });

  it('semua UPDATE/DELETE memakai .select() (tanpa itu mutasiWajibBaris selalu melempar)', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    await screen.findByText('Syarat NIB?');
    fireEvent.click(screen.getByRole('switch', { name: 'Status FAQ: Syarat NIB?' }));
    await waitFor(() => expect(panggilan('update')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Hapus FAQ: Syarat NIB?' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Hapus' }));
    await waitFor(() => expect(panggilan('delete')).toHaveLength(1));
    expect(panggilan('update')[0].selected).toBe(true);
    expect(panggilan('delete')[0].selected).toBe(true);
  });
});

describe('hapus FAQ memakai dialog konfirmasi project', () => {
  it('tidak memakai window.confirm; konfirmasi menyebut pertanyaan; Batal tidak menghapus', async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus FAQ: Syarat NIB?' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Hapus FAQ ini?' })).toBeTruthy();
    expect(within(dialog).getByText('Syarat NIB?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(panggilan('delete')).toHaveLength(0);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('konfirmasi menghapus, menutup dialog, toast singkat, dan memuat ulang', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus FAQ: Syarat NIB?' }));
    const muatSebelum = muatDaftar().length;
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Hapus' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('FAQ dihapus.', 'success'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(muatDaftar().length).toBeGreaterThan(muatSebelum));
  });

  it('0 baris terhapus = galat jujur di dialog, tanpa toast sukses', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    h.state.faqDeleteResult = { data: [], error: null };
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus FAQ: Syarat NIB?' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    tidakAdaToastSukses();
  });
});

describe('lencana status Aktif/Nonaktif sebagai saklar', () => {
  it('menampilkan status dan mengubahnya sekali klik; hasil tampil tanpa memuat ulang', async () => {
    h.state.role = 'front_office';
    h.state.faq = [FAQ_UMUM];
    render(<AdminFAQPage />);
    const saklar = await screen.findByRole('switch', { name: 'Status FAQ: Jam buka kantor?' });
    expect(saklar.getAttribute('aria-checked')).toBe('false');
    expect(saklar.textContent).toBe('Nonaktif');
    fireEvent.click(saklar);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('FAQ diaktifkan.', 'success'));
    expect(panggilan('update')[0].values).toMatchObject({ aktif: true });
    expect(screen.getByRole('switch', { name: 'Status FAQ: Jam buka kantor?' }).getAttribute('aria-checked')).toBe('true');
  });

  it('ditolak RLS (0 baris): galat jujur dan status tidak berubah', async () => {
    h.state.role = 'front_office';
    h.state.faq = [FAQ_UMUM];
    h.state.faqUpdateResult = { data: [], error: null };
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Status FAQ: Jam buka kantor?' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    tidakAdaToastSukses();
    expect(screen.getByRole('switch', { name: 'Status FAQ: Jam buka kantor?' }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('pemrosesan bot (embedding) otomatis saat simpan', () => {
  it.each(['admin', 'petugas', 'front_office'])('%s: tambah memanggil route dengan id FAQ yang baru disimpan', async (role) => {
    h.state.role = role;
    render(<AdminFAQPage />);
    const dialog = await bukaTambah();
    isiDialog(dialog, 'Jam buka?', 'Senin sampai Jumat.');
    if (role === 'petugas') fireEvent.click(within(dialog).getByRole('checkbox'));
    simpan(dialog);
    await waitFor(() => expect(panggilanEmbed()).toHaveLength(1));
    const [, init] = panggilanEmbed()[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ faqId: 'baru' });
    expect(h.toast).toHaveBeenCalledWith('Pertanyaan ditambahkan.', 'success');
    // Berhasil: tidak ada toast tindakan lanjutan.
    expect(h.toast.mock.calls.filter((c) => c[1] === 'error')).toEqual([]);
  });

  it('proses gagal: FAQ tetap tersimpan (toast sukses), ada toast galat dengan tindakan lanjutan, dialog tertutup', async () => {
    h.state.role = 'front_office';
    h.fetch.mockImplementation(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'x' }) }));
    render(<AdminFAQPage />);
    const dialog = await bukaTambah();
    isiDialog(dialog, 'Jam buka?', 'Senin sampai Jumat.');
    simpan(dialog);
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith('FAQ tersimpan, tetapi belum bisa diproses bot. Coba lagi dari daftar.', 'error'),
    );
    expect(h.toast).toHaveBeenCalledWith('Pertanyaan ditambahkan.', 'success');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('galat jaringan saat memproses: sama, simpan tidak gagal', async () => {
    h.state.role = 'admin';
    h.fetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<AdminFAQPage />);
    const dialog = await bukaTambah();
    isiDialog(dialog, 'A?', 'B.');
    simpan(dialog);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('FAQ tersimpan, tetapi belum bisa diproses bot'), 'error'));
    expect(h.toast).toHaveBeenCalledWith('Pertanyaan ditambahkan.', 'success');
  });

  it('sudah diproses (409) tidak dilaporkan sebagai galat', async () => {
    h.state.role = 'admin';
    h.fetch.mockImplementation(() => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: 'FAQ ini sudah diproses.' }) }));
    render(<AdminFAQPage />);
    const dialog = await bukaTambah();
    isiDialog(dialog, 'A?', 'B.');
    simpan(dialog);
    await waitFor(() => expect(panggilanEmbed()).toHaveLength(1));
    expect(h.toast.mock.calls.filter((c) => c[1] === 'error')).toEqual([]);
  });

  it('ubah dengan teks berubah: mengosongkan embedding lama dan memanggil route; tanpa perubahan teks tidak memanggil', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ubah FAQ: Syarat NIB?' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Dasar hukum/), { target: { value: 'UU 6/2023' } });
    simpan(dialog);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Perubahan disimpan.', 'success'));
    expect(panggilan('update')[0].values).not.toHaveProperty('embedding');
    expect(panggilanEmbed()).toHaveLength(0);

    fireEvent.click(await screen.findByRole('button', { name: 'Ubah FAQ: Syarat NIB?' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Jawaban bot/), { target: { value: 'KTP, NPWP, dan alamat usaha.' } });
    simpan(dialog);
    await waitFor(() => expect(panggilanEmbed()).toHaveLength(1));
    expect(panggilan('update')[1].values).toMatchObject({ embedding: null });
    expect(JSON.parse((panggilanEmbed()[0][1] as RequestInit).body as string)).toEqual({ faqId: 'f1' });
  });

  it('lencana "Menunggu diproses bot" pada FAQ yang belum diproses, dengan Coba lagi per baris untuk siapa pun yang boleh menyimpan', async () => {
    h.state.role = 'petugas';
    h.state.faq = [FAQ_1, { ...FAQ_1, id: 'f2', pertanyaan: 'Biaya izin?' }];
    h.state.menunggu = [{ id: 'f2' }];
    render(<AdminFAQPage />);
    await screen.findByText('Biaya izin?');
    expect(screen.getAllByText('Menunggu diproses bot')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Coba proses lagi FAQ: Biaya izin?' }));
    await waitFor(() => expect(panggilanEmbed()).toHaveLength(1));
    expect(JSON.parse((panggilanEmbed()[0][1] as RequestInit).body as string)).toEqual({ faqId: 'f2' });
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('FAQ diproses. Bot sudah bisa memakainya.', 'success'));
  });

  it('coba lagi yang gagal menampilkan galat jelas', async () => {
    h.state.role = 'front_office';
    h.state.faq = [FAQ_UMUM];
    h.state.menunggu = [{ id: 'u1' }];
    h.fetch.mockImplementation(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'x' }) }));
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Coba proses lagi FAQ/ }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Bot belum bisa memproses FAQ ini. Coba lagi beberapa saat lagi.', 'error'));
  });

  it('batas laju (429) menampilkan pesan server', async () => {
    h.state.role = 'front_office';
    h.state.faq = [FAQ_UMUM];
    h.state.menunggu = [{ id: 'u1' }];
    h.fetch.mockImplementation(() => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({ error: 'Terlalu banyak permintaan pemrosesan.' }) }));
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Coba proses lagi FAQ/ }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Terlalu banyak permintaan pemrosesan.', 'error'));
  });

  it('kueri status pemrosesan gagal: daftar tetap tampil tanpa lencana', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    h.state.menungguGagal = true;
    render(<AdminFAQPage />);
    expect(await screen.findByText('Syarat NIB?')).toBeTruthy();
    expect(screen.queryByText('Menunggu diproses bot')).toBeNull();
  });

  it('admin: Proses sekarang di panel Pengaturan bot (cadangan) memproses semuanya tanpa id; jumlah menunggu tampil', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    h.state.menunggu = [{ id: 'f1' }];
    h.fetch.mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ embedded: 1, failed: 0, remaining: 0 }) }),
    );
    render(<AdminFAQPage />);
    await screen.findByText('Syarat NIB?');
    bukaPanelBot();
    expect(screen.getByText('1 FAQ menunggu diproses bot.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Proses sekarang/ }));
    await waitFor(() => expect(panggilanEmbed()).toHaveLength(1));
    expect((panggilanEmbed()[0][1] as RequestInit).body).toBeUndefined();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('1 FAQ diproses.', 'success'));
  });

  it('admin: Proses sekarang gagal menampilkan galat dari server', async () => {
    h.state.role = 'admin';
    h.fetch.mockImplementation(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'Server misconfigured' }) }));
    render(<AdminFAQPage />);
    await screen.findByText(/Belum ada FAQ/);
    bukaPanelBot();
    fireEvent.click(screen.getByRole('button', { name: /Proses sekarang/ }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Server misconfigured', 'error'));
  });
});

describe('kegagalan memuat tidak disamarkan jadi "tanpa akses"/halaman kosong', () => {
  it('daftar FAQ gagal dimuat: ErrorRetry dengan Coba lagi, bukan daftar kosong; ulang memulihkan', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    h.state.faqGagal = 1;
    render(<AdminFAQPage />);
    expect(await screen.findByText('Daftar FAQ belum dapat dimuat')).toBeTruthy();
    expect(screen.queryByText(/Belum ada FAQ/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Syarat NIB?')).toBeTruthy();
  });

  it('front_office: gagal memuat layanan TIDAK memblokir halaman (hanya butuh FAQ umum)', async () => {
    h.state.role = 'front_office';
    h.state.layananGagal = true;
    h.state.faq = [FAQ_UMUM];
    render(<AdminFAQPage />);
    expect(await screen.findByText('Jam buka kantor?')).toBeTruthy();
    expect(screen.queryByText('Daftar layanan belum dapat dimuat')).toBeNull();
    expect(screen.queryByTestId('faq-tanpa-akses')).toBeNull();
  });

  it('admin: gagal memuat layanan memblokir dengan ErrorRetry, bukan pesan tanpa akses', async () => {
    h.state.role = 'admin';
    h.state.layananGagal = true;
    render(<AdminFAQPage />);
    expect(await screen.findByText('Daftar layanan belum dapat dimuat')).toBeTruthy();
    expect(screen.queryByTestId('faq-tanpa-akses')).toBeNull();
    expect(screen.queryByRole('button', { name: /Tambah pertanyaan/ })).toBeNull();
  });

  it('query petugas gagal (jaringan): ErrorRetry "gagal memuat", BUKAN pesan tanpa akses; ulang memulihkan', async () => {
    h.state.role = 'petugas';
    h.state.petugasGagal = 1;
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    expect(await screen.findByText('Hak akses Anda belum dapat dimuat')).toBeTruthy();
    expect(screen.queryByTestId('faq-tanpa-akses')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
    expect(await screen.findByText('Syarat NIB?')).toBeTruthy();
    expect(screen.queryByText('Hak akses Anda belum dapat dimuat')).toBeNull();
  });
});
