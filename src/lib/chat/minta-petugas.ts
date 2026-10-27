// Deteksi niat pengunjung meminta bicara dengan petugas (Fase 5, K6). Murni, tanpa LLM, SENGAJA konservatif: salah
// positif di luar jam kerja = satu email ke petugas (maks. satu per sesi), jadi kalimat biasa yang hanya menyebut
// "petugas" (syarat menjadi petugas, jam buka petugas loket) tidak boleh cocok.

const TARGET = '(?:petugas|operator|cs|customer service|admin|staf|staff|pegawai|manusia)';
const KATA_KERJA =
  '(?:bicara|berbicara|ngobrol|mengobrol|chat|menghubungi|hubungi|hubungkan|sambungkan|sambungin|teruskan|alihkan|' +
  'telepon|telpon|bertemu|ketemu|minta|meminta|pengen|ingin|mau|butuh)';

// Pembicaraan tentang menjadi/melamar petugas bukan permintaan bantuan.
const BUKAN_PERMINTAAN = /\b(jadi|menjadi|lowongan|melamar|rekrut|rekrutmen|gaji|tugas)\b/;

const POLA_KERJA = new RegExp(`\\b${KATA_KERJA}\\b[^.?!]{0,40}?\\b${TARGET}\\b`);
const POLA_SINGKAT = /^(?:tolong |mohon |saya )?(?:petugas|operator|cs|customer service|admin)(?: ya| dong| aja| saja| dong ya)?$/;
const POLA_TANYA = /\b(?:tanya|bertanya|konsultasi)(?: langsung)? (?:ke|kepada|sama|dengan|pada) (?:petugas|operator|cs|customer service)\b/;
const POLA_BUKAN_BOT = /\b(?:bukan|tanpa|tidak mau|nggak mau|gak mau) (?:bot|robot|chatbot)\b/;

export const BATAS_PANJANG_NIAT = 200;

export function mintaPetugas(teks: string): boolean {
  const t = teks
    .toLowerCase()
    .replace(/[,;:!"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?]+$/, '')
    .trim();
  if (!t || t.length > BATAS_PANJANG_NIAT) return false;
  if (POLA_SINGKAT.test(t)) return true;
  if (BUKAN_PERMINTAAN.test(t)) return false;
  return POLA_KERJA.test(t) || POLA_TANYA.test(t) || POLA_BUKAN_BOT.test(t);
}
