export const UKURAN_HALAMAN = 20;

export type SaringanIpro = { status: '' | 'draf' | 'terbit' | 'arsip'; sumber: '' | 'ptsp' | 'foila'; cari: string };
export const SARINGAN_AWAL: SaringanIpro = { status: '', sumber: '', cari: '' };

// Opsi untuk daftarIproKelola: kolom kosong tidak dikirim; halaman mulai dari 1.
export function bangunOpsi(s: SaringanIpro, halaman: number) {
  const dari = (Math.max(1, halaman) - 1) * UKURAN_HALAMAN;
  return {
    ...(s.status ? { status: s.status } : {}), ...(s.sumber ? { sumber: s.sumber } : {}),
    ...(s.cari.trim() ? { cari: s.cari.trim() } : {}), dari, sampai: dari + UKURAN_HALAMAN - 1,
  };
}
export const jumlahHalaman = (total: number) => Math.max(1, Math.ceil(total / UKURAN_HALAMAN));
export const adaSaringan = (s: SaringanIpro) => !!(s.status || s.sumber || s.cari.trim());
export function ringkasanRentang(halaman: number, jumlahBaris: number, total: number): string {
  if (total === 0 || jumlahBaris === 0) return 'Tidak ada IPRO';
  const dari = (halaman - 1) * UKURAN_HALAMAN + 1;
  return `Menampilkan ${dari}-${dari + jumlahBaris - 1} dari ${total} IPRO`;
}
