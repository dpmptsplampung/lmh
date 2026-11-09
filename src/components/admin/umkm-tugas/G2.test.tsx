// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Detail, DetailPesan, DetailLaporan } from '@/lib/umkm-katalog/types';
import TugasUmkm from './TugasUmkm';

const profileId = '10000000-0000-4000-8000-000000000001';
const messageId = '10000000-0000-4000-8000-000000000002';
const reportId = '10000000-0000-4000-8000-000000000003';
const base = {
  versi: 1, dibuat_pada: '2026-11-09T02:00:00Z', petugas_id: 'staf', petugas_nama: 'Sari',
  dipegang_saya: true, mendesak: false,
};
const profile: Detail = {
  ...base, id: profileId, jenis: 'profil', nama: 'Kopi Lampung', status: 'terbit', mendesak: true,
  tanpa_nomor: true, peringatan_kontak: [], sumber: 'kurasi', sumber_ref: null, izin_status: null, foto: [],
  revisi: { id: 'revisi', profil_id: profileId, versi: 1, nama: 'Kopi Lampung', deskripsi: 'Kopi setempat',
    alamat: null, jenis: 'Produk', kategori: 'Minuman', spesifik: null, kabupaten_kota: 'Lampung Barat',
    memiliki_nib: null, instagram: null, tiktok: null, dibuat_oleh: 'staf',
    dibuat_pada: base.dibuat_pada, keputusan: 'terbit' },
};
const message: DetailPesan = {
  ...base, id: messageId, jenis: 'pesan', nama: 'Pesan kontak', status: 'baru', alasan: null,
  profil_id: profileId, profil_nama: 'Kopi Lampung', nama_pengirim: 'Pengirim Uji', perusahaan: 'Usaha Uji',
  nomor: '081200001111', pesan: 'Mencari kopi', kata_kunci: null, pemeriksa_nama: 'Sari', dibalas_pada: null,
};
const report: DetailLaporan = {
  ...base, id: reportId, jenis: 'laporan', nama: 'Laporan profil', status: 'baru', alasan: 'nomor_tampil',
  mendesak: true, profil_id: profileId, profil_nama: 'Kopi Lampung', catatan: 'Nomor di foto',
  foto_id: 'foto', pemeriksa_nama: 'Sari', selesai_pada: null,
};
let fetchMock: ReturnType<typeof vi.fn>;
let currentMessage: DetailPesan;
let currentReport: DetailLaporan;
let currentProfile: Detail;
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data })));
beforeEach(() => {
  currentMessage = structuredClone(message); currentReport = structuredClone(report);
  currentProfile = structuredClone(profile);
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (url.endsWith('/foto-publikasi')) return ok({ id: profileId,
        foto_publikasi: { status: 'selesai', tertunda: 0, hapus_tertunda: 0 } });
      const current = url.includes('/pesan/') ? currentMessage : url.includes('/laporan/')
        ? currentReport : currentProfile;
      current.versi += 1; current.dipegang_saya = true;
      if (url.endsWith('/ambil')) { current.petugas_id = 'staf'; current.petugas_nama = 'Sari'; }
      if (url.endsWith('/selesai')) current.status = 'ditangani';
      if (url.endsWith('/selesai-mendesak')) current.mendesak = false;
      return ok({ id: current.id, versi: current.versi, status: current.status, jenis: current.jenis });
    }
    if (url.includes(`/pesan/${messageId}`)) return ok(currentMessage);
    if (url.includes(`/laporan/${reportId}`)) return ok(currentReport);
    if (url.endsWith(`/${profileId}`)) return ok(currentProfile);
    return ok({ items: [currentReport, currentProfile, currentMessage], next_cursor: null });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('tugas campuran G2', () => {
  it('satu daftar mempertahankan urutan server dan tidak mengambil isi atau kontak sebelum dibuka', async () => {
    render(<TugasUmkm />);
    await screen.findByRole('button', { name: 'Periksa Pesan kontak' });
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Laporan profil');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('081200001111');
    expect(screen.getAllByText('sedang dipegang Sari').length).toBe(3);
  });

  it('pesan menampilkan kontak pengirim, template tanpa nomor UMKM dan selesai satu klik', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    render(<TugasUmkm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Periksa Pesan kontak' }));
    expect(await screen.findByText('081200001111')).toBeTruthy();
    const whatsapp = screen.getByRole('link', { name: 'Balas dari WhatsApp pribadi saya' });
    expect(whatsapp.getAttribute('href')).toMatch(/^https:\/\/wa.me\/6281200001111\?text=/);
    expect(decodeURIComponent(whatsapp.getAttribute('href')!)).toContain('Saat ini LMH belum membagikan nomor UMKM.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salin teks balasan' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Salin teks balasan' }));
    await screen.findByText('Teks balasan disalin.');
    expect(clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Halo Pengirim Uji, saya Sari'));
    fireEvent.click(screen.getByRole('button', { name: 'Tandai sudah dibalas' }));
    await screen.findByText('Pesan ditandai sudah dibalas.');
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('laporan menyediakan selesai dan jalan pintas koreksi atau sembunyikan', async () => {
    render(<TugasUmkm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Periksa Laporan profil' }));
    expect(await screen.findByText('Nomor kontak tampil')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Selesai' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Koreksi atau sembunyikan profil' }));
    expect(await screen.findByRole('heading', { name: 'Kopi Lampung' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sembunyikan profil' })).toBeTruthy();
  });

  it('ambil alih pesan satu klik dan keputusan tersedia sesudahnya tanpa timer', async () => {
    currentMessage.dipegang_saya = false; currentMessage.petugas_nama = 'Petugas lain';
    render(<TugasUmkm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Periksa Pesan kontak' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ambil alih' }));
    await screen.findByRole('button', { name: 'Tandai sudah dibalas' });
    expect(fetchMock.mock.calls.some(([url]) => url === `/api/admin/umkm-tugas/pesan/${messageId}/ambil`)).toBe(true);
    expect(document.body.textContent).not.toMatch(/kedaluwarsa|menit tersisa/i);
  });

  it('profil mendesak selesai satu klik tanpa mengubah status terbit', async () => {
    render(<TugasUmkm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Periksa Kopi Lampung' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Selesaikan pemeriksaan mendesak' }));
    await screen.findByText('Keputusan tersimpan.');
    expect(currentProfile.mendesak).toBe(false);
    expect(currentProfile.status).toBe('terbit');
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('foto tertunda tetap menawarkan retry tanpa mengirim ulang keputusan', async () => {
    currentProfile.foto_publikasi_tertunda = 1;
    render(<TugasUmkm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Periksa Kopi Lampung' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Coba lagi menampilkan foto publik' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/foto-publikasi'))).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/foto-publikasi'))!;
    expect(JSON.parse(call[1].body)).toEqual({});
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/putusan'))).toBe(false);
  });

  it('foto disembunyikan dengan hapus gagal tetap menawarkan retry sampai salinan dibersihkan', async () => {
    currentProfile.foto_publikasi_tertunda = 0;
    currentProfile.foto_hapus_tertunda = 1;
    currentProfile.foto = [{ id: 'foto-uji', revisi_id: 'revisi', asal: 'unggahan', url: null,
      r2_key: 'umkm-draf/uji.webp', tersembunyi: true, perlu_review: false,
      diperiksa_oleh: 'staf', diperiksa_pada: base.dibuat_pada }];
    const original = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    let attempts = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/foto-publikasi') && init?.method === 'POST') {
        attempts += 1;
        currentProfile.foto_hapus_tertunda = attempts < 2 ? 1 : 0;
        return ok({ id: profileId, foto_publikasi: {
          status: attempts < 2 ? 'tertunda' : 'selesai', tertunda: 0,
          hapus_tertunda: currentProfile.foto_hapus_tertunda,
        } });
      }
      return original(url, init);
    });
    render(<TugasUmkm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Periksa Kopi Lampung' }));
    expect(await screen.findByText('Foto disembunyikan')).toBeTruthy();
    expect(screen.getByText('Sebagian salinan foto yang disembunyikan belum dapat dibersihkan.')).toBeTruthy();
    expect(screen.queryByText(/Sebagian foto belum dapat ditampilkan/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi membersihkan foto publik' }));
    await waitFor(() => expect(attempts).toBe(1));
    await waitFor(() => expect(screen.getByRole('button', {
      name: 'Coba lagi membersihkan foto publik',
    })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi membersihkan foto publik' }));
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(screen.queryByRole('button', {
      name: 'Coba lagi membersihkan foto publik',
    })).toBeNull());
    expect(fetchMock.mock.calls.some(([url]) => /\/(putusan|visibilitas)$/.test(url))).toBe(false);
  });

  it('menyebut publikasi dan penghapusan bila keduanya tertunda', async () => {
    currentProfile.foto_publikasi_tertunda = 1;
    currentProfile.foto_hapus_tertunda = 1;
    render(<TugasUmkm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Periksa Kopi Lampung' }));
    expect(await screen.findByText(/Sebagian foto belum dapat ditampilkan/)).toBeTruthy();
    expect(screen.getByText('Sebagian salinan foto yang disembunyikan belum dapat dibersihkan.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coba lagi memproses foto publik' })).toBeTruthy();
  });
});
