// Logika murni skrip pengisi kartu FOILA (diuji di src/lib/investasi/isi-kartu-foila.test.ts).
// Memetakan proyek publik FOILA menjadi baris ipro_proyek berstatus draf. Tanpa I/O.

export const API_FOILA = 'https://invest.lampungprov.go.id/backend/api/projects';
export const UNGGAHAN_FOILA = 'https://invest.lampungprov.go.id/backend/uploads/';
export const HOST_FOILA = 'invest.lampungprov.go.id';

/** Keputusan pemilik 2026-11-21: pemetaan sektor per proyek (FOILA hanya punya lima sektor kasar). */
export const SEKTOR_PER_SLUG = {
  'lampung-sport-centre-lsc-integrated-sports-convention-lifestyle-destination': 'pariwisata',
  'kawasan-industri-lampung-ii': 'industri',
  'kawasan-wisata-terpadu-lampung-selatan-pesawaran-dan-tanggamus': 'pariwisata',
  'floating-solar-power-plant-way-jepara-dam': 'energi',
  'floating-solar-power-plant-batu-tegi-dam': 'energi',
  'kawasan-kolaborasi-institut-teknologi-sumatra-itera': 'kawasan',
  'kawasan-ekonomi-biru-tulang-bawang': 'perikanan',
};

/** Ejaan FOILA -> ejaan daftar wilayah LMH (WILAYAH_LAMPUNG). */
const KAB_KOTA = {
  'Bandar Lampung': 'Kota Bandar Lampung',
  'Kabupaten Lampung Selatan': 'Kab. Lampung Selatan',
  'Kabupaten Lampung Timur': 'Kab. Lampung Timur',
  'Kabupaten Tanggamus': 'Kab. Tanggamus',
  'Tulang Bawang': 'Kab. Tulang Bawang',
};
/** Proyek lintas kabupaten: lokasi FOILA hanya memuat satu, padahal judul menyebut tiga. */
const LINTAS = new Set(['kawasan-wisata-terpadu-lampung-selatan-pesawaran-dan-tanggamus']);

const ENTITAS = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&rsquo;': '’', '&lsquo;': '‘', '&ndash;': '–', '&mdash;': '—' };

export function bersihkanHtml(html) {
  return String(html ?? '')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITAS[e.toLowerCase()] ?? ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Potong di batas kata sampai maks karakter; beri elipsis bila terpotong. */
export function ringkas(teks, maks = 600) {
  const t = bersihkanHtml(teks);
  if (t.length <= maks) return t;
  const potong = t.slice(0, maks - 1);
  const spasi = potong.lastIndexOf(' ');
  return `${(spasi > maks * 0.6 ? potong.slice(0, spasi) : potong).replace(/[\s,;:.–—-]+$/u, '')}…`;
}

export function normalisasiSlug(teks) {
  return teks.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100).replace(/-+$/g, '');
}

export function urlKartu(slugFoila) {
  return `https://${HOST_FOILA}/project/${slugFoila}`;
}

/** Satu proyek FOILA -> baris ipro_proyek (draf). Melempar bila pemetaan tidak diketahui. */
export function petakanProyek(p) {
  const sektor = SEKTOR_PER_SLUG[p.slug];
  if (!sektor) throw new Error(`Sektor belum diputuskan untuk slug: ${p.slug}`);
  const kab = LINTAS.has(p.slug) ? 'Lintas Kabupaten/Kota' : KAB_KOTA[(p.location ?? '').trim()];
  if (!kab) throw new Error(`Lokasi FOILA tak dikenal untuk ${p.slug}: ${p.location}`);
  const id = p.translations?.id ?? {};
  const en = p.translations?.en ?? {};
  const judul = bersihkanHtml(id.title || p.title).slice(0, 200);
  const judulEn = bersihkanHtml(en.title || p.title).slice(0, 200);
  const ringkasan = ringkas(id.description || p.description);
  const ringkasanEn = ringkas(en.description || p.description);
  if (judul.length < 3 || !ringkasan) throw new Error(`Judul atau ringkasan kosong: ${p.slug}`);
  return {
    sumber: 'foila',
    judul,
    judul_en: judulEn.length >= 3 ? judulEn : null,
    ringkasan,
    ringkasan_en: ringkasanEn || null,
    slug: normalisasiSlug(judul),
    sektor,
    kab_kota: kab,
    nilai_investasi: null,
    mata_uang: 'IDR',
    nilai_teks: null,
    sumber_url: urlKartu(p.slug),
    sumber_slug: p.slug,
    urutan: 0,
    thumbnail: p.thumbnail || null,
  };
}

export function urlThumbnail(nama) {
  if (!nama || /[\\/]|\.\./.test(nama)) throw new Error(`Nama thumbnail tak sah: ${nama}`);
  return `${UNGGAHAN_FOILA}${encodeURIComponent(nama)}`;
}

export function teksAlt(judul) {
  return `Foto proyek ${judul}`.slice(0, 200);
}
