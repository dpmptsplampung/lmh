// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PemilihTanggal from './PemilihTanggal';

// Rabu 4 November 2026, 10.00 WIB.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T03:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function pasang(props: Partial<React.ComponentProps<typeof PemilihTanggal>> = {}) {
  const onUbah = vi.fn();
  render(
    <>
      <PemilihTanggal nilai="2026-11-04" onUbah={onUbah} label="Tanggal" {...props} />
      <button type="button">di luar</button>
    </>,
  );
  const pemicu = screen.getByRole('button', { name: /^Tanggal:/ });
  return { onUbah, pemicu };
}

const hari = (nama: string) => screen.getByRole('button', { name: new RegExp(`^${nama}`) });
const buka = (pemicu: HTMLElement) => fireEvent.click(pemicu);

describe('PemilihTanggal', () => {
  it('tombol pemicu: teks chip, nama terbaca, aria-haspopup dan aria-expanded', () => {
    const { pemicu } = pasang();
    expect(pemicu).toHaveTextContent('4 Nov 2026');
    expect(pemicu).toHaveAccessibleName('Tanggal: 4 November 2026');
    expect(pemicu).toHaveAttribute('aria-haspopup', 'dialog');
    expect(pemicu).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('id dipasang pada tombol supaya label luar bisa menunjuknya', () => {
    const { pemicu } = pasang({ id: 'tgl-kunjungan' });
    expect(pemicu).toHaveAttribute('id', 'tgl-kunjungan');
  });

  it('membuka dialog, memindahkan fokus ke hari terpilih, dan menghubungkan aria-controls', () => {
    const { pemicu } = pasang({ nilai: '2026-11-10' });
    buka(pemicu);
    const dialog = screen.getByRole('dialog', { name: 'Tanggal' });
    expect(pemicu).toHaveAttribute('aria-expanded', 'true');
    expect(pemicu).toHaveAttribute('aria-controls', dialog.id);
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(screen.getByRole('grid', { name: 'November 2026' })).toBeInTheDocument();
    expect(document.activeElement).toBe(hari('10 November 2026'));
  });

  it('klik hari memanggil onUbah, menutup, dan mengembalikan fokus ke tombol', () => {
    const { onUbah, pemicu } = pasang();
    buka(pemicu);
    fireEvent.click(hari('10 November 2026'));
    expect(onUbah).toHaveBeenCalledTimes(1);
    expect(onUbah).toHaveBeenCalledWith('2026-11-10');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(pemicu);
  });

  it('memilih tanggal yang sama menutup tanpa memanggil onUbah', () => {
    const { onUbah, pemicu } = pasang();
    buka(pemicu);
    fireEvent.click(hari('4 November 2026'));
    expect(onUbah).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('papan ketik: panah memindahkan fokus DOM, PageDown ganti bulan, Enter memilih', () => {
    const { onUbah, pemicu } = pasang();
    buka(pemicu);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(hari('5 November 2026'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(hari('12 November 2026'));
    fireEvent.keyDown(document.activeElement!, { key: 'PageDown' });
    expect(screen.getByRole('grid', { name: 'Desember 2026' })).toBeInTheDocument();
    expect(document.activeElement).toBe(hari('12 Desember 2026'));
    fireEvent.keyDown(document.activeElement!, { key: 'PageDown', shiftKey: true });
    expect(screen.getByRole('grid', { name: 'Desember 2027' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onUbah).toHaveBeenCalledWith('2027-12-12');
    expect(document.activeElement).toBe(pemicu);
  });

  it('Esc menutup tanpa mengubah nilai dan mengembalikan fokus', () => {
    const { onUbah, pemicu } = pasang();
    buka(pemicu);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onUbah).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(pemicu);
    expect(pemicu).toHaveAttribute('aria-expanded', 'false');
  });

  it('Esc tidak menembus ke pembungkus (mis. Dialog) saat popover terbuka', () => {
    const tutupPembungkus = vi.fn();
    render(
      <div onKeyDown={(e) => e.key === 'Escape' && tutupPembungkus()}>
        <PemilihTanggal nilai="2026-11-04" onUbah={() => {}} label="Tanggal" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Tanggal:/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(tutupPembungkus).not.toHaveBeenCalled();
  });

  it('klik atau sentuh di luar menutup; klik di dalam tidak', () => {
    const { onUbah, pemicu } = pasang();
    buka(pemicu);
    fireEvent.mouseDown(screen.getByRole('grid'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('di luar'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onUbah).not.toHaveBeenCalled();
    buka(pemicu);
    fireEvent.pointerDown(screen.getByText('di luar'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('menjebak Tab: dari elemen terakhir kembali ke pertama, Shift+Tab dari pertama ke terakhir', () => {
    const { pemicu } = pasang();
    buka(pemicu);
    const dialog = screen.getByRole('dialog');
    const hariIni = screen.getByRole('button', { name: 'Hari ini' });
    // jsdom tidak menerapkan CSS, jadi kepala lembar bawah (tombol Tutup) ikut dihitung sebagai elemen pertama.
    const tutup = screen.getByRole('button', { name: 'Tutup' });
    expect(dialog.contains(tutup)).toBe(true);
    hariIni.focus();
    fireEvent.keyDown(hariIni, { key: 'Tab' });
    expect(document.activeElement).toBe(tutup);
    fireEvent.keyDown(tutup, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(hariIni);
  });

  it('min dan max: hari di luar batas tidak bisa dipilih, bulan di luar batas tidak bisa dibuka', () => {
    const { onUbah, pemicu } = pasang({ min: '2026-11-02', max: '2026-11-20' });
    buka(pemicu);
    expect(hari('1 November 2026')).toHaveAttribute('aria-disabled', 'true');
    expect(hari('21 November 2026')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(hari('21 November 2026'));
    expect(onUbah).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Bulan sebelumnya' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Bulan berikutnya' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'PageDown' });
    expect(document.activeElement).toBe(hari('20 November 2026'));
  });

  it('tombol "Hari ini" memilih hari ini WIB; nonaktif bila di luar batas', () => {
    const a = pasang({ nilai: '2026-11-20' });
    buka(a.pemicu);
    fireEvent.click(screen.getByRole('button', { name: 'Hari ini' }));
    expect(a.onUbah).toHaveBeenCalledWith('2026-11-04');
    cleanup();
    pasang({ nilai: '2026-11-20', min: '2026-11-10' });
    fireEvent.click(screen.getByRole('button', { name: /^Tanggal:/ }));
    expect(screen.getByRole('button', { name: 'Hari ini' })).toBeDisabled();
  });

  it('hari ini dihitung menurut WIB, bukan UTC (23.30 UTC masih tanggal berikut di WIB)', () => {
    vi.setSystemTime(new Date('2026-11-03T20:30:00Z')); // 4 Nov 03.30 WIB
    const { pemicu } = pasang({ nilai: '' });
    buka(pemicu);
    expect(hari('4 November 2026')).toHaveAttribute('aria-current', 'date');
    expect(document.activeElement).toBe(hari('4 November 2026'));
  });

  it('nilai kosong atau salah format tidak crash: tampil "Pilih tanggal", kisi di bulan ini', () => {
    for (const nilai of ['', 'salah', '2026-02-30', '2026-13-01']) {
      const { pemicu } = pasang({ nilai });
      expect(pemicu).toHaveTextContent('Pilih tanggal');
      expect(pemicu).toHaveAccessibleName('Tanggal: belum dipilih');
      buka(pemicu);
      expect(screen.getByRole('grid', { name: 'November 2026' })).toBeInTheDocument();
      expect(document.activeElement).toBe(hari('4 November 2026'));
      cleanup();
    }
  });

  it('nilai di luar min/max dibuka di batas terdekat', () => {
    const { pemicu } = pasang({ nilai: '2026-01-15', min: '2026-10-01' });
    buka(pemicu);
    expect(screen.getByRole('grid', { name: 'Oktober 2026' })).toBeInTheDocument();
    expect(document.activeElement).toBe(hari('1 Oktober 2026'));
  });

  it('disabled: tidak bisa dibuka', () => {
    const { pemicu } = pasang({ disabled: true });
    expect(pemicu).toBeDisabled();
    buka(pemicu);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dibuka ulang memakai nilai terbaru dari induk', () => {
    const onUbah = vi.fn();
    const { rerender } = render(<PemilihTanggal nilai="2026-11-04" onUbah={onUbah} label="Tanggal" />);
    rerender(<PemilihTanggal nilai="2027-03-09" onUbah={onUbah} label="Tanggal" />);
    const pemicu = screen.getByRole('button', { name: /^Tanggal:/ });
    expect(pemicu).toHaveTextContent('9 Mar 2027');
    buka(pemicu);
    expect(screen.getByRole('grid', { name: 'Maret 2027' })).toBeInTheDocument();
  });

  it('teks tidak memuat em dash', () => {
    const { pemicu } = pasang();
    buka(pemicu);
    expect(document.body.textContent).not.toMatch(/[–—]/);
    expect(pemicu.getAttribute('aria-label')).not.toMatch(/[–—]/);
  });
});
