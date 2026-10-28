'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import ErrorRetry from '@/components/ErrorRetry';
import PesanStatusSurvei from '@/components/survei/PesanStatusSurvei';
import SurveiWizard from '@/components/survei/SurveiWizard';
import styles from '@/components/survei/survei.module.css';
import { createClient } from '@/lib/supabase/client';
import { ambilKonteks, type KonteksSurvei } from '@/lib/survei/konteks';

type Muat = { tahap: 'memuat' } | { tahap: 'galat' } | { tahap: 'siap'; konteks: KonteksSurvei };

// Halaman publik "Pesan Perilaku": memuat status undangan (RPC anon get_survei_context), lalu menampilkan wizard
// (status ok) atau pesan ramah (kedaluwarsa, sudah diisi, tidak valid). Judul tab ada di layout.tsx (server component).
export default function SurveiPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const [muat, setMuat] = useState<Muat>({ tahap: 'memuat' });
  const [percobaan, setPercobaan] = useState(0);

  useEffect(() => {
    let dibatalkan = false;
    ambilKonteks(createClient(), token).then(
      (konteks) => {
        if (!dibatalkan) setMuat({ tahap: 'siap', konteks });
      },
      () => {
        if (!dibatalkan) setMuat({ tahap: 'galat' });
      },
    );
    return () => {
      dibatalkan = true;
    };
  }, [token, percobaan]);

  function muatUlang() {
    setMuat({ tahap: 'memuat' });
    setPercobaan((n) => n + 1);
  }

  return (
    <div className={styles.halaman}>
      <header className={styles.kepala}>
        <Image src="/logo.png" alt="" width={48} height={38} className={styles.logo} priority />
        <div>
          <p className={styles.instansi}>DPMPTSP Provinsi Lampung</p>
          <h1 className={styles.merek}>Pesan Perilaku</h1>
        </div>
      </header>

      {muat.tahap === 'memuat' && (
        <div role="status" className={styles.memuat}>
          <LoaderCircle size={20} className={styles.putar} aria-hidden="true" />
          <span>Memuat…</span>
        </div>
      )}
      {muat.tahap === 'galat' && (
        <ErrorRetry
          judul="Gagal memuat survei"
          pesan="Survei belum dapat dimuat. Periksa koneksi internet Anda lalu coba lagi."
          onRetry={muatUlang}
        />
      )}
      {muat.tahap === 'siap' &&
        (muat.konteks.status === 'ok' ? (
          <SurveiWizard key={token} token={token} konteks={muat.konteks} />
        ) : (
          <PesanStatusSurvei status={muat.konteks.status} />
        ))}
    </div>
  );
}
