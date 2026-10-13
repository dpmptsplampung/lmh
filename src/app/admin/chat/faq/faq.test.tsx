// @vitest-environment jsdom
// RBAC Tahap 0: bot hidup/mati (layanan.chatbot_aktif) = Admin saja.
// Audit T2a: dropdown layanan di-scope per peran (selaras RLS) dan setiap mutasi
// FAQ dicek -- penolakan RLS (0 baris tanpa error) / error jaringan tidak boleh berujung toast sukses.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';

type ErrorDb = { message: string; code?: string };
type Hasil = { data: unknown; error: ErrorDb | null; status?: number };
type Filter = [op: 'eq' | 'is', kolom: string, nilai: unknown];
type Panggilan = { table: string; op: string; values: unknown; filters: Filter[]; selected: boolean };

const h = vi.hoisted(() => {
  const ok = (data: unknown): { data: unknown; error: null } => ({ data, error: null });
  const defaults = () => ({
    role: 'petugas' as string | null, // null = baris petugas tidak ditemukan
    layananGagal: false, // query daftar layanan mengembalikan { error } (mis. jaringan)
    petugasGagal: 0, // jumlah panggilan awal query petugas yang mengembalikan { error } sebelum pulih
    layananPetugasId: 'l1' as string | null,
    layanan: [{ id: 'l1', nama: 'Helpdesk OSS', chatbot_aktif: true }] as Array<{
      id: string;
      nama: string;
      chatbot_aktif: boolean;
    }>,
    faq: [] as Array<Record<string, unknown>>,
    updateResult: ok([{ id: 'l1' }]) as { data: unknown; error: { message: string; code?: string } | null; status?: number },
    faqUpdateResult: ok([{ id: 'f1' }]) as { data: unknown; error: { message: string; code?: string } | null; status?: number },
    faqDeleteResult: ok([{ id: 'f1' }]) as { data: unknown; error: { message: string; code?: string } | null; status?: number },
    faqInsertResult: ok(null) as { data: unknown; error: { message: string; code?: string } | null; status?: number },
  });
  return {
    toast: vi.fn(),
    layananUpdate: vi.fn(),
    faqInsert: vi.fn(),
    calls: [] as Array<{ table: string; op: string; values: unknown; filters: Array<['eq' | 'is', string, unknown]>; selected: boolean }>,
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
    // Seperti supabase-js: UPDATE/DELETE tanpa .select() TIDAK mengembalikan baris (data null), sehingga
    // mutasiWajibBaris melempar tidak_ada_baris. Baris hasil hanya tersedia setelah .select dipanggil.
    let selected = false;
    const tanpaBaris = (r: Hasil): Hasil => (selected ? r : { ...r, data: null });
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
        if (op === 'insert') return h.state.faqInsertResult;
        return { data: h.state.faq, error: null };
      }
      return { data: [], error: null };
    };
    const b: Record<string, unknown> = {};
    b.select = () => {
      selected = true;
      return b;
    };
    b.eq = (kolom: string, nilai: unknown) => {
      filters.push(['eq', kolom, nilai]);
      return b;
    };
    b.is = (kolom: string, nilai: unknown) => {
      filters.push(['is', kolom, nilai]);
      return b;
    };
    b.order = () => b;
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
      h.calls.push({ table, op, values, filters: [...filters], selected });
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
      h.calls.push({ table, op, values, filters: [...filters], selected });
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
  urutan: 1,
};

const panggilan = (op: string, table = 'faq_knowledge_base'): Panggilan[] =>
  h.calls.filter((c) => c.table === table && c.op === op);
const jumlahMuatFaq = () => panggilan('select').length;
const tidakAdaToastSukses = () =>
  expect(h.toast.mock.calls.filter((c) => c[1] === 'success')).toEqual([]);
const namaOpsi = () =>
  within(screen.getByLabelText(/Loket Layanan Tujuan/) as HTMLSelectElement)
    .getAllByRole('option')
    .map((o) => o.textContent);

beforeEach(() => {
  h.toast.mockClear();
  h.layananUpdate.mockClear();
  h.faqInsert.mockClear();
  h.calls.length = 0;
  sessionStorage.clear();
  h.state = h.defaults();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('admin FAQ: toggle bot hanya untuk Admin', () => {
  it('petugas: status bot read-only, tanpa tombol toggle, dengan penjelasan', async () => {
    h.state.role = 'petugas';
    render(<AdminFAQPage />);
    expect(await screen.findByText(/Pengaturan bot dikelola Admin/)).toBeTruthy();
    expect(screen.getByText(/gunakan tombol Ambil alih di Live Chat/)).toBeTruthy();
    expect(screen.getByTestId('bot-status').textContent).toContain('AKTIF');
    expect(screen.queryByRole('button', { name: /AKTIF|NONAKTIF/ })).toBeNull();
    expect(h.layananUpdate).not.toHaveBeenCalled();
  });

  it('front_office: hanya mengelola FAQ umum -> tanpa kartu status bot layanan dan tanpa tombol toggle', async () => {
    h.state.role = 'front_office';
    render(<AdminFAQPage />);
    expect(await screen.findByText(/Anda mengelola FAQ umum/)).toBeTruthy();
    expect(screen.queryByTestId('bot-status')).toBeNull();
    expect(screen.queryByRole('button', { name: /AKTIF|NONAKTIF/ })).toBeNull();
    expect(h.layananUpdate).not.toHaveBeenCalled();
  });

  it('role tidak terbukti (baris petugas tidak ada): tidak ada layanan yang boleh dikelola, tidak ada toggle', async () => {
    h.state.role = null;
    render(<AdminFAQPage />);
    expect(await screen.findByTestId('faq-tanpa-akses')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /AKTIF|NONAKTIF/ })).toBeNull();
    expect(screen.queryByLabelText(/Pertanyaan/)).toBeNull();
    expect(h.layananUpdate).not.toHaveBeenCalled();
  });

  it('admin: tombol toggle ada dan memperbarui layanan.chatbot_aktif', async () => {
    h.state.role = 'admin';
    render(<AdminFAQPage />);
    const btn = await screen.findByRole('button', { name: /AKTIF \(On\)/ });
    expect(screen.queryByText(/Pengaturan bot dikelola Admin/)).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(h.layananUpdate).toHaveBeenCalledWith('layanan', { chatbot_aktif: false }));
    expect(await screen.findByRole('button', { name: /NONAKTIF \(Off\)/ })).toBeTruthy();
    expect(h.toast).toHaveBeenCalledWith('Status chatbot layanan berhasil diperbarui', 'success');
  });

  it('admin: update 0 baris (ditolak RLS diam-diam) -> galat jujur, status tidak berubah', async () => {
    h.state.role = 'admin';
    h.state.updateResult = { data: [], error: null };
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: /AKTIF \(On\)/ }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal memperbarui status chatbot'), 'error'),
    );
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
    expect(screen.getByRole('button', { name: /AKTIF \(On\)/ })).toBeTruthy();
  });

  it('admin: error jaringan pada toggle -> galat, status tidak berubah', async () => {
    h.state.role = 'admin';
    h.state.updateResult = { data: null, error: ERR_JARINGAN, status: 0 };
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: /AKTIF \(On\)/ }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal memperbarui status chatbot'), 'error'),
    );
    tidakAdaToastSukses();
    expect(screen.getByRole('button', { name: /AKTIF \(On\)/ })).toBeTruthy();
  });
});

describe('admin FAQ: petugas wajib menyatakan tanggung jawab (sekali per sesi)', () => {
  const isiForm = async () => {
    fireEvent.change(await screen.findByLabelText(/Pertanyaan/), { target: { value: 'Syarat NIB?' } });
    fireEvent.change(screen.getByLabelText(/Jawaban/), { target: { value: 'KTP dan NPWP.' } });
  };

  it('petugas: tanpa centang, simpan ditolak; setelah dicentang tersimpan dan tidak ditanya lagi', async () => {
    h.state.role = 'petugas';
    const { container } = render(<AdminFAQPage />);
    await screen.findByText(/menjadi tanggung jawab Anda sebagai petugas/);
    await isiForm();
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    expect(await screen.findByText(/Centang pernyataan tanggung jawab/)).toBeTruthy();
    expect(h.faqInsert).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: /Saya memahami dan bertanggung jawab/ }));
    fireEvent.submit(form);
    await waitFor(() => expect(h.faqInsert).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('lmh_faq_tanggung_jawab')).toBe('1');
    await waitFor(() => expect(screen.queryByText(/menjadi tanggung jawab Anda sebagai petugas/)).toBeNull());
  });

  it('petugas: tombol hapus FAQ tidak tersedia', async () => {
    h.state.role = 'petugas';
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    expect(await screen.findByText(/Penghapusan permanen hanya oleh Admin/)).toBeTruthy();
    await screen.findByRole('button', { name: /Edit FAQ/ });
    expect(screen.queryByRole('button', { name: /Hapus FAQ/ })).toBeNull();
  });

  it('admin: tidak ada peringatan dan simpan langsung', async () => {
    h.state.role = 'admin';
    const { container } = render(<AdminFAQPage />);
    await screen.findByRole('button', { name: /AKTIF \(On\)/ });
    expect(screen.queryByText(/menjadi tanggung jawab Anda sebagai petugas/)).toBeNull();
    await isiForm();
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(h.faqInsert).toHaveBeenCalledTimes(1));
  });
});

describe('admin FAQ: dropdown layanan di-scope sesuai RLS (T2a)', () => {
  const DUA_LAYANAN = [
    { id: 'l1', nama: 'Helpdesk OSS', chatbot_aktif: true },
    { id: 'l2', nama: 'Perizinan Non-OSS', chatbot_aktif: false },
  ];

  it('admin: opsi Umum di urutan pertama lalu semua layanan; terpilih awal = layanan pertama (bukan Umum)', async () => {
    h.state.role = 'admin';
    h.state.layanan = DUA_LAYANAN;
    render(<AdminFAQPage />);
    await screen.findByRole('button', { name: /AKTIF \(On\)/ });
    expect(namaOpsi()).toEqual(['Umum (semua layanan)', 'Helpdesk OSS', 'Perizinan Non-OSS']);
    const select = screen.getByLabelText(/Loket Layanan Tujuan/) as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe('Helpdesk OSS');
    await waitFor(() => expect(panggilan('select').at(-1)?.filters).toEqual([['eq', 'layanan_id', 'l1']]));
  });

  it('petugas: dropdown hanya berisi layanannya sendiri, tanpa Umum, dan FAQ dimuat untuk layanan itu', async () => {
    h.state.role = 'petugas';
    h.state.layananPetugasId = 'l2';
    h.state.layanan = DUA_LAYANAN;
    render(<AdminFAQPage />);
    await screen.findByText(/Pengaturan bot dikelola Admin/);
    expect(namaOpsi()).toEqual(['Perizinan Non-OSS']);
    await waitFor(() => expect(panggilan('select').at(-1)?.filters).toEqual([['eq', 'layanan_id', 'l2']]));
  });

  it('petugas tanpa layanan_id: tidak ada akses (tidak menampilkan layanan lain, tidak memuat FAQ)', async () => {
    h.state.role = 'petugas';
    h.state.layananPetugasId = null;
    h.state.layanan = DUA_LAYANAN;
    render(<AdminFAQPage />);
    expect(await screen.findByTestId('faq-tanpa-akses')).toBeTruthy();
    expect(screen.queryByText('Perizinan Non-OSS')).toBeNull();
    expect(jumlahMuatFaq()).toBe(0);
  });

  it('front_office: hanya "Umum (semua layanan)"; FAQ dimuat dengan filter IS NULL (bukan eq)', async () => {
    h.state.role = 'front_office';
    h.state.layanan = DUA_LAYANAN;
    render(<AdminFAQPage />);
    await screen.findByText(/Anda mengelola FAQ umum/);
    expect(namaOpsi()).toEqual(['Umum (semua layanan)']);
    await waitFor(() => expect(panggilan('select').at(-1)?.filters).toEqual([['is', 'layanan_id', null]]));
    expect(panggilan('select').every((c) => c.filters.every((f) => f[0] !== 'eq'))).toBe(true);
  });

  it('admin memilih Umum: daftar dimuat dengan IS NULL dan insert memakai layanan_id null', async () => {
    h.state.role = 'admin';
    h.state.layanan = DUA_LAYANAN;
    const { container } = render(<AdminFAQPage />);
    await screen.findByRole('button', { name: /AKTIF \(On\)/ });
    const select = screen.getByLabelText(/Loket Layanan Tujuan/) as HTMLSelectElement;
    const opsiUmum = within(select).getByRole('option', { name: /Umum/ }) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: opsiUmum.value } });

    await waitFor(() => expect(panggilan('select').at(-1)?.filters).toEqual([['is', 'layanan_id', null]]));
    // kartu status bot per layanan tidak relevan untuk FAQ umum
    expect(screen.queryByRole('button', { name: /AKTIF|NONAKTIF/ })).toBeNull();

    fireEvent.change(await screen.findByLabelText(/Pertanyaan/), { target: { value: 'Jam buka?' } });
    fireEvent.change(screen.getByLabelText(/Jawaban/), { target: { value: '08.00-16.00 WIB.' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(h.faqInsert).toHaveBeenCalledTimes(1));
    expect(h.faqInsert.mock.calls[0][1]).toMatchObject({ layanan_id: null, pertanyaan: 'Jam buka?' });
  });

  it('admin memilih layanan: insert memakai layanan_id layanan itu', async () => {
    h.state.role = 'admin';
    h.state.layanan = DUA_LAYANAN;
    const { container } = render(<AdminFAQPage />);
    await screen.findByRole('button', { name: /AKTIF \(On\)/ });
    fireEvent.change(await screen.findByLabelText(/Pertanyaan/), { target: { value: 'Q?' } });
    fireEvent.change(screen.getByLabelText(/Jawaban/), { target: { value: 'A.' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(h.faqInsert).toHaveBeenCalledTimes(1));
    expect(h.faqInsert.mock.calls[0][1]).toMatchObject({ layanan_id: 'l1' });
  });
});

describe('admin FAQ: mutasi dicek, tidak ada toast sukses palsu (T2a)', () => {
  const siapkanEdit = async (jawaban = 'KTP, NPWP, dan alamat usaha.') => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    const { container } = render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit FAQ/ }));
    fireEvent.change(screen.getByLabelText(/Jawaban/), { target: { value: jawaban } });
    return { form: container.querySelector('form')! };
  };
  const urlEmbedDipanggil = () =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes('/api/admin/faq/embed'));

  describe('edit', () => {
    it('update 0 baris (RLS menolak diam-diam) -> toast GAGAL, bukan sukses; tidak ada state berhasil; daftar dimuat ulang', async () => {
      h.state.faqUpdateResult = { data: [], error: null };
      const { form } = await siapkanEdit();
      const muatAwal = jumlahMuatFaq();
      fireEvent.submit(form);

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/tidak berwenang/i), 'error'),
      );
      tidakAdaToastSukses();
      expect(h.toast).not.toHaveBeenCalledWith('FAQ berhasil diperbarui', 'success');
      // bukan "berhasil": form tetap mode edit dengan isian pengguna, embedding tidak dipicu
      expect(screen.getByText('Edit FAQ')).toBeTruthy();
      expect((screen.getByLabelText(/Jawaban/) as HTMLTextAreaElement).value).toBe('KTP, NPWP, dan alamat usaha.');
      expect(urlEmbedDipanggil()).toBe(false);
      // daftar dimuat ulang agar tampilan sesuai kondisi server
      await waitFor(() => expect(jumlahMuatFaq()).toBe(muatAwal + 1));
    });

    it('error jaringan -> toast gagal dengan pesan koneksi, tidak sukses', async () => {
      h.state.faqUpdateResult = { data: null, error: ERR_JARINGAN, status: 0 };
      const { form } = await siapkanEdit();
      fireEvent.submit(form);
      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/Koneksi bermasalah/i), 'error'),
      );
      tidakAdaToastSukses();
      expect(screen.getByText('Edit FAQ')).toBeTruthy();
      expect(urlEmbedDipanggil()).toBe(false);
    });

    it('error RLS eksplisit (42501) -> toast gagal "tidak berwenang"', async () => {
      h.state.faqUpdateResult = { data: null, error: ERR_RLS };
      const { form } = await siapkanEdit();
      fireEvent.submit(form);
      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/tidak berwenang/i), 'error'),
      );
      tidakAdaToastSukses();
    });

    it('sukses: toast sukses SETELAH baris terdampak terbukti, embedding di-null-kan, daftar dimuat ulang, embed dipicu', async () => {
      const { form } = await siapkanEdit();
      const muatAwal = jumlahMuatFaq();
      fireEvent.submit(form);

      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('FAQ berhasil diperbarui', 'success'));
      const [upd] = panggilan('update');
      expect(upd.values).toMatchObject({
        pertanyaan: 'Syarat NIB?',
        jawaban: 'KTP, NPWP, dan alamat usaha.',
        embedding: null,
      });
      expect(upd.filters).toEqual([['eq', 'id', 'f1']]);
      await waitFor(() => expect(jumlahMuatFaq()).toBe(muatAwal + 1));
      await waitFor(() => expect(urlEmbedDipanggil()).toBe(true));
      // form kembali ke mode tambah
      expect(screen.getByText('Tambah FAQ Baru')).toBeTruthy();
      expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'error');
    });
  });

  describe('hapus', () => {
    const siapkanHapus = async () => {
      h.state.role = 'admin';
      h.state.faq = [FAQ_1];
      render(<AdminFAQPage />);
      return screen.findByRole('button', { name: /Hapus FAQ/ });
    };

    it('delete 0 baris (RLS menolak diam-diam) -> toast GAGAL, bukan sukses; daftar dimuat ulang', async () => {
      h.state.faqDeleteResult = { data: [], error: null };
      const tombol = await siapkanHapus();
      const muatAwal = jumlahMuatFaq();
      fireEvent.click(tombol);

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/tidak berwenang/i), 'error'),
      );
      tidakAdaToastSukses();
      expect(h.toast).not.toHaveBeenCalledWith('FAQ berhasil dihapus', 'success');
      await waitFor(() => expect(jumlahMuatFaq()).toBe(muatAwal + 1));
    });

    it('error jaringan -> toast gagal, tidak sukses', async () => {
      h.state.faqDeleteResult = { data: null, error: ERR_JARINGAN, status: 0 };
      const tombol = await siapkanHapus();
      fireEvent.click(tombol);
      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/Koneksi bermasalah/i), 'error'),
      );
      tidakAdaToastSukses();
    });

    it('batal pada konfirmasi: tidak ada penghapusan sama sekali', async () => {
      vi.stubGlobal('confirm', vi.fn(() => false));
      const tombol = await siapkanHapus();
      fireEvent.click(tombol);
      expect(panggilan('delete')).toHaveLength(0);
      expect(h.toast).not.toHaveBeenCalled();
    });

    it('sukses: toast sukses setelah terbukti dan daftar dimuat ulang', async () => {
      const tombol = await siapkanHapus();
      const muatAwal = jumlahMuatFaq();
      fireEvent.click(tombol);

      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('FAQ berhasil dihapus', 'success'));
      expect(panggilan('delete')[0].filters).toEqual([['eq', 'id', 'f1']]);
      await waitFor(() => expect(jumlahMuatFaq()).toBe(muatAwal + 1));
      expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'error');
    });
  });

  describe('simpan baru', () => {
    const isiDanKirim = async () => {
      h.state.role = 'admin';
      const { container } = render(<AdminFAQPage />);
      await screen.findByRole('button', { name: /AKTIF \(On\)/ });
      fireEvent.change(await screen.findByLabelText(/Pertanyaan/), { target: { value: 'Syarat NIB?' } });
      fireEvent.change(screen.getByLabelText(/Jawaban/), { target: { value: 'KTP dan NPWP.' } });
      fireEvent.submit(container.querySelector('form')!);
    };

    it('insert ditolak RLS (42501) -> toast gagal, bukan sukses; embed tidak dipicu; daftar dimuat ulang', async () => {
      h.state.faqInsertResult = { data: null, error: ERR_RLS };
      await isiDanKirim();
      const muatAwal = jumlahMuatFaq();
      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/tidak berwenang/i), 'error'),
      );
      tidakAdaToastSukses();
      expect(urlEmbedDipanggil()).toBe(false);
      await waitFor(() => expect(jumlahMuatFaq()).toBe(muatAwal + 1));
    });

    it('insert gagal jaringan -> toast gagal, bukan sukses', async () => {
      h.state.faqInsertResult = { data: null, error: ERR_JARINGAN, status: 0 };
      await isiDanKirim();
      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/Koneksi bermasalah/i), 'error'),
      );
      tidakAdaToastSukses();
    });

    it('insert sukses -> toast sukses dan daftar dimuat ulang', async () => {
      await isiDanKirim();
      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('FAQ baru berhasil ditambahkan', 'success'));
      await waitFor(() => expect(jumlahMuatFaq()).toBeGreaterThanOrEqual(2));
    });
  });
});

describe('admin FAQ: setiap UPDATE/DELETE memakai .select() (tanpa itu mutasiWajibBaris selalu melempar)', () => {
  it('edit FAQ: query update menyertakan .select', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    const { container } = render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit FAQ/ }));
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('FAQ berhasil diperbarui', 'success'));
    expect(panggilan('update').map((c) => c.selected)).toEqual([true]);
  });

  it('hapus FAQ: query delete menyertakan .select', async () => {
    h.state.role = 'admin';
    h.state.faq = [FAQ_1];
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Hapus FAQ/ }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('FAQ berhasil dihapus', 'success'));
    expect(panggilan('delete').map((c) => c.selected)).toEqual([true]);
  });

  it('toggle bot: query update layanan menyertakan .select', async () => {
    h.state.role = 'admin';
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: /AKTIF \(On\)/ }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Status chatbot layanan berhasil diperbarui', 'success'));
    expect(panggilan('update', 'layanan').map((c) => c.selected)).toEqual([true]);
  });

  it('mock setia pada supabase-js: update tanpa .select tidak mengembalikan baris -> kode yang lupa .select pasti gagal', async () => {
    const { createClient } = await import('@/lib/supabase/client');
    const { mutasiWajibBaris } = await import('@/lib/supabase/mutate');
    const tanpaSelect = createClient().from('faq_knowledge_base').update({ aktif: false }).eq('id', 'f1');
    await expect(mutasiWajibBaris(tanpaSelect as never)).rejects.toMatchObject({ kode: 'tidak_ada_baris' });
    const denganSelect = createClient().from('faq_knowledge_base').update({ aktif: false }).eq('id', 'f1').select('id');
    await expect(mutasiWajibBaris(denganSelect as never)).resolves.toEqual([{ id: 'f1' }]);
  });
});

describe('admin FAQ: embedding RAG hanya untuk Admin (endpoint /api/admin/faq/embed khusus Admin)', () => {
  const simpanBaru = async () => {
    const { container } = render(<AdminFAQPage />);
    fireEvent.change(await screen.findByLabelText(/Pertanyaan/), { target: { value: 'Jam buka?' } });
    fireEvent.change(screen.getByLabelText(/Jawaban/), { target: { value: '08.00-16.00 WIB.' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('FAQ baru berhasil ditambahkan', 'success'));
  };
  const embedDipanggil = () =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes('/api/admin/faq/embed'));

  it('front_office: simpan TIDAK memanggil embed, tanpa toast galat, tanpa tombol Generate Embedding, ada catatan jujur', async () => {
    h.state.role = 'front_office';
    await simpanBaru();
    expect(embedDipanggil()).toBe(false);
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'error');
    expect(screen.queryByRole('button', { name: /Generate Embedding/ })).toBeNull();
    expect(screen.getByText(/baru aktif setelah Admin menjalankan embedding/)).toBeTruthy();
  });

  it('petugas: simpan TIDAK memanggil embed, tanpa tombol Generate Embedding, ada catatan', async () => {
    h.state.role = 'petugas';
    sessionStorage.setItem('lmh_faq_tanggung_jawab', '1');
    await simpanBaru();
    expect(embedDipanggil()).toBe(false);
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'error');
    expect(screen.queryByRole('button', { name: /Generate Embedding/ })).toBeNull();
    expect(screen.getByText(/baru aktif setelah Admin menjalankan embedding/)).toBeTruthy();
  });

  it('admin: simpan memanggil embed, tombol Generate Embedding ada, tanpa catatan', async () => {
    h.state.role = 'admin';
    await simpanBaru();
    await waitFor(() => expect(embedDipanggil()).toBe(true));
    expect(screen.getByRole('button', { name: /Generate Embedding/ })).toBeTruthy();
    expect(screen.queryByText(/baru aktif setelah Admin menjalankan embedding/)).toBeNull();
  });
});

describe('admin FAQ: kegagalan memuat tidak disamarkan jadi "tidak ada akses"/halaman kosong', () => {
  const jumlahMuatLayanan = () => panggilan('select', 'layanan').length;
  const jumlahMuatPetugas = () => panggilan('select', 'petugas').length;

  it('front_office: gagal memuat layanan TIDAK memblokir halaman (FO hanya butuh Umum)', async () => {
    h.state.role = 'front_office';
    h.state.layananGagal = true;
    render(<AdminFAQPage />);
    expect(await screen.findByText(/Anda mengelola FAQ umum/)).toBeTruthy();
    expect(screen.getByLabelText(/Pertanyaan/)).toBeTruthy();
    expect(namaOpsi()).toEqual(['Umum (semua layanan)']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(['admin', 'petugas'])('%s: gagal memuat layanan -> ErrorRetry + Muat ulang; berhasil setelah diulang', async (role) => {
    h.state.role = role;
    h.state.layananGagal = true;
    render(<AdminFAQPage />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/daftar layanan/i);
    expect(screen.queryByTestId('faq-tanpa-akses')).toBeNull();
    expect(screen.queryByLabelText(/Pertanyaan/)).toBeNull();

    const muatAwal = jumlahMuatLayanan();
    h.state.layananGagal = false;
    fireEvent.click(within(alert).getByRole('button', { name: /Muat ulang/ }));
    await waitFor(() => expect(jumlahMuatLayanan()).toBe(muatAwal + 1));
    expect(await screen.findByLabelText(/Pertanyaan/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('query petugas gagal (jaringan): ErrorRetry "gagal memuat", BUKAN pesan tanpa akses; ulang -> pulih', async () => {
    h.state.role = 'admin';
    h.state.petugasGagal = 1;
    render(<AdminFAQPage />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/hak akses/i);
    expect(screen.queryByTestId('faq-tanpa-akses')).toBeNull();
    expect(screen.queryByText(/Hubungi Admin/)).toBeNull();

    const muatAwal = jumlahMuatPetugas();
    fireEvent.click(within(alert).getByRole('button', { name: /Muat ulang/ }));
    await waitFor(() => expect(jumlahMuatPetugas()).toBe(muatAwal + 1));
    expect(await screen.findByRole('button', { name: /AKTIF \(On\)/ })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('baris petugas memang tidak ada (bukan galat) tetap menampilkan pesan tanpa akses', async () => {
    h.state.role = null;
    render(<AdminFAQPage />);
    expect(await screen.findByTestId('faq-tanpa-akses')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
