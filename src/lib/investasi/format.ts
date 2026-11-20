type MataUang = 'IDR' | 'USD';
const angka = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(n);

export function formatNilaiRingkas(nilai: number | null, mataUang: MataUang = 'IDR'): string {
  if (nilai === null || !Number.isFinite(nilai)) return '—';
  const [pembagi, akhiran] = Math.abs(nilai) >= 1e12 ? [1e12, ' T'] : Math.abs(nilai) >= 1e9 ? [1e9, ' M']
    : Math.abs(nilai) >= 1e6 ? [1e6, ' jt'] : [1, ''];
  return `${mataUang === 'USD' ? 'USD' : 'Rp'} ${angka(nilai / pembagi)}${akhiran}`;
}
export const formatRupiahRingkas = (nilai: number | null) => formatNilaiRingkas(nilai, 'IDR');
export const formatPersen = (nilai: number | null) => nilai === null || !Number.isFinite(nilai) ? '—' : `${angka(nilai)}%`;
export function formatPayback(bulan: number | null): string {
  if (bulan === null || !Number.isFinite(bulan) || bulan < 1) return '—';
  const tahun = Math.floor(bulan / 12), sisa = bulan % 12;
  return [tahun ? `${tahun} tahun` : '', sisa ? `${sisa} bulan` : ''].filter(Boolean).join(' ');
}
