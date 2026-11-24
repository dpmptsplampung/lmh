import type { Metadata } from 'next';
import KerangkaInvestasi from '@/components/investasi/KerangkaInvestasi';
import PenyediaDokumen from '@/components/investasi/PenyediaDokumen';
import SorotanPetaPotensi from '@/components/investasi/SorotanPetaPotensi';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import { CONTACT_EMAIL_FALLBACK } from '@/lib/constants';
import { muatAngkaInvestasiPublik, muatInvestasiPublik } from '@/lib/data/publik-server';
import AjakanHub from './_bagian/AjakanHub';
import PahlawanHub from './_bagian/PahlawanHub';
import SeksiDokumen from './_bagian/SeksiDokumen';
import SeksiFoila from './_bagian/SeksiFoila';
import SeksiIproPtsp from './_bagian/SeksiIproPtsp';
import SeksiJelajahProyek from './_bagian/SeksiJelajahProyek';
import styles from './investasi.module.css';

// Harus literal (dibaca statis oleh Next); sama dengan REVALIDASI_DETIK di lib/data/publik-server.ts.
export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Peluang Investasi Lampung',
  description: 'Proyek investasi siap ditawarkan di Provinsi Lampung, Peta Potensi, jelajah proyek per sektor dan wilayah, serta dokumen kajian di Investment Gallery DPMPTSP Provinsi Lampung.',
  alternates: { canonical: '/investasi' },
  openGraph: { siteName: 'Investment Gallery' },
};

export default async function InvestasiPage() {
  // Dua loader berdiri sendiri: galat angka hero tidak menutup katalog, dan sebaliknya.
  const [data, ringkasan] = await Promise.all([muatInvestasiPublik(), muatAngkaInvestasiPublik()]);
  return (
    <KerangkaInvestasi aktif="hub">
      <PenyediaDokumen kontakEmail={CONTACT_EMAIL_FALLBACK}>
        <PahlawanHub jumlahProyek={data.ptsp.length} angka={ringkasan.galat ? null : ringkasan.angka} />
        {data.galat && (
          <div className={styles.pita}>
            <div className={styles.pitaIsi}>
              <CatatanKeadaan jenis="galat" judul="Sebagian data belum dapat dimuat">
                Daftar di bawah mungkin belum lengkap. Muat ulang halaman beberapa saat lagi.
              </CatatanKeadaan>
            </div>
          </div>
        )}
        {data.petaPotensi && (
          <div className={`${styles.pita} ${styles.pitaSorotan}`}>
            <div className={styles.pitaIsi}><SorotanPetaPotensi dokumen={data.petaPotensi} /></div>
          </div>
        )}
        <SeksiIproPtsp daftar={data.ptsp} />
        {data.ptsp.length > 0 && <SeksiJelajahProyek sebaran={data.ptsp.map(({ sektor, kab_kota }) => ({ sektor, kab_kota, jumlah: 1 }))} />}
        <SeksiFoila daftar={data.foila} />
        <SeksiDokumen daftar={data.dokumen} />
        <AjakanHub />
      </PenyediaDokumen>
    </KerangkaInvestasi>
  );
}
