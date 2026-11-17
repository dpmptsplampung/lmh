'use client';

// Saringan halaman antrean (tugas 5.3): tanggal, status, Layanan (Admin/FO), dan halaman hidup di URL (A13; antrianUrl.ts) agar bertahan saat
// muat ulang dan bisa dibagikan. URL ditulis tanpa menambah riwayat; nilai bawaan tidak ditulis. URL yang berubah dari luar
// (tombol kembali, tautan yang dibagikan) diikuti. useSearchParams menuntut Suspense di pemanggil (page.tsx).
import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { todayWIB } from '@/lib/time';
import { bacaParamAntrean, susunQueryAntrean, type FilterStatus, type ParamAntrean } from '../antrianUrl';

export function useFilterAntrian() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const awal = bacaParamAntrean(sp, todayWIB());
  const [tanggal, setTanggal] = useState(awal.tanggal);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(awal.status);
  const [layanan, setLayanan] = useState<string | null>(awal.layanan);
  const [halaman, setHalaman] = useState(awal.halaman);
  // URL berubah dari luar: ikuti (penyesuaian state saat render). Perubahan dari halaman ini sendiri sudah sama.
  const queryUrl = sp?.toString() ?? '';
  const [queryUrlSebelumnya, setQueryUrlSebelumnya] = useState(queryUrl);
  if (queryUrl !== queryUrlSebelumnya) {
    setQueryUrlSebelumnya(queryUrl);
    setTanggal(awal.tanggal);
    setFilterStatus(awal.status);
    setLayanan(awal.layanan);
    setHalaman(awal.halaman);
  }

  const tulisUrl = (p: ParamAntrean) => {
    const q = susunQueryAntrean(p, todayWIB());
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const ubahTanggal = (nilai: string) => {
    if (!nilai) return; // kolom dikosongkan: pertahankan tanggal yang tampil
    setTanggal(nilai);
    setHalaman(0);
    tulisUrl({ tanggal: nilai, status: filterStatus, layanan, halaman: 0 });
  };

  const gantiStatus = (kunci: string) => {
    const status = kunci as FilterStatus;
    if (status === filterStatus) return;
    setFilterStatus(status);
    setHalaman(0);
    tulisUrl({ tanggal, status, layanan, halaman: 0 });
  };

  /** Saringan Layanan (Admin/FO); null = semua Layanan. */
  const gantiLayanan = (id: string | null) => {
    if (id === layanan) return;
    setLayanan(id);
    setHalaman(0);
    tulisUrl({ tanggal, status: filterStatus, layanan: id, halaman: 0 });
  };

  const gantiHalaman = (p: number) => {
    setHalaman(p);
    tulisUrl({ tanggal, status: filterStatus, layanan, halaman: p });
  };

  return { tanggal, filterStatus, layanan, halaman, ubahTanggal, gantiStatus, gantiLayanan, gantiHalaman };
}
