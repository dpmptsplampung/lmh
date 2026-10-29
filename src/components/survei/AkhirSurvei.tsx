'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleCheck, Lightbulb, Loader2, ShieldAlert } from 'lucide-react';
import styles from './survei.module.css';

interface AkhirSurveiProps {
  /** Token undangan (untuk mengirim saran/pengaduan sesudah survei). Tanpa token layar akhir hanya berterima kasih. */
  token?: string;
  /** Dipanggil saat "Selesai" ditekan. Bawaan: kembali ke beranda (tab dari pemindai QR umumnya tidak boleh ditutup skrip). */
  onSelesai?: () => void;
}

type Jenis = 'saran' | 'pengaduan';
type Status = 'diam' | 'mengirim' | 'terkirim';

const BATAS_ISI = 2000;
const TEKS = {
  saran: {
    tombol: 'Sampaikan saran',
    judul: 'Saran untuk kami',
    placeholder: 'Tulis saran atau masukan Anda…',
    terkirim: 'Terima kasih, saran Anda sudah kami terima.',
    ikon: Lightbulb,
  },
  pengaduan: {
    tombol: 'Laporkan pengaduan',
    judul: 'Laporkan pengaduan',
    placeholder: 'Ceritakan hal kurang baik yang Anda alami…',
    terkirim: 'Pengaduan Anda sudah kami terima.',
    ikon: ShieldAlert,
  },
} as const;

// Layar akhir: terima kasih, lalu (opsional) saran dan/atau pengaduan, anonim bila mau.
export default function AkhirSurvei({ token, onSelesai }: AkhirSurveiProps) {
  const router = useRouter();
  const judulRef = useRef<HTMLHeadingElement>(null);
  const [terbuka, setTerbuka] = useState<Jenis | null>(null);
  const [isi, setIsi] = useState('');
  const [anonim, setAnonim] = useState(false);
  const [status, setStatus] = useState<Record<Jenis, Status>>({ saran: 'diam', pengaduan: 'diam' });
  const [nomor, setNomor] = useState<string | null>(null);
  const [galat, setGalat] = useState('');

  useEffect(() => {
    judulRef.current?.focus();
  }, []);

  async function kirim(jenis: Jenis) {
    if (!token || !isi.trim()) return;
    setGalat('');
    setStatus((s) => ({ ...s, [jenis]: 'mengirim' }));
    try {
      const res = await fetch(`/api/survei/${jenis}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, isi: isi.trim(), anonim }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; nomor?: string };
      if (!res.ok) {
        setGalat(json.error ?? 'Gagal mengirim. Coba lagi.');
        setStatus((s) => ({ ...s, [jenis]: 'diam' }));
        return;
      }
      if (jenis === 'pengaduan') setNomor(json.nomor ?? null);
      setStatus((s) => ({ ...s, [jenis]: 'terkirim' }));
      setTerbuka(null);
      setIsi('');
    } catch {
      setGalat('Gangguan jaringan. Coba lagi.');
      setStatus((s) => ({ ...s, [jenis]: 'diam' }));
    }
  }

  const bukaForm = (j: Jenis) => {
    setTerbuka(j);
    setIsi('');
    setGalat('');
  };

  return (
    <section className={styles.akhir} aria-labelledby="judul-akhir-survei">
      <div className={styles.lingkaranAkhir} aria-hidden="true">
        <CircleCheck size={56} className={styles.ikonAkhir} />
      </div>
      <h2 id="judul-akhir-survei" ref={judulRef} tabIndex={-1} className={styles.judulPesan}>
        Terima kasih, jawaban Anda sudah terkirim.
      </h2>
      <p className={styles.isiPesan}>
        Penilaian Anda membantu DPMPTSP Provinsi Lampung menjaga pelayanan yang bersih, cepat, dan ramah.
      </p>

      {token && terbuka === null && (
        <div className={styles.aksiAkhir}>
          <p className={styles.isiPesan}>Ada masukan, atau hal kurang baik yang ingin Anda laporkan?</p>
          {(['saran', 'pengaduan'] as const).map((j) => {
            const Ikon = TEKS[j].ikon;
            return status[j] === 'terkirim' ? (
              <p key={j} className={styles.terkirim} role="status">
                <CircleCheck size={18} aria-hidden="true" /> {TEKS[j].terkirim}
              </p>
            ) : (
              <button key={j} type="button" className={`btn btn--secondary ${styles.tombolAksi}`} onClick={() => bukaForm(j)}>
                <Ikon size={18} aria-hidden="true" /> {TEKS[j].tombol}
              </button>
            );
          })}
          {nomor && (
            <div className={styles.kartuNomor} role="status">
              <span>Nomor laporan Anda — simpan untuk memantau:</span>
              <strong className={styles.nomorLaporan}>{nomor}</strong>
              <Link href="/pengaduan/lacak">Pantau status laporan</Link>
            </div>
          )}
        </div>
      )}

      {token && terbuka !== null && (
        <form
          className={styles.formPesan}
          onSubmit={(e) => {
            e.preventDefault();
            void kirim(terbuka);
          }}
        >
          <label htmlFor="isi-pesan" className={styles.labelPesan}>{TEKS[terbuka].judul}</label>
          <textarea
            id="isi-pesan"
            className={styles.isianPesan}
            rows={5}
            maxLength={BATAS_ISI}
            value={isi}
            placeholder={TEKS[terbuka].placeholder}
            onChange={(e) => setIsi(e.target.value)}
            autoFocus
          />
          <p className={styles.hitung}>{isi.length}/{BATAS_ISI}</p>
          <label className={styles.centangAnonim}>
            <input type="checkbox" checked={anonim} onChange={(e) => setAnonim(e.target.checked)} />
            Jangan catat data diri saya
          </label>
          <p className={styles.catatanAnonim}>
            {anonim
              ? 'Laporan dikirim tanpa nama dan tanpa kaitan ke kunjungan Anda.'
              : 'Nama dan kunjungan Anda ikut tercatat agar petugas bisa menindaklanjuti.'}
          </p>
          {galat && <p className={styles.galatPesan} role="alert">{galat}</p>}
          <div className={styles.barisAksi}>
            <button type="button" className="btn btn--ghost" onClick={() => setTerbuka(null)} disabled={status[terbuka] === 'mengirim'}>
              Batal
            </button>
            <button type="submit" className="btn btn--primary" disabled={!isi.trim() || status[terbuka] === 'mengirim'}>
              {status[terbuka] === 'mengirim' ? <Loader2 size={16} className={styles.putar} aria-hidden="true" /> : null}
              Kirim
            </button>
          </div>
        </form>
      )}

      {terbuka === null && (
        <button
          type="button"
          className={`btn btn--primary ${styles.tombolNav}`}
          onClick={onSelesai ?? (() => router.replace('/'))}
        >
          Selesai
        </button>
      )}
    </section>
  );
}
