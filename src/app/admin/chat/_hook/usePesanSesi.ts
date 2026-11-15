'use client';

// Utas pesan sesi terpilih (rencana refaktor 2026-11-11 tugas 7.2): muat (riwayat lintas sesi saat sesi dibuka, satu sesi
// pada catch-up/polling), riwayat lebih lama, pesan baru dari channel `chat-admin` (dibagikan useDaftarSesi), serta
// balasan teks, foto, dan draf. Semua lewat lib/data/chat-staf.ts; hook ini tanpa JSX.
//
// Penjaga permintaan basi: muat riwayat punya nomor urut sendiri (poll sesi terpilih yang berjalan bersamaan tidak boleh
// membuangnya); respons untuk sesi yang sudah berganti atau kalah urut diabaikan. Pesan sesi lain tidak terbawa.
import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeMessages, useFallbackPoll, useOnSubscribed, type ChatMsg, type RtState } from '@/app/chat/merge';
import { buatDrafBalasan, kirimFotoStaf, kirimPesanStaf, muatPesanSesi } from '@/lib/data/chat-staf';
import type { PesanBaru } from './useDaftarSesi';

type Toast = (pesan: string, jenis?: 'success' | 'error' | 'warning' | 'info') => void;

export interface OpsiPesanSesi {
  /** Sesi terpilih; null = tidak ada. */
  sesiId: string | null;
  /** Sesi terpilih sudah selesai (berhenti memuat berkala). */
  selesai: boolean;
  /** Pengguna memegang sesi ini (boleh membalas). */
  bolehBalas: boolean;
  rt: RtState;
  langganPesanBaru: (fn: (pesan: PesanBaru) => void) => () => void;
  /** Muat ulang daftar sesi (setelah balasan gagal, status mungkin berubah). */
  muatDaftar: () => void | Promise<void>;
  toast: Toast;
}

export function usePesanSesi({ sesiId, selesai, bolehBalas, rt, langganPesanBaru, muatDaftar, toast }: OpsiPesanSesi) {
  const [pesan, setPesan] = useState<ChatMsg[]>([]);
  // Riwayat percakapan (semua sesi pengunjung + Layanan yang sama) dipaginasi mundur; true = ada pesan lebih lama.
  const [adaLebih, setAdaLebih] = useState(false);
  const [memuatRiwayat, setMemuatRiwayat] = useState(false);
  const [isian, setIsian] = useState('');
  const [memuatDraf, setMemuatDraf] = useState(false);
  const [mengirim, setMengirim] = useState(false);
  const [galatKirim, setGalatKirim] = useState('');
  const [mengirimFoto, setMengirimFoto] = useState(false);

  const sesiIdRef = useRef<string | null>(null);
  const pesanSeq = useRef(0);
  const riwayatSeq = useRef(0);
  // client_uuid dipertahankan selama teks yang sama belum terkirim, sehingga klik ulang setelah gagal bersifat idempoten di server.
  const kirimTertunda = useRef<{ teks: string; uuid: string } | null>(null);
  const toastRef = useRef(toast);
  const muatDaftarRef = useRef(muatDaftar);
  useEffect(() => {
    sesiIdRef.current = sesiId;
  }, [sesiId]);
  useEffect(() => {
    toastRef.current = toast;
    muatDaftarRef.current = muatDaftar;
  });

  // Pesan baru dari Realtime: hanya milik sesi terpilih.
  useEffect(
    () =>
      langganPesanBaru((baru) => {
        if (baru.sesi_id === sesiIdRef.current) setPesan((prev) => mergeMessages(prev, [baru]));
      }),
    [langganPesanBaru],
  );

  // riwayat=true (hanya saat sesi dipilih): seluruh percakapan lintas sesi (lingkup ditegakkan route/DB). Poll dan
  // Realtime memuat sesi terpilih saja.
  const muat = useCallback(async (opsi?: { riwayat?: boolean }) => {
    const id = sesiIdRef.current;
    if (!id) return;
    const urutan = opsi?.riwayat ? riwayatSeq : pesanSeq;
    const seq = ++urutan.current;
    const h = await muatPesanSesi({ sesiId: id, riwayat: opsi?.riwayat });
    if (h.error) return; // jaringan putus / ditolak: poll atau refetch berikutnya akan mencoba lagi
    // Abaikan respons usang: sesi sudah berganti atau ada fetch yang lebih baru.
    if (seq !== urutan.current || id !== sesiIdRef.current) return;
    const { messages, adaLebih: lebih } = h.data;
    if (messages) setPesan((prev) => mergeMessages(prev, messages));
    if (opsi?.riwayat) setAdaLebih(lebih);
  }, []);

  const muatRiwayatLebihLama = async () => {
    const id = sesiIdRef.current;
    const tertua = pesan.find((m) => !m.local)?.created_at;
    if (!id || !tertua || memuatRiwayat) return;
    setMemuatRiwayat(true);
    try {
      const h = await muatPesanSesi({ sesiId: id, riwayat: true, sebelum: tertua });
      if (h.error || id !== sesiIdRef.current) return; // tombol tetap ada: coba lagi
      if (h.data.messages) {
        const { messages } = h.data;
        setPesan((prev) => mergeMessages(prev, messages as ChatMsg[]));
      }
      setAdaLebih(h.data.adaLebih);
    } finally {
      setMemuatRiwayat(false);
    }
  };

  // Utas pesan: kunci pada id sesi (bukan objek) supaya refresh daftar tidak memicu muat ulang.
  useEffect(() => {
    if (sesiId) void muat({ riwayat: true });
  }, [sesiId, muat]);

  const hidup = !!sesiId && !selesai;
  useOnSubscribed(rt, muat, hidup);
  useFallbackPoll(muat, rt, { fastMs: 5000, slowMs: 30000, enabled: hidup });

  /** Berpindah sesi: pesan sesi sebelumnya tidak boleh terbawa; fetch lama diabaikan. */
  const reset = () => {
    setPesan([]);
    setAdaLebih(false);
    setIsian('');
    setGalatKirim('');
    kirimTertunda.current = null;
    pesanSeq.current++;
    riwayatSeq.current++;
  };

  const kirim = async (teksMasuk: string) => {
    const teks = teksMasuk.trim();
    if (!teks || !sesiId || mengirim || !bolehBalas) return;

    // Teks yang sama dipakai ulang uuid-nya (retry idempoten).
    if (!kirimTertunda.current || kirimTertunda.current.teks !== teks) {
      kirimTertunda.current = { teks, uuid: crypto.randomUUID() };
    }
    const { uuid } = kirimTertunda.current;

    setMengirim(true);
    setGalatKirim('');
    try {
      const h = await kirimPesanStaf({ sesiId, isi: teks, clientUuid: uuid });
      if (h.error) {
        // Teks TIDAK dihapus; petugas bisa menekan kirim lagi.
        setGalatKirim(`${h.error.pesan}. Teks Anda masih ada — kirim lagi.`);
        toastRef.current(h.error.pesan, 'error');
        void muatDaftarRef.current();
        return;
      }
      kirimTertunda.current = null;
      if (sesiId === sesiIdRef.current) {
        const { message } = h.data;
        if (message) setPesan((prev) => mergeMessages(prev, [message]));
        setIsian('');
      }
    } finally {
      setMengirim(false);
    }
  };

  // Kirim foto sebagai balasan petugas (hanya-lampiran), memakai izin yang sama dengan balasan teks.
  const kirimFoto = async (berkas: File | undefined) => {
    if (!berkas || !sesiId || mengirim || mengirimFoto || !bolehBalas) return;
    setMengirimFoto(true);
    try {
      const h = await kirimFotoStaf({ sesiId, berkas });
      if (h.error) {
        toastRef.current(h.error.pesan, 'error');
        return;
      }
      const { message } = h.data;
      if (sesiId === sesiIdRef.current && message) setPesan((prev) => mergeMessages(prev, [message]));
    } finally {
      setMengirimFoto(false);
    }
  };

  const buatDraf = async () => {
    if (!sesiId || memuatDraf) return;
    setMemuatDraf(true);
    try {
      const h = await buatDrafBalasan(sesiId);
      if (h.error) {
        toastRef.current(h.error.pesan, 'error');
        return;
      }
      setIsian(h.data);
      toastRef.current('Draf balasan Gemini berhasil dimuat!', 'success');
    } finally {
      setMemuatDraf(false);
    }
  };

  return {
    pesan, adaLebih, memuatRiwayat, isian, setIsian, memuatDraf, mengirim, galatKirim, mengirimFoto,
    muat, muatRiwayatLebihLama, reset, kirim, kirimFoto, buatDraf,
  };
}
