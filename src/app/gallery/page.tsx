import type { Metadata } from 'next';
import KerangkaInvestasi from '@/components/investasi/KerangkaInvestasi';
import PenyediaDokumen from '@/components/investasi/PenyediaDokumen';
import SorotanPetaPotensi from '@/components/investasi/SorotanPetaPotensi';
import { CONTACT_EMAIL_FALLBACK } from '@/lib/constants';
import { muatGaleriPublik, muatInvestasiPublik } from '@/lib/data/publik-server';
import DaftarDokumen from './_bagian/DaftarDokumen';
import KepalaGaleri from './_bagian/KepalaGaleri';
import TautanFoila from './_bagian/TautanFoila';
import { nomorHalaman, pisahSorotan } from './_logika/galeri';
import styles from './gallery.module.css';

export const metadata: Metadata = {
  title: 'Investment Gallery',
  description: 'Dokumen peluang investasi Provinsi Lampung: Peta Potensi, kajian, dan profil proyek dari DPMPTSP Provinsi Lampung. Dibaca daring, hanya lihat.',
  alternates: { canonical: '/gallery' },
  openGraph: { siteName: 'Investment Gallery' },
};

type Props = { searchParams: Promise<{ halaman?: string | string[] }> };

/** Katalog lengkap dokumen investasi. Server Component: data dari loader ber-cache, hanya buka/tutup penampil yang di klien. */
export default async function GalleryPage({ searchParams }: Props) {
  const halaman = nomorHalaman((await searchParams).halaman);
  const pertama = halaman === 1;
  // Peta Potensi dicari di seluruh katalog (loader hub), terpisah dari halaman daftar; galatnya tidak menutup daftar.
  const [galeri, hub] = await Promise.all([muatGaleriPublik(halaman), pertama ? muatInvestasiPublik() : Promise.resolve(null)]);
  const { sorotan, sisa } = pisahSorotan(galeri.dokumen, hub?.petaPotensi ?? null, pertama);

  return (
    <KerangkaInvestasi aktif="dokumen">
      <PenyediaDokumen kontakEmail={CONTACT_EMAIL_FALLBACK}>
        <KepalaGaleri />
        <div className={styles.isi}>
          {sorotan && <SorotanPetaPotensi dokumen={sorotan} />}
          <DaftarDokumen
            dokumen={sisa}
            galat={galeri.galat}
            adaBerikutnya={galeri.adaBerikutnya}
            halaman={halaman}
            adaSorotan={sorotan !== null}
          />
          <TautanFoila />
        </div>
      </PenyediaDokumen>
    </KerangkaInvestasi>
  );
}
