import type { Perusahaan, PengajuanKontak, NomorPemohon, DaftarKebutuhan } from '@/lib/umkm-katalog/types-g4';

// Tipe tahap B dipakai langsung dari tipe backend. Nomor UMKM hanya ada di NomorDibuka.
export type {
  Kebutuhan, Perusahaan, PermintaanSaya, StatusPermintaan,
} from '@/lib/umkm-katalog/types-g4';
export type SesiPerusahaan = { masuk: boolean; perusahaan: Perusahaan | null };
export type NomorDibuka = NomorPemohon;
export type Daftar<T> = { items: T[]; next_cursor: DaftarKebutuhan['next_cursor'] };
export type HasilAjukan = PengajuanKontak;
export type { Kartu as KartuRekomendasi } from '@/lib/umkm-katalog/types';
