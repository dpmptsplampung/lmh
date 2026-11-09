// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PengawasanUmkm from './PengawasanUmkm';

const rid = '20000000-0000-4000-8000-000000000001';
const summary = {
  profil: { diajukan: 0, terbit: 3, disembunyikan: 0, ditolak: 0 }, tugas_terbuka: 1, mendesak: 0,
  pesan: { baru: 0, ditangani: 0 }, laporan_terbuka: 0, rata_pemeriksaan_detik: null, rata_balasan_pertama_detik: null,
  permintaan: { diajukan: 4, menunggu_izin: 2, nomor_dibuka: 7, ditolak: 1, dibatalkan: 0 },
  rata_keputusan_detik: 5400,
};
// Server tidak mengirim data pemohon; sisipan ini membuktikan layar tidak pernah merendernya.
const baris = (extra: Record<string, unknown> = {}) => ({
  id: 'j1', aksi: 'setujui', peran: 'petugas', aktor_nama: 'Sari', dibuat_pada: '2026-11-09T02:00:00Z',
  status_lama: 'menunggu_izin', status_baru: 'nomor_dibuka', alasan: null, profil_id: 'p', profil_nama: 'Kopi Lampung',
  permintaan_id: rid, permintaan_versi: 3, permintaan_kode: 'UM-3F9A1C2B7D4E', permintaan_status: 'nomor_dibuka', ...extra,
});
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data })));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return ok({ id: rid, status: 'nomor_dibuka', versi: 4, tahan_darurat: true });
    if (url.includes('/jejak')) return ok({ items: [
      baris({ nomor: '081211112222', nama_pemohon: 'Rina Rahasia', pemohon: { hp: '081300002222' },
        perusahaan: 'PT Rahasia' }),
      baris({ id: 'j2', aksi: 'tolak', permintaan_status: 'ditolak', permintaan_kode: 'UM-WXYZ' }),
      baris({ id: 'j3', aksi: 'simpan', permintaan_id: null, permintaan_versi: null,
        permintaan_kode: null, permintaan_status: null }),
    ], next_cursor: null });
    return ok(summary);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('pengawasan permintaan (butir 5)', () => {
  it('ringkasan menampilkan hitungan per status dan lama proses', async () => {
    render(<PengawasanUmkm />);
    const kartu = await screen.findByRole('region', { name: 'Permintaan kontak' });
    expect(kartu).toHaveTextContent('Diajukan4');
    expect(kartu).toHaveTextContent('Menunggu izin2');
    expect(kartu).toHaveTextContent('Nomor dibuka7');
    expect(kartu).toHaveTextContent('Rata-rata lama sampai keputusan1,5 jam');
  });

  it('jejak tidak pernah menampilkan nomor atau data pemohon, hanya kode permintaan', async () => {
    render(<PengawasanUmkm />);
    await screen.findByText('Permintaan disetujui', { selector: 'strong' });
    const teks = document.body.textContent ?? '';
    for (const rahasia of ['081211112222', '081300002222', 'Rina Rahasia', 'PT Rahasia']) {
      expect(teks).not.toContain(rahasia);
    }
    expect(teks).toContain('UM-3F9A1C2B7D4E');
    expect(screen.queryByRole('button', { name: /Lihat nomor/ })).toBeNull();
  });

  it('Tahan permintaan memakai id dan versi terkini, hanya pada permintaan yang bisa ditahan', async () => {
    render(<PengawasanUmkm />);
    await screen.findByText('Permintaan disetujui', { selector: 'strong' });
    expect(screen.queryByRole('button', { name: 'Tahan permintaan UM-WXYZ' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tahan permintaan UM-3F9A1C2B7D4E' }));
    const kirim = screen.getByRole('button', { name: 'Tahan permintaan' });
    fireEvent.change(screen.getByRole('textbox', { name: /Alasan singkat/ }),
      { target: { value: 'Pemilik menelepon' } });
    fireEvent.click(kirim);
    await screen.findByText(/Permintaan ditahan/);
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe(`/api/admin/umkm-pengawasan/permintaan/${rid}/tahan`);
    expect(JSON.parse(post[1].body)).toMatchObject({ alasan: 'Pemilik menelepon', expected_version: 3 });
    expect(JSON.parse(post[1].body).operasi_id).toBeTruthy();
  });

  it('konflik versi memberi pesan tenang tanpa membocorkan isi', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(new Response(
        JSON.stringify({ error: { code: 'KONFLIK_VERSI', message: 'nomor 0812 internal' } }), { status: 409 }));
      return url.includes('/jejak') ? ok({ items: [baris()], next_cursor: null }) : ok(summary);
    });
    render(<PengawasanUmkm />);
    await screen.findByText('Permintaan disetujui', { selector: 'strong' });
    fireEvent.click(screen.getByRole('button', { name: 'Tahan permintaan UM-3F9A1C2B7D4E' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Alasan singkat/ }), { target: { value: 'Darurat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tahan permintaan' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveTextContent('Permintaan sudah berubah'));
    expect(alert).not.toHaveTextContent('0812');
  });
});
