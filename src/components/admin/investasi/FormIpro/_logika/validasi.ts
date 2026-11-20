import { validasiUrlFoila } from '@/lib/investasi/foila';
import { KAB_KOTA_IPRO, SEKTOR_IPRO, SKEMA_IPRO, STATUS_LAHAN, TAHAP_KAJIAN } from '@/lib/investasi/konstanta';
import { angkaAtauNull, type KunciForm, type NilaiForm, type SumberIpro } from './nilai-form';

export type GalatForm = Partial<Record<KunciForm, string>>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TELEPON = /^\+?[0-9][0-9 -]{5,19}$/;
const ada = <T extends { nilai: string }>(daftar: readonly T[], v: string) => daftar.some((d) => d.nilai === v);

// `wajib`: kosong ditolak. Selain itu kosong diterima, dan isian terisi tetap harus memenuhi min..maks.
function panjang(g: GalatForm, n: NilaiForm, k: KunciForm, label: string, min: number, maks: number, wajib = false) {
  const len = n[k].trim().length;
  if (len === 0) { if (wajib) g[k] = `${label} wajib diisi.`; }
  else if (len < min) g[k] = `${label} minimal ${min} karakter.`;
  else if (len > maks) g[k] = `${label} maksimal ${maks} karakter.`;
}
function angka(g: GalatForm, n: NilaiForm, k: KunciForm, label: string, opsi: { min?: number; maks?: number; bulat?: boolean }) {
  const v = angkaAtauNull(n[k]);
  if (v === null) return;
  if (!Number.isFinite(v)) g[k] = `${label} harus berupa angka.`;
  else if (opsi.bulat && !Number.isInteger(v)) g[k] = `${label} harus bilangan bulat.`;
  else if (opsi.min !== undefined && v < opsi.min) g[k] = `${label} minimal ${opsi.min}.`;
  else if (opsi.maks !== undefined && v > opsi.maks) g[k] = `${label} maksimal ${opsi.maks}.`;
}

// Selaras skema server (src/lib/investasi/skema.ts) dan CHECK DB; server tetap pemutus akhir.
export function validasiForm(n: NilaiForm, sumber: SumberIpro): GalatForm {
  const g: GalatForm = {};
  panjang(g, n, 'judul', 'Judul', 3, 200, true);
  panjang(g, n, 'ringkasan', 'Ringkasan', 1, 600, true);
  panjang(g, n, 'judul_en', 'Judul (Inggris)', 3, 200);
  panjang(g, n, 'ringkasan_en', 'Ringkasan (Inggris)', 1, 600);
  panjang(g, n, 'nilai_teks', 'Label nilai', 0, 200);
  if (!ada(SEKTOR_IPRO, n.sektor)) g.sektor = 'Pilih sektor.';
  if (!KAB_KOTA_IPRO.includes(n.kab_kota)) g.kab_kota = 'Pilih kabupaten/kota.';
  if (!['IDR', 'USD'].includes(n.mata_uang)) g.mata_uang = 'Pilih mata uang.';
  angka(g, n, 'nilai_investasi', 'Nilai investasi', { min: 0, bulat: true });
  angka(g, n, 'urutan', 'Urutan', { bulat: true });
  if (sumber === 'foila') {
    if (!validasiUrlFoila(n.sumber_url.trim())) g.sumber_url = 'Gunakan tautan proyek dari https://invest.lampungprov.go.id/ (tanpa spasi, port, atau akun).';
    return g;
  }
  panjang(g, n, 'deskripsi', 'Deskripsi', 0, 20000);
  panjang(g, n, 'deskripsi_en', 'Deskripsi (Inggris)', 0, 20000);
  panjang(g, n, 'lokasi_teks', 'Lokasi', 0, 300);
  panjang(g, n, 'pemilik', 'Pemilik proyek', 0, 200);
  panjang(g, n, 'perizinan', 'Perizinan', 0, 2000);
  panjang(g, n, 'kontak_instansi', 'Instansi kontak', 0, 200);
  if (n.tahap_kajian && !ada(TAHAP_KAJIAN, n.tahap_kajian)) g.tahap_kajian = 'Tahap kajian tidak dikenal.';
  if (n.skema && !ada(SKEMA_IPRO, n.skema)) g.skema = 'Skema tidak dikenal.';
  if (n.status_lahan && !ada(STATUS_LAHAN, n.status_lahan)) g.status_lahan = 'Status lahan tidak dikenal.';
  angka(g, n, 'irr_persen', 'IRR', { min: -100, maks: 1000 });
  angka(g, n, 'npv_nilai', 'NPV', { bulat: true });
  angka(g, n, 'payback_bulan', 'Payback', { min: 1, maks: 600, bulat: true });
  const luas = angkaAtauNull(n.luas_ha);
  if (luas !== null && !(luas > 0)) g.luas_ha = 'Luas harus berupa angka lebih dari 0.';
  const lat = angkaAtauNull(n.lat), lng = angkaAtauNull(n.lng);
  if ((lat === null) !== (lng === null)) g[lat === null ? 'lat' : 'lng'] = 'Isi lintang dan bujur berpasangan.';
  else if (lat !== null && lng !== null) {
    if (!(lat >= -6.6 && lat <= -3)) g.lat = 'Lintang harus antara -6,6 dan -3 (wilayah Lampung).';
    if (!(lng >= 103 && lng <= 106.6)) g.lng = 'Bujur harus antara 103 dan 106,6 (wilayah Lampung).';
  }
  const email = n.kontak_email.trim();
  if (email && (email.length > 254 || !EMAIL.test(email))) g.kontak_email = 'Alamat email tidak valid.';
  const telp = n.kontak_telepon.trim();
  if (telp && !TELEPON.test(telp)) g.kontak_telepon = 'Nomor telepon tidak valid (6-20 karakter: angka, spasi, tanda hubung).';
  return g;
}

// Tab yang memuat galat, supaya pengelola diarahkan ke isian yang salah.
export const TAB_UNTUK_FIELD: Partial<Record<KunciForm, string>> = {
  judul: 'informasi', ringkasan: 'informasi', deskripsi: 'informasi', sektor: 'informasi', tahap_kajian: 'informasi',
  skema: 'informasi', urutan: 'informasi', nilai_investasi: 'angka', mata_uang: 'angka', nilai_teks: 'angka',
  irr_persen: 'angka', npv_nilai: 'angka', payback_bulan: 'angka', luas_ha: 'angka',
  kab_kota: 'lokasi', lokasi_teks: 'lokasi', lat: 'lokasi', lng: 'lokasi', status_lahan: 'lokasi', perizinan: 'lokasi',
  pemilik: 'informasi', dokumen_id: 'kontak', kontak_instansi: 'kontak', kontak_email: 'kontak', kontak_telepon: 'kontak',
  judul_en: 'inggris', ringkasan_en: 'inggris', deskripsi_en: 'inggris',
};
export function tabPertamaBergalat(g: GalatForm): string | null {
  const urut = ['informasi', 'angka', 'lokasi', 'kontak', 'inggris'];
  const tabs = Object.keys(g).map((k) => TAB_UNTUK_FIELD[k as KunciForm]).filter(Boolean) as string[];
  return urut.find((t) => tabs.includes(t)) ?? null;
}
