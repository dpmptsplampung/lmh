'use client';

// Pemuat data untuk wizard Mulai Layanan dan modal Selesai (G5): definisi isian aktif Layanan (label/opsi/urutan terkini,
// lewat RPC `pendataan_khusus_definisi`) dan data kiriman Front Office (baca-saja). Keduanya lewat lib/data/pendataan-khusus
// (fungsi menerima klien, hasil bertipe); hook hanya mengelola state muat/galat/muat ulang.
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  muatDataDariFo,
  muatDefinisiKhusus,
  type DataDariFo,
} from '@/lib/data/pendataan-khusus';
import { pesanGalatLangkah } from '@/lib/pendataan-khusus/galat';
import type { FieldKhusus } from '@/lib/pendataan-khusus/jenis';

/**
 * Isian Pendataan Khusus aktif sebuah Layanan. `tersedia` false = fitur belum ada di server (migrasi G5 belum diterapkan):
 * pemanggil memakai alur lama. `fields` kosong dengan `tersedia` true = Layanan tanpa isian aktif atau saklar dimatikan.
 */
export function useDefinisiKhusus(layananId: string | null, aktif = true) {
  const [fields, setFields] = useState<FieldKhusus[]>([]);
  const [memuat, setMemuat] = useState(aktif && layananId !== null);
  const [tersedia, setTersedia] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [versi, setVersi] = useState(0);

  useEffect(() => {
    if (!aktif || !layananId) return;
    let batal = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setMemuat(true);
    setGalat(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void muatDefinisiKhusus(createClient(), layananId).then((hasil) => {
      if (batal) return;
      if (hasil.error) {
        setFields([]);
        setTersedia(false);
        setGalat(pesanGalatLangkah(hasil.error.asli, 'Gagal memuat isian Pendataan Khusus. Coba lagi.').pesan);
      } else {
        setFields(hasil.data.fields);
        setTersedia(hasil.data.tersedia);
      }
      setMemuat(false);
    });
    return () => { batal = true; };
  }, [layananId, aktif, versi]);

  return { fields, memuat, tersedia, galat, muatUlang: () => setVersi((v) => v + 1) };
}

/** Data kiriman Front Office untuk satu tiket (langkah 1, baca-saja). */
export function useDataDariFo(tiketId: string | null) {
  const [data, setData] = useState<DataDariFo | null>(null);
  const [memuat, setMemuat] = useState(tiketId !== null);
  const [galat, setGalat] = useState<string | null>(null);
  const [versi, setVersi] = useState(0);

  useEffect(() => {
    if (!tiketId) return;
    let batal = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setMemuat(true);
    setGalat(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void muatDataDariFo(createClient(), tiketId).then((hasil) => {
      if (batal) return;
      if (hasil.error) {
        setData(null);
        setGalat(pesanGalatLangkah(hasil.error.asli, 'Gagal memuat data dari Front Office. Coba lagi.').pesan);
      } else {
        setData(hasil.data);
      }
      setMemuat(false);
    });
    return () => { batal = true; };
  }, [tiketId, versi]);

  return { data, memuat, galat, muatUlang: () => setVersi((v) => v + 1) };
}
