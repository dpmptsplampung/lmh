// @vitest-environment jsdom
// Sel Nama (nama + catatan eskalasi Front Office) dan sel Status (lencana + siapa yang melayani).
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SelNama from './SelNama';
import SelStatus from './SelStatus';
import { ADMIN, PETUGAS, buatTiket } from './tiketUji';

afterEach(cleanup);

describe('SelNama', () => {
  it('menampilkan nama pengunjung; tiket biasa tanpa blok eskalasi', () => {
    render(<SelNama tiket={buatTiket()} />);
    expect(screen.getByText('Rina')).toBeInTheDocument();
    expect(screen.queryByText(/Eskalasi dari Front Office/)).toBeNull();
  });

  it('tanpa data kunjungan: tanda strip', () => {
    render(<SelNama tiket={buatTiket({ kunjungan: null })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('tiket hasil eskalasi: judul, topik, catatan, dan nama FO', () => {
    render(
      <SelNama
        tiket={buatTiket({ penanganan_asal_id: 'tahap-1' })}
        catatanFo={{ topik: 'NIB', catatan: 'Lupa kata sandi OSS', foNama: 'Sari' }}
      />,
    );
    expect(screen.getByText(/Eskalasi dari Front Office/)).toBeInTheDocument();
    expect(screen.getByText('Topik: NIB')).toBeInTheDocument();
    expect(screen.getByText('Lupa kata sandi OSS')).toBeInTheDocument();
    expect(screen.getByText('oleh Sari')).toBeInTheDocument();
  });

  it('tiket hasil eskalasi tanpa catatan dimuat: hanya judul eskalasi', () => {
    render(<SelNama tiket={buatTiket({ penanganan_asal_id: 'tahap-1' })} />);
    expect(screen.getByText(/Eskalasi dari Front Office/)).toBeInTheDocument();
    expect(screen.queryByText(/^Topik:/)).toBeNull();
    expect(screen.queryByText(/^oleh /)).toBeNull();
  });
});

describe('SelStatus', () => {
  it('lencana berlabel status; menunggu tanpa keterangan pelayan', () => {
    render(<SelStatus tiket={buatTiket()} pengguna={PETUGAS} />);
    expect(screen.getByText('Menunggu')).toBeInTheDocument();
    expect(screen.queryByText(/^oleh /)).toBeNull();
  });

  it('dilayani milik sendiri: "oleh Anda"', () => {
    render(<SelStatus tiket={buatTiket({ status: 'dilayani', dilayani_oleh: PETUGAS.id })} pengguna={PETUGAS} />);
    expect(screen.getByText('Dilayani')).toBeInTheDocument();
    expect(screen.getByText('oleh Anda')).toBeInTheDocument();
  });

  it('dilayani orang lain: menyebut nama; tanpa nama: petugas lain', () => {
    const { unmount } = render(
      <SelStatus tiket={buatTiket({ status: 'dilayani', dilayani_oleh: 'p-lain', pelayan: { nama: 'Budi' } })} pengguna={ADMIN} />,
    );
    expect(screen.getByText('oleh Budi')).toBeInTheDocument();
    unmount();
    render(<SelStatus tiket={buatTiket({ status: 'dilayani', dilayani_oleh: 'p-lain' })} pengguna={ADMIN} />);
    expect(screen.getByText('oleh petugas lain')).toBeInTheDocument();
  });

  it('status akhir memakai label panjang', () => {
    render(<SelStatus tiket={buatTiket({ status: 'tidak_terlayani' })} pengguna={ADMIN} />);
    expect(screen.getByText('Tidak terlayani (petugas tidak hadir)')).toBeInTheDocument();
  });
});
