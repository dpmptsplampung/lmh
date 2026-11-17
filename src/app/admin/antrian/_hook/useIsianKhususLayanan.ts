'use client';

// Layanan yang punya isian Pendataan Khusus aktif, untuk menampilkan tombol "Isi Pendataan" hanya di baris yang berguna
// (G5). Definisi dimuat sekali per Layanan lewat pendataan_khusus_definisi dan disimpan selama halaman terbuka; gagal muat =
// anggap tanpa isian (tombol tersembunyi; modal Selesai tetap memuat sendiri definisinya).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { muatDefinisiKhusus } from '@/lib/data/pendataan-khusus';
import type { ProfilPetugasAntrean, TiketBaris } from '@/lib/data/antrean';
import { layananPerluCekIsian } from '../_logika/isianKhusus';

export function useIsianKhususLayanan(
  sumber: ReadonlyArray<readonly TiketBaris[]>, pengguna: ProfilPetugasAntrean | null,
): ReadonlySet<string> {
  const kunci = layananPerluCekIsian(sumber, pengguna).join(',');
  const perlu = useMemo(() => (kunci ? kunci.split(',') : []), [kunci]);
  const cache = useRef<Map<string, boolean>>(new Map());
  const [berisian, setBerisian] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const belum = perlu.filter((id) => !cache.current.has(id));
    if (belum.length === 0) return;
    let batal = false;
    const sb = createClient();
    void Promise.all(belum.map(async (id) => {
      const hasil = await muatDefinisiKhusus(sb, id);
      return [id, !hasil.error && hasil.data.fields.length > 0] as const;
    })).then((baris) => {
      if (batal) return;
      for (const [id, ada] of baris) cache.current.set(id, ada);
      setBerisian(new Set([...cache.current].filter(([, ada]) => ada).map(([id]) => id)));
    });
    return () => { batal = true; };
  }, [perlu]);

  return berisian;
}
