'use client';

// Jendela percakapan: bilah status, daftar pesan (riwayat lintas sesi + sesi berjalan + FAQ Cepat), dan kotak ketik.
// Hanya tampilan dari props: semua aksi (kirim, kirim ulang, muat riwayat, minta petugas) adalah callback dari ChatKlien.
//
// MessageList dan MessageInput harus langsung menjadi anak ChatContainer (chatscope memilih anak menurut tipe elemen).
import { ChatContainer, MainContainer, MessageList, TypingIndicator } from '@chatscope/chat-ui-kit-react';
import Galat from '@/components/ui/Galat';
import Tombol from '@/components/ui/Tombol';
import type { FaqChat } from '@/lib/data/chat-pengunjung';
import styles from '../chat.module.css';
import ui from '../chat-ui.module.css';
import type { ChatMsg } from '../merge';
import BarisStatus, { type BarisStatusProps } from './BarisStatus';
import FaqCepat from './FaqCepat';
import { elemenMasukanPesan, InputFoto } from './FormPesan';
import GelembungPesan from './GelembungPesan';
import { PII_DISCLAIMER } from './teks';

export interface JendelaPercakapanProps {
  status: BarisStatusProps;
  daftarPesan: readonly ChatMsg[];
  idTerkirim?: string;
  /** Bot FAQ sedang menyusun jawaban. */
  mengetik: boolean;
  riwayat: {
    galat: 'awal' | 'lama' | null;
    memuat: boolean;
    adaLebih: boolean;
    onCobaLagi: () => void;
    onMuatLebihLama: () => void;
  };
  faq: {
    aktif: boolean;
    galat: boolean;
    memuat: boolean;
    daftar: readonly FaqChat[];
    onCobaLagi: () => void;
    onPilih: (pertanyaan: string) => void;
  };
  masukan: {
    placeholder: string;
    nonaktif: boolean;
    onKirim: (teks: string) => void;
    onKirimFoto: (berkas: File | undefined) => void;
  };
  onKirimUlang: (pesan: ChatMsg) => void;
}

export default function JendelaPercakapan({
  status, daftarPesan, idTerkirim, mengetik, riwayat, faq, masukan, onKirimUlang,
}: JendelaPercakapanProps) {
  return (
    <>
      <BarisStatus {...status} />

      {/* Chatscope UI Container */}
      <div className={ui.shell}>
        <MainContainer responsive>
          <ChatContainer>
            <MessageList typingIndicator={mengetik ? <TypingIndicator content="Bot FAQ sedang mengetik…" /> : undefined}>
              <div className={styles.catatanPii}>{PII_DISCLAIMER}</div>
              {riwayat.galat && (
                <Galat
                  pesan={
                    riwayat.galat === 'awal'
                      ? 'Riwayat percakapan belum dapat dimuat. Pesan lama mungkin belum tampil.'
                      : 'Pesan sebelumnya belum dapat dimuat.'
                  }
                  onRetry={riwayat.onCobaLagi}
                  memuat={riwayat.memuat}
                />
              )}
              {riwayat.adaLebih && (
                <div className={styles.muatLebih}>
                  <Tombol varian="sekunder" ukuran="kecil" onClick={riwayat.onMuatLebihLama} disabled={riwayat.memuat}>
                    {riwayat.memuat ? 'Memuat...' : 'Muat pesan sebelumnya'}
                  </Tombol>
                </div>
              )}
              {daftarPesan.map((msg) => (
                // client_uuid stabil dari optimistic -> pesan server: tidak remount/berkedip.
                <GelembungPesan
                  key={msg.client_uuid ?? msg.id}
                  pesan={msg}
                  sesiLayananNama={status.sesiLayananNama}
                  idTerkirim={idTerkirim}
                  onKirimUlang={onKirimUlang}
                />
              ))}
              <FaqCepat {...faq} />
            </MessageList>

            {elemenMasukanPesan({
              placeholder: masukan.placeholder,
              nonaktif: masukan.nonaktif,
              onKirim: masukan.onKirim,
            })}
          </ChatContainer>
        </MainContainer>
        <InputFoto onPilih={masukan.onKirimFoto} />
      </div>
    </>
  );
}
