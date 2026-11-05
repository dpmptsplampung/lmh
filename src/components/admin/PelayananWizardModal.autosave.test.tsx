// @vitest-environment jsdom
// Perbaikan G1 (audit UI): C3-09 (nilai terakhir ikut autosave), C3-10 (tutup menunggu hasil simpan),
// F-01 (timer dibersihkan di semua jalur tutup, PATCH tidak saling timpa). Timer palsu: debounce 1 dtk.
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import PelayananWizardModal from './PelayananWizardModal';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) b[m] = () => b;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(res, rej);
      return b;
    },
  }),
}));

const DATA_OSS = {
  nama_usaha: 'Toko Rina', tipe_pelaku_usaha: 'perseorangan', status_penanaman_modal: 'tidak_ada',
  lokasi_usaha: 'Bandar Lampung', skala_usaha: 'Mikro', sektor_usaha_kbli: '47111',
  tindak_lanjut: 'Selesai di Loket (Tuntas)', uraian_solusi: 'NIB dibantu terbit.', catatan_internal: '-',
};
const dasar = () => ({
  tiket_id: 't-1', legacy_visit_id: null, nomor_display: 'OS-001', layanan_id: 'l-oss', layanan_nama: 'Helpdesk OSS',
  form_type: 'oss', nama_pemohon: 'Rina', alamat_pemohon: 'Bandar Lampung', no_hp: '081234567890',
  email: 'rina@example.com', keperluan_awal: 'Mengurus NIB', status_tiket: 'dilayani', dilayani_oleh: 'p1',
  dilayani_oleh_nama: null, boleh_ubah: true, is_locked: false, status_draft: 'belum_diisi', data_oss: { ...DATA_OSS },
});

type Resolver = (v: { ok: boolean; status?: number; json: () => Promise<unknown> }) => void;
const mockFetch = vi.fn();
let patchTertunda: Resolver[] = [];
const patches = () => mockFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH');
const badanPatch = (i: number) => JSON.parse((patches()[i][1] as RequestInit).body as string) as Record<string, unknown>;
const sukses = { ok: true, status: 200, json: async () => ({}) };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
  toastMock.mockReset();
  patchTertunda = [];
  mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return new Promise((res) => patchTertunda.push(res as Resolver));
    return Promise.resolve({ ok: true, json: async () => dasar() });
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const maju = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const selesaiPatch = async (i: number, hasil: Parameters<Resolver>[0] = sukses) => {
  await act(async () => { patchTertunda[i](hasil); await Promise.resolve(); });
};
async function buka(onClose = vi.fn()) {
  render(<PelayananWizardModal isOpen tiketId="t-1" onClose={onClose} />);
  const nama = await screen.findByLabelText('Nama Pemohon');
  return { nama, onClose };
}
const ketik = (el: Element, v: string) => fireEvent.change(el, { target: { value: v } });

describe('C3-09: nilai terakhir ikut payload autosave', () => {
  it('F4: jam simpan draf memakai WIB saat zona browser UTC', async () => {
    const asli = Date.prototype.toLocaleTimeString;
    const format = vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(function (this: Date, locale, opsi) {
      return asli.call(this, locale, { timeZone: 'UTC', ...opsi });
    });
    try {
      const { nama } = await buka();
      ketik(nama, 'Rina S');
      await maju(1000);
      vi.setSystemTime(new Date('2026-11-04T07:20:30.000Z'));
      await selesaiPatch(0);
      expect(screen.getByText(/Draft tersimpan 14.20.30/)).toBeInTheDocument();
    } finally {
      format.mockRestore();
    }
  });

  it('satu ketikan lalu jeda 1 dtk: PATCH berisi nilai TERBARU (bukan nilai sebelum ketikan)', async () => {
    const { nama } = await buka();
    ketik(nama, 'Rina S');
    await maju(1000);
    expect(patches()).toHaveLength(1);
    expect(badanPatch(0).nama_pemohon).toBe('Rina S');
  });

  it('ketikan beruntun dalam 1 dtk: satu PATCH dengan nilai akhir', async () => {
    const { nama } = await buka();
    ketik(nama, 'Ri');
    await maju(400);
    ketik(nama, 'Rina Sari');
    await maju(1000);
    expect(patches()).toHaveLength(1);
    expect(badanPatch(0).nama_pemohon).toBe('Rina Sari');
  });

  it('pilihan select terakhir juga ikut payload', async () => {
    const { nama } = await buka();
    fireEvent.click(screen.getByRole('button', { name: /^2\./ }));
    fireEvent.change(screen.getByLabelText('Skala Usaha'), { target: { value: 'Kecil' } });
    await maju(1000);
    expect(badanPatch(0).skala_usaha).toBe('Kecil');
    expect(nama).toBeTruthy();
  });

  it('mengetik saat simpan sebelumnya masih berjalan: penanda "belum tersimpan" tetap (Esc minta konfirmasi)', async () => {
    const { nama, onClose } = await buka();
    ketik(nama, 'Rina S');
    await maju(1000);
    expect(patches()).toHaveLength(1);
    ketik(nama, 'Rina Sa'); // setelah PATCH pertama dikirim, sebelum dijawab
    await selesaiPatch(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('PATCH tidak berjalan bersamaan: yang kedua menunggu yang pertama selesai, nilai terbaru menang', async () => {
    const { nama } = await buka();
    ketik(nama, 'Rina S');
    await maju(1000);
    ketik(nama, 'Rina Sa');
    await maju(1000);
    expect(patches()).toHaveLength(1); // kedua tertahan
    await selesaiPatch(0);
    await maju(0);
    expect(patches()).toHaveLength(2);
    expect(badanPatch(1).nama_pemohon).toBe('Rina Sa');
  });
});

describe('C3-10 / F-01: menutup dengan simpan', () => {
  it('"Tutup (Draf tersimpan)" menunggu PATCH selesai baru menutup, dan timer tidak mengirim PATCH basi sesudahnya', async () => {
    const { nama, onClose } = await buka();
    ketik(nama, 'Rina S');
    fireEvent.click(screen.getByRole('button', { name: /^Tutup \(Draf tersimpan\)/ }));
    await maju(0);
    expect(patches()).toHaveLength(1);
    expect(badanPatch(0).nama_pemohon).toBe('Rina S');
    expect(onClose).not.toHaveBeenCalled();
    await selesaiPatch(0);
    await maju(0);
    expect(onClose).toHaveBeenCalledTimes(1);
    await maju(3000);
    expect(patches()).toHaveLength(1);
  });

  it('simpan gagal (jaringan): dialog TETAP terbuka, ada toast galat, onClose tidak dipanggil', async () => {
    const { nama, onClose } = await buka();
    mockFetch.mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? Promise.reject(new Error('putus')) : Promise.resolve({ ok: true, json: async () => dasar() }));
    ketik(nama, 'Rina S');
    fireEvent.click(screen.getByRole('button', { name: /^Tutup \(Draf tersimpan\)/ }));
    await maju(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/draf/i), 'error');
    // isian masih ada dan masih ditandai belum tersimpan -> Esc memberi jalan keluar "Tutup tanpa menyimpan"
    expect(screen.getByLabelText('Nama Pemohon')).toHaveValue('Rina S');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByRole('button', { name: 'Tutup tanpa menyimpan' })).toBeInTheDocument();
  });

  it('simpan gagal (HTTP 500): dialog tetap terbuka dengan toast galat', async () => {
    const { nama, onClose } = await buka();
    ketik(nama, 'Rina S');
    fireEvent.click(screen.getByRole('button', { name: /^Tutup \(Draf tersimpan\)/ }));
    await maju(0);
    await selesaiPatch(0, { ok: false, status: 500, json: async () => ({ error: 'DB mati' }) });
    await maju(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/draf/i), 'error');
  });

  it('server menolak (403): dialog tidak menutup diam-diam (formulir terkunci, pesan server tampil)', async () => {
    const { nama, onClose } = await buka();
    ketik(nama, 'Rina S');
    fireEvent.click(screen.getByRole('button', { name: /^Tutup \(Draf tersimpan\)/ }));
    await maju(0);
    await selesaiPatch(0, { ok: false, status: 403, json: async () => ({ error: 'Bukan pemilik tiket' }) });
    await maju(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith('Bukan pemilik tiket', 'error');
  });

  it('tanpa perubahan apa pun: Tutup langsung menutup tanpa PATCH', async () => {
    const { onClose } = await buka();
    fireEvent.click(screen.getByRole('button', { name: /^Tutup \(Draf tersimpan\)/ }));
    await maju(0);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(patches()).toHaveLength(0);
  });

  it('selama menyimpan untuk menutup, tombol tutup tidak memicu simpan ganda', async () => {
    const { nama } = await buka();
    ketik(nama, 'Rina S');
    const tutup = screen.getByRole('button', { name: /^Tutup \(Draf tersimpan\)/ });
    fireEvent.click(tutup);
    fireEvent.click(tutup);
    await maju(0);
    expect(patches()).toHaveLength(1);
  });
});

describe('F-01: timer dibersihkan di semua jalur tutup', () => {
  it('modal ditutup induk (isOpen=false) sebelum debounce habis: tidak ada PATCH liar', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<PelayananWizardModal isOpen tiketId="t-1" onClose={onClose} />);
    ketik(await screen.findByLabelText('Nama Pemohon'), 'Rina S');
    rerender(<PelayananWizardModal isOpen={false} tiketId={null} onClose={onClose} />);
    await maju(3000);
    expect(patches()).toHaveLength(0);
  });

  it('Selesaikan Antrean: timer autosave tertunda dibatalkan agar tidak PATCH setelah data dikunci', async () => {
    const { nama, onClose } = await buka();
    mockFetch.mockImplementation((_u: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Promise((res) => patchTertunda.push(res as Resolver));
      if (init?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
      return Promise.resolve({ ok: true, json: async () => dasar() });
    });
    ketik(nama, 'Rina S');
    fireEvent.click(screen.getByRole('button', { name: /^3\./ }));
    fireEvent.click(screen.getByRole('button', { name: /Selesaikan Antrean/ }));
    await maju(0);
    expect(onClose).toHaveBeenCalledTimes(1);
    await maju(3000);
    expect(patches()).toHaveLength(0);
  });

  it('Esc tanpa perubahan lalu timer: tidak ada PATCH', async () => {
    const { nama, onClose } = await buka();
    ketik(nama, 'Rina S');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: 'Tutup tanpa menyimpan' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await maju(3000);
    expect(patches()).toHaveLength(0);
  });
});

// Putaran perbaikan 2 (R2): ketikan SELAMA penyimpanan untuk menutup tidak boleh hilang.
describe('R2: ketik lagi saat simpan-untuk-tutup masih terbang', () => {
  it('ketik A, tutup, tahan PATCH, ketik B: B ikut disimpan (PATCH ke-2) baru modal menutup', async () => {
    const { nama, onClose } = await buka();
    ketik(nama, 'Nilai A');
    fireEvent.click(screen.getByRole('button', { name: /^Tutup \(Draf tersimpan\)/ }));
    await maju(0);
    expect(patches()).toHaveLength(1);
    expect(badanPatch(0).nama_pemohon).toBe('Nilai A');
    ketik(screen.getByLabelText('Nama Pemohon'), 'Nilai B'); // selama PATCH A tertahan
    await selesaiPatch(0);
    await maju(0);
    expect(onClose).not.toHaveBeenCalled(); // B belum tersimpan
    expect(patches()).toHaveLength(2);
    expect(badanPatch(1).nama_pemohon).toBe('Nilai B');
    await selesaiPatch(1);
    await maju(0);
    expect(onClose).toHaveBeenCalledTimes(1);
    await maju(3000);
    expect(patches()).toHaveLength(2); // tidak ada timer liar
  });

  it('PATCH B gagal: modal tetap terbuka, isian B utuh, ditandai belum tersimpan', async () => {
    const { nama, onClose } = await buka();
    ketik(nama, 'Nilai A');
    fireEvent.click(screen.getByRole('button', { name: /^Tutup \(Draf tersimpan\)/ }));
    await maju(0);
    ketik(screen.getByLabelText('Nama Pemohon'), 'Nilai B');
    await selesaiPatch(0);
    await maju(0);
    await selesaiPatch(1, { ok: false, status: 500, json: async () => ({ error: 'DB mati' }) });
    await maju(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nama Pemohon')).toHaveValue('Nilai B');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByRole('button', { name: 'Tutup tanpa menyimpan' })).toBeInTheDocument();
  });

  it('selama menutup, isian dikunci (tidak bisa diketik lagi)', async () => {
    const { nama } = await buka();
    ketik(nama, 'Nilai A');
    fireEvent.click(screen.getByRole('button', { name: /^Tutup \(Draf tersimpan\)/ }));
    await maju(0);
    expect(screen.getByLabelText('Nama Pemohon')).toBeDisabled();
    await selesaiPatch(0);
    await maju(0);
  });
});

// Putaran perbaikan 2 (R3): respons autosave tiket A tidak boleh mengakui perubahan tiket B.
function IndukTetapPasang({ onClose }: { onClose: () => void }) {
  const [id, setId] = useState<string | null>('t-1');
  return (
    <>
      <button type="button" onClick={() => setId('t-2')}>buka-b</button>
      <PelayananWizardModal isOpen={id !== null} tiketId={id} onClose={() => { onClose(); setId(null); }} />
    </>
  );
}

describe('R3: respons simpan tiket lama (generasi basi)', () => {
  it('A terbang -> tutup tanpa menyimpan -> buka B -> ubah B -> respons A datang: B tetap dianggap belum tersimpan', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Promise((res) => patchTertunda.push(res as Resolver));
      const tiket = String(url).endsWith('t-2') ? 't-2' : 't-1';
      return Promise.resolve({ ok: true, json: async () => ({ ...dasar(), tiket_id: tiket }) });
    });
    const onClose = vi.fn();
    render(<IndukTetapPasang onClose={onClose} />);
    ketik(await screen.findByLabelText('Nama Pemohon'), 'Ubah A');
    await maju(1000); // autosave A terbang (versi 1)
    expect(patches()).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: 'Tutup tanpa menyimpan' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('buka-b'));
    await maju(0);
    const namaB = await screen.findByLabelText('Nama Pemohon');
    ketik(namaB, 'Ubah B'); // versi B = 1, sama dengan versi A yang masih terbang
    await selesaiPatch(0); // respons A (lama) tiba

    // B harus tetap "belum tersimpan": Esc meminta konfirmasi, bukan menutup diam-diam.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Lanjut mengisi/ }));

    // Dan Tutup (Draf tersimpan) tetap mengirim PATCH ke tiket B.
    fireEvent.click(screen.getByRole('button', { name: /^Tutup \(Draf tersimpan\)/ }));
    await maju(0);
    const patchB = patches().filter((c) => String(c[0]).endsWith('/t-2'));
    expect(patchB).toHaveLength(1);
    expect(JSON.parse((patchB[0][1] as RequestInit).body as string).nama_pemohon).toBe('Ubah B');
  });

  it('respons A yang GAGAL/403 terlambat tidak mengunci formulir B', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Promise((res) => patchTertunda.push(res as Resolver));
      const tiket = String(url).endsWith('t-2') ? 't-2' : 't-1';
      return Promise.resolve({ ok: true, json: async () => ({ ...dasar(), tiket_id: tiket }) });
    });
    render(<IndukTetapPasang onClose={vi.fn()} />);
    ketik(await screen.findByLabelText('Nama Pemohon'), 'Ubah A');
    await maju(1000);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: 'Tutup tanpa menyimpan' }));
    fireEvent.click(screen.getByText('buka-b'));
    await maju(0);
    await screen.findByLabelText('Nama Pemohon');
    await selesaiPatch(0, { ok: false, status: 403, json: async () => ({ error: 'Bukan pemilik tiket' }) });
    await maju(0);
    expect(screen.getByLabelText('Nama Pemohon')).not.toBeDisabled();
    expect(toastMock).not.toHaveBeenCalledWith('Bukan pemilik tiket', 'error');
  });
});
