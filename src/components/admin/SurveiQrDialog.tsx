'use client';

// Dialog "QR Pesan Perilaku" untuk staf (survei terpadu, spec 7.3): setelah kunjungan selesai (fo_selesai,
// layanan_selesai) atau dari tombol "Tampilkan QR" di daftar. Token undangan HANYA ditampilkan sebagai QR; tidak ada
// teks, tautan, ataupun tombol salin. Mengambil token lewat RPC ambil_qr_survei saat dibuka. Bila tidak ada token
// (kunjungan masih berjalan, sudah diisi, kedaluwarsa) dialog menutup dirinya TANPA menampilkan apa pun, jadi
// pemanggil boleh membukanya secara spekulatif. Selama memuat tidak ada yang dirender (tanpa kerangka berkedip).
import { useEffect, useRef, useState } from 'react';
import QRCodeDisplay from '@/components/QRCode';
import { clientEnv } from '@/lib/env/client';
import { createClient } from '@/lib/supabase/client';
import { ambilQrSurvei, urlSurvei } from '@/lib/survei/staf';
import { formatTanggalWaktu } from '@/lib/utils';
import FoDialog from './FoDialog';
import styles from './SurveiQrDialog.module.css';

interface Props {
  kunjunganId: string;
  onTutup: () => void;
}

type Keadaan =
  | { tahap: 'galat' }
  | { tahap: 'siap'; token: string; kedaluwarsaPada: string | null; layananNama: string | null };

/** Origin tautan survei: NEXT_PUBLIC_PUBLIC_URL (domain publik) bila ada, selain itu origin halaman staf. */
function asalSurvei(): string {
  return (clientEnv.NEXT_PUBLIC_PUBLIC_URL || window.location.origin).replace(/\/+$/, '');
}

export default function SurveiQrDialog({ kunjunganId, onTutup }: Props) {
  // Hasil disimpan bersama id kunjungannya: bila prop berganti, hasil lama otomatis dianggap "memuat".
  const [hasil, setHasil] = useState<{ untuk: string; keadaan: Keadaan } | null>(null);
  const onTutupRef = useRef(onTutup);
  useEffect(() => {
    onTutupRef.current = onTutup;
  });

  useEffect(() => {
    let batal = false;
    (async () => {
      let qr;
      try {
        qr = await ambilQrSurvei(createClient(), kunjunganId);
      } catch (e) {
        console.error('Gagal memuat QR Pesan Perilaku:', e);
        if (!batal) setHasil({ untuk: kunjunganId, keadaan: { tahap: 'galat' } });
        return;
      }
      if (batal) return;
      if (!qr.token) {
        onTutupRef.current();
        return;
      }
      setHasil({
        untuk: kunjunganId,
        keadaan: { tahap: 'siap', token: qr.token, kedaluwarsaPada: qr.kedaluwarsaPada, layananNama: qr.layananNama },
      });
    })();
    return () => {
      batal = true;
    };
  }, [kunjunganId]);

  const keadaan = hasil?.untuk === kunjunganId ? hasil.keadaan : null;
  if (!keadaan) return null;

  const tombolTutup = (
    <button type="button" className="btn btn--secondary btn--sm" onClick={onTutup}>
      Tutup
    </button>
  );

  if (keadaan.tahap === 'galat') {
    return (
      <FoDialog judul="QR Pesan Perilaku" onClose={onTutup} footer={tombolTutup}>
        <p role="alert" className={styles.galat}>
          QR belum dapat dimuat. Tutup dialog ini lalu coba lagi dari tombol Tampilkan QR di halaman Antrian atau Kunjungan.
        </p>
      </FoDialog>
    );
  }

  return (
    <FoDialog judul="QR Pesan Perilaku" onClose={onTutup} footer={tombolTutup}>
      <div className={styles.qr}>
        <div className={styles.kanvas} role="img" aria-label="Kode QR Pesan Perilaku untuk pengunjung">
          <QRCodeDisplay value={urlSurvei(asalSurvei(), keadaan.token)} size={240} />
        </div>
        <p className={styles.petunjuk}>
          Minta pengunjung memindai kode ini dengan kamera ponsel untuk mengisi Pesan Perilaku.
        </p>
        {keadaan.layananNama && <p className={styles.layanan}>{keadaan.layananNama}</p>}
        {keadaan.kedaluwarsaPada && (
          <p className={styles.batas}>Berlaku sampai {formatTanggalWaktu(keadaan.kedaluwarsaPada)} WIB</p>
        )}
      </div>
    </FoDialog>
  );
}
