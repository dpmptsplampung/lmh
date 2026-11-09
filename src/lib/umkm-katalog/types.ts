export type Status = 'diajukan' | 'terbit' | 'disembunyikan' | 'ditolak';
export type Revisi = {
  id: string; profil_id: string; versi: number; nama: string; deskripsi: string; alamat: string | null;
  jenis: string; kategori: string; spesifik: string | null; kabupaten_kota: string;
  memiliki_nib: boolean | null; instagram: string | null; tiktok: string | null;
  dibuat_oleh: string; dibuat_pada: string; keputusan: 'terbit' | 'ditolak' | null;
};
export type Foto = {
  id: string; revisi_id: string; asal: 'satudata' | 'eksternal' | 'unggahan'; url: string | null;
  r2_key: string | null; tersembunyi: boolean; perlu_review: boolean;
  diperiksa_oleh: string | null; diperiksa_pada: string | null;
  unggah_etag?: string | null; unggah_ukuran?: number | null; unggah_tipe?: string | null;
  unggah_diperiksa_pada?: string | null; r2_key_publik?: string | null; url_publik?: string | null;
};
export type Tugas = {
  id: string; jenis: 'profil'; nama: string; status: Status; versi: number; mendesak: boolean;
  dibuat_pada: string; petugas_id: string | null; petugas_nama: string | null; tanpa_nomor: boolean;
  peringatan_kontak: string[];
};
export type Detail = Tugas & {
  dipegang_saya: boolean; sumber: 'kurasi' | 'satudata' | 'loket'; sumber_ref: string | null;
  revisi: Revisi; foto: Foto[]; izin_status: 'diberikan' | 'dicabut' | null;
  foto_publikasi_tertunda?: number;
  foto_hapus_tertunda?: number;
  foto_disetujui?: Foto[];
};
export type Mutasi = {
  id: string; versi: number; status: Status; revisi_id?: string; peringatan_kontak?: string[];
  foto_publikasi?: FotoPublikasi;
};
export type DaftarTugas = { items: TugasCampuran[]; next_cursor: string | null };
export type ApiSukses<T> = { data: T; meta: { request_id: string; next_cursor?: string | null } };
export type ApiGalat = { error: { code: string; message: string }; request_id: string };

export type StatistikPublik = { suka: number; dilihat: number | null; baru: boolean };
export type ProfilPublik = StatistikPublik & {
  id: string; nama: string; deskripsi: string; jenis: string; kategori: string; spesifik: string | null;
  kabupaten_kota: string; instagram: string | null; tiktok: string | null; foto: {id: string; url: string}[];
  telemetri_opsional_aktif: boolean; statistik_mulai_pada: string | null;
};
export type FotoPublik = { id: string; url: string };
export type Kartu = Pick<ProfilPublik, 'id' | 'nama' | 'deskripsi' | 'jenis' | 'kategori' |
  'spesifik' | 'kabupaten_kota'> & StatistikPublik & { foto: FotoPublik | null };
export type FilterKatalog = { jenis: string[]; kategori: string[]; kabupaten_kota: string[]; terpotong: boolean };
export type DaftarKatalog = { items: Kartu[]; next_cursor: string | null };
export type FotoPublikasi = { status: 'selesai' | 'tertunda'; tertunda: number; hapus_tertunda: number };
export type AlasanLaporan = 'penipuan' | 'nomor_tampil' | 'data_salah' | 'foto_tidak_pantas' | 'lainnya';
type DasarPekerjaan = {
  id: string; nama: string; status: 'baru' | 'ditangani'; versi: number; mendesak: boolean;
  dibuat_pada: string; petugas_id: string | null; petugas_nama: string | null;
  profil_id: string | null; profil_nama: string | null;
};
export type TugasPesan = DasarPekerjaan & { jenis: 'pesan'; alasan: null };
export type TugasLaporan = DasarPekerjaan & { jenis: 'laporan'; alasan: AlasanLaporan };
export type TugasCampuran = Tugas | TugasPesan | TugasLaporan;
export type DetailPesan = TugasPesan & {
  nama_pengirim: string; perusahaan: string; nomor: string; pesan: string; kata_kunci: string | null;
  dipegang_saya: boolean; pemeriksa_nama: string; dibalas_pada: string | null;
};
export type DetailLaporan = TugasLaporan & {
  foto_id: string | null; catatan: string | null; dipegang_saya: boolean;
  pemeriksa_nama: string; selesai_pada: string | null;
};
export type MutasiPekerjaan = {
  id: string; jenis: 'pesan' | 'laporan'; versi: number; status: 'baru' | 'ditangani';
};
export type RingkasanPengawasan = {
  profil: Record<Status, number>; tugas_terbuka: number; mendesak: number;
  pesan: { baru: number; ditangani: number }; laporan_terbuka: number;
  rata_pemeriksaan_detik: number | null; rata_balasan_pertama_detik: number | null;
};
export type JejakPengawasan = {
  id: string; aksi: string; peran: string; aktor_nama: string; dibuat_pada: string;
  status_lama: string | null; status_baru: string | null; alasan: string | null;
  profil_id: string | null; profil_nama: string;
};
export type DaftarJejakPengawasan = { items: JejakPengawasan[]; next_cursor: string | null };
export type ProfilPengawasan = { id: string; nama: string; status: Status; versi: number };
export type DaftarProfilPengawasan = { items: ProfilPengawasan[]; next_cursor: string | null };
export type MutasiDarurat = {
  id: string; versi: number; status: Status; mendesak: boolean; foto_publikasi?: FotoPublikasi;
};
export type StatusStatistik = {
  telemetri_opsional_aktif: boolean; versi_naskah: string | null; aktif_pada: string | null;
};
export type ProfilStatistik = { id: string; nama: string; suka: number;
  dilihat: number | null; klik_formulir: number | null };
export type KelompokTanpaHasil = { hari: string; kategori: string; kabupaten_kota: string; jumlah: number };
export type LaporanStatistik = StatusStatistik & {
  profil: Record<Status, number>; suka: number; dilihat: number | null; tanpa_hasil: number | null;
  pesan: { baru: number; ditangani: number }; laporan: { baru: number; ditangani: number };
  profil_statistik: ProfilStatistik[]; kelompok_tanpa_hasil: KelompokTanpaHasil[]; next_cursor: string | null;
};
