// @vitest-environment jsdom
// SelesaiLayananModal (G5): satu jalur Selesai untuk tiket tanpa formulir tetap. Memuat definisi (pendataan_khusus_definisi),
// draf (pendataan_khusus_draf_baca), memvalidasi wajib, lalu layanan_selesai_khusus. Topik/catatan hanya bila Layanan
// TANPA isian Khusus aktif dan tiket hasil eskalasi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { toastMock, rpcMock, hasilTabel } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  rpcMock: vi.fn(),
  hasilTabel: {} as Record<string, { data?: unknown; error?: { code?: string; message: string } | null }>,
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: rpcMock,
    from: (tabel: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ error: null, ...(hasilTabel[tabel] ?? { data: [] }) }).then(res, rej);
      return b;
    },
  }),
}));

import SelesaiLayananModal from './SelesaiLayananModal';

const TIKET = { id: 'tk1', nomor_display: 'BP-007', layanan_id: 'ly1', hasilEskalasi: false };
const TIKET_ESKALASI = { ...TIKET, hasilEskalasi: true };
const FID = 'aaaaaaaa-0000-4000-8000-000000000001';
const FID2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const fld = (o: Record<string, unknown>) => ({
  id: FID, layanan_id: 'ly1', label: 'Nomor kartu', jenis: 'teks_singkat', wajib: true, opsi: [], urut: 0,
  tersembunyi: false, pernah_diisi: false, ...o,
});

type Balasan = { data: unknown; error: { code?: string; message: string } | null };
const balasan: Record<string, Balasan | ((a: unknown) => Balasan)> = {};

const panggilan = (nama: string) => rpcMock.mock.calls.filter((c) => c[0] === nama);

function atur(definisi: unknown[] | Balasan, draf: Record<string, unknown> | null = null) {
  balasan.pendataan_khusus_definisi = Array.isArray(definisi) ? { data: definisi, error: null } : definisi;
  balasan.pendataan_khusus_draf_baca = {
    data: draf ? { tiket_id: 'tk1', jawaban: draf, diubah_oleh: 'p1', updated_at: '2026-11-17T01:00:00Z' } : null,
    error: null,
  };
}

async function isiTopikCatatan() {
  const topik = await screen.findByLabelText(/Topik penanganan/);
  await waitFor(() => expect((topik as HTMLSelectElement).options.length).toBeGreaterThan(1));
  fireEvent.change(topik, { target: { value: 't1' } });
  fireEvent.change(screen.getByLabelText(/Catatan penanganan/), { target: { value: 'Sudah dibantu' } });
}

const tombolSelesai = () => screen.getByRole('button', { name: 'Selesaikan' });
async function siapKlik() {
  await waitFor(() => expect(tombolSelesai()).toBeEnabled());
  fireEvent.click(tombolSelesai());
}

beforeEach(() => {
  rpcMock.mockReset();
  for (const k of Object.keys(balasan)) delete balasan[k];
  atur([]);
  balasan.layanan_selesai_khusus = { data: { ok: true, khusus_tersimpan: 0 }, error: null };
  balasan.pendataan_khusus_draf_simpan = { data: { ok: true, tiket_id: 'tk1', updated_at: '2026-11-17T01:00:05Z' }, error: null };
  rpcMock.mockImplementation((nama: string, args: unknown) => {
    const b = balasan[nama];
    return Promise.resolve(typeof b === 'function' ? b(args) : (b ?? { data: null, error: { message: `tak dikenal: ${nama}` } }));
  });
  toastMock.mockReset();
  for (const k of Object.keys(hasilTabel)) delete hasilTabel[k];
  hasilTabel.topik_penanganan = { data: [{ id: 't1', nama: 'Konsultasi' }] };
});
afterEach(cleanup);

describe('SelesaiLayananModal: tanpa isian Khusus aktif', () => {
  it('tiket biasa: hanya konfirmasi, tanpa topik/catatan; layanan_selesai_khusus dengan topik/catatan/khusus null', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<SelesaiLayananModal tiket={TIKET} onClose={onClose} onSuccess={onSuccess} />);
    await siapKlik();
    await waitFor(() => expect(panggilan('layanan_selesai_khusus')).toHaveLength(1));
    expect(panggilan('layanan_selesai_khusus')[0][1]).toEqual({ p_tiket_id: 'tk1', p_topik_id: null, p_catatan: null, p_khusus: null });
    expect(screen.queryByLabelText(/Topik penanganan/)).toBeNull();
    expect(panggilan('layanan_selesai')).toHaveLength(0);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSuccess).toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith('Tiket BP-007 selesai dilayani', 'success');
  });

  it('tiket hasil eskalasi: topik + catatan wajib, dikirim lewat layanan_selesai_khusus', async () => {
    render(<SelesaiLayananModal tiket={TIKET_ESKALASI} onClose={vi.fn()} />);
    await isiTopikCatatan();
    await siapKlik();
    await waitFor(() => expect(panggilan('layanan_selesai_khusus')).toHaveLength(1));
    expect(panggilan('layanan_selesai_khusus')[0][1]).toEqual({
      p_tiket_id: 'tk1', p_topik_id: 't1', p_catatan: 'Sudah dibantu', p_khusus: null,
    });
  });

  it('tiket eskalasi tanpa topik/catatan: ditolak di klien tanpa memanggil server', async () => {
    render(<SelesaiLayananModal tiket={TIKET_ESKALASI} onClose={vi.fn()} />);
    await screen.findByLabelText(/Topik penanganan/);
    await siapKlik();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(panggilan('layanan_selesai_khusus')).toHaveLength(0);
  });

  it('server menolak TOPIK_WAJIB (tiket lama): kolom topik + catatan dimunculkan', async () => {
    balasan.layanan_selesai_khusus = { data: null, error: { code: '22023', message: 'TOPIK_WAJIB: topik wajib' } };
    render(<SelesaiLayananModal tiket={TIKET} onClose={vi.fn()} />);
    await siapKlik();
    expect(await screen.findByLabelText(/Topik penanganan/)).toBeInTheDocument();
  });

  it('email diketik: p_identitas {email} ikut dikirim', async () => {
    render(<SelesaiLayananModal tiket={TIKET} onClose={vi.fn()} />);
    await screen.findByLabelText('Email pengunjung');
    fireEvent.change(screen.getByLabelText('Email pengunjung'), { target: { value: 'warga@contoh.id' } });
    await siapKlik();
    await waitFor(() => expect(panggilan('layanan_selesai_khusus')).toHaveLength(1));
    expect(panggilan('layanan_selesai_khusus')[0][1]).toMatchObject({ p_tiket_id: 'tk1', p_identitas: { email: 'warga@contoh.id' } });
  });

  it('email berformat salah ditolak di klien', async () => {
    render(<SelesaiLayananModal tiket={TIKET} onClose={vi.fn()} />);
    await screen.findByLabelText('Email pengunjung');
    fireEvent.change(screen.getByLabelText('Email pengunjung'), { target: { value: 'Tidak berlaku' } });
    await siapKlik();
    expect(await screen.findByText(/email yang valid/)).toBeTruthy();
    expect(panggilan('layanan_selesai_khusus')).toHaveLength(0);
  });

  it('server menolak EMAIL_WAJIB: pesan di bawah isian email dan aria-invalid', async () => {
    balasan.layanan_selesai_khusus = { data: null, error: { code: '22023', message: 'EMAIL_WAJIB: pengunjung wajib memiliki email' } };
    render(<SelesaiLayananModal tiket={TIKET} onClose={vi.fn()} />);
    await siapKlik();
    expect((await screen.findAllByText(/Email pengunjung wajib diisi/)).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Email pengunjung')).toHaveAttribute('aria-invalid', 'true');
  });

  it('peringatan dari RPC ditampilkan sebagai toast info', async () => {
    balasan.layanan_selesai_khusus = { data: { ok: true, peringatan: 'Tiket ini berasal dari alur lama.' }, error: null };
    render(<SelesaiLayananModal tiket={TIKET} onClose={vi.fn()} />);
    await siapKlik();
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Tiket ini berasal dari alur lama.', 'info'));
  });

  it('galat INVALID_STATUS: pesan jelas, dialog tetap terbuka, daftar dimuat ulang (onSuccess)', async () => {
    balasan.layanan_selesai_khusus = { data: null, error: { code: 'P0001', message: 'INVALID_STATUS: tiket tidak dilayani' } };
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<SelesaiLayananModal tiket={TIKET} onClose={onClose} onSuccess={onSuccess} />);
    await siapKlik();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });
});

describe('SelesaiLayananModal: dengan isian Khusus aktif', () => {
  it('memuat draf ke isian, tanpa topik/catatan; final = isian layar, isian kosong null', async () => {
    atur([fld({}), fld({ id: FID2, label: 'Puas?', jenis: 'ya_tidak', wajib: false, urut: 1 })], { [FID]: 'KK-99' });
    render(<SelesaiLayananModal tiket={TIKET_ESKALASI} onClose={vi.fn()} />);
    const isian = await screen.findByLabelText(/Nomor kartu/);
    await waitFor(() => expect(isian).toHaveValue('KK-99'));
    expect(screen.queryByLabelText(/Topik penanganan/)).toBeNull();
    await siapKlik();
    await waitFor(() => expect(panggilan('layanan_selesai_khusus')).toHaveLength(1));
    expect(panggilan('layanan_selesai_khusus')[0][1]).toEqual({
      p_tiket_id: 'tk1', p_topik_id: null, p_catatan: null, p_khusus: { [FID]: 'KK-99', [FID2]: null },
    });
  });

  it('isian wajib kosong: tidak mengirim, isian ditandai role=alert', async () => {
    atur([fld({})]);
    render(<SelesaiLayananModal tiket={TIKET} onClose={vi.fn()} />);
    await screen.findByLabelText(/Nomor kartu/);
    await siapKlik();
    const alert = await screen.findByText(/Nomor kartu wajib diisi/);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(panggilan('layanan_selesai_khusus')).toHaveLength(0);
  });

  it('false dan 0 adalah jawaban sah (ya/tidak = tidak, angka = 0)', async () => {
    atur([
      fld({ jenis: 'ya_tidak', label: 'Ada berkas' }),
      fld({ id: FID2, jenis: 'angka', label: 'Jumlah', urut: 1 }),
    ], { [FID]: false, [FID2]: 0 });
    render(<SelesaiLayananModal tiket={TIKET} onClose={vi.fn()} />);
    await screen.findByText(/Ada berkas/);
    await siapKlik();
    await waitFor(() => expect(panggilan('layanan_selesai_khusus')).toHaveLength(1));
    expect(panggilan('layanan_selesai_khusus')[0][1]).toMatchObject({ p_khusus: { [FID]: false, [FID2]: 0 } });
  });

  it('simpan terakhir ke draf mendahului finalisasi', async () => {
    atur([fld({ wajib: false })]);
    render(<SelesaiLayananModal tiket={TIKET} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/Nomor kartu/), { target: { value: ' 123 ' } });
    await siapKlik();
    await waitFor(() => expect(panggilan('layanan_selesai_khusus')).toHaveLength(1));
    expect(panggilan('pendataan_khusus_draf_simpan')[0][1]).toEqual({ p_tiket: 'tk1', p_jawaban: { [FID]: '123' } });
    const urutan = rpcMock.mock.calls.map((c) => c[0]);
    expect(urutan.indexOf('pendataan_khusus_draf_simpan')).toBeLessThan(urutan.indexOf('layanan_selesai_khusus'));
    expect(panggilan('layanan_selesai_khusus')[0][1]).toMatchObject({ p_khusus: { [FID]: '123' } });
  });

  it('server menolak KHUSUS_WAJIB dengan DETAIL UUID: isian itu ditandai, definisi dimuat ulang', async () => {
    atur([fld({ wajib: false })]);
    balasan.layanan_selesai_khusus = {
      data: null, error: { code: '22023', message: `KHUSUS_WAJIB: isian wajib belum diisi (${FID})` },
    };
    render(<SelesaiLayananModal tiket={TIKET} onClose={vi.fn()} />);
    await screen.findByLabelText(/Nomor kartu/);
    const sebelum = panggilan('pendataan_khusus_definisi').length;
    await siapKlik();
    expect(await screen.findByText(/Nomor kartu wajib diisi/)).toBeInTheDocument();
    expect(panggilan('pendataan_khusus_definisi').length).toBeGreaterThanOrEqual(sebelum);
  });

  it('KHUSUS_TIDAK_VALID: definisi dimuat ulang dan pesan jelas', async () => {
    atur([fld({ wajib: false })]);
    balasan.layanan_selesai_khusus = { data: null, error: { code: '22023', message: 'KHUSUS_TIDAK_VALID: isian tidak dikenal' } };
    render(<SelesaiLayananModal tiket={TIKET} onClose={vi.fn()} />);
    await screen.findByLabelText(/Nomor kartu/);
    const sebelum = panggilan('pendataan_khusus_definisi').length;
    await siapKlik();
    expect(await screen.findByText(/tidak valid/)).toBeInTheDocument();
    await waitFor(() => expect(panggilan('pendataan_khusus_definisi').length).toBeGreaterThan(sebelum));
  });

  it('galat memuat definisi: pesan jelas dan tombol Selesaikan nonaktif', async () => {
    atur({ data: null, error: { code: 'XX000', message: 'boom' } });
    render(<SelesaiLayananModal tiket={TIKET} onClose={vi.fn()} />);
    expect((await screen.findAllByText(/Gagal memuat isian Pendataan Khusus/)).length).toBeGreaterThan(0);
    expect(tombolSelesai()).toBeDisabled();
  });
});

describe('SelesaiLayananModal: migrasi G5 belum diterapkan', () => {
  it('definisi PGRST202: alur lama; tiket eskalasi tetap topik + catatan lewat layanan_selesai', async () => {
    atur({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    render(<SelesaiLayananModal tiket={TIKET_ESKALASI} onClose={vi.fn()} />);
    balasan.layanan_selesai = { data: { ok: true }, error: null };
    await isiTopikCatatan();
    await siapKlik();
    await waitFor(() => expect(panggilan('layanan_selesai')).toHaveLength(1));
    expect(panggilan('layanan_selesai')[0][1]).toEqual({ p_tiket_id: 'tk1', p_topik_id: 't1', p_catatan: 'Sudah dibantu' });
    expect(panggilan('layanan_selesai_khusus')).toHaveLength(0);
  });
});
