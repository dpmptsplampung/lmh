'use client';

// Sesi chat pengunjung (rencana refaktor 2026-11-11 tugas 6.3): membuka percakapan yang sudah ada, meninggalkannya, dan
// memulai percakapan BARU (persetujuan PDP dicatat lebih dulu, baru `chat_sesi` dibuat), serta memastikan ada sesi
// terbuka saat pesan dikirim ke percakapan yang sesi terakhirnya sudah selesai. I/O lewat lib/data/chat-pengunjung.ts.
//
// Persetujuan: halaman yang memegang kotak centang dan isi barisnya (teks + versi kebijakan yang ditampilkan); hook ini
// menerima baris itu (null = belum dicentang), mengisi `subjek_ref` dari pengunjung/auth, dan mencatatnya. S1/K11: gagal
// mencatat (ditolak RLS, database, jaringan) atau akun tak dikenali = sesi TIDAK dibuat dan pengunjung bisa mengulang.
import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { pesanMutasi } from '@/lib/supabase/mutate';
import { tulisDibaca, type PercakapanRingkas } from '@/lib/chat/percakapan';
import {
  ambilPenggunaChat,
  buatSesiChat,
  catatPersetujuan,
  type BarisPersetujuan,
  type HasilChat,
  type LayananChat,
} from '@/lib/data/chat-pengunjung';
import { TEKS_OFFLINE, cariLayananDariParam, keputusanAwal, pesanSambutan } from '../_logika/turunan';
import type { MesinChat } from './useMesinChat';
import type { PesanChat } from './usePesan';

const PESAN_CONSENT_GAGAL = 'Sesi chat belum dimulai karena persetujuan Anda belum tersimpan. Silakan coba lagi.';
const PESAN_CONSENT_JARINGAN = `${PESAN_CONSENT_GAGAL} Periksa juga koneksi internet Anda.`;
const PESAN_AKUN_TAK_DIKENALI =
  'Akun Anda tidak dapat dikenali, sehingga persetujuan belum tercatat dan sesi chat belum dimulai. Muat ulang halaman lalu coba lagi.';
// Offline jujur: sesi palsu TIDAK dibuat; penyebab dibedakan (jaringan / ditolak / database) lewat MutasiError.
const pesanGagalMulai = (asli: unknown) => `Gagal memulai sesi chat. ${pesanMutasi(asli, 'Silakan coba lagi beberapa saat.')}`;

/** Parameter ?layanan= mentah (id atau nama) dari URL; null di server. */
export const bacaParamLayanan = (): string | null =>
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('layanan');

/** Isi baris persetujuan dari halaman; `subjek_ref` diisi hook. */
export type PersetujuanChat = Omit<BarisPersetujuan, 'subjek_ref'>;

interface Opsi {
  mesin: MesinChat;
  pesan: Pick<PesanChat, 'ganti' | 'muatRiwayatAwal' | 'tinggalkan'>;
  layanan: readonly LayananChat[];
  muatFaq: (layananId: string) => Promise<void>;
  pengunjungId: string | null;
  namaPengunjung: string;
  daring: boolean;
  /** Percakapan yang ada dibuka: persetujuannya sudah tercatat saat percakapan pertama (K12). */
  onPercakapanDibuka: () => void;
}

const sekarang = () => new Date().toISOString();

export function useSesiChat({ mesin, pesan, layanan, muatFaq, pengunjungId, namaPengunjung, daring, onPercakapanDibuka }: Opsi) {
  const { keadaan, ref: mesinRef, kirim } = mesin;
  const { layananId } = keadaan;

  // Layanan dari ?layanan= dipilih lebih dulu di formulir percakapan baru.
  useEffect(() => {
    if (layanan.length === 0) return;
    const ketemu = cariLayananDariParam(layanan, bacaParamLayanan());
    if (ketemu) setTimeout(() => kirim({ jenis: 'pilihLayanan', layananId: ketemu.id }), 0);
  }, [layanan, kirim]);

  const bukaPercakapan = (p: PercakapanRingkas) => {
    kirim({ jenis: 'buka', percakapan: p }); // R4: generasi naik, sinkronisasi percakapan sebelumnya dibuang
    onPercakapanDibuka();
    pesan.ganti([]);
    tulisDibaca(p.layananId, sekarang());
    void muatFaq(p.layananId);
    void pesan.muatRiwayatAwal(p);
  };

  /** Tampilan pertama setelah daftar percakapan dimuat (null = daftar gagal dimuat). */
  const putuskanAwal = (items: PercakapanRingkas[] | null) => {
    const k = keputusanAwal(items, cariLayananDariParam(layanan, bacaParamLayanan()));
    if ('buka' in k) bukaPercakapan(k.buka);
    else kirim({ jenis: 'tampilkan', tampilan: k.tampilan });
  };

  /** Percakapan ditinggalkan: riwayat yang masih berjalan dibatalkan (C2-07, R4) dan penanda dibaca diperbarui. */
  const kembali = () => {
    pesan.tinggalkan();
    kirim({ jenis: 'kembali' });
    if (layananId) tulisDibaca(layananId, sekarang());
  };

  /**
   * Mulai percakapan BARU dengan Layanan terpilih: (1) catat persetujuan, (2) baru buat chat_sesi. Dipanggil dari submit
   * formulir dan dari "Coba lagi" pada galat persetujuan. Percakapan yang sudah ada (`ada`) dibuka tanpa persetujuan baru.
   */
  const mulaiSesi = async (p: { persetujuan: PersetujuanChat | null; ada: PercakapanRingkas | undefined }) => {
    if (!layananId) return;
    if (!daring) {
      kirim({ jenis: 'galatSetup', pesan: TEKS_OFFLINE });
      return;
    }
    if (p.ada) {
      bukaPercakapan(p.ada);
      return;
    }
    if (!p.persetujuan) return;

    kirim({ jenis: 'mulai' });
    const nama = namaPengunjung.trim() || 'Pengunjung';
    const terpilih = layanan.find((l) => l.id === layananId);
    try {
      const sb = createClient();
      const pengguna = await ambilPenggunaChat(sb);
      if (pengguna.error) {
        kirim({ jenis: 'galatSetup', pesan: pesanGagalMulai(pengguna.error.asli) });
        return;
      }
      const subjekRef = pengunjungId ?? pengguna.data?.id;
      if (!subjekRef) {
        kirim({ jenis: 'galatConsent', pesan: PESAN_AKUN_TAK_DIKENALI });
        return;
      }
      const dicatat = await catatPersetujuan(sb, { subjek_ref: subjekRef, ...p.persetujuan });
      if (dicatat.error) {
        kirim({ jenis: 'galatConsent', pesan: dicatat.error.jenis === 'jaringan' ? PESAN_CONSENT_JARINGAN : PESAN_CONSENT_GAGAL });
        return;
      }
      const dibuat = await buatSesiChat(sb, {
        layananId,
        kontak: nama,
        chatbotAktif: terpilih?.chatbot_aktif === true,
        pengunjungId,
      });
      if (dibuat.error) {
        kirim({ jenis: 'galatSetup', pesan: pesanGagalMulai(dibuat.error.asli) });
        return;
      }
      kirim({ jenis: 'sesiDibuat', sesi: dibuat.data, layananId, buka: true });
      tulisDibaca(layananId, sekarang());
      pesan.ganti([
        pesanSambutan({
          nama,
          layananNama: terpilih?.nama ?? '',
          botAktif: terpilih?.chatbot_aktif === true,
          waktu: sekarang(),
        }),
      ]);
      // FAQ dimuat setelah sesi benar-benar ada (tidak ada gunanya bila persetujuan/sesi gagal).
      void muatFaq(layananId);
    } catch (e) {
      kirim({ jenis: 'galatSetup', pesan: pesanGagalMulai(e) });
    } finally {
      kirim({ jenis: 'selesaiMulai' });
    }
  };

  /**
   * Sesi terbuka untuk pesan berikutnya: percakapan yang sesi terakhirnya selesai (atau belum punya sesi) membuka sesi
   * baru. Galat = pesan ditandai "Gagal terkirim" + Kirim ulang oleh pemanggil.
   */
  const pastikanSesi = async (): Promise<HasilChat<string>> => {
    const kini = mesinRef.current;
    if (kini.sesiId && kini.status !== 'selesai') return { data: kini.sesiId, error: null };
    const terpilih = layanan.find((l) => l.id === layananId);
    if (!terpilih) return { data: null, error: { jenis: 'database', pesan: pesanMutasi(null), asli: null } };
    const dibuat = await buatSesiChat(createClient(), {
      layananId,
      kontak: namaPengunjung.trim() || 'Pengunjung',
      chatbotAktif: terpilih.chatbot_aktif === true,
      pengunjungId,
    });
    if (dibuat.error) return dibuat;
    kirim({ jenis: 'sesiDibuat', sesi: dibuat.data, layananId, buka: false });
    return { data: dibuat.data.id, error: null };
  };

  return {
    bukaPercakapan,
    putuskanAwal,
    kembali,
    mulaiSesi,
    pastikanSesi,
    pilihLayanan: (id: string) => kirim({ jenis: 'pilihLayanan', layananId: id }),
    tampilkan: (tampilan: 'daftar' | 'baru', bersihkanGalat = false) => kirim({ jenis: 'tampilkan', tampilan, bersihkanGalat }),
    hapusGalatConsent: () => kirim({ jenis: 'hapusGalatConsent' }),
  };
}

export type SesiChat = ReturnType<typeof useSesiChat>;
