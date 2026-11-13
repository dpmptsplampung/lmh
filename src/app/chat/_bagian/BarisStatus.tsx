'use client';

// Bilah status di atas percakapan: mode (bot / menunggu / terhubung / selesai atau hanya baca), catatan layanan di luar jam,
// dan spanduk offline. Hanya tampilan dari props.
import { AlertCircle, ArrowLeft, Bot, CheckCircle2, Loader2 } from 'lucide-react';
import Tombol from '@/components/ui/Tombol';
import { teksPetugasTidakTersedia, type StatusLayananChat } from '@/lib/chat/status-layanan';
import styles from '../chat.module.css';
import { petugasLabel } from '../merge';
import type { ModePercakapan } from '../_logika/mesinChat';
import { TEKS_OFFLINE } from '../_logika/turunan';

export interface BarisStatusProps {
  mode: ModePercakapan;
  /** Petugas sedang tidak tersedia (di luar jam / hari tanpa layanan). */
  tutup: boolean;
  botAktif: boolean;
  hanyaBaca: boolean;
  daring: boolean;
  sesiLayananNama?: string;
  statusLayanan: StatusLayananChat | null;
  onKembali: () => void;
  onMintaPetugas: () => void;
}

export default function BarisStatus({
  mode, tutup, botAktif, hanyaBaca, daring, sesiLayananNama, statusLayanan, onKembali, onMintaPetugas,
}: BarisStatusProps) {
  return (
    <>
      {/* Status Bar */}
      <div className={`${styles.statusBar} ${
        mode === 'bot'
          ? styles.statusBarBot
          : (mode === 'menunggu' || mode === 'menungguLuarJam' ? styles.statusBarEskalasi : styles.statusBarAktif)
      }`}>
        <Tombol varian="sekunder" ukuran="kecil" ikon={ArrowLeft} onClick={onKembali}>
          Daftar percakapan
        </Tombol>
        {mode === 'bot' && (
          <>
            <Bot size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>{tutup ? 'Mode Chatbot FAQ — petugas sedang tidak tersedia' : 'Mode Chatbot FAQ Aktif'}</span>
            <Tombol varian="sekunder" ukuran="kecil" className={styles.statusAksi} onClick={onMintaPetugas}>
              Hubungkan ke Petugas
            </Tombol>
          </>
        )}
        {mode === 'menungguLuarJam' && (
          <>
            <Bot size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>
              {botAktif
                ? 'Menunggu petugas — petugas akan menjawab pada jam kerja. Sementara itu asisten virtual tetap menjawab.'
                : 'Menunggu petugas — petugas akan menjawab pada jam kerja.'}
            </span>
          </>
        )}
        {mode === 'menunggu' && (
          <>
            <Loader2 size={14} className="animate-pulse" aria-hidden="true" />
            <span>Menghubungkan ke petugas operasional loket... Mohon tunggu.</span>
          </>
        )}
        {mode === 'petugas' && (
          <>
            <CheckCircle2 size={14} strokeWidth={1.75} className={styles.ikonSukses} aria-hidden="true" />
            <span>Terhubung langsung dengan {petugasLabel(sesiLayananNama)}</span>
          </>
        )}
        {(mode === 'hanyaBaca' || mode === 'selesai') && (
          <>
            <CheckCircle2 size={14} strokeWidth={1.75} className={styles.ikonSukses} aria-hidden="true" />
            <span>
              {hanyaBaca
                ? 'Layanan ini tidak lagi melayani chat — percakapan hanya dapat dibaca.'
                : 'Sesi sebelumnya sudah selesai. Kirim pesan untuk memulai sesi baru.'}
            </span>
          </>
        )}
      </div>

      {statusLayanan && !statusLayanan.buka && !hanyaBaca && (
        <div role="note" data-testid="chat-luar-jam" className={styles.hariTanpaLayananBar}>
          <AlertCircle size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{teksPetugasTidakTersedia(sesiLayananNama ?? 'layanan ini', statusLayanan, { tanpaBot: !botAktif })}</span>
        </div>
      )}

      {/* Offline Banner */}
      {!daring && (
        <div role="alert" className={styles.offlineBar}>
          <AlertCircle size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{TEKS_OFFLINE}</span>
        </div>
      )}
    </>
  );
}
