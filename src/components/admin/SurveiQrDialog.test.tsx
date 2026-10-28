// @vitest-environment jsdom
// Dialog QR Pesan Perilaku untuk staf: token HANYA sebagai QR (tidak pernah teks/tautan), menutup diri tanpa
// menampilkan apa pun bila tidak ada token (kunjungan masih berjalan, sudah diisi, kedaluwarsa), galat RPC singkat.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  env: { NEXT_PUBLIC_PUBLIC_URL: 'https://lmh.example.test' as string | undefined },
}));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: m.rpc }) }));
vi.mock('@/lib/env/client', () => ({ clientEnv: m.env }));
// Kanvas QR tidak berjalan di jsdom: tiruan hanya mengekspos nilai yang akan dikodekan lewat atribut (bukan teks).
vi.mock('@/components/QRCode', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr" data-value={value} />,
}));

import SurveiQrDialog from './SurveiQrDialog';

const TOKEN = 'a1b2'.repeat(16);
const siap = (over: Record<string, unknown> = {}) => ({
  data: {
    status: 'belum_diisi',
    token: TOKEN,
    kedaluwarsa_pada: '2026-10-28T03:30:00+00:00',
    unit: 'layanan',
    layanan_nama: 'Konsultasi OSS',
    ...over,
  },
  error: null,
});

beforeEach(() => {
  m.rpc.mockReset();
  m.env.NEXT_PUBLIC_PUBLIC_URL = 'https://lmh.example.test';
});
afterEach(cleanup);

describe('SurveiQrDialog: token ada', () => {
  it('memanggil ambil_qr_survei, menampilkan QR bernilai /survei/<token>, nama layanan, dan batas waktu WIB', async () => {
    m.rpc.mockResolvedValue(siap());
    render(<SurveiQrDialog kunjunganId="k-1" onTutup={vi.fn()} />);

    const dialog = await screen.findByRole('dialog', { name: 'QR Pesan Perilaku' });
    expect(m.rpc).toHaveBeenCalledWith('ambil_qr_survei', { p_kunjungan_id: 'k-1' });
    expect(screen.getByTestId('qr')).toHaveAttribute('data-value', `https://lmh.example.test/survei/${TOKEN}`);
    expect(dialog).toHaveTextContent('Konsultasi OSS');
    // 2026-10-28T03:30Z = 10.30 WIB.
    expect(dialog).toHaveTextContent(/berlaku sampai 28 Oktober 2026 10[.:]30 WIB/i);
  });

  it('token tidak pernah muncul sebagai teks, tautan, atau nama aksesibel', async () => {
    m.rpc.mockResolvedValue(siap());
    render(<SurveiQrDialog kunjunganId="k-1" onTutup={vi.fn()} />);
    await screen.findByRole('dialog');

    expect(document.body.textContent).not.toContain(TOKEN);
    expect(screen.queryByText(new RegExp(TOKEN))).toBeNull();
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(document.querySelectorAll('input, textarea')).toHaveLength(0);
    // Selain nilai QR (atribut tiruan), tidak ada atribut lain yang memuat token.
    const bocor = Array.from(document.body.querySelectorAll('*')).filter((el) =>
      Array.from(el.attributes).some((a) => a.name !== 'data-value' && a.value.includes(TOKEN)),
    );
    expect(bocor).toHaveLength(0);
  });

  it('origin QR: tanpa NEXT_PUBLIC_PUBLIC_URL memakai window.location.origin', async () => {
    m.env.NEXT_PUBLIC_PUBLIC_URL = undefined;
    m.rpc.mockResolvedValue(siap());
    render(<SurveiQrDialog kunjunganId="k-1" onTutup={vi.fn()} />);
    await screen.findByRole('dialog');
    expect(screen.getByTestId('qr')).toHaveAttribute('data-value', `${window.location.origin}/survei/${TOKEN}`);
  });

  it('garis miring penutup pada NEXT_PUBLIC_PUBLIC_URL tidak menggandakan "/"', async () => {
    m.env.NEXT_PUBLIC_PUBLIC_URL = 'https://lmh.example.test/';
    m.rpc.mockResolvedValue(siap());
    render(<SurveiQrDialog kunjunganId="k-1" onTutup={vi.fn()} />);
    await screen.findByRole('dialog');
    expect(screen.getByTestId('qr')).toHaveAttribute('data-value', `https://lmh.example.test/survei/${TOKEN}`);
  });

  it('tombol Tutup memanggil onTutup', async () => {
    m.rpc.mockResolvedValue(siap());
    const onTutup = vi.fn();
    render(<SurveiQrDialog kunjunganId="k-1" onTutup={onTutup} />);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(onTutup).toHaveBeenCalledTimes(1);
  });
});

describe('SurveiQrDialog: tanpa token menutup diri tanpa menampilkan apa pun', () => {
  it.each([
    ['sudah_diisi', { status: 'sudah_diisi', token: null }],
    ['kedaluwarsa', { status: 'kedaluwarsa', token: null }],
    ['tidak_ada (kunjungan masih berjalan)', { status: 'tidak_ada', token: null, kedaluwarsa_pada: null, unit: null, layanan_nama: null }],
    ['belum_diisi tanpa token (bentuk rusak)', { status: 'belum_diisi', token: null }],
  ])('%s -> onTutup dipanggil, tidak ada dialog maupun QR', async (_nama, over) => {
    m.rpc.mockResolvedValue(siap(over));
    const onTutup = vi.fn();
    render(<SurveiQrDialog kunjunganId="k-1" onTutup={onTutup} />);

    await waitFor(() => expect(onTutup).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('qr')).toBeNull();
    expect(document.body.textContent).toBe('');
  });

  it('selama memuat tidak ada kerangka dialog yang berkedip', async () => {
    let selesai: (v: unknown) => void = () => {};
    m.rpc.mockReturnValue(new Promise((r) => { selesai = r; }));
    render(<SurveiQrDialog kunjunganId="k-1" onTutup={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    selesai(siap());
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('dilepas sebelum RPC selesai: onTutup tidak dipanggil dan tidak ada pembaruan state', async () => {
    let selesai: (v: unknown) => void = () => {};
    m.rpc.mockReturnValue(new Promise((r) => { selesai = r; }));
    const onTutup = vi.fn();
    const { unmount } = render(<SurveiQrDialog kunjunganId="k-1" onTutup={onTutup} />);
    unmount();
    selesai(siap({ status: 'sudah_diisi', token: null }));
    await Promise.resolve();
    await Promise.resolve();
    expect(onTutup).not.toHaveBeenCalled();
  });
});

describe('SurveiQrDialog: galat', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const tampilGalat = async (onTutup: () => void) => {
    render(<SurveiQrDialog kunjunganId="k-1" onTutup={onTutup} />);
    const dialog = await screen.findByRole('dialog', { name: 'QR Pesan Perilaku' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/belum dapat dimuat/i);
    return dialog;
  };

  it('galat RPC (objek error) -> pesan singkat dengan tombol Tutup; tanpa QR', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN: tidak berwenang', code: '42501' } });
    const onTutup = vi.fn();
    await tampilGalat(onTutup);
    expect(screen.queryByTestId('qr')).toBeNull();
    // Pesan teknis server tidak diteruskan ke staf.
    expect(document.body.textContent).not.toContain('FORBIDDEN');
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(onTutup).toHaveBeenCalledTimes(1);
  });

  it('RPC menolak (jaringan putus) -> pesan galat yang sama, tanpa penolakan tak tertangani', async () => {
    m.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    await tampilGalat(vi.fn());
  });

  it('bentuk balasan tak dikenal -> pesan galat', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'aneh' }, error: null });
    await tampilGalat(vi.fn());
  });
});
