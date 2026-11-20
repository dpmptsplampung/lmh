import type { IproAdmin } from '@/lib/data/investasi';

export type SumberIpro = 'ptsp' | 'foila';

// Semua isian disimpan sebagai teks (nilai input apa adanya); konversi ke payload ada di bangunPayload.
export type NilaiForm = {
  judul: string; ringkasan: string; deskripsi: string; sektor: string; tahap_kajian: string; skema: string; urutan: string;
  nilai_investasi: string; mata_uang: string; nilai_teks: string; irr_persen: string; npv_nilai: string;
  payback_bulan: string; luas_ha: string;
  kab_kota: string; lokasi_teks: string; lat: string; lng: string; status_lahan: string; perizinan: string; pemilik: string;
  dokumen_id: string; kontak_instansi: string; kontak_email: string; kontak_telepon: string;
  judul_en: string; ringkasan_en: string; deskripsi_en: string;
  sumber_url: string;
};
export type KunciForm = keyof NilaiForm;

const teks = (v: string | null | undefined) => v ?? '';
const angka = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function nilaiKosong(): NilaiForm {
  return {
    judul: '', ringkasan: '', deskripsi: '', sektor: '', tahap_kajian: '', skema: '', urutan: '0',
    nilai_investasi: '', mata_uang: 'IDR', nilai_teks: '', irr_persen: '', npv_nilai: '', payback_bulan: '', luas_ha: '',
    kab_kota: '', lokasi_teks: '', lat: '', lng: '', status_lahan: '', perizinan: '', pemilik: '',
    dokumen_id: '', kontak_instansi: '', kontak_email: '', kontak_telepon: '',
    judul_en: '', ringkasan_en: '', deskripsi_en: '',
    sumber_url: '',
  };
}

export function nilaiDariProyek(p: IproAdmin): NilaiForm {
  return {
    judul: p.judul, ringkasan: p.ringkasan, deskripsi: teks(p.deskripsi), sektor: p.sektor, tahap_kajian: teks(p.tahap_kajian),
    skema: teks(p.skema), urutan: String(p.urutan ?? 0),
    nilai_investasi: angka(p.nilai_investasi), mata_uang: p.mata_uang, nilai_teks: teks(p.nilai_teks),
    irr_persen: angka(p.irr_persen), npv_nilai: angka(p.npv_nilai), payback_bulan: angka(p.payback_bulan), luas_ha: angka(p.luas_ha),
    kab_kota: p.kab_kota, lokasi_teks: teks(p.lokasi_teks), lat: angka(p.lat), lng: angka(p.lng),
    status_lahan: teks(p.status_lahan), perizinan: teks(p.perizinan), pemilik: teks(p.pemilik),
    dokumen_id: teks(p.dokumen_id), kontak_instansi: teks(p.kontak_instansi), kontak_email: teks(p.kontak_email),
    kontak_telepon: teks(p.kontak_telepon),
    judul_en: teks(p.judul_en), ringkasan_en: teks(p.ringkasan_en), deskripsi_en: teks(p.deskripsi_en),
    sumber_url: teks(p.sumber_url),
  };
}

export const teksAtauNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());
// Bentuk angka desimal Indonesia ("1,5") diterima; teks bukan angka menjadi NaN agar ditolak validasi.
export const angkaAtauNull = (v: string): number | null => {
  const t = v.trim().replace(',', '.');
  return t === '' ? null : Number(t);
};

const KUNCI_UMUM: KunciForm[] = ['judul', 'ringkasan', 'sektor', 'kab_kota', 'mata_uang'];
const TEKS_UMUM: KunciForm[] = ['judul_en', 'ringkasan_en', 'nilai_teks'];
const ANGKA_UMUM: KunciForm[] = ['nilai_investasi'];
const TEKS_PTSP: KunciForm[] = ['deskripsi', 'deskripsi_en', 'lokasi_teks', 'pemilik', 'perizinan', 'dokumen_id',
  'kontak_instansi', 'kontak_email', 'kontak_telepon', 'skema', 'status_lahan', 'tahap_kajian'];
const ANGKA_PTSP: KunciForm[] = ['lat', 'lng', 'irr_persen', 'npv_nilai', 'payback_bulan', 'luas_ha'];

// Payload untuk POST/PATCH. Kartu FOILA hanya memuat field kartu + sumber_url (skema server .strict()).
// Nilai kosong menjadi null supaya pengelola bisa menghapus isian; slug tidak dikirim (dibuat dan dikunci server).
export function bangunPayload(n: NilaiForm, sumber: SumberIpro): Record<string, unknown> {
  const hasil: Record<string, unknown> = {};
  for (const k of KUNCI_UMUM) hasil[k] = n[k].trim();
  for (const k of TEKS_UMUM) hasil[k] = teksAtauNull(n[k]);
  for (const k of ANGKA_UMUM) hasil[k] = angkaAtauNull(n[k]);
  hasil.urutan = angkaAtauNull(n.urutan) ?? 0;
  if (sumber === 'foila') return { ...hasil, sumber_url: n.sumber_url.trim() };
  for (const k of TEKS_PTSP) hasil[k] = teksAtauNull(n[k]);
  for (const k of ANGKA_PTSP) hasil[k] = angkaAtauNull(n[k]);
  return hasil;
}
