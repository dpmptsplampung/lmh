'use client';

// Muat antrean admin (rencana refaktor 2026-11-11 tugas 5.3, SPEC bagian 7): profil staf dibaca sekali, daftar lewat
// lib/data/antrean.ts, muat ulang dari Realtime (`tiket_antrean`) + polling cadangan 30 dtk lewat useRealtimeRefetch.
//
// Penjaga permintaan basi: tiap muat diberi nomor; hanya respons permintaan TERAKHIR yang boleh mengisi layar, apa pun
// urutan selesainya. Skeleton (`loading`) hanya untuk muat awal / ganti parameter; muat ulang dari Realtime, polling, dan
// setelah aksi berjalan senyap (`menyegarkan`, tabel tetap; B-01). Keadaan = reducer murni (_logika/keadaanAntrean.ts).
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { todayWIB } from '@/lib/time';
import { useRealtimeRefetch } from '@/lib/hooks/useRealtimeRefetch';
import { jendelaTanggalFo, pesanJendelaTanggal } from '@/lib/fo/akses-antrean';
import { ambilStatusSurvei } from '@/lib/survei/staf';
import {
  galatAntreanDari,
  muatAntrean,
  muatCatatanEskalasi,
  muatProfilAntrean,
  type GalatAntrean,
  type TiketBaris,
} from '@/lib/data/antrean';
import { KEADAAN_AWAL_ANTREAN, kurangiAntrean } from '../_logika/keadaanAntrean';
import { idKunjunganSelesai, idTahapAsal, panelBerlaku } from '../_logika/turunan';
import { STATUS_PER_FILTER, type FilterStatus } from '../antrianUrl';

export const UKURAN_HALAMAN_ANTREAN = 25;

type Klien = ReturnType<typeof createClient>;

export interface ParamAntreanHalaman {
  tanggal: string;
  filterStatus: FilterStatus;
  /** Indeks halaman tabel berbasis 0. */
  halaman: number;
}

export function useAntrean({ tanggal, filterStatus, halaman }: ParamAntreanHalaman) {
  const [keadaan, kirim] = useReducer(kurangiAntrean, KEADAAN_AWAL_ANTREAN);
  const muatanRef = useRef(0); // nomor permintaan terakhir
  const adaDataRef = useRef(false); // sudah ada data valid untuk tanggal/halaman yang tampil
  const profilRef = useRef<{ role: string; layananId: string | null; koordinator?: boolean } | null>(null);

  // Galat memuat: dicatat apa adanya, pesan menurut jenisnya. Respons basi diabaikan.
  const tanganiGalatMuat = useCallback((muatan: number, galat: GalatAntrean) => {
    if (galat.jenis === 'basi') return;
    console.error(galat.asli);
    if (muatan !== muatanRef.current) return;
    if (galat.jenis === 'tanggal_diluar_batas') {
      // Batas tanggal FO non-Koordinator ditolak server: pesan jelas, bukan "periksa koneksi".
      adaDataRef.current = false;
      kirim({ jenis: 'galatMuat', pesan: pesanJendelaTanggal(jendelaTanggalFo(profilRef.current)) });
    } else if (galat.jenis === 'batas_tiket') {
      adaDataRef.current = false;
      kirim({ jenis: 'galatMuat', pesan: galat.pesan });
    } else if (adaDataRef.current) {
      // Muat ulang senyap gagal: data lama tetap tampil, diberi catatan (tanpa toast tiap 30 dtk).
      kirim({ jenis: 'galatSegar' });
    } else {
      kirim({ jenis: 'galatMuat', pesan: 'Antrean tidak dapat dimuat. Periksa koneksi Anda lalu coba lagi.' });
    }
  }, []);

  // Kontrak §6.3: catatan eskalasi FO = baris penanganan tahap asal. Gagal = kosong, daftar tetap.
  const segarkanCatatanEskalasi = useCallback(async (sb: Klien, baris: TiketBaris[]) => {
    const hasil = await muatCatatanEskalasi(sb, idTahapAsal(baris));
    if (hasil.error) {
      console.error('Gagal memuat catatan eskalasi:', hasil.error.asli);
      kirim({ jenis: 'catatan', catatan: {} });
      return;
    }
    kirim({ jenis: 'catatan', catatan: hasil.data });
  }, []);

  // Status Pesan Perilaku tiket selesai (v_survei_status). Gagal = lencana tidak ditampilkan, bukan status keliru.
  const segarkanStatusSurvei = useCallback(async (sb: Klien, baris: TiketBaris[]) => {
    const ids = idKunjunganSelesai(baris);
    if (ids.length === 0) {
      kirim({ jenis: 'survei', status: new Map() });
      return;
    }
    try {
      kirim({ jenis: 'survei', status: await ambilStatusSurvei(sb, ids) });
    } catch (e) {
      console.error('Gagal memuat status Pesan Perilaku:', e);
      kirim({ jenis: 'survei', status: new Map() });
    }
  }, []);

  /** Muat parameter yang tampil. `senyap` = tanpa skeleton (Realtime, polling, setelah aksi). */
  const jalankanMuat = useCallback(async (senyap: boolean) => {
    const muatan = ++muatanRef.current;
    if (!senyap) adaDataRef.current = false;
    kirim({ jenis: 'mulai', senyap });
    try {
      const supabase = createClient();

      // Profil/peran dibaca sekali per sesi halaman, bukan di tiap polling.
      let myRole = 'admin';
      let myLayananId: string | null = null;
      if (profilRef.current) {
        myRole = profilRef.current.role;
        myLayananId = profilRef.current.layananId;
      } else {
        const profil = await muatProfilAntrean(supabase);
        if (profil.error) {
          tanganiGalatMuat(muatan, profil.error);
          return;
        }
        if (profil.data) {
          myRole = profil.data.role;
          myLayananId = profil.data.layanan_id;
          if (muatan !== muatanRef.current) return;
          kirim({ jenis: 'profil', profil: profil.data });
          profilRef.current = { role: myRole, layananId: myLayananId, koordinator: profil.data.koordinator };
        }
      }

      // Petugas tanpa layanan tidak boleh melihat antrean.
      if (myRole === 'petugas' && !myLayananId) {
        if (muatan !== muatanRef.current) return;
        adaDataRef.current = true;
        kirim({ jenis: 'belumDitugaskan' });
        return;
      }

      const hasil = await muatAntrean(supabase, {
        tanggal,
        status: STATUS_PER_FILTER[filterStatus],
        halaman,
        ukuranHalaman: UKURAN_HALAMAN_ANTREAN,
        peran: myRole,
        layananId: myLayananId,
        denganPanel: panelBerlaku(tanggal, filterStatus, todayWIB()),
        masihBerlaku: () => muatan === muatanRef.current,
      });
      if (muatan !== muatanRef.current) return;
      if (hasil.error) {
        tanganiGalatMuat(muatan, hasil.error);
        return;
      }
      kirim({ jenis: 'data', data: hasil.data, waktu: new Date().toISOString() });
      adaDataRef.current = true;
      await Promise.all([
        segarkanCatatanEskalasi(supabase, hasil.data.baris),
        segarkanStatusSurvei(supabase, hasil.data.baris),
      ]);
    } catch (e) {
      tanganiGalatMuat(muatan, galatAntreanDari(e));
    } finally {
      if (muatan === muatanRef.current) kirim({ jenis: 'selesai' });
    }
  }, [tanggal, filterStatus, halaman, tanganiGalatMuat, segarkanCatatanEskalasi, segarkanStatusSurvei]);

  /** Muat dengan skeleton: muat awal, ganti parameter, tombol "Coba lagi". */
  const muat = useCallback(() => jalankanMuat(false), [jalankanMuat]);
  /** Muat ulang tanpa membongkar tabel (Realtime, polling, setelah aksi). */
  const muatSenyap = useCallback(() => jalankanMuat(true), [jalankanMuat]);

  // Muat awal dan setiap ganti tanggal/halaman/status.
  useEffect(() => {
    void muat();
  }, [muat]);

  // Fase 3: antrean menyegarkan sendiri saat ada perubahan tiket (postgres_changes, RLS staf) + polling cadangan 30 dtk.
  useRealtimeRefetch(muatSenyap, { table: 'tiket_antrean', pollMs: 30_000 });

  return { ...keadaan, muat, muatSenyap };
}
