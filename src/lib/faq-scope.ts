// Cakupan layanan yang boleh dikelola per peran pada halaman Kelola FAQ.
//
// Satu sumber kebenaran untuk dropdown "Loket Layanan Tujuan", selaras dengan RLS
// `faq_knowledge_base` (audit T2a; spec docs/superpowers/specs/2026-10-12-mutasi-tercek-design.md §3.2):
//   - admin        -> `faq_admin_all`  : semua layanan + FAQ umum
//   - petugas      -> `faq_petugas_all`: hanya `layanan_id = get_my_layanan_id()` (FAQ umum TIDAK termasuk)
//   - front_office -> `faq_fo_umum`    : hanya FAQ umum (`layanan_id IS NULL`)
// Peran lain/tidak dikenal tidak boleh menulis FAQ sama sekali -> daftar kosong.
//
// Fungsi murni (tanpa akses DB) agar mudah diuji; UI hanya menampilkan opsi dari sini,
// sedangkan penegakan sebenarnya tetap RLS (penolakan diam-diam ditangkap `mutasiWajibBaris`).

/** Opsi dropdown FAQ. `id: null` = FAQ umum (kolom `layanan_id` NULL, berlaku untuk semua layanan). */
export interface OpsiFaqLayanan {
  id: string | null;
  nama: string;
}

/** Opsi FAQ umum (beku); layananFaqBolehDikelola mengembalikan salinan agar hasilnya aman diubah pemanggil. */
export const OPSI_FAQ_UMUM: Readonly<OpsiFaqLayanan> = Object.freeze({
  id: null,
  nama: 'Umum (semua layanan)',
});

export function layananFaqBolehDikelola<L extends { id: string; nama: string }>(
  role: string | null | undefined,
  layananPetugasId: string | null | undefined,
  semuaLayanan: ReadonlyArray<L>,
): OpsiFaqLayanan[] {
  const umum = (): OpsiFaqLayanan => ({ ...OPSI_FAQ_UMUM });
  const ringkas = (l: L): OpsiFaqLayanan => ({ id: l.id, nama: l.nama });

  switch (role) {
    case 'admin':
      return [umum(), ...semuaLayanan.map(ringkas)];
    case 'petugas':
      if (!layananPetugasId) return [];
      return semuaLayanan.filter((l) => l.id === layananPetugasId).map(ringkas);
    case 'front_office':
      return [umum()];
    default:
      return [];
  }
}
