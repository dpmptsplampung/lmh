import type { Metadata } from 'next';
import KerangkaInvestasi from '@/components/investasi/KerangkaInvestasi';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import { muatInvestasiPublik } from '@/lib/data/publik-server';
import AjakanHub from './_bagian/AjakanHub';
import PahlawanHub from './_bagian/PahlawanHub';
import SeksiDokumen from './_bagian/SeksiDokumen';
import SeksiFoila from './_bagian/SeksiFoila';
import SeksiIproPtsp from './_bagian/SeksiIproPtsp';
import SeksiPetaPotensi from './_bagian/SeksiPetaPotensi';
import styles from './investasi.module.css';

// Harus literal (dibaca statis oleh Next); sama dengan REVALIDASI_DETIK di lib/data/publik-server.ts.
export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Peluang Investasi Lampung',
  description: 'Proyek investasi siap ditawarkan di Provinsi Lampung, peta potensi per sektor dan wilayah, serta dokumen kajian dari DPMPTSP Provinsi Lampung.',
  alternates: { canonical: '/investasi' },
};

export default async function InvestasiPage() {
  const data = await muatInvestasiPublik();
  return (
    <KerangkaInvestasi aktif="hub">
      <main>
        <div className={styles.halaman}>
          <PahlawanHub jumlahProyek={data.ptsp.length} />
          {data.galat && (
            <CatatanKeadaan jenis="galat" judul="Sebagian data belum dapat dimuat">
              Daftar di bawah mungkin belum lengkap. Muat ulang halaman beberapa saat lagi.
            </CatatanKeadaan>
          )}
          <SeksiIproPtsp daftar={data.ptsp} />
          {data.ptsp.length > 0 && <SeksiPetaPotensi sebaran={data.ptsp.map(({ sektor, kab_kota }) => ({ sektor, kab_kota, jumlah: 1 }))} />}
          <SeksiFoila daftar={data.foila} />
          <SeksiDokumen daftar={data.dokumen} />
          <AjakanHub />
        </div>
      </main>
    </KerangkaInvestasi>
  );
}
