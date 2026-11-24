import { createHash } from 'node:crypto';
import { isIPv6 } from 'node:net';
import { nowServer } from '@/lib/time';

const JENDELA_MS = 60_000;
const MAKS_EMBER = 4096;

export function ipPeminta(request: Request): string {
  const terusan = request.headers.get('x-forwarded-for');
  if (terusan) return terusan.split(',')[0]!.trim();
  return request.headers.get('x-real-ip')?.trim() ?? '0.0.0.0';
}

function prefiksIp(ip: string): string {
  if (!isIPv6(ip)) return ip;
  // URL menyeragamkan huruf, nol awal, dan akhiran IPv4 sebelum pemadatan dibuka.
  const alamat = new URL(`http://[${ip.split('%', 1)[0]}]`).hostname.slice(1, -1);
  const [awal, akhir] = alamat.split('::');
  const kiri = awal ? awal.split(':') : [];
  const kanan = akhir ? akhir.split(':') : [];
  const bagian = akhir === undefined
    ? kiri
    : [...kiri, ...Array<string>(8 - kiri.length - kanan.length).fill('0'), ...kanan];
  return `${bagian.slice(0, 4).join(':')}::/64`;
}

/** Pembatas laju per instans, dengan kuota dan kapasitas terpisah untuk tiap pemanggil. */
export function buatPembatasLajuDokumen(maks: number) {
  const ember = new Map<string, { mulai: number; jumlah: number }>();
  return (ip: string): boolean => {
    const kunci = createHash('sha256').update(prefiksIp(ip)).digest('hex');
    const sekarang = nowServer().getTime();
    const entri = ember.get(kunci);
    if (entri && sekarang - entri.mulai < JENDELA_MS) {
      if (entri.jumlah >= maks) return false;
      entri.jumlah++;
      return true;
    }
    // Sisipkan ulang ember yang diperbarui agar urutan peta mengikuti awal jendela.
    if (entri) ember.delete(kunci);
    if (ember.size >= MAKS_EMBER) {
      const terlama = ember.keys().next().value;
      if (terlama !== undefined) ember.delete(terlama);
    }
    ember.set(kunci, { mulai: sekarang, jumlah: 1 });
    return true;
  };
}
