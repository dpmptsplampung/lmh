// @vitest-environment jsdom
// Jadwal mingguan per Layanan (jadwal_standby) + hari libur nasional (hari_libur), keduanya yang dibaca gerbang DB.
// RBAC Tahap 0: hanya Admin yang menulis; FO & petugas hanya melihat.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import { todayWIB } from '@/lib/time';

type Err = { message: string; code?: string } | null;

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  writes: vi.fn(), // (op, table, values, opts?)
  liburReads: vi.fn(), // dipanggil tiap membaca hari_libur
  liburGte: vi.fn(),
  deleteSelected: vi.fn(), // true/false: apakah .select dipanggil sebelum delete di-await
  fromCalls: [] as string[],
  state: {
    role: 'petugas' as string,
    jadwalRows: [] as { hari: number; jam_mulai: string; jam_selesai: string; aktif: boolean }[],
    jadwalError: null as Err,
    jadwalGate: null as Promise<void> | null, // bila diisi, pembacaan jadwal_standby menunggu gerbang ini
    liburError: null as Err,
    layananError: null as Err, // galat kueri daftar layanan (semua kolom)
    layananKosong: false,
    layananAktifBelumAda: false, // select yang memuat kolom 'aktif' gagal 42703 (migrasi 202610270001 belum diterapkan)
    upsertError: null as Err,
    upsertGate: null as Promise<void> | null, // bila diisi, upsert menunggu gerbang ini (simpan tertunda)
    upsertRows: null as { hari: number }[] | null, // null = sama dengan baris yang dikirim
    insertError: null as Err,
    deleteResult: {
      data: [{ tanggal: '2099-12-25' }] as { tanggal: string }[] | null,
      error: null as Err,
    },
  },
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
// Pengujian jadwal memakai adaptor nilai; perilaku kalender diuji pada pustaka UI.
vi.mock('@/components/ui/PemilihTanggal', () => ({
  default: ({ nilai, onUbah, label, id, min }: { nilai: string; onUbah: (v: string) => void; label: string; id?: string; min?: string }) =>
    <input id={id} aria-label={label} value={nilai} min={min} onChange={(e) => onUbah(e.target.value)} />,
}));
vi.mock('@/lib/supabase/client', () => {
  const builder = (table: string) => {
    h.fromCalls.push(table);
    let op: 'select' | 'delete' = 'select';
    let selected = false;
    let kolom = '';
    const result = () => {
      if (table === 'layanan') {
        if (h.state.layananError) return { data: null, error: h.state.layananError };
        if (h.state.layananAktifBelumAda && kolom.includes('aktif')) {
          return { data: null, error: { code: '42703', message: 'column layanan.aktif does not exist' } };
        }
        if (h.state.layananKosong) return { data: [], error: null };
        return {
          data: [
            { id: 'l1', nama: 'Helpdesk OSS', is_ptsp: true, aktif: true },
            { id: 'l2', nama: 'Konsultasi', is_ptsp: false, aktif: true },
          ],
          error: null,
        };
      }
      if (table === 'jadwal_standby') {
        const hasil = h.state.jadwalError
          ? { data: null, error: h.state.jadwalError }
          : { data: h.state.jadwalRows, error: null };
        return h.state.jadwalGate ? h.state.jadwalGate.then(() => hasil) : hasil;
      }
      if (table === 'hari_libur' && op === 'delete') {
        h.deleteSelected(selected);
        return selected ? h.state.deleteResult : { ...h.state.deleteResult, data: null };
      }
      if (table === 'hari_libur') {
        h.liburReads();
        if (h.state.liburError) return { data: null, error: h.state.liburError };
        return { data: [{ tanggal: '2099-12-25', keterangan: 'Natal' }], error: null };
      }
      return { data: [], error: null };
    };
    const b: Record<string, unknown> = {};
    b.select = (k?: string) => {
      selected = true;
      kolom = k ?? '';
      return b;
    };
    b.eq = () => b;
    b.gte = (kolom: string, nilai: string) => {
      h.liburGte(kolom, nilai);
      return b;
    };
    b.order = () => b;
    b.upsert = (values: { hari: number }[], opts: unknown) => {
      h.writes('upsert', table, values, opts);
      const hasil = {
        data: h.state.upsertError ? null : (h.state.upsertRows ?? values),
        error: h.state.upsertError,
      };
      const u: Record<string, unknown> = { select: () => u };
      u.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) =>
        (h.state.upsertGate ? h.state.upsertGate.then(() => hasil) : Promise.resolve(hasil)).then(r, j);
      return u;
    };
    b.insert = (values: unknown) => {
      h.writes('insert', table, values);
      return Promise.resolve({ error: h.state.insertError });
    };
    b.delete = () => {
      op = 'delete';
      h.writes('delete', table);
      return b;
    };
    b.maybeSingle = () => {
      if (table === 'petugas') return Promise.resolve({ data: { id: 'p1', role: h.state.role } });
      return Promise.resolve({ data: null });
    };
    b.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise.resolve(result()).then(r, j);
    return b;
  };
  return {
    createClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      from: builder,
    }),
  };
});

import AdminJadwalPage from './page';

const SENIN_SAMPAI_RABU = [1, 2, 3].map((hari) => ({
  hari, jam_mulai: '08:00:00', jam_selesai: '15:00:00', aktif: true,
}));

const jamTutup = (hari: string) => screen.getByLabelText(`Jam tutup ${hari}`) as HTMLInputElement;
const jamBuka = (hari: string) => screen.getByLabelText(`Jam buka ${hari}`) as HTMLInputElement;
// Hapus libur kini dua langkah: ikon sampah -> konfirmasi "Ya, hapus".
const hapusLibur = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Hapus hari libur/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Ya, hapus/ }));
};
const klikSimpan = async () => fireEvent.click(await screen.findByRole('button', { name: /Simpan jadwal/ }));

describe('admin jadwal: jadwal_standby + hari libur nasional', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.writes.mockClear();
    h.liburReads.mockClear();
    h.liburGte.mockClear();
    h.deleteSelected.mockClear();
    h.fromCalls.length = 0;
    h.state.role = 'petugas';
    h.state.jadwalRows = SENIN_SAMPAI_RABU;
    h.state.jadwalError = null;
    h.state.jadwalGate = null;
    h.state.liburError = null;
    h.state.layananError = null;
    h.state.layananAktifBelumAda = false;
    h.state.layananKosong = false;
    h.state.upsertError = null;
    h.state.upsertGate = null;
    h.state.upsertRows = null;
    h.state.insertError = null;
    h.state.deleteResult = { data: [{ tanggal: '2099-12-25' }], error: null };
  });
  afterEach(cleanup);

  it.each(['petugas', 'front_office'])('%s: banner read-only, semua kontrol edit nonaktif/tersembunyi', async (role) => {
    h.state.role = role;
    render(<AdminJadwalPage />);
    expect(await screen.findByText(/Jadwal ini ditetapkan Admin sesuai SOP dan jadwal resmi/)).toBeTruthy();
    expect(screen.getByText(/Hubungi Admin bila ada perubahan/)).toBeTruthy();
    expect(jamTutup('Senin').value).toBe('15:00'); // jadwal tetap terlihat
    expect(jamBuka('Senin').disabled).toBe(true);
    expect(jamTutup('Senin').disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Senin' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Simpan jadwal/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tambah/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Hapus hari libur/ })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Senin' }));
    expect(h.writes).not.toHaveBeenCalled();
  });

  it('memuat 7 baris hari dari jadwal_standby layanan terpilih (hari tanpa baris = tidak aktif)', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Senin' });
    const hari = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
    expect(hari.map((n) => (screen.getByRole('checkbox', { name: n }) as HTMLInputElement).checked)).toEqual([
      true, true, true, false, false, false, false,
    ]);
    expect(jamBuka('Senin').value).toBe('08:00');
    expect(jamTutup('Rabu').value).toBe('15:00');
    // hari tanpa baris: jam bawaan 08:00-15:30
    expect(jamBuka('Sabtu').value).toBe('08:00');
    expect(jamTutup('Sabtu').value).toBe('15:30');
    expect(h.fromCalls).toContain('jadwal_standby');
  });

  it('simpan melakukan upsert jadwal_standby dengan onConflict "layanan_id,hari" untuk 7 hari', async () => {
    h.state.role = 'admin';
    h.state.jadwalRows = [
      ...SENIN_SAMPAI_RABU,
      { hari: 4, jam_mulai: '09:00:00', jam_selesai: '14:00:00', aktif: false }, // dimatikan, jam tetap dibawa
    ];
    render(<AdminJadwalPage />);
    await klikSimpan();
    await waitFor(() => expect(h.writes).toHaveBeenCalledWith('upsert', 'jadwal_standby', expect.any(Array), {
      onConflict: 'layanan_id,hari',
    }));
    const values = h.writes.mock.calls.find((c) => c[0] === 'upsert')![2] as Record<string, unknown>[];
    expect(values.map((v) => v.hari)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(values.every((v) => v.layanan_id === 'l1')).toBe(true);
    expect(values[0]).toMatchObject({ aktif: true, jam_mulai: '08:00:00', jam_selesai: '15:00:00' });
    // hari nonaktif tetap mengirim jam valid (trigger DB menilai juga baris aktif=false)
    expect(values[3]).toMatchObject({ aktif: false, jam_mulai: '09:00:00', jam_selesai: '14:00:00' });
    expect(values[5]).toMatchObject({ aktif: false, jam_mulai: '08:00:00', jam_selesai: '15:30:00' });
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Jadwal layanan disimpan.', 'success'));
    expect(screen.queryByText(/Jadwal ini ditetapkan Admin/)).toBeNull();
  });

  it('mengubah jam & mengaktifkan hari tercermin pada data yang disimpan', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Kamis' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kamis' }));
    fireEvent.change(jamTutup('Kamis'), { target: { value: '12:00' } });
    await klikSimpan();
    await waitFor(() => expect(h.writes).toHaveBeenCalled());
    const values = h.writes.mock.calls.find((c) => c[0] === 'upsert')![2] as Record<string, unknown>[];
    expect(values[3]).toMatchObject({ hari: 4, aktif: true, jam_mulai: '08:00:00', jam_selesai: '12:00:00' });
  });

  it('jam tutup lebih dari 16:00 ditolak di klien dengan pesan', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Selasa' });
    fireEvent.change(jamTutup('Selasa'), { target: { value: '16:30' } });
    await klikSimpan();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Selasa');
    expect(alert.textContent).toContain('16:00');
    expect(h.writes).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('jam buka sama dengan atau setelah jam tutup ditolak di klien dengan pesan', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Rabu' });
    fireEvent.change(jamBuka('Rabu'), { target: { value: '15:00' } });
    await klikSimpan();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Rabu');
    expect(alert.textContent).toMatch(/lebih awal/);
    expect(h.writes).not.toHaveBeenCalled();
  });

  it('galat 22023 JADWAL_TIDAK_VALID dari DB ditampilkan sebagai pesan, bukan "berhasil"', async () => {
    h.state.role = 'admin';
    h.state.upsertError = {
      code: '22023',
      message: 'JADWAL_TIDAK_VALID: jam selesai melewati batas tutup layanan pukul 16:00 WIB',
    };
    render(<AdminJadwalPage />);
    await klikSimpan();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('jam selesai melewati batas tutup layanan pukul 16:00 WIB');
    expect(alert.textContent).not.toContain('JADWAL_TIDAK_VALID');
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('batas tutup layanan'), 'error');
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('simpan ditolak (RLS) -> galat, bukan sukses', async () => {
    h.state.role = 'admin';
    h.state.upsertError = { code: '42501', message: 'new row violates row-level security policy' };
    render(<AdminJadwalPage />);
    await klikSimpan();
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal menyimpan jadwal'), 'error'),
    );
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('tidak berwenang'), 'error');
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('simpan yang tidak mengembalikan baris (0 baris terdampak) -> bukan sukses', async () => {
    h.state.role = 'admin';
    h.state.upsertRows = [];
    render(<AdminJadwalPage />);
    await klikSimpan();
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal menyimpan jadwal'), 'error'),
    );
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('mengganti layanan memuat jadwal layanan itu', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Senin' });
    h.state.jadwalRows = [{ hari: 6, jam_mulai: '10:00:00', jam_selesai: '12:00:00', aktif: true }];
    fireEvent.change(screen.getByLabelText('Layanan'), { target: { value: 'l2' } });
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Sabtu' }) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByRole('checkbox', { name: 'Senin' }) as HTMLInputElement).checked).toBe(false);
    expect(jamBuka('Sabtu').value).toBe('10:00');
  });

  it('gagal memuat jadwal -> galat + tanpa editor/tombol simpan; "Coba lagi" memuat ulang', async () => {
    h.state.role = 'admin';
    h.state.jadwalError = { message: 'TypeError: Failed to fetch', code: '' };
    render(<AdminJadwalPage />);
    const alert = await screen.findByText(/Jadwal layanan ini tidak dapat dimuat/);
    expect(alert).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Senin' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Simpan jadwal/ })).toBeNull();
    expect(h.writes).not.toHaveBeenCalled();

    h.state.jadwalError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Senin' }) as HTMLInputElement).checked).toBe(true));
    expect(screen.getByRole('button', { name: /Simpan jadwal/ })).toBeTruthy();
    expect(screen.queryByText(/Jadwal layanan ini tidak dapat dimuat/)).toBeNull();
  });

  it('gagal memuat hari libur -> galat + "Coba lagi", bukan pesan "Belum ada hari libur"', async () => {
    h.state.role = 'admin';
    h.state.liburError = { message: 'TypeError: Failed to fetch', code: '' };
    render(<AdminJadwalPage />);
    expect(await screen.findByText(/Daftar hari libur tidak dapat dimuat/)).toBeTruthy();
    expect(screen.queryByText(/Belum ada hari libur/)).toBeNull();

    h.state.liburError = null;
    const coba = screen.getAllByRole('button', { name: 'Coba lagi' });
    fireEvent.click(coba[coba.length - 1]);
    expect(await screen.findByText('Natal')).toBeTruthy();
    expect(screen.queryByText(/Daftar hari libur tidak dapat dimuat/)).toBeNull();
  });

  it('ganti layanan: sebelum jadwal baru termuat, tombol simpan hilang (tak bisa menulis minggu lama ke layanan baru)', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Senin' });
    let buka!: () => void;
    h.state.jadwalGate = new Promise<void>((r) => { buka = r; });
    h.state.jadwalRows = [{ hari: 6, jam_mulai: '10:00:00', jam_selesai: '12:00:00', aktif: true }];
    fireEvent.change(screen.getByLabelText('Layanan'), { target: { value: 'l2' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Simpan jadwal/ })).toBeNull());
    expect(screen.queryByRole('checkbox', { name: 'Senin' })).toBeNull();
    expect(h.writes).not.toHaveBeenCalled();

    buka();
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Sabtu' }) as HTMLInputElement).checked).toBe(true));
    await klikSimpan();
    await waitFor(() => expect(h.writes).toHaveBeenCalled());
    const values = h.writes.mock.calls.find((c) => c[0] === 'upsert')![2] as Record<string, unknown>[];
    expect(values.every((v) => v.layanan_id === 'l2')).toBe(true);
    expect(values[0]).toMatchObject({ hari: 1, aktif: false }); // bukan minggu layanan lama
  });

  it('bagian "Hari libur nasional" menambah baris ke hari_libur dan menampilkan daftar mulai hari ini (WIB)', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    expect(await screen.findByRole('heading', { name: /Hari libur nasional/ })).toBeTruthy();
    expect(h.liburGte).toHaveBeenCalledWith('tanggal', todayWIB());
    expect(await screen.findByText('Natal')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tanggal'), { target: { value: '2099-08-17' } });
    fireEvent.change(screen.getByLabelText(/^Keterangan/), { target: { value: ' Hari Kemerdekaan ' } });
    fireEvent.click(screen.getByRole('button', { name: /Tambah/ }));
    await waitFor(() => expect(h.writes).toHaveBeenCalledWith('insert', 'hari_libur', {
      tanggal: '2099-08-17', keterangan: 'Hari Kemerdekaan',
    }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Hari libur ditambahkan.', 'success'));
    await waitFor(() => expect(h.liburReads).toHaveBeenCalledTimes(2)); // muat ulang
  });

  it('hari libur tanpa keterangan (kosong/spasi): pesan validasi, aria terhubung, tanpa insert', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByText('Natal');
    const ket = screen.getByLabelText(/^Keterangan/) as HTMLInputElement;
    expect(ket.required).toBe(true);
    h.writes.mockClear();
    fireEvent.change(screen.getByLabelText('Tanggal'), { target: { value: '2099-08-17' } });
    fireEvent.change(ket, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /Tambah/ }));
    const pesan = await screen.findByText(/Keterangan wajib diisi/);
    expect(pesan.getAttribute('role')).toBe('alert');
    expect(ket.getAttribute('aria-invalid')).toBe('true');
    expect(ket.getAttribute('aria-describedby')).toBe(pesan.id);
    expect(h.writes).not.toHaveBeenCalledWith('insert', 'hari_libur', expect.anything());
    // memperbaiki isian menghapus pesan
    fireEvent.change(ket, { target: { value: 'Hari Kemerdekaan' } });
    expect(screen.queryByText(/Keterangan wajib diisi/)).toBeNull();
  });

  it('tambah hari libur duplikat (23505) -> pesan jelas, bukan sukses', async () => {
    h.state.role = 'admin';
    h.state.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    render(<AdminJadwalPage />);
    await screen.findByText('Natal');
    fireEvent.change(screen.getByLabelText('Tanggal'), { target: { value: '2099-12-25' } });
    fireEvent.change(screen.getByLabelText(/^Keterangan/), { target: { value: 'Natal' } });
    fireEvent.click(screen.getByRole('button', { name: /Tambah/ }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('sudah ada'), 'error'));
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('admin: hapus libur 0 baris (ditolak RLS diam-diam) -> galat jujur + daftar dimuat ulang', async () => {
    h.state.role = 'admin';
    h.state.deleteResult = { data: [], error: null };
    render(<AdminJadwalPage />);
    await hapusLibur();
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal menghapus hari libur.'), 'error'),
    );
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('tidak berwenang'), 'error');
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
    await waitFor(() => expect(h.liburReads).toHaveBeenCalledTimes(2));
  });

  it('admin: hapus libur gagal jaringan -> galat jujur tanpa muat ulang', async () => {
    h.state.role = 'admin';
    h.state.deleteResult = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } };
    render(<AdminJadwalPage />);
    await hapusLibur();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Koneksi bermasalah'), 'error'));
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
    expect(h.liburReads).toHaveBeenCalledTimes(1);
  });

  it('admin: hapus libur berhasil menyertakan .select (baris terbukti) -> toast sukses + muat ulang', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await hapusLibur();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Hari libur dihapus.', 'success'));
    expect(h.deleteSelected).toHaveBeenCalledWith(true);
    expect(h.deleteSelected).not.toHaveBeenCalledWith(false);
    await waitFor(() => expect(h.liburReads).toHaveBeenCalledTimes(2));
  });

  it('tidak ada pemanggilan from(layanan_jadwal) atau from(layanan_libur)', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await klikSimpan();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Jadwal layanan disimpan.', 'success'));
    await hapusLibur();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Hari libur dihapus.', 'success'));
    expect(h.fromCalls).not.toContain('layanan_jadwal');
    expect(h.fromCalls).not.toContain('layanan_libur');
    expect(h.fromCalls).toEqual(expect.arrayContaining(['jadwal_standby', 'hari_libur']));
  });

  it('teks aturan live chat: tetap bisa dipakai; di luar jadwal, bot yang menjawab', async () => {
    render(<AdminJadwalPage />);
    expect(await screen.findByText(/Live chat tetap bisa dipakai; di luar jadwal, bot yang menjawab\./)).toBeTruthy();
    expect(screen.queryByText(/live chat tetap buka/i)).toBeNull();
  });

  it('hari libur nasional berlaku untuk semua layanan (dijelaskan pada bagian libur)', async () => {
    render(<AdminJadwalPage />);
    const bagian = (await screen.findByRole('heading', { name: /Hari libur nasional/ })).closest('section')!;
    expect(within(bagian).getByText(/semua layanan/)).toBeTruthy();
  });
  // ── Gelombang 1 GAMMA: C3-03, C3-11, C3-13 ──────────────────────────────────────────────────────────────
  it('C3-03: ikon hapus hanya meminta konfirmasi (tanggal + keterangan), belum DELETE; Batal membatalkan', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Hapus hari libur/ }));
    const konfirmasi = await screen.findByRole('alertdialog');
    expect(konfirmasi.textContent).toContain('Natal');
    expect(konfirmasi.textContent).toMatch(/semua layanan/i);
    expect(h.writes).not.toHaveBeenCalledWith('delete', 'hari_libur');
    fireEvent.click(within(konfirmasi).getByRole('button', { name: 'Batal' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(h.writes).not.toHaveBeenCalledWith('delete', 'hari_libur');
    expect(screen.getByRole('button', { name: /Hapus hari libur/ })).toBeTruthy();
  });

  it('C3-03: "Ya, hapus" menjalankan DELETE sekali saja (klik ganda tidak menggandakan)', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Hapus hari libur/ }));
    const ya = await screen.findByRole('button', { name: /Ya, hapus/ });
    fireEvent.click(ya);
    fireEvent.click(ya);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Hari libur dihapus.', 'success'));
    expect(h.writes.mock.calls.filter((c) => c[0] === 'delete')).toHaveLength(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  const gantiKeL2 = () => fireEvent.change(screen.getByLabelText('Layanan'), { target: { value: 'l2' } });

  it('C3-11: jadwal belum disimpan + ganti layanan -> ditahan dengan peringatan; "Tetap di sini" mempertahankan draf', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Kamis' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kamis' }));
    const bacaAwal = h.fromCalls.filter((t) => t === 'jadwal_standby').length;
    gantiKeL2();
    const peringatan = await screen.findByRole('alert', { name: /belum disimpan/i });
    expect(peringatan.textContent).toMatch(/belum disimpan/i);
    expect((screen.getByLabelText('Layanan') as HTMLSelectElement).value).toBe('l1');
    expect(h.fromCalls.filter((t) => t === 'jadwal_standby').length).toBe(bacaAwal); // tidak memuat l2
    fireEvent.click(within(peringatan).getByRole('button', { name: /Tetap di sini/ }));
    expect(screen.queryByRole('alert', { name: /belum disimpan/i })).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Kamis' }) as HTMLInputElement).checked).toBe(true);
  });

  it('C3-11: "Buang perubahan dan pindah" memuat layanan baru', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Kamis' });
    fireEvent.change(jamTutup('Senin'), { target: { value: '12:00' } });
    h.state.jadwalRows = [{ hari: 6, jam_mulai: '10:00:00', jam_selesai: '12:00:00', aktif: true }];
    gantiKeL2();
    fireEvent.click(within(await screen.findByRole('alert', { name: /belum disimpan/i })).getByRole('button', { name: /Buang perubahan/ }));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Sabtu' }) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByLabelText('Layanan') as HTMLSelectElement).value).toBe('l2');
  });

  it('C3-11: tanpa perubahan, ganti layanan langsung (tanpa peringatan); setelah simpan juga tidak kotor', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Kamis' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kamis' }));
    await klikSimpan();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Jadwal layanan disimpan.', 'success'));
    h.state.jadwalRows = [{ hari: 6, jam_mulai: '10:00:00', jam_selesai: '12:00:00', aktif: true }];
    gantiKeL2();
    expect(screen.queryByRole('alert', { name: /belum disimpan/i })).toBeNull();
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Sabtu' }) as HTMLInputElement).checked).toBe(true));
  });

  it('C3-11: mengubah lalu mengembalikan nilai awal tidak dianggap kotor', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Kamis' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kamis' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kamis' }));
    h.state.jadwalRows = [];
    gantiKeL2();
    expect(screen.queryByRole('alert', { name: /belum disimpan/i })).toBeNull();
    await waitFor(() => expect((screen.getByLabelText('Layanan') as HTMLSelectElement).value).toBe('l2'));
  });

  it('C3-13: kueri daftar layanan gagal -> galat + Coba lagi, bukan editor kosong; coba lagi memulihkan', async () => {
    h.state.role = 'admin';
    h.state.layananError = { message: 'TypeError: Failed to fetch', code: '' };
    render(<AdminJadwalPage />);
    expect(await screen.findByText(/Daftar layanan tidak dapat dimuat/)).toBeTruthy();
    expect(screen.queryByLabelText('Layanan')).toBeNull();
    expect(screen.queryByRole('button', { name: /Simpan jadwal/ })).toBeNull();

    h.state.layananError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await screen.findByRole('checkbox', { name: 'Senin' });
    expect(screen.queryByText(/Daftar layanan tidak dapat dimuat/)).toBeNull();
    expect((screen.getByLabelText('Layanan') as HTMLSelectElement).value).toBe('l1');
  });

  it('C3-13: kolom layanan.aktif belum ada (migrasi belum diterapkan) -> turun ke select tanpa aktif, bukan galat/kosong', async () => {
    h.state.role = 'admin';
    h.state.layananAktifBelumAda = true;
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Senin' });
    expect(screen.queryByText(/Daftar layanan tidak dapat dimuat/)).toBeNull();
    expect(screen.getAllByRole('option').length).toBe(2);
  });

  it('C3-13: layanan benar-benar kosong (tanpa galat) tetap pesan kosong, bukan galat', async () => {
    h.state.role = 'admin';
    h.state.layananKosong = true;
    render(<AdminJadwalPage />);
    expect(await screen.findByText(/Belum ada layanan/)).toBeTruthy();
    expect(screen.queryByText(/Daftar layanan tidak dapat dimuat/)).toBeNull();
  });

  // R6 (C3-11): hasil simpan layanan A tidak boleh mengganti baseline draf layanan B.
  it('R6: upsert A tertunda, pindah ke B, respons A datang -> B tidak berubah dan tidak dianggap kotor', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Kamis' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kamis' }));
    let selesai!: () => void;
    h.state.upsertGate = new Promise<void>((r) => { selesai = r; });
    await klikSimpan();
    await waitFor(() => expect(h.writes).toHaveBeenCalled());
    // Saat simpan A menggantung, admin pindah ke B (dengan konfirmasi buang) dan B termuat.
    h.state.jadwalRows = [{ hari: 6, jam_mulai: '10:00:00', jam_selesai: '12:00:00', aktif: true }];
    gantiKeL2();
    fireEvent.click(within(await screen.findByRole('alert', { name: /belum disimpan/i })).getByRole('button', { name: /Buang perubahan/ }));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Sabtu' }) as HTMLInputElement).checked).toBe(true));
    // Respons simpan A baru datang.
    selesai();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/Helpdesk OSS/), 'success'));
    // B tetap bersih: pindah balik ke A tanpa peringatan palsu...
    expect(screen.queryByRole('alert', { name: /belum disimpan/i })).toBeNull();
    // ...dan edit B yang kebetulan sama dengan snapshot A tetap dihitung kotor (tidak ditimpa baseline A).
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kamis' })); // draf B: Kamis aktif, Sabtu aktif; snapshot A: Senin-Kamis
    h.state.jadwalRows = SENIN_SAMPAI_RABU;
    fireEvent.change(screen.getByLabelText('Layanan'), { target: { value: 'l1' } });
    expect(await screen.findByRole('alert', { name: /belum disimpan/i })).toBeTruthy();
  });

  it('R6: B yang diedit persis seperti snapshot A tetap dianggap belum disimpan setelah respons A datang', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Kamis' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kamis' })); // draf A: Senin-Kamis aktif
    let selesai!: () => void;
    h.state.upsertGate = new Promise<void>((r) => { selesai = r; });
    await klikSimpan();
    await waitFor(() => expect(h.writes).toHaveBeenCalled());
    h.state.jadwalRows = SENIN_SAMPAI_RABU; // B dimuat: Senin-Rabu
    gantiKeL2();
    fireEvent.click(within(await screen.findByRole('alert', { name: /belum disimpan/i })).getByRole('button', { name: /Buang perubahan/ }));
    await waitFor(() => expect((screen.getByLabelText('Layanan') as HTMLSelectElement).value).toBe('l2'));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Senin' }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kamis' })); // draf B menjadi sama dengan snapshot A
    selesai();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/disimpan/), 'success'));
    h.state.jadwalRows = [];
    fireEvent.change(screen.getByLabelText('Layanan'), { target: { value: 'l1' } });
    expect(await screen.findByRole('alert', { name: /belum disimpan/i })).toBeTruthy();
    expect((screen.getByLabelText('Layanan') as HTMLSelectElement).value).toBe('l2');
  });

  it('R6: simpan A gagal setelah pindah ke B -> galat tidak muncul di layar B (hanya toast)', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    await screen.findByRole('checkbox', { name: 'Kamis' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kamis' }));
    let selesai!: () => void;
    h.state.upsertGate = new Promise<void>((r) => { selesai = r; });
    h.state.upsertError = { message: 'permission denied', code: '42501' };
    await klikSimpan();
    await waitFor(() => expect(h.writes).toHaveBeenCalled());
    h.state.jadwalRows = SENIN_SAMPAI_RABU;
    gantiKeL2();
    fireEvent.click(within(await screen.findByRole('alert', { name: /belum disimpan/i })).getByRole('button', { name: /Buang perubahan/ }));
    await waitFor(() => expect((screen.getByLabelText('Layanan') as HTMLSelectElement).value).toBe('l2'));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Senin' }) as HTMLInputElement).checked).toBe(true));
    selesai();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/Gagal menyimpan jadwal/), 'error'));
    expect(screen.queryByText(/Gagal menyimpan jadwal/)).toBeNull();
    expect(screen.queryByRole('alert', { name: /belum disimpan/i })).toBeNull();
  });

  // R7 (C3-13): objek DB belum ada != gangguan koneksi.
  const BELUM_ADA = { message: 'relation "public.jadwal_standby" does not exist', code: '42P01' };
  const JARINGAN = { message: 'TypeError: Failed to fetch', code: '' };

  it('R7: jadwal_standby belum ada (42P01) -> keterangan migrasi, tanpa "Periksa koneksi" dan tanpa Coba lagi', async () => {
    h.state.role = 'admin';
    h.state.jadwalError = BELUM_ADA;
    render(<AdminJadwalPage />);
    expect(await screen.findByText(/belum tersedia di database/i)).toBeTruthy();
    expect(screen.queryByText(/Periksa koneksi/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Coba lagi' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Simpan jadwal/ })).toBeNull();
  });

  it('R7: jadwal_standby galat jaringan -> tetap "Periksa koneksi" + Coba lagi (pesan berbeda dari migrasi)', async () => {
    h.state.role = 'admin';
    h.state.jadwalError = JARINGAN;
    render(<AdminJadwalPage />);
    expect(await screen.findByText(/Periksa koneksi Anda/)).toBeTruthy();
    expect(screen.queryByText(/belum tersedia di database/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });

  it('R7: hari_libur belum ada (42P01 / PGRST205) -> keterangan migrasi tanpa Coba lagi; jaringan tetap koneksi', async () => {
    h.state.role = 'admin';
    h.state.liburError = { message: 'Could not find the table', code: 'PGRST205' };
    render(<AdminJadwalPage />);
    expect(await screen.findByText(/Hari libur belum tersedia di database/i)).toBeTruthy();
    expect(screen.queryByText(/Daftar hari libur tidak dapat dimuat/)).toBeNull();
    expect(screen.queryByText(/Belum ada hari libur/)).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'Coba lagi' }).length).toBe(0);
    cleanup();
    h.state.liburError = JARINGAN;
    render(<AdminJadwalPage />);
    expect(await screen.findByText(/Daftar hari libur tidak dapat dimuat\. Periksa koneksi/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });

  it('R7: tabel layanan belum ada (42P01, juga pada select lama) -> keterangan migrasi, bukan "Periksa koneksi"', async () => {
    h.state.role = 'admin';
    h.state.layananError = BELUM_ADA;
    render(<AdminJadwalPage />);
    expect(await screen.findByText(/Layanan belum tersedia di database/i)).toBeTruthy();
    expect(screen.queryByText(/Periksa koneksi/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Coba lagi' })).toBeNull();
    expect(screen.queryByLabelText('Layanan')).toBeNull();
  });
});
