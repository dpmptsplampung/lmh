// @vitest-environment jsdom
// Tabel Data Pelayanan di atas komponen Tabel. Teks sel diambil dari implementasi <table> mentah sebelumnya
// (karakterisasi), lalu detail dibuka lewat tombol "Lihat detail" (bukan klik baris) agar bisa dioperasikan papan ketik.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TabelDataPelayanan from './TabelDataPelayanan';
import { kolomDataPelayanan, type BarisPelayanan } from '@/lib/rekap/terpadu';

afterEach(cleanup);

const baris = (o: Partial<BarisPelayanan>): BarisPelayanan => ({
  pelayanan_id: 'p0', sumber: 'penanganan', tanggal: '2026-10-20', kunjungan_id: null, tiket_id: null, nomor_tiket: null,
  unit: 'layanan', layanan_id: null, layanan_nama: null, kanal: 'tatap_muka', penangan_id: null, penangan_nama: null,
  fo_nama: null, hasil: null, topik: null, catatan: null, mulai_at: null, selesai_at: null, pengunjung_nama: null,
  pengunjung_hp: null, pengunjung_email: null, pengunjung_instansi: null, pengunjung_kategori: null, keperluan: null,
  form_type: null, pendataan: null, ...o,
});

const A = baris({
  pelayanan_id: 'p1', layanan_nama: 'BPJS', pengunjung_nama: 'Andi', pengunjung_hp: '0812', pengunjung_email: 'andi@x.id',
  hasil: 'selesai', topik: 'Kartu hilang', penangan_nama: 'Sari', fo_nama: 'Bayu', keperluan: 'Mengurus kartu yang hilang',
  catatan: 'Sudah dibantu', nomor_tiket: 'BP-001', mulai_at: '2026-10-20T02:10:00Z', selesai_at: '2026-10-20T02:25:00Z',
});
const B = baris({ pelayanan_id: 'p2', tanggal: '2026-10-21', unit: 'fo', kanal: 'live_chat', hasil: 'dieskalasi' });
const KOLOM = kolomDataPelayanan(null);

/** Teks tiap sel data (tanpa baris kepala), per baris. */
const teksBaris = () =>
  screen.getAllByRole('row').slice(1).map((tr) => within(tr).getAllByRole('cell').map((td) => td.textContent?.trim()));

/** Enter pada <button> asli: peramban mengubah keydown Enter menjadi klik; jsdom tidak, jadi ditiru di sini. */
function tekanEnter(el: HTMLElement) {
  const dilanjutkan = fireEvent.keyDown(el, { key: 'Enter' });
  if (dilanjutkan && el.tagName === 'BUTTON') fireEvent.click(el);
}

describe('TabelDataPelayanan: struktur dan isi tidak berubah', () => {
  it('ringkas: 1 baris kepala + 2 baris data, 8 kolom (7 inti + Aksi), teks sel sama dengan sebelumnya', () => {
    render(<TabelDataPelayanan rows={[A, B]} kolom={KOLOM} tampilan="ringkas" keadaan={null} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(
      ['Tanggal', 'Pengunjung', 'Unit / Layanan', 'Topik', 'Hasil', 'Petugas', 'Front Office', 'Aksi'],
    );
    expect(teksBaris()).toEqual([
      ['20/10/202609:10–09:25 · 15 mnt', 'Andi0812 · andi@x.id', 'BPJS', 'Kartu hilang', 'Selesai', 'Sari', 'Bayu', 'Lihat detail'],
      ['21/10/2026', '—', 'Front Office', '(tidak tercatat)', 'Dieskalasi ke layanan', '—', '—', 'Lihat detail'],
    ]);
  });

  it('semua kolom: satu kolom per definisi + Aksi, teks sel sama dengan sebelumnya', () => {
    render(<TabelDataPelayanan rows={[A, B]} kolom={KOLOM} tampilan="semua" keadaan={null} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getAllByRole('columnheader')).toHaveLength(KOLOM.length + 1);
    expect(screen.getAllByRole('columnheader').slice(0, -1).map((h) => h.textContent)).toEqual(KOLOM.map((k) => k.judul));
    expect(teksBaris()).toEqual([
      ['20/10/2026', 'BPJS', 'Tatap muka', 'BP-001', 'Sari', 'Bayu', 'Andi', '0812', 'andi@x.id', '—', '—',
        'Mengurus kartu yang hilang', 'Kartu hilang', 'Selesai', 'Sudah dibantu', '09:10', '09:25', '15', 'Lihat detail'],
      ['21/10/2026', 'Front Office', 'Live Chat', '—', '—', '—', '—', '—', '—', '—', '—', '—',
        '(tidak tercatat)', 'Dieskalasi ke layanan', '—', '—', '—', '—', 'Lihat detail'],
    ]);
  });

  it('wilayah gulir berlabel dan bisa difokus; kolom Durasi rata kanan', () => {
    render(<TabelDataPelayanan rows={[A]} kolom={KOLOM} tampilan="semua" keadaan={null} />);
    const wilayah = screen.getByRole('region', { name: 'Data pelayanan, satu baris per pelayanan' });
    expect(wilayah).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('table', { name: 'Data pelayanan, satu baris per pelayanan' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '15' }).className).toMatch(/angka/);
  });

  it('tanpa baris: pesan keadaan (atau pesan bawaan), bukan tabel', () => {
    const { rerender } = render(<TabelDataPelayanan rows={[]} kolom={KOLOM} tampilan="ringkas" keadaan="Memuat data…" />);
    expect(screen.getByText('Memuat data…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    rerender(<TabelDataPelayanan rows={[]} kolom={KOLOM} tampilan="ringkas" keadaan={null} />);
    expect(screen.getByText('Belum ada pelayanan dilayani pada rentang ini.')).toBeInTheDocument();
  });
});

describe('TabelDataPelayanan: detail lewat tombol (papan ketik)', () => {
  it('tidak ada baris yang bisa diklik: mengklik sel tidak membuka detail', () => {
    render(<TabelDataPelayanan rows={[A]} kolom={KOLOM} tampilan="ringkas" keadaan={null} />);
    fireEvent.click(screen.getByText('Sari'));
    fireEvent.click(screen.getByText('Andi'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fokus pada tombol "Lihat detail" + Enter membuka detail lengkap; Escape menutup dan fokus kembali ke tombol', async () => {
    render(<TabelDataPelayanan rows={[A, B]} kolom={KOLOM} tampilan="ringkas" keadaan={null} />);
    const tombol = screen.getByRole('button', { name: 'Lihat detail pelayanan Andi' });
    expect(tombol.tagName).toBe('BUTTON');
    expect(tombol).toHaveAttribute('type', 'button');
    expect(tombol).not.toHaveAttribute('tabindex', '-1');
    expect(tombol).toHaveTextContent('Lihat detail');
    expect(tombol).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByText('Mengurus kartu yang hilang')).toBeNull();

    tombol.focus();
    expect(tombol).toHaveFocus();
    tekanEnter(tombol);

    const dialog = await screen.findByRole('dialog', { name: 'Detail pelayanan Andi' });
    // Seluruh kolom (bukan hanya yang ringkas) tampil sebagai daftar istilah-nilai.
    expect(within(dialog).getByText('Mengurus kartu yang hilang')).toBeInTheDocument();
    expect(within(dialog).getByText('Sudah dibantu')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('term')).toHaveLength(KOLOM.length);
    // Rincian hanya milik baris yang dipilih.
    expect(within(dialog).queryByText('Live Chat')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(tombol).toHaveFocus();
  });

  it('tombol Tutup di detail menutupnya; tombol baris lain membuka detail baris itu', async () => {
    render(<TabelDataPelayanan rows={[A, B]} kolom={KOLOM} tampilan="ringkas" keadaan={null} />);
    // Pengunjung tanpa nama: nama tombol tidak memuat nama kosong.
    const tombolB = screen.getByRole('button', { name: 'Lihat detail pelayanan' });
    tombolB.focus();
    tekanEnter(tombolB);
    const dialog = await screen.findByRole('dialog', { name: 'Detail pelayanan' });
    expect(within(dialog).getByText('Live Chat')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tutup dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
