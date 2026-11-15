'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CircleCheck, Lightbulb, ShieldAlert } from 'lucide-react';
import Tombol from '@/components/ui/Tombol';
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
    judulKartu: 'Punya saran?',
    isiKartu: 'Ceritakan apa yang menurut Anda perlu kami perbaiki.',
    judul: 'Saran untuk kami',
    placeholder: 'Tulis saran atau masukan Anda…',
    anonim: 'Kirim dengan anonim. DPMPTSP tidak akan tahu siapa Anda yang mengirim.',
    catatanAnonim: 'Saran dikirim tanpa nama dan tanpa kaitan ke kunjungan Anda.',
    terkirim: 'Terima kasih, saran Anda sudah kami terima.',
    ikon: Lightbulb,
  },
  pengaduan: {
    tombol: 'Laporkan pengaduan',
    judulKartu: 'Mengalami hal yang kurang baik?',
    isiKartu: 'Laporkan petugas atau layanan yang tidak sesuai, lalu pantau tindak lanjutnya dengan nomor laporan.',
    judul: 'Laporkan pengaduan',
    placeholder: 'Ceritakan hal kurang baik yang Anda alami…',
    anonim: 'Laporkan dengan anonim. DPMPTSP tidak akan tahu siapa Anda yang melaporkan.',
    catatanAnonim:
      'Laporan dikirim tanpa nama dan tanpa kaitan ke kunjungan Anda. Anda hanya dapat memantau laporan dengan nomor yang muncul sesudah mengirim.',
    terkirim: 'Pengaduan Anda sudah kami terima.',
    ikon: ShieldAlert,
  },
} as const;
const CATATAN_TERCATAT = 'Nama dan kunjungan Anda ikut tercatat agar petugas dapat menindaklanjuti.';

// Layar akhir: terima kasih, lalu (opsional) saran dan/atau pengaduan, anonim bila mau.
export default function AkhirSurvei({ token, onSelesai }: AkhirSurveiProps) {
  const router = useRouter();
  const judulRef = useRef<HTMLHeadingElement>(null);
  const isianRef = useRef<HTMLTextAreaElement>(null);
  const [terbuka, setTerbuka] = useState<Jenis | null>(null);
  const [isi, setIsi] = useState('');
  const [anonim, setAnonim] = useState(false);
  const [status, setStatus] = useState<Record<Jenis, Status>>({ saran: 'diam', pengaduan: 'diam' });
  const [nomor, setNomor] = useState<string | null>(null);
  // Nomor dari laporan anonim tidak bisa dipulihkan (tidak ada identitas untuk mencarinya); pengunjung perlu tahu itu.
  const [nomorAnonim, setNomorAnonim] = useState(false);
  const [galat, setGalat] = useState('');

  useEffect(() => {
    judulRef.current?.focus();
  }, []);

  // Formulir pesan baru muncul setelah dipilih: pindahkan fokus ke isiannya (pengganti autoFocus).
  useEffect(() => {
    if (terbuka) isianRef.current?.focus();
  }, [terbuka]);

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
      if (jenis === 'pengaduan') {
        setNomor(json.nomor ?? null);
        setNomorAnonim(anonim);
      }
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
    setAnonim(false);
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
          <h3 className={styles.judulAjakan}>Ada yang ingin Anda sampaikan?</h3>
          {(['saran', 'pengaduan'] as const).map((j) => {
            const Ikon = TEKS[j].ikon;
            return (
              <section key={j} className={styles.kartuAksi} data-jenis={j} aria-labelledby={`judul-kartu-${j}`}>
                <span className={styles.ikonKartu} aria-hidden="true">
                  <Ikon size={22} />
                </span>
                <div className={styles.isiKartu}>
                  <h4 id={`judul-kartu-${j}`} className={styles.judulKartu}>{TEKS[j].judulKartu}</h4>
                  <p>{TEKS[j].isiKartu}</p>
                  {status[j] === 'terkirim' ? (
                    <p className={styles.terkirim} role="status">
                      <CircleCheck size={18} aria-hidden="true" /> {TEKS[j].terkirim}
                    </p>
                  ) : (
                    <Tombol className={styles.tombolAksi} ikonAkhir={ArrowRight} onClick={() => bukaForm(j)}>
                      {TEKS[j].tombol}
                    </Tombol>
                  )}
                </div>
              </section>
            );
          })}
          {nomor && (
            <div className={styles.kartuNomor} role="status">
              <span>Nomor laporan Anda. Simpan untuk memantau status:</span>
              <strong className={styles.nomorLaporan}>{nomor}</strong>
              {nomorAnonim && <span>Nomor ini tidak dapat dipulihkan bila hilang.</span>}
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
            ref={isianRef}
            className={styles.isianPesan}
            rows={5}
            maxLength={BATAS_ISI}
            value={isi}
            placeholder={TEKS[terbuka].placeholder}
            onChange={(e) => setIsi(e.target.value)}
          />
          <p className={styles.hitung}>{isi.length}/{BATAS_ISI}</p>
          <label className={styles.centangAnonim}>
            <input type="checkbox" checked={anonim} onChange={(e) => setAnonim(e.target.checked)} />
            {TEKS[terbuka].anonim}
          </label>
          <p className={styles.catatanAnonim}>{anonim ? TEKS[terbuka].catatanAnonim : CATATAN_TERCATAT}</p>
          {galat && <p className={styles.galatPesan} role="alert">{galat}</p>}
          <div className={styles.barisAksi}>
            <Tombol varian="hantu" onClick={() => setTerbuka(null)} disabled={status[terbuka] === 'mengirim'}>
              Batal
            </Tombol>
            <Tombol
              type="submit"
              disabled={!isi.trim() || status[terbuka] === 'mengirim'}
              memuat={status[terbuka] === 'mengirim'}
            >
              Kirim
            </Tombol>
          </div>
        </form>
      )}

      {terbuka === null && (
        <Tombol varian="hantu" className={styles.tombolNav} onClick={onSelesai ?? (() => router.replace('/'))}>
          Selesai
        </Tombol>
      )}
    </section>
  );
}
