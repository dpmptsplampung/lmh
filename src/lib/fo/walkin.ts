// Pendaftaran walk-in oleh Front Office (K3): validasi, parameter RPC, pemetaan galat, panggilan RPC.
// Dipakai halaman /admin/fo/daftar DAN replay antrean offline (src/lib/offline/replay.ts) agar kedua
// jalur identik. Kontrak: docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §2.1.
//
// ATURAN VALIDASI di bawah ini adalah kontrak yang SAMA PERSIS ditegakkan di DB (`fo_mulai_kunjungan`).
// Semua isian wajib. Klien selalu mengirim nilai yang sudah dinormalkan (lihat `normalisasiWalkin`).
import type { SupabaseClient } from '@supabase/supabase-js';
import { KATEGORI_PENGUNJUNG } from '@/lib/constants';
import { GalatRpc, jalankanRpc } from '@/lib/rpc-galat';

export interface DataWalkin {
  nama: string;
  asal_instansi: string;
  kontak_hp: string;
  kategori: string;
  email: string;
  keperluan: string;
  /** '' = belum dipilih (tidak valid), LAYANAN_BELUM_TAHU = "belum tahu" (valid, dikirim NULL), selain itu uuid layanan. */
  layanan_saran_id: string;
}

export const WALKIN_KOSONG: DataWalkin = {
  nama: '',
  asal_instansi: '',
  kontak_hp: '',
  kategori: '',
  email: '',
  keperluan: '',
  layanan_saran_id: '',
};

/**
 * Nilai khusus opsi "Belum tahu — ditentukan saat eskalasi" pada pilihan layanan saran. Ini PILIHAN SADAR FO
 * (valid), berbeda dari '' (belum memilih). Ke RPC dikirim sebagai `p_layanan_saran_id = null`.
 */
export const LAYANAN_BELUM_TAHU = 'belum_tahu';

/** Batas panjang (jumlah karakter Unicode) = kontrak validasi yang SAMA ditegakkan di `fo_mulai_kunjungan`. */
export const BATAS_WALKIN = {
  namaMin: 3,
  namaMax: 100,
  asalMin: 3,
  asalMax: 120,
  keperluanMin: 10,
  keperluanMax: 500,
  emailMax: 254,
} as const;

export const KATEGORI_WALKIN = Object.keys(KATEGORI_PENGUNJUNG) as (keyof typeof KATEGORI_PENGUNJUNG)[];

/** Urutan isian di formulir (dipakai untuk fokus galat pertama dan pindah dengan Enter). */
export const URUTAN_FIELD_WALKIN: (keyof DataWalkin)[] = [
  'nama',
  'asal_instansi',
  'kategori',
  'kontak_hp',
  'email',
  'layanan_saran_id',
  'keperluan',
];

export const LABEL_FIELD_WALKIN: Record<keyof DataWalkin, string> = {
  nama: 'Nama Lengkap',
  asal_instansi: 'Asal / Instansi',
  kategori: 'Kategori Pengunjung',
  kontak_hp: 'Nomor HP',
  email: 'Email',
  layanan_saran_id: 'Layanan Saran',
  keperluan: 'Keperluan',
};

export type GalatFormWalkin = Partial<Record<keyof DataWalkin, string>>;

// ---------------------------------------------------------------------------------------------------------------------
// Utilitas teks
// ---------------------------------------------------------------------------------------------------------------------

/** Jumlah karakter Unicode (bukan unit UTF-16) = char_length Postgres. */
const panjang = (s: string): number => Array.from(s).length;
const hitungTakSpasi = (s: string): number => Array.from(s.replace(/\s/g, '')).length;
const hitungHuruf = (s: string): number => (s.match(/\p{L}/gu) ?? []).length;
const rapatkanSpasi = (s: string): string => s.trim().replace(/\s+/g, ' ');
/** Nama: Unicode NFC (huruf + aksen terpisah digabung), lalu spasi dirapatkan. */
const rapikanTeksNama = (s: string): string => rapatkanSpasi(s.normalize('NFC'));

// ---------------------------------------------------------------------------------------------------------------------
// Nama
// ---------------------------------------------------------------------------------------------------------------------

const POLA_NAMA = /^\p{L}[\p{L} .,'’-]*$/u;

/**
 * Nama dirapikan: spasi ganda dirapatkan. Bila SELURUH huruf kapital atau SELURUH huruf kecil, diubah menjadi
 * Title Case sederhana; nama campuran (gelar/singkatan yang sudah benar, mis. "Dr. Ir. Budi, M.Si") tidak disentuh.
 */
export function rapikanNama(raw: string): string {
  const s = rapikanTeksNama(raw);
  const huruf = s.replace(/[^\p{L}]/gu, '');
  if (!huruf) return s;
  const semuaBesar = huruf === huruf.toUpperCase();
  const semuaKecil = huruf === huruf.toLowerCase();
  if (!semuaBesar && !semuaKecil) return s;
  return s.toLowerCase().replace(/(^|[\s.'’-])(\p{L})/gu, (_m, awal: string, h: string) => awal + h.toUpperCase());
}

/** Nilai yang divalidasi: NFC + spasi dirapatkan (tanpa mengubah huruf besar/kecil). */
export function normalisasiNama(raw: string): string {
  return rapikanTeksNama(raw);
}

export function periksaNama(raw: string): string | undefined {
  const n = normalisasiNama(raw);
  if (!n) return 'Nama wajib diisi.';
  if (/\d/.test(n)) return 'Nama tidak boleh berisi angka.';
  if (!POLA_NAMA.test(n)) {
    return 'Nama hanya boleh berisi huruf, spasi, titik, koma, apostrof, dan tanda hubung, dan harus diawali huruf.';
  }
  if (hitungHuruf(n) < BATAS_WALKIN.namaMin) return `Nama terlalu pendek (minimal ${BATAS_WALKIN.namaMin} huruf).`;
  if (panjang(n) > BATAS_WALKIN.namaMax) return `Nama terlalu panjang (maksimal ${BATAS_WALKIN.namaMax} karakter).`;
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Asal / instansi
// ---------------------------------------------------------------------------------------------------------------------

export function normalisasiAsal(raw: string): string {
  return raw.trim();
}

export function periksaAsal(raw: string): string | undefined {
  const a = normalisasiAsal(raw);
  if (!a) return 'Asal / instansi wajib diisi.';
  if (hitungTakSpasi(a) < BATAS_WALKIN.asalMin) {
    return `Asal / instansi terlalu pendek (minimal ${BATAS_WALKIN.asalMin} karakter).`;
  }
  if (panjang(a) > BATAS_WALKIN.asalMax) {
    return `Asal / instansi terlalu panjang (maksimal ${BATAS_WALKIN.asalMax} karakter).`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Nomor HP
// ---------------------------------------------------------------------------------------------------------------------

/** Bentuk kanonik nomor ponsel Indonesia: 08 + digit ke-3 1-9 + 7 s.d. 10 digit (total 10-13 digit). */
const POLA_HP = /^08[1-9][0-9]{7,10}$/;
const POLA_KARAKTER_HP = /^\+?[0-9\s().-]+$/;

/**
 * Menormalkan ke bentuk kanonik 08xxxxxxxxxx, IDENTIK dengan server: semua non-digit dibuang; bila diawali 62
 * ("+62", "62 8") awalan itu diganti 0 TANPA membuang angka sesudahnya ("+62 0812…" -> "00812…" = ditolak).
 * Hasil BELUM tentu valid (periksa dengan `periksaHp`).
 */
export function normalisasiHp(raw: string): string {
  const digit = raw.replace(/\D/g, '');
  if (digit.startsWith('62')) return `0${digit.slice(2)}`;
  return digit;
}

export function periksaHp(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return 'Nomor HP wajib diisi.';
  if (!POLA_KARAKTER_HP.test(s)) {
    return 'Nomor HP hanya boleh berisi angka (boleh spasi, tanda hubung, atau +62 di depan).';
  }
  const k = normalisasiHp(s);
  if (POLA_HP.test(k)) return undefined;
  if (k.startsWith('08')) {
    if (k.length < 10) return 'Nomor HP terlalu pendek (nomor ponsel 10-13 digit).';
    if (k.length > 13) return 'Nomor HP terlalu panjang (nomor ponsel 10-13 digit).';
    return 'Awalan nomor tidak dikenal (setelah 08 harus angka 1-9, mis. 0812, 0852, 0878).';
  }
  if (k.startsWith('00')) {
    return 'Setelah +62 langsung tulis 8…, tanpa angka 0 (contoh: +62 812-3456-7890 atau 0812-3456-7890).';
  }
  if (k.startsWith('0')) {
    return 'Ini tampak seperti nomor telepon rumah/kantor. Isi nomor HP yang diawali 08 atau +62 8.';
  }
  return 'Nomor HP harus diawali 08 atau +62 8 (nomor ponsel Indonesia).';
}

/** Tampilan rapi nomor kanonik, mis. 081234567890 -> 0812-3456-7890. Bukan kanonik -> dikembalikan apa adanya. */
export function formatHpTampil(kanonik: string): string {
  if (!POLA_HP.test(kanonik)) return kanonik;
  return kanonik.match(/.{1,4}/g)?.join('-') ?? kanonik;
}

// ---------------------------------------------------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Regex PERSIS sama dengan server (`fo_mulai_kunjungan`, operator ~ Postgres), dipakai pada email yang sudah trim +
 * huruf kecil dan panjang <= 254: ^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$
 * Hanya ASCII: apostrof, simbol lain, dan karakter Unicode ditolak.
 */
const POLA_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** Domain contoh/placeholder yang jelas bukan alamat asli pengunjung (sengaja singkat). */
export const DOMAIN_PLACEHOLDER: readonly string[] = [
  'contoh.com',
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'tes.com',
  'email.com',
  'domain.com',
  'noemail.com',
  'tidakada.com',
];
/** TLD yang dicadangkan (RFC 2606/6761) untuk contoh/uji: tidak pernah alamat asli. */
export const TLD_PLACEHOLDER: readonly string[] = ['test', 'example', 'invalid', 'localhost'];

export function normalisasiEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function domainPlaceholder(email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1);
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return DOMAIN_PLACEHOLDER.includes(domain) || TLD_PLACEHOLDER.includes(tld);
}

export function periksaEmail(raw: string): string | undefined {
  const e = normalisasiEmail(raw);
  if (!e) return 'Email wajib diisi.';
  if (/\s/.test(e)) return 'Email tidak boleh mengandung spasi.';
  if (panjang(e) > BATAS_WALKIN.emailMax) return `Email terlalu panjang (maksimal ${BATAS_WALKIN.emailMax} karakter).`;
  const jumlahAt = e.split('@').length - 1;
  if (jumlahAt !== 1) return 'Email harus berisi tepat satu tanda @, mis. nama@gmail.com.';
  if (e.startsWith('@')) return 'Email belum lengkap: tulis nama sebelum tanda @.';
  if (/[^\x00-\x7f]/.test(e)) {
    return 'Email hanya boleh memakai huruf latin tanpa aksen, angka, dan tanda . _ % + - (karakter Unicode tidak diterima).';
  }
  if (!POLA_EMAIL.test(e)) {
    const [lokal, domain] = e.split('@');
    if (!/^[a-z0-9._%+-]+$/.test(lokal)) {
      return 'Bagian sebelum @ hanya boleh huruf, angka, dan tanda . _ % + - (tanpa apostrof atau simbol lain).';
    }
    if (!domain.includes('.')) return 'Domain email belum lengkap (mis. gmail.com).';
    return 'Format email belum benar. Contoh: nama@gmail.com.';
  }
  if (domainPlaceholder(e)) return 'Email contoh/placeholder tidak dapat dipakai. Isi email asli pengunjung.';
  return undefined;
}

const DOMAIN_POPULER = ['gmail.com', 'yahoo.com', 'yahoo.co.id', 'hotmail.com', 'outlook.com', 'icloud.com'];
/** Domain sah yang kebetulan mirip domain populer: tidak diberi saran koreksi. */
const DOMAIN_SAH_MIRIP = new Set(['mail.com', 'ymail.com', 'gmx.com', 'aol.com', 'msn.com', 'live.com', 'proton.me']);
const KOREKSI_DOMAIN: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gmil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.om': 'gmail.com',
  'gmail.comm': 'gmail.com',
  'gmail.co.id': 'gmail.com',
  'gmail.id': 'gmail.com',
  'yahooo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'yaahoo.com': 'yahoo.com',
  'yhoo.com': 'yahoo.com',
  'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotnail.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outllook.com': 'outlook.com',
  'outloook.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'outlook.con': 'outlook.com',
  'iclod.com': 'icloud.com',
  'icloud.co': 'icloud.com',
  'icloud.con': 'icloud.com',
};

/** Jarak edit (sisip/hapus/ganti/tukar dua huruf bersebelahan). */
function jarakEdit(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => {
    const baris = new Array<number>(b.length + 1).fill(0);
    baris[0] = i;
    return baris;
  });
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const biaya = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + biaya);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * Saran koreksi salah ketik domain umum (gmial.com -> gmail.com). null bila tidak ada saran. TIDAK memblokir:
 * domain yang sah tetap lolos validasi. Hanya diberikan untuk email yang formatnya valid.
 */
export function sarankanEmail(raw: string): string | null {
  const e = normalisasiEmail(raw);
  if (periksaEmail(e)) return null;
  const at = e.lastIndexOf('@');
  const lokal = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (DOMAIN_POPULER.includes(domain) || DOMAIN_SAH_MIRIP.has(domain)) return null;
  const betul = KOREKSI_DOMAIN[domain] ?? DOMAIN_POPULER.find((p) => jarakEdit(domain, p) === 1);
  return betul ? `${lokal}@${betul}` : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Kategori, layanan saran, keperluan
// ---------------------------------------------------------------------------------------------------------------------

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function periksaKategori(v: string): string | undefined {
  if (!v) return 'Pilih kategori pengunjung.';
  if (!(KATEGORI_WALKIN as string[]).includes(v)) return 'Kategori tidak dikenal.';
  return undefined;
}

export function periksaLayananSaran(v: string): string | undefined {
  if (!v) return 'Pilih layanan saran, atau "Belum tahu" bila belum jelas.';
  if (v === LAYANAN_BELUM_TAHU || POLA_UUID.test(v)) return undefined;
  return 'Layanan saran tidak valid. Pilih dari daftar.';
}

export function normalisasiKeperluan(raw: string): string {
  return raw.trim();
}

export function periksaKeperluan(raw: string): string | undefined {
  const k = normalisasiKeperluan(raw);
  if (!k) return 'Keperluan wajib diisi.';
  if (hitungTakSpasi(k) < BATAS_WALKIN.keperluanMin) {
    return `Keperluan terlalu singkat: tulis minimal ${BATAS_WALKIN.keperluanMin} karakter agar petugas paham.`;
  }
  if (panjang(k) > BATAS_WALKIN.keperluanMax) return `Keperluan maksimal ${BATAS_WALKIN.keperluanMax} karakter.`;
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Validasi & normalisasi gabungan (SATU sumber untuk formulir dan antrean offline)
// ---------------------------------------------------------------------------------------------------------------------

/** Data dalam bentuk yang dikirim: HP kanonik, email huruf kecil, nama dirapikan, dst. */
export function normalisasiWalkin(d: DataWalkin): DataWalkin {
  return {
    nama: rapikanNama(d.nama),
    asal_instansi: normalisasiAsal(d.asal_instansi),
    kontak_hp: normalisasiHp(d.kontak_hp),
    kategori: d.kategori.trim(),
    email: normalisasiEmail(d.email),
    keperluan: normalisasiKeperluan(d.keperluan),
    layanan_saran_id: d.layanan_saran_id.trim(),
  };
}

/** SEMUA isian wajib. Kunci galat hanya ada untuk isian yang tidak valid (urut sesuai formulir). */
export function validasiWalkin(d: DataWalkin): GalatFormWalkin {
  const hasil: GalatFormWalkin = {
    nama: periksaNama(d.nama),
    asal_instansi: periksaAsal(d.asal_instansi),
    kategori: periksaKategori(d.kategori.trim()),
    kontak_hp: periksaHp(d.kontak_hp),
    email: periksaEmail(d.email),
    layanan_saran_id: periksaLayananSaran(d.layanan_saran_id.trim()),
    keperluan: periksaKeperluan(d.keperluan),
  };
  const g: GalatFormWalkin = {};
  for (const k of URUTAN_FIELD_WALKIN) {
    const pesan = hasil[k];
    if (pesan) g[k] = pesan;
  }
  return g;
}

/** Argumen RPC `fo_mulai_kunjungan` (nama parameter mengikuti kontrak §2.1). */
export interface ParamFoMulai {
  p_nama: string;
  p_asal_instansi: string;
  p_kontak_hp: string | null;
  p_kategori: string | null;
  p_email: string | null;
  p_keperluan: string | null;
  p_layanan_saran_id: string | null;
  p_client_request_id: string;
}

const atauNull = (s: string): string | null => (s.trim() ? s.trim() : null);

export function bangunParamFoMulai(d: DataWalkin, clientRequestId: string): ParamFoMulai {
  const n = normalisasiWalkin(d);
  return {
    p_nama: n.nama,
    p_asal_instansi: n.asal_instansi,
    p_kontak_hp: atauNull(n.kontak_hp),
    p_kategori: atauNull(n.kategori),
    p_email: atauNull(n.email),
    p_keperluan: atauNull(n.keperluan),
    // "Belum tahu" (pilihan sadar FO) = NULL di RPC; kontrak RPC tidak berubah.
    p_layanan_saran_id: n.layanan_saran_id === LAYANAN_BELUM_TAHU ? null : atauNull(n.layanan_saran_id),
    p_client_request_id: clientRequestId,
  };
}

/**
 * Validasi ulang parameter yang AKAN dikirim/diantre (aturan yang sama dengan formulir). Dipakai sebelum
 * mengantre offline agar item yang pasti ditolak server tidak pernah masuk antrean.
 */
export function validasiParamFoMulai(p: ParamFoMulai): GalatFormWalkin {
  return validasiWalkin({
    nama: p.p_nama,
    asal_instansi: p.p_asal_instansi,
    kontak_hp: p.p_kontak_hp ?? '',
    kategori: p.p_kategori ?? '',
    email: p.p_email ?? '',
    keperluan: p.p_keperluan ?? '',
    layanan_saran_id: p.p_layanan_saran_id ?? LAYANAN_BELUM_TAHU,
  });
}

function stringAtauNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  return typeof v === 'string' ? v : undefined;
}

/**
 * Memvalidasi payload yang dibaca dari IndexedDB (data bisa rusak/dimanipulasi) dan mengembalikan HANYA
 * kolom yang dikenal (data berlebih dibuang). null bila bentuknya tidak sah.
 */
export function bacaParamTersimpan(payload: unknown): ParamFoMulai | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.p_nama !== 'string' || typeof p.p_asal_instansi !== 'string') return null;
  if (typeof p.p_client_request_id !== 'string' || !POLA_UUID.test(p.p_client_request_id)) return null;
  const hp = stringAtauNull(p.p_kontak_hp);
  const kategori = stringAtauNull(p.p_kategori);
  const email = stringAtauNull(p.p_email);
  const keperluan = stringAtauNull(p.p_keperluan);
  const saran = stringAtauNull(p.p_layanan_saran_id);
  if ([hp, kategori, email, keperluan, saran].some((v) => v === undefined)) return null;
  return {
    p_nama: p.p_nama,
    p_asal_instansi: p.p_asal_instansi,
    p_kontak_hp: hp as string | null,
    p_kategori: kategori as string | null,
    p_email: email as string | null,
    p_keperluan: keperluan as string | null,
    p_layanan_saran_id: saran as string | null,
    p_client_request_id: p.p_client_request_id,
  };
}

export const PESAN_GALAT_FO_MULAI: Record<string, string> = {
  LAYANAN_TUTUP: 'Layanan sudah tutup (pukul 16.00 WIB). Pendaftaran walk-in tidak dapat dilakukan lagi hari ini.',
  DATA_TIDAK_VALID:
    'Data ditolak server. Semua isian wajib: nama (3–100 karakter, huruf saja), asal/instansi (3–120), nomor HP (08… / +62 8…), email (huruf latin), kategori, dan keperluan (10–500 karakter).',
  LAYANAN_TIDAK_VALID: 'Layanan saran tidak valid atau sedang tidak aktif. Pilih layanan lain atau "Belum tahu".',
  NOT_FOUND: 'Data pengunjung terdaftar tidak ditemukan.',
  IDEMPOTENSI_BENTROK: 'Permintaan ini bentrok dengan pendaftaran petugas lain. Muat ulang halaman, lalu coba lagi.',
  FORBIDDEN: 'Akun Anda tidak berwenang mendaftarkan kunjungan walk-in.',
  SESI_TIDAK_SAH: 'Sesi Anda sudah berakhir (mungkin akun ini masuk di perangkat lain). Silakan masuk kembali.',
  RESPON_TIDAK_VALID: 'Balasan server tidak dikenali. Periksa halaman Penanganan sebelum mencoba lagi.',
};
export const PESAN_GALAT_FO_MULAI_UMUM = 'Gagal menyimpan kunjungan. Silakan coba lagi.';
export const PESAN_GALAT_JARINGAN = 'Koneksi bermasalah, periksa jaringan Anda lalu coba lagi.';

export function pesanGalatFoMulai(e: unknown): string {
  if (e instanceof GalatRpc) {
    if (e.jaringan) return PESAN_GALAT_JARINGAN;
    if (e.kode && PESAN_GALAT_FO_MULAI[e.kode]) return PESAN_GALAT_FO_MULAI[e.kode];
  }
  return PESAN_GALAT_FO_MULAI_UMUM;
}

export interface GalatFieldServer {
  field: keyof DataWalkin;
  /** Alasan dari server tanpa awalan kode, huruf pertama kapital. */
  pesan: string;
}

/**
 * DATA_TIDAK_VALID dari server membawa nama isian yang salah di `error.details` (mis. 'kontak_hp'). Mengembalikan
 * isian itu + alasan server, atau null bila bukan galat per-isian.
 */
export function galatFieldServer(e: unknown): GalatFieldServer | null {
  if (!(e instanceof GalatRpc) || e.jaringan || e.kode !== 'DATA_TIDAK_VALID') return null;
  const asal = e.asal as { details?: unknown; message?: unknown } | undefined;
  const detail = typeof asal?.details === 'string' ? asal.details.trim() : '';
  const field = URUTAN_FIELD_WALKIN.find((k) => k === detail);
  if (!field) return null;
  const alasan = (typeof asal?.message === 'string' ? asal.message : '').replace(/^[A-Z][A-Z0-9_]+:\s*/, '').trim();
  const pesan = alasan ? alasan.charAt(0).toUpperCase() + alasan.slice(1) : 'Isian ini ditolak server.';
  return { field, pesan: `Ditolak server: ${pesan}` };
}

/**
 * Galat PERMANEN: mengulang dengan data yang sama pasti gagal lagi, jadi item antrean offline dibuang
 * (dan FO diberi tahu). Galat lain (jaringan, FORBIDDEN, SESI_TIDAK_SAH, tak dikenal) = boleh diulang.
 */
export function galatFoMulaiPermanen(e: unknown): boolean {
  if (!(e instanceof GalatRpc) || e.jaringan) return false;
  return (
    e.kode === 'LAYANAN_TUTUP' ||
    e.kode === 'DATA_TIDAK_VALID' ||
    e.kode === 'LAYANAN_TIDAK_VALID' ||
    e.kode === 'NOT_FOUND' ||
    e.kode === 'IDEMPOTENSI_BENTROK'
  );
}

export interface HasilFoMulai {
  sudahAda: boolean;
  kunjunganId: string;
  penangananId: string | null;
  qrToken: string | null;
}

/**
 * `rpc fo_mulai_kunjungan`. `sudah_ada: true` (id permintaan yang sama dari staf yang sama) = SUKSES
 * idempoten (kontrak §0.7). Melempar `GalatRpc` pada kegagalan.
 */
export async function panggilFoMulaiKunjungan(
  supabase: Pick<SupabaseClient, 'rpc'>,
  param: ParamFoMulai,
): Promise<HasilFoMulai> {
  let r: Record<string, unknown>;
  try {
    r = await jalankanRpc(supabase.rpc('fo_mulai_kunjungan', param));
  } catch (e) {
    // Kontrak §2.1: dua permintaan serentak dengan id sama, yang kalah bisa menerima 23505; panggil ulang = sudah_ada.
    const kodeSql = e instanceof GalatRpc ? (e.asal as { code?: string } | undefined)?.code : undefined;
    if (kodeSql !== '23505') throw e;
    r = await jalankanRpc(supabase.rpc('fo_mulai_kunjungan', param));
  }
  if (typeof r.kunjungan_id !== 'string') throw new GalatRpc('RESPON_TIDAK_VALID', { asal: r });
  return {
    sudahAda: r.sudah_ada === true,
    kunjunganId: r.kunjungan_id,
    penangananId: typeof r.penanganan_id === 'string' ? r.penanganan_id : null,
    qrToken: typeof r.qr_token === 'string' ? r.qr_token : null,
  };
}
