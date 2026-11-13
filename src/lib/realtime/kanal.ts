'use client';

// Channel Realtime milik satu pemakai yang dibuka ulang sendiri setelah tertutup (audit Realtime 2026-11-13). Dipakai
// channel yang butuh payload atau filter baris sehingga tidak bisa lewat pusat (lib/realtime/pusat.ts): `chat-admin`
// (INSERT chat_pesan) dan `chat-sesi-<id>` (pengunjung). Pola buka ulang sama dengan pusat:
// - CLOSED terminal (realtime-js 2.110 mengeluarkan channel dari registri dan tidak bergabung lagi): channel lama
//   dilepas lalu dibuka ulang dengan backoff 2, 4, 8, ... maks 60 dtk (+ jitter <= 20%). Pangkat backoff kembali 0
//   bila channel sempat tersambung >= 30 dtk.
// - CHANNEL_ERROR / TIMED_OUT: phoenix menjadwalkan rejoin sendiri pada channel yang sama, jadi tidak ikut campur
//   (membuka channel kedua di sini = langganan ganda).
// - Jadwal buka ulang yang jatuh saat tab tersembunyi menunggu tab terlihat; setelah berhenti tidak ada yang dibuka.
// - realtime-js mengembalikan channel LAMA untuk topik yang sama selama pelepasannya belum selesai, dan `.on()` pada
//   channel itu melempar. Pembukaan (termasuk pasang ulang komponen dengan topik sama) menunggu pelepasan selesai.
import { createClient } from '@/lib/supabase/client';

type Klien = ReturnType<typeof createClient>;
export type Kanal = ReturnType<Klien['channel']>;

const JEDA_AWAL_MS = 2_000;
const JEDA_MAKS_MS = 60_000;
const STABIL_MS = 30_000;
const PANGKAT_MAKS = 10;

/** Pelepasan yang masih berjalan per topik; dibagi semua pemakai modul ini. */
const pelepasan = new Map<string, Promise<void>>();

export interface OpsiKanal {
  topik: string;
  /** Pasang binding (`.on(...)`) pada channel baru dan kembalikan channel itu. Dipanggil ulang tiap buka ulang. */
  pasang: (ch: Kanal) => Kanal;
  /** Status mentah realtime-js ('SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'); tidak dipanggil setelah berhenti. */
  saatStatus: (s: string) => void;
}

/**
 * Buka channel `topik` dan jaga tetap terbuka sampai fungsi berhenti (idempoten) dipanggil. Tanpa window (SSR) atau
 * tanpa klien Realtime tidak membuat apa pun; pemanggil tetap memakai polling cadangan.
 */
export function bukaKanal({ topik, pasang, saatStatus }: OpsiKanal): () => void {
  if (typeof window === 'undefined') return () => {};
  let berhenti = false;
  let klien: Klien | null = null;
  let ch: Kanal | null = null;
  let percobaan = 0;
  let tersambungSejak: number | null = null;
  let jadwal: ReturnType<typeof setTimeout> | null = null;
  let tungguTerlihat: (() => void) | null = null;

  const lapor = (s: string) => {
    if (!berhenti) saatStatus(s);
  };

  const lepas = () => {
    const k = klien;
    const c = ch;
    klien = null;
    ch = null;
    tersambungSejak = null;
    if (!k || !c || typeof k.removeChannel !== 'function') return;
    let hasil: unknown;
    try {
      hasil = k.removeChannel(c);
    } catch {
      hasil = undefined;
    }
    const janji = Promise.resolve(hasil).then(
      () => undefined,
      () => undefined,
    );
    pelepasan.set(topik, janji);
    void janji.then(() => {
      if (pelepasan.get(topik) === janji) pelepasan.delete(topik);
    });
  };

  const jadwalkan = () => {
    if (berhenti || jadwal || tungguTerlihat) return;
    const basis = Math.min(JEDA_MAKS_MS, JEDA_AWAL_MS * 2 ** percobaan);
    percobaan = Math.min(percobaan + 1, PANGKAT_MAKS);
    const jeda = basis + Math.floor(Math.random() * basis * 0.2);
    jadwal = setTimeout(() => {
      jadwal = null;
      if (berhenti) return;
      if (typeof document !== 'undefined' && document.hidden) {
        const saatTerlihat = () => {
          if (document.hidden) return;
          document.removeEventListener('visibilitychange', saatTerlihat);
          tungguTerlihat = null;
          bukaSetelahLepas();
        };
        tungguTerlihat = saatTerlihat;
        document.addEventListener('visibilitychange', saatTerlihat);
        return;
      }
      bukaSetelahLepas();
    }, jeda);
  };

  /** 'tanpa' = tidak ada Realtime sama sekali (tidak dicoba lagi); 'gagal' = channel()/on() melempar (dicoba lagi). */
  const buka = (): 'ok' | 'gagal' | 'tanpa' => {
    let k: Klien;
    try {
      k = createClient();
    } catch {
      return 'tanpa';
    }
    if (!k || typeof k.channel !== 'function') return 'tanpa';
    let baru: Kanal;
    try {
      baru = pasang(k.channel(topik));
    } catch {
      return 'gagal';
    }
    klien = k;
    ch = baru;
    try {
      baru.subscribe((s: string) => {
        // Status terlambat dari channel yang sudah dilepas/diganti diabaikan (termasuk CLOSED dari pelepasan sendiri).
        if (berhenti || ch !== baru) return;
        if (s === 'SUBSCRIBED') {
          tersambungSejak = Date.now();
          lapor(s);
          return;
        }
        const stabil = tersambungSejak !== null && Date.now() - tersambungSejak >= STABIL_MS;
        tersambungSejak = null;
        lapor(s);
        if (s !== 'CLOSED') return; // CHANNEL_ERROR / TIMED_OUT: rejoin oleh realtime-js
        if (stabil) percobaan = 0;
        lepas();
        jadwalkan();
      });
    } catch {
      /* tanpa status: pemanggil tetap polling cepat */
    }
    return 'ok';
  };

  const bukaSetelahLepas = () => {
    const lanjut = () => {
      if (berhenti || ch) return;
      if (buka() === 'gagal') jadwalkan();
    };
    const tunggu = pelepasan.get(topik);
    if (tunggu) void tunggu.then(lanjut);
    else lanjut();
  };

  bukaSetelahLepas();

  return () => {
    if (berhenti) return;
    berhenti = true;
    if (jadwal) {
      clearTimeout(jadwal);
      jadwal = null;
    }
    if (tungguTerlihat) {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', tungguTerlihat);
      tungguTerlihat = null;
    }
    lepas();
  };
}

/** Hanya untuk test: lupakan pelepasan yang masih tercatat. */
export function setelUlangKanal(): void {
  pelepasan.clear();
}
