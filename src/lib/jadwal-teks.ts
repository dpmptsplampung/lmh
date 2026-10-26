// Pemadat jadwal mingguan (jadwal_standby) menjadi teks. Murni (tanpa DB): dipakai bot (profil layanan) dan
// etalase homepage (kartu + popup) supaya kalimat jadwal sama di mana-mana. Keputusan "buka/tutup hari ini"
// BUKAN di sini: itu milik is_layanan_buka_jadwal di DB.
export type JadwalHari = {
  /** 1 = Senin ... 7 = Minggu. */
  hari: number;
  /** "HH:MM" (detik, bila ada, diabaikan). */
  jamMulai: string;
  jamSelesai: string;
};

export const NAMA_HARI = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'] as const;

/** "08:00:00" -> "08.00". */
export const jamTeks = (v: string): string => v.slice(0, 5).replace(':', '.');

const valid = (j: JadwalHari): boolean =>
  Number.isInteger(j.hari) && j.hari >= 1 && j.hari <= 7 && Boolean(j.jamMulai) && Boolean(j.jamSelesai);

const labelRentang = (dari: number, sampai: number): string =>
  dari === sampai ? NAMA_HARI[dari] : `${NAMA_HARI[dari]}–${NAMA_HARI[sampai]}`;

/** Hari berurutan dengan jam sama digabung: Senin–Jumat 08.00–15.30; Sabtu 08.00–12.00. */
export function teksJadwalMingguan(jadwal: JadwalHari[]): string {
  const urut = jadwal.filter(valid).sort((a, b) => a.hari - b.hari);
  const kelompok: { dari: number; sampai: number; jam: string }[] = [];
  for (const j of urut) {
    const jam = `${jamTeks(j.jamMulai)}–${jamTeks(j.jamSelesai)}`;
    const akhir = kelompok[kelompok.length - 1];
    if (akhir && akhir.jam === jam && akhir.sampai === j.hari - 1) akhir.sampai = j.hari;
    else if (!akhir || akhir.sampai !== j.hari) kelompok.push({ dari: j.hari, sampai: j.hari, jam });
  }
  return kelompok.map((k) => `${labelRentang(k.dari, k.sampai)} ${k.jam}`).join('; ');
}

/**
 * Hari buka tanpa jam, untuk kalimat "Buka ...": satu hari -> "setiap Kamis", rentang -> "Senin–Jumat",
 * beberapa kelompok -> "Senin–Rabu dan Jumat". Kosong bila tidak ada jadwal.
 */
export function teksBukaSetiap(jadwal: JadwalHari[]): string {
  const hari = [...new Set(jadwal.filter(valid).map((j) => j.hari))].sort((a, b) => a - b);
  if (hari.length === 0) return '';
  const kelompok: { dari: number; sampai: number }[] = [];
  for (const h of hari) {
    const akhir = kelompok[kelompok.length - 1];
    if (akhir && akhir.sampai === h - 1) akhir.sampai = h;
    else kelompok.push({ dari: h, sampai: h });
  }
  const bagian = kelompok.map((k) => labelRentang(k.dari, k.sampai));
  const gabung = bagian.length === 1
    ? bagian[0]
    : `${bagian.slice(0, -1).join(', ')} dan ${bagian[bagian.length - 1]}`;
  const adaRentang = kelompok.some((k) => k.dari !== k.sampai);
  return adaRentang ? gabung : `setiap ${gabung}`;
}

export type BarisJadwalMingguan = { hari: number; nama: string; jam: string | null };

/** Tujuh baris Senin..Minggu untuk tabel popup; hari tanpa jadwal -> jam null ("Tutup"). */
export function barisJadwalMingguan(jadwal: JadwalHari[]): BarisJadwalMingguan[] {
  const peta = new Map<number, JadwalHari>();
  for (const j of jadwal.filter(valid)) if (!peta.has(j.hari)) peta.set(j.hari, j);
  return [1, 2, 3, 4, 5, 6, 7].map((hari) => {
    const j = peta.get(hari);
    return { hari, nama: NAMA_HARI[hari], jam: j ? `${jamTeks(j.jamMulai)}–${jamTeks(j.jamSelesai)}` : null };
  });
}
