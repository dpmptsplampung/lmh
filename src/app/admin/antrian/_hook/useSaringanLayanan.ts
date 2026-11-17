'use client';

// Pilihan Layanan di halaman antrean (Admin dan Front Office melihat semua Layanan, Petugas hanya Layanannya sendiri
// sehingga tanpa pilihan). Daftar Layanan = referensi bersama ber-cache (useReferensi); Layanan yang diarsipkan tidak
// ditawarkan. Gagal memuat daftar = pilihan tidak tampil (antrean semua Layanan tetap jalan).
import { useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { KUNCI_REFERENSI, muatLayananRingkas } from '@/lib/data/referensi';
import type { ProfilPetugasAntrean } from '@/lib/data/antrean';
import { useReferensi } from '@/lib/data/klien/useReferensi';
import { bolehLihatSemuaLayanan } from '../_logika/turunan';
import type { SaringanLayanan } from '../_bagian/FilterAntrian';

export function useSaringanLayanan(
  pengguna: ProfilPetugasAntrean | null,
  layananId: string | null,
  onGanti: (id: string | null) => void,
): SaringanLayanan | null {
  const berhak = bolehLihatSemuaLayanan(pengguna);
  const referensi = useReferensi(berhak ? KUNCI_REFERENSI.layananRingkas : null, () => muatLayananRingkas(createClient()));
  const opsi = useMemo(
    () => (referensi.data ?? []).filter((l) => !l.diarsipkan_at).map((l) => ({ id: l.id, nama: l.nama })),
    [referensi.data],
  );
  if (!berhak || opsi.length === 0) return null;
  return { nilai: layananId, opsi, onGanti };
}
