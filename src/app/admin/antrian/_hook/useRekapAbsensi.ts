'use client';

// Rekapitulasi absen di halaman antrean (tugas 5.3): dibaca hanya saat bagian dibuka (tiap kali dibuka), dan dibaca
// ulang bila tanggal berganti selagi bagian terbuka (perbaikan 2026-11-13; dulu data tanggal lama tetap tampil).
// Petugas dibatasi ke Layanannya, Admin dan FO melihat semua. Galat membaca absensi sengaja diam-diam kosong: rekap
// hanya pelengkap halaman. Respons permintaan basi dibuang; nama berkas CSV memakai tanggal data yang dimuat.
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toCsv } from '@/lib/csv';
import { formatWaktu } from '@/lib/utils';
import { muatAbsensiRekap, type BarisAbsensi, type ProfilPetugasAntrean } from '@/lib/data/antrean';
import { namaLayananProfil } from '../_logika/turunan';

export function useRekapAbsensi({ tanggal, currentUser }: { tanggal: string; currentUser: ProfilPetugasAntrean | null }) {
  const [rekapOpen, setRekapOpen] = useState(false);
  const [rekapAbsensi, setRekapAbsensi] = useState<BarisAbsensi[]>([]);
  const [rekapLoading, setRekapLoading] = useState(false);
  /** Tanggal data yang sedang tampil di rekap (bisa tertinggal dari `tanggal` selama muat ulang berjalan). */
  const [tanggalRekap, setTanggalRekap] = useState(tanggal);
  const muatanRef = useRef(0);

  const muatRekap = async (tanggalMuat: string) => {
    if (!currentUser?.layanan_id && currentUser?.role === 'petugas') return;
    const muatan = ++muatanRef.current;
    setRekapLoading(true);
    try {
      const hasil = await muatAbsensiRekap(createClient(), {
        tanggal: tanggalMuat,
        layananId: currentUser?.role === 'petugas' && currentUser.layanan_id ? currentUser.layanan_id : null,
      });
      if (muatan !== muatanRef.current) return; // permintaan lebih baru sudah berjalan
      setRekapAbsensi(hasil.error ? [] : hasil.data);
      setTanggalRekap(tanggalMuat);
    } finally {
      if (muatan === muatanRef.current) setRekapLoading(false);
    }
  };

  // Tanggal berganti saat lipatan terbuka: baca ulang. Efek ini juga jalan saat `rekapOpen` berubah, tetapi hanya
  // membuka yang memuat (alihkan() sudah memuat saat membuka), jadi dilewati lewat penanda tanggal yang sudah dimuat.
  const tanggalTermuatRef = useRef(tanggal);
  useEffect(() => {
    if (!rekapOpen || tanggal === tanggalTermuatRef.current) return;
    tanggalTermuatRef.current = tanggal;
    void muatRekap(tanggal);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya bereaksi pada tanggal/rekapOpen
  }, [tanggal, rekapOpen]);

  /** Tombol buka/tutup bagian rekap; membuka = membaca ulang. */
  const alihkan = async () => {
    const next = !rekapOpen;
    setRekapOpen(next);
    if (next) {
      tanggalTermuatRef.current = tanggal;
      await muatRekap(tanggal);
    }
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
    a.download = `daftar_hadir_${layananLabel.replace(/\s+/g, '_')}_${tanggalRekap}.csv`;
    a.click();
  };

  return { rekapOpen, rekapAbsensi, rekapLoading, alihkan, unduhCsv };
}
