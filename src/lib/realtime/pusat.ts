'use client';

// Pusat Realtime staf (G4.6, SPEC §6.3): SATU channel postgres_changes per tabel untuk seluruh tab, dipakai bersama
// oleh sidebar (useNavBadges) dan halaman (useRealtimeRefetch). Free tier Supabase membatasi channel per koneksi,
// jadi dua pemakai tabel yang sama tidak boleh membuka dua channel.
//
// Kunci langganan = nama tabel saja. Semua pemanggil memakai binding yang sama ({ event: '*', schema: 'public',
// table }) tanpa filter baris; pendengar hanya menerima "ada perubahan" (tanpa payload) lalu memuat ulang lewat query
// biasa yang tetap dibatasi RLS. Realtime juga menegakkan RLS per pengguna, dan satu tab = satu pengguna, jadi
// berbagi channel tidak memperluas data yang terlihat. Pemanggil yang kelak butuh filter baris menyaring di pendengar.
//
// Siklus: channel dibuat saat pendengar pertama datang dan dilepas (removeChannel) saat pendengar terakhir pergi.
// realtime-js mengembalikan channel LAMA untuk topik yang sama selama pelepasannya belum selesai (registri baru
// dibersihkan saat leave), dan `.on()` pada channel itu melempar galat. Karena itu langganan ulang yang datang selagi
// pelepasan berjalan (React StrictMode, navigasi cepat) menunggu pelepasan selesai sebelum membuat channel baru.
import { createClient } from '@/lib/supabase/client';

export type StatusTabel = 'tersambung' | 'putus';

type Klien = ReturnType<typeof createClient>;
type Channel = ReturnType<Klien['channel']>;

interface Token<T> {
  fn: T;
}

interface Entri {
  pendengar: Set<Token<() => void>>;
  klien: Klien | null;
  channel: Channel | null;
  status: StatusTabel;
  /** Pangkat backoff buka ulang; kembali 0 setelah tersambung stabil. */
  percobaan: number;
  /** Satu jadwal buka ulang per tabel (tidak bertumpuk). */
  jadwal: ReturnType<typeof setTimeout> | null;
  /** Jadwal tiba saat tab tersembunyi: pendengar visibilitychange yang membuka saat tab terlihat. */
  tungguTerlihat: (() => void) | null;
  tersambungSejak: number | null;
}

// Buka ulang setelah CLOSED. Di realtime-js 2.110 (phoenix channel.js) CHANNEL_ERROR dan TIMED_OUT membuat channel
// `errored` dan phoenix menjadwalkan rejoin sendiri, jadi pusat tidak ikut campur. CLOSED terminal: onClose mereset
// rejoinTimer dan mengeluarkan channel dari registri (termasuk "mismatch between server and client bindings", yang
// memanggil unsubscribe() lalu berakhir CLOSED). Selama masih ada pendengar, channel lama dilepas lalu dibuka ulang
// dengan backoff 2, 4, 8, ... maks 60 dtk (+ jitter <= 20%); pemanggil tetap polling 30 dtk selama 'putus'.
const JEDA_AWAL_MS = 2_000;
const JEDA_MAKS_MS = 60_000;
const STABIL_MS = 30_000;
const PANGKAT_MAKS = 10;

const entri = new Map<string, Entri>();
const pelepasan = new Map<string, Promise<void>>();
const pengamat = new Map<string, Set<Token<(s: StatusTabel) => void>>>();

const adaJendela = () => typeof window !== 'undefined';

/** Panggil tiap fungsi pada salinan himpunan; yang sudah dilepas di tengah siaran dilewati, galat ditelan. */
function siarkan<T>(himpunan: Set<Token<T>> | undefined, panggil: (fn: T) => void): void {
  if (!himpunan) return;
  for (const t of Array.from(himpunan)) {
    if (!himpunan.has(t)) continue;
    try {
      panggil(t.fn);
    } catch {
      /* satu pendengar gagal tidak boleh menghentikan yang lain */
    }
  }
}

function aturStatus(tabel: string, e: Entri, s: StatusTabel): void {
  if (e.status === s) return;
  e.status = s;
  siarkan(pengamat.get(tabel), (cb) => cb(s));
}

const masihDipakai = (tabel: string, e: Entri) => entri.get(tabel) === e && e.pendengar.size > 0;

/**
 * 'tanpa' = tidak ada realtime sama sekali (klien gagal dibuat / tanpa channel): tidak dicoba lagi.
 * 'gagal' = channel()/on() melempar (mis. topik lama masih di registri): dicoba lagi dengan backoff.
 */
function buka(tabel: string, e: Entri): 'ok' | 'gagal' | 'tanpa' {
  let klien: Klien;
  try {
    klien = createClient();
  } catch {
    return 'tanpa'; // tanpa realtime: status tetap putus, pemanggil memakai polling cadangan
  }
  if (!klien || typeof klien.channel !== 'function') return 'tanpa';
  let ch: Channel;
  try {
    ch = klien
      .channel(`staf-tabel-${tabel}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: tabel }, () => {
        if (entri.get(tabel) === e) siarkan(e.pendengar, (fn) => fn());
      });
  } catch {
    return 'gagal';
  }
  e.klien = klien;
  e.channel = ch;
  try {
    ch.subscribe((s: string) => {
      // Status terlambat dari channel yang sudah dilepas/diganti diabaikan (termasuk CLOSED ganda).
      if (entri.get(tabel) !== e || e.channel !== ch) return;
      if (s === 'SUBSCRIBED') {
        e.tersambungSejak = Date.now();
        aturStatus(tabel, e, 'tersambung');
        return;
      }
      const stabil = e.tersambungSejak !== null && Date.now() - e.tersambungSejak >= STABIL_MS;
      e.tersambungSejak = null;
      aturStatus(tabel, e, 'putus');
      if (s !== 'CLOSED') return; // CHANNEL_ERROR / TIMED_OUT: rejoin oleh realtime-js
      if (stabil) e.percobaan = 0;
      lepas(tabel, e);
      if (masihDipakai(tabel, e)) jadwalkanBukaUlang(tabel, e);
    });
  } catch {
    /* status tetap putus */
  }
  return 'ok';
}

/** Buka channel setelah pelepasan channel lama (topik sama) selesai; gagal = jadwal ulang dengan backoff. */
function bukaSetelahLepas(tabel: string, e: Entri): void {
  const lanjut = () => {
    if (!masihDipakai(tabel, e) || e.channel) return;
    if (buka(tabel, e) === 'gagal') jadwalkanBukaUlang(tabel, e);
  };
  const tunggu = pelepasan.get(tabel);
  if (tunggu) void tunggu.then(lanjut);
  else lanjut();
}

function jadwalkanBukaUlang(tabel: string, e: Entri): void {
  if (e.jadwal || e.tungguTerlihat) return;
  const basis = Math.min(JEDA_MAKS_MS, JEDA_AWAL_MS * 2 ** e.percobaan);
  e.percobaan = Math.min(e.percobaan + 1, PANGKAT_MAKS);
  const jeda = basis + Math.floor(Math.random() * basis * 0.2);
  e.jadwal = setTimeout(() => {
    e.jadwal = null;
    if (!masihDipakai(tabel, e)) return;
    if (typeof document !== 'undefined' && document.hidden) {
      const saatTerlihat = () => {
        if (document.hidden) return;
        document.removeEventListener('visibilitychange', saatTerlihat);
        e.tungguTerlihat = null;
        if (masihDipakai(tabel, e)) bukaSetelahLepas(tabel, e);
      };
      e.tungguTerlihat = saatTerlihat;
      document.addEventListener('visibilitychange', saatTerlihat);
      return;
    }
    bukaSetelahLepas(tabel, e);
  }, jeda);
}

function batalkanJadwal(e: Entri): void {
  if (e.jadwal) {
    clearTimeout(e.jadwal);
    e.jadwal = null;
  }
  if (e.tungguTerlihat) {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', e.tungguTerlihat);
    e.tungguTerlihat = null;
  }
}

function tutup(tabel: string, e: Entri): void {
  entri.delete(tabel);
  batalkanJadwal(e);
  lepas(tabel, e);
}

/** Lepas channel aktif entri (bila ada) dan catat janji pelepasannya agar pembukaan berikutnya menunggu. */
function lepas(tabel: string, e: Entri): void {
  const { klien, channel } = e;
  e.klien = null;
  e.channel = null;
  aturStatus(tabel, e, 'putus');
  if (!klien || !channel || typeof klien.removeChannel !== 'function') return;
  let hasil: unknown;
  try {
    hasil = klien.removeChannel(channel);
  } catch {
    hasil = undefined;
  }
  const janji = Promise.resolve(hasil).then(
    () => undefined,
    () => undefined,
  );
  pelepasan.set(tabel, janji);
  void janji.then(() => {
    if (pelepasan.get(tabel) === janji) pelepasan.delete(tabel);
  });
}

/**
 * Dengarkan perubahan apa pun pada `public.<tabel>`. Mengembalikan fungsi berhenti yang idempoten.
 * Tanpa window (SSR) tidak membuat apa pun.
 */
export function langganTabel(tabel: string, pendengar: () => void): () => void {
  if (!adaJendela()) return () => {};
  let e = entri.get(tabel);
  const baru = !e;
  if (!e) {
    e = {
      pendengar: new Set(),
      klien: null,
      channel: null,
      status: 'putus',
      percobaan: 0,
      jadwal: null,
      tungguTerlihat: null,
      tersambungSejak: null,
    };
    entri.set(tabel, e);
  }
  const milik = e;
  const token: Token<() => void> = { fn: pendengar };
  milik.pendengar.add(token);

  if (baru) bukaSetelahLepas(tabel, milik);

  let selesai = false;
  return () => {
    if (selesai) return;
    selesai = true;
    milik.pendengar.delete(token);
    if (milik.pendengar.size === 0 && entri.get(tabel) === milik) tutup(tabel, milik);
  };
}

/** Status channel tabel saat ini; tabel tanpa pendengar = 'putus'. */
export function statusTabel(tabel: string): StatusTabel {
  return entri.get(tabel)?.status ?? 'putus';
}

/** Beri tahu `cb` setiap kali status tabel berubah. Tidak ikut menghitung refcount channel. */
export function langganStatus(tabel: string, cb: (s: StatusTabel) => void): () => void {
  if (!adaJendela()) return () => {};
  let himpunan = pengamat.get(tabel);
  if (!himpunan) {
    himpunan = new Set();
    pengamat.set(tabel, himpunan);
  }
  const milik = himpunan;
  const token: Token<(s: StatusTabel) => void> = { fn: cb };
  milik.add(token);
  let selesai = false;
  return () => {
    if (selesai) return;
    selesai = true;
    milik.delete(token);
    if (milik.size === 0 && pengamat.get(tabel) === milik) pengamat.delete(tabel);
  };
}

/** Hanya untuk test: lupakan seluruh state modul (tanpa melepas channel; jadwal buka ulang dibatalkan). */
export function setelUlangPusatRealtime(): void {
  for (const e of entri.values()) batalkanJadwal(e);
  entri.clear();
  pelepasan.clear();
  pengamat.clear();
}
