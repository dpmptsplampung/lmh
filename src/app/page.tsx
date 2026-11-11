// Homepage = etalase layanan (Server Component ber-cache). Tersusun dari blok berjenis tetap (lib/homepage/blok.ts)
// yang diatur admin di /admin/settings/landing: hero, jalur cepat, status hari ini (antrean), cari & daftar layanan,
// papan kinerja (tercadang), ajakan, footer. Blok mati TIDAK dirender. Kartu layanan terisi otomatis dari Kelola
// Layanan (v_layanan_publik); klik kartu membuka popup dengan alamat /?layanan=<slug>.
//
// Data (blok + layanan + pengaturan situs) dimuat di server lewat muatBerandaPublik() (klien anon tanpa cookie,
// unstable_cache 60 detik, tag publik-beranda/publik-layanan) dan ikut di HTML awal. Halaman TIDAK membaca sesi,
// cookies, atau headers; semua yang bergantung pengguna/peramban hidup di pulau klien kecil:
//  - PulauPengguna: bilah navigasi (sesi + peran + menu seluler);
//  - PulauStatus: kartu layanan + status buka hari ini + popup /?layanan= (dibungkus <Suspense> di dalamnya);
//  - blok klien lain (BlokHero, EstimasiAntrean, dst.) hanya menerima data biasa.
// Server Component tidak boleh mengoper fungsi atau komponen ikon ke komponen klien (ikon ditaruh di dalam isi).
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { muatBerandaPublik } from '@/lib/data/publik-server';
import { blokTampil, type BlokTersusun } from '@/lib/homepage/blok';
import { waLink } from '@/lib/utils';
import EstimasiAntrean from '@/components/EstimasiAntrean';
import PulauPengguna from '@/components/homepage/PulauPengguna';
import PulauStatus from '@/components/homepage/PulauStatus';
import {
  BlokAjakan,
  BlokFooter,
  BlokHero,
  BlokJalurCepat,
  BlokPapanKinerja,
  TautanKebijakan,
  type KontakFooter,
} from '@/components/homepage/BlokLain';
import styles from './landing.module.css';

// Harus literal (dibaca statis oleh Next); sama dengan REVALIDASI_DETIK di lib/data/publik-server.ts.
export const revalidate = 60;

export default async function LandingPage() {
  const { blok, layanan, layananGalat, pengaturan } = await muatBerandaPublik();

  const waHref = waLink(pengaturan.wa_number, pengaturan.wa_default_message);
  const kontak: KontakFooter = {
    address: pengaturan.contact_address,
    hours: pengaturan.contact_hours,
    email: pengaturan.contact_email,
  };

  const tampil = blokTampil(blok);
  // Menu "Layanan" hanya berguna bila blok daftar layanan tampil.
  const adaBlokLayanan = tampil.some((b) => b.jenis === 'layanan');

  const renderBlok = (b: BlokTersusun) => {
    switch (b.jenis) {
      case 'hero':
        return <BlokHero key={b.jenis} teks={b.teks} waHref={waHref} />;
      case 'jalur_cepat':
        return <BlokJalurCepat key={b.jenis} teks={b.teks} />;
      case 'status_hari_ini':
        return <EstimasiAntrean key={b.jenis} judul={b.teks.title} penjelasan={b.teks.description} />;
      case 'layanan':
        return <PulauStatus key={b.jenis} layanan={layanan} layananGalat={layananGalat} teksDaftar={b.teks} />;
      case 'papan_kinerja':
        return <BlokPapanKinerja key={b.jenis} teks={b.teks} />;
      case 'ajakan':
        return <BlokAjakan key={b.jenis} teks={b.teks} />;
      case 'footer':
        return <BlokFooter key={b.jenis} teks={b.teks} kontak={kontak} />;
    }
  };

  return (
    <div className={styles.landing}>
      <PulauPengguna adaBlokLayanan={adaBlokLayanan} />

      {tampil.map(renderBlok)}

      {/* Selalu tampil, tidak bergantung pada blok footer. */}
      <TautanKebijakan />

      {/* Blok layanan mati: tidak ada kartu, tetapi popup lewat alamat /?layanan=<slug> tetap hidup (tautan bot). */}
      {!adaBlokLayanan && <PulauStatus layanan={layanan} layananGalat={layananGalat} />}

      {/* Floating Chat Widget */}
      <Link href="/chat" className={styles.floatingChat}>
        <MessageSquare size={18} />
        <span>Live Chat</span>
      </Link>
    </div>
  );
}
