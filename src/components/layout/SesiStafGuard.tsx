'use client';

import { Clock } from 'lucide-react';
import { useSesiStaf } from '@/lib/hooks/useSesiStaf';
import styles from './SesiStafGuard.module.css';

// Memasang heartbeat sesi tunggal staf di area admin dan menampilkan peringatan logout otomatis
// setelah jam tutup. Tidak membungkus children: cukup disisipkan di layout admin.
export default function SesiStafGuard() {
  const { sisaTutupDetik } = useSesiStaf();
  if (sisaTutupDetik === null) return null;

  return (
    <div className={styles.banner}>
      <div className={styles.content}>
        <Clock size={18} aria-hidden="true" />
        {/* Teks alert statis: hitung mundur tidak ikut dibacakan ulang tiap detik oleh pembaca layar. */}
        <div role="alert" className={styles.text}>
          Layanan sudah tutup. Anda akan keluar otomatis dalam satu menit. Selesaikan dan simpan pekerjaan Anda sekarang.
        </div>
        <span className={styles.hitung} aria-hidden="true">{sisaTutupDetik} dtk</span>
      </div>
    </div>
  );
}
