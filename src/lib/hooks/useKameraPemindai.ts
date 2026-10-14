'use client';

// Kamera pemindai QR (html5-qrcode) dengan siklus hidup yang dijaga ketat: kamera menyala HANYA selama `aktif` benar
// DAN dokumen terlihat; di luar itu semua track dihentikan.
//
// Mengapa tidak cukup memanggil Html5Qrcode.stop():
//  1. Pustaka menyimpan MediaStream hanya di dalam instansnya. Bila start() GAGAL sesudah getUserMedia berhasil
//     (mis. applyConstraints menolak), stream yatim: tidak ada rujukan untuk dimatikan, lampu kamera tetap menyala.
//  2. start() tidak bisa dibatalkan: stop() melempar selama start() masih menunggu; stream yang datang belakangan
//     hanya mati bila pemanggil ingat memeriksa ulang.
//  3. stop() bergantung pada mesin status internal pustaka (dan bisa melempar di tengah jalan).
// Karena itu getUserMedia disadap selama start() berjalan: setiap track yang diperoleh dicatat dan dimatikan langsung
// oleh kita (sinkron), tanpa menunggu pustaka; stop()/clear() pustaka tetap dipanggil sesudahnya untuk membersihkan DOM.
//
// Henti otomatis: unmount/ganti tab/halaman, `aktif` menjadi false, visibilitychange -> hidden, pagehide, beforeunload,
// dan galat. Setelah dimatikan karena halaman disembunyikan, kamera TIDAK menyala lagi sendiri: pengguna menekan
// tombol (nyalakan()). Sesi dijalankan berurutan (satu per satu) sehingga tidak pernah ada dua start() bersamaan
// (React StrictMode menjalankan efek dua kali di dev).
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// Antarmuka minimal pemindai (html5-qrcode dimuat dinamis; tipenya tidak diimpor agar bundel awal ringan).
interface PemindaiQr {
  start: (
    kamera: { facingMode: string },
    konfigurasi: { fps: number; qrbox: { width: number; height: number }; aspectRatio: number },
    saatBerhasil: (teks: string) => void,
    saatGagal: () => void,
  ) => Promise<unknown>;
  stop: () => Promise<unknown>;
  clear: () => void | Promise<unknown>;
}

export const ID_ELEMEN_PEMINDAI = 'qr-scanner-element';

export type StatusKamera = 'mati' | 'menyalakan' | 'aktif' | 'dijeda' | 'galat';

interface Sesi {
  batal: boolean;
  tracks: Set<MediaStreamTrack>;
  pemindai: PemindaiQr | null;
  wadah: HTMLElement | null;
  /** Selesai bila start() sudah tuntas (berhasil/gagal/dilewati) dan, sesudah dibatalkan, pembersihan pustaka selesai. */
  selesai: Promise<void>;
}

let sesiTerakhir: Sesi | null = null;

function hentikanTracks(tracks: Iterable<MediaStreamTrack>) {
  for (const t of tracks) {
    try {
      t.stop();
    } catch {
      /* sudah berhenti */
    }
  }
}

/** Matikan kamera SEKARANG (sinkron) tanpa bergantung pada pustaka: track tercatat + sisa <video> di wadah. */
function matikanSinkron(sesi: Sesi) {
  hentikanTracks(sesi.tracks);
  sesi.wadah?.querySelectorAll('video').forEach((v) => {
    try {
      const sumber = v.srcObject as MediaStream | null;
      if (sumber && typeof sumber.getTracks === 'function') hentikanTracks(sumber.getTracks());
      v.srcObject = null;
    } catch {
      /* abaikan */
    }
  });
}

/** Bersihkan sisi pustaka (stop lalu clear). Keduanya bisa melempar bila belum/tidak berjalan: diabaikan. */
async function bersihkanPustaka(sesi: Sesi) {
  const p = sesi.pemindai;
  if (!p) return;
  try {
    await p.stop();
  } catch {
    /* belum berjalan */
  }
  try {
    await p.clear();
  } catch {
    /* sudah bersih */
  }
  sesi.pemindai = null;
}

function dokumenTersembunyi(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

interface PanggilanBalik {
  saatDekode: (teks: string) => void;
  saatSiap: () => void;
  saatGalat: () => void;
  saatTersembunyi: () => void;
}

async function jalankan(sesi: Sesi, sebelumnya: Promise<void>, cb: PanggilanBalik): Promise<void> {
  // Giliran: tunggu sesi sebelumnya tuntas (termasuk pembersihannya) agar tak ada start() ganda.
  await sebelumnya;
  if (sesi.batal) return;
  if (dokumenTersembunyi()) {
    cb.saatTersembunyi();
    return;
  }

  // Sadap getUserMedia selama start(): catat track; bila sudah dibatalkan, matikan begitu stream tiba.
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const asli = md?.getUserMedia;
  let bungkus: MediaDevices['getUserMedia'] | null = null;
  if (md && typeof asli === 'function') {
    bungkus = (...args: Parameters<MediaDevices['getUserMedia']>) => {
      return asli.apply(md, args).then((stream) => {
        const tracks = stream.getTracks();
        for (const t of tracks) sesi.tracks.add(t);
        if (sesi.batal) hentikanTracks(tracks);
        return stream;
      });
    };
    md.getUserMedia = bungkus;
  }

  try {
    const { Html5Qrcode } = await import('html5-qrcode');
    if (sesi.batal || !sesi.wadah) return;
    if (dokumenTersembunyi()) {
      cb.saatTersembunyi();
      return;
    }

    // Elemen baru per sesi (id harus unik di dokumen); sisa elemen sesi lama sudah dibersihkan karena sesi berurutan.
    const el = document.createElement('div');
    el.id = ID_ELEMEN_PEMINDAI;
    sesi.wadah.replaceChildren(el);

    const instans = new Html5Qrcode(ID_ELEMEN_PEMINDAI) as unknown as PemindaiQr;
    sesi.pemindai = instans;
    await instans.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
      (teks: string) => {
        if (!sesi.batal) cb.saatDekode(teks);
      },
      () => {
        /* kegagalan dekode per frame diabaikan */
      },
    );
    if (sesi.batal) {
      matikanSinkron(sesi);
      return;
    }
    cb.saatSiap();
  } catch (err) {
    console.error('Scanner init error:', err);
    // Gagal setelah stream diperoleh = stream yatim di pustaka; matikan track yang kita catat.
    matikanSinkron(sesi);
    if (!sesi.batal) cb.saatGalat();
  } finally {
    if (md && bungkus && md.getUserMedia === bungkus) md.getUserMedia = asli as MediaDevices['getUserMedia'];
  }
}

function mulaiSesi(wadah: HTMLElement | null, cb: PanggilanBalik): Sesi {
  const sebelumnya = sesiTerakhir?.selesai ?? Promise.resolve();
  const sesi: Sesi = { batal: false, tracks: new Set(), pemindai: null, wadah, selesai: Promise.resolve() };
  sesi.selesai = jalankan(sesi, sebelumnya, cb).catch(() => {
    /* galat sudah ditangani di dalam */
  });
  sesiTerakhir = sesi;
  return sesi;
}

/** Hentikan sesi: kamera mati sinkron, lalu pembersihan pustaka dirantai SETELAH start() tuntas. Aman dipanggil berulang. */
function hentikanSesi(sesi: Sesi) {
  if (sesi.batal) {
    matikanSinkron(sesi);
    return;
  }
  sesi.batal = true;
  matikanSinkron(sesi);
  sesi.selesai = sesi.selesai.then(() => bersihkanPustaka(sesi));
}

interface Opsi {
  /** Kamera diizinkan menyala (mis. panel Scan QR tampil dan sedang dalam keadaan memindai). */
  aktif: boolean;
  /** Elemen pembungkus tempat pratinjau kamera dirender. */
  wadahRef: RefObject<HTMLElement | null>;
  /** Dipanggil tiap QR terdekode (bisa berkali-kali per detik). */
  onDekode: (teks: string) => void;
}

export function useKameraPemindai({ aktif, wadahRef, onDekode }: Opsi) {
  const [percobaan, setPercobaan] = useState(0);
  // Dimatikan karena halaman tersembunyi/ditinggalkan: tidak menyala lagi sampai pengguna menekan tombol.
  const [dijeda, setDijeda] = useState(false);
  const [galat, setGalat] = useState(false);
  const [siap, setSiap] = useState(false);
  const sesiRef = useRef<Sesi | null>(null);
  const dekodeRef = useRef(onDekode);
  useEffect(() => {
    dekodeRef.current = onDekode;
  });

  useEffect(() => {
    if (!aktif || dijeda || galat) return;
    const sesi = mulaiSesi(wadahRef.current, {
      saatDekode: (teks) => dekodeRef.current(teks),
      saatSiap: () => setSiap(true),
      saatGalat: () => setGalat(true),
      saatTersembunyi: () => setDijeda(true),
    });
    sesiRef.current = sesi;
    return () => {
      hentikanSesi(sesi);
      if (sesiRef.current === sesi) sesiRef.current = null;
      setSiap(false);
    };
  }, [aktif, dijeda, galat, percobaan, wadahRef]);

  // Halaman tersembunyi / ditinggalkan: matikan sekarang juga dan jangan menyala lagi tanpa tindakan pengguna.
  useEffect(() => {
    const matikan = () => {
      const sesi = sesiRef.current;
      if (!sesi) return;
      hentikanSesi(sesi);
      setDijeda(true);
    };
    const saatVisibilitas = () => {
      if (document.visibilityState === 'hidden') matikan();
    };
    document.addEventListener('visibilitychange', saatVisibilitas);
    window.addEventListener('pagehide', matikan);
    window.addEventListener('beforeunload', matikan);
    return () => {
      document.removeEventListener('visibilitychange', saatVisibilitas);
      window.removeEventListener('pagehide', matikan);
      window.removeEventListener('beforeunload', matikan);
    };
  }, []);

  /** Tindakan pengguna: nyalakan (lagi) kamera setelah dijeda atau galat. */
  const nyalakan = useCallback(() => {
    setDijeda(false);
    setGalat(false);
    setPercobaan((n) => n + 1);
  }, []);

  let status: StatusKamera;
  if (!aktif) status = 'mati';
  else if (dijeda) status = 'dijeda';
  else if (galat) status = 'galat';
  else if (siap) status = 'aktif';
  else status = 'menyalakan';

  return { status, nyalakan };
}
