// Panel percakapan sesi terpilih (refaktor G7, tugas 7.3): kepala + tombol aksi, catatan balasan, dan utas pesan. Hanya
// tampilan: izin, pesan, dan penangan datang lewat props (useDaftarSesi / usePesanSesi / useAksiChat); tanpa query.
import { Fragment, useRef } from 'react';
import { ArrowLeft, ArrowRight, MessageSquare, Sparkles, UserCheck, UserCog } from 'lucide-react';
import {
  ChatContainer,
  MainContainer,
  Message as ChatMessage,
  MessageInput,
  MessageList,
} from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import GambarLampiran from '@/components/chat/GambarLampiran';
import StatusKosong from '@/components/ui/StatusKosong';
import Tombol from '@/components/ui/Tombol';
import type { ChatMsg } from '@/app/chat/merge';
import { bersihkanPenutup } from '@/lib/chat/percakapan';
import { JENIS_PENUTUP_SURVEI } from '@/lib/chat-staf';
import type { RingkasSesi } from '@/lib/data/chat-staf';
import { formatTanggal, formatWaktu } from '@/lib/utils';
import { adaBanyakSesi, catatanBalas, type IzinSesi } from '../_logika/izinChat';
import type { JenisDialogChat } from '../_hook/useAksiChat';
import styles from '../chat.module.css';
import ui from '@/app/chat/chat-ui.module.css';

const ID_ALASAN_LIBUR = 'alasan-hari-tanpa-layanan';

const namaPengirim = (p: ChatMsg['pengirim']) => (p === 'petugas' ? 'Petugas' : p === 'bot' ? 'Bot FAQ' : 'Pengunjung');

export interface UtasChat {
  pesan: readonly ChatMsg[];
  adaLebih: boolean;
  memuatRiwayat: boolean;
  onMuatRiwayat: () => void;
  isian: string;
  onIsian: (nilai: string) => void;
  onKirim: (teks: string) => void;
  mengirim: boolean;
  galatKirim: string;
  mengirimFoto: boolean;
  onKirimFoto: (berkas: File | undefined) => void;
  memuatDraf: boolean;
  onDraf: () => void;
}

export interface PanelPercakapanProps {
  /** null = belum ada sesi terpilih. */
  sesi: RingkasSesi | null;
  izin: IzinSesi | null;
  namaPengunjung: string;
  namaLayanan: string;
  /** Nama pemegang sesi; null bila tidak ada. */
  pemegang: string | null;
  /** Alasan tombol ambil/teruskan nonaktif (Layanan tidak beroperasi hari ini); null = beroperasi. */
  alasanTanpaLayanan: string | null;
  /** Aksi sedang berjalan (Ambil). */
  sibuk: boolean;
  onAmbil: () => void;
  onBukaDialog: (jenis: JenisDialogChat) => void;
  onKembali: () => void;
  utas: UtasChat;
}

export default function PanelPercakapan({
  sesi, izin, namaPengunjung, namaLayanan, pemegang, alasanTanpaLayanan, sibuk, onAmbil, onBukaDialog, onKembali, utas,
}: PanelPercakapanProps) {
  const berkasRef = useRef<HTMLInputElement>(null);
  const tanpaLayanan = !!alasanTanpaLayanan;

  if (!sesi || !izin) {
    return (
      <section className={styles.thread} aria-label="Percakapan terpilih">
        <div className={styles.threadEmpty}><StatusKosong ikon={MessageSquare} judul="Pilih sesi chat di samping untuk mulai membalas" isi="Riwayat percakapan dan aksi penanganan tampil setelah sesi dipilih." /></div>
      </section>
    );
  }

  const selesai = sesi.status === 'selesai';
  const banyakSesi = adaBanyakSesi(utas.pesan);
  // Atribut tombol yang dinonaktifkan karena Layanan tidak beroperasi hari ini.
  const atributLibur = { title: alasanTanpaLayanan ?? undefined, 'aria-describedby': tanpaLayanan ? ID_ALASAN_LIBUR : undefined };

  return (
    <section className={styles.thread} aria-label="Percakapan terpilih">
      <div className={styles.threadHeader}>
        <div className={styles.threadIdentity}>
          <Tombol varian="sekunder" ukuran="kecil" ikon={ArrowLeft} className={styles.backBtn} onClick={onKembali}>Daftar sesi</Tombol>
          <h2>{namaPengunjung}</h2>
          <p>
            Layanan: {namaLayanan}
            {sesi.status === 'aktif' && <> · Ditangani oleh {izin.pemilik ? 'Anda' : pemegang ?? '—'}</>}
            {sesi.status === 'eskalasi' && <> · {izin.menungguLayanan ? 'Diteruskan, menunggu petugas layanan' : 'Menunggu diambil'}</>}
          </p>
        </div>
        {!selesai && (
          <div className={styles.threadActions}>
            {izin.bolehAmbil && (
              <Tombol ukuran="kecil" ikon={UserCheck} onClick={onAmbil} disabled={sibuk || tanpaLayanan} memuat={sibuk} {...atributLibur}>Ambil Chat</Tombol>
            )}
            {izin.bolehAmbilAlih && (
              <Tombol ukuran="kecil" ikon={UserCog} onClick={() => onBukaDialog('ambilAlih')} disabled={sibuk || tanpaLayanan} {...atributLibur}>Ambil Alih Chat</Tombol>
            )}
            {izin.bolehTeruskan && (
              <Tombol varian="sekunder" ukuran="kecil" ikon={ArrowRight} onClick={() => onBukaDialog('teruskan')} disabled={sibuk || tanpaLayanan} {...atributLibur}>Teruskan ke Layanan</Tombol>
            )}
            {izin.pemilik && <Tombol varian="sekunder" ukuran="kecil" onClick={() => onBukaDialog('selesai')} disabled={sibuk}>Selesaikan Chat</Tombol>}
          </div>
        )}
      </div>
      {!selesai ? (
        <div className={styles.replyTools}>
          {!izin.bolehBalas && (
            <p role="status" className={styles.replyNote}>{catatanBalas(izin, pemegang, alasanTanpaLayanan)}</p>
          )}
          {utas.galatKirim && <p role="alert" className={styles.sendError}>{utas.galatKirim}</p>}
          <div className={styles.draftTools}>
            <Tombol varian="sekunder" ukuran="kecil" ikon={Sparkles} onClick={utas.onDraf} disabled={utas.memuatDraf || !izin.bolehBalas} memuat={utas.memuatDraf} title="Minta Gemini memuatkan draf balasan berbasis FAQ & Dasar Hukum">Draf Gemini</Tombol>
          </div>
        </div>
      ) : <p className={styles.closedNote}>Sesi chat ini sudah selesai.</p>}
      <div className={ui.shell}>
        <MainContainer responsive>
          <ChatContainer>
            <MessageList>
              {utas.adaLebih && (
                <div className={styles.history}>
                  <Tombol varian="sekunder" ukuran="kecil" onClick={utas.onMuatRiwayat} disabled={utas.memuatRiwayat} memuat={utas.memuatRiwayat}>Muat riwayat sebelumnya</Tombol>
                </div>
              )}
              {utas.pesan.map((msg, i) => {
                const sebelumnya = utas.pesan[i - 1];
                const pembatas = banyakSesi && msg.sesi_id && (!sebelumnya || sebelumnya.sesi_id !== msg.sesi_id);
                const waktu = `${formatWaktu(msg.created_at)} WIB`;
                return (
                  <Fragment key={msg.client_uuid ?? msg.id}>
                    {pembatas && <div role="separator" aria-label={`Sesi ${formatTanggal(msg.created_at)}`} className={styles.sessionDivider}>Sesi {formatTanggal(msg.created_at)}</div>}
                    <ChatMessage model={{
                      message: msg.jenis_jawaban === JENIS_PENUTUP_SURVEI ? bersihkanPenutup(msg.isi) : msg.isi,
                      sentTime: waktu,
                      sender: namaPengirim(msg.pengirim),
                      direction: msg.pengirim === 'petugas' ? 'outgoing' : 'incoming',
                      position: 'single',
                    }}>
                      <ChatMessage.Header sender={namaPengirim(msg.pengirim)} sentTime={waktu} />
                      {msg.lampiran_kunci && <ChatMessage.CustomContent><GambarLampiran pesanId={msg.id} nama={msg.lampiran_nama} /></ChatMessage.CustomContent>}
                    </ChatMessage>
                  </Fragment>
                );
              })}
            </MessageList>
            <input ref={berkasRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { utas.onKirimFoto(e.target.files?.[0]); e.target.value = ''; }} />
            {/* MessageInput harus anak langsung ChatContainer agar alur kirim dan lampiran tetap bekerja. */}
            {!selesai && (
              <MessageInput placeholder={izin.bolehBalas ? 'Ketik balasan Anda...' : 'Ambil chat untuk membalas'} value={utas.isian} onChange={(val) => utas.onIsian(val)} onSend={(_html, _text, innerText) => utas.onKirim(innerText)} attachButton={izin.bolehBalas} onAttachClick={() => berkasRef.current?.click()} disabled={!izin.bolehBalas || utas.mengirim || utas.mengirimFoto} />
            )}
          </ChatContainer>
        </MainContainer>
      </div>
    </section>
  );
}
