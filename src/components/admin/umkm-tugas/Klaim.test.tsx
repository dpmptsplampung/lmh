// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Detail } from '@/lib/umkm-katalog/types';
import TugasUmkm from './TugasUmkm';
import DetailTugas from './DetailTugas';
import type { DetailKlaim } from '@/lib/umkm-katalog/types-g5';

const kid = '30000000-0000-4000-8000-000000000001';
const pid = '10000000-0000-4000-8000-000000000001';
const dasar: DetailKlaim = {
  id: kid, jenis: 'klaim', nama: 'Klaim profil', profil_id: pid, profil_nama: 'Kopi Lampung',
  status: 'diajukan', versi: 1, mendesak: false, petugas_id: 'staf', petugas_nama: 'Sari',
  dibuat_pada: '2026-11-09T02:00:00Z', dipegang_saya: true, alasan_tolak: null,
  pemilik: { nama: 'Budi Santoso', hp: '081377778888', email: 'budi@contoh.id' },
  alasan: 'Saya pemilik usaha ini sejak 2019.',
};
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data, meta: { request_id: 'req-1' } })));
const galat = (code: string, status: number) => Promise.resolve(
  new Response(JSON.stringify({ error: { code, message: 'x' }, request_id: 'req-1' }), { status }));
let cur: DetailKlaim;
let fetchMock: ReturnType<typeof vi.fn>;
let putusanHasil: () => Promise<Response>;
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
  .map(([url, init]) => [url as string, JSON.parse(init!.body as string)] as const);

beforeEach(() => {
  cur = structuredClone(dasar);
  const mutasi = () => ok({ id: kid, jenis: 'klaim', profil_id: pid, status: cur.status, versi: cur.versi });
  putusanHasil = mutasi;
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (url.endsWith('/ambil')) {
        cur.petugas_id = 'saya'; cur.petugas_nama = 'Saya'; cur.dipegang_saya = true; cur.versi += 1;
      }
      if (url.endsWith('/putusan')) return putusanHasil();
      return mutasi();
    }
    if (url.endsWith(`/klaim/${kid}`)) return ok(cur);
    return ok({ items: [{ ...cur, pemilik: undefined, alasan: undefined }], next_cursor: null });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); });

const buka = async () => {
  render(<TugasUmkm />);
  fireEvent.click(await screen.findByRole('button', { name: 'Periksa Klaim profil: Kopi Lampung' }));
  await screen.findByRole('heading', { name: 'Klaim profil Kopi Lampung' });
};

describe('klaim di daftar tugas (butir 1)', () => {
  it('butir klaim tampil di daftar tanpa data pengklaim, detail memuat profil, akun, dan alasan', async () => {
    render(<TugasUmkm />);
    await screen.findByRole('button', { name: 'Periksa Klaim profil: Kopi Lampung' });
    expect(document.body.textContent).not.toContain('Budi Santoso');
    fireEvent.click(screen.getByRole('button', { name: 'Periksa Klaim profil: Kopi Lampung' }));
    await screen.findByRole('heading', { name: 'Klaim profil Kopi Lampung' });
    const akun = screen.getByRole('region', { name: 'Akun pengklaim' });
    for (const teks of ['Budi Santoso', '081377778888', 'budi@contoh.id']) expect(akun.textContent).toContain(teks);
    expect(screen.getByText('Saya pemilik usaha ini sejak 2019.')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Profil yang diklaim' }).textContent).toContain('Kopi Lampung');
  });

  it('Setujui satu klik di detail dan kembali ke daftar', async () => {
    await buka();
    fireEvent.click(screen.getByRole('button', { name: 'Setujui' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe(`/api/admin/umkm-tugas/klaim/${kid}/putusan`);
    expect(posts()[0][1]).toMatchObject({ keputusan: 'disetujui', expected_version: 1 });
    expect(await screen.findByText(/Klaim disetujui/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Periksa Klaim profil: Kopi Lampung' })).toBeTruthy();
  });

  it('Tolak dua klik: Tolak lalu Kirim penolakan, alasan wajib', async () => {
    await buka();
    fireEvent.click(screen.getByRole('button', { name: 'Tolak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kirim penolakan' }));
    expect(posts()).toHaveLength(0);
    fireEvent.change(screen.getByRole('textbox', { name: /Alasan tolak/ }), { target: { value: 'Bukan pemilik' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim penolakan' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][1]).toMatchObject({ keputusan: 'ditolak', alasan: 'Bukan pemilik', expected_version: 1 });
    expect(await screen.findByText(/Klaim ditolak/)).toBeTruthy();
  });

  it('belum dipegang diambil otomatis; dipegang orang lain: Ambil alih tanpa tombol putusan', async () => {
    cur.petugas_id = null; cur.petugas_nama = null; cur.dipegang_saya = false;
    await buka();
    expect(posts()[0][0]).toBe(`/api/admin/umkm-tugas/klaim/${kid}/ambil`);
    expect(await screen.findByRole('button', { name: 'Setujui' })).toBeTruthy();
    cleanup();
    cur = structuredClone(dasar); cur.dipegang_saya = false;
    await buka();
    expect(screen.queryByRole('button', { name: 'Setujui' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ambil alih' })).toBeTruthy();
  });

  it('konflik versi menampilkan pesan dan tombol muat ulang', async () => {
    putusanHasil = () => galat('KONFLIK_VERSI', 409);
    await buka();
    fireEvent.click(screen.getByRole('button', { name: 'Setujui' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('berubah atau telah diambil');
    expect(screen.getByRole('button', { name: 'Muat ulang tugas' })).toBeTruthy();
  });
});

describe('profil mandiri dan revisi pemilik (butir 2)', () => {
  const detail = {
    id: pid, jenis: 'profil', nama: 'Kopi Lampung', status: 'diajukan', versi: 1, mendesak: false,
    dibuat_pada: '2026-11-09T02:00:00Z', petugas_id: 'staf', petugas_nama: 'Sari', tanpa_nomor: false,
    peringatan_kontak: [], dipegang_saya: true, sumber: 'mandiri', sumber_ref: null,
    revisi: {
      id: 'r', profil_id: pid, versi: 1, nama: 'Kopi Lampung', deskripsi: 'Kopi', alamat: null, jenis: 'Minuman',
      kategori: 'Kopi', spesifik: null, kabupaten_kota: 'Lampung Barat', memiliki_nib: null, instagram: null,
      tiktok: null, dibuat_oleh: null, dibuat_pada: '2026-11-09T02:00:00Z', keputusan: null,
    },
    foto: [], izin_status: null,
    pemilik: { nama: 'Budi Santoso', hp: '081377778888', email: null },
  } as unknown as Detail;

  it('menampilkan tanda sumber dan keterangan pemilik', () => {
    render(<DetailTugas detail={detail as Parameters<typeof DetailTugas>[0]['detail']}
      onChanged={vi.fn()} onEdit={vi.fn()} onBack={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText(/Didaftarkan pemilik/)).toBeTruthy();
    const pemilik = screen.getByRole('region', { name: 'Akun pemilik' });
    expect(pemilik.textContent).toContain('Budi Santoso');
    expect(pemilik.textContent).toContain('081377778888');
    expect(pemilik.textContent).toContain('Tidak ada');
  });

  it('profil petugas tanpa pemilik tidak menampilkan bagian pemilik', () => {
    render(<DetailTugas detail={{ ...detail, sumber: 'kurasi', pemilik: null } as unknown as Detail}
      onChanged={vi.fn()} onEdit={vi.fn()} onBack={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Akun pemilik' })).toBeNull();
    expect(screen.queryByText(/Didaftarkan pemilik/)).toBeNull();
  });
});
