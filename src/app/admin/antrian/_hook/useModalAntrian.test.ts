// @vitest-environment jsdom
// Kontrak useModalAntrian (rencana refaktor 2026-11-11 tugas 5.3): satu state untuk tujuh modal halaman antrean.
// Kontrak kritis (dikunci juga oleh antrian.aksi.test.tsx): dialog tiket memanggil `await onSuccess(); onClose()` dan
// onSuccess dapat membuka QR Pesan Perilaku. Penutup dialog sumber TIDAK boleh ikut menutup QR yang baru dibuka, walau
// penutup itu closure dari render lama.
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TiketBaris } from '@/lib/data/antrean';
import { useModalAntrian } from './useModalAntrian';

const tiket = (over: Partial<TiketBaris> = {}): TiketBaris => ({
  id: 't-1',
  kunjungan_id: 'k-1',
  legacy_visit_id: 'v-1',
  layanan_id: 'l-1',
  dilayani_oleh: null,
  penanganan_asal_id: null,
  pelayan: null,
  nomor: 1,
  nomor_display: 'A-001',
  status: 'dilayani',
  waktu_terbit: null,
  waktu_mulai_layan: null,
  waktu_selesai: null,
  layanan: { nama: 'Helpdesk OSS', form_pendataan: 'oss' },
  kunjungan: { nama: 'Budi', asal: 'walk_in', waktu_masuk: null },
  ...over,
});

const pasang = (daftar: TiketBaris[][] = [[tiket()]]) =>
  renderHook(({ d }) => useModalAntrian(d), { initialProps: { d: daftar } });

describe('useModalAntrian: buka dan tutup', () => {
  it('awal: tidak ada modal; buka satu jenis = hanya jenis itu yang terbuka, membawa tiketnya', () => {
    const { result } = pasang();
    expect(result.current.utama).toBeNull();
    expect(result.current.qr).toBeNull();
    const t = tiket();
    act(() => result.current.buka('ambilAlih', t));
    expect(result.current.utama).toEqual({ jenis: 'ambilAlih', tiket: t });
    expect(result.current.utama?.tiket).toBe(t);
    expect(result.current.qr).toBeNull();
  });

  it('dialog tiket saling meniadakan: membuka jenis lain menggantikan yang terbuka', () => {
    const { result } = pasang();
    act(() => result.current.buka('alihkan', tiket()));
    act(() => result.current.buka('wizard', tiket({ id: 't-2' })));
    expect(result.current.utama?.jenis).toBe('wizard');
    expect(result.current.utama?.tiket.id).toBe('t-2');
  });

  it('tutup(jenis) hanya menutup modal yang MASIH berjenis sama', () => {
    const { result } = pasang();
    act(() => result.current.buka('koreksi', tiket()));
    act(() => result.current.tutup('wizard'));
    expect(result.current.utama?.jenis).toBe('koreksi');
    act(() => result.current.tutup('koreksi'));
    expect(result.current.utama).toBeNull();
  });

  it('penutup basi dari render lama tidak menutup dialog lain yang dibuka sesudahnya', () => {
    const { result } = pasang();
    act(() => result.current.buka('ambilAlih', tiket()));
    const tutupLama = result.current.tutup;
    act(() => result.current.buka('wizard', tiket()));
    act(() => tutupLama('ambilAlih'));
    expect(result.current.utama?.jenis).toBe('wizard');
  });
});

describe('useModalAntrian: QR Pesan Perilaku', () => {
  it('KONTRAK: `await onSuccess(); onClose()` dengan onSuccess membuka QR -> QR tetap terbuka setelah dialog sumber menutup', async () => {
    for (const jenis of ['ambilAlih', 'alihkan', 'kembalikanKeFo', 'selesaiEskalasi', 'koreksi', 'wizard'] as const) {
      const { result, unmount } = pasang([[tiket({ kunjungan_id: 'k-7' })]]);
      act(() => result.current.buka(jenis, tiket()));
      // Seperti komponen dialog: kedua callback adalah props dari render saat dialog terbuka (closure lama).
      const { bukaQrTiket: onSuccess, tutup } = result.current;
      const onClose = () => tutup(jenis);
      await act(async () => {
        await Promise.resolve(onSuccess('t-1'));
        onClose();
      });
      expect(result.current.utama, jenis).toBeNull();
      expect(result.current.qr?.tiket.kunjungan_id, jenis).toBe('k-7');
      unmount();
    }
  });

  it('"basi" (onSuccess tanpa onClose): QR terbuka DI ATAS dialog sumber yang tetap terbuka', () => {
    const { result } = pasang();
    act(() => result.current.buka('selesaiEskalasi', tiket()));
    act(() => result.current.bukaQrTiket('t-1'));
    expect(result.current.utama?.jenis).toBe('selesaiEskalasi');
    expect(result.current.qr?.tiket.id).toBe('t-1');
  });

  it('menutup QR tidak menutup dialog tiket; menutup dialog tiket tidak menutup QR', () => {
    const { result } = pasang();
    act(() => result.current.buka('selesaiEskalasi', tiket()));
    act(() => result.current.bukaQrTiket('t-1'));
    act(() => result.current.tutup('surveiQr'));
    expect(result.current.qr).toBeNull();
    expect(result.current.utama?.jenis).toBe('selesaiEskalasi');
    act(() => result.current.bukaQrTiket('t-1'));
    act(() => result.current.tutup('selesaiEskalasi'));
    expect(result.current.utama).toBeNull();
    expect(result.current.qr).not.toBeNull();
  });

  it('membuka dialog tiket lain tidak menutup QR yang sedang tampil', () => {
    const { result } = pasang();
    act(() => result.current.buka('surveiQr', tiket()));
    act(() => result.current.buka('wizard', tiket()));
    expect(result.current.qr).not.toBeNull();
    expect(result.current.utama?.jenis).toBe('wizard');
  });

  it('bukaQrTiket mencari tiket di daftar yang diberikan (tabel lalu panel); tak ditemukan / tanpa kunjungan = tidak membuka', () => {
    const { result, rerender } = pasang([[tiket({ id: 't-1', kunjungan_id: 'k-1' })], [tiket({ id: 't-9', kunjungan_id: 'k-9' })]]);
    act(() => result.current.bukaQrTiket('t-9'));
    expect(result.current.qr?.tiket.kunjungan_id).toBe('k-9');
    act(() => result.current.tutup('surveiQr'));
    act(() => result.current.bukaQrTiket('t-x'));
    expect(result.current.qr).toBeNull();
    act(() => result.current.bukaQrTiket(null));
    expect(result.current.qr).toBeNull();
    rerender({ d: [[tiket({ id: 't-2', kunjungan_id: '' })]] });
    act(() => result.current.bukaQrTiket('t-2'));
    expect(result.current.qr).toBeNull();
  });

  it('tiket yang sama ditemukan di tabel dan panel: baris tabel yang dipakai', () => {
    const { result } = pasang([[tiket({ id: 't-1', kunjungan_id: 'k-tabel' })], [tiket({ id: 't-1', kunjungan_id: 'k-panel' })]]);
    act(() => result.current.bukaQrTiket('t-1'));
    expect(result.current.qr?.tiket.kunjungan_id).toBe('k-tabel');
  });

  it('membuka QR kunjungan yang sama dua kali tidak mengganti state (dialog QR tidak dipasang ulang)', () => {
    const { result } = pasang();
    act(() => result.current.bukaQrTiket('t-1'));
    const pertama = result.current.qr;
    act(() => result.current.bukaQrTiket('t-1'));
    expect(result.current.qr).toBe(pertama);
  });
});
