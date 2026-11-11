// Transparansi IKM publik (Server Component ber-cache). IKM kuartal berjalan (WIB) per layanan dimuat di server lewat
// muatTransparansiPublik() (klien anon tanpa cookie, unstable_cache 60 detik, tag publik-transparansi/publik-layanan):
// RPC hitung_ikm adalah SECURITY DEFINER dengan EXECUTE untuk anon dan tabel layanan terbaca publik (RLS
// `layanan_public_read`), jadi pengunjung tanpa sesi menerima isi yang sama. Halaman TIDAK membaca sesi, cookies, atau
// headers. Satu-satunya bagian klien: grafik Recharts yang dimuat malas (IkmPanelMalas), hanya menerima data biasa.
import Link from 'next/link';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { muatTransparansiPublik } from '@/lib/data/publik-server';
import { IkmPanelMalas as IkmPanel } from '@/components/ui/grafik/dinamis';
import styles from './transparansi.module.css';

// Harus literal (dibaca statis oleh Next); sama dengan REVALIDASI_DETIK di lib/data/publik-server.ts.
export const revalidate = 60;

/** Waktu data dihitung, dalam WIB (server berjalan di UTC; tanpa zona hasilnya salah tujuh jam). */
function formatDiperbarui(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
}

export default async function TransparansiPage() {
  const { rows, diperbaruiPada, galat } = await muatTransparansiPublik();

  return (
    <div className={styles.tPage}>
      <div className={styles.tCard}>
        <Link href="/" className={styles.tBackLink}>
          <ArrowLeft size={16} />
          Kembali ke Beranda
        </Link>

        <div className={styles.tHeader}>
          <h1 className={styles.tTitle}>Transparansi Layanan — IKM Publik</h1>
          <p className={styles.tSubtitle}>
            Indeks Kepuasan Masyarakat (PermenPANRB 14/2017) — Kuartal Ini
          </p>
        </div>

        <div className={styles.tIntro}>
          Halaman ini menampilkan hasil Survei Kepuasan Masyarakat secara agregat
          per layanan. Tidak ada data pribadi yang ditampilkan. IKM dihitung dari
          9 unsur kepuasan dengan skala 25-100.
        </div>

        {galat && (
          <div className={styles.tError} role="alert">
            <AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Gagal memuat data IKM. Coba lagi nanti.
          </div>
        )}

        <IkmPanel rows={rows} periodLabel="Kuartal Ini" mode="public" />

        {!galat && (
          <div className={styles.tFooter}>
            Diperbarui: {formatDiperbarui(diperbaruiPada)}
          </div>
        )}
      </div>
    </div>
  );
}
