'use client';

// Kiriman pengunjung (rencana refaktor 2026-11-11 tugas 6.3): pesan teks (optimistic, lalu disimpan; mode bot: jawaban
// AI), foto, kirim ulang pesan gagal, dan "Hubungkan ke Petugas". I/O lewat lib/data/chat-pengunjung.ts; pesan di layar
// lewat usePesan; sesi terbuka lewat useSesiChat.pastikanSesi.
import { useState } from 'react';
import { TEKS_MENUNGGU_PETUGAS } from '@/lib/chat/status-layanan';
import { unggahLampiranChat } from '@/lib/chat/lampiran-klien';
import { kirimLampiranChat, kirimPesanChat, mintaPetugasChat, tanyaBotChat } from '@/lib/data/chat-pengunjung';
import type { ChatMsg } from '../merge';
import { modeBot } from '../_logika/mesinChat';
import {
  TEKS_BOT_DIPROSES,
  TEKS_BOT_TERLALU_CEPAT,
  TEKS_BOT_TIDAK_TERSEDIA,
  TEKS_MINTA_PETUGAS_LAMA,
  TEKS_PETUGAS_GAGAL,
  TEKS_PETUGAS_GAGAL_JARINGAN,
  pesanPemberitahuan,
  teksBotGagal,
} from '../_logika/turunan';
import type { MesinChat } from './useMesinChat';
import type { PesanChat } from './usePesan';
import type { SesiChat } from './useSesiChat';

/** Setelah selang ini tampil pemberitahuan "masih diproses" (batas waktu permintaan bot ada di lapisan data). */
export const BOT_LAMBAT_MS = 20_000;

interface Opsi {
  mesin: MesinChat;
  pesan: Pick<PesanChat, 'tambah' | 'tandai' | 'gabung' | 'buangSementara' | 'sinkron'>;
  pastikanSesi: SesiChat['pastikanSesi'];
  daring: boolean;
  hanyaBaca: boolean;
  botAktif: boolean;
  /** Layanan sedang di luar jam (dibaca saat jawaban tiba, bukan saat render). */
  tutupRef: { readonly current: boolean };
}

const sekarang = () => new Date().toISOString();
const pemberitahuan = (isi: string, transient = false) =>
  pesanPemberitahuan(isi, { id: crypto.randomUUID(), waktu: sekarang(), transient });
// navigator.onLine bisa undefined di luar browser: anggap daring.
const masihDaring = () => typeof navigator === 'undefined' || navigator.onLine;

export function useKirim({ mesin, pesan, pastikanSesi, daring, hanyaBaca, botAktif, tutupRef }: Opsi) {
  const { keadaan, ref: mesinRef, kirim } = mesin;
  const { layananId, tampilan, status } = keadaan;
  const [mengirimFoto, setMengirimFoto] = useState(false);
  const bolehKirim = daring && !hanyaBaca && tampilan === 'percakapan';
  const modeBotKini = () => modeBot(mesinRef.current.status, tutupRef.current, botAktif);

  /** Simpan pesan; pesan server (client_uuid sama) menggantikan pesan optimistic. false = ditandai gagal. */
  const simpan = async (msg: ChatMsg, sid: string): Promise<boolean> => {
    const h = await kirimPesanChat({ sesiId: sid, isi: msg.isi, clientUuid: msg.client_uuid });
    if (h.error) {
      pesan.tandai(msg.id, 'failed');
      return false;
    }
    if (h.data.message) pesan.gabung([h.data.message]);
    else pesan.tandai(msg.id, undefined);
    return true;
  };

  const tanyaBot = async (teks: string, sid: string) => {
    const lambat = setTimeout(() => pesan.tambah(pemberitahuan(TEKS_BOT_DIPROSES, true)), BOT_LAMBAT_MS);
    try {
      const h = await tanyaBotChat({ pertanyaan: teks, layananId, sesiId: sid });
      if (h.error) {
        if (masihDaring()) {
          pesan.tambah(pemberitahuan(teksBotGagal({ waktuHabis: h.error.jenis === 'waktu_habis', tutup: tutupRef.current })));
          // Server bisa saja sudah menyimpan balasan/eskalasi: ambil kebenarannya.
          void pesan.sinkron();
        }
        return;
      }
      const j = h.data;
      if (j.jenis === 'terlalu_cepat') pesan.tambah(pemberitahuan(TEKS_BOT_TERLALU_CEPAT));
      else if (j.jenis === 'tidak_tersedia') pesan.tambah(pemberitahuan(TEKS_BOT_TIDAK_TERSEDIA));
      else {
        // Balasan bot sudah tersimpan di server: tampil langsung (dedupe per id terhadap realtime/poll). Status hanya
        // berubah bila server yang mengonfirmasi.
        if (j.pesan) pesan.gabung([j.pesan]);
        else if (j.mintaPetugasLuarJam) pesan.tambah(pemberitahuan(TEKS_MENUNGGU_PETUGAS));
        if (j.status) kirim({ jenis: 'status', status: j.status });
        else if (j.eskalasi) kirim({ jenis: 'status', status: 'eskalasi' });
      }
    } finally {
      clearTimeout(lambat);
      pesan.buangSementara();
    }
  };

  // Simpan pesan lalu (mode bot) minta jawaban AI. Indikator "mengetik" langsung tampil begitu pesan dikirim.
  const kirimDanTanya = async (msg: ChatMsg) => {
    const sesi = await pastikanSesi();
    if (sesi.error) {
      pesan.tandai(msg.id, 'failed');
      return;
    }
    const sid = sesi.data;
    const botMode = modeBotKini();
    if (botMode) kirim({ jenis: 'mengetik', tambah: 1 });
    try {
      const tersimpan = await simpan(msg, sid);
      // AI hanya dipanggil saat sesi benar-benar mode bot.
      if (tersimpan && modeBotKini()) await tanyaBot(msg.isi, sid);
    } finally {
      if (botMode) kirim({ jenis: 'mengetik', tambah: -1 });
    }
  };

  const kirimTeks = async (teks: string) => {
    const isi = teks.trim();
    if (!isi || !bolehKirim) return;
    // Tampil dulu (optimistic) lalu disimpan; client_uuid dipakai server & realtime untuk dedupe.
    const clientUuid = crypto.randomUUID();
    const msg: ChatMsg = {
      id: `user-${clientUuid}`,
      pengirim: 'pengunjung',
      isi,
      created_at: sekarang(),
      client_uuid: clientUuid,
      local: 'pending',
    };
    pesan.tambah(msg);
    await kirimDanTanya(msg);
  };

  const kirimUlang = async (msg: ChatMsg) => {
    pesan.tandai(msg.id, 'pending');
    await kirimDanTanya(msg);
  };

  // Foto: unggah ke R2 lalu simpan sebagai pesan hanya-lampiran. Tidak memanggil bot (bukan pertanyaan teks).
  const kirimFoto = async (berkas: File | undefined) => {
    if (!berkas || mengirimFoto || !bolehKirim) return;
    setMengirimFoto(true);
    try {
      const sesi = await pastikanSesi();
      if (sesi.error) {
        pesan.tambah(pemberitahuan(sesi.error.pesan));
        return;
      }
      const lampiran = await unggahLampiranChat(sesi.data, berkas);
      const h = await kirimLampiranChat({ sesiId: sesi.data, lampiran, clientUuid: crypto.randomUUID() });
      if (h.error) pesan.tambah(pemberitahuan(h.error.pesan));
      else if (h.data.message) pesan.gabung([h.data.message]);
    } catch (e) {
      pesan.tambah(pemberitahuan(e instanceof Error ? e.message : 'Foto gagal dikirim'));
    } finally {
      setMengirimFoto(false);
    }
  };

  // "Hubungkan ke Petugas": jam kerja = eskalasi ke kotak masuk; di luar jam = pesan tunggu + email ke petugas (DB,
  // chat_minta_petugas). Migrasi belum diterapkan (409) -> jalur lama: pertanyaan ke AI route yang mengeskalasi.
  const mintaPetugas = async () => {
    const sid = mesinRef.current.sesiId;
    if (!sid || status !== 'bot') return;
    const h = await mintaPetugasChat(sid);
    if (h.error) {
      pesan.tambah(pemberitahuan(TEKS_PETUGAS_GAGAL_JARINGAN));
      return;
    }
    const j = h.data;
    if (j.jenis === 'migrasi_belum') {
      await kirimTeks(TEKS_MINTA_PETUGAS_LAMA);
      return;
    }
    if (j.jenis === 'ditolak') {
      pesan.tambah(pemberitahuan(j.pesan ?? TEKS_PETUGAS_GAGAL));
      return;
    }
    if (j.pesan) pesan.gabung([j.pesan]);
    else if (j.menungguLuarJam) pesan.tambah(pemberitahuan(TEKS_MENUNGGU_PETUGAS));
    if (j.status) kirim({ jenis: 'status', status: j.status });
  };

  return { kirimTeks, kirimUlang, kirimFoto, mengirimFoto, mintaPetugas, mengetik: keadaan.mengetik > 0 };
}
