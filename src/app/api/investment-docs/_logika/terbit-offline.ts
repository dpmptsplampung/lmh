import { createHash } from 'node:crypto';
import { MAKS_HALAMAN_TERSAJI } from '@/lib/investasi/dokumen';
import { kunciObjek } from '@/lib/storage/area';
import { sumberFinal } from './unggahan';

type Metadata = {
  judul: string;
  kategori: 'Peta Potensi';
  deskripsi: string;
  urutan_tampil: number;
};

/** UUIDv8 tetap untuk PDF yang sama, termasuk saat proses diulang setelah PUT parsial. */
export function idDokumenOffline(bytes: Uint8Array): string {
  const hash = createHash('sha256').update(bytes).digest();
  hash[6] = (hash[6] & 0x0f) | 0x80;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex', 0, 16);
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export function kunciDokumenOffline(id: string, jumlah: number) {
  if (!Number.isInteger(jumlah) || jumlah < 1 || jumlah > MAKS_HALAMAN_TERSAJI) {
    throw new Error(`PDF harus memiliki 1–${MAKS_HALAMAN_TERSAJI} halaman.`);
  }
  const objek = (path: string) => ({ path, kunci: kunciObjek('investment-docs', path) });
  return {
    sumber: objek(sumberFinal(id)),
    // Satu batch offline dengan ID tetap. Format path mengikuti render batch browser.
    halaman: Array.from({ length: jumlah }, (_, index) => objek(`pages/${id}/${id}/page-${index + 1}.png`)),
  };
}

export function barisDokumenOffline(
  id: string, metadata: Metadata, rencana: ReturnType<typeof kunciDokumenOffline>, halamanSelesai: string[],
) {
  const jumlah = rencana.halaman.length;
  if (halamanSelesai.length !== jumlah || rencana.halaman.some(({ path }, index) => halamanSelesai[index] !== path)) {
    throw new Error('Pemeriksaan kelengkapan halaman gagal. Baris belum dapat ditulis.');
  }
  return {
    ...metadata,
    id,
    file_path: rencana.sumber.path,
    status: 'nonaktif' as const,
    jumlah_halaman: jumlah,
    halaman_selesai: jumlah,
    halaman_gambar: halamanSelesai.slice(),
  };
}
