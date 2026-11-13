// Panel lipat Pengaturan bot pada Kelola FAQ (refaktor G8, tugas 8.2): hanya tampilan; data dan aksi datang lewat props.
// Bot hidup/mati dan pemrosesan massal = Admin saja (dijaga juga di handler hook); petugas hanya melihat status.
import { Sparkles } from 'lucide-react';
import Tombol from '@/components/ui/Tombol';
import CobaTanyaBot from '@/components/admin/settings/CobaTanyaBot';
import type { LayananFaq } from '@/lib/data/faq';
import type { OpsiFaqLayanan } from '@/lib/faq-scope';
import styles from '../faq.module.css';

export interface PanelBotFaqProps {
  isAdmin: boolean;
  /** Layanan sungguhan yang boleh diatur (tanpa FAQ umum). */
  opsiBot: ReadonlyArray<OpsiFaqLayanan & { id: string }>;
  botLayananId: string | null;
  botLayanan: LayananFaq | undefined;
  onPilihBot: (id: string) => void;
  sedangAlihBot: boolean;
  onAlihBot: (id: string, aktifSekarang: boolean) => void;
  jumlahMenunggu: number;
  daftarMemuat: boolean;
  prosesMassal: boolean;
  onProsesSemua: () => void;
}

export default function PanelBotFaq({
  isAdmin, opsiBot, botLayananId, botLayanan, onPilihBot, sedangAlihBot, onAlihBot,
  jumlahMenunggu, daftarMemuat, prosesMassal, onProsesSemua,
}: PanelBotFaqProps) {
  return (
    <details className={`${styles.kartu} ${styles.panelBot}`}>
      <summary>Pengaturan bot</summary>
      <div className={styles.panelBotIsi}>
        {isAdmin && opsiBot.length > 1 && (
          <div className={`form-group ${styles.pilihLayananBot}`}>
            <label className="form-label" htmlFor="botLayanan">Layanan</label>
            <select
              id="botLayanan"
              className="form-select"
              value={botLayananId ?? ''}
              onChange={(e) => onPilihBot(e.target.value)}
            >
              {opsiBot.map((o) => (
                <option key={o.id} value={o.id}>{o.nama}</option>
              ))}
            </select>
          </div>
        )}
        {botLayanan && (
          <div className={styles.barisBot}>
            <span className={styles.labelBot}>Bot {botLayanan.nama}</span>
            {isAdmin ? (
              <Tombol
                varian={botLayanan.chatbot_aktif ? 'utama' : 'sekunder'}
                ukuran="kecil"
                onClick={() => onAlihBot(botLayanan.id, botLayanan.chatbot_aktif)}
                memuat={sedangAlihBot}
                aria-label={`Bot ${botLayanan.nama}: ${botLayanan.chatbot_aktif ? 'Aktif' : 'Nonaktif'}. Klik untuk mengubah.`}
              >
                {botLayanan.chatbot_aktif ? 'Aktif' : 'Nonaktif'}
              </Tombol>
            ) : (
              <span
                className={`badge ${botLayanan.chatbot_aktif ? 'badge--selesai' : 'badge--nonaktif'}`}
                data-testid="bot-status"
              >
                {botLayanan.chatbot_aktif ? 'Aktif' : 'Nonaktif'}
              </span>
            )}
          </div>
        )}
        {!isAdmin && (
          <p role="note" className={styles.keteranganBot}>
            Pengaturan bot dikelola Admin. Untuk menangani satu percakapan gunakan tombol Ambil alih di Live Chat.
          </p>
        )}
        <p className={styles.keteranganBot}>
          Bot Aktif: pesan pengunjung di layanan ini dijawab bot. Bot Nonaktif: chat langsung diteruskan ke petugas loket.
        </p>
        {isAdmin && (
          <div className={styles.barisBot}>
            <span className={styles.labelBot}>
              {jumlahMenunggu > 0
                ? `${jumlahMenunggu} FAQ menunggu diproses bot.`
                : 'Semua FAQ sudah diproses bot.'}
            </span>
            <Tombol
              varian="sekunder"
              ukuran="kecil"
              ikon={Sparkles}
              onClick={onProsesSemua}
              disabled={daftarMemuat}
              memuat={prosesMassal}
            >
              {prosesMassal ? 'Memproses…' : 'Proses sekarang'}
            </Tombol>
          </div>
        )}
        {botLayanan && <CobaTanyaBot layananId={botLayanan.id} layananNama={botLayanan.nama} />}
      </div>
    </details>
  );
}
