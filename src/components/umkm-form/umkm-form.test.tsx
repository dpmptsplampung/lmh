// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FotoInput, ProdukInput } from '@/lib/umkm-katalog/schemas';
import BagianKontak from './BagianKontak';
import BagianLokasi from './BagianLokasi';
import BagianUsaha from './BagianUsaha';
import EditorProduk from './EditorProduk';
import PemilihFoto from './PemilihFoto';
import { bacaIsian } from './baca-isian';

afterEach(cleanup);

const opsi = (select: HTMLElement) => Array.from((select as HTMLSelectElement).options).map(o => o.value).filter(Boolean);

describe('BagianUsaha dan BagianLokasi', () => {
  it('kategori mengikuti jenis', () => {
    render(<BagianUsaha />);
    fireEvent.change(screen.getByLabelText('Jenis'), { target: { value: 'Jasa' } });
    const kategori = opsi(screen.getByLabelText('Kategori'));
    expect(kategori).toHaveLength(10);
    expect(kategori).toContain('Katering & Nasi Kotak');
    expect(kategori).not.toContain('Makanan Olahan');
  });

  it('ganti jenis mengosongkan kategori', () => {
    render(<BagianUsaha awal={{ jenis: 'Produk', kategori: 'Makanan Olahan' }} />);
    expect((screen.getByLabelText('Kategori') as HTMLSelectElement).value).toBe('Makanan Olahan');
    fireEvent.change(screen.getByLabelText('Jenis'), { target: { value: 'Jasa' } });
    expect((screen.getByLabelText('Kategori') as HTMLSelectElement).value).toBe('');
  });

  it('kecamatan menyarankan isi kabupaten terpilih', () => {
    const { container } = render(<BagianLokasi />);
    fireEvent.change(screen.getByLabelText('Kabupaten/kota'), { target: { value: 'Kota Metro' } });
    const daftar = container.querySelector(`datalist[id="${screen.getByLabelText('Kecamatan (opsional)').getAttribute('list')}"]`);
    const isi = Array.from(daftar!.querySelectorAll('option')).map(o => o.value);
    expect(isi).toContain('Metro Pusat');
    expect(isi.length).toBeGreaterThan(0);
  });

  it('setiap isian punya label', () => {
    render(<form><BagianUsaha /><BagianLokasi /><BagianKontak labelNomor="Nomor WhatsApp" /></form>);
    for (const l of ['Nama usaha', 'Deskripsi', 'Jenis', 'Kategori', 'Bentuk usaha (opsional)', 'Tahun mulai usaha (opsional)',
      'Omzet per tahun (opsional)', 'Jumlah tenaga kerja (opsional)', 'Memiliki NIB (opsional)', 'Instagram (opsional)',
      'TikTok (opsional)', 'Kabupaten/kota', 'Kecamatan (opsional)', 'Nama pemilik (opsional)', 'Nomor WhatsApp'])
      expect(screen.getByLabelText(l), l).toBeTruthy();
    expect(screen.getAllByText('Tidak tampil di katalog.', { exact: false }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Hanya rentang Rp50 juta ke atas yang tampil di katalog.', { exact: false })).toBeTruthy();
  });
});

const tautan = (n: number): FotoInput => ({ asal: 'eksternal', url: `https://contoh.id/foto-${n}.jpg` });

function Wadah({ awal = [], unggah, onUbah }: {
  awal?: FotoInput[]; unggah?: (f: File) => Promise<FotoInput>; onUbah?: (n: FotoInput[]) => void;
}) {
  const [nilai, setNilai] = useState(awal);
  return <PemilihFoto nilai={nilai} label="Foto usaha" maks={3} pilihUtama
    unggah={unggah ?? (async () => ({ asal: 'unggahan', r2_key: 'umkm-draf/u/x.jpg' }))}
    onUbah={n => { setNilai(n); onUbah?.(n); }} />;
}

describe('PemilihFoto', () => {
  it('foto bisa ditambah lewat tautan atau unggah dan satu dijadikan utama', async () => {
    const onUbah = vi.fn();
    render(<Wadah onUbah={onUbah} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tautan' }));
    fireEvent.change(screen.getByLabelText('Tambah tautan foto HTTPS'), { target: { value: 'https://contoh.id/a.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah tautan' }));
    expect(onUbah).toHaveBeenLastCalledWith([{ asal: 'eksternal', url: 'https://contoh.id/a.jpg' }]);

    fireEvent.click(screen.getByRole('tab', { name: 'Unggah' }));
    const berkas = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Unggah foto'), { target: { files: [berkas] } });
    await waitFor(() => expect(onUbah).toHaveBeenCalledTimes(2));
    expect(onUbah.mock.lastCall![0]).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'Jadikan foto utama' })[1]);
    const akhir = onUbah.mock.lastCall![0] as FotoInput[];
    expect(akhir.filter(f => f.utama)).toHaveLength(1);
    expect(akhir[1].utama).toBe(true);
    // Memilih foto lain memindahkan penanda.
    fireEvent.click(screen.getAllByRole('button', { name: 'Jadikan foto utama' })[0]);
    const lagi = onUbah.mock.lastCall![0] as FotoInput[];
    expect(lagi.filter(f => f.utama)).toHaveLength(1);
    expect(lagi[0].utama).toBe(true);
  });

  it('menolak tautan tidak sah dan tambahan setelah maks', () => {
    render(<Wadah awal={[tautan(1), tautan(2), tautan(3)]} />);
    expect(screen.getByText(/Maksimal 3 foto/)).toBeTruthy();
    expect((screen.getByLabelText('Unggah foto') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Keluarkan foto 3' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Tautan' }));
    fireEvent.change(screen.getByLabelText('Tambah tautan foto HTTPS'), { target: { value: 'http://contoh.id/a.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah tautan' }));
    expect(screen.getByRole('alert').textContent).toMatch(/https/);
  });

  it('menghapus foto utama membuang penandanya', () => {
    const onUbah = vi.fn();
    render(<Wadah awal={[{ ...tautan(1), utama: true }, tautan(2)]} onUbah={onUbah} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keluarkan foto 1' }));
    expect(onUbah).toHaveBeenLastCalledWith([tautan(2)]);
  });
});

function WadahProduk({ awal = [], onUbah, galat, unggah }: {
  awal?: ProdukInput[]; onUbah?: (n: ProdukInput[]) => void; galat?: Record<string, string>;
  unggah?: (f: File) => Promise<FotoInput>;
}) {
  const [nilai, setNilai] = useState(awal);
  return <EditorProduk nilai={nilai} galat={galat}
    unggah={unggah ?? (async () => ({ asal: 'unggahan', r2_key: 'umkm-draf/u/x.jpg' }))}
    onUbah={n => { setNilai(n); onUbah?.(n); }} />;
}

describe('EditorProduk', () => {
  it('editor produk menambah, mengurutkan, dan menghapus produk', () => {
    const onUbah = vi.fn();
    render(<WadahProduk onUbah={onUbah} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tambah produk' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tambah produk' }));
    const namas = () => screen.getAllByLabelText('Nama produk') as HTMLInputElement[];
    fireEvent.change(namas()[0], { target: { value: 'Keripik' } });
    fireEvent.change(namas()[1], { target: { value: 'Kopi' } });
    expect((onUbah.mock.lastCall![0] as ProdukInput[]).map(p => p.nama)).toEqual(['Keripik', 'Kopi']);

    fireEvent.click(screen.getByRole('button', { name: 'Turunkan produk 1' }));
    expect(namas().map(i => i.value)).toEqual(['Kopi', 'Keripik']);
    fireEvent.click(screen.getByRole('button', { name: 'Naikkan produk 2' }));
    expect(namas().map(i => i.value)).toEqual(['Keripik', 'Kopi']);

    fireEvent.click(screen.getByRole('button', { name: 'Hapus produk 1' }));
    expect(namas().map(i => i.value)).toEqual(['Kopi']);
    expect((onUbah.mock.lastCall![0] as ProdukInput[]).map(p => p.nama)).toEqual(['Kopi']);
  });

  it('mengisi kapasitas dan menampilkan galat per produk', () => {
    const onUbah = vi.fn();
    render(<WadahProduk awal={[{ nama: 'Keripik' }]} onUbah={onUbah}
      galat={{ 'produk.0.kapasitas_jumlah': 'Isi jumlah, satuan, dan periode kapasitas sekaligus, atau kosongkan ketiganya' }} />);
    fireEvent.change(screen.getByLabelText('Jumlah kapasitas'), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText('Satuan kapasitas'), { target: { value: 'kg' } });
    fireEvent.change(screen.getByLabelText('Periode kapasitas'), { target: { value: 'bulan' } });
    expect(onUbah.mock.lastCall![0][0]).toMatchObject({ kapasitas_jumlah: 1500, kapasitas_satuan: 'kg', kapasitas_periode: 'bulan' });
    expect(screen.getByText(/Isi jumlah, satuan, dan periode kapasitas sekaligus/)).toBeTruthy();
  });

  it('tombol tambah dimatikan pada 20 produk', () => {
    const dua = Array.from({ length: 20 }, (_, i) => ({ nama: `P${i}` }));
    render(<WadahProduk awal={dua} />);
    expect((screen.getByRole('button', { name: 'Tambah produk' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(screen.getAllByRole('group')[0]).getByLabelText('Nama produk')).toBeTruthy();
  });
});

describe('bacaIsian', () => {
  it('bacaIsian mengubah kosong menjadi null', () => {
    const fd = new FormData();
    fd.set('nama', ' Kopi Ibu '); fd.set('deskripsi', ''); fd.set('jenis', 'Produk'); fd.set('kategori', 'Makanan Olahan');
    fd.set('spesifik', ''); fd.set('kabupaten_kota', 'Kota Metro'); fd.set('kecamatan', ''); fd.set('alamat', '');
    fd.set('bentuk_usaha', ''); fd.set('tahun_mulai', ''); fd.set('omzet_rentang', ''); fd.set('tenaga_kerja_rentang', '');
    fd.set('memiliki_nib', ''); fd.set('instagram', ''); fd.set('tiktok', ''); fd.set('nama_pemilik', ''); fd.set('nomor', '');
    expect(bacaIsian(fd)).toEqual({
      nama: 'Kopi Ibu', deskripsi: '', jenis: 'Produk', kategori: 'Makanan Olahan', spesifik: null,
      kabupaten_kota: 'Kota Metro', kecamatan: null, alamat: null, bentuk_usaha: null, tahun_mulai: null,
      omzet_rentang: null, tenaga_kerja_rentang: null, memiliki_nib: null, instagram: null, tiktok: null,
      nama_pemilik: null, nomor: null,
    });
  });

  it('mengubah angka dan pilihan ya/tidak', () => {
    const fd = new FormData();
    fd.set('tahun_mulai', '2015'); fd.set('memiliki_nib', 'ya'); fd.set('omzet_rentang', '50_300jt');
    const r = bacaIsian(fd);
    expect(r).toMatchObject({ tahun_mulai: 2015, memiliki_nib: true, omzet_rentang: '50_300jt' });
    fd.set('memiliki_nib', 'tidak');
    expect(bacaIsian(fd).memiliki_nib).toBe(false);
  });
});

// Unggahan yang tertahan: hasilnya harus dipasang pada keadaan terbaru, bukan keadaan saat berkas dipilih.
function tahan() {
  let selesai!: (f: FotoInput) => void;
  const janji = new Promise<FotoInput>((r) => { selesai = r; });
  return { janji, selesai };
}
const BERKAS = () => new File(['x'], 'a.jpg', { type: 'image/jpeg' });
const BARU: FotoInput = { asal: 'unggahan', r2_key: 'umkm-draf/u/baru.jpg' };

describe('unggahan yang tertahan', () => {
  it('foto yang dikeluarkan saat unggahan berjalan tidak kembali', async () => {
    const t = tahan();
    const onUbah = vi.fn();
    render(<Wadah awal={[tautan(1)]} unggah={() => t.janji} onUbah={onUbah} />);
    fireEvent.change(screen.getByLabelText('Unggah foto'), { target: { files: [BERKAS()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Keluarkan foto 1' }));
    t.selesai(BARU);
    await waitFor(() => expect(onUbah).toHaveBeenCalledTimes(2));
    expect(onUbah.mock.lastCall![0]).toEqual([BARU]);
  });

  it('penanda foto utama yang dipasang saat unggahan berjalan tidak hilang', async () => {
    const t = tahan();
    const onUbah = vi.fn();
    render(<Wadah awal={[tautan(1), tautan(2)]} unggah={() => t.janji} onUbah={onUbah} />);
    fireEvent.change(screen.getByLabelText('Unggah foto'), { target: { files: [BERKAS()] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Jadikan foto utama' })[1]);
    t.selesai(BARU);
    await waitFor(() => expect(onUbah).toHaveBeenCalledTimes(2));
    const akhir = onUbah.mock.lastCall![0] as FotoInput[];
    expect(akhir).toHaveLength(3);
    expect(akhir[1].utama).toBe(true);
  });

  it('nama produk yang diedit dan produk baru tidak hilang saat foto produk diunggah', async () => {
    const t = tahan();
    const onUbah = vi.fn();
    render(<WadahProduk awal={[{ nama: 'Nama lama' }, { nama: 'Produk kedua' }]} unggah={() => t.janji} onUbah={onUbah} />);
    fireEvent.change(screen.getAllByLabelText('Unggah foto')[0], { target: { files: [BERKAS()] } });
    fireEvent.change(screen.getAllByLabelText('Nama produk')[0], { target: { value: 'Nama baru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah produk' }));
    t.selesai(BARU);
    await waitFor(() => expect((onUbah.mock.lastCall![0] as ProdukInput[])[0].foto).toEqual(BARU));
    const akhir = onUbah.mock.lastCall![0] as ProdukInput[];
    expect(akhir.map(p => p.nama)).toEqual(['Nama baru', 'Produk kedua', '']);
    expect((screen.getAllByLabelText('Nama produk')[0] as HTMLInputElement).value).toBe('Nama baru');
  });

  it('foto menempel pada produknya walau urutan berubah saat unggahan berjalan', async () => {
    const t = tahan();
    const onUbah = vi.fn();
    render(<WadahProduk awal={[{ nama: 'Pertama' }, { nama: 'Kedua' }]} unggah={() => t.janji} onUbah={onUbah} />);
    fireEvent.change(screen.getAllByLabelText('Unggah foto')[0], { target: { files: [BERKAS()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Turunkan produk 1' }));
    t.selesai(BARU);
    await waitFor(() => expect((onUbah.mock.lastCall![0] as ProdukInput[])[1].foto).toEqual(BARU));
    expect((onUbah.mock.lastCall![0] as ProdukInput[]).map(p => p.nama)).toEqual(['Kedua', 'Pertama']);
  });

  it('produk yang dihapus saat unggahan berjalan tidak muncul lagi', async () => {
    const t = tahan();
    const onUbah = vi.fn();
    render(<WadahProduk awal={[{ nama: 'Pertama' }, { nama: 'Kedua' }]} unggah={() => t.janji} onUbah={onUbah} />);
    fireEvent.change(screen.getAllByLabelText('Unggah foto')[0], { target: { files: [BERKAS()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Hapus produk 1' }));
    const dipanggil = onUbah.mock.calls.length;
    t.selesai(BARU);
    await new Promise((r) => setTimeout(r, 20));
    expect(onUbah).toHaveBeenCalledTimes(dipanggil);
    expect((onUbah.mock.lastCall![0] as ProdukInput[]).map(p => p.nama)).toEqual(['Kedua']);
  });
});

describe('fokus setelah Hapus produk', () => {
  const hapus = (n: number) => {
    const tombol = screen.getByRole('button', { name: `Hapus produk ${n}` });
    tombol.focus();
    fireEvent.click(tombol);
  };
  const tigaProduk = [{ nama: 'A' }, { nama: 'B' }, { nama: 'C' }];

  it('pindah ke produk sebelumnya (atau produk yang menggantikan bila yang pertama)', () => {
    render(<WadahProduk awal={tigaProduk} />);
    hapus(2);
    expect(document.activeElement).toBe(screen.getAllByLabelText('Nama produk')[0]);
    hapus(1);
    expect(document.activeElement).toBe(screen.getAllByLabelText('Nama produk')[0]);
    expect((document.activeElement as HTMLInputElement).value).toBe('C');
  });

  it('produk terakhir yang dihapus memindahkan fokus ke produk sebelumnya', () => {
    render(<WadahProduk awal={tigaProduk} />);
    hapus(3);
    const namas = screen.getAllByLabelText('Nama produk');
    expect(document.activeElement).toBe(namas[1]);
  });

  it('bila daftar kosong fokus ke tombol Tambah produk', () => {
    render(<WadahProduk awal={[{ nama: 'A' }]} />);
    hapus(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tambah produk' }));
  });
});
