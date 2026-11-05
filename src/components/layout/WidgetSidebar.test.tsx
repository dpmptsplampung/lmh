// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { RingkasSesi } from '@/lib/hooks/useSesiKerja';

const sesi = vi.hoisted(() => ({ nilai: { status: 'memuat', jamMasuk: null, jamPulang: null, durasi: null } as RingkasSesi, panggil: vi.fn() }));
vi.mock('@/lib/hooks/useSesiKerja', () => ({
  useSesiKerja: (id: string | null, aktif: boolean) => {
    sesi.panggil(id, aktif);
    return sesi.nilai;
  },
}));
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <a href={href} {...rest} onClick={(e) => { onClick?.(); e.preventDefault(); }}>{children}</a>
  ),
}));

import WidgetSidebar, { KUNCI_WIDGET } from './WidgetSidebar';

const badges = {
  antrian: { count: 17, label: 'x' },
  liveChat: { count: 3, label: 'x' },
  pengaduan: { count: 2, label: 'x' },
  saran: { count: 5, label: 'x' },
  kotakMasukFo: { count: 4, label: 'x' },
  penangananFo: { count: 6, label: 'x' },
};

function nilaiBaris(label: string): string {
  const dt = screen.getByText(label);
  return dt.parentElement!.querySelector('dd')!.textContent!;
}

beforeEach(() => {
  sesi.nilai = { status: 'memuat', jamMasuk: null, jamPulang: null, durasi: null };
  sesi.panggil.mockClear();
  window.localStorage.clear();
});
afterEach(cleanup);

describe('WidgetSidebar per peran', () => {
  it('Admin: "Hari ini" dengan empat angka dan tombol Buka dashboard; tanpa kueri absensi', () => {
    render(<WidgetSidebar role="admin" petugasId="p1" badges={badges} />);
    expect(screen.getByRole('heading', { name: 'Hari ini' })).toBeInTheDocument();
    expect(nilaiBaris('Antrean menunggu')).toBe('17');
    expect(nilaiBaris('Chat menunggu')).toBe('3');
    expect(nilaiBaris('Pengaduan baru')).toBe('2');
    expect(nilaiBaris('Saran belum ditinjau')).toBe('5');
    expect(screen.getByRole('link', { name: /Buka dashboard/ })).toHaveAttribute('href', '/admin');
    expect(sesi.panggil).toHaveBeenCalledWith('p1', false);
  });

  it('Front Office: "Loket hari ini" dengan tiga angka dan tombol Registrasi pengunjung', () => {
    render(<WidgetSidebar role="front_office" petugasId={null} badges={badges} />);
    expect(screen.getByRole('heading', { name: 'Loket hari ini' })).toBeInTheDocument();
    expect(nilaiBaris('Kotak masuk FO')).toBe('4');
    expect(nilaiBaris('Penanganan menunggu')).toBe('6');
    expect(nilaiBaris('Chat menunggu')).toBe('3');
    expect(screen.getByRole('link', { name: /Registrasi pengunjung/ })).toHaveAttribute('href', '/admin/fo/registrasi');
    expect(sesi.panggil).toHaveBeenCalledWith(null, false);
  });

  it('angka yang belum tersedia ditulis "-" (bukan 0 palsu)', () => {
    render(<WidgetSidebar role="admin" petugasId={null} badges={{}} />);
    expect(nilaiBaris('Antrean menunggu')).toBe('-');
  });

  it('absensi pending menunggu persetujuan tanpa pil Hadir atau durasi', () => {
    sesi.nilai = { status: 'menunggu', jamMasuk: null, jamPulang: null, durasi: null };
    render(<WidgetSidebar role="petugas" petugasId="p1" badges={badges} />);
    expect(screen.getByText('Menunggu persetujuan')).toBeInTheDocument();
    expect(screen.queryByText('Hadir')).toBeNull();
    expect(screen.queryByText(/Hadir sejak/)).toBeNull();
  });

  it('Petugas hadir: durasi, jam masuk WIB, Layanan, antrean, dan tombol Buka antrean', () => {
    sesi.nilai = { status: 'hadir', jamMasuk: '07.58', jamPulang: null, durasi: '3 j 12 m' };
    render(<WidgetSidebar role="petugas" petugasId="p1" layanan="Perizinan" badges={badges} />);
    expect(screen.getByRole('heading', { name: 'Sesi kerja' })).toBeInTheDocument();
    expect(screen.getByText('3 j 12 m')).toBeInTheDocument();
    expect(screen.getByText('Hadir sejak 07.58 WIB')).toBeInTheDocument();
    expect(screen.getByText('Hadir')).toBeInTheDocument();
    expect(nilaiBaris('Layanan saya')).toBe('Perizinan');
    expect(nilaiBaris('Antrean menunggu')).toBe('17');
    expect(screen.getByRole('link', { name: /Buka antrean/ })).toHaveAttribute('href', '/admin/antrian');
    expect(sesi.panggil).toHaveBeenCalledWith('p1', true);
  });

  it('Petugas belum absen: tombol berganti menjadi Catat hadir', () => {
    sesi.nilai = { status: 'belum', jamMasuk: null, jamPulang: null, durasi: null };
    render(<WidgetSidebar role="petugas" petugasId="p1" badges={badges} />);
    expect(screen.getByText('Belum absen hari ini')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Catat hadir/ })).toHaveAttribute('href', '/admin/absensi');
    expect(screen.queryByRole('link', { name: /Buka antrean/ })).toBeNull();
  });

  it('Petugas: kueri gagal = "Data sesi belum tersedia" tanpa peran alert/galat', () => {
    sesi.nilai = { status: 'tidakTersedia', jamMasuk: null, jamPulang: null, durasi: null };
    render(<WidgetSidebar role="petugas" petugasId="p1" badges={badges} />);
    expect(screen.getByText('Data sesi belum tersedia')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: /Buka antrean/ })).toBeInTheDocument();
  });

  it('Petugas sudah pulang dan sedang memuat punya teks sendiri', () => {
    sesi.nilai = { status: 'pulang', jamMasuk: '07.58', jamPulang: '15.30', durasi: null };
    const { unmount } = render(<WidgetSidebar role="petugas" petugasId="p1" badges={badges} />);
    expect(screen.getByText('Hadir 07.58 WIB, pulang 15.30 WIB')).toBeInTheDocument();
    unmount();
    sesi.nilai = { status: 'memuat', jamMasuk: null, jamPulang: null, durasi: null };
    render(<WidgetSidebar role="petugas" petugasId="p1" badges={badges} />);
    expect(screen.getByText('Memuat sesi')).toBeInTheDocument();
  });

  it('durasi tidak berada di region aria-live (pembaruan diam)', () => {
    sesi.nilai = { status: 'hadir', jamMasuk: '07.58', jamPulang: null, durasi: '3 j 12 m' };
    const { container } = render(<WidgetSidebar role="petugas" petugasId="p1" badges={badges} />);
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(screen.getByText('3 j 12 m').closest('[aria-live]')).toBeNull();
  });
});

describe('WidgetSidebar: ciut dan simpan pilihan', () => {
  it('tombol ciut: aria-expanded, isi disembunyikan, pilihan tersimpan di localStorage', () => {
    render(<WidgetSidebar role="admin" petugasId={null} badges={badges} />);
    const tombol = screen.getByRole('button', { name: 'Ciutkan widget Hari ini' });
    expect(tombol).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(tombol);
    const buka = screen.getByRole('button', { name: 'Buka widget Hari ini' });
    expect(buka).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(buka.getAttribute('aria-controls')!)).toHaveAttribute('hidden');
    expect(window.localStorage.getItem(KUNCI_WIDGET)).toBe('1');
    fireEvent.click(buka);
    expect(window.localStorage.getItem(KUNCI_WIDGET)).toBe('0');
  });

  it('pilihan tersimpan dipulihkan', () => {
    window.localStorage.setItem(KUNCI_WIDGET, '1');
    render(<WidgetSidebar role="admin" petugasId={null} badges={badges} />);
    expect(screen.getByRole('button', { name: 'Buka widget Hari ini' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('localStorage melempar: tidak crash, tombol tetap berfungsi', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<WidgetSidebar role="admin" petugasId={null} badges={badges} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ciutkan widget Hari ini' }));
    expect(screen.getByRole('button', { name: 'Buka widget Hari ini' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('tombol widget memanggil onNavigasi (menutup laci)', () => {
    const onNavigasi = vi.fn();
    render(<WidgetSidebar role="admin" petugasId={null} badges={badges} onNavigasi={onNavigasi} />);
    fireEvent.click(within(screen.getByRole('region', { name: 'Hari ini' })).getByRole('link'));
    expect(onNavigasi).toHaveBeenCalled();
  });
});
