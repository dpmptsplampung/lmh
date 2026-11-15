// Mesin keadaan muat antrean (rencana refaktor 2026-11-11 tugas 5.3): reducer murni yang dipakai _hook/useAntrean.ts.
// Satu reducer menggantikan lima belas useState agar muat awal di dalam effect cukup mengirim aksi (dispatch), dan agar
// transisi skeleton / muat ulang senyap / galat dapat diuji sebagai fungsi murni. Tanpa I/O dan tanpa React.
import type {
  CatatanEskalasi,
  DataAntrean,
  ProfilPetugasAntrean,
  StatistikSelesai,
  TiketBaris,
} from '@/lib/data/antrean';
import type { StatusSurvei } from '@/lib/survei/staf';

export interface KeadaanAntrean {
  antrian: TiketBaris[];
  antrianPanel: TiketBaris[];
  currentUser: ProfilPetugasAntrean | null;
  unassigned: boolean;
  /** Skeleton: HANYA muat awal / ganti parameter (data di layar bukan milik parameter ini). */
  loading: boolean;
  /** Muat ulang senyap berjalan (Realtime, polling, setelah aksi): tabel tetap tampil. */
  menyegarkan: boolean;
  galatMuat: string | null;
  /** Muat ulang senyap gagal: data lama tetap tampil dengan catatan. */
  galatSegar: boolean;
  /** Waktu muat sukses terakhir (ISO). */
  terakhir: string | null;
  totalCount: number;
  totalHarian: number;
  /** Daftar dari RPC akses FO (kolom "Front Office" tersedia). */
  aksesFo: boolean;
  serverStats: StatistikSelesai;
  /** penanganan_asal_id -> catatan eskalasi FO (pelengkap tampilan). */
  catatanEskalasi: Record<string, CatatanEskalasi>;
  /** Status Pesan Perilaku per kunjungan selesai (pelengkap tampilan). */
  statusSurvei: ReadonlyMap<string, StatusSurvei>;
}

export type AksiAntrean =
  | { jenis: 'mulai'; senyap: boolean }
  | { jenis: 'profil'; profil: ProfilPetugasAntrean }
  | { jenis: 'belumDitugaskan' }
  | { jenis: 'data'; data: DataAntrean; waktu: string }
  | { jenis: 'galatMuat'; pesan: string }
  | { jenis: 'galatSegar' }
  | { jenis: 'catatan'; catatan: Record<string, CatatanEskalasi> }
  | { jenis: 'survei'; status: ReadonlyMap<string, StatusSurvei> }
  | { jenis: 'selesai' };

export const KEADAAN_AWAL_ANTREAN: KeadaanAntrean = {
  antrian: [],
  antrianPanel: [],
  currentUser: null,
  unassigned: false,
  loading: true,
  menyegarkan: false,
  galatMuat: null,
  galatSegar: false,
  terakhir: null,
  totalCount: 0,
  totalHarian: 0,
  aksesFo: false,
  serverStats: { totalSelesai: 0, rataWaktuMenit: 0 },
  catatanEskalasi: {},
  statusSurvei: new Map(),
};

export function kurangiAntrean(k: KeadaanAntrean, a: AksiAntrean): KeadaanAntrean {
  switch (a.jenis) {
    case 'mulai':
      return a.senyap ? { ...k, menyegarkan: true } : { ...k, loading: true, galatMuat: null };
    case 'profil':
      return { ...k, currentUser: a.profil };
    case 'belumDitugaskan':
      return { ...k, unassigned: true, antrian: [], totalCount: 0, totalHarian: 0, antrianPanel: [] };
    case 'data':
      // Semua bacaan utama sukses: layar diganti sekali, tanpa keadaan setengah jadi.
      return {
        ...k,
        unassigned: false,
        aksesFo: a.data.aksesFo,
        antrian: a.data.baris,
        antrianPanel: a.data.barisPanel,
        totalCount: a.data.totalTabel,
        totalHarian: a.data.totalHarian,
        serverStats: a.data.statistik,
        galatMuat: null,
        galatSegar: false,
        terakhir: a.waktu,
      };
    case 'galatMuat':
      return { ...k, galatMuat: a.pesan };
    case 'galatSegar':
      return { ...k, galatSegar: true };
    case 'catatan':
      return { ...k, catatanEskalasi: a.catatan };
    case 'survei':
      return { ...k, statusSurvei: a.status };
    case 'selesai':
      return k.loading || k.menyegarkan ? { ...k, loading: false, menyegarkan: false } : k;
  }
}
