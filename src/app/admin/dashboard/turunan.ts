// Turunan murni dari data yang SUDAH dimuat Dasbor (tanpa kueri baru): hari-hari grafik, rata-rata durasi,
// dan rincian tiket per Layanan. Dipisah dari page.tsx agar mudah diuji.
import { NAMA_BULAN_PENDEK, NAMA_HARI_PANJANG, NAMA_HARI_PENDEK, hariPekan, uraiTanggal } from '@/components/ui/kalender/tanggal';

export interface HariKunjungan {
  tanggal: string;
  /** "Sel" */
  hari: string;
  /** "Sel 3": label sumbu X grafik tren. */
  label: string;
  /** "Selasa" */
  hariPanjang: string;
  /** "3 Nov": untuk tabel cadangan dan keterangan. */
  tanggalPendek: string;
  kunjungan: number;
}

/** Susun hari grafik dari daftar tanggal berurut (YYYY-MM-DD, WIB) dan hitungan per tanggal. */
export function susunHarian(tanggal: string[], hitung: Record<string, number>): HariKunjungan[] {
  return tanggal.map((t) => {
    const u = uraiTanggal(t);
    const hari = NAMA_HARI_PENDEK[hariPekan(t)];
    return {
      tanggal: t,
      hari,
      hariPanjang: NAMA_HARI_PANJANG[hariPekan(t)],
      label: u ? `${hari} ${u.hari}` : hari,
      tanggalPendek: u ? `${u.hari} ${NAMA_BULAN_PENDEK[u.bulan - 1]}` : t,
      kunjungan: hitung[t] ?? 0,
    };
  });
}

/** Hari dengan kunjungan terbanyak (seri: yang terbaru menang); null bila semuanya 0. */
export function hariTersibuk(harian: HariKunjungan[]): HariKunjungan | null {
  let puncak: HariKunjungan | null = null;
  for (const h of harian) {
    if (h.kunjungan > 0 && (!puncak || h.kunjungan >= puncak.kunjungan)) puncak = h;
  }
  return puncak;
}

export function jumlahKunjungan(harian: HariKunjungan[]): number {
  return harian.reduce((j, h) => j + h.kunjungan, 0);
}

export type PasanganWaktu = [mulai: string | null | undefined, selesai: string | null | undefined];

/** Rata-rata selisih menit (dibulatkan) dari pasangan waktu yang lengkap; null bila tidak ada pasangan lengkap. */
export function rataMenit(pasangan: PasanganWaktu[]): { rata: number | null; jumlah: number } {
  const lengkap = pasangan.filter((p): p is [string, string] => !!p[0] && !!p[1]);
  if (lengkap.length === 0) return { rata: null, jumlah: 0 };
  const totalMs = lengkap.reduce((j, [a, b]) => j + (new Date(b).getTime() - new Date(a).getTime()), 0);
  return { rata: Math.max(0, Math.round(totalMs / lengkap.length / 60000)), jumlah: lengkap.length };
}

export interface BarisLayanan {
  nama: string;
  menunggu: number;
  dilayani: number;
  selesai: number;
  total: number;
}

/** Hitung tiket per Layanan dan statusnya; urut terbanyak (lalu nama). Baris tanpa nama Layanan dilewati. */
export function ringkasPerLayanan(tiket: Array<{ nama: string | null; status?: string | null }>): BarisLayanan[] {
  const peta = new Map<string, BarisLayanan>();
  for (const t of tiket) {
    if (!t.nama) continue;
    const b = peta.get(t.nama) ?? { nama: t.nama, menunggu: 0, dilayani: 0, selesai: 0, total: 0 };
    if (t.status === 'menunggu') b.menunggu += 1;
    else if (t.status === 'dilayani') b.dilayani += 1;
    else if (t.status === 'selesai') b.selesai += 1;
    b.total += 1;
    peta.set(t.nama, b);
  }
  return [...peta.values()].sort((a, b) => b.total - a.total || a.nama.localeCompare(b.nama, 'id'));
}

/** Lima Layanan teratas + satu irisan "Lainnya" untuk sisanya (jumlah tetap utuh). */
export function irisanDonat(baris: BarisLayanan[], maks = 5): Array<{ nama: string; nilai: number }> {
  const atas = baris.slice(0, maks).map((b) => ({ nama: b.nama, nilai: b.total }));
  const sisa = baris.slice(maks).reduce((j, b) => j + b.total, 0);
  return sisa > 0 ? [...atas, { nama: 'Lainnya', nilai: sisa }] : atas;
}
