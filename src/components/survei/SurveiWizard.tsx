'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle, Send } from 'lucide-react';
import ErrorRetry from '@/components/ErrorRetry';
import type { KonteksSurvei } from '@/lib/survei/konteks';
import { hapusDraf, muatDraf, simpanDraf } from '@/lib/survei/penyimpanan';
import { buatSapaan } from '@/lib/survei/sapaan';
import {
  LANGKAH,
  PERTANYAAN_SPAK,
  SKALA_SPAK,
  SURVEI,
  UNSUR_SKM,
  type Jawaban,
  type KunciSkm,
  type KunciSpak,
} from '@/lib/survei/pertanyaan';
import { bangunPayload, buatState, jawab, langkahLengkap, maju, mundur, type StateWizard } from '@/lib/survei/wizard';
import AkhirSurvei from './AkhirSurvei';
import PesanStatusSurvei, { type StatusPesanSurvei } from './PesanStatusSurvei';
import SegmenSkm from './SegmenSkm';
import SkalaSpak from './SkalaSpak';
import styles from './survei.module.css';

interface SurveiWizardProps {
  /** Token undangan dari URL; dipakai untuk kunci draf dan dikirim apa adanya ke POST /api/survei/kirim. */
  token: string;
  /** Konteks undangan (status sudah 'ok' saat wizard dipasang). Unit/Layanan sengaja tidak ditampilkan ke pengunjung. */
  konteks: KonteksSurvei;
  /** Dipanggil saat "Selesai" di layar akhir ditekan (bawaan layar akhir: kembali ke beranda). */
  onSelesai?: () => void;
}

type Tahap = 'mengisi' | 'mengirim' | 'galat' | 'selesai' | StatusPesanSurvei;

const JUMLAH_SOAL = LANGKAH.reduce((n, l) => n + l.kunci.length, 0);
const JUDUL_GALAT = 'Jawaban belum terkirim';
const GALAT_JARINGAN =
  'Koneksi bermasalah. Jawaban Anda masih ada di halaman ini; periksa jaringan lalu coba lagi.';
const GALAT_SERVER = 'Jawaban Anda belum dapat dikirim karena ada gangguan. Jawaban Anda masih ada di halaman ini; coba lagi.';
const GALAT_DITOLAK = 'Jawaban Anda belum dapat diterima. Periksa kembali jawaban Anda, lalu coba kirim lagi.';

// Respons POST /api/survei/kirim yang berarti undangan tidak bisa dipakai lagi (jawaban tidak akan pernah diterima).
const STATUS_DARI_HTTP: Record<number, StatusPesanSurvei> = {
  404: 'tidak_valid',
  409: 'sudah_diisi',
  410: 'kedaluwarsa',
};

const TEKS_SPAK = Object.fromEntries(PERTANYAAN_SPAK.map((p) => [p.kunci, p.teks])) as Record<KunciSpak, string>;
const TEKS_SKM = Object.fromEntries(UNSUR_SKM.map((u) => [u.kunci, u.teks])) as Record<KunciSkm, string>;

/** Draf dipulihkan hanya sampai langkah pertama yang belum lengkap, supaya draf utak-atik tidak melompati soal. */
function pulihkan(token: string): StateWizard {
  const draf = muatDraf(token);
  if (draf === null) return buatState();
  const pertamaKosong = LANGKAH.findIndex((_, i) => !langkahLengkap(buatState(draf.jawaban, i)));
  return buatState(draf.jawaban, pertamaKosong === -1 ? draf.indeks : Math.min(draf.indeks, pertamaKosong));
}

function perilakuGulir(): ScrollBehavior {
  const kurangiGerak = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return kurangiGerak ? 'auto' : 'smooth';
}

// Riwayat browser: tiap langkah punya satu entri bertanda `lmhSurvei`, supaya tombol Back ponsel menjadi Back langkah.
function indeksRiwayat(): unknown {
  return (window.history.state as { lmhSurvei?: unknown } | null)?.lmhSurvei;
}

/** Target popstate: mundur selalu boleh; maju (Forward ponsel) hanya bila semua langkah sebelum target sudah lengkap. */
function pindahKe(state: StateWizard, target: number): StateWizard {
  if (!Number.isInteger(target) || target < 0 || target >= LANGKAH.length || target === state.indeks) return state;
  if (target > state.indeks) {
    for (let i = 0; i < target; i++) if (!langkahLengkap(buatState(state.jawaban, i))) return state;
  }
  return { indeks: target, jawaban: state.jawaban };
}

export default function SurveiWizard({ token, konteks, onSelesai }: SurveiWizardProps) {
  const [state, setState] = useState<StateWizard>(() => pulihkan(token));
  const [tahap, setTahap] = useState<Tahap>('mengisi');
  const [pesanGalat, setPesanGalat] = useState(GALAT_JARINGAN);
  // Dihitung sekali saat dipasang (di klien): salam tidak berganti di tengah pengisian.
  const [sapaan] = useState(() => buatSapaan(konteks.nama));

  const akarRef = useRef<HTMLDivElement>(null);
  const kepalaRef = useRef<HTMLDivElement>(null);
  const judulRef = useRef<HTMLHeadingElement>(null);
  // Kunci anti ketukan ganda: tepat satu POST berjalan/berhasil. Dilepas hanya saat pengiriman gagal (bisa dicoba lagi).
  const kirimRef = useRef(false);
  const indeksAwalRef = useRef(state.indeks);
  const indeksSebelumnyaRef = useRef(state.indeks);

  // Draf sementara (sessionStorage); tidak ditulis untuk pengunjung yang belum menjawab apa pun, dan tidak setelah selesai.
  useEffect(() => {
    const kosong = state.indeks === 0 && Object.keys(state.jawaban).length === 0;
    if (!kosong && (tahap === 'mengisi' || tahap === 'mengirim' || tahap === 'galat')) simpanDraf(token, state);
  }, [token, state, tahap]);

  // Fokus ke judul langkah saat langkah berganti (bukan saat pertama dimuat), diikuti gulir ke awal langkah.
  useEffect(() => {
    if (indeksSebelumnyaRef.current === state.indeks) return;
    indeksSebelumnyaRef.current = state.indeks;
    judulRef.current?.focus({ preventScroll: true });
    kepalaRef.current?.scrollIntoView?.({ block: 'start', behavior: perilakuGulir() });
  }, [state.indeks]);

  // Selaraskan riwayat browser dengan langkah awal (termasuk langkah hasil pemulihan draf), lalu dengarkan Back/Forward ponsel.
  useEffect(() => {
    const awal = indeksAwalRef.current;
    if (indeksRiwayat() !== awal) {
      try {
        window.history.replaceState({ ...(window.history.state as object | null), lmhSurvei: 0 }, '');
        for (let i = 1; i <= awal; i++) window.history.pushState({ lmhSurvei: i }, '');
      } catch {
        // Riwayat hanya kemudahan; tanpanya Back ponsel keluar dari halaman dan draf tetap tersimpan.
      }
    }

    const saatPopstate = (e: PopStateEvent) => {
      const target = (e.state as { lmhSurvei?: unknown } | null)?.lmhSurvei;
      if (typeof target !== 'number' || kirimRef.current) return;
      setState((s) => pindahKe(s, target));
    };
    window.addEventListener('popstate', saatPopstate);
    return () => window.removeEventListener('popstate', saatPopstate);
  }, []);

  function catatLangkahBaru(indeks: number) {
    try {
      window.history.pushState({ lmhSurvei: indeks }, '');
    } catch {
      // Lihat catatan di atas: gagal mencatat riwayat tidak boleh menghentikan wizard.
    }
  }

  function gulirKe(kunci: KunciSpak | KunciSkm) {
    akarRef.current
      ?.querySelector(`[data-soal="${kunci}"]`)
      ?.scrollIntoView?.({ block: 'center', behavior: perilakuGulir() });
  }

  async function kirim(jawaban: Jawaban) {
    const payload = bangunPayload(jawaban);
    if (payload === null || kirimRef.current) return;
    kirimRef.current = true;
    setTahap('mengirim');

    let respons: Response;
    try {
      respons = await fetch('/api/survei/kirim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...payload }),
      });
    } catch {
      kirimRef.current = false;
      setPesanGalat(GALAT_JARINGAN);
      setTahap('galat');
      return;
    }

    if (respons.ok) {
      hapusDraf(token);
      setTahap('selesai');
      return;
    }
    const status = STATUS_DARI_HTTP[respons.status];
    if (status) {
      hapusDraf(token);
      setTahap(status);
      return;
    }
    kirimRef.current = false;
    setPesanGalat(respons.status === 400 ? GALAT_DITOLAK : GALAT_SERVER);
    setTahap('galat');
  }

  function pilih(kunci: KunciSpak | KunciSkm, nilai: number, otomatis: boolean) {
    if (tahap === 'mengirim') return;
    const { state: berikut, hasil } = jawab(state, kunci, nilai, { otomatis });

    if (hasil.aksi === 'lanjut') {
      // Tanpa delay: ketukan jawaban terakhir langsung memindahkan langkah.
      const lanjut = maju(berikut);
      setState(lanjut);
      if (lanjut !== berikut) catatLangkahBaru(lanjut.indeks);
      return;
    }
    setState(berikut);
    if (hasil.aksi === 'gulir') gulirKe(hasil.kunci);
    else if (hasil.aksi === 'kirim') void kirim(berikut.jawaban);
  }

  function lanjutAtauKirim() {
    if (tahap === 'mengirim') return;
    if (state.indeks === LANGKAH.length - 1) {
      void kirim(state.jawaban);
      return;
    }
    const lanjut = maju(state);
    if (lanjut === state) return;
    setState(lanjut);
    catatLangkahBaru(lanjut.indeks);
  }

  function kembali() {
    if (tahap === 'mengirim' || state.indeks === 0) return;
    // Bila entri riwayat ini milik langkah aktif, mundur lewat riwayat (popstate memindahkan langkah) agar tombol
    // Back ponsel dan tombol Kembali selalu searah; selain itu mundur langsung.
    if (indeksRiwayat() === state.indeks) window.history.back();
    else setState(mundur(state));
  }

  if (tahap === 'selesai') return <AkhirSurvei token={token} onSelesai={onSelesai} />;
  if (tahap === 'kedaluwarsa' || tahap === 'sudah_diisi' || tahap === 'tidak_valid') {
    return <PesanStatusSurvei status={tahap} />;
  }

  const langkah = LANGKAH[state.indeks];
  const terakhir = state.indeks === LANGKAH.length - 1;
  const mengirim = tahap === 'mengirim';
  const siap = terakhir ? bangunPayload(state.jawaban) !== null : langkahLengkap(state);
  const jumlahTerjawab = LANGKAH.reduce((n, l) => n + l.kunci.filter((k) => state.jawaban[k] !== undefined).length, 0);

  return (
    <div ref={akarRef} className={styles.wizard}>
      {/* Satu region pengumuman: berubah saat langkah berganti atau saat pengiriman dimulai. */}
      <div role="status" aria-live="polite" className={styles.srOnly}>
        {mengirim ? 'Mengirim jawaban Anda' : `Langkah ${state.indeks + 1} dari ${LANGKAH.length}`}
      </div>

      {/* Pengantar ringkas hanya di langkah pertama: penilaian untuk pelayanan DPMPTSP secara umum, tidak menyebut satu
          Layanan tertentu (keputusan pemilik), dan tidak memakan layar supaya soal pertama langsung terlihat. */}
      {state.indeks === 0 && (
        <>
          <p className={styles.sapaan}>{sapaan}</p>
          <p className={styles.intro}>
            Bantu kami melayani lebih baik. Pengisian sukarela; ketuk jawaban Anda, halaman akan otomatis lanjut.
            <span className={styles.srOnly}> Bila memakai papan ketik atau pembaca layar, gunakan tombol Lanjut.</span>
          </p>
        </>
      )}

      <div ref={kepalaRef} className={styles.kepalaLangkah}>
        <div className={styles.progresBaris}>
          <p className={styles.langkahTeks} aria-hidden="true">
            Langkah {state.indeks + 1} dari {LANGKAH.length}
          </p>
          <p className={styles.terjawabTeks} aria-hidden="true">
            {jumlahTerjawab}/{JUMLAH_SOAL} terjawab
          </p>
        </div>
        <div className={styles.progres} aria-hidden="true">
          <span className={styles.progresIsi} style={{ width: `${(jumlahTerjawab / JUMLAH_SOAL) * 100}%` }} />
        </div>
        <h2 ref={judulRef} tabIndex={-1} className={styles.judulLangkah}>
          <span className={styles.judulSurvei}>{SURVEI[langkah.survei].judul}</span>
        </h2>
      </div>

      {langkah.survei === 'spak' ? (
        <>
          <p className={styles.instruksi}>{SURVEI.spak.instruksi}</p>
          <ul className={styles.legenda} aria-label="Keterangan skala">
            {SKALA_SPAK.map((s) => (
              <li key={s.nilai} data-nilai={s.nilai}>
                <strong>{s.nilai}</strong> {s.label}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.instruksi}>Bagaimana penilaian Anda terhadap setiap unsur pelayanan berikut?</p>
      )}

      {/* key = langkah: daftar soal dipasang ulang tiap langkah sehingga animasi masuk berjalan (dimatikan bila reduced motion). */}
      <div key={state.indeks} className={styles.daftarSoal}>
        {langkah.kunci.map((kunci) =>
          langkah.survei === 'spak' ? (
            <SkalaSpak
              key={kunci}
              kunci={kunci as KunciSpak}
              nomor={Number(kunci.slice(1))}
              teks={TEKS_SPAK[kunci as KunciSpak]}
              nilai={state.jawaban[kunci]}
              nonaktif={mengirim}
              onPilih={(nilai, otomatis) => pilih(kunci, nilai, otomatis)}
            />
          ) : (
            <SegmenSkm
              key={kunci}
              kunci={kunci as KunciSkm}
              nomor={Number(kunci.slice(1))}
              teks={TEKS_SKM[kunci as KunciSkm]}
              nilai={state.jawaban[kunci]}
              nonaktif={mengirim}
              onPilih={(nilai, otomatis) => pilih(kunci, nilai, otomatis)}
            />
          ),
        )}
      </div>

      {tahap === 'galat' && (
        <div className={styles.galat}>
          <ErrorRetry judul={JUDUL_GALAT} pesan={pesanGalat} onRetry={() => void kirim(state.jawaban)} />
        </div>
      )}

      {mengirim ? (
        <div className={styles.mengirim} aria-hidden="true">
          <LoaderCircle size={20} className={styles.putar} />
          <span>Mengirim jawaban Anda…</span>
        </div>
      ) : (
        <div className={styles.navigasiLengket}>
          {!siap && (
            <p id="petunjuk-lanjut" className={styles.srOnly}>
              Jawab semua pertanyaan untuk melanjutkan.
            </p>
          )}
          <div className={styles.navigasi}>
            {state.indeks > 0 && (
              <button type="button" className={`btn btn--secondary ${styles.tombolNav}`} onClick={kembali}>
                <ArrowLeft size={18} aria-hidden="true" />
                Kembali
              </button>
            )}
            <button
              type="button"
              className={`btn btn--primary ${styles.tombolNav}`}
              disabled={!siap}
              aria-describedby={siap ? undefined : 'petunjuk-lanjut'}
              onClick={lanjutAtauKirim}
            >
              {terakhir ? 'Kirim jawaban' : 'Lanjut'}
              {terakhir ? <Send size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
