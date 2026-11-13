'use client';

// Satu gelembung pesan di MessageList: pesan penutup sesi (catatan), atau pesan biasa dengan lampiran foto dan status kirim.
import { Message as ChatMessage } from '@chatscope/chat-ui-kit-react';
import Tombol from '@/components/ui/Tombol';
import GambarLampiran from '@/components/chat/GambarLampiran';
import { JENIS_PENUTUP_SURVEI } from '@/lib/chat-staf';
import { bersihkanPenutup } from '@/lib/chat/percakapan';
import styles from '../chat.module.css';
import ui from '../chat-ui.module.css';
import { senderLabel, waktuLabel, type ChatMsg } from '../merge';

export interface GelembungPesanProps {
  pesan: ChatMsg;
  sesiLayananNama?: string;
  /** Id pesan pengunjung terakhir yang sudah tersimpan (status "Terkirim"). */
  idTerkirim?: string;
  onKirimUlang: (pesan: ChatMsg) => void;
}

export default function GelembungPesan({ pesan: msg, sesiLayananNama, idTerkirim, onKirimUlang }: GelembungPesanProps) {
  if (msg.jenis_jawaban === JENIS_PENUTUP_SURVEI) {
    // Pesan penutup sesi dari RPC chat_selesai / tutup otomatis (Q24: tanpa kalimat survei).
    return (
      <div role="note" className={styles.penutupSurvei} data-testid="penutup-sesi">
        <span className={styles.penutupSurveiJudul}>Sesi selesai</span>
        {bersihkanPenutup(msg.isi)}
      </div>
    );
  }
  return (
    <ChatMessage
      model={{
        message: msg.isi,
        sentTime: waktuLabel(msg.created_at),
        sender: senderLabel(msg.pengirim, sesiLayananNama),
        direction: msg.pengirim === 'pengunjung' ? 'outgoing' : 'incoming',
        position: 'single',
      }}
    >
      <ChatMessage.Header sender={senderLabel(msg.pengirim, sesiLayananNama)} sentTime={waktuLabel(msg.created_at)} />
      {msg.lampiran_kunci && (
        <ChatMessage.CustomContent><GambarLampiran pesanId={msg.id} nama={msg.lampiran_nama} /></ChatMessage.CustomContent>
      )}
      {msg.local === 'pending' && (
        <ChatMessage.Footer><span className={ui.msgStatus} role="status">Mengirim…</span></ChatMessage.Footer>
      )}
      {!msg.local && msg.id === idTerkirim && (
        <ChatMessage.Footer><span className={ui.msgStatus}>Terkirim</span></ChatMessage.Footer>
      )}
      {msg.local === 'failed' && (
        <ChatMessage.Footer>
          <span className={ui.msgStatusFailed}>Gagal terkirim. </span>
          <Tombol varian="sekunder" ukuran="kecil" onClick={() => onKirimUlang(msg)}>
            Kirim ulang
          </Tombol>
        </ChatMessage.Footer>
      )}
    </ChatMessage>
  );
}
