export function normalisasiSlug(teks: string): string {
  return teks.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100).replace(/-+$/g, '');
}

export function buatSlug(judul: string, urutan = 1): string {
  const dasar = normalisasiSlug(judul);
  const slug = dasar.length >= 3 ? dasar : `ipro${dasar ? `-${dasar}` : ''}`;
  return urutan > 1 ? `${slug}-${urutan}` : slug;
}
