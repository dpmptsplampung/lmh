'use client';

// Menghubungkan popup layanan dengan alamat /?layanan=<slug> (sumber kebenaran = query string, sehingga bisa
// dibagikan, ditautkan bot, dan tombol Kembali menutup popup). Satu-satunya bagian halaman yang memakai
// useSearchParams, jadi dibungkus <Suspense> oleh pemanggil agar sisa halaman tetap diprerender.
//  - Dibuka dari kartu: pemanggil mem-push alamat dan menandai `dariKartuRef`; menutup = router.back().
//  - Dibuka lewat alamat langsung: menutup = router.replace('/') (tidak keluar dari situs).
//  - Slug tak dikenal (mis. layanan diarsipkan): tidak ada popup.
import { useEffect, useState, type MutableRefObject } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { muatAntrean, type AntreanLayanan, type LayananEtalase, type StatusHariIni } from '@/lib/homepage/data';
import LayananPopup from './LayananPopup';

interface Props {
  /** SEMUA layanan publik (termasuk yang tanpa kartu) agar tautan ke layanan tersembunyi tetap hidup. */
  layanan: LayananEtalase[];
  status: Map<string, StatusHariIni> | null;
  /**
   * Slug yang BARU di-push oleh klik kartu (ada entri riwayat yang bisa dikembalikan); null = tidak ada.
   * Dibandingkan dengan slug aktif saat menutup, jadi tidak perlu direset lewat efek (bebas balapan render).
   */
  dariKartuRef: MutableRefObject<string | null>;
}

// Dipasang dengan key=id layanan: state antrean mulai segar (undefined = memuat) tiap popup dibuka.
function PopupTerbuka({ layanan, status, onTutup }: {
  layanan: LayananEtalase;
  status: Map<string, StatusHariIni> | null;
  onTutup: () => void;
}) {
  const [antrean, setAntrean] = useState<AntreanLayanan | null | undefined>(undefined);

  useEffect(() => {
    let batal = false;
    muatAntrean(createClient()).then((peta) => {
      if (!batal) setAntrean(peta ? (peta.get(layanan.id) ?? { antre: 0, dilayani: 0, estimasiTungguMenit: 0 }) : null);
    });
    return () => {
      batal = true;
    };
  }, [layanan.id]);

  return <LayananPopup layanan={layanan} status={status?.get(layanan.id) ?? null} antrean={antrean} onTutup={onTutup} />;
}

export default function PopupDariUrl({ layanan, status, dariKartuRef }: Props) {
  const router = useRouter();
  const slug = useSearchParams().get('layanan');

  const aktif = slug ? layanan.find((l) => l.slug === slug) : undefined;
  if (!aktif) return null;

  const tutup = () => {
    if (dariKartuRef.current === aktif.slug) {
      dariKartuRef.current = null;
      router.back();
    } else {
      router.replace('/', { scroll: false });
    }
  };

  return <PopupTerbuka key={aktif.id} layanan={aktif} status={status} onTutup={tutup} />;
}
