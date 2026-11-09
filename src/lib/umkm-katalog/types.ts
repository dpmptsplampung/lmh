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
};
export type Tugas = {
  id: string; jenis: 'profil'; nama: string; status: Status; versi: number; mendesak: boolean;
  dibuat_pada: string; petugas_id: string | null; petugas_nama: string | null; tanpa_nomor: boolean;
  peringatan_kontak: string[];
};
export type Detail = Tugas & {
  dipegang_saya: boolean; sumber: 'kurasi' | 'satudata' | 'loket'; sumber_ref: string | null;
  revisi: Revisi; foto: Foto[]; izin_status: 'diberikan' | 'dicabut' | null;
};
export type Mutasi = {
  id: string; versi: number; status: Status; revisi_id?: string; peringatan_kontak?: string[];
};
export type DaftarTugas = { items: Tugas[]; next_cursor: string | null };
export type ApiSukses<T> = { data: T; meta: { request_id: string; next_cursor?: string | null } };
export type ApiGalat = { error: { code: string; message: string }; request_id: string };

export type ProfilPublik = {
  id: string; nama: string; deskripsi: string; jenis: string; kategori: string; spesifik: string | null;
  kabupaten_kota: string; instagram: string | null; tiktok: string | null; foto: {id: string; url: string}[];
};
