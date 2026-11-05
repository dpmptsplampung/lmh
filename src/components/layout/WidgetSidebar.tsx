'use client';

// Widget sidebar pengganti blok promosi (SISTEM-DESAIN 4.2). Isi per peran, tanpa kueri baru selain absensi
// petugas (useSesiKerja, per menit); angka lain dari lencana menu (useNavBadges, sudah berjalan di Sidebar).
import { useId, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronDown, Clock, LayoutDashboard, ConciergeBell } from 'lucide-react';
import type { AdminBadgeKey } from '@/lib/admin-nav';
import type { NavBadges } from '@/lib/hooks/useNavBadges';
import { useSesiKerja, type RingkasSesi } from '@/lib/hooks/useSesiKerja';
import styles from './WidgetSidebar.module.css';

export const KUNCI_WIDGET = 'lmh.sidebar.widget';

export interface WidgetSidebarProps {
  role: string;
  petugasId: string | null;
  /** Nama Layanan petugas (untuk "Layanan saya"). */
  layanan?: string | null;
  badges: NavBadges;
  onNavigasi?: () => void;
}

function bacaCiut(): boolean {
  try {
    return window.localStorage.getItem(KUNCI_WIDGET) === '1';
  } catch {
    return false;
  }
}

function simpanCiut(nilai: boolean) {
  try {
    window.localStorage.setItem(KUNCI_WIDGET, nilai ? '1' : '0');
  } catch {
    /* penyimpanan tidak tersedia: pilihan hanya berlaku di sesi ini */
  }
}

interface Baris {
  label: string;
  nilai: string;
}

function angka(badges: NavBadges, kunci: AdminBadgeKey): string {
  const b = badges[kunci];
  return b ? String(b.count) : '-';
}

export default function WidgetSidebar({ role, petugasId, layanan, badges, onNavigasi }: WidgetSidebarProps) {
  // Render awal selalu terbuka (deterministik); pilihan tersimpan dibaca sesudah mount lewat initializer lazy
  // karena komponen ini hanya dirender sesudah peran dimuat di klien.
  const [ciut, setCiut] = useState<boolean>(() => (typeof window === 'undefined' ? false : bacaCiut()));
  const idJudul = useId();
  const idIsi = useId();

  const petugas = role === 'petugas';
  const sesi = useSesiKerja(petugasId, petugas);

  const ubah = () => {
    setCiut((c) => {
      simpanCiut(!c);
      return !c;
    });
  };

  let judul = 'Hari ini';
  let ikon = <LayoutDashboard size={16} strokeWidth={1.75} />;
  let isi: React.ReactNode = null;
  let tombol: { href: string; teks: string } = { href: '/admin', teks: 'Buka dashboard' };
  let pil: string | null = null;

  if (petugas) {
    judul = 'Sesi kerja';
    ikon = <Clock size={16} strokeWidth={1.75} />;
    isi = <IsiSesi sesi={sesi} layanan={layanan ?? null} antrean={angka(badges, 'antrian')} />;
    tombol = sesi.status === 'belum'
      ? { href: '/admin/absensi', teks: 'Catat hadir' }
      : { href: '/admin/antrian', teks: 'Buka antrean' };
    pil = sesi.status === 'hadir' ? 'Hadir' : null;
  } else if (role === 'front_office') {
    judul = 'Loket hari ini';
    ikon = <ConciergeBell size={16} strokeWidth={1.75} />;
    isi = (
      <Daftar
        baris={[
          { label: 'Kotak masuk FO', nilai: angka(badges, 'kotakMasukFo') },
          { label: 'Penanganan menunggu', nilai: angka(badges, 'penangananFo') },
          { label: 'Chat menunggu', nilai: angka(badges, 'liveChat') },
        ]}
      />
    );
    tombol = { href: '/admin/fo/registrasi', teks: 'Registrasi pengunjung' };
  } else {
    isi = (
      <Daftar
        baris={[
          { label: 'Antrean menunggu', nilai: angka(badges, 'antrian') },
          { label: 'Chat menunggu', nilai: angka(badges, 'liveChat') },
          { label: 'Pengaduan baru', nilai: angka(badges, 'pengaduan') },
          { label: 'Saran belum ditinjau', nilai: angka(badges, 'saran') },
        ]}
      />
    );
  }

  return (
    <section className={styles.widget} aria-labelledby={idJudul} data-cetak="sembunyi" data-widget>
      <div className={styles.atas}>
        <h2 className={styles.judul} id={idJudul}>
          <span className={styles.ikon} aria-hidden="true">{ikon}</span>
          {judul}
        </h2>
        {pil && !ciut && <span className={styles.pil}>{pil}</span>}
        <button
          type="button"
          className={styles.ciut}
          aria-expanded={!ciut}
          aria-controls={idIsi}
          aria-label={ciut ? `Buka widget ${judul}` : `Ciutkan widget ${judul}`}
          onClick={ubah}
        >
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" className={ciut ? styles.chevronCiut : undefined} />
        </button>
      </div>
      <div id={idIsi} hidden={ciut}>
        {isi}
        <Link href={tombol.href} className={styles.tombol} onClick={onNavigasi}>
          {tombol.teks}
          <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function Daftar({ baris }: { baris: Baris[] }) {
  return (
    <dl className={styles.daftar}>
      {baris.map((b) => (
        <div key={b.label} className={styles.baris}>
          <dt>{b.label}</dt>
          <dd>{b.nilai}</dd>
        </div>
      ))}
    </dl>
  );
}

// Pembaruan durasi sengaja tanpa aria-live (SISTEM-DESAIN 4.2): pembaca layar tidak diganggu tiap menit.
function IsiSesi({ sesi, layanan, antrean }: { sesi: RingkasSesi; layanan: string | null; antrean: string }) {
  const baris: Baris[] = [];
  if (layanan) baris.push({ label: 'Layanan saya', nilai: layanan });
  baris.push({ label: 'Antrean menunggu', nilai: antrean });

  let utama: React.ReactNode;
  let meta: string | null = null;
  switch (sesi.status) {
    case 'hadir':
      utama = <p className={styles.waktu}>{sesi.durasi}</p>;
      meta = `Hadir sejak ${sesi.jamMasuk} WIB`;
      break;
    case 'pulang':
      utama = <p className={styles.keterangan}>Sesi hari ini selesai</p>;
      meta = `Hadir ${sesi.jamMasuk} WIB, pulang ${sesi.jamPulang} WIB`;
      break;
    case 'belum':
      utama = <p className={styles.keterangan}>Belum absen hari ini</p>;
      break;
    case 'menunggu':
      utama = <p className={styles.keterangan}>Menunggu persetujuan</p>;
      break;
    case 'ditolak':
      utama = <p className={styles.keterangan}>Absensi hari ini ditolak</p>;
      break;
    case 'memuat':
      utama = <p className={styles.keterangan}>Memuat sesi</p>;
      break;
    default:
      utama = <p className={styles.keterangan}>Data sesi belum tersedia</p>;
  }
  return (
    <>
      {utama}
      {meta && <p className={styles.meta}>{meta}</p>}
      <Daftar baris={baris} />
    </>
  );
}
