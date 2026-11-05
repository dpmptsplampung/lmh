'use client';

import { useEffect, useState } from 'react';
import { Mail, X } from 'lucide-react';
import Tombol from '@/components/ui/Tombol';
import styles from './BannerEmailNotifikasi.module.css';

const KUNCI_TUTUP = 'lmh:banner-email-notifikasi-ditutup';

function sudahDitutup(): boolean {
  try {
    return window.sessionStorage.getItem(KUNCI_TUTUP) === '1';
  } catch {
    return false;
  }
}

type Keadaan = 'diam' | 'belumDiisi' | 'belumTerverifikasi';

/**
 * Pengingat halus di Dashboard: email notifikasi belum diisi atau belum terverifikasi.
 * Tidak memblokir apa pun (keputusan pemilik 2026-11-03), bisa ditutup per sesi, dan diam bila profil gagal dimuat.
 */
export default function BannerEmailNotifikasi() {
  const [keadaan, setKeadaan] = useState<Keadaan>('diam');

  useEffect(() => {
    if (sudahDitutup()) return;
    let hidup = true;
    (async () => {
      try {
        const res = await fetch('/api/me/profil');
        if (!res.ok) return;
        const p = (await res.json())?.profil as
          | { email_notifikasi: string | null; email_notifikasi_terverifikasi: boolean }
          | undefined;
        if (!hidup || !p) return;
        if (!p.email_notifikasi) setKeadaan('belumDiisi');
        else if (!p.email_notifikasi_terverifikasi) setKeadaan('belumTerverifikasi');
      } catch {
        /* diam: pengingat tidak boleh mengganggu dashboard */
      }
    })();
    return () => {
      hidup = false;
    };
  }, []);

  if (keadaan === 'diam') return null;

  const tutup = () => {
    try {
      window.sessionStorage.setItem(KUNCI_TUTUP, '1');
    } catch {
      /* abaikan: tetap tersembunyi selama komponen ini hidup */
    }
    setKeadaan('diam');
  };

  return (
    <div className={styles.banner} role="status">
      <Mail size={16} aria-hidden="true" />
      <span className={styles.teks}>
        {keadaan === 'belumDiisi'
          ? 'Email notifikasi Anda belum diisi. Dengan email yang terverifikasi, Anda menerima notifikasi dan dapat mengatur ulang kata sandi sendiri.'
          : 'Email notifikasi Anda belum terverifikasi. Notifikasi dan pengaturan ulang kata sandi belum dapat dikirim ke alamat itu.'}
      </span>
      <span className={styles.aksi}>
        <Tombol href="/admin/profil" varian="sekunder" ukuran="kecil">Buka Profil Saya</Tombol>
        <Tombol varian="hantu" ukuran="kecil" ikon={X} onClick={tutup} aria-label="Tutup pengingat"><span className="sr-only">Tutup pengingat</span></Tombol>
      </span>
    </div>
  );
}
