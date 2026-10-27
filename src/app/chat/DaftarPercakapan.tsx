'use client';

import { Bot, CheckCircle2, Loader2, MessageSquare, Plus } from 'lucide-react';
import ErrorRetry from '@/components/ErrorRetry';
import { belumDibaca, type PercakapanRingkas } from '@/lib/chat/percakapan';
import styles from './daftar.module.css';

interface Props {
  items: PercakapanRingkas[];
  /** Penanda baca per perangkat: layananId -> ISO terakhir dibaca. */
  dibaca: Record<string, string | null>;
  onBuka: (p: PercakapanRingkas) => void;
  onBaru: () => void;
  memuat: boolean;
  galat: boolean;
  onCobaLagi: () => void;
}

const tanggalPendek = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function labelStatus(p: PercakapanRingkas): { teks: string; ikon: 'bot' | 'tunggu' | 'aktif' | 'selesai' } {
  if (!p.sesiTerbukaId) return { teks: 'Sesi selesai', ikon: 'selesai' };
  if (p.statusTerakhir === 'aktif') return { teks: 'Dilayani petugas', ikon: 'aktif' };
  if (p.statusTerakhir === 'eskalasi') return { teks: 'Menunggu petugas', ikon: 'tunggu' };
  return { teks: 'Asisten virtual', ikon: 'bot' };
}

export default function DaftarPercakapan({ items, dibaca, onBuka, onBaru, memuat, galat, onCobaLagi }: Props) {
  return (
    <section className={styles.daftar} aria-labelledby="judul-daftar-percakapan">
      <div className={styles.kepala}>
        <h2 id="judul-daftar-percakapan" className={styles.judul}>Percakapan Anda</h2>
        <button type="button" className="btn btn--primary btn--sm" onClick={onBaru}>
          <Plus size={14} aria-hidden="true" /> Percakapan baru
        </button>
      </div>
      <p className={styles.keterangan}>
        Satu percakapan untuk setiap layanan. Riwayat pesan Anda tersimpan dan dapat dibuka kembali kapan saja.
      </p>

      {galat && (
        <ErrorRetry
          judul="Daftar percakapan belum dapat dimuat"
          pesan="Periksa koneksi internet Anda lalu tekan Coba lagi."
          onRetry={onCobaLagi}
          memuat={memuat}
        />
      )}

      {memuat && items.length === 0 && !galat && (
        <p role="status" className={styles.memuat}>
          <Loader2 size={14} className="animate-pulse" aria-hidden="true" /> Memuat percakapan...
        </p>
      )}

      <ul className={styles.list} aria-label="Daftar percakapan">
        {items.map((p) => {
          const st = labelStatus(p);
          const baru = belumDibaca(p, dibaca[p.layananId] ?? null);
          return (
            <li key={p.layananId}>
              <button
                type="button"
                className={`${styles.item} ${baru ? styles.itemBaru : ''}`}
                onClick={() => onBuka(p)}
                aria-label={`Buka percakapan ${p.layananNama}${baru ? ', ada pesan baru' : ''}`}
              >
                <span className={styles.avatar} aria-hidden="true"><MessageSquare size={18} /></span>
                <span className={styles.isi}>
                  <span className={styles.baris1}>
                    <span className={styles.nama}>{p.layananNama}</span>
                    {p.lastPesanAt && <time className={styles.waktu} dateTime={p.lastPesanAt}>{tanggalPendek(p.lastPesanAt)}</time>}
                  </span>
                  <span className={styles.pratinjau}>
                    {p.lastPesan ? `${p.lastPengirim === 'pengunjung' ? 'Anda: ' : ''}${p.lastPesan}` : 'Belum ada pesan'}
                  </span>
                  <span className={styles.baris3}>
                    <span className={`${styles.status} ${styles[`status_${st.ikon}`]}`}>
                      {st.ikon === 'bot' && <Bot size={11} aria-hidden="true" />}
                      {st.ikon === 'selesai' && <CheckCircle2 size={11} aria-hidden="true" />}
                      {st.teks}
                    </span>
                    {baru && <span className={styles.titikBaru}>Belum dibaca</span>}
                    {!p.layananAktif || !p.punyaChat ? <span className={styles.status}>Hanya baca</span> : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
