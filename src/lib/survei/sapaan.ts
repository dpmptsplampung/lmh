// Sapaan di awal wizard Pesan Perilaku: "Selamat Pagi/Siang/Sore/Malam, <nama>". Modul murni; jam dibaca menurut WIB
// (bukan zona perangkat) agar sama dengan jam layanan.
const JAM_WIB = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' });

const BATAS_NAMA = 60;
// Nama yang diisi petugas sebagai penanda "tanpa nama" tidak boleh disapa.
const NAMA_TIDAK_DISAPA = /^(?:\[anonim\]|anonim|tanpa nama|tidak berlaku|-+)$/i;

export type Waktu = 'Pagi' | 'Siang' | 'Sore' | 'Malam';

/** Pagi 04.00-10.59, Siang 11.00-14.59, Sore 15.00-17.59, selain itu Malam (WIB). */
export function waktuSapaan(sekarang: Date): Waktu {
  const jam = Number(JAM_WIB.format(sekarang));
  if (jam >= 4 && jam < 11) return 'Pagi';
  if (jam >= 11 && jam < 15) return 'Siang';
  if (jam >= 15 && jam < 18) return 'Sore';
  return 'Malam';
}

/** Nama siap tampil, atau null bila kosong / penanda "tanpa nama". Dirapikan spasinya dan dipotong bila terlalu panjang. */
export function namaUntukSapaan(nama: string | null | undefined): string | null {
  const rapi = (nama ?? '').replace(/\s+/g, ' ').trim();
  if (rapi === '' || NAMA_TIDAK_DISAPA.test(rapi)) return null;
  return rapi.length > BATAS_NAMA ? `${rapi.slice(0, BATAS_NAMA).trimEnd()}…` : rapi;
}

export function buatSapaan(nama: string | null | undefined, sekarang: Date = new Date()): string {
  const salam = `Selamat ${waktuSapaan(sekarang)}`;
  const orang = namaUntukSapaan(nama);
  return orang ? `${salam}, ${orang}` : salam;
}
