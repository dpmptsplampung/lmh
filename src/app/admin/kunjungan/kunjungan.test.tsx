// @vitest-environment jsdom
// Kelola Kunjungan: kolom "Front Office" = nama FO yang melayani tiap kunjungan (keputusan CEO 2026-10-14: semua FO
// melihat semua pengunjung, dengan nama FO yang melayani; RLS migrasi 202610140013). Nama FO = pelengkap: kegagalan
// memuatnya tidak menggagalkan daftar.
// Kolom "Pesan Perilaku" (survei terpadu): lencana status (v_survei_status) untuk kunjungan selesai + tombol "Tampilkan QR"
// hanya untuk status "Belum diisi".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import { buatH, punyaOp, type FakeH, type Op } from '@/test/fo-supabase-mock';

const m = vi.hoisted(() => ({ toast: vi.fn(), h: null as unknown as FakeH }));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/lib/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: vi.fn() }));
vi.mock('@/lib/supabase/client', async () => {
  const { buatFakeSupabase } = await import('@/test/fo-supabase-mock');
  return { createClient: () => buatFakeSupabase(m.h) };
});
// Kanvas QR tidak berjalan di jsdom: tiruan mengekspos nilai yang dikodekan lewat atribut (bukan teks).
vi.mock('@/components/QRCode', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr" data-value={value} />,
}));

import KunjunganPage from './page';

const kunjungan = (id: string, nama: string, status = 'selesai') => ({
  id, nama, asal: 'walk_in', status, waktu_masuk: '2026-10-13T02:00:00.000Z', tanggal: '2026-10-13',
  tiket_antrean: [],
});

beforeEach(() => {
  m.h = buatH();
  m.toast.mockClear();
  m.h.tabel.kunjungan = { data: [kunjungan('k-1', 'Budi'), kunjungan('k-2', 'Dewi'), kunjungan('k-3', 'Eko')], error: null, count: 3 };
});
afterEach(cleanup);

describe('Kelola Kunjungan: nama Front Office', () => {
  it('menampilkan nama FO (semua FO, termasuk FO lain; beberapa FO digabung) per kunjungan', async () => {
    m.h.tabel.penanganan = {
      data: [
        { kunjungan_id: 'k-1', tahap_ke: 1, penangan_id: 'fo-a', penangan: { nama: 'Ani FO' } },
        { kunjungan_id: 'k-2', tahap_ke: 1, penangan_id: 'fo-b', penangan: [{ nama: 'Bayu FO' }] },
        { kunjungan_id: 'k-2', tahap_ke: 3, penangan_id: 'fo-a', penangan: { nama: 'Ani FO' } },
      ],
      error: null,
    };
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    expect(within(tabel).getByRole('columnheader', { name: 'Front Office' })).toBeInTheDocument();
    const baris = (nama: string) => within(tabel).getByText(nama).closest('tr')!;
    expect(within(baris('Budi')).getByText('Ani FO')).toBeInTheDocument();
    expect(within(baris('Dewi')).getByText('Bayu FO, Ani FO')).toBeInTheDocument();
    const kolomFo = within(tabel).getAllByRole('columnheader').findIndex((th) => th.textContent === 'Front Office');
    expect(baris('Eko').querySelectorAll('td')[kolomFo].textContent).toBe('—');

    const kueri = m.h.log.find((l) => l.tabel === 'penanganan')!;
    expect(punyaOp(kueri.ops, 'in', 'kunjungan_id', ['k-1', 'k-2', 'k-3'])).toBe(true);
    expect(punyaOp(kueri.ops, 'eq', 'peran_tahap', 'fo')).toBe(true);
    // Tidak dipersempit ke FO pemanggil.
    expect(kueri.ops.some(([op, a]) => op === 'eq' && a[0] === 'penangan_id')).toBe(false);
  });

  it('galat memuat nama FO tidak menggagalkan daftar kunjungan', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.h.tabel.penanganan = (_ops: Op[]) => ({ data: null, error: { message: 'boom' } });
    render(<KunjunganPage />);
    expect(await screen.findByText('Budi')).toBeInTheDocument();
    expect(m.toast).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Kelola Kunjungan: Pesan Perilaku (survei terpadu)', () => {
  const TOKEN = 'e7f8'.repeat(16);
  const baris = (tabel: HTMLElement, nama: string) => within(tabel).getByText(nama).closest('tr')!;

  it('lencana status per kunjungan selesai; tombol Tampilkan QR hanya untuk Belum diisi; tanpa undangan = "—"', async () => {
    m.h.tabel.v_survei_status = {
      data: [
        { kunjungan_id: 'k-1', status: 'belum_diisi' },
        { kunjungan_id: 'k-2', status: 'sudah_diisi' },
      ],
      error: null,
    };
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    expect(within(tabel).getByRole('columnheader', { name: 'Pesan Perilaku' })).toBeInTheDocument();
    const kolom = within(tabel).getAllByRole('columnheader').findIndex((th) => th.textContent === 'Pesan Perilaku');

    await waitFor(() => expect(within(baris(tabel, 'Budi')).getByText('Belum diisi')).toBeInTheDocument());
    expect(within(baris(tabel, 'Budi')).getByRole('button', { name: /Tampilkan QR Pesan Perilaku untuk Budi/ })).toBeInTheDocument();
    expect(within(baris(tabel, 'Dewi')).getByText('Sudah diisi')).toBeInTheDocument();
    expect(within(baris(tabel, 'Dewi')).queryByRole('button', { name: /Tampilkan QR/ })).toBeNull();
    expect(baris(tabel, 'Eko').querySelectorAll('td')[kolom].textContent).toBe('—');
    expect(within(baris(tabel, 'Eko')).queryByRole('button', { name: /Tampilkan QR/ })).toBeNull();
  });

  it('status Kedaluwarsa tanpa tombol QR', async () => {
    m.h.tabel.v_survei_status = { data: [{ kunjungan_id: 'k-1', status: 'kedaluwarsa' }], error: null };
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    await waitFor(() => expect(within(baris(tabel, 'Budi')).getByText('Kedaluwarsa')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Tampilkan QR/ })).toBeNull();
  });

  it('status diambil sekali per muat data, hanya untuk kunjungan selesai', async () => {
    m.h.tabel.kunjungan = {
      data: [kunjungan('k-1', 'Budi'), kunjungan('k-2', 'Dewi', 'menunggu'), kunjungan('k-3', 'Eko', 'dilayani')],
      error: null,
      count: 3,
    };
    m.h.tabel.v_survei_status = { data: [{ kunjungan_id: 'k-1', status: 'belum_diisi' }], error: null };
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    await waitFor(() => expect(within(baris(tabel, 'Budi')).getByText('Belum diisi')).toBeInTheDocument());

    const kueri = m.h.log.filter((l) => l.tabel === 'v_survei_status');
    expect(kueri).toHaveLength(1);
    expect(punyaOp(kueri[0].ops, 'in', 'kunjungan_id', ['k-1'])).toBe(true);
    // Kunjungan belum selesai: tidak ada lencana.
    const kolom = within(tabel).getAllByRole('columnheader').findIndex((th) => th.textContent === 'Pesan Perilaku');
    expect(baris(tabel, 'Dewi').querySelectorAll('td')[kolom].textContent).toBe('—');
  });

  it('Tampilkan QR membuka dialog QR Pesan Perilaku untuk kunjungan itu (token hanya sebagai QR)', async () => {
    m.h.tabel.v_survei_status = { data: [{ kunjungan_id: 'k-2', status: 'belum_diisi' }], error: null };
    m.h.rpc = () => ({
      data: { status: 'belum_diisi', token: TOKEN, kedaluwarsa_pada: '2026-10-14T11:00:00.000Z', unit: 'layanan', layanan_nama: 'Helpdesk OSS' },
      error: null,
    });
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    fireEvent.click(await within(baris(tabel, 'Dewi')).findByRole('button', { name: /Tampilkan QR Pesan Perilaku untuk Dewi/ }));

    const dialog = await screen.findByRole('dialog', { name: 'QR Pesan Perilaku' });
    expect(m.h.rpcLog).toEqual([{ nama: 'ambil_qr_survei', args: { p_kunjungan_id: 'k-2' } }]);
    expect(within(dialog).getByTestId('qr').getAttribute('data-value')).toMatch(new RegExp(`/survei/${TOKEN}$`));
    expect(within(dialog).getByText('Helpdesk OSS')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(TOKEN);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Tutup' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('status yang berubah jadi Sudah diisi saat tombol diklik: dialog menutup diri tanpa tampil', async () => {
    m.h.tabel.v_survei_status = { data: [{ kunjungan_id: 'k-1', status: 'belum_diisi' }], error: null };
    m.h.rpc = () => ({
      data: { status: 'sudah_diisi', token: null, kedaluwarsa_pada: '2026-10-14T11:00:00.000Z', unit: 'fo', layanan_nama: null },
      error: null,
    });
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    fireEvent.click(await within(baris(tabel, 'Budi')).findByRole('button', { name: /Tampilkan QR/ }));
    await waitFor(() => expect(m.h.rpcLog).toHaveLength(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('qr')).toBeNull();
  });

  it('galat memuat status tidak menggagalkan daftar: tanpa lencana, tanpa toast galat', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.h.tabel.v_survei_status = { data: null, error: { message: 'boom' } };
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(within(tabel).getByText('Budi')).toBeInTheDocument();
    expect(screen.queryByText('Belum diisi')).toBeNull();
    expect(screen.queryByRole('button', { name: /Tampilkan QR/ })).toBeNull();
    expect(m.toast).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
