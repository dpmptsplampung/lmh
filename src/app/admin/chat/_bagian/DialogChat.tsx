// Dialog aksi chat (refaktor G7, tugas 7.3): satu pintu untuk tiga dialog dari satu union `JenisDialogChat`. Isi dan perilaku
// dialog tetap di components/admin/ChatAksiDialog (cangkangnya sudah berupa KerangkaModal); di sini hanya memilih dan
// mengoper data. Tanpa query.
import {
  ChatAmbilAlihDialog,
  ChatSelesaiDialog,
  ChatTeruskanDialog,
  type LayananChatOpsi,
} from '@/components/admin/ChatAksiDialog';
import type { HasilChatAmbil, HasilChatSelesai, HasilChatTeruskan, PeranTahapChat } from '@/lib/chat-staf';
import type { TopikFo } from '@/lib/fo-penanganan';
import type { RingkasSesi } from '@/lib/data/chat-staf';
import type { JenisDialogChat } from '../_hook/useAksiChat';

export interface PenanganDialogChat {
  ambilAlihBerhasil: (hasil: HasilChatAmbil) => void;
  teruskanBerhasil: (hasil: HasilChatTeruskan) => void;
  selesaiBerhasil: (hasil: HasilChatSelesai) => void;
  galat: (err: unknown) => void;
}

export interface DialogChatProps {
  jenis: JenisDialogChat | null;
  /** Sesi terpilih; tanpa sesi tidak ada dialog. */
  sesi: RingkasSesi | null;
  namaPengunjung: string;
  /** Pemegang saat ini bila diketahui. */
  pemegang: string | null;
  layananChat: LayananChatOpsi[];
  topikFo: TopikFo[];
  /** Peran tahap milik pemilik (menentukan isian dialog Selesaikan). */
  peranPemilik: PeranTahapChat;
  /** Layanan tahap terbuka (null = pakai Layanan sesi). */
  layananTahapId: string | null;
  onTutup: () => void;
  penangan: PenanganDialogChat;
}

export default function DialogChat({
  jenis, sesi, namaPengunjung, pemegang, layananChat, topikFo, peranPemilik, layananTahapId, onTutup, penangan,
}: DialogChatProps) {
  if (!sesi || !jenis) return null;
  if (jenis === 'ambilAlih') {
    return (
      <ChatAmbilAlihDialog
        sesiId={sesi.id}
        namaPengunjung={namaPengunjung}
        pemegang={pemegang}
        onClose={onTutup}
        onBerhasil={penangan.ambilAlihBerhasil}
        onGalat={penangan.galat}
      />
    );
  }
  if (jenis === 'teruskan') {
    return (
      <ChatTeruskanDialog
        sesiId={sesi.id}
        namaPengunjung={namaPengunjung}
        layanan={layananChat}
        layananSaranId={sesi.layanan_id}
        topikFo={topikFo}
        onClose={onTutup}
        onBerhasil={penangan.teruskanBerhasil}
        onGalat={penangan.galat}
      />
    );
  }
  return (
    <ChatSelesaiDialog
      sesiId={sesi.id}
      namaPengunjung={namaPengunjung}
      peran={peranPemilik}
      layananId={layananTahapId ?? sesi.layanan_id}
      topikFo={topikFo}
      onClose={onTutup}
      onBerhasil={penangan.selesaiBerhasil}
      onGalat={penangan.galat}
    />
  );
}
