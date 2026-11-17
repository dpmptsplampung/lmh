'use client';

// Isian Pendataan Khusus dengan simpan otomatis ke draf server (G5): memuat draf tiket, menahan perubahan sebentar
// (debounce), lalu mengganti seluruh draf lewat `pendataan_khusus_draf_simpan`. Simpan diserialkan (satu permintaan pada
// satu waktu; permintaan berikutnya selalu membaca isian terkini), jadi `simpanSekarang()` yang ditunggu sebelum menutup
// wizard menjamin draf di server sama dengan layar. Gagal simpan tidak membuang isian: statusnya 'galat' dan simpan
// berikutnya (perubahan baru atau `simpanSekarang`) mencoba lagi.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { muatDrafKhusus, simpanDrafKhusus } from '@/lib/data/pendataan-khusus';
import { drafDariForm, formDariDraf, kunciDraf } from '@/lib/pendataan-khusus/draf';
import { pesanGalatLangkah } from '@/lib/pendataan-khusus/galat';
import type { FieldKhusus } from '@/lib/pendataan-khusus/jenis';
import type { NilaiForm } from '@/lib/pendataan-khusus/jawaban';

/** Jeda sesudah ketikan terakhir sebelum draf dikirim. */
export const JEDA_SIMPAN_DRAF_MS = 800;

export type StatusSimpanDraf = 'diam' | 'menyimpan' | 'tersimpan' | 'galat';

interface Opsi {
  tiketId: string;
  /** Isian terlihat Layanan (hasil muatDefinisiKhusus). */
  fields: readonly FieldKhusus[];
  /** false = belum memuat/menyimpan apa pun (mis. langkah 2 belum dibuka atau definisi belum siap). */
  aktif: boolean;
  /** false = hanya baca: perubahan diabaikan dan tidak ada simpan. */
  bolehUbah: boolean;
  /** Dipanggil saat simpan menolak karena tampilan basi (tiket berubah / isian diubah Admin). */
  onBasi?: () => void;
}

export function useDrafKhusus({ tiketId, fields, aktif, bolehUbah, onBasi }: Opsi) {
  const [nilai, setNilai] = useState<NilaiForm>({});
  const [memuat, setMemuat] = useState(aktif);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusSimpanDraf>('diam');
  const [galatSimpan, setGalatSimpan] = useState<string | null>(null);
  const [simpanTerakhir, setSimpanTerakhir] = useState<Date | null>(null);
  // Naik tiap `muatUlang()`: draf dimuat ulang dari server.
  const [versi, setVersi] = useState(0);

  const nilaiRef = useRef<NilaiForm>({});
  const fieldsRef = useRef(fields);
  const kunciTersimpan = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const antrian = useRef<Promise<boolean>>(Promise.resolve(true));
  const hidup = useRef(true);
  // Kunci `tiketId#versi` yang draf-nya sudah dimuat; naik tiap ketikan agar respons lama tidak menimpa isian lokal.
  const sudahDimuat = useRef<string | null>(null);
  const versiUbah = useRef(0);
  const onBasiRef = useRef(onBasi);
  const bolehUbahRef = useRef(bolehUbah);
  useEffect(() => {
    fieldsRef.current = fields;
    onBasiRef.current = onBasi;
    bolehUbahRef.current = bolehUbah;
  });

  const bersihkanTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  // Memuat draf SEKALI per tiket (dan sekali per `muatUlang()` eksplisit): bolak-balik antar langkah mempertahankan isian
  // lokal, tidak membaca ulang draf server yang bisa lebih lama dari ketikan yang belum terkirim. Tanpa draf (null) =
  // isian kosong. Kunci "sudah tersimpan" = draf yang baru dimuat, sehingga memuat tanpa mengubah apa pun tidak memicu
  // simpan. Pembacaan menunggu antrean simpan, dan respons yang tiba sesudah ada perubahan lokal tidak menimpa isian.
  useEffect(() => {
    if (!aktif) return;
    const kunciMuat = `${tiketId}#${versi}`;
    if (sudahDimuat.current === kunciMuat) return;
    let batal = false;
    const versiUbahAwal = versiUbah.current;
    setMemuat(true);
    setGalatMuat(null);
    void antrian.current
      .then(() => muatDrafKhusus(createClient(), tiketId))
      .then((hasil) => {
        if (batal) return;
        if (hasil.error) {
          setGalatMuat(pesanGalatLangkah(hasil.error.asli, 'Gagal memuat draf pendataan. Coba lagi.').pesan);
        } else {
          sudahDimuat.current = kunciMuat;
          const form = formDariDraf(fieldsRef.current, hasil.data?.jawaban);
          kunciTersimpan.current = kunciDraf(drafDariForm(fieldsRef.current, form));
          // Ada ketikan sejak permintaan dikirim: isian lokal menang; selisihnya terkirim lewat simpan berikutnya.
          if (versiUbah.current === versiUbahAwal) {
            nilaiRef.current = form;
            setNilai(form);
          }
        }
        setMemuat(false);
      });
    return () => { batal = true; };
  }, [aktif, tiketId, versi]);

  /** Menyimpan isian terkini bila berbeda dari yang tersimpan. true = draf di server sama dengan layar. */
  const simpanSekarang = useCallback((): Promise<boolean> => {
    bersihkanTimer();
    antrian.current = antrian.current.then(async () => {
      if (!bolehUbahRef.current || kunciTersimpan.current === null) return true;
      const jawaban = drafDariForm(fieldsRef.current, nilaiRef.current);
      const kunci = kunciDraf(jawaban);
      if (kunci === kunciTersimpan.current) return true;
      if (hidup.current) { setStatus('menyimpan'); setGalatSimpan(null); }
      const hasil = await simpanDrafKhusus(createClient(), tiketId, jawaban);
      if (hasil.error) {
        const galat = pesanGalatLangkah(hasil.error.asli, 'Draf belum tersimpan. Perubahan Anda tetap di layar; coba lagi.');
        if (hidup.current) { setStatus('galat'); setGalatSimpan(galat.pesan); }
        if (galat.muatUlang) onBasiRef.current?.();
        return false;
      }
      kunciTersimpan.current = kunci;
      if (hidup.current) { setStatus('tersimpan'); setSimpanTerakhir(new Date()); }
      return true;
    });
    return antrian.current;
  }, [tiketId]);

  const ubah = useCallback((id: string, nilaiBaru: string | string[]) => {
    if (!bolehUbahRef.current) return;
    const berikut = { ...nilaiRef.current, [id]: nilaiBaru };
    versiUbah.current += 1;
    nilaiRef.current = berikut;
    setNilai(berikut);
    bersihkanTimer();
    timer.current = setTimeout(() => { void simpanSekarang(); }, JEDA_SIMPAN_DRAF_MS);
  }, [simpanSekarang]);

  // Tutup tanpa menunggu jeda: isian yang belum terkirim disimpan sebelum komponen dilepas (galat tidak ditampilkan lagi).
  useEffect(() => {
    hidup.current = true;
    return () => {
      hidup.current = false;
      if (timer.current) { clearTimeout(timer.current); void simpanSekarang(); }
    };
  }, [simpanSekarang]);

  return {
    nilai, ubah, memuat, galatMuat, status, galatSimpan, simpanTerakhir, simpanSekarang,
    muatUlang: () => setVersi((v) => v + 1),
  };
}
