// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetailPermintaan } from '@/lib/umkm-katalog/types-g4';
import TugasUmkm from './TugasUmkm';

const rid = '20000000-0000-4000-8000-000000000001';
const pid = '10000000-0000-4000-8000-000000000001';
const dasar: DetailPermintaan = {
  id: rid, jenis: 'permintaan', nama: 'Permintaan kontak', profil_id: pid, profil_nama: 'Kopi Lampung',
  status: 'diajukan', versi: 1, mendesak: false, petugas_id: 'staf', petugas_nama: 'Sari',
  dibuat_pada: '2026-11-09T02:00:00Z', kode: 'UM-3F9A1C2B7D4E',
  kebutuhan: { id: 'k', teks: 'Kopi 50 kg', kategori: 'Minuman', kabupaten_kota: 'Lampung Barat',
    status: 'aktif', dibuat_pada: '2026-11-09T01:00:00Z' },
  perusahaan: { id: 'p', nama: 'PT Maju', jabatan: 'Pembeli', diperiksa: false },
  pemohon: { nama: 'Rina', hp: '081300002222', email: null },
  tertaut: true, dipegang_saya: true, pemeriksa_nama: 'Sari', profil_versi: 4, izin_ada: false,
  kontak_ada: true, pembukaan: null, alasan_tolak: null, bantuan: null,
};
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data })));
const galat = (code: string, status: number) => Promise.resolve(
  new Response(JSON.stringify({ error: { code, message: 'x' } }), { status }));
let cur: DetailPermintaan;
let fetchMock: ReturnType<typeof vi.fn>;
let setujuiHasil: () => Promise<Response>;
let pemberitahuanHasil: () => Promise<Response>;
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
  .map(([url, init]) => [url as string, JSON.parse(init!.body as string)] as const);

// Server tiruan yang mengubah `cur` sesudah mutasi, seperti RPC asli, supaya layar diuji mengikuti status baru.
const mutasi = (status = cur.status, pembukaan_id: string | null = null) => ok({
  id: rid, jenis: 'permintaan', status, versi: cur.versi, tahan_darurat: cur.mendesak, pembukaan_id });
beforeEach(() => {
  cur = structuredClone(dasar);
  pemberitahuanHasil = () => ok({ ok: true });
  setujuiHasil = () => {
    if (!cur.izin_ada) {
      cur.status = 'menunggu_izin'; cur.versi += 1; return mutasi();
    }
    cur.status = 'nomor_dibuka'; cur.versi += 1;
    cur.pembukaan = { id: 'b', dibuat_pada: '2026-11-09T03:00:00Z', hasil: 'belum_diketahui', petugas_nama: 'Sari' };
    return mutasi(cur.status, 'b');
  };
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (url.endsWith('/setujui')) return setujuiHasil();
      if (url.endsWith('/kontak')) return ok({ nomor: '081211112222' });
      if (url.endsWith('/izin')) { cur.izin_ada = true; cur.profil_versi += 1; return ok({ ok: true }); }
      if (url.endsWith('/tolak')) { cur.status = 'ditolak'; cur.versi += 1; return mutasi(); }
      if (url.endsWith('/lepas-tahan')) { cur.mendesak = false; cur.versi += 1; return mutasi(); }
      if (url.endsWith('/pemberitahuan')) return pemberitahuanHasil();
      return mutasi();
    }
    if (url.endsWith(`/permintaan/${rid}`)) return ok(cur);
    return ok({ items: [{ ...cur }], next_cursor: null });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); });

const buka = async () => {
  render(<TugasUmkm />);
  fireEvent.click(await screen.findByRole('button', { name: 'Periksa Permintaan UM-3F9A1C2B7D4E: Kopi Lampung' }));
  await screen.findByRole('heading', { name: 'Permintaan UM-3F9A1C2B7D4E' });
};

describe('permintaan di daftar tugas (butir 1)', () => {
  it('butir tampil di daftar dan detail memuat Kebutuhan, perusahaan, pemohon, dan tanda periksa', async () => {
    await buka();
    for (const teks of ['Kopi 50 kg', 'PT Maju, Pembeli', 'Rina', '081300002222', 'Perusahaan belum diperiksa']) {
      expect(screen.getAllByText(new RegExp(teks)).length).toBeGreaterThan(0);
    }
  });

  it('Setujui satu klik memindahkan layar ke menunggu izin, lalu Tolak dua klik dengan alasan', async () => {
    await buka();
    fireEvent.click(screen.getByRole('button', { name: 'Setujui' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe(`/api/admin/umkm-tugas/permintaan/${rid}/setujui`);
    expect(posts()[0][1]).toMatchObject({ expected_version: 1 });
    expect(await screen.findByRole('region', { name: 'Langkah izin UMKM' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Setujui lagi' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tolak' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Alasan tolak/ }), { target: { value: 'Belum cocok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim penolakan' }));
    await waitFor(() => expect(posts().some(([u]) => u.endsWith('/tolak'))).toBe(true));
    const tolak = posts().find(([u]) => u.endsWith('/tolak'))!;
    expect(tolak[1]).toMatchObject({ alasan: 'Belum cocok', expected_version: 2 });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Setujui lagi' })).toBeNull());
  });

  it('belum tertaut: Setujui menampilkan penjelasan tanpa nomor', async () => {
    setujuiHasil = () => galat('BELUM_TERTAUT', 409);
    await buka();
    fireEvent.click(screen.getByRole('button', { name: 'Setujui' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('belum menautkan akunnya');
  });

  it('menunggu izin: empat langkah, lihat nomor, catat izin dengan versi profil, lalu Setujui lagi', async () => {
    cur.status = 'menunggu_izin';
    await buka();
    expect(screen.getByRole('region', { name: 'Langkah izin UMKM' })).toBeTruthy();
    const teks = screen.getByText(/Bolehkah nomor Anda kami tampilkan/);
    expect(teks.textContent).toContain('Halo Kopi Lampung, saya Sari');
    expect(teks.textContent).toContain('PT Maju ingin membeli Kopi 50 kg');
    expect(teks.textContent).toContain('Kode: UM-3F9A1C2B7D4E');
    fireEvent.click(screen.getByRole('button', { name: 'Lihat nomor' }));
    await screen.findByText('081211112222');
    expect(posts()[0][0]).toBe(`/api/admin/umkm-tugas/${pid}/kontak`);
    expect(JSON.stringify(window.localStorage) + JSON.stringify(window.sessionStorage)).not.toContain('0812');
    fireEvent.click(screen.getByRole('button', { name: 'Catat izin diberikan' }));
    await waitFor(() => expect(posts().some(([u]) => u.endsWith('/izin'))).toBe(true));
    const izin = posts().find(([u]) => u.endsWith('/izin'))!;
    expect(izin[0]).toBe(`/api/admin/umkm-tugas/${pid}/izin`);
    expect(izin[1]).toMatchObject({ status: 'diberikan', expected_version: 4 });
    fireEvent.click(await screen.findByRole('button', { name: 'Setujui lagi' }));
    expect(await screen.findByRole('region', { name: 'Sesudah nomor dibuka' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Langkah izin UMKM' })).toBeNull();
    expect(posts().filter(([u]) => u.endsWith('/setujui'))).toHaveLength(1);
  });

  it('ditahan: Setujui tidak ada dan Lepas tahan satu klik mengembalikan Setujui', async () => {
    cur.mendesak = true;
    await buka();
    expect(screen.queryByRole('button', { name: 'Setujui' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lepas tahan' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe(`/api/admin/umkm-tugas/permintaan/${rid}/lepas-tahan`);
    expect(await screen.findByRole('button', { name: 'Setujui' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lepas tahan' })).toBeNull();
  });

  it.each(['nomor_dibuka', 'dibatalkan'] as const)(
    'ditahan pada status %s: Lepas tahan tetap tersedia bagi pemegang (K01)', async (status) => {
      cur.status = status; cur.mendesak = true;
      await buka();
      expect(screen.queryByRole('button', { name: 'Setujui' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Lepas tahan' }));
      await waitFor(() => expect(posts()[0]?.[0]).toBe(`/api/admin/umkm-tugas/permintaan/${rid}/lepas-tahan`));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Lepas tahan' })).toBeNull());
    });

  it('ditahan dan dipegang orang lain: tombol Ambil alih tersedia, Lepas tahan tidak (K01)', async () => {
    cur.status = 'dibatalkan'; cur.mendesak = true; cur.dipegang_saya = false; cur.petugas_nama = 'Budi';
    await buka();
    expect(screen.queryByRole('button', { name: 'Lepas tahan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ambil alih' }));
    await waitFor(() => expect(posts()[0]?.[0]).toBe(`/api/admin/umkm-tugas/permintaan/${rid}/ambil`));
  });

  it('pegangan orang lain: tombol keputusan tidak tampil, ambil alih tersedia', async () => {
    cur.dipegang_saya = false; cur.petugas_nama = 'Budi';
    await buka();
    expect(screen.queryByRole('button', { name: 'Setujui' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ambil alih' })).toBeTruthy();
  });
});

describe('pemberitahuan WhatsApp dan hasil (butir 2)', () => {
  beforeEach(() => {
    cur.status = 'nomor_dibuka';
    cur.pembukaan = { id: 'b', dibuat_pada: '2026-11-09T03:00:00Z', hasil: 'belum_diketahui', petugas_nama: 'Sari' };
  });

  it('tautan wa.me ke HP pemohon memakai templat tanpa nomor UMKM dan mencatat satu panggilan', async () => {
    await buka();
    const tautan = screen.getByRole('link', { name: 'Kirim pemberitahuan WhatsApp' });
    expect(tautan.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/6281300002222\?text=/);
    const teks = decodeURIComponent(tautan.getAttribute('href')!);
    expect(teks).toContain('Permintaan UM-3F9A1C2B7D4E untuk Kopi Lampung disetujui');
    expect(teks).toContain('/me/umkm');
    expect(teks).not.toContain('0812');
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(tautan);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe(`/api/admin/umkm-tugas/permintaan/${rid}/pemberitahuan`);
  });

  it('pencatatan gagal: pesan tenang, Catat lagi hanya memanggil pencatatan (K05)', async () => {
    pemberitahuanHasil = () => galat('GAGAL_INTERNAL', 500);
    await buka();
    fireEvent.click(screen.getByRole('link', { name: 'Kirim pemberitahuan WhatsApp' }));
    const pesan = await screen.findByText('Pemberitahuan belum tercatat.');
    expect(pesan.closest('[role="status"]')?.textContent).not.toMatch(/terkirim|diterima/);
    pemberitahuanHasil = () => ok({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Catat lagi' }));
    await waitFor(() => expect(screen.queryByText('Pemberitahuan belum tercatat.')).toBeNull());
    expect(posts().map(([u]) => u.split('/').pop())).toEqual(['pemberitahuan', 'pemberitahuan']);
  });

  it('hasil dicatat satu klik', async () => {
    await buka();
    fireEvent.click(screen.getByRole('button', { name: 'Kerja sama' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toEqual([`/api/admin/umkm-tugas/permintaan/${rid}/hasil`, { hasil: 'kerja_sama' }]);
  });

  it('tanpa HP pemohon tidak ada tautan WhatsApp', async () => {
    cur.pemohon.hp = null;
    await buka();
    expect(screen.queryByRole('link', { name: 'Kirim pemberitahuan WhatsApp' })).toBeNull();
    expect(screen.getByText(/tidak punya HP tercatat/)).toBeTruthy();
  });
});

describe('pencarian kode permintaan (butir 4)', () => {
  it('kotak cari yang sama mengirim kode ke rute cari', async () => {
    render(<TugasUmkm />);
    await screen.findByRole('button', { name: /Periksa Permintaan/ });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cari nama usaha' }), { target: { value: 'um-abcd' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/cari?q=um-abcd'))).toBe(true));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('pembanding bantuan (R-1)', () => {
  const bantuan = { nama: 'Bu Rina', kontak: '081300009999' };

  it('tertaut: kontak petugas dan akun penaut tampil berdampingan dengan peringatan', async () => {
    cur.bantuan = bantuan;
    cur.pemohon = { nama: 'Rina', hp: '081300002222', email: 'rina@contoh.id' };
    await buka();
    const bagian = screen.getByRole('region', { name: 'Pembanding bantuan' });
    expect(bagian.textContent).toContain('Dicatat petugas: Bu Rina, 081300009999');
    expect(bagian.textContent).toContain('Akun yang menautkan: Rina, 081300002222, rina@contoh.id');
    expect(bagian.textContent).toContain('Pastikan keduanya orang yang sama sebelum menekan Setujui.');
  });

  it('bantuan null atau belum tertaut: pembanding tidak tampil', async () => {
    cur.bantuan = null;
    await buka();
    expect(screen.queryByRole('region', { name: 'Pembanding bantuan' })).toBeNull();
    cleanup();
    cur.bantuan = bantuan; cur.tertaut = false;
    await buka();
    expect(screen.queryByRole('region', { name: 'Pembanding bantuan' })).toBeNull();
  });
});
