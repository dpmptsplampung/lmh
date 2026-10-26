// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import LayananPopup from './LayananPopup';
import type { AntreanLayanan, LayananEtalase, StatusHariIni } from '@/lib/homepage/data';

const layanan = (o: Partial<LayananEtalase> = {}): LayananEtalase => ({
  id: 'id-oss',
  nama: 'Helpdesk OSS',
  slug: 'helpdesk-oss',
  deskripsi: 'Bantuan NIB dan perizinan berusaha.\nGratis.',
  urutan: 1,
  instansi: 'DPMPTSP Provinsi Lampung',
  instansiSingkatan: 'DPMPTSP',
  websiteTerkait: [{ label: 'OSS RBA', url: 'https://oss.go.id' }],
  statusTampilan: 'aktif',
  punyaAntrean: true,
  punyaChat: true,
  tampilDiHomepage: true,
  ...o,
});

const hariKerja = [1, 2, 3, 4, 5].map((hari) => ({ hari, jamMulai: '08:00', jamSelesai: '15:30' }));
const buka: StatusHariIni = { buka: true, liburKeterangan: null, jadwal: hariKerja };
const tutupKamis: StatusHariIni = { buka: false, liburKeterangan: null, jadwal: [{ hari: 4, jamMulai: '08:00', jamSelesai: '15:30' }] };
const antrean: AntreanLayanan = { antre: 3, dilayani: 1, estimasiTungguMenit: 25 };

const tampil = (p: Partial<React.ComponentProps<typeof LayananPopup>> = {}) => {
  const onTutup = vi.fn();
  render(<LayananPopup layanan={layanan()} status={buka} antrean={antrean} onTutup={onTutup} {...p} />);
  return { onTutup };
};

afterEach(cleanup);

describe('LayananPopup', () => {
  it('dialog modal berlabel nama layanan', () => {
    tampil();
    const dlg = screen.getByRole('dialog');
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    const judul = within(dlg).getByRole('heading', { level: 2, name: 'Helpdesk OSS' });
    expect(dlg.getAttribute('aria-labelledby')).toBe(judul.id);
  });

  it('memuat instansi, deskripsi, dan website terkait (tab baru, noopener)', () => {
    tampil();
    expect(screen.getByText(/DPMPTSP Provinsi Lampung/)).toBeInTheDocument();
    expect(screen.getByText(/Bantuan NIB dan perizinan berusaha/)).toBeInTheDocument();
    const tautan = screen.getByRole('link', { name: /OSS RBA/ });
    expect(tautan).toHaveAttribute('href', 'https://oss.go.id');
    expect(tautan).toHaveAttribute('target', '_blank');
    expect(tautan.getAttribute('rel')).toContain('noopener');
  });

  it('tanpa deskripsi dan tautan, bagian itu tidak ditampilkan', () => {
    tampil({ layanan: layanan({ deskripsi: null, websiteTerkait: [], instansi: null, instansiSingkatan: null }) });
    expect(screen.queryByText(/Website terkait/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /OSS RBA/ })).toBeNull();
  });

  it('jadwal mingguan: tujuh hari, hari tanpa jadwal berlabel Tutup', () => {
    tampil();
    const tabel = screen.getByRole('table', { name: /jadwal mingguan/i });
    const baris = within(tabel).getAllByRole('row');
    expect(baris).toHaveLength(7);
    expect(within(baris[0]).getByText('Senin')).toBeInTheDocument();
    expect(within(baris[0]).getByText('08.00–15.30')).toBeInTheDocument();
    expect(within(baris[5]).getByText('Sabtu')).toBeInTheDocument();
    expect(within(baris[5]).getByText('Tutup')).toBeInTheDocument();
  });

  it('status buka hari ini', () => {
    tampil();
    expect(screen.getByText('Buka sekarang')).toBeInTheDocument();
  });

  it('status tutup menyebut hari buka: "Tutup saat ini · Buka setiap Kamis"', () => {
    tampil({ status: tutupKamis });
    expect(screen.getByText('Tutup saat ini · Buka setiap Kamis')).toBeInTheDocument();
  });

  it('status null (RPC belum ada): tanpa baris status dan tanpa jadwal', () => {
    tampil({ status: null });
    expect(screen.queryByText(/Buka sekarang|Tutup saat ini/)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('antrean tampil bila layanan berantrean dan buka', () => {
    tampil();
    expect(screen.getByText(/3 menunggu/)).toBeInTheDocument();
    expect(screen.getByText(/25 menit/)).toBeInTheDocument();
  });

  it('antrean memuat / gagal dimuat', () => {
    tampil({ antrean: undefined });
    expect(screen.getByText(/Memuat antrean/)).toBeInTheDocument();
    cleanup();
    tampil({ antrean: null });
    expect(screen.getByText(/belum bisa dimuat/i)).toBeInTheDocument();
  });

  it('tidak ada antrean pada layanan tanpa antrean atau saat tutup', () => {
    tampil({ layanan: layanan({ punyaAntrean: false }) });
    expect(screen.queryByText(/menunggu|Memuat antrean/)).toBeNull();
    cleanup();
    tampil({ status: tutupKamis });
    expect(screen.queryByText(/menunggu/)).toBeNull();
  });

  it('antrean kosong: "Belum ada antrean"', () => {
    tampil({ antrean: { antre: 0, dilayani: 0, estimasiTungguMenit: 0 } });
    expect(screen.getByText(/Belum ada antrean/)).toBeInTheDocument();
  });

  it('tautan kecil live chat memuat id layanan; hilang bila punya_chat=false', () => {
    tampil();
    expect(screen.getByRole('link', { name: /Tanya lewat live chat/i })).toHaveAttribute('href', '/chat?layanan=id-oss');
    cleanup();
    tampil({ layanan: layanan({ punyaChat: false }) });
    expect(screen.queryByRole('link', { name: /live chat/i })).toBeNull();
  });

  it('layanan "segera hadir": label, tanpa status/antrean/jadwal', () => {
    tampil({ layanan: layanan({ statusTampilan: 'coming_soon' }) });
    expect(screen.getByText(/Segera hadir/)).toBeInTheDocument();
    expect(screen.queryByText(/Buka sekarang/)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/menunggu/)).toBeNull();
  });

  it('Esc, tombol Tutup, dan klik latar menutup', () => {
    const { onTutup } = tampil();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onTutup).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(onTutup).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(screen.getByTestId('latar-popup'));
    expect(onTutup).toHaveBeenCalledTimes(3);
  });

  it('klik di dalam dialog tidak menutup', () => {
    const { onTutup } = tampil();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onTutup).not.toHaveBeenCalled();
  });

  it('fokus pindah ke dalam dialog dan Tab berputar (focus trap)', () => {
    tampil();
    const dlg = screen.getByRole('dialog');
    expect(dlg.contains(document.activeElement)).toBe(true);
    const fokus = dlg.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
    const terakhir = fokus[fokus.length - 1];
    terakhir.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(fokus[0]);
  });
});
