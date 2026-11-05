// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PemilihRentang from './PemilihRentang';

// Rabu 4 November 2026, 10.00 WIB.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T03:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function pasang(props: Partial<React.ComponentProps<typeof PemilihRentang>> = {}) {
  const onUbah = vi.fn();
  render(
    <>
      <PemilihRentang dari="2026-10-06" sampai="2026-11-04" onUbah={onUbah} label="Rentang tanggal" {...props} />
      <button type="button">di luar</button>
    </>,
  );
  const pemicu = screen.getByRole('button', { name: /^Rentang tanggal:/ });
  return { onUbah, pemicu };
}

const hari = (nama: string) => screen.getByRole('button', { name: new RegExp(`^${nama}`) });
const buka = (pemicu: HTMLElement) => fireEvent.click(pemicu);
const terapkan = () => screen.getByRole('button', { name: 'Terapkan' });

describe('PemilihRentang', () => {
  it('chip meniru pratinjau: "6 Okt sampai 4 Nov 2026" dengan nama terbaca lengkap', () => {
    const { pemicu } = pasang();
    expect(pemicu).toHaveTextContent('6 Okt sampai 4 Nov 2026');
    expect(pemicu).toHaveAccessibleName('Rentang tanggal: 6 Oktober sampai 4 November 2026');
    expect(pemicu).toHaveAttribute('aria-haspopup', 'dialog');
    expect(pemicu).toHaveAttribute('aria-expanded', 'false');
  });

  it('beda tahun menulis kedua tahun; rentang satu hari ditulis sebagai satu tanggal', () => {
    const a = pasang({ dari: '2025-12-28', sampai: '2026-01-03' });
    expect(a.pemicu).toHaveTextContent('28 Des 2025 sampai 3 Jan 2026');
    cleanup();
    const b = pasang({ dari: '2026-11-04', sampai: '2026-11-04' });
    expect(b.pemicu).toHaveTextContent('4 Nov 2026');
    expect(b.pemicu).not.toHaveTextContent('sampai');
  });

  it('dari dan sampai terbalik dinormalkan untuk tampilan', () => {
    const { pemicu } = pasang({ dari: '2026-11-04', sampai: '2026-10-06' });
    expect(pemicu).toHaveTextContent('6 Okt sampai 4 Nov 2026');
  });

  it('membuka dialog berisi lima pilihan cepat bawaan, kisi bulan akhir rentang, Batal dan Terapkan', () => {
    const { pemicu } = pasang();
    buka(pemicu);
    expect(screen.getByRole('dialog', { name: 'Rentang tanggal' })).toBeInTheDocument();
    const grup = screen.getByRole('group', { name: 'Pilihan cepat' });
    expect(within(grup).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Hari ini',
      '7 hari terakhir',
      '30 hari terakhir',
      'Bulan ini',
      'Bulan lalu',
    ]);
    expect(screen.getByRole('grid', { name: 'November 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Batal' })).toBeInTheDocument();
    expect(terapkan()).toBeEnabled();
    expect(document.activeElement).toBe(hari('4 November 2026'));
  });

  it('pilihan cepat yang sama dengan nilai sekarang ditandai aria-pressed', () => {
    const { pemicu } = pasang(); // 6 Okt sampai 4 Nov = 30 hari terakhir
    buka(pemicu);
    expect(screen.getByRole('button', { name: '30 hari terakhir' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7 hari terakhir' })).toHaveAttribute('aria-pressed', 'false');
  });

  it.each([
    ['Hari ini', { dari: '2026-11-04', sampai: '2026-11-04' }],
    ['7 hari terakhir', { dari: '2026-10-29', sampai: '2026-11-04' }],
    ['30 hari terakhir', { dari: '2026-10-06', sampai: '2026-11-04' }],
    ['Bulan ini', { dari: '2026-11-01', sampai: '2026-11-04' }],
    ['Bulan lalu', { dari: '2026-10-01', sampai: '2026-10-31' }],
  ])('pilihan cepat "%s" langsung diterapkan, menutup, dan mengembalikan fokus', (nama, harapan) => {
    const { onUbah, pemicu } = pasang({ dari: '2026-01-01', sampai: '2026-01-02' });
    buka(pemicu);
    fireEvent.click(screen.getByRole('button', { name: nama }));
    expect(onUbah).toHaveBeenCalledTimes(1);
    expect(onUbah).toHaveBeenCalledWith(harapan);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(pemicu);
  });

  it('pilihan cepat dihitung menurut WIB: 20.30 UTC sudah tanggal berikut', () => {
    vi.setSystemTime(new Date('2026-12-31T20:30:00Z')); // 1 Jan 2027 03.30 WIB
    const { onUbah, pemicu } = pasang({ dari: '2026-01-01', sampai: '2026-01-02' });
    buka(pemicu);
    fireEvent.click(screen.getByRole('button', { name: 'Bulan lalu' }));
    expect(onUbah).toHaveBeenCalledWith({ dari: '2026-12-01', sampai: '2026-12-31' });
  });

  it('Bulan lalu di Januari menyeberang ke Desember tahun sebelumnya; Februari kabisat 29 hari', () => {
    vi.setSystemTime(new Date('2028-03-15T03:00:00Z'));
    const { onUbah, pemicu } = pasang({ dari: '2028-03-01', sampai: '2028-03-02' });
    buka(pemicu);
    fireEvent.click(screen.getByRole('button', { name: 'Bulan lalu' }));
    expect(onUbah).toHaveBeenCalledWith({ dari: '2028-02-01', sampai: '2028-02-29' });
  });

  it('klik pertama = awal, klik kedua = akhir; nilai baru dikirim hanya setelah Terapkan', () => {
    const { onUbah, pemicu } = pasang();
    buka(pemicu);
    fireEvent.click(hari('10 November 2026'));
    expect(terapkan()).toBeDisabled();
    expect(screen.getByText('Pilih tanggal akhir')).toBeInTheDocument();
    fireEvent.click(hari('20 November 2026'));
    expect(onUbah).not.toHaveBeenCalled();
    expect(screen.getByText('10 November sampai 20 November 2026 (11 hari)')).toBeInTheDocument();
    expect(terapkan()).toBeEnabled();
    fireEvent.click(terapkan());
    expect(onUbah).toHaveBeenCalledTimes(1);
    expect(onUbah).toHaveBeenCalledWith({ dari: '2026-11-10', sampai: '2026-11-20' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(pemicu);
  });

  it('klik kedua sebelum klik pertama menukar otomatis', () => {
    const { onUbah, pemicu } = pasang();
    buka(pemicu);
    fireEvent.click(hari('20 November 2026'));
    fireEvent.click(hari('10 November 2026'));
    fireEvent.click(terapkan());
    expect(onUbah).toHaveBeenCalledWith({ dari: '2026-11-10', sampai: '2026-11-20' });
  });

  it('klik ketiga memulai rentang baru', () => {
    const { pemicu } = pasang();
    buka(pemicu);
    fireEvent.click(hari('10 November 2026'));
    fireEvent.click(hari('20 November 2026'));
    fireEvent.click(hari('25 November 2026'));
    expect(terapkan()).toBeDisabled();
    expect(hari('25 November 2026')).toHaveAttribute('aria-label', '25 November 2026, awal rentang');
    expect(hari('10 November 2026').closest('td')).toHaveAttribute('aria-selected', 'false');
  });

  it('memilih satu hari dua kali menghasilkan rentang satu hari', () => {
    const { onUbah, pemicu } = pasang();
    buka(pemicu);
    fireEvent.click(hari('12 November 2026'));
    fireEvent.click(hari('12 November 2026'));
    fireEvent.click(terapkan());
    expect(onUbah).toHaveBeenCalledWith({ dari: '2026-11-12', sampai: '2026-11-12' });
  });

  it('pratinjau rentang saat kursor menyorot hari kedua', () => {
    const { pemicu } = pasang();
    buka(pemicu);
    fireEvent.click(hari('10 November 2026'));
    fireEvent.mouseEnter(hari('14 November 2026'));
    expect(hari('12 November 2026').closest('td')?.className).toMatch(/selDalam/);
    expect(hari('12 November 2026').closest('td')).toHaveAttribute('aria-selected', 'false');
    expect(hari('16 November 2026').closest('td')?.className).not.toMatch(/selDalam/);
  });

  it('papan ketik: panah ke hari lain lalu Enter dua kali membentuk rentang', () => {
    const { onUbah, pemicu } = pasang();
    buka(pemicu);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' }); // awal: 5 Nov
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: ' ' }); // akhir: 12 Nov
    fireEvent.click(terapkan());
    expect(onUbah).toHaveBeenCalledWith({ dari: '2026-11-05', sampai: '2026-11-12' });
  });

  it('Batal menutup tanpa mengubah nilai', () => {
    const { onUbah, pemicu } = pasang();
    buka(pemicu);
    fireEvent.click(hari('10 November 2026'));
    fireEvent.click(hari('20 November 2026'));
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(onUbah).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(pemicu);
    // Dibuka lagi: rancangan lama dibuang, kembali ke nilai induk.
    buka(pemicu);
    expect(screen.getByText('6 Oktober sampai 4 November 2026 (30 hari)')).toBeInTheDocument();
  });

  it('Terapkan dengan rentang yang sama dengan nilai induk tidak memanggil onUbah', () => {
    const { onUbah, pemicu } = pasang();
    buka(pemicu);
    fireEvent.click(terapkan());
    expect(onUbah).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc menutup, mengembalikan fokus, dan tidak mengubah nilai; klik di luar juga menutup', () => {
    const { onUbah, pemicu } = pasang();
    buka(pemicu);
    fireEvent.click(hari('10 November 2026'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(pemicu);
    buka(pemicu);
    fireEvent.mouseDown(screen.getByText('di luar'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onUbah).not.toHaveBeenCalled();
  });

  it('min dan max: hari dan pilihan cepat di luar batas tidak bisa dipilih', () => {
    const { onUbah, pemicu } = pasang({ min: '2026-10-01', max: '2026-10-31', dari: '2026-10-06', sampai: '2026-10-20' });
    buka(pemicu);
    const cepat = screen.getByRole('button', { name: 'Bulan ini' }); // 1 sampai 4 Nov: seluruhnya di luar max
    expect(cepat).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(cepat);
    expect(onUbah).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Bulan lalu (Oktober penuh) masih sesuai batas.
    fireEvent.click(screen.getByRole('button', { name: 'Bulan lalu' }));
    expect(onUbah).toHaveBeenCalledWith({ dari: '2026-10-01', sampai: '2026-10-31' });
  });

  it('pilihan cepat dijepit ke batas bila sebagian di luar', () => {
    const { onUbah, pemicu } = pasang({ min: '2026-10-20' });
    buka(pemicu);
    fireEvent.click(screen.getByRole('button', { name: '30 hari terakhir' }));
    expect(onUbah).toHaveBeenCalledWith({ dari: '2026-10-20', sampai: '2026-11-04' });
  });

  it('pilihanCepat={[]} menyembunyikan daftar; pilihan kustom dipakai bila diberikan', () => {
    const a = pasang({ pilihanCepat: [] });
    buka(a.pemicu);
    expect(screen.queryByRole('group', { name: 'Pilihan cepat' })).toBeNull();
    cleanup();
    const b = pasang({
      pilihanCepat: [{ kunci: 'k', label: 'Pekan lalu', hitung: () => ({ dari: '2026-10-26', sampai: '2026-11-01' }) }],
    });
    buka(b.pemicu);
    fireEvent.click(screen.getByRole('button', { name: 'Pekan lalu' }));
    expect(b.onUbah).toHaveBeenCalledWith({ dari: '2026-10-26', sampai: '2026-11-01' });
  });

  it('nilai kosong atau salah format tidak crash; Terapkan baru aktif setelah dua klik', () => {
    for (const [dari, sampai] of [['', ''], ['salah', '2026-11-04'], ['2026-02-30', '2026-03-01']]) {
      const { onUbah, pemicu } = pasang({ dari, sampai });
      expect(pemicu).toHaveTextContent('Pilih rentang tanggal');
      expect(pemicu).toHaveAccessibleName('Rentang tanggal: belum dipilih');
      buka(pemicu);
      expect(screen.getByRole('grid', { name: 'November 2026' })).toBeInTheDocument();
      expect(screen.getByText('Pilih tanggal awal')).toBeInTheDocument();
      expect(terapkan()).toBeDisabled();
      fireEvent.click(hari('3 November 2026'));
      fireEvent.click(hari('9 November 2026'));
      fireEvent.click(terapkan());
      expect(onUbah).toHaveBeenCalledWith({ dari: '2026-11-03', sampai: '2026-11-09' });
      cleanup();
    }
  });

  it('disabled: tidak bisa dibuka', () => {
    const { pemicu } = pasang({ disabled: true });
    expect(pemicu).toBeDisabled();
    buka(pemicu);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tanpa em dash di teks mana pun', () => {
    const { pemicu } = pasang();
    buka(pemicu);
    expect(document.body.textContent).not.toMatch(/[–—]/);
  });
});
