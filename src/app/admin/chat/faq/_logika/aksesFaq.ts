// Aturan akses dan turunan tampilan halaman Kelola FAQ (refaktor G8, tugas 8.1): fungsi MURNI, tanpa I/O dan tanpa React.
// Cakupan layanan per peran selaras RLS (lib/faq-scope.ts); penegak sebenarnya tetap RLS. Aturan di sini hanya menentukan
// apa yang ditampilkan dan lingkup apa yang dimuat.
import { layananFaqBolehDikelola, type OpsiFaqLayanan } from '@/lib/faq-scope';
import type { LayananFaq, LingkupFaq } from '@/lib/data/faq';

export interface MasukanAksesFaq {
  /** null = belum dimuat (atau gagal dimuat: lihat roleError di hook). */
  role: string | null;
  layananPetugasId: string | null;
  layananList: readonly LayananFaq[];
  /** Daftar layanan sudah dimuat (berhasil atau gagal). */
  layananSelesai: boolean;
  layananError: boolean;
  /** Layanan yang dipilih di panel Pengaturan bot ('' = belum memilih). */
  botPilih: string;
}

export interface AksesFaq {
  isAdmin: boolean;
  isPetugas: boolean;
  isFrontOffice: boolean;
  /** Cakupan yang BOLEH dikelola peran ini (selaras RLS). */
  opsiLayanan: OpsiFaqLayanan[];
  /** Gagal memuat layanan memblokir hanya admin/petugas berlayanan; Front Office hanya mengelola FAQ umum. */
  layananGagalBlokir: boolean;
  tanpaAkses: boolean;
  siapMuat: boolean;
  /** Opsi layanan sungguhan (tanpa FAQ umum) untuk panel Pengaturan bot. */
  opsiBot: Array<OpsiFaqLayanan & { id: string }>;
  botLayananId: string | null;
  botLayanan: LayananFaq | undefined;
  tampilPanelBot: boolean;
  namaLayanan: Map<string, string>;
}

/** Lingkup muat daftar FAQ: petugas berlayanan = layanannya; Front Office = FAQ umum; selain itu semua (admin). */
export function lingkupFaq(role: string | null, layananPetugasId: string | null): LingkupFaq {
  if (role === 'petugas' && layananPetugasId) return { jenis: 'layanan', layananId: layananPetugasId };
  if (role === 'front_office') return { jenis: 'umum' };
  return { jenis: 'semua' };
}

export function turunkanAksesFaq(m: MasukanAksesFaq): AksesFaq {
  const { role, layananPetugasId, layananList, layananSelesai, layananError, botPilih } = m;
  const isAdmin = role === 'admin';
  const isPetugas = role === 'petugas';
  const isFrontOffice = role === 'front_office';

  const opsiLayanan = role === null ? [] : layananFaqBolehDikelola(role, layananPetugasId, layananList);
  // Admin dan petugas (berlayanan) butuh daftar layanan; Front Office hanya mengelola FAQ umum sehingga gagal
  // memuat layanan tidak boleh memblokirnya.
  const butuhDaftarLayanan = isAdmin || (isPetugas && !!layananPetugasId);
  const layananGagalBlokir = layananError && butuhDaftarLayanan;
  const tanpaAkses = role !== null && layananSelesai && !layananGagalBlokir && opsiLayanan.length === 0;
  const siapMuat = role !== null && layananSelesai && !layananGagalBlokir && opsiLayanan.length > 0;

  // Pengaturan bot: Admin memilih layanan; petugas hanya layanannya.
  const opsiBot = opsiLayanan.filter((o): o is OpsiFaqLayanan & { id: string } => o.id !== null);
  const botLayananId = opsiBot.some((o) => o.id === botPilih) ? botPilih : (opsiBot[0]?.id ?? null);
  const botLayanan = botLayananId ? layananList.find((l) => l.id === botLayananId) : undefined;

  return {
    isAdmin,
    isPetugas,
    isFrontOffice,
    opsiLayanan,
    layananGagalBlokir,
    tanpaAkses,
    siapMuat,
    opsiBot,
    botLayananId,
    botLayanan,
    tampilPanelBot: (isAdmin || isPetugas) && opsiBot.length > 0,
    namaLayanan: new Map(layananList.map((l) => [l.id, l.nama])),
  };
}
