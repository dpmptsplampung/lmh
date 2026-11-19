/** Fungsi murni halaman detail IPRO (tanpa I/O). */

/** Potong teks di batas kata dan beri elipsis bila melebihi `maks`. */
export function potongDeskripsi(teks: string, maks = 160): string {
  const bersih = teks.replace(/\s+/g, ' ').trim();
  if (bersih.length <= maks) return bersih;
  const potong = bersih.slice(0, maks - 1);
  const akhirKata = potong.lastIndexOf(' ');
  return `${(akhirKata > maks * 0.6 ? potong.slice(0, akhirKata) : potong).trimEnd()}…`;
}

/** Deskripsi teks polos: paragraf dipisah baris kosong. */
export function paragrafDari(deskripsi: string | null): string[] {
  if (!deskripsi) return [];
  return deskripsi.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
}

/** URL mutlak dari basis situs; tanpa basis yang sah mengembalikan `null`. */
export function urlMutlak(basis: string | undefined, jalur: string): string | null {
  try {
    const url = new URL(jalur, basis ?? '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** JSON-LD BreadcrumbList; hanya dibuat bila basis URL situs diketahui (item wajib mutlak). Tanpa data pribadi. */
export function breadcrumbJsonLd(basis: string | undefined, slug: string, judul: string) {
  const hub = urlMutlak(basis, '/investasi');
  const detail = urlMutlak(basis, `/investasi/ipro/${slug}`);
  if (!hub || !detail) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Investasi', item: hub },
      { '@type': 'ListItem', position: 2, name: judul, item: detail },
    ],
  };
}

/** Serialisasi aman untuk <script type="application/ld+json">: `<` di-escape agar tidak menutup tag. */
export const serialisasiJsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
