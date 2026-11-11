'use client';

// Rekapitulasi absen di halaman antrean (tugas 5.3): dibaca hanya saat bagian dibuka (tiap kali dibuka, bukan saat
// tanggal berubah; perilaku lama), Petugas dibatasi ke Layanannya, Admin dan FO melihat semua. Galat membaca absensi
// sengaja diam-diam kosong: rekap hanya pelengkap halaman.
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toCsv } from '@/lib/csv';
import { formatWaktu } from '@/lib/utils';
import { muatAbsensiRekap, type BarisAbsensi, type ProfilPetugasAntrean } from '@/lib/data/antrean';
import { namaLayananProfil } from '../_logika/turunan';

export function useRekapAbsensi({ tanggal, currentUser }: { tanggal: string; currentUser: ProfilPetugasAntrean | null }) {
  const [rekapOpen, setRekapOpen] = useState(false);
  const [rekapAbsensi, setRekapAbsensi] = useState<BarisAbsensi[]>([]);
  const [rekapLoading, setRekapLoading] = useState(false);

  const muatRekap = async () => {
    if (!currentUser?.layanan_id && currentUser?.role === 'petugas') return;
    setRekapLoading(true);
    try {
      const hasil = await muatAbsensiRekap(createClient(), {
        tanggal,
        layananId: currentUser?.role === 'petugas' && currentUser.layanan_id ? currentUser.layanan_id : null,
      });
      setRekapAbsensi(hasil.error ? [] : hasil.data);
    } finally {
      setRekapLoading(false);
    }
  };

  /** Tombol buka/tutup bagian rekap; membuka = membaca ulang. */
  const alihkan = async () => {
    const next = !rekapOpen;
    setRekapOpen(next);
    if (next) await muatRekap();
  };

  const unduhCsv = () => {
    const layananLabel = namaLayananProfil(currentUser) ?? 'semua_layanan';
    const baris = rekapAbsensi.map((a) => ({
      tanggal: a.tanggal,
      nama_petugas: a.petugas?.nama ?? '',
      jam_masuk: a.jam_masuk ? formatWaktu(a.jam_masuk) : '',
      jam_pulang: a.jam_pulang ? formatWaktu(a.jam_pulang) : '',
      status:
        a.status === 'approved' ? 'Disetujui'
        : a.status === 'pending' ? 'Menunggu'
        : a.status === 'ditolak' ? 'Ditolak'
        : 'Alpa',
    }));
    const csv = toCsv(
      [
        { key: 'tanggal', label: 'Tanggal' },
        { key: 'nama_petugas', label: 'Nama Petugas' },
        { key: 'jam_masuk', label: 'Jam Masuk' },
        { key: 'jam_pulang', label: 'Jam Pulang' },
        { key: 'status', label: 'Status' },
      ],
      baris,
    );
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daftar_hadir_${layananLabel.replace(/\s+/g, '_')}_${tanggal}.csv`;
    a.click();
  };

  return { rekapOpen, rekapAbsensi, rekapLoading, alihkan, unduhCsv };
}
