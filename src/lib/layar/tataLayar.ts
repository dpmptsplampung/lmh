// Layar TV antrean: aturan tampilan murni (tanpa React) yang dipakai bersama layar bertoken dan layar lama.
//  - hanya layanan BERJADWAL HARI INI yang tampil, sepanjang hari (tanpa melihat jam buka);
//  - urutan khusus layar (urutan_layar, null di akhir menurut nama) dan nama tampil (nama_layar);
//  - paling banyak 8 kartu per halaman, kartu sisa dirata tengah.
import { toWIBDateString } from '@/lib/time';
import { tataKisi, type PetaStatusBuka } from './layananBuka';

export const UKURAN_HALAMAN = 8;
export const DURASI_HALAMAN_MS = 8_000;

/** Hari ke berapa dalam pekan menurut kalender WIB: 1=Senin .. 7=Minggu (sama dengan jadwal_standby.hari). */
export function hariIsoWIB(sekarang: Date = new Date()): number {
  const [t, b, h] = toWIBDateString(sekarang).split('-').map(Number);
  const dow = new Date(Date.UTC(t, b - 1, h, 12)).getUTCDay(); // 0=Minggu
  return dow === 0 ? 7 : dow;
}

/**
 * Layanan yang tampil: hari ini berjadwal dan bukan hari libur, tanpa memandang jam sekarang.
 * Layanan yang tidak ada di RPC (nonaktif atau terarsip) tidak tampil, juga bila masih ada tiket.
 * Status tidak diketahui (RPC gagal atau belum ada) = semua baris, jadwal tidak ditebak.
 */
export function saringBerjadwalHariIni<T extends { layanan_id: string }>(
  baris: T[],
  status: PetaStatusBuka | null,
  hari: number = hariIsoWIB(),
): T[] {
  if (!status) return baris;
  return baris.filter(b => {
    const s = status.get(b.layanan_id);
    return !!s && !s.libur && s.hari.includes(hari);
  });
}

interface BarisBernama {
  layanan_nama: string;
  nama_tampil?: string | null;
  nama_layar?: string | null;
  urutan_layar?: number | null;
}

/** Nama di kartu dan pita: `nama_tampil` dari view, atau `nama_layar` bila diisi, kalau tidak nama layanan. */
export function namaTampil(l: Pick<BarisBernama, 'layanan_nama' | 'nama_tampil' | 'nama_layar'>): string {
  return l.nama_tampil?.trim() || l.nama_layar?.trim() || l.layanan_nama;
}

/** Urutan khusus layar: urutan_layar naik, yang null/tidak ada di akhir menurut nama. Tidak mengubah larik asal. */
export function urutkanLayar<T extends BarisBernama>(baris: T[]): T[] {
  return [...baris].sort((a, b) => {
    const ua = typeof a.urutan_layar === 'number' ? a.urutan_layar : Infinity;
    const ub = typeof b.urutan_layar === 'number' ? b.urutan_layar : Infinity;
    if (ua !== ub) return ua < ub ? -1 : 1;
    return a.layanan_nama.localeCompare(b.layanan_nama, 'id');
  });
}

/** Pecah menjadi halaman berisi paling banyak `ukuran` kartu. */
export function bagiHalaman<T>(baris: T[], ukuran: number = UKURAN_HALAMAN): T[][] {
  const halaman: T[][] = [];
  for (let i = 0; i < baris.length; i += ukuran) halaman.push(baris.slice(i, i + ukuran));
  return halaman;
}

/**
 * Kisi satu halaman. Lebih dari satu halaman memakai kisi untuk halaman PENUH di semua halaman,
 * jadi ukuran kartu sama dan halaman sisa tinggal berisi lebih sedikit kartu.
 */
export function kisiHalaman(jumlahLayanan: number, rasio?: number): { kolom: number; baris: number } {
  return tataKisi(Math.min(Math.max(1, jumlahLayanan), UKURAN_HALAMAN), rasio);
}

/**
 * Letak kartu dalam kisi berpetak setengah kartu (2*kolom x 2*baris satuan; kartu = 2x2 satuan).
 * Baris yang kurang dari penuh, dan halaman yang barisnya kurang dari kisi, bergeser ke tengah.
 * Hasilnya 1-based, siap untuk `grid-column: <kolomMulai> / span 2`.
 */
export function posisiKartu(
  indeks: number,
  jumlahDiHalaman: number,
  kolom: number,
  barisPenuh: number,
): { kolomMulai: number; barisMulai: number } {
  const barisDipakai = Math.ceil(jumlahDiHalaman / kolom);
  const baris = Math.floor(indeks / kolom);
  const kolomDiBaris = baris < barisDipakai - 1 ? kolom : jumlahDiHalaman - (barisDipakai - 1) * kolom;
  return {
    kolomMulai: kolom - kolomDiBaris + 2 * (indeks % kolom) + 1,
    barisMulai: Math.max(0, barisPenuh - barisDipakai) + 2 * baris + 1,
  };
}
