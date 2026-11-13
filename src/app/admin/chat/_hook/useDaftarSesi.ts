'use client';

// Daftar sesi chat staf + pilihan sesi (rencana refaktor 2026-11-11 tugas 7.2): profil petugas dibaca sekali, daftar sesi dan
// tahap penanganan lewat lib/data/chat-staf.ts. Realtime (audit 2026-11-13, satu channel per tabel per tab): chat_sesi lewat
// pusat (lib/realtime/pusat.ts, channel `staf-tabel-chat_sesi` yang juga dipakai sidebar) cukup memberi sinyal muat ulang;
// INSERT chat_pesan tetap di channel sendiri `chat-admin` (lib/realtime/kanal.ts, dibuka ulang setelah CLOSED) karena
// payloadnya langsung digabung ke utas (`langganPesanBaru`, dipakai usePesanSesi), sedangkan pusat tanpa payload.
// `rt` gabungan: 'ok' hanya bila kedua sumber tersambung. Pemuatan ulang daftar: throttle 400 ms dari event, catch-up saat
// `rt` menjadi 'ok', polling cadangan (15 dtk saat Realtime tak sehat, 60 dtk saat sehat karena baris yang keluar dari
// lingkup tidak mengirim event).
//
// Penjaga permintaan basi: tiap muat diberi nomor; hanya respons TERAKHIR yang boleh mengisi layar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { makeThrottle, rtFromStatus, useFallbackPoll, useOnSubscribed, type ChatMsg, type RtState } from '@/app/chat/merge';
import { bukaKanal } from '@/lib/realtime/kanal';
import { langganStatus, langganTabel, statusTabel, type StatusTabel } from '@/lib/realtime/pusat';
import {
  muatDaftarSesiStaf,
  muatKontakSesi,
  muatProfilStafChat,
  type PeranStaf,
  type RingkasSesi,
  type TahapChat,
} from '@/lib/data/chat-staf';
import { tandaiTerbaca } from '../_logika/izinChat';

type Toast = (pesan: string, jenis?: 'success' | 'error' | 'warning' | 'info') => void;

/** Pesan INSERT `chat_pesan` dari Realtime beserta sesi asalnya. */
export type PesanBaru = ChatMsg & { sesi_id: string };

/** `chat-admin` + chat_sesi di pusat. Pusat hanya kenal tersambung/putus; putus sebelum pernah tersambung = menyambung. */
function gabungRt(pesan: RtState, sesi: StatusTabel, sesiPernahTersambung: boolean): RtState {
  if (pesan === 'ok' && sesi === 'tersambung') return 'ok';
  if (pesan === 'down' || (sesi === 'putus' && sesiPernahTersambung)) return 'down';
  return 'connecting';
}

export interface OpsiDaftarSesi {
  toast: Toast;
}

export function useDaftarSesi({ toast }: OpsiDaftarSesi) {
  const [sesi, setSesi] = useState<RingkasSesi[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Cadangan bila sesi terpilih hilang dari daftar (mis. selesai & disembunyikan).
  const [snapshot, setSnapshot] = useState<RingkasSesi | null>(null);
  const [loading, setLoading] = useState(true);
  const [dimuat, setDimuat] = useState(false);
  const [galat, setGalat] = useState('');
  const [penanganGalat, setPenanganGalat] = useState(false);
  const [rt, setRt] = useState<RtState>('connecting');
  const [kontak, setKontak] = useState<Record<string, string>>({});
  // Sesi yang sudah dibuka: id -> last_pesan_at saat dibaca. Badge baru muncul lagi bila ada pesan lebih baru.
  const [dibuka, setDibuka] = useState<Record<string, string | null>>({});
  const [petugasId, setPetugasId] = useState<string | null>(null);
  const [role, setRole] = useState<PeranStaf | null>(null);
  const [tahapMap, setTahapMap] = useState<Record<string, TahapChat>>({});
  const [tampilSelesai, setTampilSelesai] = useState(false);

  const toastRef = useRef(toast);
  const layananFilterRef = useRef<string | null>(null);
  const tampilSelesaiRef = useRef(false);
  const listSeq = useRef(0);
  // Tautan dari Kotak Masuk FO (?sesi=<id>): sesi dibuka otomatis begitu daftar termuat.
  const deepLinkRef = useRef<string | null>(null);
  const rtRef = useRef<RtState>('connecting');
  const pendengarPesan = useRef(new Set<(pesan: PesanBaru) => void>());

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  useEffect(() => {
    tampilSelesaiRef.current = tampilSelesai;
  }, [tampilSelesai]);

  const selectedSession = sesi.find((s) => s.id === selectedId) ?? (snapshot && snapshot.id === selectedId ? snapshot : null);

  // Nama pengunjung tidak ada di RPC ringkas: ambil satu baris per sesi yang dibuka.
  const muatKontak = useCallback((id: string) => {
    void muatKontakSesi(createClient(), id).then((h) => {
      if (h.data) setKontak((k) => ({ ...k, [id]: h.data as string }));
    });
  }, []);

  const muatUlang = useCallback(async () => {
    const seq = ++listSeq.current;
    // Daftar sesi + tahap penanganan chat yang masih terbuka (siapa memegang / menunggu di tahap apa), lewat RLS.
    const h = await muatDaftarSesiStaf(createClient(), { sertakanSelesai: tampilSelesaiRef.current });
    if (seq !== listSeq.current) return;
    if (h.error) {
      setGalat(h.error.jenis === 'jaringan' ? 'Gangguan jaringan. Sesi chat tidak dapat dimuat.' : 'Gagal memuat sesi chat');
      setDimuat(true);
      if (h.error.jenis !== 'jaringan') toastRef.current('Gagal memuat sesi chat', 'error');
      return;
    }
    setGalat('');
    setDimuat(true);
    setPenanganGalat(h.data.tahap === null);
    let rows = h.data.sesi;
    // Petugas biasa hanya melihat layanannya sendiri.
    if (layananFilterRef.current) {
      rows = rows.filter((r) => r.layanan_id === layananFilterRef.current);
    }
    if (h.data.tahap === null) {
      toastRef.current('Gagal memuat status penanganan chat', 'error');
    } else {
      const peta: Record<string, TahapChat> = {};
      for (const t of h.data.tahap) peta[t.chat_sesi_id] = t;
      setTahapMap(peta);
    }
    setSesi(rows);
    // Tautan dari Kotak Masuk FO: buka sesi yang dituju begitu terlihat di daftar.
    const tuju = deepLinkRef.current;
    if (tuju) {
      const row = rows.find((r) => r.id === tuju);
      if (row) {
        deepLinkRef.current = null;
        setSelectedId(row.id);
        setSnapshot(row);
        muatKontak(row.id);
      }
    }
  }, [muatKontak]);

  // Pesan INSERT dari channel yang sama dibagikan ke pendengar (usePesanSesi) tanpa membuka channel kedua.
  const langganPesanBaru = useCallback((fn: (pesan: PesanBaru) => void) => {
    pendengarPesan.current.add(fn);
    return () => {
      pendengarPesan.current.delete(fn);
    };
  }, []);

  // Inisialisasi (profil petugas), lalu Realtime: chat_sesi lewat pusat, INSERT chat_pesan lewat channel `chat-admin`.
  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const berhenti: Array<() => void> = [];
    let cadangan: ReturnType<typeof setTimeout> | null = null;
    // Throttle leading+trailing (400ms): tidak kelaparan saat event beruntun.
    const throttle = makeThrottle(() => { void muatUlang(); }, 400);
    const refetchSoon = throttle.call;

    let [rtPesan, rtSesi, sesiPernahTersambung]: [RtState, StatusTabel, boolean] = ['connecting', 'putus', false];
    const perbaruiRt = () => {
      if (!active) return;
      rtRef.current = gabungRt(rtPesan, rtSesi, sesiPernahTersambung);
      setRt(rtRef.current);
    };
    const catatSesi = (s: StatusTabel) => {
      rtSesi = s;
      sesiPernahTersambung ||= s === 'tersambung';
      perbaruiRt();
    };

    async function init() {
      try {
        const profil = await muatProfilStafChat(supabase);
        if (profil.error) throw profil.error.asli;
        if (profil.data) {
          setPetugasId(profil.data.id);
          setRole(profil.data.role);
          if (profil.data.role === 'petugas') layananFilterRef.current = profil.data.layanan_id;
        }
        deepLinkRef.current = new URLSearchParams(window.location.search).get('sesi');

        if (!active) return;

        // Pengamat status dipasang sebelum langganan agar SUBSCRIBED yang datang seketika tidak terlewat.
        berhenti.push(langganStatus('chat_sesi', catatSesi), langganTabel('chat_sesi', refetchSoon));
        if (statusTabel('chat_sesi') === 'tersambung') catatSesi('tersambung'); // channel bersama sudah tersambung
        berhenti.push(
          bukaKanal({
            topik: 'chat-admin',
            pasang: (ch) =>
              ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_pesan' }, (payload) => {
                const pesan = payload.new as PesanBaru;
                for (const fn of [...pendengarPesan.current]) fn(pesan);
                refetchSoon();
              }),
            saatStatus: (status) => {
              rtPesan = rtFromStatus(status);
              perbaruiRt();
            },
          }),
        );
        // Daftar awal dimuat saat SUBSCRIBED (catch-up); bila realtime tak tersambung, muat sekali.
        cadangan = setTimeout(() => {
          if (active && rtRef.current !== 'ok') void muatUlang();
        }, 3000);
      } catch (e) {
        console.error(e);
        setGalat('Gagal menginisialisasi chat. Coba muat daftar kembali.');
        toastRef.current('Gagal menginisialisasi chat', 'error');
      } finally {
        if (active) setLoading(false);
      }
    }
    void init();

    return () => {
      active = false;
      throttle.cancel();
      if (cadangan) clearTimeout(cadangan);
      for (const f of berhenti) f();
    };
  }, [muatUlang]);

  // Cadangan: poll daftar hanya saat realtime tidak sehat; refetch saat tab kembali terlihat / online.
  useOnSubscribed(rt, muatUlang, !loading);
  // slowMs 60 dtk (Fase 5): event Realtime untuk baris yang keluar dari lingkup (mis. chat ditutup rekan) tidak terkirim,
  // jadi daftar disegarkan pelan walau Realtime sehat.
  useFallbackPoll(muatUlang, rt, { fastMs: 15000, slowMs: 60000, enabled: !loading });

  // Ganti filter "selesai" -> muat ulang daftar (bukan saat render awal).
  const filterPertama = useRef(true);
  useEffect(() => {
    if (filterPertama.current) {
      filterPertama.current = false;
      return;
    }
    void muatUlang();
  }, [tampilSelesai, muatUlang]);

  const pilih = (s: RingkasSesi) => {
    setSelectedId(s.id);
    setSnapshot(s);
    // Sesi yang dibuka dianggap sudah dibaca; sesi yang ditinggalkan ditandai terbaca sampai pesan lebih baru.
    setDibuka((c) => {
      const next = tandaiTerbaca(c, s);
      const sebelumnya = selectedId ? sesi.find((x) => x.id === selectedId) : null;
      return sebelumnya ? tandaiTerbaca(next, sebelumnya) : next;
    });
    if (!kontak[s.id]) muatKontak(s.id);
  };

  // Mobile: kembali ke daftar. Sesi yang ditinggalkan diperlakukan sama seperti berpindah sesi.
  const kembali = () => {
    if (selectedSession) setDibuka((c) => tandaiTerbaca(c, selectedSession));
    setSelectedId(null);
  };

  return {
    sesi, selectedId, selectedSession, dibuka, kontak, tahapMap, petugasId, role,
    loading, dimuat, galat, penanganGalat, rt, tampilSelesai, setTampilSelesai,
    muatUlang, pilih, kembali, langganPesanBaru,
  };
}
