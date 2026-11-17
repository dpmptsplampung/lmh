// Turunan murni tombol "Isi Pendataan" (G5): Layanan mana yang perlu dicek isian Pendataan Khusus aktifnya. Hanya tiket
// berstatus dilayani milik pengguna, dan bukan layanan berformulir tetap (OSS/Non OSS punya wizard formulir sendiri).
import type { ProfilPetugasAntrean, TiketBaris } from '@/lib/data/antrean';
import { bolehSelesaikanTiket } from '@/lib/pelayanan';
import { punyaPendataan } from './turunan';

/** Id Layanan unik (terurut) yang definisi isiannya perlu diperiksa untuk tombol "Isi Pendataan". */
export function layananPerluCekIsian(
  sumber: ReadonlyArray<readonly TiketBaris[]>, pengguna: ProfilPetugasAntrean | null,
): string[] {
  const id = new Set<string>();
  for (const daftar of sumber) {
    for (const t of daftar) {
      if (t.layanan_id && !punyaPendataan(t) && bolehSelesaikanTiket(pengguna, t)) id.add(t.layanan_id);
    }
  }
  return [...id].sort();
}
