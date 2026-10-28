// Identitas pengunjung (Pendataan Umum) yang dilengkapi petugas saat menyelesaikan live chat (Fase 4, K7).
// Aturan = pendataan_identitas_validasi (migrasi 202610300002) = fo_mulai_kunjungan 202610140015; DB penegak akhir.

export const KOLOM_IDENTITAS = ['nama', 'kontak_hp', 'email', 'asal_instansi', 'kategori', 'keperluan'] as const;
export type KolomIdentitas = (typeof KOLOM_IDENTITAS)[number];
export type IdentitasForm = Record<KolomIdentitas, string>;

export const KATEGORI_PENGUNJUNG = ['Umum', 'UMKM', 'Investor', 'Instansi'] as const;

export const LABEL_IDENTITAS: Record<KolomIdentitas, string> = {
  nama: 'Nama pengunjung',
  kontak_hp: 'Nomor HP',
  email: 'Email',
  asal_instansi: 'Asal instansi',
  kategori: 'Kategori',
  keperluan: 'Keperluan',
};

const huruf = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
const tanpaSpasi = (s: string) => s.replace(/\s/g, '').length;

/** Galat per kolom untuk nilai yang DIISI; kolom kosong = tidak diubah (sah). */
export function validasiIdentitas(f: IdentitasForm): Partial<Record<KolomIdentitas, string>> {
  const galat: Partial<Record<KolomIdentitas, string>> = {};
  const nama = f.nama.replace(/\s+/g, ' ').trim();
  if (nama && (nama.length < 3 || nama.length > 100 || !/^\p{L}[\p{L} .,'’-]*$/u.test(nama) || huruf(nama) < 3)) {
    galat.nama = 'Nama 3-100 karakter, hanya huruf, spasi, titik, koma, apostrof, dan tanda hubung.';
  }
  let hp = f.kontak_hp.replace(/\D/g, '');
  if (hp) {
    if (hp.startsWith('62')) hp = `0${hp.slice(2)}`;
    if (!/^08[1-9][0-9]{7,10}$/.test(hp)) galat.kontak_hp = 'Nomor HP berformat 08xxxxxxxxxx (10-13 digit; +62 diterima).';
  }
  const email = f.email.trim().toLowerCase();
  if (email && (email.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email))) {
    galat.email = 'Email tidak valid.';
  }
  const instansi = f.asal_instansi.trim();
  if (instansi && (instansi.length < 3 || instansi.length > 120 || tanpaSpasi(instansi) < 3)) {
    galat.asal_instansi = 'Asal/instansi 3-120 karakter.';
  }
  const kategori = f.kategori.trim();
  if (kategori && !(KATEGORI_PENGUNJUNG as readonly string[]).includes(kategori)) galat.kategori = 'Pilih kategori yang tersedia.';
  const keperluan = f.keperluan.trim();
  if (keperluan && (keperluan.length < 10 || keperluan.length > 500 || tanpaSpasi(keperluan) < 10)) {
    galat.keperluan = 'Keperluan 10-500 karakter.';
  }
  return galat;
}

/** Hanya nilai terisi yang berbeda dari awal (di-trim); kosong tidak mengubah apa pun. */
export function identitasBerubah(awal: IdentitasForm, f: IdentitasForm): Partial<IdentitasForm> {
  const hasil: Partial<IdentitasForm> = {};
  for (const k of KOLOM_IDENTITAS) {
    const baru = f[k].trim();
    if (baru !== '' && baru !== awal[k].trim()) hasil[k] = baru;
  }
  return hasil;
}

const KOSONG: IdentitasForm = { nama: '', kontak_hp: '', email: '', asal_instansi: '', kategori: '', keperluan: '' };

/**
 * Validasi HANYA kolom yang diubah petugas. Data profil lama yang tidak diubah (nama dengan angka/emoji, keperluan
 * pendek, kategori di luar daftar) tidak boleh menghalangi petugas menyelesaikan chat; DB juga hanya memvalidasi nilai
 * yang dikirim.
 */
export function validasiIdentitasBerubah(awal: IdentitasForm, f: IdentitasForm): Partial<Record<KolomIdentitas, string>> {
  return validasiIdentitas({ ...KOSONG, ...identitasBerubah(awal, f) });
}
