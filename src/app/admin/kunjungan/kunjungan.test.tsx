// @vitest-environment jsdom
// Kelola Kunjungan: kolom "Front Office" = nama FO yang melayani tiap kunjungan (keputusan CEO 2026-10-14: semua FO
// melihat semua pengunjung, dengan nama FO yang melayani; RLS migrasi 202610140013). Nama FO = pelengkap: kegagalan
// memuatnya tidak menggagalkan daftar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { buatH, punyaOp, type FakeH, type Op } from '@/test/fo-supabase-mock';

const m = vi.hoisted(() => ({ toast: vi.fn(), h: null as unknown as FakeH }));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/lib/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: vi.fn() }));
vi.mock('@/lib/supabase/client', async () => {
  const { buatFakeSupabase } = await import('@/test/fo-supabase-mock');
  return { createClient: () => buatFakeSupabase(m.h) };
});

import KunjunganPage from './page';

const kunjungan = (id: string, nama: string) => ({
  id, nama, asal: 'walk_in', status: 'selesai', waktu_masuk: '2026-10-13T02:00:00.000Z', tanggal: '2026-10-13',
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
