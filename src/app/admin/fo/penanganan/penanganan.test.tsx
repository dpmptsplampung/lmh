// @vitest-environment jsdom
// Penanganan (FO, Tahap B): daftar tahap FO `berjalan` + riwayat hari ini WIB, form selesai (topik + catatan wajib,
// penghitung), dialog eskalasi (pra-pilih layanan saran, nomor tiket, peringatan petugas_hadir=false), a11y dialog.
// Kontrak: docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §2.4, §2.5, §6.2.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { buatH, punyaOp, type FakeH, type Op } from '@/test/fo-supabase-mock';

const m = vi.hoisted(() => ({
  toast: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  realtime: vi.fn(),
  h: null as unknown as FakeH,
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push, replace: m.replace }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: m.realtime }));
vi.mock('@/lib/supabase/client', async () => {
  const { buatFakeSupabase } = await import('@/test/fo-supabase-mock');
  return { createClient: () => buatFakeSupabase(m.h) };
});
// Kanvas QR tidak berjalan di jsdom: tiruan mengekspos nilai yang dikodekan lewat atribut (bukan teks).
vi.mock('@/components/QRCode', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr" data-value={value} />,
}));

import PenangananFoPage from './page';

const TOPIK = [
  { id: 't-1', nama: 'Informasi perizinan/syarat', urut: 1 },
  { id: 't-2', nama: 'Lainnya', urut: 99 },
];
const LAYANAN = [
  { id: 'l-1', nama: 'Helpdesk OSS', prefiks_antrean: 'OS', status_tampilan: 'aktif' },
  { id: 'l-2', nama: 'Bank Lampung', prefiks_antrean: 'BL', status_tampilan: 'aktif' },
  { id: 'l-3', nama: 'Layanan Mati', prefiks_antrean: 'LM', status_tampilan: 'nonaktif' },
];
const berjalan = (o: Record<string, unknown> = {}) => ({
  id: 'pn-1', kunjungan_id: 'k-1', tahap_ke: 1, peran_tahap: 'fo', layanan_id: null, saluran: 'walk_in', tiket_id: null,
  status: 'berjalan', mulai_at: '2026-10-13T02:30:00.000Z', penangan_id: 'p-saya', penangan: { nama: 'Saya FO' },
  kunjungan: { nama: 'Budi Santoso', asal_instansi: 'CV Maju', keperluan: 'Urus NIB', layanan_saran_id: null },
  ...o,
});

interface Skenario { berjalan?: unknown[]; riwayat?: unknown[]; tiket?: unknown[] }

function siapkan({ berjalan: dataBerjalan = [berjalan()], riwayat = [], tiket = [] }: Skenario = {}) {
  m.h.tabel.petugas = { data: [{ id: 'p-saya' }], error: null };
  m.h.tabel.penanganan = (ops: Op[]) =>
    punyaOp(ops, 'eq', 'status', 'berjalan') ? { data: dataBerjalan, error: null } : { data: riwayat, error: null };
  m.h.tabel.tiket_antrean = { data: tiket, error: null };
  m.h.tabel.topik_penanganan = { data: TOPIK, error: null };
  m.h.tabel.layanan = { data: LAYANAN, error: null };
}

const TOKEN_SURVEI = 'd4e5'.repeat(16);
const hasilSelesaiFo = { ok: true, penanganan_id: 'pn-1', kunjungan_id: 'k-1', kunjungan_status: 'selesai', selesai_at: '2026-10-13T03:00:00.000Z' };
const qrBelumDiisi = {
  data: { status: 'belum_diisi', token: TOKEN_SURVEI, kedaluwarsa_pada: '2026-10-14T11:00:00.000Z', unit: 'fo', layanan_nama: null },
  error: null,
};

const hasilEskalasi = (o: Record<string, unknown> = {}) => ({
  ok: true, kunjungan_id: 'k-1', penanganan_fo_id: 'pn-1', penanganan_layanan_id: 'pn-2', tiket_id: 'tk-1',
  nomor_display: 'OS-014', layanan_id: 'l-1', layanan_nama: 'Helpdesk OSS', petugas_hadir: true, notifikasi_diantrekan: 2, ...o,
});

beforeEach(() => {
  m.h = buatH();
  m.toast.mockClear();
  m.push.mockClear();
  m.replace.mockClear();
  m.realtime.mockClear();
});
afterEach(cleanup);

async function bukaFormSelesai() {
  fireEvent.click(await screen.findByRole('button', { name: 'Selesaikan penanganan Budi Santoso' }));
  return screen.findByRole('form', { name: /Selesaikan penanganan Budi Santoso/ });
}

describe('Penanganan: memuat data', () => {
  it('menampilkan penanganan berjalan milik saya (hanya tahap FO) dan memasang realtime', async () => {
    siapkan();
    render(<PenangananFoPage />);

    expect(await screen.findByRole('heading', { name: 'Budi Santoso' })).toBeInTheDocument();
    expect(screen.getByText(/CV Maju/)).toBeInTheDocument();
    expect(screen.getByText(/Urus NIB/)).toBeInTheDocument();
    expect(screen.getByText('Walk-in')).toBeInTheDocument();

    const kueri = m.h.log.find((l) => l.tabel === 'penanganan' && punyaOp(l.ops, 'eq', 'status', 'berjalan'))!;
    // Tahap berjalan = operasional (semua FO): kueri tidak dibatasi ke penangan sendiri; dipisah di klien.
    expect(kueri.ops.some(([op, a]) => op === 'eq' && a[0] === 'penangan_id')).toBe(false);
    expect(punyaOp(kueri.ops, 'eq', 'peran_tahap', 'fo')).toBe(true);
    expect(m.realtime).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ table: 'penanganan' }));
  });

  it('riwayat hari ini difilter mulai awal hari WIB (00:00 +07:00 = 17:00 UTC hari sebelumnya)', async () => {
    siapkan();
    render(<PenangananFoPage />);
    await screen.findByRole('heading', { name: 'Budi Santoso' });

    const kueri = m.h.log.find((l) => l.tabel === 'penanganan' && !punyaOp(l.ops, 'eq', 'status', 'berjalan'))!;
    const gte = kueri.ops.find(([op, a]) => op === 'gte' && a[0] === 'mulai_at')!;
    expect(String(gte[1][1])).toMatch(/T17:00:00\.000Z$/);
    // Fase 3 (ADR 0003): FO biasa hanya riwayat miliknya sendiri.
    expect(punyaOp(kueri.ops, 'eq', 'penangan_id', 'p-saya')).toBe(true);
    expect(screen.getByRole('heading', { name: /Riwayat hari ini \(milik Anda\)/ })).toBeInTheDocument();
  });

  it('Koordinator FO: riwayat hari ini semua Front Office (tanpa filter penangan)', async () => {
    siapkan();
    m.h.tabel.petugas = (ops: Op[]) =>
      punyaOp(ops, 'select', 'koordinator')
        ? { data: [{ koordinator: true }], error: null }
        : { data: [{ id: 'p-saya', role: 'front_office' }], error: null };
    render(<PenangananFoPage />);
    expect(await screen.findByRole('heading', { name: /Riwayat hari ini \(semua Front Office\)/ })).toBeInTheDocument();
    const kueri = m.h.log.find((l) => l.tabel === 'penanganan' && !punyaOp(l.ops, 'eq', 'status', 'berjalan'))!;
    expect(kueri.ops.some(([op, a]) => op === 'eq' && a[0] === 'penangan_id')).toBe(false);
  });

  it('tahap FO lain tampil di seksi baca-saja dengan nama FO, tanpa tombol aksi; riwayat semua FO berkolom FO', async () => {
    siapkan({
      berjalan: [
        berjalan(),
        berjalan({
          id: 'pn-9', kunjungan_id: 'k-9', penangan_id: 'p-lain', penangan: { nama: 'Bayu FO' },
          kunjungan: { nama: 'Dewi Lestari', asal_instansi: null, keperluan: null, layanan_saran_id: null },
        }),
      ],
      riwayat: [
        {
          id: 'r-1', kunjungan_id: 'k-2', tahap_ke: 1, saluran: 'walk_in', status: 'selesai', hasil: 'selesai',
          topik: 'Lainnya', catatan: 'Milik saya', mulai_at: '2026-10-13T01:00:00.000Z', selesai_at: '2026-10-13T01:10:00.000Z',
          penangan_id: 'p-saya', penangan: { nama: 'Saya FO' }, kunjungan: { nama: 'Ani', asal_instansi: null },
        },
        {
          id: 'r-2', kunjungan_id: 'k-3', tahap_ke: 1, saluran: 'qr', status: 'selesai', hasil: 'selesai',
          topik: 'Lainnya', catatan: 'Milik FO lain', mulai_at: '2026-10-13T00:30:00.000Z', selesai_at: '2026-10-13T00:35:00.000Z',
          penangan_id: 'p-lain', penangan: [{ nama: 'Bayu FO' }], kunjungan: { nama: 'Candra', asal_instansi: null },
        },
      ],
    });
    render(<PenangananFoPage />);

    // Milik sendiri: kartu dengan tombol aksi. Milik FO lain: tabel baca-saja.
    expect(await screen.findByRole('heading', { name: 'Budi Santoso' })).toBeInTheDocument();
    const lain = screen.getByRole('table', { name: /ditangani Front Office lain/ });
    expect(within(lain).getByText('Dewi Lestari')).toBeInTheDocument();
    expect(within(lain).getByText('Bayu FO')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dewi Lestari/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Dewi Lestari' })).toBeNull();

    const riwayat = screen.getByRole('table', { name: /Riwayat penanganan/ });
    expect(within(riwayat).getByRole('columnheader', { name: 'Front Office' })).toBeInTheDocument();
    expect(within(riwayat).getByText('Anda')).toBeInTheDocument();
    expect(within(riwayat).getByText('Bayu FO')).toBeInTheDocument();
  });

  it('riwayat hasil eskalasi menampilkan email yang dilengkapi petugas layanan dan status layanan selesai (identitas satu kesatuan)', async () => {
    siapkan({
      riwayat: [
        {
          id: 'r-9', kunjungan_id: 'k-9', tahap_ke: 1, saluran: 'walk_in', status: 'selesai', hasil: 'dieskalasi',
          topik: 'Informasi perizinan/syarat', catatan: 'Ke OSS', mulai_at: '2026-10-13T01:00:00.000Z', selesai_at: '2026-10-13T01:10:00.000Z',
          penangan_id: 'p-saya', penangan: { nama: 'Saya FO' }, kunjungan: { nama: 'Dewi', asal_instansi: 'PT Maju', email: 'dewi@majujaya.id' },
        },
        {
          id: 'r-8', kunjungan_id: 'k-8', tahap_ke: 1, saluran: 'walk_in', status: 'selesai', hasil: 'selesai',
          topik: 'Lainnya', catatan: 'Selesai di FO', mulai_at: '2026-10-13T00:30:00.000Z', selesai_at: '2026-10-13T00:35:00.000Z',
          penangan_id: 'p-saya', penangan: { nama: 'Saya FO' }, kunjungan: { nama: 'Tamu Cepat', asal_instansi: null, email: null },
        },
      ],
      tiket: [{ penanganan_asal_id: 'r-9', nomor_display: 'OS-021', layanan_id: 'l-1', status: 'selesai' }],
    });
    render(<PenangananFoPage />);
    const riwayat = await screen.findByRole('table', { name: /Riwayat penanganan/ });
    expect(await within(riwayat).findByText('Email: dewi@majujaya.id')).toBeInTheDocument();
    expect(within(riwayat).getByText(/Dieskalasi → OS-021 \(Helpdesk OSS\) · layanan selesai/)).toBeInTheDocument();
    // Selesai di FO tanpa email: tidak ada baris email dan tidak ada keterangan layanan.
    expect(within(riwayat).getAllByText(/Email:/)).toHaveLength(1);
    expect(within(riwayat).getAllByText('Selesai di FO').length).toBeGreaterThan(0);
  });

  it('Koordinator FO (Fase 3): tombol Ambil alih pada tahap FO lain (bukan chat) memanggil koordinator_ambil_alih_fo', async () => {
    siapkan({
      berjalan: [
        berjalan({
          id: 'pn-9', kunjungan_id: 'k-9', penangan_id: 'p-lain', penangan: { nama: 'Bayu FO' },
          kunjungan: { nama: 'Dewi Lestari', asal_instansi: null, keperluan: null, layanan_saran_id: null },
        }),
        berjalan({
          id: 'pn-8', kunjungan_id: 'k-8', penangan_id: 'p-lain', saluran: 'chat', penangan: { nama: 'Bayu FO' },
          kunjungan: { nama: 'Eka Chat', asal_instansi: null, keperluan: null, layanan_saran_id: null },
        }),
      ],
    });
    m.h.tabel.petugas = (ops: Op[]) =>
      punyaOp(ops, 'select', 'koordinator')
        ? { data: [{ koordinator: true }], error: null }
        : { data: [{ id: 'p-saya', role: 'front_office' }], error: null };
    m.h.rpc = () => ({ data: { ok: true }, error: null });
    render(<PenangananFoPage />);
    const tombol = await screen.findByRole('button', { name: 'Ambil alih penanganan Dewi Lestari' });
    expect(screen.queryByRole('button', { name: 'Ambil alih penanganan Eka Chat' })).toBeNull();
    expect(screen.getByText('Live chat: tidak dapat diambil alih')).toBeInTheDocument();
    fireEvent.click(tombol);
    const dialog = await screen.findByRole('dialog', { name: /Ambil alih penanganan Dewi Lestari/ });
    fireEvent.change(within(dialog).getByLabelText(/Alasan ambil alih/i), { target: { value: 'FO pulang mendadak' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Ambil alih$/ }));
    await waitFor(() => expect(m.h.rpcLog).toContainEqual({
      nama: 'koordinator_ambil_alih_fo', args: { p_penanganan_id: 'pn-9', p_alasan: 'FO pulang mendadak' },
    }));
  });

  it('FO biasa (bukan Koordinator): tanpa kolom Aksi pada tahap FO lain', async () => {
    siapkan({
      berjalan: [berjalan({ id: 'pn-9', penangan_id: 'p-lain', penangan: { nama: 'Bayu FO' },
        kunjungan: { nama: 'Dewi Lestari', asal_instansi: null, keperluan: null, layanan_saran_id: null } })],
    });
    render(<PenangananFoPage />);
    await screen.findByText('Dewi Lestari');
    expect(screen.queryByRole('button', { name: /Ambil alih/ })).toBeNull();
  });

  it('tanpa FO lain yang sedang menangani: pesan kosong pada seksi FO lain', async () => {
    siapkan();
    render(<PenangananFoPage />);
    await screen.findByRole('heading', { name: 'Budi Santoso' });
    expect(screen.getByText(/Tidak ada pengunjung yang sedang ditangani Front Office lain/)).toBeInTheDocument();
  });

  it('riwayat memuat nomor tiket hasil eskalasi, hasil selesai di FO, dan topik/catatan', async () => {
    siapkan({
      berjalan: [],
      riwayat: [
        {
          id: 'r-1', kunjungan_id: 'k-2', tahap_ke: 1, saluran: 'qr', status: 'selesai', hasil: 'dieskalasi',
          topik: 'Informasi perizinan/syarat', catatan: 'Tanya NIB', mulai_at: '2026-10-13T01:00:00.000Z',
          selesai_at: '2026-10-13T01:10:00.000Z', kunjungan: { nama: 'Ani', asal_instansi: null },
        },
        {
          id: 'r-2', kunjungan_id: 'k-3', tahap_ke: 1, saluran: 'walk_in', status: 'selesai', hasil: 'selesai',
          topik: 'Lainnya', catatan: 'Tanya jam buka', mulai_at: '2026-10-13T00:30:00.000Z',
          selesai_at: '2026-10-13T00:35:00.000Z', kunjungan: { nama: 'Candra', asal_instansi: null },
        },
      ],
      tiket: [{ penanganan_asal_id: 'r-1', nomor_display: 'OS-014', layanan_id: 'l-1' }],
    });
    render(<PenangananFoPage />);

    const tabel = await screen.findByRole('table', { name: /Riwayat penanganan/ });
    expect(within(tabel).getByText(/Dieskalasi → OS-014 \(Helpdesk OSS\)/)).toBeInTheDocument();
    expect(within(tabel).getByText('Selesai di FO')).toBeInTheDocument();
    expect(within(tabel).getByText('Tanya NIB')).toBeInTheDocument();
    expect(screen.getByText(/Belum ada pengunjung yang sedang Anda tangani/)).toBeInTheDocument();
  });
});

describe('Penanganan: form selesai (fo_selesai)', () => {
  it('topik dan catatan wajib: submit kosong menolak tanpa memanggil RPC, dengan pesan terhubung ke isian', async () => {
    siapkan();
    render(<PenangananFoPage />);
    const form = await bukaFormSelesai();

    fireEvent.click(within(form).getByRole('button', { name: 'Selesaikan penanganan' }));
    const topik = within(form).getByLabelText('Topik');
    expect(within(form).getByRole('alert')).toHaveTextContent('Topik wajib dipilih');
    expect(topik).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(topik, { target: { value: 't-1' } });
    fireEvent.change(within(form).getByLabelText('Catatan singkat'), { target: { value: '   ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Selesaikan penanganan' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Catatan singkat wajib diisi');
    expect(m.h.rpcLog).toHaveLength(0);
  });

  it('penghitung karakter mengikuti ketikan dan catatan dibatasi 200 karakter', async () => {
    siapkan();
    render(<PenangananFoPage />);
    const form = await bukaFormSelesai();

    const catatan = within(form).getByLabelText('Catatan singkat');
    expect(catatan).toHaveAttribute('maxlength', '200');
    expect(within(form).getByText('0/200')).toBeInTheDocument();
    fireEvent.change(catatan, { target: { value: 'Tanya syarat NIB' } });
    expect(within(form).getByText('16/200')).toBeInTheDocument();
  });

  it('berhasil: memanggil fo_selesai dengan catatan ter-trim, menampilkan pemberitahuan, dan memuat ulang', async () => {
    siapkan();
    m.h.rpc = (nama) => (nama === 'ambil_qr_survei' ? qrBelumDiisi : { data: hasilSelesaiFo, error: null });
    render(<PenangananFoPage />);
    const form = await bukaFormSelesai();

    fireEvent.change(within(form).getByLabelText('Topik'), { target: { value: 't-1' } });
    fireEvent.change(within(form).getByLabelText('Catatan singkat'), { target: { value: '  Tanya syarat NIB  ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Selesaikan penanganan' }));

    expect(await screen.findByText(/Penanganan Budi Santoso selesai dicatat/)).toBeInTheDocument();
    expect(m.h.rpcLog[0]).toEqual(
      { nama: 'fo_selesai', args: { p_penanganan_id: 'pn-1', p_topik_id: 't-1', p_catatan: 'Tanya syarat NIB' } },
    );
    expect(screen.queryByRole('form', { name: /Selesaikan penanganan/ })).toBeNull();
  });

  it('berhasil: dialog QR Pesan Perilaku dibuka untuk kunjungan_id hasil fo_selesai (token hanya sebagai QR)', async () => {
    siapkan();
    m.h.rpc = (nama) => (nama === 'ambil_qr_survei' ? qrBelumDiisi : { data: hasilSelesaiFo, error: null });
    render(<PenangananFoPage />);
    const form = await bukaFormSelesai();
    fireEvent.change(within(form).getByLabelText('Topik'), { target: { value: 't-1' } });
    fireEvent.change(within(form).getByLabelText('Catatan singkat'), { target: { value: 'Tanya syarat NIB' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Selesaikan penanganan' }));

    const dialog = await screen.findByRole('dialog', { name: 'QR Pesan Perilaku' });
    expect(m.h.rpcLog.filter((r) => r.nama === 'ambil_qr_survei')).toEqual([
      { nama: 'ambil_qr_survei', args: { p_kunjungan_id: 'k-1' } },
    ]);
    expect(within(dialog).getByTestId('qr').getAttribute('data-value')).toMatch(new RegExp(`/survei/${TOKEN_SURVEI}$`));
    expect(document.body.textContent).not.toContain(TOKEN_SURVEI);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Tutup' }));
    expect(screen.queryByRole('dialog', { name: 'QR Pesan Perilaku' })).toBeNull();
    // Pemberitahuan penyelesaian tetap ada setelah dialog ditutup.
    expect(screen.getByText(/Penanganan Budi Santoso selesai dicatat/)).toBeInTheDocument();
  });

  it('berhasil tetapi tanpa token (undangan belum ada): dialog menutup diri tanpa tampil', async () => {
    siapkan();
    m.h.rpc = (nama) => (nama === 'ambil_qr_survei'
      ? { data: { status: 'tidak_ada', token: null, kedaluwarsa_pada: null, unit: null, layanan_nama: null }, error: null }
      : { data: hasilSelesaiFo, error: null });
    render(<PenangananFoPage />);
    const form = await bukaFormSelesai();
    fireEvent.change(within(form).getByLabelText('Topik'), { target: { value: 't-1' } });
    fireEvent.change(within(form).getByLabelText('Catatan singkat'), { target: { value: 'Tanya syarat NIB' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Selesaikan penanganan' }));

    expect(await screen.findByText(/Penanganan Budi Santoso selesai dicatat/)).toBeInTheDocument();
    await waitFor(() => expect(m.h.rpcLog.some((r) => r.nama === 'ambil_qr_survei')).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('qr')).toBeNull();
  });

  it('galat server (TOPIK_TIDAK_VALID) dipetakan ke pesan Indonesia pada isian topik; form tetap terbuka', async () => {
    siapkan();
    m.h.rpc = () => ({ data: null, error: { message: 'TOPIK_TIDAK_VALID: topik bukan topik FO aktif', code: '22023' } });
    render(<PenangananFoPage />);
    const form = await bukaFormSelesai();

    fireEvent.change(within(form).getByLabelText('Topik'), { target: { value: 't-1' } });
    fireEvent.change(within(form).getByLabelText('Catatan singkat'), { target: { value: 'ok' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Selesaikan penanganan' }));

    expect(await within(form).findByText(/Topik yang dipilih tidak berlaku/)).toBeInTheDocument();
    expect(screen.queryByText(/dicatat/)).toBeNull();
  });

  it('galat BUKAN_PEMILIK: pesan jelas dan data dimuat ulang', async () => {
    siapkan();
    m.h.rpc = () => ({ data: null, error: { message: 'BUKAN_PEMILIK: bukan penangan tahap ini', code: '42501' } });
    render(<PenangananFoPage />);
    const form = await bukaFormSelesai();
    const sebelum = m.h.log.length;

    fireEvent.change(within(form).getByLabelText('Topik'), { target: { value: 't-1' } });
    fireEvent.change(within(form).getByLabelText('Catatan singkat'), { target: { value: 'ok' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Selesaikan penanganan' }));

    expect(await within(form).findByText(/dipegang Front Office lain/)).toBeInTheDocument();
    await waitFor(() => expect(m.h.log.length).toBeGreaterThan(sebelum));
  });

  it('tombol terkunci selama request (tanpa klik ganda) dan aktif kembali setelah galat', async () => {
    siapkan();
    let selesai: (v: unknown) => void = () => {};
    m.h.rpc = () => new Promise((r) => { selesai = r as (v: unknown) => void; });
    render(<PenangananFoPage />);
    const form = await bukaFormSelesai();

    fireEvent.change(within(form).getByLabelText('Topik'), { target: { value: 't-2' } });
    fireEvent.change(within(form).getByLabelText('Catatan singkat'), { target: { value: 'Tanya jam buka' } });
    const kirim = within(form).getByRole('button', { name: 'Selesaikan penanganan' });
    fireEvent.click(kirim);
    fireEvent.submit(form);

    const sibuk = await within(form).findByRole('button', { name: /Menyimpan/ });
    expect(sibuk).toBeDisabled();
    expect(within(form).getByLabelText('Topik')).toBeDisabled();
    expect(m.h.rpcLog).toHaveLength(1);

    selesai({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
    expect(await within(form).findByRole('alert')).toHaveTextContent(/Koneksi bermasalah/);
    expect(within(form).getByRole('button', { name: 'Selesaikan penanganan' })).toBeEnabled();
  });

  it('Batal menutup form dan mengembalikan fokus ke tombol Selesaikan', async () => {
    siapkan();
    render(<PenangananFoPage />);
    const form = await bukaFormSelesai();
    fireEvent.click(within(form).getByRole('button', { name: 'Batal' }));

    const tombol = await screen.findByRole('button', { name: 'Selesaikan penanganan Budi Santoso' });
    await waitFor(() => expect(tombol).toHaveFocus());
  });
});

describe('Penanganan: dialog eskalasi (fo_eskalasi)', () => {
  const bukaDialog = async () => {
    const pemicu = await screen.findByRole('button', { name: 'Eskalasi Budi Santoso ke layanan' });
    pemicu.focus();
    fireEvent.click(pemicu);
    return { pemicu, dialog: await screen.findByRole('dialog') };
  };

  it('dialog aksesibel: berlabel judul, modal, hanya layanan aktif ber-antrean (nonaktif tersaring)', async () => {
    siapkan();
    render(<PenangananFoPage />);
    const { dialog } = await bukaDialog();

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Eskalasi Budi Santoso');
    const pilihan = within(within(dialog).getByLabelText('Layanan tujuan')).getAllByRole('option').map((o) => o.textContent);
    expect(pilihan).toEqual(['Pilih layanan…', 'Helpdesk OSS (OS)', 'Bank Lampung (BL)']);

    const kueriLayanan = m.h.log.find((l) => l.tabel === 'layanan')!;
    expect(punyaOp(kueriLayanan.ops, 'eq', 'aktif', true)).toBe(true);
    expect(punyaOp(kueriLayanan.ops, 'eq', 'punya_antrean', true)).toBe(true);
  });

  it('layanan saran dari reservasi (layanan_saran_id) pra-dipilih beserta keterangannya', async () => {
    siapkan({
      berjalan: [berjalan({ saluran: 'qr', kunjungan: { nama: 'Budi Santoso', asal_instansi: 'CV Maju', keperluan: 'Urus NIB', layanan_saran_id: 'l-2' } })],
    });
    render(<PenangananFoPage />);
    const { dialog } = await bukaDialog();

    expect(within(dialog).getByLabelText('Layanan tujuan')).toHaveValue('l-2');
    expect(within(dialog).getByText(/Disarankan dari reservasi pengunjung: Bank Lampung/)).toBeInTheDocument();
  });

  it('tanpa saran: layanan belum dipilih; submit tanpa layanan/topik/catatan ditolak sebelum RPC', async () => {
    siapkan();
    render(<PenangananFoPage />);
    const { dialog } = await bukaDialog();

    expect(within(dialog).getByLabelText('Layanan tujuan')).toHaveValue('');
    fireEvent.click(within(dialog).getByRole('button', { name: /Eskalasi & terbitkan nomor/ }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Pilih layanan tujuan eskalasi');

    fireEvent.change(within(dialog).getByLabelText('Layanan tujuan'), { target: { value: 'l-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Eskalasi & terbitkan nomor/ }));
    expect(within(dialog).getByText(/Topik wajib dipilih/)).toBeInTheDocument();
    expect(m.h.rpcLog).toHaveLength(0);
  });

  it('berhasil: menampilkan nomor tiket (OS-014); petugas hadir = tanpa peringatan', async () => {
    siapkan();
    m.h.rpc = () => ({ data: hasilEskalasi(), error: null });
    render(<PenangananFoPage />);
    const { dialog } = await bukaDialog();

    fireEvent.change(within(dialog).getByLabelText('Layanan tujuan'), { target: { value: 'l-1' } });
    fireEvent.change(within(dialog).getByLabelText('Topik'), { target: { value: 't-1' } });
    fireEvent.change(within(dialog).getByLabelText('Catatan singkat'), { target: { value: 'Butuh bantuan akun OSS' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Eskalasi & terbitkan nomor/ }));

    expect(await screen.findByTestId('nomor-tiket')).toHaveTextContent('OS-014');
    expect(screen.getByText(/dieskalasi ke Helpdesk OSS/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(m.h.rpcLog).toEqual([
      {
        nama: 'fo_eskalasi',
        args: { p_penanganan_id: 'pn-1', p_layanan_id: 'l-1', p_topik_id: 't-1', p_catatan: 'Butuh bantuan akun OSS' },
      },
    ]);
  });

  it('petugas_hadir = false: peringatan (bukan galat) tampil bersama nomor tiket', async () => {
    siapkan();
    m.h.rpc = () => ({ data: hasilEskalasi({ petugas_hadir: false, nomor_display: 'BL-003', layanan_nama: 'Bank Lampung' }), error: null });
    render(<PenangananFoPage />);
    const { dialog } = await bukaDialog();

    fireEvent.change(within(dialog).getByLabelText('Layanan tujuan'), { target: { value: 'l-2' } });
    fireEvent.change(within(dialog).getByLabelText('Topik'), { target: { value: 't-2' } });
    fireEvent.change(within(dialog).getByLabelText('Catatan singkat'), { target: { value: 'Tanya kredit UMKM' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Eskalasi & terbitkan nomor/ }));

    expect(await screen.findByTestId('nomor-tiket')).toHaveTextContent('BL-003');
    expect(screen.getByRole('alert')).toHaveTextContent(/belum ada petugas Bank Lampung yang absen hadir/);
    expect(m.toast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('galat layanan (LAYANAN_TUTUP) tampil di dialog yang tetap terbuka agar bisa memilih layanan lain', async () => {
    siapkan();
    m.h.rpc = () => ({ data: null, error: { message: 'LAYANAN_TUTUP: layanan sudah tutup', code: 'P0001' } });
    render(<PenangananFoPage />);
    const { dialog } = await bukaDialog();

    fireEvent.change(within(dialog).getByLabelText('Layanan tujuan'), { target: { value: 'l-1' } });
    fireEvent.change(within(dialog).getByLabelText('Topik'), { target: { value: 't-1' } });
    fireEvent.change(within(dialog).getByLabelText('Catatan singkat'), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Eskalasi & terbitkan nomor/ }));

    expect(await within(dialog).findByText(/Layanan sudah tutup sehingga eskalasi tidak dapat dilakukan/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Layanan tujuan')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId('nomor-tiket')).toBeNull();
  });

  it('Escape menutup dialog dan fokus kembali ke tombol pemicu', async () => {
    siapkan();
    render(<PenangananFoPage />);
    const { pemicu } = await bukaDialog();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pemicu).toHaveFocus();
  });

  it('fokus awal ke isian pertama dialog; Tab dari elemen terakhir berputar ke yang pertama (focus trap), Shift+Tab sebaliknya', async () => {
    siapkan();
    render(<PenangananFoPage />);
    const { dialog } = await bukaDialog();

    const layanan = within(dialog).getByLabelText('Layanan tujuan');
    expect(layanan).toHaveFocus();

    const tombolKirim = within(dialog).getByRole('button', { name: /Eskalasi & terbitkan nomor/ });
    tombolKirim.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(within(dialog).getByRole('button', { name: 'Tutup dialog' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(tombolKirim).toHaveFocus();
  });

  it('selama request: Escape diabaikan, tombol Batal/Tutup/Eskalasi terkunci', async () => {
    siapkan();
    let selesai: (v: unknown) => void = () => {};
    m.h.rpc = () => new Promise((r) => { selesai = r as (v: unknown) => void; });
    render(<PenangananFoPage />);
    const { dialog } = await bukaDialog();

    fireEvent.change(within(dialog).getByLabelText('Layanan tujuan'), { target: { value: 'l-1' } });
    fireEvent.change(within(dialog).getByLabelText('Topik'), { target: { value: 't-1' } });
    fireEvent.change(within(dialog).getByLabelText('Catatan singkat'), { target: { value: 'ok' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Eskalasi & terbitkan nomor/ }));
    fireEvent.submit(dialog.querySelector('form')!);

    await within(dialog).findByRole('button', { name: /Mengeskalasi/ });
    expect(within(dialog).getByRole('button', { name: /Mengeskalasi/ })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Batal' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Tutup dialog' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(m.h.rpcLog).toHaveLength(1);

    selesai({ data: hasilEskalasi(), error: null });
    expect(await screen.findByTestId('nomor-tiket')).toHaveTextContent('OS-014');
  });
});
