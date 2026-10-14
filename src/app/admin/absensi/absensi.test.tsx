// @vitest-environment jsdom
// RBAC Tahap 0: persetujuan absensi lewat RPC setujui_absensi; galat RPC ditampilkan jujur.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

type RpcErr = { code?: string; message: string } | null;

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  rpc: vi.fn(),
  directWrite: vi.fn(),
  state: {
    role: 'front_office' as string,
    rows: [] as unknown[],
    rpcError: null as RpcErr,
    // Efek samping RPC pada data server (mis. catat_pulang mengisi jam_pulang) — dipicu saat RPC sukses.
    onRpcOk: null as ((fn: string) => void) | null,
    // Galat query daftar absensi (supabase-js tidak melempar: kembali sebagai { error }, data null).
    queryError: null as { message: string; code?: string } | null,
  },
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/admin/AbsensiWizardModal', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.range = () => b;
    // UPDATE langsung ke absensi_petugas tidak boleh lagi terjadi dari klien.
    b.update = (v: unknown) => {
      h.directWrite(table, v);
      return b;
    };
    b.single = () => Promise.resolve({ data: { id: 'me', role: h.state.role, layanan_id: 'l1' } });
    b.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) =>
      Promise.resolve(
        h.state.queryError
          ? { data: null, count: null, error: h.state.queryError }
          : { data: h.state.rows, count: h.state.rows.length, error: null },
      ).then(r, j);
    return b;
  };
  return {
    createClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      from: builder,
      rpc: (fn: string, args: unknown) => {
        h.rpc(fn, args);
        if (!h.state.rpcError) h.state.onRpcOk?.(fn);
        // catat_pulang selalu mengembalikan now() walau tak ada baris yang diubah (idempoten, lihat migrasi 202610080001).
        return Promise.resolve({
          data: fn === 'catat_pulang' ? '2026-10-08T09:00:00Z' : null,
          error: h.state.rpcError,
        });
      },
    }),
  };
});

import AbsensiPage from './page';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1', petugas_id: 'p9', tanggal: '2026-10-08',
  jam_masuk: '2026-10-08T01:00:00Z', jam_pulang: null, status: 'pending',
  petugas: { nama: 'Budi', layanan: { nama: 'Helpdesk OSS' } },
  ...over,
});

describe('admin absensi: setujui/tolak lewat RPC setujui_absensi', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.rpc.mockClear();
    h.directWrite.mockClear();
    h.state.role = 'front_office';
    h.state.rows = [row()];
    h.state.rpcError = null;
  });
  afterEach(cleanup);

  it('Setujui memanggil rpc setujui_absensi (approved), tanpa UPDATE langsung, lalu toast sukses', async () => {
    render(<AbsensiPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Setujui' }));
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith('setujui_absensi', { p_absensi_id: 'a1', p_status: 'approved' }),
    );
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Absensi disetujui', 'success'));
    expect(h.directWrite).not.toHaveBeenCalled();
  });

  it('Tolak memanggil rpc setujui_absensi (ditolak)', async () => {
    h.state.role = 'admin';
    render(<AbsensiPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Tolak/ }));
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith('setujui_absensi', { p_absensi_id: 'a1', p_status: 'ditolak' }),
    );
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Absensi ditolak', 'success'));
  });

  it('RPC gagal (42501): galat jujur, TIDAK ada toast sukses', async () => {
    h.state.rpcError = { code: '42501', message: 'hanya Admin/Front Office' };
    render(<AbsensiPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Setujui' }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith('Hanya Front Office atau Admin yang dapat memutuskan absensi.', 'error'),
    );
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('RPC gagal (umum): pesan galat generik, bukan sukses', async () => {
    h.state.rpcError = { message: 'boom' };
    render(<AbsensiPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Tolak/ }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Gagal menolak absensi. Coba lagi.', 'error'));
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('petugas tidak melihat tombol Setujui/Tolak', async () => {
    h.state.role = 'petugas';
    h.state.rows = [row({ petugas_id: 'me' })];
    render(<AbsensiPage />);
    await screen.findByText('Budi');
    expect(screen.queryByRole('button', { name: 'Setujui' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tolak/ })).toBeNull();
  });
});

describe('admin absensi: pengajuan hadir petugas (catat_absensi)', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.rpc.mockClear();
    h.state.role = 'petugas';
    h.state.rows = [];
    h.state.rpcError = null;
  });
  afterEach(cleanup);

  it('Absen Hadir memanggil catat_absensi petugas_ajukan dan memberi tahu perlu persetujuan', async () => {
    render(<AbsensiPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Absen Hadir/ }));
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith('catat_absensi', {
        p_petugas_id: 'me', p_sumber: 'petugas_ajukan', p_dicatat_oleh: 'me',
      }),
    );
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Menunggu persetujuan'), 'success'),
    );
  });

  it('42501 -> pesan ramah, tanpa toast sukses', async () => {
    h.state.rpcError = { code: '42501', message: 'akses ditolak' };
    render(<AbsensiPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Absen Hadir/ }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Anda tidak berhak mengajukan absensi'), 'error'),
    );
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('status Alpa: tombol pengajuan ulang tersedia + keterangan perlu persetujuan FO/Admin', async () => {
    h.state.rows = [row({ petugas_id: 'me', status: 'alpa', jam_masuk: null })];
    render(<AbsensiPage />);
    expect(await screen.findByRole('button', { name: /Ajukan Kehadiran/ })).toBeTruthy();
    expect(screen.getByText(/tercatat Alpa hari ini/)).toBeTruthy();
    expect(screen.getByText(/disetujui Front Office\/Admin/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Absen Pulang/ })).toBeNull();
  });
});

describe('admin absensi: absen pulang petugas (catat_pulang)', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.rpc.mockClear();
    h.state.role = 'petugas';
    h.state.rows = [row({ petugas_id: 'me', status: 'approved' })];
    h.state.rpcError = null;
    h.state.onRpcOk = null;
    h.state.queryError = null;
  });
  afterEach(cleanup);

  it('query muat ulang gagal ({ error }) -> tak bisa membuktikan, BUKAN toast palsu "tidak tercatat"', async () => {
    // Setelah catat_pulang sukses, query muat-ulang gagal (mis. jaringan). Sebelum perbaikan galat itu
    // diabaikan -> daftar [] -> "Absen pulang tidak tercatat" padahal RPC sukses.
    h.state.onRpcOk = (fn) => {
      if (fn === 'catat_pulang') h.state.queryError = { message: 'TypeError: Failed to fetch', code: '' };
    };
    render(<AbsensiPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Absen Pulang/ }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('catat_pulang', { p_petugas_id: 'me' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Absen pulang berhasil dicatat', 'success'));
    expect(h.toast).not.toHaveBeenCalledWith(expect.stringContaining('tidak tercatat'), 'error');
  });

  it('sukses: RPC dipanggil, jam_pulang terbukti tercatat setelah muat ulang -> toast sukses', async () => {
    h.state.onRpcOk = (fn) => {
      if (fn === 'catat_pulang') {
        h.state.rows = [row({ petugas_id: 'me', status: 'approved', jam_pulang: '2026-10-08T09:00:00Z' })];
      }
    };
    render(<AbsensiPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Absen Pulang/ }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('catat_pulang', { p_petugas_id: 'me' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Absen pulang berhasil dicatat', 'success'));
  });

  it('RPC mengembalikan error -> toast gagal, BUKAN sukses', async () => {
    h.state.rpcError = { code: '42501', message: 'hanya boleh mencatat pulang diri sendiri' };
    render(<AbsensiPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Absen Pulang/ }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('tidak berwenang'), 'error'),
    );
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('RPC tanpa error tetapi tak ada baris berubah (idempoten: belum ada absen hadir / sudah pulang) -> BUKAN sukses', async () => {
    // onRpcOk tidak diisi: data server tetap jam_pulang = null setelah RPC "sukses".
    render(<AbsensiPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Absen Pulang/ }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('catat_pulang', { p_petugas_id: 'me' }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Absen pulang tidak tercatat'), 'error'),
    );
    expect(h.toast).not.toHaveBeenCalledWith('Absen pulang berhasil dicatat', 'success');
  });
});
