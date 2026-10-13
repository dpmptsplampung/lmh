// @vitest-environment jsdom
// Audit T2c: handleCabut tidak membaca hasil update -> toast sukses palsu saat jaringan putus /
// RLS menolak (0 baris tanpa error). Bot RAG tetap mengutip dokumen yang dikira sudah dicabut.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

type ErrorDb = { message: string; code?: string };
type Hasil = { data: unknown; error: ErrorDb | null; status?: number };
type Filter = [op: 'eq', kolom: string, nilai: unknown];
type Panggilan = { table: string; op: string; values: unknown; filters: Filter[]; selected: boolean };

const h = vi.hoisted(() => {
  const ok = (data: unknown): { data: unknown; error: null } => ({ data, error: null });
  const defaults = () => ({
    docs: [
      {
        id: 'd1',
        judul: 'Perda Nomor 1 Tahun 2024',
        nomor: '1/2024',
        jenis: 'peraturan',
        status: 'berlaku',
        sumber_url: null,
        created_at: '2026-01-05T00:00:00.000Z',
        layanan: null,
      },
    ] as Array<Record<string, unknown>>,
    updateResult: ok([{ id: 'd1' }]) as { data: unknown; error: { message: string; code?: string } | null; status?: number },
    insertResult: ok(null) as { data: unknown; error: { message: string; code?: string } | null; status?: number },
  });
  return {
    toast: vi.fn(),
    calls: [] as Array<{ table: string; op: string; values: unknown; filters: Array<['eq', string, unknown]>; selected: boolean }>,
    defaults,
    state: defaults(),
  };
});

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/lib/supabase/client', () => {
  const builder = (table: string) => {
    let op: 'select' | 'update' | 'insert' = 'select';
    let values: unknown;
    const filters: Filter[] = [];
    // Seperti supabase-js: UPDATE tanpa .select() TIDAK mengembalikan baris (data null) sehingga
    // mutasiWajibBaris melempar tidak_ada_baris. Baris hasil baru tersedia setelah .select dipanggil.
    let selected = false;
    const tanpaBaris = (r: Hasil): Hasil => (selected ? r : { ...r, data: null });
    const result = (): Hasil => {
      if (table === 'dokumen_peraturan') {
        if (op === 'update') return tanpaBaris(h.state.updateResult);
        if (op === 'insert') return h.state.insertResult;
        return { data: h.state.docs, error: null };
      }
      if (table === 'layanan') return { data: [{ id: 'l1', nama: 'Helpdesk OSS' }], error: null };
      return { data: [], error: null };
    };
    const b: Record<string, unknown> = {};
    b.select = () => {
      selected = true;
      return b;
    };
    b.order = () => b;
    b.eq = (kolom: string, nilai: unknown) => {
      filters.push(['eq', kolom, nilai]);
      return b;
    };
    b.update = (v: unknown) => {
      op = 'update';
      values = v;
      return b;
    };
    b.insert = (v: unknown) => {
      op = 'insert';
      values = v;
      return b;
    };
    b.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => {
      h.calls.push({ table, op, values, filters: [...filters], selected });
      return Promise.resolve(result()).then(r, j);
    };
    return b;
  };
  return { createClient: () => ({ from: builder }) };
});

import AdminDokumenPage from './page';

const ERR_JARINGAN: ErrorDb = { message: 'TypeError: Failed to fetch', code: '' };
const ERR_RLS: ErrorDb = { message: 'permission denied for table dokumen_peraturan', code: '42501' };

const panggilan = (op: string): Panggilan[] => h.calls.filter((c) => c.table === 'dokumen_peraturan' && c.op === op);
const jumlahMuatDokumen = () => panggilan('select').length;
const tidakAdaToastSukses = () => expect(h.toast.mock.calls.filter((c) => c[1] === 'success')).toEqual([]);

beforeEach(() => {
  h.toast.mockClear();
  h.calls.length = 0;
  h.state = h.defaults();
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('admin dokumen: handleCabut mengecek hasil mutasi (T2c)', () => {
  const siap = async () => {
    render(<AdminDokumenPage />);
    const tombol = await screen.findByTitle('Cabut dokumen');
    // muat awal selesai (tabel tampil) sebelum menghitung muat ulang
    await waitFor(() => expect(jumlahMuatDokumen()).toBe(1));
    return tombol;
  };

  it('update 0 baris (RLS menolak diam-diam) -> toast GAGAL bukan sukses, daftar tetap dimuat ulang', async () => {
    h.state.updateResult = { data: [], error: null };
    const tombol = await siap();
    fireEvent.click(tombol);

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/tidak berwenang/i), 'error'),
    );
    tidakAdaToastSukses();
    expect(h.toast).not.toHaveBeenCalledWith('Dokumen ditandai dicabut', 'success');
    await waitFor(() => expect(jumlahMuatDokumen()).toBe(2));
  });

  it('error jaringan -> toast gagal dengan pesan koneksi, bukan sukses; loadDocs tetap dipanggil', async () => {
    h.state.updateResult = { data: null, error: ERR_JARINGAN, status: 0 };
    const tombol = await siap();
    fireEvent.click(tombol);

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/Koneksi bermasalah/i), 'error'),
    );
    tidakAdaToastSukses();
    await waitFor(() => expect(jumlahMuatDokumen()).toBe(2));
  });

  it('error RLS eksplisit (42501) -> toast gagal "tidak berwenang"; loadDocs tetap dipanggil', async () => {
    h.state.updateResult = { data: null, error: ERR_RLS };
    const tombol = await siap();
    fireEvent.click(tombol);

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/tidak berwenang/i), 'error'),
    );
    tidakAdaToastSukses();
    await waitFor(() => expect(jumlahMuatDokumen()).toBe(2));
  });

  it('sukses: update status dicabut pada id yang benar, toast sukses setelah terbukti, daftar dimuat ulang', async () => {
    const tombol = await siap();
    fireEvent.click(tombol);

    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Dokumen ditandai dicabut', 'success'));
    const [upd] = panggilan('update');
    expect(upd.values).toEqual({ status: 'dicabut' });
    expect(upd.filters).toEqual([['eq', 'id', 'd1']]);
    await waitFor(() => expect(jumlahMuatDokumen()).toBe(2));
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('query update menyertakan .select (tanpa itu mutasiWajibBaris selalu melempar); mock setia pada supabase-js', async () => {
    const tombol = await siap();
    fireEvent.click(tombol);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Dokumen ditandai dicabut', 'success'));
    expect(panggilan('update').map((c) => c.selected)).toEqual([true]);

    // Bukti kontrak mock: update tanpa .select -> tak ada baris -> kode yang lupa .select pasti gagal.
    const { createClient } = await import('@/lib/supabase/client');
    const { mutasiWajibBaris } = await import('@/lib/supabase/mutate');
    const tanpaSelect = createClient().from('dokumen_peraturan').update({ status: 'dicabut' }).eq('id', 'd1');
    await expect(mutasiWajibBaris(tanpaSelect as never)).rejects.toMatchObject({ kode: 'tidak_ada_baris' });
  });

  it('batal pada konfirmasi: tidak ada update, tidak ada toast', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const tombol = await siap();
    fireEvent.click(tombol);

    expect(panggilan('update')).toHaveLength(0);
    expect(h.toast).not.toHaveBeenCalled();
    expect(jumlahMuatDokumen()).toBe(1);
  });
});

describe('admin dokumen: simpan dokumen baru mengecek hasil insert', () => {
  const isiDanSimpan = async () => {
    render(<AdminDokumenPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Tambah Dokumen/ }));
    fireEvent.change(await screen.findByPlaceholderText('Judul dokumen'), { target: { value: 'SOP Pelayanan' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste teks lengkap/), { target: { value: 'Pasal 1 ...' } });
    await waitFor(() => expect(jumlahMuatDokumen()).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: /Simpan Dokumen/ }));
  };

  it('insert ditolak RLS -> toast gagal (bukan "Dokumen disimpan"), form tetap terbuka', async () => {
    h.state.insertResult = { data: null, error: ERR_RLS };
    await isiDanSimpan();

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/tidak berwenang/i), 'error'),
    );
    tidakAdaToastSukses();
    expect(screen.getByPlaceholderText('Judul dokumen')).toBeTruthy();
  });

  it('insert sukses -> toast sukses dan daftar dimuat ulang', async () => {
    await isiDanSimpan();

    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Dokumen disimpan', 'success'));
    expect(panggilan('insert')[0].values).toMatchObject({ judul: 'SOP Pelayanan', teks_utama: 'Pasal 1 ...' });
    await waitFor(() => expect(jumlahMuatDokumen()).toBe(2));
  });
});
