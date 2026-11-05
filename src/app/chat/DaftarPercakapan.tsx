'use client';

import { Bot, CheckCircle2, MessageSquare, Plus } from 'lucide-react';
import Galat from '@/components/ui/Galat';
import Lencana from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import Tombol from '@/components/ui/Tombol';
import { formatTanggalWaktu } from '@/lib/utils';
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

const tanggalPendek = (iso: string) => formatTanggalWaktu(iso);

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
        <Tombol ukuran="kecil" ikon={Plus} onClick={onBaru}>
          Percakapan baru
        </Tombol>
      </div>
      <p className={styles.keterangan}>
        Satu percakapan untuk setiap layanan. Riwayat pesan Anda tersimpan dan dapat dibuka kembali kapan saja.
      </p>

      {galat && (
        <Galat
          judul="Daftar percakapan belum dapat dimuat"
          pesan="Periksa koneksi internet Anda lalu tekan Coba lagi."
          onRetry={onCobaLagi}
          memuat={memuat}
        />
      )}

      {memuat && items.length === 0 && !galat && (
        <div role="status">
          <Skeleton bentuk="baris" jumlah={4} label="Memuat percakapan..." />
        </div>
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
                    {baru && <Lencana nada="primer">Belum dibaca</Lencana>}
                    {!p.layananAktif || !p.punyaChat ? <Lencana nada="netral">Hanya baca</Lencana> : null}
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
