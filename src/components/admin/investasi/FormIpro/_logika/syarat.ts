import type { NilaiForm, SumberIpro } from './nilai-form';
import { validasiUrlFoila } from '@/lib/investasi/foila';
import { KAB_KOTA_IPRO, SEKTOR_IPRO } from '@/lib/investasi/konstanta';

// Nama field yang dikembalikan server pada 409 SYARAT_TERBIT (lihat src/lib/investasi/http.ts).
export const LABEL_KEKURANGAN: Record<string, string> = {
  kab_kota: 'Pilih kabupaten/kota yang sah (tab Lokasi).',
  sektor: 'Pilih sektor (tab Informasi).',
  deskripsi: 'Isi deskripsi proyek (tab Informasi).',
  gambar_utama: 'Tandai satu gambar sebagai gambar utama (tab Gambar).',
  sumber_url: 'Isi tautan proyek FOILA yang sah.',
  gambar: 'Unggah tepat satu gambar kartu.',
};

export function labelKekurangan(kode: string[]): string[] {
  return kode.map((k) => LABEL_KEKURANGAN[k] ?? 'Lengkapi data proyek.');
}

// Prakiraan di klien dari data yang tersimpan; server tetap pemutus akhir.
export function kekuranganTerbitKlien(n: NilaiForm, sumber: SumberIpro, gambar: { utama: boolean }[]): string[] {
  const kurang: string[] = [];
  if (!KAB_KOTA_IPRO.includes(n.kab_kota)) kurang.push('kab_kota');
  if (!SEKTOR_IPRO.some((s) => s.nilai === n.sektor)) kurang.push('sektor');
  if (sumber === 'foila') {
    if (!validasiUrlFoila(n.sumber_url.trim())) kurang.push('sumber_url');
    if (gambar.length !== 1) kurang.push('gambar');
  } else {
    if (!n.deskripsi.trim()) kurang.push('deskripsi');
    if (!gambar.some((g) => g.utama)) kurang.push('gambar_utama');
  }
  return kurang;
}
