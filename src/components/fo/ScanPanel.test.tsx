// @vitest-environment jsdom
// Scan QR (Tahap B, alur Front Office): pindai -> pratinjau (baca kunjungan) -> fo_checkin_reservasi / fo_tolak_reservasi
// -> lanjut ke /admin/fo/penanganan. Tidak ada UPDATE `visit` dari klien. Kamera dimatikan saat berpindah state/unmount (T9).
// Kontrak: docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §2.2, §2.3, §6.4.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within, act } from '@testing-library/react';
import { todayWIB, addDaysWIB } from '@/lib/time';
import { buatH, type FakeH } from '@/test/fo-supabase-mock';

interface PemindaiPalsu {
  start: Mock<(...a: unknown[]) => Promise<void>>;
  stop: Mock<() => Promise<void>>;
  clear: Mock<() => void>;
  saatDekode: ((t: string) => void) | null;
}

const m = vi.hoisted(() => ({
  toast: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  h: null as unknown as FakeH,
  pemindai: [] as PemindaiPalsu[],
  kameraGagal: false,
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push, replace: m.replace }) }));
// Kamera tak tersedia di jsdom: pemindai palsu yang mencatat start/stop/clear dan menyimpan callback dekode.
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    p: PemindaiPalsu;
    constructor() {
      this.p = {
        start: vi.fn((_k: unknown, _c: unknown, saatDekode: unknown) => {
          if (m.kameraGagal) return Promise.reject(new Error('NotAllowedError'));
          this.p.saatDekode = saatDekode as (t: string) => void;
          return Promise.resolve();
        }),
        stop: vi.fn(() => Promise.resolve()),
        clear: vi.fn(),
        saatDekode: null,
      };
      m.pemindai.push(this.p);
    }
    start = (...a: unknown[]) => this.p.start(...a);
    stop = () => this.p.stop();
    clear = () => this.p.clear();
  },
}));
vi.mock('@/lib/supabase/client', async () => {
  const { buatFakeSupabase } = await import('@/test/fo-supabase-mock');
  return { createClient: () => buatFakeSupabase(m.h) };
});

import ScanPanel from './ScanPanel';

const kunjungan = (o: Record<string, unknown> = {}) => ({
  id: 'k-1', nama: 'Budi', tanggal: todayWIB(), status: 'terjadwal', tujuan: 'loket', layanan_saran_id: 'l-1',
  nama_yang_ditemui: null, keperluan: 'Urus NIB', jam_rencana: null, asal_instansi: 'CV Maju', email: 'budi@example.com',
  ...o,
});

function siapkan(k: Record<string, unknown> | null = kunjungan()) {
  m.h.tabel.kunjungan = { data: k ? [k] : [], error: null };
  m.h.tabel.layanan = { data: [{ nama: 'Helpdesk OSS' }], error: null };
}

const hasilCheckin = {
  ok: true, kunjungan_id: 'k-1', penanganan_id: 'pn-1', nama: 'Budi', tanggal: todayWIB(), tujuan: 'loket',
  layanan_saran_id: 'l-1', layanan_saran_nama: 'Helpdesk OSS', nama_yang_ditemui: null, keperluan: 'Urus NIB',
  mulai_at: '2026-10-13T02:00:00.000Z',
};

async function pindaiManual(token = 'tok-1') {
  render(<ScanPanel />);
  const input = await screen.findByLabelText(/masukkan token secara manual/i);
  fireEvent.change(input, { target: { value: token } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

const tombolCheckin = () => screen.findByRole('button', { name: /Check-in & mulai layani/ });

beforeEach(() => {
  m.h = buatH();
  m.toast.mockClear();
  m.push.mockClear();
  m.replace.mockClear();
  m.pemindai.length = 0;
  m.kameraGagal = false;
  siapkan();
});
afterEach(cleanup);

describe('Scan QR: pratinjau reservasi (baca kunjungan, bukan visit)', () => {
  it('membaca kunjungan berdasarkan qr_token + asal reservasi, menampilkan data dan layanan saran', async () => {
    await pindaiManual();

    expect(await screen.findByText('Budi')).toBeInTheDocument();
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    expect(screen.getByText('Urus NIB')).toBeInTheDocument();
    expect(screen.getByText(/CV Maju/)).toBeInTheDocument();

    const kueri = m.h.log.find((l) => l.tabel === 'kunjungan')!;
    expect(kueri.ops.some(([op, a]) => op === 'eq' && a[0] === 'qr_token' && a[1] === 'tok-1')).toBe(true);
    expect(kueri.ops.some(([op, a]) => op === 'eq' && a[0] === 'asal' && a[1] === 'reservasi')).toBe(true);
    expect(m.h.log.some((l) => l.tabel === 'visit')).toBe(false);
  });

  it('QR tidak ditemukan -> "Tidak Ditemukan"', async () => {
    siapkan(null);
    await pindaiManual('tak-ada');
    expect(await screen.findByText('Tidak Ditemukan')).toBeInTheDocument();
  });

  it('galat membaca (jaringan/DB) dibedakan dari "tidak ditemukan"', async () => {
    m.h.tabel.kunjungan = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } };
    await pindaiManual();
    expect(await screen.findByText('Gagal Membaca')).toBeInTheDocument();
    expect(screen.queryByText('Tidak Ditemukan')).toBeNull();
  });

  it('reservasi no_show atau tanggal sudah lewat -> "QR Sudah Hangus" tanpa tombol check-in', async () => {
    siapkan(kunjungan({ status: 'no_show' }));
    await pindaiManual();
    expect(await screen.findByText('QR Sudah Hangus')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Check-in/ })).toBeNull();

    cleanup();
    siapkan(kunjungan({ status: 'terjadwal', tanggal: addDaysWIB(-1) }));
    await pindaiManual();
    expect(await screen.findByText('QR Sudah Hangus')).toBeInTheDocument();
  });

  it('reservasi sudah diproses (bukan terjadwal): peringatan, tanpa check-in maupun tolak', async () => {
    siapkan(kunjungan({ status: 'dilayani' }));
    await pindaiManual();

    expect(await screen.findByText(/sudah diproses/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Check-in/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tolak Pengunjung/ })).toBeNull();
  });

  it('jadwal hari lain: peringatan "bukan hari ini", check-in tidak tersedia tetapi tolak tetap ada', async () => {
    siapkan(kunjungan({ tanggal: addDaysWIB(2) }));
    await pindaiManual();

    expect(await screen.findByText(/bukan hari ini/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Check-in/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Tolak Pengunjung/ })).toBeInTheDocument();
  });

  it('reservasi lama (sudah dilengkapi migrasi WP-24): rincian dari kunjungan; tabel visit (arsip) tidak pernah dibaca', async () => {
    siapkan(kunjungan({ keperluan: 'Pecah NIB', jam_rencana: '09:30:00', legacy_visit_id: 'v-1' }));
    await pindaiManual();

    expect(await screen.findByText('Pecah NIB')).toBeInTheDocument();
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    expect(screen.getByText('09:30 WIB')).toBeInTheDocument();
    expect(m.h.log.some((l) => l.tabel === 'visit')).toBe(false);
    const kueri = m.h.log.find((l) => l.tabel === 'kunjungan')!;
    expect(JSON.stringify(kueri.ops)).not.toContain('legacy_visit_id');
  });
});

describe('Scan QR: check-in (fo_checkin_reservasi)', () => {
  it('check-in memanggil RPC dengan qr_token, tidak menulis tabel apa pun, lalu lanjut ke Penanganan', async () => {
    m.h.rpc = () => ({ data: hasilCheckin, error: null });
    await pindaiManual();
    fireEvent.click(await tombolCheckin());

    await waitFor(() => expect(m.push).toHaveBeenCalledWith('/admin/fo/penanganan'));
    expect(m.h.rpcLog).toEqual([{ nama: 'fo_checkin_reservasi', args: { p_qr_token: 'tok-1' } }]);
    expect(await screen.findByText('Check-in Berhasil')).toBeInTheDocument();
    expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('Budi'), 'success');
    // alur lama (UPDATE visit) tidak boleh dipakai lagi: builder palsu tak punya update(), dan visit tak diubah
    expect(m.h.log.every((l) => l.ops.every(([op]) => op !== 'update'))).toBe(true);
  });

  it('tombol terkunci selama request; klik ganda hanya satu RPC', async () => {
    let selesai: (v: unknown) => void = () => {};
    m.h.rpc = () => new Promise((r) => { selesai = r as (v: unknown) => void; });
    await pindaiManual();
    const tombol = await tombolCheckin();
    fireEvent.click(tombol);
    fireEvent.click(tombol);

    await waitFor(() => expect(tombol).toBeDisabled());
    expect(tombol).toHaveAttribute('aria-busy', 'true');
    expect(m.h.rpcLog).toHaveLength(1);

    selesai({ data: hasilCheckin, error: null });
    await waitFor(() => expect(m.push).toHaveBeenCalledTimes(1));
  });

  it('QR_KEDALUWARSA dari server -> layar "QR Sudah Hangus", tanpa pindah halaman', async () => {
    m.h.rpc = () => ({ data: null, error: { message: 'QR_KEDALUWARSA: reservasi no_show', code: 'P0001' } });
    await pindaiManual();
    fireEvent.click(await tombolCheckin());

    expect(await screen.findByText('QR Sudah Hangus')).toBeInTheDocument();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('INVALID_STATUS: pesan jelas, reservasi dibaca ulang dari server, tidak pindah halaman', async () => {
    m.h.rpc = () => ({ data: null, error: { message: 'INVALID_STATUS: sudah check-in', code: 'P0001' } });
    await pindaiManual();
    fireEvent.click(await tombolCheckin());

    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('Status sudah berubah'), 'error'));
    await waitFor(() => expect(m.h.log.filter((l) => l.tabel === 'kunjungan').length).toBe(2));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Status sudah berubah/);
    expect(m.push).not.toHaveBeenCalled();
  });

  it('BUKAN_HARI_INI dari server dipetakan ke pesan Indonesia', async () => {
    m.h.rpc = () => ({ data: null, error: { message: 'BUKAN_HARI_INI: tanggal mendatang', code: 'P0001' } });
    await pindaiManual();
    fireEvent.click(await tombolCheckin());

    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('dijadwalkan untuk tanggal lain'), 'error'));
  });

  it('galat jaringan: toast tanpa pesan teknis, tanpa pindah halaman, tombol aktif lagi, tanpa baca ulang', async () => {
    m.h.rpc = () => ({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
    await pindaiManual();
    const tombol = await tombolCheckin();
    fireEvent.click(tombol);

    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('Koneksi bermasalah'), 'error'));
    expect(m.toast).not.toHaveBeenCalledWith(expect.stringContaining('Failed to fetch'), 'error');
    expect(m.push).not.toHaveBeenCalled();
    await waitFor(() => expect(tombol).toBeEnabled());
    expect(m.h.log.filter((l) => l.tabel === 'kunjungan')).toHaveLength(1);
  });

  it('SESI_TIDAK_SAH mengarahkan ke login', async () => {
    m.h.rpc = () => ({ data: null, error: { message: 'SESI_TIDAK_SAH: sesi tidak valid', code: '42501' } });
    await pindaiManual();
    fireEvent.click(await tombolCheckin());

    await waitFor(() => expect(m.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?alasan=/)));
  });
});

describe('Scan QR: tolak reservasi (fo_tolak_reservasi)', () => {
  const bukaDialogTolak = async () => {
    await pindaiManual();
    const pemicu = await screen.findByRole('button', { name: /Tolak Pengunjung/ });
    // Efek pasif yang memindahkan fokus ke hasil pindai harus selesai dulu; bila tidak ia merebut fokus dari pemicu
    // (test jadi tidak stabil saat CPU sibuk).
    await act(async () => {});
    pemicu.focus();
    fireEvent.click(pemicu);
    return { pemicu, dialog: await screen.findByRole('dialog') };
  };

  it('dialog aksesibel dengan label terhubung; alasan wajib (minimal 5 karakter) sebelum RPC', async () => {
    const { dialog } = await bukaDialogTolak();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Tolak Budi');
    const alasan = within(dialog).getByLabelText('Alasan penolakan');
    expect(alasan).toHaveFocus();

    fireEvent.change(alasan, { target: { value: 'abc' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tolak pengunjung' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Alasan wajib diisi/);
    expect(alasan).toHaveAttribute('aria-invalid', 'true');
    expect(m.h.rpcLog).toHaveLength(0);
  });

  it('berhasil: memanggil RPC dengan token + alasan ter-trim, menutup dialog, menampilkan "Reservasi Ditolak"', async () => {
    m.h.rpc = () => ({ data: { ok: true, kunjungan_id: 'k-1', status: 'batal' }, error: null });
    const { dialog } = await bukaDialogTolak();

    fireEvent.change(within(dialog).getByLabelText('Alasan penolakan'), { target: { value: '  Identitas tidak sesuai  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tolak pengunjung' }));

    expect(await screen.findByText('Reservasi Ditolak')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(m.h.rpcLog).toEqual([
      { nama: 'fo_tolak_reservasi', args: { p_qr_token: 'tok-1', p_alasan: 'Identitas tidak sesuai' } },
    ]);
    expect(m.push).not.toHaveBeenCalled();
  });

  it('galat kontrak INVALID_STATUS: pesan di dialog, BUKAN "Reservasi Ditolak"; reservasi dibaca ulang', async () => {
    m.h.rpc = () => ({ data: null, error: { message: 'INVALID_STATUS: bukan terjadwal', code: 'P0001' } });
    const { dialog } = await bukaDialogTolak();

    fireEvent.change(within(dialog).getByLabelText('Alasan penolakan'), { target: { value: 'Identitas tidak sesuai' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tolak pengunjung' }));

    expect(await within(dialog).findByText(/Status sudah berubah/)).toBeInTheDocument();
    expect(screen.queryByText('Reservasi Ditolak')).toBeNull();
    await waitFor(() => expect(m.h.log.filter((l) => l.tabel === 'kunjungan').length).toBe(2));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Escape menutup dialog dan fokus kembali ke tombol Tolak Pengunjung', async () => {
    const { pemicu } = await bukaDialogTolak();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pemicu).toHaveFocus();
    expect(m.h.rpcLog).toHaveLength(0);
  });

  it('focus trap: Tab dari tombol terakhir kembali ke tombol tutup, Shift+Tab dari yang pertama ke terakhir', async () => {
    const { dialog } = await bukaDialogTolak();
    const terakhir = within(dialog).getByRole('button', { name: 'Tolak pengunjung' });
    terakhir.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(within(dialog).getByRole('button', { name: 'Tutup dialog' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(terakhir).toHaveFocus();
  });
});

describe('Scan QR: siklus hidup kamera (audit T9)', () => {
  it('kamera menyala saat memindai dan dimatikan (stop + clear) saat halaman ditinggalkan', async () => {
    const { unmount } = render(<ScanPanel />);
    await waitFor(() => expect(m.pemindai).toHaveLength(1));
    await waitFor(() => expect(m.pemindai[0].start).toHaveBeenCalledTimes(1));

    unmount();
    await waitFor(() => expect(m.pemindai[0].stop).toHaveBeenCalledTimes(1));
    expect(m.pemindai[0].clear).toHaveBeenCalledTimes(1);
  });

  it('kamera dimatikan begitu hasil pindai tampil, dan dinyalakan lagi (instans baru) saat Scan Ulang', async () => {
    render(<ScanPanel />);
    await waitFor(() => expect(m.pemindai[0]?.saatDekode).toBeTypeOf('function'));

    await act(async () => { m.pemindai[0].saatDekode!('tok-1'); });
    expect(await screen.findByText('Budi')).toBeInTheDocument();
    await waitFor(() => expect(m.pemindai[0].stop).toHaveBeenCalledTimes(1));
    expect(m.pemindai[0].clear).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Kamera mati')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Scan Pengunjung Lain/ }));
    await waitFor(() => expect(m.pemindai).toHaveLength(2));
    await waitFor(() => expect(m.pemindai[1].start).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/masukkan token secara manual/i)).toHaveFocus();
  });

  it('dekode berulang selagi pencarian berjalan hanya mencari sekali', async () => {
    render(<ScanPanel />);
    await waitFor(() => expect(m.pemindai[0]?.saatDekode).toBeTypeOf('function'));
    const dekode = m.pemindai[0].saatDekode!;

    await act(async () => { dekode('tok-1'); dekode('tok-1'); dekode('tok-1'); });
    await screen.findByText('Budi');
    expect(m.h.log.filter((l) => l.tabel === 'kunjungan')).toHaveLength(1);
  });

  it('kamera gagal (izin ditolak): pesan galat + tombol coba lagi, input manual tetap tersedia', async () => {
    m.kameraGagal = true;
    render(<ScanPanel />);

    expect(await screen.findByText(/Gagal mengakses kamera/)).toBeInTheDocument();
    expect(screen.getByLabelText(/masukkan token secara manual/i)).toBeInTheDocument();

    m.kameraGagal = false;
    fireEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    await waitFor(() => expect(m.pemindai.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryByText(/Gagal mengakses kamera/)).toBeNull());
  });
});
