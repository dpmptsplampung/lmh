// @vitest-environment jsdom
// Kotak Masuk FO (Tahap B): daftar penanganan FO `menunggu`, alasan pengembalian dari tahap sebelumnya, ambil atomik
// (fo_ambil_dari_kotak_masuk) dengan penanganan SUDAH_DIAMBIL. Kontrak: docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §6.1, §2.6.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { buatH, punyaOp, type FakeH, type Op } from '@/test/fo-supabase-mock';

const m = vi.hoisted(() => ({
  toast: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  realtime: vi.fn(),
  h: null as unknown as FakeH,
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push, replace: m.replace }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: m.realtime }));
vi.mock('@/lib/supabase/client', async () => {
  const { buatFakeSupabase } = await import('@/test/fo-supabase-mock');
  return { createClient: () => buatFakeSupabase(m.h) };
});

import KotakMasukFoPage from './page';

const kunjungan = (o: Record<string, unknown> = {}) => ({
  nama: 'Budi Santoso', kontak_hp: '081234567890', asal_instansi: 'CV Maju', keperluan: 'Urus NIB',
  asal: 'walk_in', tanggal: '2026-10-13', ...o,
});
const barisKotak = (o: Record<string, unknown> = {}) => ({
  id: 'pn-1', kunjungan_id: 'k-1', tahap_ke: 1, saluran: 'walk_in', created_at: '2026-10-13T02:00:00.000Z',
  dibuat_oleh: null, kunjungan: kunjungan(), ...o,
});

/** `penanganan` menjawab dua kueri: kotak masuk (status menunggu) dan tahap pengembalian (hasil dikembalikan). */
function siapkan(inbox: unknown[], tahapSebelumnya: unknown[] = []) {
  m.h.tabel.penanganan = (ops: Op[]) =>
    punyaOp(ops, 'eq', 'hasil', 'dikembalikan')
      ? { data: tahapSebelumnya, error: null }
      : { data: inbox, error: null };
  m.h.tabel.layanan = { data: [{ id: 'l-1', nama: 'Helpdesk OSS' }], error: null };
  m.h.tabel.petugas = { data: [{ id: 'p-9', nama: 'Sari' }], error: null };
}

beforeEach(() => {
  m.h = buatH();
  m.toast.mockClear();
  m.push.mockClear();
  m.replace.mockClear();
  m.realtime.mockClear();
});
afterEach(cleanup);

describe('Kotak Masuk FO', () => {
  it('memuat penanganan FO berstatus menunggu, urut waktu masuk, dan memasang realtime pada tabel penanganan', async () => {
    siapkan([barisKotak()]);
    render(<KotakMasukFoPage />);

    expect(await screen.findByRole('heading', { name: 'Budi Santoso' })).toBeInTheDocument();
    expect(screen.getByText(/Urus NIB/)).toBeInTheDocument();
    expect(screen.getByText(/CV Maju/)).toBeInTheDocument();

    const kueri = m.h.log.find((l) => l.tabel === 'penanganan')!;
    expect(punyaOp(kueri.ops, 'eq', 'peran_tahap', 'fo')).toBe(true);
    expect(punyaOp(kueri.ops, 'eq', 'status', 'menunggu')).toBe(true);
    expect(punyaOp(kueri.ops, 'order', 'created_at')).toBe(true);
    expect(m.realtime).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ table: 'penanganan' }));
  });

  it('kotak masuk kosong menampilkan pesan, bukan daftar', async () => {
    siapkan([]);
    render(<KotakMasukFoPage />);
    expect(await screen.findByText(/Kotak masuk kosong/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ambil/ })).toBeNull();
  });

  it('menampilkan alasan pengembalian (catatan, layanan, petugas) dari tahap sebelumnya', async () => {
    siapkan(
      [barisKotak({ id: 'pn-2', tahap_ke: 3 })],
      [
        { kunjungan_id: 'k-1', tahap_ke: 2, catatan: 'Berkas NIB belum lengkap, minta ke FO', layanan_id: 'l-1', penangan_id: 'p-9', selesai_at: null },
        // tahap pengembalian lain (bukan tahap_ke - 1) tidak boleh terpakai
        { kunjungan_id: 'k-1', tahap_ke: 1, catatan: 'SALAH', layanan_id: null, penangan_id: null, selesai_at: null },
      ],
    );
    render(<KotakMasukFoPage />);

    const kembali = await screen.findByText(/Dikembalikan/);
    expect(kembali.parentElement).toHaveTextContent('dari Helpdesk OSS');
    expect(kembali.parentElement).toHaveTextContent('(Sari)');
    expect(kembali.parentElement).toHaveTextContent('Berkas NIB belum lengkap, minta ke FO');
    expect(screen.queryByText(/SALAH/)).toBeNull();
  });

  it('pengunjung yang dikembalikan menampilkan nama FO yang melayani sebelumnya (FO mana pun; keterbukaan antar FO)', async () => {
    siapkan(
      [barisKotak({ id: 'pn-4', tahap_ke: 4 })],
      [{ kunjungan_id: 'k-1', tahap_ke: 3, catatan: 'Kurang berkas', layanan_id: 'l-1', penangan_id: 'p-9', selesai_at: null }],
    );
    const dasar = m.h.tabel.penanganan as (ops: Op[]) => { data: unknown; error: null };
    m.h.tabel.penanganan = (ops: Op[]) =>
      ops.some(([op, a]) => op === 'not' && a[0] === 'penangan_id')
        ? {
            data: [
              { kunjungan_id: 'k-1', tahap_ke: 1, penangan_id: 'p-fo-a' },
              { kunjungan_id: 'k-1', tahap_ke: 2, penangan_id: 'p-fo-b' },
              { kunjungan_id: 'k-1', tahap_ke: 5, penangan_id: 'p-fo-c' }, // sesudah item ini: tidak dipakai
            ],
            error: null,
          }
        : dasar(ops);
    m.h.tabel.petugas = {
      data: [{ id: 'p-9', nama: 'Sari' }, { id: 'p-fo-a', nama: 'Ani FO' }, { id: 'p-fo-b', nama: 'Bayu FO' }, { id: 'p-fo-c', nama: 'Citra FO' }],
      error: null,
    };
    render(<KotakMasukFoPage />);
    expect(await screen.findByText(/Sebelumnya dilayani Front Office: Bayu FO/)).toBeInTheDocument();
    expect(screen.queryByText(/Citra FO/)).toBeNull();
    const kueriFo = m.h.log.find((l) => l.tabel === 'penanganan' && l.ops.some(([op]) => op === 'not'))!;
    expect(punyaOp(kueriFo.ops, 'eq', 'peran_tahap', 'fo')).toBe(true);
  });

  it('tahap pertama (bukan pengembalian) tidak menampilkan blok "Dikembalikan"', async () => {
    siapkan([barisKotak()]);
    render(<KotakMasukFoPage />);
    await screen.findByRole('heading', { name: 'Budi Santoso' });
    expect(screen.queryByText(/Dikembalikan/)).toBeNull();
  });

  it('Ambil memanggil fo_ambil_dari_kotak_masuk lalu lanjut ke Penanganan', async () => {
    siapkan([barisKotak()]);
    m.h.rpc = () => ({ data: { ok: true, sudah_milik_anda: false, penanganan_id: 'pn-1', kunjungan_id: 'k-1' }, error: null });
    render(<KotakMasukFoPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ambil Budi Santoso' }));

    await waitFor(() => expect(m.push).toHaveBeenCalledWith('/admin/fo/penanganan'));
    expect(m.h.rpcLog).toEqual([{ nama: 'fo_ambil_dari_kotak_masuk', args: { p_penanganan_id: 'pn-1' } }]);
    expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('Budi Santoso'), 'success');
  });

  it('SUDAH_DIAMBIL (kalah balapan): pesan ramah, tidak pindah halaman, dan daftar dimuat ulang', async () => {
    siapkan([barisKotak()]);
    m.h.rpc = () => ({ data: null, error: { message: 'SUDAH_DIAMBIL: penanganan sudah diambil FO lain', code: 'P0001' } });
    render(<KotakMasukFoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ambil Budi Santoso' }));

    await waitFor(() =>
      expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('diambil oleh Front Office lain'), 'info'),
    );
    expect(m.push).not.toHaveBeenCalled();
    expect(m.toast).not.toHaveBeenCalledWith(expect.anything(), 'error');
    // dimuat ulang: kueri kotak masuk dijalankan lagi setelah awal
    await waitFor(() => expect(m.h.log.filter((l) => l.tabel === 'penanganan' && punyaOp(l.ops, 'eq', 'status', 'menunggu')).length).toBeGreaterThanOrEqual(2));
    // tombol aktif kembali (tidak terkunci selamanya)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ambil Budi Santoso' })).toBeEnabled());
  });

  it('galat jaringan: toast gagal tanpa pesan teknis, tetap di halaman', async () => {
    siapkan([barisKotak()]);
    m.h.rpc = () => ({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
    render(<KotakMasukFoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ambil Budi Santoso' }));

    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('Koneksi bermasalah'), 'error'));
    expect(m.toast).not.toHaveBeenCalledWith(expect.stringContaining('Failed to fetch'), 'error');
    expect(m.push).not.toHaveBeenCalled();
  });

  it('SESI_TIDAK_SAH mengarahkan ke login (pola A2)', async () => {
    siapkan([barisKotak()]);
    m.h.rpc = () => ({ data: null, error: { message: 'SESI_TIDAK_SAH: sesi tidak valid', code: '42501' } });
    render(<KotakMasukFoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ambil Budi Santoso' }));

    await waitFor(() => expect(m.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?alasan=/)));
    expect(m.push).not.toHaveBeenCalled();
  });

  it('tombol dikunci selama request dan klik ganda hanya memanggil RPC sekali', async () => {
    siapkan([barisKotak()]);
    let selesai: (v: { data: unknown; error: null }) => void = () => {};
    m.h.rpc = () => new Promise((r) => { selesai = r; });
    render(<KotakMasukFoPage />);

    const tombol = await screen.findByRole('button', { name: 'Ambil Budi Santoso' });
    fireEvent.click(tombol);
    fireEvent.click(tombol);

    await waitFor(() => expect(tombol).toBeDisabled());
    expect(tombol).toHaveAttribute('aria-busy', 'true');
    expect(m.h.rpcLog).toHaveLength(1);

    selesai({ data: { ok: true, penanganan_id: 'pn-1', kunjungan_id: 'k-1' }, error: null });
    await waitFor(() => expect(m.push).toHaveBeenCalledTimes(1));
  });

  it('item berkanal chat: tanpa tombol Ambil (DB menolak SALURAN_CHAT), ditautkan ke Live Chat; RPC FO tidak dipanggil', async () => {
    siapkan([
      barisKotak({ id: 'pn-c', saluran: 'chat', chat_sesi_id: 'sesi-77', kunjungan: kunjungan({ nama: 'Ani Chat', asal: 'online', keperluan: null }) }),
      barisKotak({ id: 'pn-w', kunjungan: kunjungan({ nama: 'Budi Walkin' }) }),
    ]);
    render(<KotakMasukFoPage />);

    const tautan = await screen.findByRole('link', { name: 'Buka di Live Chat' });
    expect(tautan).toHaveAttribute('href', '/admin/chat?sesi=sesi-77');
    expect(screen.queryByRole('button', { name: 'Ambil Ani Chat' })).toBeNull();
    // Item non-chat tetap memakai tombol Ambil.
    expect(screen.getByRole('button', { name: 'Ambil Budi Walkin' })).toBeInTheDocument();
    expect(m.h.rpcLog).toEqual([]);
    expect(screen.getByText('Chat')).toBeInTheDocument(); // lencana saluran

    // kueri memuat chat_sesi_id untuk tautan
    const kueri = m.h.log.find((l) => l.tabel === 'penanganan')!;
    const select = kueri.ops.find(([op]) => op === 'select')![1][0] as string;
    expect(select).toContain('chat_sesi_id');
  });

  it('gagal memuat daftar: tampil peringatan dengan tombol Coba lagi', async () => {
    m.h.tabel.penanganan = { data: null, error: { message: 'boom', code: '57014' } };
    render(<KotakMasukFoPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Gagal memuat kotak masuk/);
    siapkan([barisKotak()]);
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    expect(await screen.findByRole('heading', { name: 'Budi Santoso' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
