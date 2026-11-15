'use client';

// Pulau klien daftar layanan beranda. Beranda `/` adalah Server Component ber-cache; daftar layanan (kartu)
// datang dari server sebagai props sehingga SUDAH ada di HTML awal. Yang tetap hidup di klien (karena bergantung
// waktu/peramban, bukan data cache):
//  - status buka hari ini (RPC layanan_status_hari_ini): dimuat klien setelah hidrasi dan ditempel ke kartu +
//    popup; bila lambat/gagal kartu tetap tampil tanpa lencana status (status dihilangkan, bukan ditebak);
//  - Coba lagi pada galat daftar (memuat ulang HANYA daftar lewat klien peramban, A-01);
//  - popup layanan dengan alamat /?layanan=<slug> (PopupDariUrl, memakai useSearchParams sehingga dibungkus
//    <Suspense>) dan penanda `dariKartuRef` yang dibagi dengan kartu.
// `teksDaftar` kosong = blok "layanan" dimatikan admin: kartu tidak dirender, tetapi popup lewat alamat tetap
// hidup agar tautan dari bot ke layanan tidak mati.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  BATAS_MUAT_MS,
  GAGAL_LAYANAN,
  denganBatasWaktu,
  muatLayananKetat,
  muatStatusHariIni,
  type HasilLayanan,
  type LayananEtalase,
  type StatusHariIni,
} from '@/lib/homepage/data';
import DaftarLayanan from './DaftarLayanan';
import PopupDariUrl from './PopupDariUrl';

interface Props {
  /** SEMUA layanan publik dari server (termasuk yang tanpa kartu, agar popup lewat alamat tetap hidup). */
  layanan: LayananEtalase[];
  /** True bila server GAGAL memuat daftar (semua tingkat query / batas waktu): beda dari kosong yang sah. */
  layananGalat: boolean;
  /** Teks blok layanan; undefined = blok dimatikan (hanya popup). */
  teksDaftar?: Record<string, string>;
}

export default function PulauStatus({ layanan: dariServer, layananGalat: galatServer, teksDaftar }: Props) {
  const router = useRouter();
  const dariKartuRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Map<string, StatusHariIni> | null>(null);
  // Hasil percobaan ulang di klien; null = pakai data server (props tetap sumber kebenaran sampai Coba lagi ditekan).
  const [ulang, setUlang] = useState<HasilLayanan | null>(null);
  const [memuatUlang, setMemuatUlang] = useState(false);

  useEffect(() => {
    let batal = false;
    void denganBatasWaktu(muatStatusHariIni(createClient()), BATAS_MUAT_MS, null).then((peta) => {
      if (!batal) setStatus(peta);
    });
    return () => {
      batal = true;
    };
  }, []);

  const bukaLayanan = useCallback(
    (slug: string) => {
      dariKartuRef.current = slug;
      router.push(`/?layanan=${encodeURIComponent(slug)}`, { scroll: false });
    },
    [router],
  );

  // A-01: Coba lagi pada galat daftar layanan memuat ulang HANYA daftar itu (blok dan status tetap).
  const cobaLagi = useCallback(async () => {
    setMemuatUlang(true);
    // Varian ketat: galat sesaat (503) tampil sebagai galat lagi, bukan turun diam-diam ke tingkat 2 yang tidak
    // mengenal `tampil_di_homepage` (layanan yang disembunyikan admin akan muncul lagi).
    const hasil = await denganBatasWaktu(muatLayananKetat(createClient()), BATAS_MUAT_MS, GAGAL_LAYANAN);
    setUlang(hasil);
    setMemuatUlang(false);
  }, []);

  const layanan = ulang ? ulang.layanan : dariServer;
  const galat = ulang ? ulang.tingkat === 0 : galatServer;
  const kartu = layanan.filter((l) => l.tampilDiHomepage);

  return (
    <>
      {teksDaftar && (
        <DaftarLayanan
          layanan={kartu}
          status={status}
          teks={teksDaftar}
          onBuka={bukaLayanan}
          galat={galat}
          onCobaLagi={() => void cobaLagi()}
          memuatUlang={memuatUlang}
        />
      )}

      {/* Popup layanan (alamat /?layanan=<slug>); Suspense karena useSearchParams. */}
      <Suspense fallback={null}>
        <PopupDariUrl layanan={layanan} status={status} dariKartuRef={dariKartuRef} />
      </Suspense>
    </>
  );
}
