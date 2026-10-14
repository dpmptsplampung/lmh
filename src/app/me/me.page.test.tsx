// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createClientMock, rpcMock, toastMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  rpcMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({ createClient: createClientMock }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/components/QRCode', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr">{value}</div>,
}));
vi.mock('@/lib/site-settings', () => ({
  getSiteSettings: vi.fn().mockResolvedValue({ wa_number: '6281', wa_default_message: 'halo' }),
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

import MeDashboard from './page';
import { todayWIB, addDaysWIB } from '@/lib/time';

describe('/me (dashboard pengunjung) membaca kunjungan, bukan visit', () => {
  const tabel: string[] = [];
  const eqKunjungan = vi.fn();
  let kunjunganRows: Record<string, unknown>[];
  let profil: { id: string; nama: string; email: string; foto_url: null } | null;

  beforeEach(() => {
    vi.clearAllMocks();
    tabel.length = 0;
    kunjunganRows = [];
    profil = { id: 'pg-1', nama: 'Siti', email: 's@x.id', foto_url: null };
    rpcMock.mockResolvedValue({ data: [], error: null });

    const dari = (t: string) => {
      tabel.push(t);
      if (t === 'pengunjung') {
        const b = { select: vi.fn(() => b), eq: vi.fn(() => b), single: vi.fn(async () => ({ data: profil, error: profil ? null : { message: 'x' } })) };
        return b;
      }
      if (t === 'kunjungan') {
        const b = {
          select: vi.fn(() => b),
          eq: vi.fn((k: string, v: unknown) => {
            eqKunjungan(k, v);
            return b;
          }),
          in: vi.fn(() => b),
          order: vi.fn(async () => ({ data: kunjunganRows, error: null })),
        };
        return b;
      }
      if (t === 'v_layanan_publik') {
        const b = { select: vi.fn(() => b), in: vi.fn(async () => ({ data: [{ id: 'lay-1', nama: 'Helpdesk OSS' }], error: null })) };
        return b;
      }
      return {};
    };
    createClientMock.mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1', user_metadata: {} } } }) },
      from: vi.fn(dari),
      rpc: rpcMock,
    });
  });

  afterEach(cleanup);

  const baris = (o: Record<string, unknown> = {}) => ({
    id: 'k-1',
    tujuan: 'loket',
    nama_yang_ditemui: null,
    tanggal: addDaysWIB(2),
    jam_rencana: '09:00:00',
    qr_token: 'a'.repeat(32),
    status: 'terjadwal',
    layanan_saran_id: 'lay-1',
    ...o,
  });

  it('reservasi mendatang dibaca dari kunjungan (asal=reservasi, milik pengunjung ini) dan tidak menyentuh visit', async () => {
    kunjunganRows = [baris()];
    render(<MeDashboard />);

    expect(await screen.findByText(/Reservasi Mendatang \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    expect(screen.getByText('09:00 WIB')).toBeInTheDocument();
    expect(screen.getByTestId('qr')).toHaveTextContent('a'.repeat(32));
    expect(tabel).toContain('kunjungan');
    expect(tabel).not.toContain('visit');
    expect(eqKunjungan).toHaveBeenCalledWith('pengunjung_id', 'pg-1');
    expect(eqKunjungan).toHaveBeenCalledWith('asal', 'reservasi');
  });

  it('reservasi bertemu seseorang menampilkan nama yang ditemui', async () => {
    kunjunganRows = [baris({ tujuan: 'bertemu_seseorang', nama_yang_ditemui: 'Kepala Bidang', layanan_saran_id: null })];
    render(<MeDashboard />);
    expect((await screen.findAllByText('Bertemu: Kepala Bidang')).length).toBeGreaterThan(0);
  });

  it('kunjungan hari ini yang menunggu: posisi antrean dari get_queue_position(qr_token)', async () => {
    kunjunganRows = [baris({ tanggal: todayWIB(), status: 'menunggu', qr_token: 'b'.repeat(32) })];
    rpcMock.mockResolvedValue({ data: [{ posisi: 2, total_menunggu: 5 }], error: null });
    render(<MeDashboard />);

    expect(await screen.findByText('Kunjungan Anda Hari Ini')).toBeInTheDocument();
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('get_queue_position', { p_qr_token: 'b'.repeat(32) }));
    expect(await screen.findByText('posisi antrean Anda')).toBeInTheDocument();
  });

  it('tanpa profil pengunjung: tidak ada kueri kunjungan sama sekali (tidak bocor reservasi orang lain)', async () => {
    profil = null;
    render(<MeDashboard />);
    expect(await screen.findByText(/Belum ada reservasi aktif/)).toBeInTheDocument();
    expect(tabel).not.toContain('kunjungan');
  });
});
