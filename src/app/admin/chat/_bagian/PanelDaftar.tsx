// Panel daftar sesi chat (refaktor G7, tugas 7.3): hanya tampilan. Data, pilihan sesi, dan filter "selesai" datang dari
// useDaftarSesi lewat props; tanpa query.
import { MessageSquare, Wifi, WifiOff } from 'lucide-react';
import Galat from '@/components/ui/Galat';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import type { RtState } from '@/app/chat/merge';
import type { RingkasSesi, StatusSesiStaf } from '@/lib/data/chat-staf';
import { formatTanggal, formatWaktu, relativeTime, truncate } from '@/lib/utils';
import { belumDibaca, hitungSesi, urutkanSesi } from '../_logika/izinChat';
import styles from '../chat.module.css';

const NADA_STATUS: Record<StatusSesiStaf, NadaLencana> = { bot: 'netral', eskalasi: 'peringatan', aktif: 'primer', selesai: 'sukses' };

export interface PanelDaftarProps {
  sesi: readonly RingkasSesi[];
  terpilihId: string | null;
  /** Muat awal masih berjalan. */
  memuat: boolean;
  /** Daftar sudah pernah dimuat (berhasil atau gagal). */
  dimuat: boolean;
  galat: string;
  onMuatUlang: () => void;
  rt: RtState;
  tampilSelesai: boolean;
  onTampilSelesai: (nilai: boolean) => void;
  /** id sesi -> waktu pesan terakhir saat dibuka. */
  dibuka: Readonly<Record<string, string | null>>;
  layananNama: Readonly<Record<string, string>>;
  kontak: Readonly<Record<string, string>>;
  /** Label status siap tampil (memperhitungkan tahap penanganan). */
  labelStatus: (s: RingkasSesi) => string;
  /** Nama pemegang sesi; null bila tidak ada. */
  pemegang: (s: RingkasSesi) => string | null;
  onPilih: (s: RingkasSesi) => void;
}

export default function PanelDaftar({
  sesi, terpilihId, memuat, dimuat, galat, onMuatUlang, rt, tampilSelesai, onTampilSelesai,
  dibuka, layananNama, kontak, labelStatus, pemegang, onPilih,
}: PanelDaftarProps) {
  const { aktif, menunggu } = hitungSesi(sesi);
  return (
    <section className={styles.list} aria-label="Daftar sesi chat">
      <div className={styles.listHeader}>
        <div className={styles.listTitle}>
          <h2>Sesi Chat</h2>
          <span role="status" title={rt === 'ok' ? 'Realtime tersambung' : 'Realtime belum tersambung, memakai pembaruan berkala'}>
            <Lencana nada={rt === 'ok' ? 'sukses' : rt === 'connecting' ? 'netral' : 'bahaya'} ikon={rt === 'ok' ? Wifi : WifiOff}>
              {rt === 'ok' ? 'Langsung' : rt === 'connecting' ? 'Menyambung…' : 'Terputus'}
            </Lencana>
          </span>
        </div>
        {dimuat && !galat && (
          <p className={styles.listSummary}>{aktif} aktif{menunggu > 0 ? `, ${menunggu} menunggu diambil` : ''}</p>
        )}
        {rt !== 'ok' && <p className={styles.listSummary}>Pembaruan berkala saat realtime belum tersambung.</p>}
        <label className={styles.showClosed}>
          <input type="checkbox" checked={tampilSelesai} onChange={(e) => onTampilSelesai(e.target.checked)} />
          Tampilkan sesi selesai
        </label>
      </div>
      <div className={styles.sessions}>
        {galat ? (
          <Galat pesan={galat} onRetry={onMuatUlang} />
        ) : memuat || !dimuat ? (
          <div className={styles.listState} role="status"><Skeleton bentuk="baris" jumlah={5} label="Memuat sesi chat…" /></div>
        ) : sesi.length === 0 ? (
          <StatusKosong ikon={MessageSquare} judul="Belum ada sesi chat" isi="Percakapan pengunjung akan tampil di sini." />
        ) : urutkanSesi(sesi).map((session) => {
          const unread = belumDibaca(session, terpilihId, dibuka);
          const holder = session.status === 'aktif' ? pemegang(session) : null;
          const waktu = session.last_pesan_at ?? session.created_at;
          return (
            <button
              type="button"
              key={session.id}
              onClick={() => onPilih(session)}
              className={styles.session}
              aria-pressed={terpilihId === session.id}
            >
              <span className={styles.sessionTop}>
                <span className={styles.sessionService}>{layananNama[session.layanan_id] || 'Layanan'}</span>
                <Lencana nada={NADA_STATUS[session.status]}>{labelStatus(session)}</Lencana>
              </span>
              {session.last_pesan && <span className={styles.preview}>{truncate(session.last_pesan, 40)}</span>}
              <span className={styles.sessionMeta}>
                <span>{holder ? `Ditangani: ${holder}` : kontak[session.id] || 'Pengunjung'}</span>
                <span className={styles.sessionTime}>
                  {unread && <span className={styles.unread} aria-label="Pesan belum dibalas" />}
                  <time dateTime={waktu} title={`${formatTanggal(waktu)} ${formatWaktu(waktu)} WIB`}>
                    {relativeTime(waktu)}
                  </time>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
