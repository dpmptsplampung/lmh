'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  MessageSquare,
  Bot,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Wifi,
  WifiOff,
  UserCheck,
  UserCog,
  ArrowRight,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import { truncate, relativeTime } from '@/lib/utils';
import { urlLoginAlasan } from '@/lib/sesi-staf';
import {
  GalatAksiChat,
  kirimAksiChat,
  kodeChatPerluMuatUlang,
  type HasilChatAmbil,
  type HasilChatSelesai,
  type HasilChatTeruskan,
  type PeranTahapChat,
} from '@/lib/chat-staf';
import type { TopikFo } from '@/lib/fo-penanganan';
import { muatInfoHariLayanan, sebabHariTanpaLayanan, type InfoHariLayanan } from '@/lib/chat/hari-tanpa-layanan';
import {
  ChatAmbilAlihDialog,
  ChatSelesaiDialog,
  ChatTeruskanDialog,
  type LayananChatOpsi,
} from '@/components/admin/ChatAksiDialog';
import {
  mergeMessages,
  rtFromStatus,
  useFallbackPoll,
  useOnSubscribed,
  makeThrottle,
  waktuLabel,
  type ChatMsg,
  type RtState,
} from '@/app/chat/merge';
import styles from './chat.module.css';
import ui from '@/app/chat/chat-ui.module.css';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message as ChatMessage,
  MessageInput,
} from '@chatscope/chat-ui-kit-react';

type Status = 'bot' | 'eskalasi' | 'aktif' | 'selesai';

// Baris RPC public.chat_sesi_ringkas (ringkasan per sesi, tanpa memuat pesan).
interface RingkasRow {
  id: string;
  status: Status;
  layanan_id: string;
  pengunjung_id: string | null;
  ditangani_oleh: string | null;
  created_at: string;
  updated_at: string;
  last_pesan: string | null;
  last_pesan_at: string | null;
  last_pengirim: 'pengunjung' | 'petugas' | 'bot' | null;
  unread: boolean;
}

type Message = ChatMsg;

type RolePetugas = 'admin' | 'petugas' | 'front_office';

// Tahap penanganan chat yang masih terbuka (kontrak FO-CHAT §4.2/§4.3), per sesi.
interface TahapChat {
  id: string;
  chat_sesi_id: string;
  peran_tahap: PeranTahapChat;
  status: 'menunggu' | 'berjalan';
  layanan_id: string | null;
  penangan_id: string | null;
}

type DialogAksi = 'ambil_alih' | 'teruskan' | 'selesai';

const statusConfig = {
  bot: { label: 'Bot', icon: <Bot size={12} />, className: 'badge--bot' },
  eskalasi: { label: 'Menunggu Diambil', icon: <AlertCircle size={12} />, className: 'badge--eskalasi' },
  aktif: { label: 'Aktif', icon: <MessageSquare size={12} />, className: 'badge--aktif' },
  selesai: { label: 'Selesai', icon: <CheckCircle2 size={12} />, className: 'badge--selesai' },
};

export default function AdminChatPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<RingkasRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Cadangan bila sesi terpilih hilang dari daftar (mis. selesai & disembunyikan).
  const [snapshot, setSnapshot] = useState<RingkasRow | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [showSelesai, setShowSelesai] = useState(false);
  const [rt, setRt] = useState<RtState>('connecting');
  const [layananNama, setLayananNama] = useState<Record<string, string>>({});
  const [petugasNama, setPetugasNama] = useState<Record<string, string>>({});
  const [kontak, setKontak] = useState<Record<string, string>>({});
  // Sesi yang sudah dibuka: id -> last_pesan_at saat dibaca. Badge baru muncul lagi bila ada pesan lebih baru.
  const [cleared, setCleared] = useState<Record<string, string | null>>({});
  const [myPetugasId, setMyPetugasId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<RolePetugas | null>(null);
  const [tahapMap, setTahapMap] = useState<Record<string, TahapChat>>({});
  const [topikFo, setTopikFo] = useState<TopikFo[]>([]);
  const [layananChat, setLayananChat] = useState<LayananChatOpsi[]>([]);
  const [dialog, setDialog] = useState<DialogAksi | null>(null);
  const [aksiBusy, setAksiBusy] = useState(false);
  // Peringatan setelah meneruskan chat ke layanan yang belum ada petugas hadir (bukan galat; kontrak §2.2).
  const [peringatan, setPeringatan] = useState<string | null>(null);
  // Hari tanpa pelayanan (Sabtu/Minggu/hari_libur; keputusan CEO 2026-10-14): chat tidak dapat diambil, diambil alih,
  // atau diteruskan (DB menolak HARI_TANPA_LAYANAN). Tombol dinonaktifkan dengan alasan; pemegang chat dari hari kerja
  // tetap dapat membalas dan menyelesaikan.
  const [infoHari, setInfoHari] = useState<InfoHariLayanan | null>(null);
  useEffect(() => {
    let batal = false;
    Promise.resolve()
      .then(() => muatInfoHariLayanan(createClient(), new Date(), { kanal: false }))
      .then((info) => {
        if (!batal) setInfoHari(info);
      })
      .catch(() => {
        /* gagal menilai hari: tombol tetap aktif; DB tetap penegak */
      });
    return () => {
      batal = true;
    };
  }, []);
  const tanpaLayanan = !!infoHari?.alasan;
  const alasanTanpaLayanan = infoHari?.alasan
    ? `Chat tidak dapat diambil atau diteruskan karena ${sebabHariTanpaLayanan(infoHari)} (hari tanpa pelayanan). ` +
      'Pengunjung hanya dilayani asisten virtual; chat yang menunggu ditutup otomatis setelah 24 jam tanpa aktivitas.'
    : null;

  const { toast } = useToast();
  const selectedIdRef = useRef<string | null>(null);
  const layananFilterRef = useRef<string | null>(null);
  const showSelesaiRef = useRef(false);
  const listSeq = useRef(0);
  const msgSeq = useRef(0);
  // client_uuid dipertahankan selama teks yang sama belum terkirim, sehingga
  // klik ulang setelah gagal bersifat idempoten di server.
  const pendingSend = useRef<{ text: string; uuid: string } | null>(null);
  const aksiRef = useRef(false);
  // Tautan dari Kotak Masuk FO (?sesi=<id>): sesi dibuka otomatis begitu daftar termuat.
  const deepLinkRef = useRef<string | null>(null);

  const selectedSession =
    sessions.find((s) => s.id === selectedId) ??
    (snapshot && snapshot.id === selectedId ? snapshot : null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    showSelesaiRef.current = showSelesai;
  }, [showSelesai]);

  const handleGenerateDraft = async () => {
    if (!selectedSession || loadingDraft) return;
    setLoadingDraft(true);
    try {
      const res = await fetch('/api/chat/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sesi_id: selectedSession.id }),
      });
      const data = await res.json();
      if (res.ok && data.draft) {
        setMessageInput(data.draft);
        toast('Draf balasan Gemini berhasil dimuat!', 'success');
      } else {
        toast(data.error || 'Gagal membuat draf balasan', 'error');
      }
    } catch {
      toast('Gagal memuat draf balasan', 'error');
    } finally {
      setLoadingDraft(false);
    }
  };

  // Auto-scroll pesan baru ditangani chatscope MessageList (hanya bila sedang di dasar).

  // Daftar sesi: satu RPC ringkas (tanpa memuat semua pesan). Urutan respons
  // dijaga lewat nomor urut agar fetch lama tidak menimpa yang baru.
  // Nama pengunjung tidak ada di RPC ringkas: ambil satu baris per sesi yang dibuka.
  const muatKontak = useCallback((id: string) => {
    createClient()
      .from('chat_sesi')
      .select('kontak_pengunjung')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.kontak_pengunjung) {
          setKontak((k) => ({ ...k, [id]: data.kontak_pengunjung as string }));
        }
      });
  }, []);

  const fetchSessions = useCallback(async () => {
    const seq = ++listSeq.current;
    const supabase = createClient();
    // Daftar sesi + tahap penanganan chat yang masih terbuka (siapa memegang / menunggu di tahap apa), lewat RLS.
    const [{ data, error }, resTahap] = await Promise.all([
      supabase.rpc('chat_sesi_ringkas', {
        p_limit: 100,
        p_include_selesai: showSelesaiRef.current,
      }),
      supabase
        .from('penanganan')
        .select('id, chat_sesi_id, peran_tahap, status, layanan_id, penangan_id')
        .eq('saluran', 'chat')
        .in('status', ['menunggu', 'berjalan']),
    ]);
    if (seq !== listSeq.current) return;
    if (error) {
      toast('Gagal memuat sesi chat', 'error');
      return;
    }
    let rows = (data ?? []) as RingkasRow[];
    // Petugas biasa hanya melihat layanannya sendiri.
    if (layananFilterRef.current) {
      rows = rows.filter((r) => r.layanan_id === layananFilterRef.current);
    }
    if (resTahap.error) {
      toast('Gagal memuat status penanganan chat', 'error');
    } else {
      const peta: Record<string, TahapChat> = {};
      for (const t of (resTahap.data ?? []) as TahapChat[]) peta[t.chat_sesi_id] = t;
      setTahapMap(peta);
    }
    setSessions(rows);
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
  }, [toast, muatKontak]);

  // Throttle leading+trailing (400ms): tidak kelaparan saat event beruntun.
  const rtRef = useRef<RtState>('connecting');

  // Inisialisasi + satu channel realtime untuk daftar sesi DAN pesan sesi terpilih.
  useEffect(() => {
    const supabase = createClient();
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const throttle = makeThrottle(() => { fetchSessions(); }, 400);
    const refetchSoon = throttle.call;

    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: petugas } = await supabase
            .from('petugas')
            .select('id, role, layanan_id')
            .eq('auth_user_id', user.id)
            .maybeSingle();
          if (petugas) {
            setMyPetugasId(petugas.id);
            setMyRole(petugas.role as RolePetugas);
            if (petugas.role === 'petugas') layananFilterRef.current = petugas.layanan_id;
            // Topik FO hanya dipakai pemegang tahap FO (Front Office / Admin).
            if (petugas.role === 'front_office' || petugas.role === 'admin') {
              const { data: tpk } = await supabase
                .from('topik_penanganan')
                .select('id, nama, urut')
                .eq('aktif', true)
                .is('layanan_id', null)
                .order('urut')
                .order('nama');
              if (active) setTopikFo((tpk ?? []) as TopikFo[]);
            }
          }
        }
        deepLinkRef.current = new URLSearchParams(window.location.search).get('sesi');

        // Nama layanan & petugas: tabel kecil, diambil sekali (best-effort). Layanan aktif ber-chat = tujuan teruskan.
        const [{ data: lay }, { data: pet }] = await Promise.all([
          supabase.from('layanan').select('id, nama, aktif, punya_chat').order('nama'),
          supabase.from('petugas').select('id, nama'),
        ]);
        if (active) {
          setLayananNama(Object.fromEntries((lay ?? []).map((l) => [l.id, l.nama])));
          setLayananChat(
            (lay ?? [])
              .filter((l) => l.aktif !== false && l.punya_chat === true)
              .map((l) => ({ id: l.id, nama: l.nama })),
          );
          setPetugasNama(Object.fromEntries((pet ?? []).map((p) => [p.id, p.nama])));
        }

        if (!active) return;

        channel = supabase
          .channel('chat-admin')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_sesi' }, refetchSoon)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_pesan' }, (payload) => {
            const msg = payload.new as Message & { sesi_id: string };
            if (msg.sesi_id === selectedIdRef.current) {
              setMessages((prev) => mergeMessages(prev, [msg]));
            }
            refetchSoon();
          })
          .subscribe((status) => {
            if (active) {
              rtRef.current = rtFromStatus(status);
              setRt(rtRef.current);
            }
          });
        // Daftar awal dimuat saat SUBSCRIBED (catch-up); bila realtime tak tersambung, muat sekali.
        setTimeout(() => {
          if (active && rtRef.current !== 'ok') fetchSessions();
        }, 3000);
      } catch (e) {
        console.error(e);
        toast('Gagal menginisialisasi chat', 'error');
      } finally {
        if (active) setLoading(false);
      }
    }
    init();

    return () => {
      active = false;
      throttle.cancel();
      if (channel) supabase.removeChannel(channel);
    };
  }, [fetchSessions, toast]);

  // Cadangan: poll daftar hanya saat realtime tidak sehat; refetch saat tab
  // kembali terlihat / online.
  useOnSubscribed(rt, fetchSessions, !loading);
  useFallbackPoll(fetchSessions, rt, { fastMs: 15000, slowMs: null, enabled: !loading });

  // Ganti filter "selesai" -> muat ulang daftar (bukan saat render awal).
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    fetchSessions();
  }, [showSelesai, fetchSessions]);

  const loadMessages = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) return;
    const seq = ++msgSeq.current;
    try {
      const res = await fetch(`/api/chat/messages?sesi_id=${id}`);
      if (!res.ok) return;
      const data = await res.json();
      // Abaikan respons usang: sesi sudah berganti atau ada fetch yang lebih baru.
      if (seq !== msgSeq.current || id !== selectedIdRef.current) return;
      if (data.messages) setMessages((prev) => mergeMessages(prev, data.messages as Message[]));
    } catch {
      /* jaringan putus: poll/refetch berikutnya akan mencoba lagi */
    }
  }, []);

  // Utas pesan: kunci pada id sesi (bukan objek) supaya refresh daftar tidak
  // memicu muat ulang. Pesan sesi lain tidak terbawa.
  useEffect(() => {
    if (selectedId) loadMessages();
  }, [selectedId, loadMessages]);

  const threadLive = !!selectedId && selectedSession?.status !== 'selesai';
  useOnSubscribed(rt, loadMessages, threadLive);
  useFallbackPoll(loadMessages, rt, { fastMs: 5000, slowMs: 30000, enabled: threadLive });

  // Tandai sesi terbaca sampai ada pesan yang lebih baru (dipakai saat membuka & meninggalkan sesi).
  const markRead = (c: Record<string, string | null>, row: RingkasRow) => ({ ...c, [row.id]: row.last_pesan_at });

  const handleSelectSession = (session: RingkasRow) => {
    if (session.id !== selectedId) {
      // Reset utas: pesan sesi sebelumnya tidak boleh terbawa; fetch lama diabaikan.
      setMessages([]);
      setMessageInput('');
      setSendError('');
      pendingSend.current = null;
      msgSeq.current++;
    }
    setSelectedId(session.id);
    setSnapshot(session);
    // Sesi yang dibuka dianggap sudah dibaca.
    setCleared((c) => {
      const next = markRead(c, session);
      // Sesi yang ditinggalkan: tandai terbaca sampai pesan lebih baru.
      const prevRow = selectedId ? sessions.find((s) => s.id === selectedId) : null;
      return prevRow ? markRead(next, prevRow) : next;
    });
    if (!kontak[session.id]) muatKontak(session.id);
  };

  // Mobile: kembali ke daftar. Sesi yang ditinggalkan diperlakukan sama seperti berpindah sesi.
  const handleBackToList = () => {
    if (selectedSession) setCleared((c) => markRead(c, selectedSession));
    setSelectedId(null);
  };

  const holderName = (s: RingkasRow) =>
    s.ditangani_oleh ? petugasNama[s.ditangani_oleh] ?? 'petugas lain' : null;
  const tahapDari = (s: RingkasRow): TahapChat | null => tahapMap[s.id] ?? null;
  // Aturan yang sama ditegakkan RPC chat_* dan route pesan: hanya staf yang MENGAMBIL (sesi aktif, dipegang dirinya)
  // yang boleh membalas / meneruskan / menyelesaikan. Admin pun harus mengambil dulu.
  const isOwner = (s: RingkasRow) => s.status === 'aktif' && !!myPetugasId && s.ditangani_oleh === myPetugasId;
  const dipegangLain = (s: RingkasRow) => s.status === 'aktif' && !!s.ditangani_oleh && s.ditangani_oleh !== myPetugasId;
  // Peran tahap milik pemilik: dari tahap terbuka; bila belum terbaca, turunkan dari peran akun.
  const peranPemilik = (s: RingkasRow): PeranTahapChat =>
    tahapDari(s)?.peran_tahap ?? (myRole === 'petugas' ? 'layanan' : 'fo');
  // Setelah diteruskan, FO tidak boleh mengambilnya lagi (DB menolak dengan FORBIDDEN); hanya petugas layanan / Admin.
  const menungguLayanan = (s: RingkasRow) => {
    const t = tahapDari(s);
    return !!t && t.status === 'menunggu' && t.peran_tahap === 'layanan';
  };
  const canReply = !!selectedSession && isOwner(selectedSession);
  const bolehAmbil = (s: RingkasRow) =>
    (s.status === 'bot' || s.status === 'eskalasi') && !(myRole === 'front_office' && menungguLayanan(s));
  const bolehAmbilAlih = (s: RingkasRow) => dipegangLain(s) && myRole === 'admin';
  const bolehTeruskan = (s: RingkasRow) => isOwner(s) && peranPemilik(s) === 'fo';
  const labelStatus = (s: RingkasRow) =>
    s.status === 'eskalasi' && menungguLayanan(s) ? 'Menunggu Petugas Layanan' : statusConfig[s.status].label;
  const namaPengunjung = (s: RingkasRow) => kontak[s.id] || 'Pengunjung';

  // Galat yang berarti sesi staf tidak sah -> login; tampilan basi -> muat ulang daftar & utas.
  const tanganiGalat = (err: unknown) => {
    if (!(err instanceof GalatAksiChat)) return;
    if (err.kode === 'SESI_TIDAK_SAH') {
      toast(err.pesan, 'error');
      router.replace(urlLoginAlasan('tidak_terdaftar'));
      return;
    }
    if (kodeChatPerluMuatUlang(err.kode)) {
      fetchSessions();
      loadMessages();
    }
  };

  const segarkan = () => {
    fetchSessions();
    loadMessages();
  };

  // Ambil (tanpa dialog): FO / petugas / Admin atas chat yang menunggu atau masih dengan bot. chat_ambil atomik di DB:
  // yang kalah balapan menerima SUDAH_DIAMBIL (pesan ramah, daftar disegarkan).
  const handleAmbil = async () => {
    if (!selectedSession || aksiRef.current) return;
    aksiRef.current = true;
    setAksiBusy(true);
    try {
      const hasil = await kirimAksiChat<HasilChatAmbil>({ sesi_id: selectedSession.id, aksi: 'takeover' });
      toast(
        hasil.sudah_milik_anda ? 'Chat ini sudah Anda pegang.' : 'Chat diambil. Silakan balas pengunjung.',
        'success',
      );
    } catch (err) {
      const kode = err instanceof GalatAksiChat ? err.kode : null;
      toast(err instanceof GalatAksiChat ? err.pesan : 'Gagal mengambil chat', kode === 'SUDAH_DIAMBIL' ? 'info' : 'error');
      tanganiGalat(err);
    } finally {
      aksiRef.current = false;
      setAksiBusy(false);
      segarkan();
    }
  };

  const tutupDialog = () => setDialog(null);

  const onAmbilAlihBerhasil = (_hasil: HasilChatAmbil) => {
    toast('Chat diambil alih. Silakan balas pengunjung.', 'success');
    tutupDialog();
    segarkan();
  };
  const onTeruskanBerhasil = (hasil: HasilChatTeruskan) => {
    toast(`Chat diteruskan ke ${hasil.layanan_nama}.`, 'success');
    if (!hasil.petugas_hadir) {
      setPeringatan(
        `Chat diteruskan ke ${hasil.layanan_nama}, tetapi belum ada petugas layanan itu yang hadir hari ini. Chat tetap menunggu di daftar mereka; hubungi petugas bila mendesak.`,
      );
    } else if (hasil.notifikasi_diantrekan === 0) {
      setPeringatan(
        `Chat diteruskan ke ${hasil.layanan_nama}, tetapi tidak ada notifikasi yang terkirim ke petugasnya. Chat tetap menunggu di daftar mereka.`,
      );
    } else {
      setPeringatan(null);
    }
    tutupDialog();
    segarkan();
  };
  const onSelesaiBerhasil = (_hasil: HasilChatSelesai) => {
    toast('Sesi chat diselesaikan.', 'success');
    tutupDialog();
    segarkan();
  };
  const onDialogGalat = (err: unknown) => tanganiGalat(err);

  const handleSendMessage = async (textToSubmit: string) => {
    const text = textToSubmit.trim();
    if (!text || !selectedSession || sending || !canReply) return;
    const sesiId = selectedSession.id;

    // Teks yang sama dipakai ulang uuid-nya (retry idempoten).
    if (!pendingSend.current || pendingSend.current.text !== text) {
      pendingSend.current = { text, uuid: crypto.randomUUID() };
    }
    const { uuid } = pendingSend.current;

    setSending(true);
    setSendError('');
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sesi_id: sesiId, pengirim: 'petugas', isi: text, client_uuid: uuid }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Gagal mengirim pesan');
      }
      const body = await res.json().catch(() => ({}));
      pendingSend.current = null;
      if (sesiId === selectedIdRef.current) {
        if (body.message) setMessages((prev) => mergeMessages(prev, [body.message as Message]));
        setMessageInput('');
      }
    } catch (err) {
      // Teks TIDAK dihapus; petugas bisa menekan kirim lagi.
      const msg = err instanceof Error ? err.message : 'Gagal mengirim pesan';
      setSendError(`${msg}. Teks Anda masih ada — kirim lagi.`);
      toast(msg, 'error');
      fetchSessions();
    } finally {
      setSending(false);
    }
  };

  const namaSender = (p: Message['pengirim']) =>
    p === 'petugas' ? 'Petugas' : p === 'bot' ? 'Bot FAQ' : 'Pengunjung';

  const menunggu = sessions.filter((s) => s.status === 'eskalasi').length;
  // Chat yang menunggu diambil (kotak masuk) tampil paling atas; urutan lain tetap (sort stabil).
  const sessionsUrut = [...sessions].sort((a, b) => Number(b.status === 'eskalasi') - Number(a.status === 'eskalasi'));

  return (
    <>
      <PageHeader
        title="Live Chat"
        description="Panel petugas — tangani chat pengunjung yang masuk"
      />

      {alasanTanpaLayanan && (
        <div
          role="status"
          data-testid="admin-chat-hari-tanpa-layanan"
          id="alasan-hari-tanpa-layanan"
          style={{
            margin: 'var(--space-4) var(--space-8) 0', padding: 'var(--space-2) var(--space-3)',
            fontSize: 'var(--text-sm)', color: 'var(--color-warning-600)', background: 'var(--color-warning-50)',
            border: '1px solid var(--color-warning-500)', borderRadius: 'var(--radius-md)',
          }}
        >
          {alasanTanpaLayanan}
        </div>
      )}

      {peringatan && (
        <div
          role="status"
          style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)',
            margin: 'var(--space-4) var(--space-8) 0', padding: 'var(--space-2) var(--space-3)',
            fontSize: 'var(--text-sm)', color: 'var(--color-warning-600)', background: 'var(--color-warning-50)',
            border: '1px solid var(--color-warning-500)', borderRadius: 'var(--radius-md)',
          }}
        >
          <span>{peringatan}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPeringatan(null)}>
            Tutup
          </button>
        </div>
      )}

      <div className={styles.layout} data-selected={selectedSession ? 'true' : 'false'}>
        {/* Session List */}
        <div className={styles.list}>
          <div style={{
            padding: 'var(--space-4)',
            borderBottom: '1px solid var(--border-default)',
            fontWeight: 600,
            fontSize: 'var(--text-sm)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                Sesi Chat ({sessions.filter(s => s.status !== 'selesai').length} aktif
                {menunggu > 0 ? `, ${menunggu} menunggu diambil` : ''})
              </span>
              <span
                role="status"
                title={rt === 'ok' ? 'Realtime tersambung' : 'Realtime terputus — memakai pembaruan berkala'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '11px', fontWeight: 500,
                  color: rt === 'ok' ? 'var(--color-success-600)' : 'var(--color-danger-600)',
                }}
              >
                {rt === 'ok' ? <Wifi size={12} /> : <WifiOff size={12} />}
                {rt === 'ok' ? 'Langsung' : rt === 'connecting' ? 'Menyambung…' : 'Terputus'}
              </span>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', fontWeight: 400, marginTop: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={showSelesai} onChange={(e) => setShowSelesai(e.target.checked)} />
              Tampilkan sesi selesai
            </label>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} />
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
                Belum ada sesi chat
              </div>
            ) : sessionsUrut.map((session) => {
              const config = statusConfig[session.status];
              const unread = session.id !== selectedId && session.unread && cleared[session.id] !== session.last_pesan_at;
              const holder = session.status === 'aktif' ? holderName(session) : null;
              return (
                <button
                  type="button"
                  key={session.id}
                  onClick={() => handleSelectSession(session)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    font: 'inherit',
                    color: 'inherit',
                    padding: 'var(--space-4)',
                    borderBottom: '1px solid var(--color-neutral-100)',
                    cursor: 'pointer',
                    background: selectedId === session.id ? 'var(--color-primary-50)' : 'transparent',
                    transition: 'background var(--transition-fast)',
                    minHeight: '44px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{layananNama[session.layanan_id] || 'Layanan'}</span>
                    <span className={`badge ${config.className}`} style={{ fontSize: '10px' }}>
                      {config.icon} {labelStatus(session)}
                    </span>
                  </div>
                  {session.last_pesan && (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: 'var(--space-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {truncate(session.last_pesan, 40)}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {holder ? `Ditangani: ${holder}` : kontak[session.id] || 'Pengunjung'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      {unread && (
                        <span
                          aria-label="Pesan belum dibalas"
                          style={{
                            background: 'var(--color-danger-500)',
                            width: 10,
                            height: 10,
                            borderRadius: '999px',
                          }}
                        />
                      )}
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        {relativeTime(session.last_pesan_at ?? session.created_at)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chat Thread */}
        <div className={styles.thread}>
          {selectedSession ? (
            <>
              {/* Thread Header */}
              <div className={styles.threadHeader}>
                <div>
                  <button type="button" className={`btn btn--secondary btn--sm ${styles.backBtn}`} onClick={handleBackToList}>
                    <ArrowLeft size={14} /> Daftar sesi
                  </button>
                  <h3 style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginBottom: '4px' }}>
                    {kontak[selectedSession.id] || 'Pengunjung'}
                  </h3>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    Layanan: {layananNama[selectedSession.layanan_id] || '—'}
                    {selectedSession.status === 'aktif' && (
                      <> · Ditangani oleh {isOwner(selectedSession) ? 'Anda' : holderName(selectedSession) ?? '—'}</>
                    )}
                    {selectedSession.status === 'eskalasi' && (
                      <> · {menungguLayanan(selectedSession) ? 'Diteruskan, menunggu petugas layanan' : 'Menunggu diambil'}</>
                    )}
                  </div>
                </div>
                {selectedSession.status !== 'selesai' && (
                  <div className={styles.threadActions}>
                    {bolehAmbil(selectedSession) && (
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => void handleAmbil()}
                        disabled={aksiBusy || tanpaLayanan}
                        aria-busy={aksiBusy}
                        title={alasanTanpaLayanan ?? undefined}
                        aria-describedby={tanpaLayanan ? 'alasan-hari-tanpa-layanan' : undefined}
                      >
                        {aksiBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <UserCheck size={14} aria-hidden="true" />}
                        Ambil Chat
                      </button>
                    )}
                    {bolehAmbilAlih(selectedSession) && (
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => setDialog('ambil_alih')}
                        disabled={aksiBusy || tanpaLayanan}
                        title={alasanTanpaLayanan ?? undefined}
                        aria-describedby={tanpaLayanan ? 'alasan-hari-tanpa-layanan' : undefined}
                      >
                        <UserCog size={14} aria-hidden="true" /> Ambil Alih Chat
                      </button>
                    )}
                    {bolehTeruskan(selectedSession) && (
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => setDialog('teruskan')}
                        disabled={aksiBusy || tanpaLayanan}
                        title={alasanTanpaLayanan ?? undefined}
                        aria-describedby={tanpaLayanan ? 'alasan-hari-tanpa-layanan' : undefined}
                      >
                        <ArrowRight size={14} aria-hidden="true" /> Teruskan ke Layanan
                      </button>
                    )}
                    {isOwner(selectedSession) && (
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setDialog('selesai')} disabled={aksiBusy}>
                        Selesaikan Chat
                      </button>
                    )}
                  </div>
                )}
              </div>

              {selectedSession.status !== 'selesai' ? (
                <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface-primary)', borderBottom: '1px solid var(--border-default)' }}>
                        {!canReply && (
                          <div role="status" style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                            {alasanTanpaLayanan
                              ? dipegangLain(selectedSession)
                                ? `Chat ini sedang ditangani ${holderName(selectedSession) ?? 'petugas lain'}. ${alasanTanpaLayanan}`
                                : alasanTanpaLayanan
                              : dipegangLain(selectedSession)
                              ? `Chat ini sedang ditangani ${holderName(selectedSession) ?? 'petugas lain'}.${bolehAmbilAlih(selectedSession) ? ' Tekan "Ambil Alih Chat" (alasan wajib) untuk membalas.' : ''}`
                              : menungguLayanan(selectedSession) && !bolehAmbil(selectedSession)
                                ? 'Chat ini sudah diteruskan ke petugas layanan. Petugas layanan yang akan mengambilnya.'
                                : 'Tekan "Ambil Chat" untuk mulai membalas pengunjung.'}
                          </div>
                        )}
                        {sendError && (
                          <div role="alert" style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-danger-700)' }}>
                            {sendError}
                          </div>
                        )}
                        {/* Draft Button above input */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 'var(--space-2) var(--space-4) 0' }}>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={handleGenerateDraft}
                            disabled={loadingDraft || !canReply}
                            title="Minta Gemini memuatkan draf balasan berbasis FAQ & Dasar Hukum"
                            style={{ borderRadius: '999px', fontSize: 'var(--text-xs)', height: '28px', padding: '0 12px' }}
                          >
                            {loadingDraft ? <Loader2 size={12} className="animate-pulse" /> : '⚡ Draf Gemini'}
                          </button>
                        </div>
                </div>
              ) : (
                <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', background: 'var(--surface-primary)' }}>
                  Sesi chat ini sudah selesai.
                </div>
              )}
              {/* Chatscope Messages Area */}
              <div className={ui.shell}>
                <MainContainer responsive>
                  <ChatContainer>
                    <MessageList>
                      {messages.map((msg) => (
                        <ChatMessage
                          key={msg.client_uuid ?? msg.id}
                          model={{
                            message: msg.isi,
                            sentTime: waktuLabel(msg.created_at),
                            sender: namaSender(msg.pengirim),
                            direction: msg.pengirim === 'petugas' ? 'outgoing' : 'incoming',
                            position: 'single',
                          }}
                        >
                          <ChatMessage.Header sender={namaSender(msg.pengirim)} sentTime={waktuLabel(msg.created_at)} />
                        </ChatMessage>
                      ))}
                    </MessageList>

                    {/* MessageInput harus anak LANGSUNG ChatContainer: pembungkus <div> dibuang chatscope. */}
                    {selectedSession.status !== 'selesai' && (
                      <MessageInput
                        placeholder={canReply ? 'Ketik balasan Anda...' : 'Ambil chat untuk membalas'}
                        value={messageInput}
                        onChange={(val) => setMessageInput(val)}
                        onSend={(_html, _text, innerText) => handleSendMessage(innerText)}
                        attachButton={false}
                        disabled={!canReply || sending}
                      />
                    )}
                  </ChatContainer>
                </MainContainer>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
              <MessageSquare size={48} style={{ marginBottom: 'var(--space-4)', opacity: 0.5 }} />
              <p>Pilih sesi chat di samping untuk mulai membalas</p>
            </div>
          )}
        </div>
      </div>

      {selectedSession && dialog === 'ambil_alih' && (
        <ChatAmbilAlihDialog
          sesiId={selectedSession.id}
          namaPengunjung={namaPengunjung(selectedSession)}
          pemegang={holderName(selectedSession)}
          onClose={tutupDialog}
          onBerhasil={onAmbilAlihBerhasil}
          onGalat={onDialogGalat}
        />
      )}
      {selectedSession && dialog === 'teruskan' && (
        <ChatTeruskanDialog
          sesiId={selectedSession.id}
          namaPengunjung={namaPengunjung(selectedSession)}
          layanan={layananChat}
          layananSaranId={selectedSession.layanan_id}
          topikFo={topikFo}
          onClose={tutupDialog}
          onBerhasil={onTeruskanBerhasil}
          onGalat={onDialogGalat}
        />
      )}
      {selectedSession && dialog === 'selesai' && (
        <ChatSelesaiDialog
          sesiId={selectedSession.id}
          namaPengunjung={namaPengunjung(selectedSession)}
          peran={peranPemilik(selectedSession)}
          layananId={tahapDari(selectedSession)?.layanan_id ?? selectedSession.layanan_id}
          topikFo={topikFo}
          onClose={tutupDialog}
          onBerhasil={onSelesaiBerhasil}
          onGalat={onDialogGalat}
        />
      )}
    </>
  );
}
