// Pendataan Khusus di Rekap Data Pelayanan (Fase 4, K9): kolom per isian Layanan terpilih dan penempelan jawaban.
// Modul murni. Jawaban dibaca route lewat RLS (lingkup data ketat Fase 3), bukan di sini.
import { formatNilaiKhusus } from '@/lib/pendataan-khusus/jawaban';
import type { FieldKhusus, NilaiKhusus } from '@/lib/pendataan-khusus/jenis';
import type { BarisPelayanan, KolomData } from './terpadu';

/**
 * Kolom Pendataan Khusus untuk `kolomDataPelayanan(formType, tambahan)`. Isian tersembunyi hanya bila pernah diisi
 * (datanya tetap harus terlihat); header memakai label SAAT INI (salinan label lama tersimpan di DB).
 */
export function kolomKhusus(fields: FieldKhusus[]): KolomData[] {
  return fields
    .filter((f) => !f.tersembunyi || f.pernah_diisi)
    .slice()
    .sort((a, b) => a.urut - b.urut)
    .map((f) => ({
      kunci: `khusus_${f.id}`,
      judul: `[Khusus] ${f.label}`,
      ambil: (r: BarisPelayanan) => formatNilaiKhusus(f, r.khusus?.[f.id]),
    }));
}

/** Menempelkan jawaban (per pelayanan_id) ke baris; baris tanpa jawaban dikembalikan apa adanya. */
export function lampirkanKhusus(
  rows: BarisPelayanan[],
  jawaban: Map<string, Record<string, NilaiKhusus>>,
): BarisPelayanan[] {
  return rows.map((r) => {
    const j = jawaban.get(r.pelayanan_id);
    return j ? { ...r, khusus: j } : r;
  });
}
