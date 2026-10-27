// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { toastMock, rpcMock, hasilTabel, kueri } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  rpcMock: vi.fn(),
  kueri: [] as string[],
  hasilTabel: {} as Record<string, { data?: unknown; error?: { code?: string; message: string } | null }>,
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: rpcMock,
    from: (tabel: string) => {
      kueri.push(tabel);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ error: null, ...(hasilTabel[tabel] ?? { data: [] }) }).then(res, rej);
      return b;
    },
  }),
}));

import SelesaiEskalasiModal from './SelesaiEskalasiModal';

const TIKET = { id: 'tk1', nomor_display: 'BP-007', layanan_id: 'ly1' };
const FID = 'aaaaaaaa-0000-4000-8000-000000000001';
const FID2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const fld = (o: Record<string, unknown>) => ({
  id: FID, layanan_id: 'ly1', label: 'Nomor kartu', jenis: 'teks_singkat', wajib: true, opsi: [], urut: 0,
  tersembunyi: false, pernah_diisi: false, ...o,
});

async function isiTopikCatatan() {
  const topik = await screen.findByLabelText(/Topik penanganan/);
  await waitFor(() => expect((topik as HTMLSelectElement).options.length).toBeGreaterThan(1));
  fireEvent.change(topik, { target: { value: 't1' } });
  fireEvent.change(screen.getByLabelText(/Catatan penanganan/), { target: { value: 'Sudah dibantu' } });
}

beforeEach(() => {
  rpcMock.mockReset();
  kueri.length = 0;
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  toastMock.mockReset();
  for (const k of Object.keys(hasilTabel)) delete hasilTabel[k];
  hasilTabel.topik_penanganan = { data: [{ id: 't1', nama: 'Konsultasi' }] };
});
afterEach(cleanup);

describe('SelesaiEskalasiModal', () => {
  it('email diketik: memakai layanan_selesai_khusus dengan p_identitas {email}', async () => {
    hasilTabel.pendataan_khusus_field = { data: [] };
    render(<SelesaiEskalasiModal tiket={TIKET} onClose={vi.fn()} />);
    await isiTopikCatatan();
    fireEvent.change(screen.getByLabelText('Email pengunjung'), { target: { value: 'warga@contoh.id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith('layanan_selesai_khusus', expect.objectContaining({
      p_tiket_id: 'tk1', p_identitas: { email: 'warga@contoh.id' },
    }));
  });

  it('email berformat salah / nilai pengganti ditolak di klien tanpa memanggil server', async () => {
    hasilTabel.pendataan_khusus_field = { data: [] };
    render(<SelesaiEskalasiModal tiket={TIKET} onClose={vi.fn()} />);
    await isiTopikCatatan();
    fireEvent.change(screen.getByLabelText('Email pengunjung'), { target: { value: 'Tidak berlaku' } });
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
    expect(await screen.findByText(/email yang valid/)).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('server menolak EMAIL_WAJIB (belum ada email di mana pun): pesan tampil di bawah isian email', async () => {
    hasilTabel.pendataan_khusus_field = { data: [] };
    rpcMock.mockResolvedValue({ data: null, error: { code: '22023', message: 'EMAIL_WAJIB: pengunjung yang dieskalasi wajib memiliki email' } });
    render(<SelesaiEskalasiModal tiket={TIKET} onClose={vi.fn()} />);
    await isiTopikCatatan();
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
    const pesan = await screen.findAllByText(/Email pengunjung wajib diisi/);
    expect(pesan.length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Email pengunjung')).toHaveAttribute('aria-invalid', 'true');
  });

  it('tanpa isian Pendataan Khusus memakai layanan_selesai (alur lama tidak berubah)', async () => {
    hasilTabel.pendataan_khusus_field = { data: [] };
    render(<SelesaiEskalasiModal tiket={TIKET} onClose={vi.fn()} />);
    await isiTopikCatatan();
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith('layanan_selesai', { p_tiket_id: 'tk1', p_topik_id: 't1', p_catatan: 'Sudah dibantu' });
  });

  it('dengan isian: layanan_selesai_khusus, p_khusus hanya berisi jawaban terisi', async () => {
    hasilTabel.pendataan_khusus_field = {
      data: [fld({}), fld({ id: FID2, label: 'Puas?', jenis: 'ya_tidak', wajib: false, urut: 1 })],
    };
    render(<SelesaiEskalasiModal tiket={TIKET} onClose={vi.fn()} />);
    await isiTopikCatatan();
    fireEvent.change(await screen.findByLabelText(/Nomor kartu/), { target: { value: ' 123 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith('layanan_selesai_khusus', {
      p_tiket_id: 'tk1', p_topik_id: 't1', p_catatan: 'Sudah dibantu', p_khusus: { [FID]: '123' },
    });
  });

  it('isian wajib kosong: tidak mengirim dan menandai isian (role=alert)', async () => {
    hasilTabel.pendataan_khusus_field = { data: [fld({})] };
    render(<SelesaiEskalasiModal tiket={TIKET} onClose={vi.fn()} />);
    await isiTopikCatatan();
    await screen.findByLabelText(/Nomor kartu/);
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
    const alert = await screen.findByText(/Nomor kartu wajib diisi/);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('migrasi belum diterapkan (tabel tidak ada): tanpa isian Khusus, alur lama', async () => {
    hasilTabel.pendataan_khusus_field = { error: { code: 'PGRST205', message: 'no table' } };
    render(<SelesaiEskalasiModal tiket={TIKET} onClose={vi.fn()} />);
    await isiTopikCatatan();
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('layanan_selesai', expect.any(Object)));
    expect(screen.queryByLabelText(/Nomor kartu/)).toBeNull();
  });

  it('galat DB KHUSUS_WAJIB (isian Layanan berubah) memuat ulang isian dan menampilkan pesan jelas', async () => {
    hasilTabel.pendataan_khusus_field = { data: [fld({ wajib: false })] };
    rpcMock.mockResolvedValue({ data: null, error: { code: '22023', message: 'KHUSUS_WAJIB: isian "Nomor kartu" wajib diisi' } });
    render(<SelesaiEskalasiModal tiket={TIKET} onClose={vi.fn()} />);
    await isiTopikCatatan();
    await screen.findByLabelText(/Nomor kartu/);
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
    expect((await screen.findByText(/berubah\. Formulir dimuat ulang/)).getAttribute('role')).toBe('alert');
  });

  it('deploy sebagian: layanan_selesai_khusus belum ada + tanpa isian wajib/jawaban -> ulangi dengan layanan_selesai', async () => {
    hasilTabel.pendataan_khusus_field = { data: [fld({ wajib: false })] };
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    render(<SelesaiEskalasiModal tiket={TIKET} onClose={vi.fn()} />);
    await isiTopikCatatan();
    await screen.findByLabelText(/Nomor kartu/);
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(2));
    expect(rpcMock.mock.calls[1]).toEqual(['layanan_selesai', { p_tiket_id: 'tk1', p_topik_id: 't1', p_catatan: 'Sudah dibantu' }]);
  });

  it('deploy sebagian dengan jawaban Khusus: pesan jelas, tidak mengulang tanpa Khusus', async () => {
    hasilTabel.pendataan_khusus_field = { data: [fld({})] };
    rpcMock.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } });
    render(<SelesaiEskalasiModal tiket={TIKET} onClose={vi.fn()} />);
    await isiTopikCatatan();
    fireEvent.change(await screen.findByLabelText(/Nomor kartu/), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
    expect((await screen.findByText(/belum aktif sepenuhnya di server/)).getAttribute('role')).toBe('alert');
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('server menolak isian (KHUSUS_TIDAK_VALID): isian dimuat ulang dan pesan jelas', async () => {
    hasilTabel.pendataan_khusus_field = { data: [fld({ wajib: false })] };
    rpcMock.mockResolvedValue({ data: null, error: { code: '22023', message: 'KHUSUS_TIDAK_VALID: isian tidak dikenal' } });
    render(<SelesaiEskalasiModal tiket={TIKET} onClose={vi.fn()} />);
    await isiTopikCatatan();
    await screen.findByLabelText(/Nomor kartu/);
    const sebelum = kueri.filter((n) => n === 'pendataan_khusus_field').length;
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
    expect((await screen.findByText(/berubah\. Formulir dimuat ulang/)).getAttribute('role')).toBe('alert');
    await waitFor(() => expect(kueri.filter((n) => n === 'pendataan_khusus_field').length).toBeGreaterThan(sebelum));
  });

  it('tiket tanpa tahap penanganan: peringatan dari RPC ditampilkan kepada petugas', async () => {
    hasilTabel.pendataan_khusus_field = { data: [fld({ wajib: false })] };
    rpcMock.mockResolvedValue({ data: { ok: true, peringatan: 'Tiket ini berasal dari alur lama; Pendataan Khusus tidak disimpan.' }, error: null });
    render(<SelesaiEskalasiModal tiket={TIKET} onClose={vi.fn()} />);
    await isiTopikCatatan();
    await screen.findByLabelText(/Nomor kartu/);
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('alur lama'), 'info'));
  });
});
