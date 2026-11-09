// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PengawasanUmkm from './PengawasanUmkm';

const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data })));
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/jejak')) return ok({ items: [{
      id: 'j1', aksi: 'putusan_klaim', peran: 'petugas', aktor_nama: 'Sari', dibuat_pada: '2026-11-09T02:00:00Z',
      status_lama: 'diajukan', status_baru: 'disetujui', alasan: null, profil_id: 'p', profil_nama: 'Kopi Lampung',
      permintaan_id: null, permintaan_versi: null, permintaan_kode: null, permintaan_status: null,
      // Server tidak mengirim ini; sisipan membuktikan layar tidak pernah merendernya.
      pemilik: { nama: 'Budi Rahasia', hp: '081377778888', email: 'budi@rahasia.id' }, alasan_klaim: 'Alasan rahasia',
    }], next_cursor: null });
    return ok({
      profil: { diajukan: 0, terbit: 3, disembunyikan: 0, ditolak: 0 }, tugas_terbuka: 5, mendesak: 0,
      pesan: { baru: 0, ditangani: 0 }, laporan_terbuka: 0, rata_pemeriksaan_detik: null,
      rata_balasan_pertama_detik: null, klaim: { diajukan: 2 },
    });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('pengawasan FO dan klaim (butir 3)', () => {
  it('hanya hitungan: tidak ada data pemilik atau alasan klaim', async () => {
    render(<PengawasanUmkm />);
    await screen.findByText('Tugas terbuka');
    await screen.findByText(/Kopi Lampung/);
    const teks = document.body.textContent ?? '';
    for (const rahasia of ['Budi Rahasia', '081377778888', 'budi@rahasia.id', 'Alasan rahasia']) {
      expect(teks).not.toContain(rahasia);
    }
    expect(screen.getByText('Tugas terbuka').nextSibling?.textContent).toBe('5');
  });
});
