'use client';

// Saringan halaman antrean (tugas 5.3): tanggal, status, dan halaman hidup di URL (A13; antrianUrl.ts) agar bertahan saat
// muat ulang dan bisa dibagikan. URL ditulis tanpa menambah riwayat; nilai bawaan tidak ditulis. URL yang berubah dari luar
// (tombol kembali, tautan yang dibagikan) diikuti. useSearchParams menuntut Suspense di pemanggil (page.tsx).
import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { todayWIB } from '@/lib/time';
import { pesanJendelaTanggal, tanggalDalamJendela, type JendelaTanggal } from '@/lib/fo/akses-antrean';
import { bacaParamAntrean, susunQueryAntrean, type FilterStatus } from '../antrianUrl';

export function useFilterAntrian() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const awal = bacaParamAntrean(sp, todayWIB());
  const [tanggal, setTanggal] = useState(awal.tanggal);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(awal.status);
  const [halaman, setHalaman] = useState(awal.halaman);
  const [pesanTanggal, setPesanTanggal] = useState<string | null>(null);
  // URL berubah dari luar: ikuti (penyesuaian state saat render). Perubahan dari halaman ini sendiri sudah sama.
  const queryUrl = sp?.toString() ?? '';
  const [queryUrlSebelumnya, setQueryUrlSebelumnya] = useState(queryUrl);
  if (queryUrl !== queryUrlSebelumnya) {
    setQueryUrlSebelumnya(queryUrl);
    setTanggal(awal.tanggal);
    setFilterStatus(awal.status);
    setHalaman(awal.halaman);
  }

  const tulisUrl = (p: { tanggal: string; status: FilterStatus; halaman: number }) => {
    const q = susunQueryAntrean(p, todayWIB());
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  /** FO non-Koordinator hanya boleh membuka jendelanya (server menegakkan; di sini mencegah galat). */
  const ubahTanggal = (nilai: string, jendela: JendelaTanggal | null) => {
    if (!nilai) return; // kolom dikosongkan: pertahankan tanggal yang tampil
    if (!tanggalDalamJendela(nilai, jendela)) {
      setPesanTanggal(pesanJendelaTanggal(jendela));
      return;
    }
    setPesanTanggal(null);
    setTanggal(nilai);
    setHalaman(0);
    tulisUrl({ tanggal: nilai, status: filterStatus, halaman: 0 });
  };

  const gantiStatus = (kunci: string) => {
    const status = kunci as FilterStatus;
    if (status === filterStatus) return;
    setFilterStatus(status);
    setHalaman(0);
    tulisUrl({ tanggal, status, halaman: 0 });
  };

  const gantiHalaman = (p: number) => {
    setHalaman(p);
    tulisUrl({ tanggal, status: filterStatus, halaman: p });
  };

  return { tanggal, filterStatus, halaman, pesanTanggal, ubahTanggal, gantiStatus, gantiHalaman };
}
