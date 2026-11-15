'use client';

// Aksi staf atas sesi chat terpilih (rencana refaktor 2026-11-11 tugas 7.2): Ambil (tanpa dialog), dialog Ambil Alih /
// Teruskan / Selesaikan (isi dialog di components/admin/ChatAksiDialog), peringatan setelah meneruskan, dan penilaian
// "hari tanpa pelayanan" Layanan sesi terpilih. Aksi memanggil `kirimAksiChat` (POST /api/chat/sesi -> RPC chat_*); hook ini
// hanya memutuskan toast, muat ulang, dan pengalihan login. Hak akses ditegakkan RPC/RLS; tombol di UI hanya cermin.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { urlLoginAlasan } from '@/lib/sesi-staf';
import {
  GalatAksiChat,
  kirimAksiChat,
  kodeChatPerluMuatUlang,
  type HasilChatAmbil,
  type HasilChatSelesai,
  type HasilChatTeruskan,
} from '@/lib/chat-staf';
import { muatStatusLayananChat, type StatusLayananChat } from '@/lib/chat/status-layanan';
import { peringatanTeruskan } from '../_logika/izinChat';

type Toast = (pesan: string, jenis?: 'success' | 'error' | 'warning' | 'info') => void;

/** Dialog aksi yang sedang terbuka untuk sesi terpilih. */
export type JenisDialogChat = 'ambilAlih' | 'teruskan' | 'selesai';

export interface OpsiAksiChat {
  sesiId: string | null;
  /** Layanan sesi terpilih (untuk penilaian hari tanpa pelayanan). */
  layananId: string | null;
  toast: Toast;
  muatDaftar: () => void | Promise<void>;
  muatPesan: () => void | Promise<void>;
}

export function useAksiChat({ sesiId, layananId, toast, muatDaftar, muatPesan }: OpsiAksiChat) {
  const router = useRouter();
  const [dialog, setDialog] = useState<JenisDialogChat | null>(null);
  const [sibuk, setSibuk] = useState(false);
  // Peringatan setelah meneruskan chat ke layanan yang belum ada petugas hadir (bukan galat; kontrak §2.2).
  const [peringatan, setPeringatan] = useState<string | null>(null);
  const [statusStaf, setStatusStaf] = useState<{ layananId: string; status: StatusLayananChat } | null>(null);
  const kunciRef = useRef(false);
  const terbaruRef = useRef({ toast, muatDaftar, muatPesan });
  useEffect(() => {
    terbaruRef.current = { toast, muatDaftar, muatPesan };
  });

  // Layanan sesi terpilih tidak beroperasi hari ini: chat tidak dapat diambil, diambil alih, atau diteruskan (DB menolak
  // HARI_TANPA_LAYANAN). Gagal menilai = tombol tetap aktif; DB tetap penegak.
  useEffect(() => {
    if (!layananId) return;
    let batal = false;
    Promise.resolve()
      .then(() => muatStatusLayananChat(createClient(), layananId))
      .then((status) => {
        if (!batal) setStatusStaf({ layananId, status });
      })
      .catch(() => {
        /* gagal menilai: tombol tetap aktif */
      });
    return () => {
      batal = true;
    };
  }, [layananId]);
  const statusLayanan = statusStaf && statusStaf.layananId === layananId ? statusStaf.status : null;
  const tanpaLayanan = !!statusLayanan?.hariTanpaLayanan;

  const segarkan = () => {
    void terbaruRef.current.muatDaftar();
    void terbaruRef.current.muatPesan();
  };

  // Galat yang berarti sesi staf tidak sah -> login; tampilan basi -> muat ulang daftar & utas.
  const tanganiGalat = (err: unknown) => {
    if (!(err instanceof GalatAksiChat)) return;
    if (err.kode === 'SESI_TIDAK_SAH') {
      toast(err.pesan, 'error');
      router.replace(urlLoginAlasan('tidak_terdaftar'));
      return;
    }
    if (kodeChatPerluMuatUlang(err.kode)) segarkan();
  };

  // Ambil (tanpa dialog): FO / petugas / Admin atas chat yang menunggu atau masih dengan bot. chat_ambil atomik di DB:
  // yang kalah balapan menerima SUDAH_DIAMBIL (pesan ramah, daftar disegarkan).
  const ambil = async () => {
    if (!sesiId || kunciRef.current) return;
    kunciRef.current = true;
    setSibuk(true);
    try {
      const hasil = await kirimAksiChat<HasilChatAmbil>({ sesi_id: sesiId, aksi: 'takeover' });
      toast(hasil.sudah_milik_anda ? 'Chat ini sudah Anda pegang.' : 'Chat diambil. Silakan balas pengunjung.', 'success');
    } catch (err) {
      const kode = err instanceof GalatAksiChat ? err.kode : null;
      toast(err instanceof GalatAksiChat ? err.pesan : 'Gagal mengambil chat', kode === 'SUDAH_DIAMBIL' ? 'info' : 'error');
      tanganiGalat(err);
    } finally {
      kunciRef.current = false;
      setSibuk(false);
      segarkan();
    }
  };

  const tutupDialog = () => setDialog(null);

  const penangan = {
    ambilAlihBerhasil: (_hasil: HasilChatAmbil) => {
      toast('Chat diambil alih. Silakan balas pengunjung.', 'success');
      tutupDialog();
      segarkan();
    },
    teruskanBerhasil: (hasil: HasilChatTeruskan) => {
      toast(`Chat diteruskan ke ${hasil.layanan_nama}.`, 'success');
      setPeringatan(peringatanTeruskan(hasil));
      tutupDialog();
      segarkan();
    },
    selesaiBerhasil: (_hasil: HasilChatSelesai) => {
      toast('Sesi chat diselesaikan.', 'success');
      tutupDialog();
      segarkan();
    },
    galat: tanganiGalat,
  };

  return {
    dialog, bukaDialog: setDialog, tutupDialog, sibuk, ambil, penangan,
    peringatan, tutupPeringatan: () => setPeringatan(null), statusLayanan, tanpaLayanan,
  };
}
