// @vitest-environment jsdom
// A1 + A3: panel "Sekarang" (tiket saya + tiket berikutnya) dan pintasan papan ketik satu huruf.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import PanelSekarang, { formatDurasiSingkat, type PanelSekarangProps, type TiketPanel } from './PanelSekarang';

afterEach(cleanup);

// 4 November 2026, 10.30 WIB.
const SEKARANG = new Date('2026-11-04T03:30:00Z').getTime();

const tiket = (over: Partial<TiketPanel> = {}): TiketPanel => ({
  id: 't-1',
  nomor_display: 'A-001',
  layananNama: 'Helpdesk OSS',
  namaPengunjung: 'Budi Santoso',
  waktu: '2026-11-04T02:50:00Z', // 09.50 WIB, 40 menit sebelum SEKARANG
  bolehMulai: true,
  bolehSelesai: false,
  ...over,
});

function pasang(over: Partial<PanelSekarangProps> = {}) {
  const props: PanelSekarangProps = {
    sedangDilayani: null,
    berikutnya: tiket(),
    sedangPanggil: () => false,
    sedangProses: () => false,
    onPanggil: vi.fn().mockResolvedValue(true),
    onMulai: vi.fn(),
    onSelesai: vi.fn(),
    sekarang: () => SEKARANG,
    ...over,
  };
  render(<PanelSekarang {...props} />);
  return props;
}

describe('formatDurasiSingkat', () => {
  it('menit, jam, dan di bawah satu menit', () => {
    expect(formatDurasiSingkat(0.4)).toBe('< 1 mnt');
    expect(formatDurasiSingkat(12)).toBe('12 mnt');
    expect(formatDurasiSingkat(60)).toBe('1 j');
    expect(formatDurasiSingkat(65)).toBe('1 j 5 mnt');
    expect(formatDurasiSingkat(-3)).toBe('< 1 mnt');
  });
});

describe('PanelSekarang: isi', () => {
  it('menampilkan tiket berikutnya: nomor, nama, Layanan, jam masuk (WIB), dan lama menunggu', () => {
    pasang();
    const blok = screen.getByRole('group', { name: 'Berikutnya' });
    expect(within(blok).getByText('A-001')).toBeInTheDocument();
    expect(within(blok).getByText('Budi Santoso')).toBeInTheDocument();
    expect(blok).toHaveTextContent('Helpdesk OSS');
    expect(blok).toHaveTextContent('Masuk 09.50');
    expect(blok).toHaveTextContent('Menunggu 40 mnt');
  });

  it('menampilkan tiket yang sedang saya layani dengan durasi berjalan dan tombol Selesai', () => {
    pasang({
      sedangDilayani: tiket({ id: 't-0', nomor_display: 'A-000', namaPengunjung: 'Sari', waktu: '2026-11-04T03:18:00Z', bolehSelesai: true }),
    });
    const blok = screen.getByRole('group', { name: 'Sedang saya layani' });
    expect(within(blok).getByText('A-000')).toBeInTheDocument();
    expect(blok).toHaveTextContent('Berjalan 12 mnt');
    expect(within(blok).getByRole('button', { name: 'Selesai' })).toBeInTheDocument();
  });

  it('keadaan kosong dijelaskan, bukan dikosongkan', () => {
    pasang({ berikutnya: null });
    expect(screen.getByText('Belum ada tiket yang sedang Anda layani.')).toBeInTheDocument();
    expect(screen.getByText('Tidak ada tiket yang menunggu di Layanan ini.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Panggil berikutnya' })).toBeNull();
  });

  it('tanpaTiketSaya (Front Office) menyembunyikan blok "Sedang saya layani"', () => {
    pasang({ tanpaTiketSaya: true });
    expect(screen.queryByRole('group', { name: 'Sedang saya layani' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Berikutnya' })).toBeInTheDocument();
  });

  it('Mulai layanan hanya tampil bila diizinkan (mis. Front Office tidak melayani)', () => {
    pasang({ berikutnya: tiket({ bolehMulai: false }) });
    expect(screen.queryByRole('button', { name: /Mulai layanan/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Panggil berikutnya/ })).toBeInTheDocument();
  });

  it('pemilih Layanan hanya muncul bila ada lebih dari satu Layanan dan memberi tahu pilihan', () => {
    const onLayananChange = vi.fn();
    pasang({
      layananOpsi: [{ id: 'l-1', nama: 'Helpdesk OSS' }, { id: 'l-2', nama: 'BPJS Kesehatan' }],
      layananId: 'l-1',
      onLayananChange,
    });
    fireEvent.change(screen.getByLabelText('Layanan'), { target: { value: 'l-2' } });
    expect(onLayananChange).toHaveBeenCalledWith('l-2');
    cleanup();
    pasang({ layananOpsi: [{ id: 'l-1', nama: 'Helpdesk OSS' }], layananId: 'l-1' });
    expect(screen.queryByLabelText('Layanan')).toBeNull();
  });
});

describe('PanelSekarang: tombol', () => {
  it('Panggil berikutnya memanggil penangan; Panggil ulang aktif hanya sesudah dipanggil; fokus pindah ke Mulai layanan', async () => {
    const props = pasang();
    const ulang = screen.getByRole('button', { name: /Panggil ulang/ });
    expect(ulang).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Panggil berikutnya/ }));
    expect(props.onPanggil).toHaveBeenCalledWith(expect.objectContaining({ id: 't-1' }));
    expect(await screen.findByText('Sudah dipanggil')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Panggil ulang/ })).toBeEnabled());
    await waitFor(() => expect(screen.getByRole('button', { name: /Mulai layanan/ })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: /Panggil ulang/ }));
    expect(props.onPanggil).toHaveBeenCalledTimes(2);
  });

  it('panggilan gagal (penangan mengembalikan false) tidak menandai "Sudah dipanggil"', async () => {
    const props = pasang({ onPanggil: vi.fn().mockResolvedValue(false) });
    fireEvent.click(screen.getByRole('button', { name: /Panggil berikutnya/ }));
    await waitFor(() => expect(props.onPanggil).toHaveBeenCalled());
    expect(screen.queryByText('Sudah dipanggil')).toBeNull();
    expect(screen.getByRole('button', { name: /Panggil ulang/ })).toBeDisabled();
  });

  it('Mulai layanan dan Selesai memanggil penangan masing-masing; terkunci selama diproses', () => {
    const onMulai = vi.fn();
    const onSelesai = vi.fn();
    pasang({
      onMulai,
      onSelesai,
      sedangDilayani: tiket({ id: 't-0', bolehSelesai: true }),
    });
    fireEvent.click(screen.getByRole('button', { name: /Mulai layanan/ }));
    expect(onMulai).toHaveBeenCalledWith(expect.objectContaining({ id: 't-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    expect(onSelesai).toHaveBeenCalledWith(expect.objectContaining({ id: 't-0' }));
    cleanup();
    pasang({ sedangProses: () => true, sedangDilayani: tiket({ id: 't-0', bolehSelesai: true }) });
    expect(screen.getAllByRole('button', { name: /Memproses/ })).toHaveLength(2);
    for (const b of screen.getAllByRole('button', { name: /Memproses/ })) expect(b).toBeDisabled();
  });

  it('tombol Panggil terkunci selama jeda klik ganda (Terpanggil)', () => {
    pasang({ sedangPanggil: () => true });
    expect(screen.getByRole('button', { name: /Terpanggil/ })).toBeDisabled();
  });

  it('label tombol menampilkan huruf pintasan', () => {
    pasang({ sedangDilayani: tiket({ id: 't-0', bolehSelesai: true }) });
    const huruf = Array.from(document.querySelectorAll('kbd')).map((k) => k.textContent);
    expect(huruf).toEqual(expect.arrayContaining(['N', 'U', 'M', 'S']));
    expect(screen.getByRole('button', { name: /Panggil berikutnya/ })).toHaveAttribute('aria-keyshortcuts', 'N');
  });
});

describe('PanelSekarang: pintasan papan ketik (hanya di dalam panel, bukan di isian)', () => {
  it('N memanggil, M memulai, S menyelesaikan, U memanggil ulang sesudah dipanggil', async () => {
    const props = pasang({ sedangDilayani: tiket({ id: 't-0', bolehSelesai: true }) });
    const panggil = screen.getByRole('button', { name: /Panggil berikutnya/ });
    fireEvent.keyDown(panggil, { key: 'u' });
    expect(props.onPanggil).not.toHaveBeenCalled(); // belum dipanggil: U diabaikan
    fireEvent.keyDown(panggil, { key: 'n' });
    expect(props.onPanggil).toHaveBeenCalledTimes(1);
    await screen.findByText('Sudah dipanggil');
    fireEvent.keyDown(panggil, { key: 'U' });
    expect(props.onPanggil).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(panggil, { key: 'm' });
    expect(props.onMulai).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(panggil, { key: 's' });
    expect(props.onSelesai).toHaveBeenCalledTimes(1);
  });

  it('tidak aktif dengan Ctrl/Alt/Meta atau bila sasaran adalah isian', () => {
    const props = pasang({
      sedangDilayani: tiket({ id: 't-0', bolehSelesai: true }),
      layananOpsi: [{ id: 'l-1', nama: 'A' }, { id: 'l-2', nama: 'B' }],
      layananId: 'l-1',
    });
    const panggil = screen.getByRole('button', { name: /Panggil berikutnya/ });
    fireEvent.keyDown(panggil, { key: 'n', ctrlKey: true });
    fireEvent.keyDown(panggil, { key: 'n', altKey: true });
    fireEvent.keyDown(panggil, { key: 'n', metaKey: true });
    // pemilih Layanan adalah <select> di dalam panel: mengetik huruf untuk memilih opsi tidak boleh memicu pintasan
    fireEvent.keyDown(screen.getByLabelText('Layanan'), { key: 'n' });
    fireEvent.keyDown(screen.getByLabelText('Layanan'), { key: 's' });
    expect(props.onPanggil).not.toHaveBeenCalled();
    expect(props.onSelesai).not.toHaveBeenCalled();
  });

  it('tombol di luar panel tidak memicu pintasan', () => {
    const props = pasang();
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(props.onPanggil).not.toHaveBeenCalled();
  });

  it('? membuka dan menutup daftar pintasan', () => {
    pasang();
    const panggil = screen.getByRole('button', { name: /Panggil berikutnya/ });
    expect(screen.queryByRole('region', { name: /Daftar pintasan/ })).toBeNull();
    fireEvent.keyDown(panggil, { key: '?' });
    const daftar = screen.getByRole('region', { name: /Daftar pintasan/ });
    expect(daftar).toHaveTextContent('Panggil berikutnya');
    expect(daftar).toHaveTextContent('Mulai layanan');
    fireEvent.keyDown(panggil, { key: '?' });
    expect(screen.queryByRole('region', { name: /Daftar pintasan/ })).toBeNull();
  });

  it('tombol Pintasan membuka daftar yang sama (jalan lain bagi pengguna papan sentuh)', () => {
    pasang();
    fireEvent.click(screen.getByRole('button', { name: 'Pintasan' }));
    expect(screen.getByRole('region', { name: /Daftar pintasan/ })).toBeInTheDocument();
  });
});
