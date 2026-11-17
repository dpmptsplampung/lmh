// @vitest-environment jsdom
// Wizard Mulai Layanan dua langkah (G5): langkah 1 data dari FO (baca-saja), langkah 2 Pendataan Khusus dengan simpan
// otomatis ke draf, "Tutup, lanjut melayani" mempertahankan draf, layanan tanpa isian melompati langkah 2.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { rpcMock, tabel } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  tabel: {} as Record<string, { data: unknown; error: { message: string; code?: string } | null }>,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: rpcMock,
    from: (nama: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit', 'order']) b[m] = () => b;
      b.maybeSingle = () => Promise.resolve(tabel[nama] ?? { data: null, error: null });
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(tabel[nama] ?? { data: [], error: null }).then(res, rej);
      return b;
    },
  }),
}));

import MulaiLayananWizard, { type TiketMulaiLayanan } from './MulaiLayananWizard';

const FID = 'aaaaaaaa-0000-4000-8000-000000000001';
const FID2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const TIKET: TiketMulaiLayanan = { id: 'tk1', nomor_display: 'BP-007', layanan_id: 'ly1', berFormulir: false };
const fld = (o: Record<string, unknown>) => ({
  id: FID, layanan_id: 'ly1', label: 'Nomor kartu', jenis: 'teks_singkat', wajib: true, opsi: [], urut: 0,
  tersembunyi: false, pernah_diisi: false, ...o,
});

type Balasan = { data: unknown; error: { code?: string; message: string } | null };
const balasan: Record<string, Balasan> = {};
const panggilan = (nama: string) => rpcMock.mock.calls.filter((c) => c[0] === nama);

function atur(definisi: unknown[], draf: Record<string, unknown> | null = null) {
  balasan.pendataan_khusus_definisi = { data: definisi, error: null };
  balasan.pendataan_khusus_draf_baca = {
    data: draf ? { tiket_id: 'tk1', jawaban: draf, diubah_oleh: 'p1', updated_at: '2026-11-17T01:00:00Z' } : null,
    error: null,
  };
}

function pasang(over: Partial<React.ComponentProps<typeof MulaiLayananWizard>> = {}) {
  const props = { tiket: TIKET, bolehUbah: true, onClose: vi.fn(), onLanjutForm: vi.fn(), onDataBasi: vi.fn(), ...over };
  render(<MulaiLayananWizard {...props} />);
  return props;
}

const lanjut = async () => {
  const tombol = await screen.findByRole('button', { name: 'Lanjut' });
  await waitFor(() => expect(tombol).toBeEnabled());
  fireEvent.click(tombol);
};

beforeEach(() => {
  rpcMock.mockReset();
  for (const k of Object.keys(balasan)) delete balasan[k];
  for (const k of Object.keys(tabel)) delete tabel[k];
  atur([fld({})]);
  balasan.pendataan_khusus_draf_simpan = { data: { ok: true, tiket_id: 'tk1', updated_at: '2026-11-17T01:00:05Z' }, error: null };
  rpcMock.mockImplementation((nama: string) =>
    Promise.resolve(balasan[nama] ?? { data: null, error: { message: `tak dikenal: ${nama}` } }));
  tabel.tiket_antrean = {
    data: {
      id: 'tk1', penanganan_asal_id: null, waktu_terbit: '2026-11-17T01:00:00Z',
      kunjungan: {
        nama: 'Rina Wati', kontak_hp: '081200001111', email: 'rina@contoh.id', asal_instansi: 'CV Maju', kategori: 'umum',
        keperluan: 'Mengurus NIB baru', asal: 'walk_in', waktu_masuk: '2026-11-17T01:00:00Z', pencatat: { nama: 'Sari FO' },
      },
    },
    error: null,
  };
});
afterEach(cleanup);

describe('Langkah 1: Data dari Front Office (baca-saja)', () => {
  it('menampilkan identitas, keperluan, pencatat, dan jam daftar tanpa kolom isian', async () => {
    pasang();
    expect(await screen.findByText('Rina Wati')).toBeInTheDocument();
    expect(screen.getByText('081200001111')).toBeInTheDocument();
    expect(screen.getByText('rina@contoh.id')).toBeInTheDocument();
    expect(screen.getByText('Mengurus NIB baru')).toBeInTheDocument();
    expect(screen.getByText('Sari FO')).toBeInTheDocument();
    expect(screen.getByText(/WIB/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('dialog', { name: /Mulai layanan — BP-007/ })).toBeInTheDocument();
  });

  it('tiket hasil eskalasi: catatan eskalasi FO ikut tampil', async () => {
    tabel.tiket_antrean.data = { ...(tabel.tiket_antrean.data as object), penanganan_asal_id: 'pn1' };
    tabel.penanganan = { data: [{ id: 'pn1', topik: 'Konsultasi', catatan: 'Berkas belum lengkap', penangan: { nama: 'Budi FO' } }], error: null };
    pasang();
    expect(await screen.findByText('Berkas belum lengkap')).toBeInTheDocument();
    expect(screen.getByText('Konsultasi')).toBeInTheDocument();
  });

  it('galat memuat data: pesan role=alert dan Coba lagi', async () => {
    tabel.tiket_antrean = { data: null, error: { message: 'boom' } };
    pasang();
    expect((await screen.findByText(/Gagal memuat data dari Front Office/)).getAttribute('role')).toBe('alert');
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });

  it('Layanan dengan isian aktif: Lanjut + penunjuk 2 langkah; Layanan tanpa isian: langsung Tutup, lanjut melayani', async () => {
    pasang();
    expect(await screen.findByRole('button', { name: 'Lanjut' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Langkah' })).toBeInTheDocument();
    cleanup();
    atur([]);
    const p = pasang();
    const tutup = await screen.findByRole('button', { name: 'Tutup, lanjut melayani' });
    await waitFor(() => expect(tutup).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Lanjut' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Langkah' })).toBeNull();
    fireEvent.click(tutup);
    await waitFor(() => expect(p.onClose).toHaveBeenCalled());
    expect(panggilan('pendataan_khusus_draf_baca')).toHaveLength(0);
  });

  it('migrasi G5 belum diterapkan (definisi PGRST202): tanpa langkah 2', async () => {
    balasan.pendataan_khusus_definisi = { data: null, error: { code: 'PGRST202', message: 'tidak ada' } };
    pasang();
    const tutup = await screen.findByRole('button', { name: 'Tutup, lanjut melayani' });
    await waitFor(() => expect(tutup).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Lanjut' })).toBeNull();
  });
});

describe('Layanan berformulir tetap (OSS/Non OSS)', () => {
  it('Lanjut memanggil onLanjutForm; tidak memuat definisi/draf Pendataan Khusus', async () => {
    const p = pasang({ tiket: { ...TIKET, berFormulir: true } });
    await lanjut();
    expect(p.onLanjutForm).toHaveBeenCalledTimes(1);
    expect(panggilan('pendataan_khusus_definisi')).toHaveLength(0);
    expect(panggilan('pendataan_khusus_draf_baca')).toHaveLength(0);
  });
});

describe('Langkah 2: Pendataan Khusus dengan draf', () => {
  it('memuat isian terkini beserta draf tersimpan, label wajib dan jenisnya', async () => {
    atur([fld({}), fld({ id: FID2, label: 'Jenis usaha', jenis: 'pilihan_tunggal', opsi: ['Mikro', 'Kecil'], wajib: false, urut: 1 })], { [FID]: 'KK-1' });
    pasang();
    await lanjut();
    const isian = await screen.findByLabelText(/Nomor kartu/);
    await waitFor(() => expect(isian).toHaveValue('KK-1'));
    expect(screen.getByLabelText(/Jenis usaha/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Kecil' })).toBeInTheDocument();
    expect(panggilan('pendataan_khusus_draf_baca')[0][1]).toEqual({ p_tiket: 'tk1' });
  });

  it('simpan otomatis (debounce): satu panggilan draf_simpan berisi seluruh jawaban, indikator "Draf tersimpan"', async () => {
    pasang();
    await lanjut();
    const isian = await screen.findByLabelText(/Nomor kartu/);
    await waitFor(() => expect(isian).toBeEnabled());
    fireEvent.change(isian, { target: { value: 'K' } });
    fireEvent.change(isian, { target: { value: 'KK-9' } });
    expect(panggilan('pendataan_khusus_draf_simpan')).toHaveLength(0);
    await waitFor(() => expect(panggilan('pendataan_khusus_draf_simpan')).toHaveLength(1), { timeout: 3000 });
    expect(panggilan('pendataan_khusus_draf_simpan')[0][1]).toEqual({ p_tiket: 'tk1', p_jawaban: { [FID]: 'KK-9' } });
    expect(await screen.findByText(/Draf tersimpan/)).toBeInTheDocument();
  });

  it('memuat draf tanpa mengubah apa pun tidak memicu simpan', async () => {
    atur([fld({})], { [FID]: 'KK-1' });
    pasang();
    await lanjut();
    await waitFor(() => expect(screen.getByLabelText(/Nomor kartu/)).toHaveValue('KK-1'));
    await new Promise((r) => setTimeout(r, 1100));
    expect(panggilan('pendataan_khusus_draf_simpan')).toHaveLength(0);
  });

  it('regresi: ketik, Sebelumnya, Lanjut sebelum debounce selesai: nilai tetap, draf tidak dibaca ulang, simpan tetap terjadi', async () => {
    pasang();
    await lanjut();
    const isian = await screen.findByLabelText(/Nomor kartu/);
    await waitFor(() => expect(isian).toBeEnabled());
    expect(panggilan('pendataan_khusus_draf_baca')).toHaveLength(1);
    fireEvent.change(isian, { target: { value: 'BERKAS-BARU' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sebelumnya' }));
    expect(await screen.findByText('Rina Wati')).toBeInTheDocument();
    await lanjut();
    const lagi = await screen.findByLabelText(/Nomor kartu/);
    expect(lagi).toHaveValue('BERKAS-BARU');
    expect(panggilan('pendataan_khusus_draf_baca')).toHaveLength(1);
    await waitFor(() => expect(panggilan('pendataan_khusus_draf_simpan')).toHaveLength(1), { timeout: 3000 });
    expect(panggilan('pendataan_khusus_draf_simpan')[0][1]).toEqual({ p_tiket: 'tk1', p_jawaban: { [FID]: 'BERKAS-BARU' } });
    expect(screen.getByLabelText(/Nomor kartu/)).toHaveValue('BERKAS-BARU');
  });

  it('Tutup, lanjut melayani: menyimpan perubahan yang tertunda lebih dulu, baru menutup (draf dipertahankan)', async () => {
    const p = pasang();
    await lanjut();
    const isian = await screen.findByLabelText(/Nomor kartu/);
    await waitFor(() => expect(isian).toBeEnabled());
    fireEvent.change(isian, { target: { value: 'KK-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tutup, lanjut melayani' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1));
    expect(panggilan('pendataan_khusus_draf_simpan')).toHaveLength(1);
    expect(panggilan('pendataan_khusus_draf_simpan')[0][1]).toEqual({ p_tiket: 'tk1', p_jawaban: { [FID]: 'KK-5' } });
    expect(panggilan('layanan_selesai_khusus')).toHaveLength(0);
  });

  it('gagal simpan: galat jelas (role=alert), isian tetap di layar; menutup meminta penegasan "Tutup tanpa menyimpan"', async () => {
    balasan.pendataan_khusus_draf_simpan = { data: null, error: { code: '22023', message: 'KHUSUS_TIDAK_VALID: isian' } };
    const p = pasang();
    await lanjut();
    const isian = await screen.findByLabelText(/Nomor kartu/);
    await waitFor(() => expect(isian).toBeEnabled());
    fireEvent.change(isian, { target: { value: 'KK-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tutup, lanjut melayani' }));
    const alert = await screen.findByText(/tidak valid/);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(p.onClose).not.toHaveBeenCalled();
    expect(isian).toHaveValue('KK-5');
    expect(p.onDataBasi).toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Tutup tanpa menyimpan' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1));
  });

  it('bukan pemilik (bolehUbah=false): isian terkunci, tanpa simpan', async () => {
    atur([fld({})], { [FID]: 'KK-1' });
    const p = pasang({ bolehUbah: false });
    await lanjut();
    const isian = await screen.findByLabelText(/Nomor kartu/);
    await waitFor(() => expect(isian).toHaveValue('KK-1'));
    expect(isian).toBeDisabled();
    expect(screen.getByText(/Hanya dapat dibaca/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tutup, lanjut melayani' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalled());
    expect(panggilan('pendataan_khusus_draf_simpan')).toHaveLength(0);
  });

  it('langkahAwal=2 (tombol Isi Pendataan): langsung isian; Sebelumnya kembali ke langkah 1', async () => {
    pasang({ langkahAwal: 2 });
    expect(await screen.findByLabelText(/Nomor kartu/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sebelumnya' }));
    expect(await screen.findByText('Rina Wati')).toBeInTheDocument();
  });

  it('galat memuat draf: pesan dan Coba lagi memuat ulang', async () => {
    balasan.pendataan_khusus_draf_baca = { data: null, error: { message: 'boom' } };
    pasang();
    await lanjut();
    expect((await screen.findByText(/Gagal memuat draf pendataan/)).getAttribute('role')).toBe('alert');
    balasan.pendataan_khusus_draf_baca = { data: null, error: null };
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByLabelText(/Nomor kartu/)).toBeInTheDocument();
  });
});
