// @vitest-environment jsdom
// Sel aksi baris antrean: tombol yang tampil per status + peran + kepemilikan, dan penangan yang dipanggilnya.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SelAksi, { type AksiTiket } from './SelAksi';
import { ADMIN, FO, KOORDINATOR, PETUGAS, buatTiket } from './tiketUji';

afterEach(cleanup);

function aksiUji(over: Partial<AksiTiket> = {}): AksiTiket {
  return {
    sedangProses: new Set(),
    sedangPanggil: new Set(),
    panggil: vi.fn(),
    mulai: vi.fn(),
    selesaikan: vi.fn(),
    buka: vi.fn(),
    ...over,
  };
}

const tombol = (nama: string | RegExp) => screen.queryByRole('button', { name: nama });

describe('SelAksi: tiket menunggu', () => {
  it('Petugas layanan itu melihat Panggil dan Mulai Layanan; Panggil mengirim id dan nomor', () => {
    const aksi = aksiUji();
    const t = buatTiket();
    render(<SelAksi tiket={t} pengguna={PETUGAS} aksi={aksi} />);
    fireEvent.click(screen.getByRole('button', { name: 'Panggil' }));
    expect(aksi.panggil).toHaveBeenCalledWith('t-1', 'OS-001');
    fireEvent.click(screen.getByRole('button', { name: 'Mulai Layanan' }));
    expect(aksi.mulai).toHaveBeenCalledWith(t);
    expect(tombol(/Alihkan/)).toBeNull();
  });

  it('Front Office hanya memanggil, tidak memulai layanan', () => {
    render(<SelAksi tiket={buatTiket()} pengguna={FO} aksi={aksiUji()} />);
    expect(tombol('Panggil')).toBeInTheDocument();
    expect(tombol('Mulai Layanan')).toBeNull();
  });

  it('sedang dipanggil: tombol berlabel Terpanggil dan nonaktif', () => {
    render(<SelAksi tiket={buatTiket()} pengguna={PETUGAS} aksi={aksiUji({ sedangPanggil: new Set(['t-1']) })} />);
    expect(screen.getByRole('button', { name: 'Terpanggil' })).toBeDisabled();
  });

  it('sedang diproses: Mulai Layanan berubah Memproses dan sibuk', () => {
    render(<SelAksi tiket={buatTiket()} pengguna={PETUGAS} aksi={aksiUji({ sedangProses: new Set(['t-1']) })} />);
    const mulai = screen.getByRole('button', { name: 'Memproses…' });
    expect(mulai).toHaveAttribute('aria-busy', 'true');
  });

  it('Alihkan hanya untuk Admin pada tiket hasil eskalasi, dan membuka modal alihkan', () => {
    const aksi = aksiUji();
    const t = buatTiket({ penanganan_asal_id: 'tahap-1' });
    const { unmount } = render(<SelAksi tiket={t} pengguna={ADMIN} aksi={aksi} />);
    fireEvent.click(screen.getByRole('button', { name: 'Alihkan tiket OS-001 ke layanan lain' }));
    expect(aksi.buka).toHaveBeenCalledWith('alihkan', t);
    unmount();
    render(<SelAksi tiket={buatTiket()} pengguna={ADMIN} aksi={aksiUji()} />);
    expect(tombol(/Alihkan/)).toBeNull();
  });
});

describe('SelAksi: tiket dilayani', () => {
  const milikPetugas = () => buatTiket({ status: 'dilayani', dilayani_oleh: PETUGAS.id });

  it('pemilik: Form Pendataan membuka wizard, Selesai memanggil selesaikan', () => {
    const aksi = aksiUji();
    const t = milikPetugas();
    render(<SelAksi tiket={t} pengguna={PETUGAS} aksi={aksi} />);
    fireEvent.click(screen.getByRole('button', { name: 'Form Pendataan' }));
    expect(aksi.buka).toHaveBeenCalledWith('wizard', t);
    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    expect(aksi.selesaikan).toHaveBeenCalledWith(t);
    expect(tombol(/Kembalikan/)).toBeNull();
  });

  it('layanan tanpa formulir pendataan: tidak ada Form Pendataan', () => {
    const t = buatTiket({ status: 'dilayani', dilayani_oleh: PETUGAS.id, layanan: { nama: 'Konsultasi', form_pendataan: null } });
    render(<SelAksi tiket={t} pengguna={PETUGAS} aksi={aksiUji()} />);
    expect(tombol('Form Pendataan')).toBeNull();
    expect(tombol('Selesai')).toBeInTheDocument();
  });

  it('pemilik tiket hasil eskalasi: Kembalikan ke FO membuka modal kembalikanKeFo', () => {
    const aksi = aksiUji();
    const t = { ...milikPetugas(), penanganan_asal_id: 'tahap-1' };
    render(<SelAksi tiket={t} pengguna={PETUGAS} aksi={aksi} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kembalikan tiket OS-001 ke Front Office' }));
    expect(aksi.buka).toHaveBeenCalledWith('kembalikanKeFo', t);
  });

  it('bukan pemilik: catatan menyebut pelayan, Lihat Data tersedia, tanpa Selesai', () => {
    const aksi = aksiUji();
    const t = buatTiket({ status: 'dilayani', dilayani_oleh: 'p-lain', pelayan: { nama: 'Budi' } });
    render(<SelAksi tiket={t} pengguna={PETUGAS} aksi={aksi} />);
    expect(screen.getByText('Hanya Budi yang dapat menyelesaikan tiket ini.')).toBeInTheDocument();
    expect(tombol('Selesai')).toBeNull();
    expect(tombol('Ambil alih')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lihat Data' }));
    expect(aksi.buka).toHaveBeenCalledWith('wizard', t);
  });

  it('pelayan tak diketahui: catatan memakai petugas yang memulai', () => {
    const t = buatTiket({ status: 'dilayani', dilayani_oleh: 'p-lain' });
    render(<SelAksi tiket={t} pengguna={PETUGAS} aksi={aksiUji()} />);
    expect(screen.getByText('Hanya petugas yang memulai yang dapat menyelesaikan tiket ini.')).toBeInTheDocument();
  });

  it('Admin melihat Ambil alih (judul darurat) dan membuka modal ambilAlih', () => {
    const aksi = aksiUji();
    const t = buatTiket({ status: 'dilayani', dilayani_oleh: 'p-lain' });
    render(<SelAksi tiket={t} pengguna={ADMIN} aksi={aksi} />);
    const ambil = screen.getByRole('button', { name: 'Ambil alih' });
    expect(ambil).toHaveAttribute('title', expect.stringContaining('Darurat'));
    fireEvent.click(ambil);
    expect(aksi.buka).toHaveBeenCalledWith('ambilAlih', t);
  });

  it('Koordinator layanan itu melihat Ambil alih dengan judul koordinator', () => {
    const t = buatTiket({ status: 'dilayani', dilayani_oleh: 'p-lain' });
    render(<SelAksi tiket={t} pengguna={KOORDINATOR} aksi={aksiUji()} />);
    expect(screen.getByRole('button', { name: 'Ambil alih' })).toHaveAttribute('title', expect.stringContaining('Koordinator'));
  });
});

describe('SelAksi: tiket selesai', () => {
  const selesai = (over = {}) =>
    buatTiket({
      status: 'selesai',
      dilayani_oleh: PETUGAS.id,
      waktu_mulai_layan: '2026-11-11T01:05:00Z',
      waktu_selesai: '2026-11-11T01:30:00Z',
      ...over,
    });

  it('menampilkan durasi dan Lihat Data', () => {
    const aksi = aksiUji();
    const t = selesai();
    render(<SelAksi tiket={t} pengguna={PETUGAS} aksi={aksi} />);
    expect(screen.getByText('25 menit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lihat Data' }));
    expect(aksi.buka).toHaveBeenCalledWith('wizard', t);
  });

  it('survei belum diisi: lencana dan Tampilkan QR membuka surveiQr; sudah diisi: tanpa QR', () => {
    const aksi = aksiUji();
    const t = selesai();
    const { unmount } = render(<SelAksi tiket={t} pengguna={PETUGAS} aksi={aksi} statusSurvei="belum_diisi" />);
    expect(screen.getByText('Pesan Perilaku')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tampilkan QR Pesan Perilaku tiket OS-001' }));
    expect(aksi.buka).toHaveBeenCalledWith('surveiQr', t);
    unmount();
    render(<SelAksi tiket={t} pengguna={PETUGAS} aksi={aksiUji()} statusSurvei="sudah_diisi" />);
    expect(screen.getByText('Sudah diisi')).toBeInTheDocument();
    expect(tombol(/Tampilkan QR/)).toBeNull();
  });

  it('tanpa status survei: baris Pesan Perilaku tidak tampil', () => {
    render(<SelAksi tiket={selesai()} pengguna={PETUGAS} aksi={aksiUji()} />);
    expect(screen.queryByText('Pesan Perilaku')).toBeNull();
  });

  it('Admin dan Front Office melihat Koreksi Data; Petugas hanya catatan data terkunci', () => {
    const aksi = aksiUji();
    const t = selesai();
    const { unmount } = render(<SelAksi tiket={t} pengguna={ADMIN} aksi={aksi} />);
    fireEvent.click(screen.getByRole('button', { name: 'Koreksi Data' }));
    expect(aksi.buka).toHaveBeenCalledWith('koreksi', t);
    unmount();
    const fo = render(<SelAksi tiket={t} pengguna={FO} aksi={aksiUji()} />);
    expect(tombol('Koreksi Data')).toBeInTheDocument();
    fo.unmount();
    render(<SelAksi tiket={t} pengguna={PETUGAS} aksi={aksiUji()} />);
    expect(tombol('Koreksi Data')).toBeNull();
    expect(screen.getByText(/Data sudah dikunci/)).toBeInTheDocument();
  });

  it('layanan tanpa pendataan: tanpa Lihat Data dan Koreksi Data', () => {
    const t = selesai({ layanan: { nama: 'Konsultasi', form_pendataan: null } });
    render(<SelAksi tiket={t} pengguna={ADMIN} aksi={aksiUji()} />);
    expect(tombol('Lihat Data')).toBeNull();
    expect(tombol('Koreksi Data')).toBeNull();
  });

  it('status akhir lain (no show) hanya menampilkan durasi tanda strip', () => {
    render(<SelAksi tiket={buatTiket({ status: 'no_show' })} pengguna={PETUGAS} aksi={aksiUji()} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
