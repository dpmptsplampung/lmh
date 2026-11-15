// @vitest-environment jsdom
// PanelAntrean: merakit Panel Sekarang dari daftar tiket panel (turunan murni) dan meneruskan aksi ke penangan halaman.
// Panel aslinya diuji di PanelSekarang.test.tsx; di sini diganti tiruan yang memperlihatkan props dan memanggil penangan.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('./PanelSekarang', () => ({
  default: (p: {
    sedangDilayani: { id: string } | null; berikutnya: { id: string; nomor_display: string } | null;
    layananOpsi: Array<{ id: string; nama: string }>; layananId: string | null; tanpaTiketSaya?: boolean;
    onLayananChange: (id: string) => void; sedangPanggil: (id: string) => boolean; sedangProses: (id: string) => boolean;
    onPanggil: (t: { id: string; nomor_display: string }) => unknown; onMulai: (t: { id: string }) => unknown;
    onSelesai: (t: { id: string }) => unknown;
  }) => (
    <div
      data-testid="panel"
      data-dilayani={p.sedangDilayani?.id ?? ''}
      data-berikutnya={p.berikutnya?.id ?? ''}
      data-layanan={p.layananId ?? ''}
      data-opsi={p.layananOpsi.map((o) => o.id).join('|')}
      data-tanpa-saya={String(Boolean(p.tanpaTiketSaya))}
      data-memanggil={String(p.sedangPanggil('t-2'))}
      data-memproses={String(p.sedangProses('t-2'))}
    >
      <button type="button" onClick={() => p.berikutnya && p.onPanggil(p.berikutnya)}>panggil</button>
      <button type="button" onClick={() => p.berikutnya && p.onMulai(p.berikutnya)}>mulai</button>
      <button type="button" onClick={() => p.sedangDilayani && p.onSelesai(p.sedangDilayani)}>selesai</button>
      <button type="button" onClick={() => p.onLayananChange('l-lain')}>pilih</button>
    </div>
  ),
}));

import PanelAntrean from './PanelAntrean';
import type { AksiTiket } from './SelAksi';
import { ADMIN, FO, PETUGAS, buatTiket } from '../_uji/tiketUji';

afterEach(cleanup);

const aksiUji = (over: Partial<AksiTiket> = {}): AksiTiket => ({
  sedangProses: new Set(),
  sedangPanggil: new Set(),
  panggil: vi.fn(),
  mulai: vi.fn(),
  selesaikan: vi.fn(),
  buka: vi.fn(),
  ...over,
});

const baris = [
  buatTiket({ id: 't-1', nomor: 1, nomor_display: 'OS-001', status: 'dilayani', dilayani_oleh: PETUGAS.id }),
  buatTiket({ id: 't-2', nomor: 2, nomor_display: 'OS-002' }),
  buatTiket({ id: 't-3', nomor: 3, nomor_display: 'OS-003' }),
];

describe('PanelAntrean', () => {
  it('menurunkan tiket saya dan tiket berikutnya (nomor terkecil menunggu)', () => {
    render(<PanelAntrean baris={baris} pengguna={PETUGAS} layananId={null} onLayananChange={vi.fn()} aksi={aksiUji()} />);
    const el = screen.getByTestId('panel');
    expect(el).toHaveAttribute('data-dilayani', 't-1');
    expect(el).toHaveAttribute('data-berikutnya', 't-2');
    expect(el).toHaveAttribute('data-layanan', 'l-oss');
  });

  it('pilihan Layanan hanya untuk Admin dan Front Office; FO tanpa blok tiket saya', () => {
    const { unmount } = render(
      <PanelAntrean baris={baris} pengguna={ADMIN} layananId={null} onLayananChange={vi.fn()} aksi={aksiUji()} />,
    );
    expect(screen.getByTestId('panel')).toHaveAttribute('data-opsi', 'l-oss');
    expect(screen.getByTestId('panel')).toHaveAttribute('data-tanpa-saya', 'false');
    unmount();
    const fo = render(<PanelAntrean baris={baris} pengguna={FO} layananId={null} onLayananChange={vi.fn()} aksi={aksiUji()} />);
    expect(screen.getByTestId('panel')).toHaveAttribute('data-tanpa-saya', 'true');
    fo.unmount();
    render(<PanelAntrean baris={baris} pengguna={PETUGAS} layananId={null} onLayananChange={vi.fn()} aksi={aksiUji()} />);
    expect(screen.getByTestId('panel')).toHaveAttribute('data-opsi', '');
  });

  it('meneruskan pilihan Layanan dan keadaan sedang panggil/proses per tiket', () => {
    const onLayananChange = vi.fn();
    render(
      <PanelAntrean
        baris={baris}
        pengguna={ADMIN}
        layananId={null}
        onLayananChange={onLayananChange}
        aksi={aksiUji({ sedangPanggil: new Set(['t-2']), sedangProses: new Set(['t-2']) })}
      />,
    );
    expect(screen.getByTestId('panel')).toHaveAttribute('data-memanggil', 'true');
    expect(screen.getByTestId('panel')).toHaveAttribute('data-memproses', 'true');
    fireEvent.click(screen.getByText('pilih'));
    expect(onLayananChange).toHaveBeenCalledWith('l-lain');
  });

  it('Panggil, Mulai, dan Selesai memanggil penangan halaman dengan baris tiketnya', () => {
    const aksi = aksiUji();
    render(<PanelAntrean baris={baris} pengguna={PETUGAS} layananId={null} onLayananChange={vi.fn()} aksi={aksi} />);
    fireEvent.click(screen.getByText('panggil'));
    expect(aksi.panggil).toHaveBeenCalledWith('t-2', 'OS-002');
    fireEvent.click(screen.getByText('mulai'));
    expect(aksi.mulai).toHaveBeenCalledWith(baris[1]);
    fireEvent.click(screen.getByText('selesai'));
    expect(aksi.selesaikan).toHaveBeenCalledWith(baris[0]);
  });
});
