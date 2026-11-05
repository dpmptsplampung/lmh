'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { addDaysWIB, todayWIB, toWIBDateString } from '@/lib/time';

// Panggilan nomor di layar TV: kejadian `panggilan_layar` (diisi `panggil_tiket` pada SETIAP panggilan,
// termasuk panggilan ulang). Layar publik bertoken hanya boleh membaca kejadian hari ini tanpa identitas.
//  - Jalur utama: postgres_changes INSERT (hanya pemicu; isinya diambil ulang agar satu jalur kode).
//  - Cadangan: polling `POLL_PANGGILAN_MS`. Kursor = dibuat_at terbesar yang pernah terlihat, ditambah
//    daftar id yang sudah diumumkan (id acak, bukan urutan).
//  - Riwayat hari ini yang sudah ada saat layar dibuka tidak diumumkan.
//  - Antrean pita dibatasi `MAKS_ANTRE`: setelah putus lama yang terlewat dibuang, yang terbaru dipertahankan.
//  - Galat membaca panggilan tidak mengganggu layar (diam-diam, coba lagi pada polling berikutnya).

export const DURASI_PITA_MS = 5_000;
export const POLL_PANGGILAN_MS = 5_000;
export const MAKS_ANTRE = 5;
const KOLOM = 'id,layanan_id,nomor_display,label,dibuat_at';
const BATAS_BARIS = 20;
const BATAS_ID_TERLIHAT = 200;

export interface PanggilanLayar {
  id: string;
  layanan_id: string;
  nomor_display: string;
  label: string | null;
  dibuat_at: string;
}

export function usePanggilanLayar({ aktif }: { aktif: boolean }): {
  saatIni: PanggilanLayar | null;
  riwayat: PanggilanLayar[];
  dipanggilPada: Record<string, number>;
} {
  const [saatIni, setSaatIni] = useState<PanggilanLayar | null>(null);
  const [riwayat, setRiwayat] = useState<PanggilanLayar[]>([]);
  const [dipanggilPada, setDipanggilPada] = useState<Record<string, number>>({});
  const antreRef = useRef<PanggilanLayar[]>([]);
  const sedangRef = useRef<PanggilanLayar | null>(null);
  const timerPitaRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Layar dapat menyala melewati tengah malam saat jaringan putus. Riwayat hari sebelumnya
  // tetap harus hilang tanpa menunggu keberhasilan kueri berikutnya.
  useEffect(() => {
    if (!aktif) return;
    let timer: ReturnType<typeof setTimeout>;
    const jadwalkan = () => {
      const tengahMalam = new Date(`${addDaysWIB(1)}T00:00:00+07:00`).getTime();
      timer = setTimeout(() => {
        setRiwayat(lama => lama.filter(b => toWIBDateString(new Date(b.dibuat_at)) === todayWIB()));
        jadwalkan();
      }, tengahMalam - Date.now());
    };
    jadwalkan();
    return () => clearTimeout(timer);
  }, [aktif]);

  // Disimpan di ref (diisi di effect): fungsi ini memanggil dirinya sendiri saat pita selesai.
  const tampilkanRef = useRef<() => void>(() => {});
  useEffect(() => {
    tampilkanRef.current = () => {
      if (sedangRef.current) return;
      const berikut = antreRef.current.shift();
      if (!berikut) return;
      sedangRef.current = berikut;
      setSaatIni(berikut);
      timerPitaRef.current = setTimeout(() => {
        timerPitaRef.current = null;
        sedangRef.current = null;
        setSaatIni(null);
        tampilkanRef.current();
      }, DURASI_PITA_MS);
    };
  }, []);

  useEffect(() => {
    if (!aktif) return;

    let batal = false;
    let berjalan = false;
    let sudahDasar = false;
    let kursor: string | null = null;
    const terlihat = new Set<string>();
    let timerPoll: ReturnType<typeof setTimeout> | null = null;
    let timerPicu: ReturnType<typeof setTimeout> | null = null;

    const catat = (b: PanggilanLayar) => {
      terlihat.add(b.id);
      if (!kursor || b.dibuat_at > kursor) kursor = b.dibuat_at;
      if (terlihat.size > BATAS_ID_TERLIHAT) {
        const pertama = terlihat.values().next().value;
        if (pertama !== undefined) terlihat.delete(pertama);
      }
    };

    const muat = async (): Promise<void> => {
      if (batal || berjalan) return;
      berjalan = true;
      try {
        const sb = createClient();
        let q = sb.from('panggilan_layar').select(KOLOM);
        if (sudahDasar && kursor) q = q.gte('dibuat_at', kursor);
        // Muat pertama: hanya untuk menandai riwayat sudah terlihat (terbaru dulu).
        const { data, error } = await q.order('dibuat_at', { ascending: sudahDasar }).limit(BATAS_BARIS);
        if (batal) return;
        if (!error && Array.isArray(data)) {
          const baris = data as PanggilanLayar[];
          // Jam server hanya untuk kursor/urutan; bingkai dihitung sejak kejadian baru
          // diterima TV. Polling ulang dan riwayat awal tidak memulai ulang 30 detik.
          const panggilanBaru = sudahDasar ? baris.filter(b => !terlihat.has(b.id)) : [];
          const diterimaPada = Date.now();
          setDipanggilPada(lama => {
            const baru = Object.fromEntries(Object.entries(lama).filter(([, at]) => diterimaPada - at < 30_000));
            for (const b of panggilanBaru) baru[b.layanan_id] = diterimaPada;
            return baru;
          });
          // Bacaan yang sama juga mengisi riwayat; muat awal tidak masuk antrean pita.
          setRiwayat(lama => {
            const nomorTerlihat = new Set<string>();
            return [...new Map([...lama, ...baris].map(b => [b.id, b])).values()]
              .filter(b => toWIBDateString(new Date(b.dibuat_at)) === todayWIB())
              .sort((a, b) => b.dibuat_at.localeCompare(a.dibuat_at) || b.id.localeCompare(a.id))
              .filter(b => {
                if (nomorTerlihat.has(b.nomor_display)) return false;
                nomorTerlihat.add(b.nomor_display);
                return true;
              })
              .slice(0, 4);
          });
          if (!sudahDasar) {
            baris.forEach(catat);
            sudahDasar = true;
          } else {
            const baru = panggilanBaru;
            baru.forEach(catat);
            if (baru.length > 0) {
              antreRef.current.push(...baru);
              if (antreRef.current.length > MAKS_ANTRE) {
                antreRef.current.splice(0, antreRef.current.length - MAKS_ANTRE);
              }
              tampilkanRef.current();
            }
          }
        }
      } catch {
        // Diam-diam: layar tetap berfungsi tanpa pita.
      } finally {
        berjalan = false;
      }
      if (!batal) {
        if (timerPoll) clearTimeout(timerPoll);
        timerPoll = setTimeout(() => { void muat(); }, POLL_PANGGILAN_MS);
      }
    };

    const picu = () => {
      if (timerPicu) clearTimeout(timerPicu);
      timerPicu = setTimeout(() => { void muat(); }, 150);
    };

    let supabase: ReturnType<typeof createClient> | null = null;
    let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;
    try {
      supabase = createClient();
      channel = supabase
        .channel('layar:panggilan')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'panggilan_layar' }, picu)
        .subscribe();
    } catch {
      channel = null;
    }

    void muat();

    return () => {
      batal = true;
      if (timerPoll) clearTimeout(timerPoll);
      if (timerPicu) clearTimeout(timerPicu);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [aktif]);

  // Pita tidak boleh tertinggal bila layar dinonaktifkan atau komponen dilepas.
  useEffect(() => () => {
    if (timerPitaRef.current) clearTimeout(timerPitaRef.current);
  }, []);

  return { saatIni, riwayat, dipanggilPada };
}
