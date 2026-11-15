'use client';

// Aksi tiket di halaman antrean (rencana refaktor 2026-11-11 tugas 5.3). Transisi status lewat RPC atomik di
// lib/data/antrean.ts (hasil HasilAntrean, tanpa toast); hook ini memutuskan toast, muat ulang, dan modal berikutnya.
//   - Panggil -> panggil_tiket. Tiap panggilan sukses = satu kejadian baru di layar TV (pita + bunyi); panggil ulang sengaja
//     diizinkan berkali-kali, kunci hanya selama request berjalan dan JEDA_PANGGIL_MS (penjaga klik ganda tak sengaja).
//   - Mulai Layanan -> layanan_mulai: pemenang menjadi pemilik tiket; layanan berformulir lalu membuka wizard pendataan.
//   - Selesai -> wizard (layanan berformulir), dialog topik + catatan (tiket eskalasi tanpa formulir), atau layanan_selesai.
//
// Riwayat aturan kepemilikan (dari header halaman lama; WP-22, A3, B4):
// - WP-22: bacaan antrean dipindah dari `visit` ke `tiket_antrean` + `kunjungan`.
// - A3 (migrasi 202610140002_tiket_kepemilikan): transisi status lewat RPC atomik, BUKAN UPDATE langsung `visit`.
//   "Mulai Layanan" = `layanan_mulai` (guard atomik di tiket, satu pemenang, dilayani_oleh = pemanggil); "Selesai" untuk
//   layanan tanpa pendataan = `layanan_selesai` (hanya pemilik tiket); layanan ber-pendataan selesai lewat
//   PelayananWizardModal -> POST /api/admin/pelayanan/[tiketId]. Admin dapat "Ambil alih" tiket yang dilayani orang lain
//   (`admin_ambil_alih`, alasan wajib).
// - B4 (migrasi 202610140004, kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md): tiket HASIL ESKALASI Front Office
//   (`penanganan_asal_id` terisi) menampilkan catatan eskalasi FO. Menyelesaikannya: layanan ber-Pendataan cukup Pendataan
//   (migrasi 202610140015: topik NULL, catatan diturunkan DB); layanan tanpa Pendataan wajib topik + catatan
//   (`layanan_selesai` 5 parameter). Pemilik dapat "Kembalikan ke FO" (`layanan_kembalikan`), Admin dapat "Alihkan"
//   (`admin_alihkan`). Tiket lama (`penanganan_asal_id` null) tetap tanpa topik/catatan.
// - RPC bekerja langsung pada kunjungan/tiket/penanganan (`visit` = arsip sejak WP-24; SKM/notifikasi/estimasi lewat trigger kunjungan).
import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { pesanMutasi } from '@/lib/supabase/mutate';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';
import { kodeGalatDariError, PESAN_GALAT_ANTREAN, tiketHasilEskalasi, type KodeGalatAntrean } from '@/lib/pelayanan';
import {
  galatAntreanDari,
  mulaiLayananTiket,
  panggilTiket,
  selesaikanLayananTiket,
  type HasilAntrean,
  type TiketBaris,
} from '@/lib/data/antrean';
import { punyaPendataan } from '../_logika/turunan';
import type { JenisModalAntrian } from './useModalAntrian';

/** Jeda kunci tombol Panggil setelah panggilan sukses (hanya mencegah klik ganda, bukan batas jumlah panggilan). */
export const JEDA_PANGGIL_MS = 1500;

// Galat RPC yang berarti tampilan antrean basi (tiket berubah di tempat lain) -> muat ulang daftar.
const KODE_MUAT_ULANG: ReadonlySet<KodeGalatAntrean> = new Set<KodeGalatAntrean>([
  'SUDAH_DIAMBIL', 'BUKAN_PEMILIK', 'INVALID_STATUS', 'NOT_FOUND', 'DIVERGENSI', 'TRANSISI_LEWAT_RPC', 'TIKET_LAMA',
]);

type JenisToast = 'success' | 'error' | 'info';

export interface OpsiAksiAntrean {
  toast: (pesan: string, jenis?: JenisToast) => void;
  muatSenyap: () => Promise<void>;
  buka: (jenis: JenisModalAntrian, tiket: TiketBaris) => void;
  bukaQrTiket: (tiketId: string | null) => void;
}

/** Klien dibuat di dalam penjaga: kegagalan apa pun menjadi galat bertipe, bukan penolakan yang lolos. */
async function jalankanRpc<T>(aksi: (sb: ReturnType<typeof createClient>) => Promise<HasilAntrean<T>>) {
  try {
    return await aksi(createClient());
  } catch (e) {
    return { data: null, error: galatAntreanDari(e) } as const;
  }
}

export function useAksiAntrean({ toast, muatSenyap, buka, bukaQrTiket }: OpsiAksiAntrean) {
  // Tiket yang sedang diproses: tombolnya dikunci sampai RPC selesai (ref = penjaga klik ganda sebelum render ulang).
  const [sedangProses, setSedangProses] = useState<ReadonlySet<string>>(new Set());
  const prosesRef = useRef<Set<string>>(new Set());
  const [sedangPanggil, setSedangPanggil] = useState<ReadonlySet<string>>(new Set());
  const panggilRef = useRef<Set<string>>(new Set());
  const [pengumuman, setPengumuman] = useState('');

  const lepasPanggil = (tiketId: string) => {
    panggilRef.current.delete(tiketId);
    setSedangPanggil(new Set(panggilRef.current));
  };

  /** true bila panggilan tersiar ke layar TV (dipakai Panel Sekarang untuk menandai "Sudah dipanggil"). */
  const panggil = async (tiketId: string, nomorDisplay: string): Promise<boolean> => {
    if (panggilRef.current.has(tiketId)) return false;
    panggilRef.current.add(tiketId);
    setSedangPanggil(new Set(panggilRef.current));
    const mulai = Date.now();
    let berhasil = false;
    try {
      const hasil = await jalankanRpc((sb) => panggilTiket(sb, tiketId));
      if (hasil.error) {
        console.error('Gagal memanggil tiket:', hasil.error.asli);
        toast(`Gagal memanggil ${nomorDisplay}. ${pesanMutasi(hasil.error.asli)}`, 'error');
      } else if (!hasil.data.dipanggil) {
        toast(`${nomorDisplay} tidak dipanggil: tiket sudah tidak berstatus menunggu. Daftar dimuat ulang.`, 'error');
        await muatSenyap();
      } else {
        berhasil = true;
        toast(`Memanggil ${nomorDisplay}…`, 'success');
      }
    } finally {
      // Gagal = langsung bisa dicoba lagi; sukses = tahan sampai jeda habis.
      const sisa = berhasil ? Math.max(0, JEDA_PANGGIL_MS - (Date.now() - mulai)) : 0;
      if (sisa === 0) lepasPanggil(tiketId);
      else setTimeout(() => lepasPanggil(tiketId), sisa);
    }
    return berhasil;
  };

  // Kunci tombol per tiket selama request berjalan (mencegah klik ganda / dua aksi bersamaan pada tiket yang sama).
  const jalankanAksi = async (tiketId: string, label: string, aksi: () => Promise<void>) => {
    if (prosesRef.current.has(tiketId)) return;
    prosesRef.current.add(tiketId);
    setSedangProses(new Set(prosesRef.current));
    setPengumuman(label);
    try {
      await aksi();
    } finally {
      prosesRef.current.delete(tiketId);
      setSedangProses(new Set(prosesRef.current));
      setPengumuman('');
    }
  };

  // Galat RPC antrean -> pesan jelas; muat ulang bila tampilan kemungkinan basi.
  const tanganiGalatAksi = async (e: unknown, awalan: string) => {
    const kode = kodeGalatDariError(e);
    if (kode === 'SUDAH_DIAMBIL') {
      toast(PESAN_GALAT_ANTREAN.SUDAH_DIAMBIL, 'error');
    } else {
      toast(`${awalan} ${kode ? PESAN_GALAT_ANTREAN[kode] : pesanMutasi(e)}`, 'error');
    }
    if (perluMuatUlang(e) || (kode !== null && KODE_MUAT_ULANG.has(kode))) await muatSenyap();
  };

  const mulai = (a: TiketBaris) =>
    jalankanAksi(a.id, `Memulai layanan ${a.nomor_display}…`, async () => {
      const hasil = await jalankanRpc((sb) => mulaiLayananTiket(sb, a.id));
      if (hasil.error) {
        console.error('Gagal memulai layanan:', hasil.error.asli);
        await tanganiGalatAksi(hasil.error.asli, 'Gagal memulai layanan.');
        return;
      }
      toast(hasil.data.sudahMilikAnda ? 'Layanan tiket ini sudah Anda mulai sebelumnya' : 'Layanan dimulai', 'success');
      await muatSenyap();
      // Wizard pendataan untuk layanan berformulir (Helpdesk OSS / Non OSS); layanan lain tidak punya form pendataan.
      if (punyaPendataan(a)) buka('wizard', a);
      else toast('Layanan ini tidak memiliki form pendataan', 'info');
    });

  const selesaikan = (a: TiketBaris): Promise<void> => {
    if (punyaPendataan(a)) {
      // Wizard pendataan. Tiket hasil eskalasi: cukup Pendataan (tanpa topik/catatan; 202610140015).
      buka('wizard', a);
      return Promise.resolve();
    }
    if (tiketHasilEskalasi(a)) {
      // Tiket hasil eskalasi tanpa pendataan: dialog topik + catatan wajib (layanan_selesai 5 parameter).
      buka('selesaiEskalasi', a);
      return Promise.resolve();
    }
    return jalankanAksi(a.id, `Menyelesaikan ${a.nomor_display}…`, async () => {
      const hasil = await jalankanRpc((sb) => selesaikanLayananTiket(sb, a.id));
      if (hasil.error) {
        console.error('Gagal menyelesaikan antrean:', hasil.error.asli);
        await tanganiGalatAksi(hasil.error.asli, 'Gagal menyelesaikan antrean.');
        return;
      }
      toast('Kunjungan berhasil diselesaikan', 'success');
      bukaQrTiket(a.id);
      await muatSenyap();
    });
  };

  return { sedangProses, sedangPanggil, pengumuman, panggil, mulai, selesaikan };
}
