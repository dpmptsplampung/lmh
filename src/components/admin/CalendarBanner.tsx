'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { todayWIB, addDaysWIB } from '@/lib/time';
import RoleNote from './RoleNote';

// Banner kalender read-only: libur hari ini/besok + pengingat layanan tutup 16.00 WIB.
// Gagal memuat -> tetap tampilkan pengingat jam tutup saja (tidak pernah memblokir halaman).
export default function CalendarBanner() {
  const [libur, setLibur] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await createClient()
          .from('hari_libur')
          .select('tanggal, keterangan')
          .in('tanggal', [todayWIB(), addDaysWIB(1)]);
        if (alive && data) setLibur(Object.fromEntries(data.map((r) => [r.tanggal, r.keterangan])));
      } catch {
        /* graceful: abaikan */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const hariIni = libur[todayWIB()];
  const besok = libur[addDaysWIB(1)];
  return (
    <div data-testid="calendar-banner">
      {hariIni !== undefined ? (
        <RoleNote>Hari ini libur ({hariIni}). Layanan tidak menerima antrean.</RoleNote>
      ) : (
        <RoleNote>Hari ini layanan tutup pukul 16.00 WIB.</RoleNote>
      )}
      {besok !== undefined && <RoleNote>Besok libur ({besok}). Layanan tidak menerima antrean.</RoleNote>}
    </div>
  );
}
