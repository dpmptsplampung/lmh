// Asal tautan untuk pesan ke pemohon: alamat publik aplikasi bila diatur, kalau tidak alamat peramban.
export function asalTautan(): string {
  const publik = (process.env.NEXT_PUBLIC_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  return publik || window.location.origin;
}
