import { Resolver } from 'node:dns/promises';

// Penyaring alamat email SEBELUM dikirim (kebijakan: kirim sekali, tanpa retry). Alamat hasil pendataan FO/petugas sering salah
// ketik atau fiktif; mengirim ke sana hanya menambah pantulan (bounce) dan merusak reputasi domain pengirim. Hanya server (DNS).
// Konservatif: yang diblokir hanya yang PASTI tak terkirim; ragu (DNS timeout) = tetap dikirim.

export type HasilAlamatEmail = { valid: true; email: string; domain: string } | { valid: false; alasan: string };

const MAKS_EMAIL = 254;
const MAKS_LOKAL = 64;
// Himpunan karakter sama dengan POLA_EMAIL_NYATA / email_nyata() di DB, ditambah aturan titik dan batas panjang RFC 5321.
const POLA_LOKAL = /^[a-z0-9._%+-]+$/;
const POLA_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const POLA_TLD = /^[a-z]{2,63}$/;

// RFC 2606/6761: domain cadangan yang tidak pernah menerima email.
const DOMAIN_CADANGAN = ['example.com', 'example.org', 'example.net'];
const TLD_CADANGAN = ['test', 'invalid', 'localhost', 'local', 'example'];

// Salah ketik domain besar yang umum -> domain yang dimaksud. Domain ini sering PUNYA MX (disewa pihak lain), jadi DNS saja tidak
// menangkapnya, dan email akan sampai ke orang asing.
const SALAH_KETIK: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmil.com': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gmeil.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.om': 'gmail.com', 'gmail.vom': 'gmail.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahho.com': 'yahoo.com', 'yhoo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outllok.com': 'outlook.com', 'outlook.con': 'outlook.com',
  'icloud.con': 'icloud.com',
};

export function periksaAlamatEmail(masuk: string): HasilAlamatEmail {
  if (typeof masuk !== 'string' || masuk.trim() === '') return { valid: false, alasan: 'alamat email kosong' };
  const email = masuk.trim().toLowerCase();
  const format = { valid: false as const, alasan: 'format alamat email tidak valid' };
  if (email.length > MAKS_EMAIL) return format;

  const pecah = email.split('@');
  if (pecah.length !== 2) return format;
  const [lokal, domain] = pecah;
  if (!lokal || lokal.length > MAKS_LOKAL || !POLA_LOKAL.test(lokal)) return format;
  if (lokal.startsWith('.') || lokal.endsWith('.') || lokal.includes('..')) return format;

  const label = domain.split('.');
  if (label.length < 2 || !label.every((l) => POLA_LABEL.test(l))) return format;
  if (!POLA_TLD.test(label[label.length - 1])) return format;
  if (domain.length > 253) return format;

  const tld = label[label.length - 1];
  if (DOMAIN_CADANGAN.some((d) => domain === d || domain.endsWith(`.${d}`)) || TLD_CADANGAN.includes(tld)) {
    return { valid: false, alasan: 'domain cadangan/contoh yang tidak menerima email' };
  }
  const saran = SALAH_KETIK[domain];
  if (saran) return { valid: false, alasan: `domain kemungkinan salah ketik (maksud: ${saran})` };

  // Gmail: username hanya huruf, angka, titik (tag setelah "+" bebas) dan maksimal 30 karakter. "_", "-", "%" tidak pernah sah di Gmail,
  // padahal sering diketik. Batas bawah tidak diperiksa (akun lama bisa lebih pendek).
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const nama = lokal.split('+')[0];
    if (!/^[a-z0-9.]+$/.test(nama) || nama.length > 30) {
      return { valid: false, alasan: 'username Gmail tidak sah (hanya huruf, angka, titik; maks 30 karakter)' };
    }
  }

  return { valid: true, email, domain };
}

export type StatusDomainEmail = 'ada' | 'tidak_ada' | 'tidak_pasti';

export interface PenyelesaiDns {
  resolveMx: Resolver['resolveMx'];
  resolve4: Resolver['resolve4'];
}
type EntriCache = { hasil: 'ada' | 'tidak_ada'; sampai: number };

const TTL_CACHE_MS = 10 * 60 * 1000;
const cacheBersama = new Map<string, EntriCache>();
let dnsBawaan: PenyelesaiDns | null = null;
function ambilDnsBawaan(): PenyelesaiDns {
  if (!dnsBawaan) {
    const r = new Resolver({ timeout: 3000, tries: 1 });
    dnsBawaan = { resolveMx: r.resolveMx.bind(r), resolve4: r.resolve4.bind(r) };
  }
  return dnsBawaan;
}

type Jawaban = 'ada' | 'kosong' | 'tidak_ada_domain' | 'ragu';
function kodeGalat(e: unknown): string {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
}
async function tanya(f: () => Promise<unknown[]>): Promise<{ jawaban: Jawaban; data: unknown[] }> {
  try {
    const data = await f();
    return { jawaban: data.length > 0 ? 'ada' : 'kosong', data };
  } catch (e) {
    const kode = kodeGalat(e);
    if (kode === 'ENOTFOUND') return { jawaban: 'tidak_ada_domain', data: [] };
    if (kode === 'ENODATA') return { jawaban: 'kosong', data: [] };
    return { jawaban: 'ragu', data: [] };
  }
}

// MX (atau A sebagai MX implisit, RFC 5321 §5.1). NXDOMAIN, tanpa MX+A, dan null MX (RFC 7505) = 'tidak_ada'.
// Timeout/SERVFAIL = 'tidak_pasti' (jangan blokir). Hanya hasil pasti yang di-cache.
export async function cekDomainEmail(
  domain: string,
  opsi: { dns?: PenyelesaiDns; cache?: Map<string, EntriCache>; sekarang?: () => number } = {},
): Promise<StatusDomainEmail> {
  const dns = opsi.dns ?? ambilDnsBawaan();
  const cache = opsi.cache ?? cacheBersama;
  const sekarang = opsi.sekarang ?? Date.now;

  const tersimpan = cache.get(domain);
  if (tersimpan && tersimpan.sampai > sekarang()) return tersimpan.hasil;
  const simpan = (hasil: 'ada' | 'tidak_ada') => {
    cache.set(domain, { hasil, sampai: sekarang() + TTL_CACHE_MS });
    return hasil;
  };

  const mx = await tanya(() => dns.resolveMx(domain));
  if (mx.jawaban === 'tidak_ada_domain') return simpan('tidak_ada');
  if (mx.jawaban === 'ada') {
    const hanyaNull = (mx.data as Array<{ exchange?: string }>).every((m) => !m.exchange || m.exchange === '.');
    return simpan(hanyaNull ? 'tidak_ada' : 'ada');
  }

  const a = await tanya(() => dns.resolve4(domain));
  if (a.jawaban === 'ada') return simpan('ada');
  if (mx.jawaban === 'ragu' || a.jawaban === 'ragu') return 'tidak_pasti';
  return simpan('tidak_ada');
}
