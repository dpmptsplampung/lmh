import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import AngkaKunci from '@/components/investasi/AngkaKunci';
import GaleriGambar from '@/components/investasi/GaleriGambar';
import KerangkaInvestasi from '@/components/investasi/KerangkaInvestasi';
import { CONTACT_EMAIL_FALLBACK } from '@/lib/constants';
import { muatIproPublik } from '@/lib/data/publik-server';
import AksiIpro from './_bagian/AksiIpro';
import HeroIpro from './_bagian/HeroIpro';
import KontakIpro from './_bagian/KontakIpro';
import TabelFakta from './_bagian/TabelFakta';
import { breadcrumbJsonLd, paragrafDari, potongDeskripsi, serialisasiJsonLd, urlMutlak } from './_logika/detail';
import styles from './detail.module.css';

// Harus literal (dibaca statis oleh Next); sama dengan REVALIDASI_DETIK di lib/data/publik-server.ts.
export const revalidate = 60;
// Slug baru dirender saat diminta lalu ikut ISR (docs Next 16: generate-static-params).
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };
const BASIS_URL = process.env.NEXT_PUBLIC_PUBLIC_URL;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  let ipro;
  try {
    ipro = await muatIproPublik(slug);
  } catch {
    return { title: 'Proyek investasi' };
  }
  if (!ipro) return { title: 'Proyek tidak ditemukan', robots: { index: false } };
  const deskripsi = potongDeskripsi(ipro.ringkasan);
  const utama = ipro.gambar.find(g => g.utama) ?? ipro.gambar[0];
  const kanonik = urlMutlak(BASIS_URL, `/investasi/ipro/${slug}`) ?? `/investasi/ipro/${slug}`;
  return {
    title: ipro.judul,
    description: deskripsi,
    alternates: { canonical: kanonik },
    openGraph: {
      title: ipro.judul,
      description: deskripsi,
      url: kanonik,
      type: 'website',
      ...(utama ? { images: [{ url: utama.url, width: utama.lebar, height: utama.tinggi, alt: utama.alt }] } : {}),
    },
  };
}

export default async function DetailIproPage({ params }: Props) {
  const { slug } = await params;
  // Galat sesaat dilempar ke error.tsx (bukan 404); slug tak terbit atau milik FOILA = null.
  const ipro = await muatIproPublik(slug);
  if (!ipro) notFound();

  const dokumenAktif = ipro.dokumen;
  const dokumen = dokumenAktif ? { id: dokumenAktif.id, judul: dokumenAktif.judul, jumlahHalaman: dokumenAktif.jumlah_halaman ?? 0 } : null;
  const paragraf = paragrafDari(ipro.deskripsi);
  const jsonLd = breadcrumbJsonLd(BASIS_URL, slug, ipro.judul);

  return (
    <KerangkaInvestasi aktif="detail">
      <main className={styles.halaman}>
        {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialisasiJsonLd(jsonLd) }} />}
        <HeroIpro
          ipro={ipro}
          aksi={<AksiIpro ipro={{ id: ipro.id, judul: ipro.judul }} dokumen={dokumen} kontakEmail={CONTACT_EMAIL_FALLBACK} />}
        />
        <div className={styles.isi}>
          <div className={styles.kolomUtama}>
            <AngkaKunci data={ipro} />
            {paragraf.length > 0 && (
              <section aria-labelledby="judul-deskripsi">
                <h2 id="judul-deskripsi" className={styles.blokJudul}>Tentang proyek</h2>
                <div className={styles.deskripsi}>{paragraf.map((p, i) => <p key={i}>{p}</p>)}</div>
              </section>
            )}
            <section aria-labelledby="judul-fakta">
              <h2 id="judul-fakta" className={styles.blokJudul}>Rincian proyek</h2>
              <TabelFakta ipro={ipro} />
            </section>
            {ipro.gambar.length > 1 && (
              <section aria-labelledby="judul-galeri">
                <h2 id="judul-galeri" className={styles.blokJudul}>Foto proyek</h2>
                <GaleriGambar gambar={ipro.gambar} judul={ipro.judul} />
              </section>
            )}
          </div>
          <aside className={styles.kolomSamping}>
            <KontakIpro ipro={ipro} />
          </aside>
        </div>
      </main>
    </KerangkaInvestasi>
  );
}
