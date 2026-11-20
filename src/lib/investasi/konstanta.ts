import { KABUPATEN_KOTA } from '@/lib/umkm-katalog/wilayah';

// Sumber RAG kelak wajib menyaring sumber = 'ptsp'; kartu FOILA hanya referensi.
export const SEKTOR_IPRO = [
  { nilai: 'pertanian', id: 'Pertanian', en: 'Agriculture' },
  { nilai: 'perikanan', id: 'Perikanan', en: 'Fisheries' },
  { nilai: 'pariwisata', id: 'Pariwisata', en: 'Tourism' },
  { nilai: 'industri', id: 'Industri', en: 'Industry' },
  { nilai: 'energi', id: 'Energi', en: 'Energy' },
  { nilai: 'infrastruktur', id: 'Infrastruktur', en: 'Infrastructure' },
  { nilai: 'kawasan', id: 'Kawasan', en: 'Economic zones' },
  { nilai: 'jasa', id: 'Jasa', en: 'Services' },
  { nilai: 'lainnya', id: 'Lainnya', en: 'Other' },
] as const;
export const TAHAP_KAJIAN = [
  { nilai: 'pra_fs', id: 'Pra studi kelayakan', en: 'Pre-feasibility study' },
  { nilai: 'fs', id: 'Studi kelayakan', en: 'Feasibility study' },
  { nilai: 'ipro', id: 'IPRO', en: 'IPRO' },
] as const;
export const SKEMA_IPRO = [
  { nilai: 'kpbu', id: 'KPBU', en: 'Public-private partnership' },
  { nilai: 'b2b', id: 'B2B', en: 'Business-to-business' },
  { nilai: 'bumd', id: 'BUMD', en: 'Regional enterprise' },
  { nilai: 'swasta_penuh', id: 'Swasta penuh', en: 'Private investment' },
  { nilai: 'lainnya', id: 'Lainnya', en: 'Other' },
] as const;
export const STATUS_LAHAN = [
  { nilai: 'milik_pemda', id: 'Milik pemerintah daerah', en: 'Local government' },
  { nilai: 'milik_bumn_bumd', id: 'Milik BUMN/BUMD', en: 'State or regional enterprise' },
  { nilai: 'milik_swasta', id: 'Milik swasta', en: 'Private ownership' },
  { nilai: 'milik_masyarakat', id: 'Milik masyarakat', en: 'Community ownership' },
  { nilai: 'belum_ditetapkan', id: 'Belum ditetapkan', en: 'Undetermined' },
] as const;
export const STATUS_IPRO = ['draf', 'terbit', 'arsip'] as const;
export const STATUS_MINAT = ['baru', 'dihubungi', 'berlanjut', 'ditolak', 'selesai'] as const;
export const MATA_UANG = ['IDR', 'USD'] as const;
export const KAB_KOTA_IPRO = [...KABUPATEN_KOTA, 'Lintas Kabupaten/Kota'];
export const MAKS_GAMBAR_PTSP = 12;
// Tujuan consent investasi_minat, baik kanal IPRO maupun dokumen.
export const VERSI_KEBIJAKAN_INVESTASI = '1.1';
export const HOST_FOILA = 'invest.lampungprov.go.id';
