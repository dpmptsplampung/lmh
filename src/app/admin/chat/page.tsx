'use client';

import { Fragment, useState, useEffect, useRef, useCallback } from 'react';
import GambarLampiran from '@/components/chat/GambarLampiran';
import { unggahLampiranChat } from '@/lib/chat/lampiran-klien';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  MessageSquare,
  Wifi,
  WifiOff,
  UserCheck,
  UserCog,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import { truncate, relativeTime, formatTanggal, formatWaktu } from '@/lib/utils';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Galat from '@/components/ui/Galat';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Tombol from '@/components/ui/Tombol';
import { urlLoginAlasan } from '@/lib/sesi-staf';
import {
  GalatAksiChat,
  JENIS_PENUTUP_SURVEI,
  kirimAksiChat,
  kodeChatPerluMuatUlang,
  type HasilChatAmbil,
  type HasilChatSelesai,
  type HasilChatTeruskan,
  type PeranTahapChat,
} from '@/lib/chat-staf';
import type { TopikFo } from '@/lib/fo-penanganan';
import { bersihkanPenutup } from '@/lib/chat/percakapan';
import { muatStatusLayananChat, type StatusLayananChat } from '@/lib/chat/status-layanan';
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
  bot: { label: 'Bot' },
  eskalasi: { label: 'Menunggu Diambil' },
  aktif: { label: 'Aktif' },
  selesai: { label: 'Selesai' },
};

export default function AdminChatPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<RingkasRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Cadangan bila sesi terpilih hilang dari daftar (mis. selesai & disembunyikan).
  const [snapshot, setSnapshot] = useState<RingkasRow | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  // Riwayat percakapan (semua sesi pengunjung + Layanan yang sama) dipaginasi mundur; true = ada pesan lebih lama.
  const [riwayatAdaLebih, setRiwayatAdaLebih] = useState(false);
  const [riwayatMemuat, setRiwayatMemuat] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [daftarDimuat, setDaftarDimuat] = useState(false);
  const [daftarGalat, setDaftarGalat] = useState('');
  const [penanganGalat, setPenanganGalat] = useState(false);
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
  const { toast } = useToast();
  const selectedIdRef = useRef<string | null>(null);
  const layananFilterRef = useRef<string | null>(null);
  const showSelesaiRef = useRef(false);
  const listSeq = useRef(0);
  const msgSeq = useRef(0);
  const riwayatSeq = useRef(0);
  // client_uuid dipertahankan selama teks yang sama belum terkirim, sehingga
  // klik ulang setelah gagal bersifat idempoten di server.
  const pendingSend = useRef<{ text: string; uuid: string } | null>(null);
  const aksiRef = useRef(false);
  // Tautan dari Kotak Masuk FO (?sesi=<id>): sesi dibuka otomatis begitu daftar termuat.
  const deepLinkRef = useRef<string | null>(null);

  const selectedSession =
    sessions.find((s) => s.id === selectedId) ??
    (snapshot && snapshot.id === selectedId ? snapshot : null);

  // Hari tanpa pelayanan PER LAYANAN (Fase 5, spec §4.4: jadwal per Layanan = satu sumber kebenaran; menggantikan kalender
  // global Sabtu/Minggu/hari_libur). Layanan sesi terpilih tidak beroperasi hari ini: chat tidak dapat diambil, diambil
  // alih, atau diteruskan (DB menolak HARI_TANPA_LAYANAN). Tombol dinonaktifkan dengan alasan; pemegang chat tetap dapat
  // membalas dan menyelesaikan. Gagal menilai = tombol tetap aktif; DB tetap penegak.
  const layananTerpilihId = selectedSession?.layanan_id ?? null;
  const [statusStaf, setStatusStaf] = useState<{ layananId: string; status: StatusLayananChat } | null>(null);
  useEffect(() => {
    if (!layananTerpilihId) return;
    let batal = false;
    Promise.resolve()
      .then(() => muatStatusLayananChat(createClient(), layananTerpilihId))
      .then((status) => {
        if (!batal) setStatusStaf({ layananId: layananTerpilihId, status });
      })
      .catch(() => {
        /* gagal menilai: tombol tetap aktif */
      });
    return () => {
      batal = true;
    };
  }, [layananTerpilihId]);
  const statusLayananStaf = statusStaf && statusStaf.layananId === layananTerpilihId ? statusStaf.status : null;
  const tanpaLayanan = !!statusLayananStaf?.hariTanpaLayanan;
  const alasanTanpaLayanan = statusLayananStaf?.hariTanpaLayanan
    ? `Chat tidak dapat diambil atau diteruskan karena ${layananNama[layananTerpilihId ?? ''] ?? 'layanan ini'} tidak beroperasi hari ini` +
      `${statusLayananStaf.liburKeterangan ? ` (hari libur: ${statusLayananStaf.liburKeterangan})` : ' (di luar jadwal)'}. ` +
      'Pengunjung hanya dilayani asisten virtual; chat yang menunggu tidak ditutup otomatis sebelum ada hari operasional Layanan.'
    : null;

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
    try {
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
        setDaftarGalat('Gagal memuat sesi chat');
        setDaftarDimuat(true);
        toast('Gagal memuat sesi chat', 'error');
        return;
      }
      setDaftarGalat('');
      setDaftarDimuat(true);
      setPenanganGalat(!!resTahap.error);
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
    } catch {
      if (seq !== listSeq.current) return;
      setDaftarGalat('Gangguan jaringan. Sesi chat tidak dapat dimuat.');
      setDaftarDimuat(true);
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
        setDaftarGalat('Gagal menginisialisasi chat. Coba muat daftar kembali.');
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
  // slowMs 60 dtk (Fase 5): event Realtime untuk baris yang keluar dari lingkup (mis. chat ditutup rekan) tidak terkirim,
  // jadi daftar disegarkan pelan walau Realtime sehat.
  useFallbackPoll(fetchSessions, rt, { fastMs: 15000, slowMs: 60000, enabled: !loading });

  // Ganti filter "selesai" -> muat ulang daftar (bukan saat render awal).
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    fetchSessions();
  }, [showSelesai, fetchSessions]);

  // riwayat=true (hanya saat sesi dipilih): seluruh percakapan lintas sesi (lingkup ditegakkan route/DB). Poll dan
  // Realtime memuat sesi terpilih saja.
  const loadMessages = useCallback(async (opsi?: { riwayat?: boolean }) => {
    const id = selectedIdRef.current;
    if (!id) return;
    // Muat riwayat punya nomor urut sendiri: poll sesi terpilih yang berjalan bersamaan tidak boleh membuangnya.
    const urutan = opsi?.riwayat ? riwayatSeq : msgSeq;
    const seq = ++urutan.current;
    try {
      const res = await fetch(`/api/chat/messages?sesi_id=${id}${opsi?.riwayat ? '&riwayat=1' : ''}`);
      if (!res.ok) return;
      const data = await res.json();
      // Abaikan respons usang: sesi sudah berganti atau ada fetch yang lebih baru.
      if (seq !== urutan.current || id !== selectedIdRef.current) return;
      if (data.messages) setMessages((prev) => mergeMessages(prev, data.messages as Message[]));
      if (opsi?.riwayat) setRiwayatAdaLebih(!!data.ada_lebih);
    } catch {
      /* jaringan putus: poll/refetch berikutnya akan mencoba lagi */
    }
  }, []);

  const muatRiwayatLebihLama = async () => {
    const id = selectedIdRef.current;
    const tertua = messages.find((m) => !m.local)?.created_at;
    if (!id || !tertua || riwayatMemuat) return;
    setRiwayatMemuat(true);
    try {
      const res = await fetch(`/api/chat/messages?sesi_id=${id}&riwayat=1&sebelum=${encodeURIComponent(tertua)}`);
      if (!res.ok || id !== selectedIdRef.current) return;
      const data = await res.json();
      if (data.messages) setMessages((prev) => mergeMessages(prev, data.messages as Message[]));
      setRiwayatAdaLebih(!!data.ada_lebih);
    } catch {
      /* tombol tetap ada: coba lagi */
    } finally {
      setRiwayatMemuat(false);
    }
  };

  // Utas pesan: kunci pada id sesi (bukan objek) supaya refresh daftar tidak
  // memicu muat ulang. Pesan sesi lain tidak terbawa.
  useEffect(() => {
    if (selectedId) void loadMessages({ riwayat: true });
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
      setRiwayatAdaLebih(false);
      setMessageInput('');
      setSendError('');
      pendingSend.current = null;
      msgSeq.current++;
      riwayatSeq.current++;
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

  // Kirim foto sebagai balasan petugas (hanya-lampiran), memakai izin yang sama dengan balasan teks.
  const berkasRef = useRef<HTMLInputElement>(null);
  const [mengirimFoto, setMengirimFoto] = useState(false);
  const kirimFoto = async (berkas: File | undefined) => {
    if (!berkas || !selectedSession || sending || mengirimFoto || !canReply) return;
    const sesiId = selectedSession.id;
    setMengirimFoto(true);
    try {
      const lampiran = await unggahLampiranChat(sesiId, berkas);
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sesi_id: sesiId, isi: '', lampiran, client_uuid: crypto.randomUUID() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Foto gagal dikirim');
      if (sesiId === selectedIdRef.current && body.message) setMessages((prev) => mergeMessages(prev, [body.message as Message]));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Foto gagal dikirim', 'error');
    } finally {
      setMengirimFoto(false);
    }
  };

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

  // Pembatas sesi hanya bila percakapan memuat lebih dari satu sesi (riwayat lintas sesi, Fase 5).
  const banyakSesi = new Set(messages.map((m) => m.sesi_id).filter(Boolean)).size > 1;
  const tanggalSesi = (iso: string) => formatTanggal(iso);
  const namaSender = (p: Message['pengirim']) =>
    p === 'petugas' ? 'Petugas' : p === 'bot' ? 'Bot FAQ' : 'Pengunjung';

  const menunggu = sessions.filter((s) => s.status === 'eskalasi').length;
  // Chat yang menunggu diambil (kotak masuk) tampil paling atas; urutan lain tetap (sort stabil).
  const sessionsUrut = [...sessions].sort((a, b) => Number(b.status === 'eskalasi') - Number(a.status === 'eskalasi'));

  const nadaStatus: Record<Status, NadaLencana> = { bot: 'netral', eskalasi: 'peringatan', aktif: 'primer', selesai: 'sukses' };

  return (
    <>
      <PageHeader title="Live Chat" description="Tangani percakapan pengunjung, teruskan ke layanan, dan catat hasil penanganan." />
      <div className={styles.halaman}>
        {myRole === 'petugas' && (
          <CatatanKeadaan jenis="lingkup">Menampilkan percakapan dalam lingkup layanan Anda.</CatatanKeadaan>
        )}
        {alasanTanpaLayanan && (
          <div role="status" data-testid="admin-chat-hari-tanpa-layanan" id="alasan-hari-tanpa-layanan">
            <CatatanKeadaan jenis="tanpa-layanan">{alasanTanpaLayanan}</CatatanKeadaan>
          </div>
        )}
        {peringatan && (
          <CatatanKeadaan jenis="info" aksi={<Tombol varian="hantu" ukuran="kecil" onClick={() => setPeringatan(null)}>Tutup</Tombol>}>
            {peringatan}
          </CatatanKeadaan>
        )}
        {penanganGalat && <Galat pesan="Gagal memuat status penanganan chat. Periksa status sebelum mengambil tindakan." onRetry={() => void fetchSessions()} />}
        <div className={styles.layout} data-selected={selectedSession ? 'true' : 'false'}>
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
              {daftarDimuat && !daftarGalat && (
                <p className={styles.listSummary}>{sessions.filter(s => s.status !== 'selesai').length} aktif{menunggu > 0 ? `, ${menunggu} menunggu diambil` : ''}</p>
              )}
              {rt !== 'ok' && <p className={styles.listSummary}>Pembaruan berkala saat realtime belum tersambung.</p>}
              <label className={styles.showClosed}>
                <input type="checkbox" checked={showSelesai} onChange={(e) => setShowSelesai(e.target.checked)} />
                Tampilkan sesi selesai
              </label>
            </div>
            <div className={styles.sessions}>
              {daftarGalat ? (
                <Galat pesan={daftarGalat} onRetry={() => void fetchSessions()} />
              ) : loading || !daftarDimuat ? (
                <div className={styles.listState} role="status"><Skeleton bentuk="baris" jumlah={5} label="Memuat sesi chat…" /></div>
              ) : sessions.length === 0 ? (
                <StatusKosong ikon={MessageSquare} judul="Belum ada sesi chat" isi="Percakapan pengunjung akan tampil di sini." />
              ) : sessionsUrut.map((session) => {
                const unread = session.id !== selectedId && session.unread && cleared[session.id] !== session.last_pesan_at;
                const holder = session.status === 'aktif' ? holderName(session) : null;
                return (
                  <button
                    type="button"
                    key={session.id}
                    onClick={() => handleSelectSession(session)}
                    className={styles.session}
                    aria-pressed={selectedId === session.id}
                  >
                    <span className={styles.sessionTop}>
                      <span className={styles.sessionService}>{layananNama[session.layanan_id] || 'Layanan'}</span>
                      <Lencana nada={nadaStatus[session.status]}>{labelStatus(session)}</Lencana>
                    </span>
                    {session.last_pesan && <span className={styles.preview}>{truncate(session.last_pesan, 40)}</span>}
                    <span className={styles.sessionMeta}>
                      <span>{holder ? `Ditangani: ${holder}` : kontak[session.id] || 'Pengunjung'}</span>
                      <span className={styles.sessionTime}>
                        {unread && <span className={styles.unread} aria-label="Pesan belum dibalas" />}
                        <time dateTime={session.last_pesan_at ?? session.created_at} title={`${formatTanggal(session.last_pesan_at ?? session.created_at)} ${formatWaktu(session.last_pesan_at ?? session.created_at)} WIB`}>
                          {relativeTime(session.last_pesan_at ?? session.created_at)}
                        </time>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
          <section className={styles.thread} aria-label="Percakapan terpilih">
            {selectedSession ? (
              <>
                <div className={styles.threadHeader}>
                  <div className={styles.threadIdentity}>
                    <Tombol varian="sekunder" ukuran="kecil" ikon={ArrowLeft} className={styles.backBtn} onClick={handleBackToList}>Daftar sesi</Tombol>
                    <h2>{kontak[selectedSession.id] || 'Pengunjung'}</h2>
                    <p>
                      Layanan: {layananNama[selectedSession.layanan_id] || '—'}
                      {selectedSession.status === 'aktif' && <> · Ditangani oleh {isOwner(selectedSession) ? 'Anda' : holderName(selectedSession) ?? '—'}</>}
                      {selectedSession.status === 'eskalasi' && <> · {menungguLayanan(selectedSession) ? 'Diteruskan, menunggu petugas layanan' : 'Menunggu diambil'}</>}
                    </p>
                  </div>
                  {selectedSession.status !== 'selesai' && (
                    <div className={styles.threadActions}>
                      {bolehAmbil(selectedSession) && (
                        <Tombol ukuran="kecil" ikon={UserCheck} onClick={() => void handleAmbil()} disabled={aksiBusy || tanpaLayanan} memuat={aksiBusy} title={alasanTanpaLayanan ?? undefined} aria-describedby={tanpaLayanan ? 'alasan-hari-tanpa-layanan' : undefined}>Ambil Chat</Tombol>
                      )}
                      {bolehAmbilAlih(selectedSession) && (
                        <Tombol ukuran="kecil" ikon={UserCog} onClick={() => setDialog('ambil_alih')} disabled={aksiBusy || tanpaLayanan} title={alasanTanpaLayanan ?? undefined} aria-describedby={tanpaLayanan ? 'alasan-hari-tanpa-layanan' : undefined}>Ambil Alih Chat</Tombol>
                      )}
                      {bolehTeruskan(selectedSession) && (
                        <Tombol varian="sekunder" ukuran="kecil" ikon={ArrowRight} onClick={() => setDialog('teruskan')} disabled={aksiBusy || tanpaLayanan} title={alasanTanpaLayanan ?? undefined} aria-describedby={tanpaLayanan ? 'alasan-hari-tanpa-layanan' : undefined}>Teruskan ke Layanan</Tombol>
                      )}
                      {isOwner(selectedSession) && <Tombol varian="sekunder" ukuran="kecil" onClick={() => setDialog('selesai')} disabled={aksiBusy}>Selesaikan Chat</Tombol>}
                    </div>
                  )}
                </div>
                {selectedSession.status !== 'selesai' ? (
                  <div className={styles.replyTools}>
                    {!canReply && (
                      <p role="status" className={styles.replyNote}>
                        {alasanTanpaLayanan
                          ? dipegangLain(selectedSession)
                            ? `Chat ini sedang ditangani ${holderName(selectedSession) ?? 'petugas lain'}. ${alasanTanpaLayanan}`
                            : alasanTanpaLayanan
                          : dipegangLain(selectedSession)
                            ? `Chat ini sedang ditangani ${holderName(selectedSession) ?? 'petugas lain'}.${bolehAmbilAlih(selectedSession) ? ' Tekan "Ambil Alih Chat" (alasan wajib) untuk membalas.' : ''}`
                            : menungguLayanan(selectedSession) && !bolehAmbil(selectedSession)
                              ? 'Chat ini sudah diteruskan ke petugas layanan. Petugas layanan yang akan mengambilnya.'
                              : 'Tekan "Ambil Chat" untuk mulai membalas pengunjung.'}
                      </p>
                    )}
                    {sendError && <p role="alert" className={styles.sendError}>{sendError}</p>}
                    <div className={styles.draftTools}>
                      <Tombol varian="sekunder" ukuran="kecil" ikon={Sparkles} onClick={handleGenerateDraft} disabled={loadingDraft || !canReply} memuat={loadingDraft} title="Minta Gemini memuatkan draf balasan berbasis FAQ & Dasar Hukum">Draf Gemini</Tombol>
                    </div>
                  </div>
                ) : <p className={styles.closedNote}>Sesi chat ini sudah selesai.</p>}
                <div className={ui.shell}>
                  <MainContainer responsive>
                    <ChatContainer>
                      <MessageList>
                        {riwayatAdaLebih && (
                          <div className={styles.history}>
                            <Tombol varian="sekunder" ukuran="kecil" onClick={() => void muatRiwayatLebihLama()} disabled={riwayatMemuat} memuat={riwayatMemuat}>Muat riwayat sebelumnya</Tombol>
                          </div>
                        )}
                        {messages.map((msg, i) => {
                          const sebelumnya = messages[i - 1];
                          const pembatas = banyakSesi && msg.sesi_id && (!sebelumnya || sebelumnya.sesi_id !== msg.sesi_id);
                          return (
                            <Fragment key={msg.client_uuid ?? msg.id}>
                              {pembatas && <div role="separator" aria-label={`Sesi ${tanggalSesi(msg.created_at)}`} className={styles.sessionDivider}>Sesi {tanggalSesi(msg.created_at)}</div>}
                              <ChatMessage model={{
                                message: msg.jenis_jawaban === JENIS_PENUTUP_SURVEI ? bersihkanPenutup(msg.isi) : msg.isi,
                                sentTime: `${formatWaktu(msg.created_at)} WIB`,
                                sender: namaSender(msg.pengirim),
                                direction: msg.pengirim === 'petugas' ? 'outgoing' : 'incoming',
                                position: 'single',
                              }}>
                                <ChatMessage.Header sender={namaSender(msg.pengirim)} sentTime={`${formatWaktu(msg.created_at)} WIB`} />
                                {msg.lampiran_kunci && <ChatMessage.CustomContent><GambarLampiran pesanId={msg.id} nama={msg.lampiran_nama} /></ChatMessage.CustomContent>}
                              </ChatMessage>
                            </Fragment>
                          );
                        })}
                      </MessageList>
                      <input ref={berkasRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void kirimFoto(e.target.files?.[0]); e.target.value = ''; }} />
                      {/* MessageInput harus anak langsung ChatContainer agar alur kirim dan lampiran tetap bekerja. */}
                      {selectedSession.status !== 'selesai' && (
                        <MessageInput placeholder={canReply ? 'Ketik balasan Anda...' : 'Ambil chat untuk membalas'} value={messageInput} onChange={(val) => setMessageInput(val)} onSend={(_html, _text, innerText) => handleSendMessage(innerText)} attachButton={canReply} onAttachClick={() => berkasRef.current?.click()} disabled={!canReply || sending || mengirimFoto} />
                      )}
                    </ChatContainer>
                  </MainContainer>
                </div>
              </>
            ) : (
              <div className={styles.threadEmpty}><StatusKosong ikon={MessageSquare} judul="Pilih sesi chat di samping untuk mulai membalas" isi="Riwayat percakapan dan aksi penanganan tampil setelah sesi dipilih." /></div>
            )}
          </section>
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
