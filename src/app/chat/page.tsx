'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeft,
  Bot,
  MessageSquare,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { LAYANAN_LIST } from '@/lib/constants';
import styles from './chat.module.css';
import { mergeMessages, rtFromStatus, useFallbackPoll, useOnSubscribed, waktuLabel, type ChatMsg, type RtState } from './merge';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message as ChatMessage,
  MessageInput,
  TypingIndicator,
} from '@chatscope/chat-ui-kit-react';

interface Layanan {
  id: string;
  nama: string;
  chatbot_aktif: boolean;
}

type Message = ChatMsg;

interface FAQ {
  id: string;
  pertanyaan: string;
  jawaban: string;
}

const AI_SLOW_MS = 20000; // tampilkan "masih diproses"
const AI_TIMEOUT_MS = 65000; // server maxDuration 60 dtk

const CONSENT_VERSION = '1.0';
const CONSENT_TEXT = 'Saya setuju data saya diproses sesuai Kebijakan Privasi.';
const PII_DISCLAIMER =
  'Asisten virtual menjawab berdasarkan FAQ resmi. Jangan membagikan data pribadi sensitif (NIK, nomor dokumen, kata sandi) melalui chat.';
const OFFLINE_BANNER_TEXT =
  'Anda sedang offline. Pesan tidak dapat dikirim dan tidak akan diterima petugas. Silakan coba lagi saat koneksi kembali.';

export default function PublicChatPage() {
  const [layananList, setLayananList] = useState<Layanan[]>([]);
  const [loadingLayanan, setLoadingLayanan] = useState(true);

  // Auth States
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // K2: pengunjung row id — dipakai untuk mengisi chat_sesi.pengunjung_id
  // supaya RLS bisa verifikasi kepemilikan sesi (pengunjung.auth_user_id = auth.uid()).
  const [pengunjungId, setPengunjungId] = useState<string | null>(null);

  // Sesi Setup States
  const [visitorName, setVisitorName] = useState('');
  const [selectedLayananId, setSelectedLayananId] = useState('');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [sesiId, setSesiId] = useState<string | null>(null);
  const [loadingSetup, setLoadingSetup] = useState(false);

  // Chat Thread States
  const [messages, setMessages] = useState<Message[]>([]);
  const [sesiStatus, setSesiStatus] = useState<'bot' | 'eskalasi' | 'aktif' | 'selesai'>('bot');
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [isBotTyping, setIsBotTyping] = useState(false);

  // I8: PDP consent — required before starting chat session
  const [consentGiven, setConsentGiven] = useState(false);

  // Offline detection: pesan TIDAK boleh disimpan ke sesi palsu — tampilkan
  // banner jujur + nonaktifkan input selama offline.
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [setupError, setSetupError] = useState('');

  const threadEndRef = useRef<HTMLDivElement>(null);

  // Track koneksi browser (online/offline events)
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Cek Auth dan Profil Pengunjung
  useEffect(() => {
    async function checkUser() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          setIsLoggedIn(true);
          // K2: ambil id + nama pengunjung. id dipakai untuk chat_sesi.pengunjung_id
          // agar RLS (pengunjung.auth_user_id = auth.uid()) dapat verifikasi kepemilikan.
          let { data: profile } = await supabase
            .from('pengunjung')
            .select('id, nama')
            .eq('auth_user_id', user.id)
            .single();

          if (!profile) {
            // Belum ada baris pengunjung (mis. anon sign-in baru diaktifkan).
            // Buat baris pengunjung untuk user ini — policy pengunjung_self_insert
            // mengizinkan karena auth_user_id = auth.uid(). Lalu ambil id-nya.
            const fallbackName =
              user.user_metadata?.full_name ||
              user.email?.split('@')[0] ||
              'Pengunjung Anonim';
            const provider = user.is_anonymous ? 'anonymous' : 'google';
            const { data: inserted } = await supabase
              .from('pengunjung')
              .insert({
                auth_user_id: user.id,
                nama: fallbackName,
                email: user.email ?? null,
                provider,
              })
              .select('id, nama')
              .single();
            profile = inserted;
          }

          if (profile?.id) {
            setPengunjungId(profile.id);
          }
          if (profile?.nama) {
            setVisitorName(profile.nama);
          } else {
            // Fallback to Google name if profile not completed yet
            setVisitorName(
              user.user_metadata?.full_name ||
                user.email?.split('@')[0] ||
                '',
            );
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsCheckingAuth(false);
      }
    }
    checkUser();
  }, []);

  // Fetch FAQ knowledge base for selected service
  const fetchFAQs = useCallback(async (layananId: string) => {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('faq_knowledge_base')
        .select('id, pertanyaan, jawaban')
        .eq('layanan_id', layananId)
        .eq('aktif', true)
        .order('urutan', { ascending: true });

      setFaqs(data || []);
    } catch {
      // Fallback FAQs if database table doesn't exist yet or is empty
      setFaqs([
        { id: 'f1', pertanyaan: 'Apa saja syarat membuat NIB?', jawaban: 'Syarat utama pembuatan Nomor Induk Berusaha (NIB) adalah:\n1. KTP pemilik usaha\n2. NPWP pemilik usaha (opsional)\n3. Deskripsi kegiatan usaha.\n\nSemua proses dapat diakses online melalui sistem OSS RBA.' },
        { id: 'f2', pertanyaan: 'Berapa biaya pengurusan sertifikat Halal?', jawaban: 'Pengurusan sertifikat Halal dengan skema Self Declare untuk UMK mikro/kecil adalah GRATIS (tidak dipungut biaya) melalui program Sehati.' },
        { id: 'f3', pertanyaan: 'Bagaimana cara mendaftar BPJS Kesehatan?', jawaban: 'Pendaftaran BPJS Kesehatan Mandiri memerlukan:\n1. Kartu Keluarga (KK)\n2. KTP seluruh anggota keluarga\n3. Buku Rekening bank yang bekerja sama untuk autodebet.' },
      ]);
    }
  }, []);

  // Restore Session
  useEffect(() => {
    async function restoreSession() {
      const savedSesiId = localStorage.getItem('lmh_chat_sesi_id');
      const savedLayananId = localStorage.getItem('lmh_chat_layanan_id');

      if (savedSesiId && savedLayananId) {
        try {
          const supabase = createClient();
          
          // Verify session is still active
          const { data: sessionData, error: sessionErr } = await supabase
            .from('chat_sesi')
            .select('status, kontak_pengunjung')
            .eq('id', savedSesiId)
            .single();

          if (sessionErr || !sessionData || sessionData.status === 'selesai') {
            localStorage.removeItem('lmh_chat_sesi_id');
            localStorage.removeItem('lmh_chat_layanan_id');
            return;
          }

          setSesiId(savedSesiId);
          setSelectedLayananId(savedLayananId);
          setSesiStatus(sessionData.status);
          if (sessionData.kontak_pengunjung) {
            setVisitorName(sessionData.kontak_pengunjung);
          }
          setIsSessionActive(true);
          setConsentGiven(true);

          await fetchFAQs(savedLayananId);

        } catch (e) {
          console.error('Error restoring session:', e);
        }
      }
    }
    
    // Only run if auth checking is finished and we are logged in (or we support anon)
    if (!isCheckingAuth) {
      restoreSession();
    }
  }, [isCheckingAuth, fetchFAQs]);

  // Load layanan
  useEffect(() => {
    async function loadLayanan() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('layanan')
          .select('id, nama, chatbot_aktif')
          .neq('tipe', 'modul_publik')
          .order('nama');

        if (error) throw error;
        setLayananList(data || []);
      } catch {
        setLayananList(
          LAYANAN_LIST.map((nama, i) => ({
            id: `fallback-${i}`,
            nama,
            chatbot_aktif: true,
          }))
        );
      } finally {
        setLoadingLayanan(false);
      }
    }
    loadLayanan();
  }, []);
  // Pre-select service from URL parameter (e.g. ?layanan=Bank+Lampung)
  useEffect(() => {
    if (layananList.length === 0) return;
    
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlLayanan = params.get('layanan');
      if (urlLayanan) {
        const found = layananList.find(
          (l) =>
            l.id === urlLayanan ||
            l.nama.toLowerCase() === urlLayanan.toLowerCase() ||
            l.nama.toLowerCase().includes(urlLayanan.toLowerCase())
        );
        if (found) {
          setTimeout(() => setSelectedLayananId(found.id), 0);
        }
      }
    }
  }, [layananList]);

  // Sinkron pesan: satu channel realtime (pesan + status sesi). Poll hanya
  // cadangan (lihat useFallbackPoll).
  const [rt, setRt] = useState<RtState>('connecting');
  const syncSeq = useRef(0);
  const sesiStatusRef = useRef(sesiStatus);
  useEffect(() => {
    sesiStatusRef.current = sesiStatus;
  }, [sesiStatus]);

  const applyStatus = useCallback((status: 'bot' | 'eskalasi' | 'aktif' | 'selesai') => {
    setSesiStatus(status);
    if (status === 'selesai') {
      localStorage.removeItem('lmh_chat_sesi_id');
      localStorage.removeItem('lmh_chat_layanan_id');
    }
  }, []);

  const syncMessages = useCallback(async () => {
    if (!sesiId) return;
    const seq = ++syncSeq.current;
    try {
      const res = await fetch(`/api/chat/messages?sesi_id=${sesiId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (seq !== syncSeq.current) return; // respons usang
      if (data.messages) setMessages((prev) => mergeMessages(prev, data.messages as Message[]));
      if (data.status) applyStatus(data.status);
    } catch {
      /* jaringan putus: sinkron berikutnya mencoba lagi */
    }
  }, [sesiId, applyStatus]);

  useEffect(() => {
    if (!sesiId) return;
    const supabase = createClient();
    let active = true;
    const channel = supabase
      .channel(`chat-sesi-${sesiId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_pesan', filter: `sesi_id=eq.${sesiId}` },
        (payload) => setMessages((prev) => mergeMessages(prev, [payload.new as Message])),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_sesi', filter: `id=eq.${sesiId}` },
        (payload) => applyStatus((payload.new as { status: 'bot' | 'eskalasi' | 'aktif' | 'selesai' }).status),
      )
      .subscribe((status) => {
        if (active) setRt(rtFromStatus(status));
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [sesiId, syncMessages, applyStatus]);

  const live = !!sesiId && sesiStatus !== 'selesai';
  // Catch-up saat channel SUBSCRIBED (awal & reconnect); poll hanya cadangan.
  useOnSubscribed(rt, syncMessages, live);
  useFallbackPoll(syncMessages, rt, { fastMs: 5000, slowMs: 30000, enabled: live });
  useEffect(() => {
    if (sesiId && rt !== 'ok') {
      const t = setTimeout(syncMessages, 0); // muat awal bila realtime belum tersambung
      return () => clearTimeout(t);
    }
  }, [sesiId, rt, syncMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleStartSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLayananId) return;
    if (!isOnline) {
      setSetupError(OFFLINE_BANNER_TEXT);
      return;
    }

    setLoadingSetup(true);
    setSetupError('');
    await fetchFAQs(selectedLayananId);

    const nama = visitorName.trim() || 'Pengunjung';
    const selectedLayanan = layananList.find((l) => l.id === selectedLayananId);

    try {
      const supabase = createClient();

      // I8: Record PDP consent only when user asserted consent checkbox.
      // subjek_ref must bind to auth.uid or owned pengunjung row (RLS).
      if (!consentGiven) {
        setLoadingSetup(false);
        return;
      }
      const authUserId = (await supabase.auth.getUser()).data?.user?.id;
      const consentRef = pengunjungId ?? authUserId;
      if (consentRef) {
        try {
          await supabase.from('consent_log').insert({
            subjek_ref: consentRef,
            tujuan: 'chat_followup',
            disetujui: true,
            versi_kebijakan: CONSENT_VERSION,
          });
        } catch {
          // Consent logging is best-effort: don't block the session if it fails.
        }
      }

      // K2: sertakan pengunjung_id agar RLS chat_sesi_owner_insert menerima
      // baris ini (harus dimiliki user: pengunjung.auth_user_id = auth.uid()).
      // Hanya sertakan bila pengunjungId sudah diketahui; untuk anon tanpa
      // baris pengunjung, kolom ini NULL dan sesi akan ditolak oleh RLS
      // (sesuai desain — anon harus membuat baris pengunjung dulu).
      const insertPayload: {
        layanan_id: string;
        kontak_pengunjung: string;
        status: string;
        pengunjung_id?: string;
      } = {
        layanan_id: selectedLayananId,
        kontak_pengunjung: nama,
        status: selectedLayanan?.chatbot_aktif ? 'bot' : 'eskalasi',
      };
      if (pengunjungId) {
        insertPayload.pengunjung_id = pengunjungId;
      }

      // Create session in database
      const { data: session, error } = await supabase
        .from('chat_sesi')
        .insert(insertPayload)
        .select()
        .single();

      if (error) throw error;

      setSesiId(session.id);
      setSesiStatus(session.status);
      
      // Save to local storage
      localStorage.setItem('lmh_chat_sesi_id', session.id);
      localStorage.setItem('lmh_chat_layanan_id', selectedLayananId);

      // Welcome Message
      const welcomeText = `Halo Bapak/Ibu ${nama}.\nSelamat datang di layanan Live Chat ${selectedLayanan?.nama || 'DPMPTSP'}.\n` +
        (selectedLayanan?.chatbot_aktif 
          ? 'Saya adalah asisten virtual (bot) yang siap menjawab pertanyaan Anda secara otomatis. Silakan pilih salah satu menu FAQ di bawah atau ketik langsung pertanyaan Anda.'
          : 'Layanan chatbot FAQ saat ini nonaktif. Kami sedang menghubungkan Anda ke petugas operasional. Mohon tunggu...');

      setMessages([
        {
          id: 'welcome',
          pengirim: 'bot',
          isi: welcomeText,
          created_at: new Date().toISOString(),
          local: 'notice',
        },
      ]);

      setIsSessionActive(true);
    } catch {
      // Offline jujur: JANGAN buat sesi palsu. Jika sesi gagal dibuat (umumnya
      // karena jaringan), beri tahu pengguna dan suruh coba lagi — pesan tidak
      // akan diterima petugas bila tidak tersimpan di database.
      setSetupError('Gagal memulai sesi chat. Periksa koneksi internet Anda lalu coba lagi.');
    }

    setLoadingSetup(false);
  };

  const notice = (isi: string, transient = false): Message => ({
    id: `notice-${crypto.randomUUID()}`,
    pengirim: 'bot',
    isi,
    created_at: new Date().toISOString(),
    local: 'notice',
    transient,
  });

  const postPesan = async (msg: Message): Promise<boolean> => {
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sesi_id: sesiId,
          pengirim: 'pengunjung',
          isi: msg.isi,
          client_uuid: msg.client_uuid,
        }),
      });
      if (!res.ok) throw new Error('Insert failed');
      const data = await res.json().catch(() => ({}));
      // Pesan server menggantikan pesan optimistic (client_uuid sama).
      if (data.message) setMessages((prev) => mergeMessages(prev, [data.message as Message]));
      else setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, local: undefined } : m)));
      return true;
    } catch {
      if (typeof navigator !== 'undefined' && !navigator.onLine) setIsOnline(false);
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, local: 'failed' } : m)));
      return false;
    }
  };

  const askAI = async (text: string) => {
    setIsBotTyping(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
    const slow = setTimeout(
      () => setMessages((prev) => [...prev, notice('Pertanyaan Anda masih diproses. Jawaban akan muncul otomatis di sini; tidak perlu mengirim ulang.', true)]),
      AI_SLOW_MS,
    );
    try {
      const res = await fetch('/api/chat/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pertanyaan: text, layanan_id: selectedLayananId, sesi_id: sesiId }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => null);

      if (res.status === 429) {
        setMessages((prev) => [...prev, notice('Anda mengirim pertanyaan terlalu cepat. Mohon tunggu sebentar lalu coba lagi.')]);
      } else if (!res.ok || !data) {
        setMessages((prev) => [...prev, notice('Maaf, asisten virtual sedang tidak tersedia. Silakan coba lagi beberapa saat.')]);
      } else {
        // Balasan bot sudah tersimpan di server: tampilkan langsung (dedupe
        // per id terhadap realtime/poll). Status hanya berubah bila server
        // yang mengonfirmasi.
        if (data.pesan) setMessages((prev) => mergeMessages(prev, [data.pesan as Message]));
        if (data.status) applyStatus(data.status);
        else if (data.eskalasi === true) setSesiStatus('eskalasi');
      }
    } catch {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setIsOnline(false);
      } else {
        setMessages((prev) => [
          ...prev,
          notice(
            ctrl.signal.aborted
              ? 'Asisten virtual belum menjawab. Jika jawaban belum muncul, tekan "Hubungkan ke Petugas".'
              : 'Maaf, asisten virtual sedang tidak tersedia. Silakan coba lagi beberapa saat.',
          ),
        ]);
        // Server bisa saja sudah menyimpan balasan/eskalasi: ambil kebenarannya.
        syncMessages();
      }
    } finally {
      clearTimeout(timer);
      clearTimeout(slow);
      setMessages((prev) => prev.filter((m) => !m.transient));
      setIsBotTyping(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    const isi = text.trim();
    if (!isi || !sesiId || !isOnline) return;
    if (sesiStatusRef.current === 'selesai') return;

    // Tampilkan dulu (optimistic) lalu simpan; client_uuid dipakai server &
    // realtime untuk dedupe.
    const clientUuid = crypto.randomUUID();
    const msg: Message = {
      id: `user-${clientUuid}`,
      pengirim: 'pengunjung',
      isi,
      created_at: new Date().toISOString(),
      client_uuid: clientUuid,
      local: 'pending',
    };
    setMessages((prev) => [...prev, msg]);

    const saved = await postPesan(msg);
    // AI hanya dipanggil saat sesi benar-benar mode bot.
    if (saved && sesiStatusRef.current === 'bot') await askAI(isi);
  };

  const handleRetry = async (msg: Message) => {
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, local: 'pending' } : m)));
    const saved = await postPesan(msg);
    if (saved && sesiStatusRef.current === 'bot') await askAI(msg.isi);
  };

  const handleEscalateManual = async () => {
    if (!sesiId || sesiStatus !== 'bot') return;

    // Eskalasi manual: kirim sebagai pertanyaan ke AI route — server akan
    // menandai sesi eskalasi + menyiarkan pesan bot. (Pengunjung tidak boleh
    // menulis status sesi / pesan bot secara langsung.)
    await handleSendMessage('Saya ingin berbicara dengan petugas loket.');
  };

  return (
    <div className={styles.chatPage}>
      {/* Navbar */}
      <header className={styles.chatHeader}>
        <Link href="/" className={styles.brand} style={{ display: 'flex', alignItems: 'center' }}>
          <Image 
            src="/logo.png" 
            alt="Lampung Maju Hub Logo" 
            width={120} 
            height={50} 
            style={{ objectFit: 'contain' }} 
            priority
          />
        </Link>
        <Link href="/" className={styles.backBtn}>
          <ArrowLeft size={16} />
          Kembali ke Web
        </Link>
      </header>

      {/* Main Container */}
      <div className={styles.chatContainer}>
        {!isSessionActive ? (
          /* Setup / Formulir Sesi Pertama */
          <div className={styles.setupState}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', background: 'var(--color-primary-50)',
                color: 'var(--color-primary-600)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto var(--space-4)', boxShadow: '0 8px 24px rgba(99, 102, 241, 0.15)'
              }}>
                <MessageSquare size={32} />
              </div>
              <h2 className={styles.setupTitle}>Mulai Konsultasi Online</h2>
              <p className={styles.setupDesc}>
                Silakan isi data diri singkat dan pilih layanan tujuan Anda untuk memulai sesi chat dengan petugas atau bot FAQ.
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5, margin: 0 }}>
                {PII_DISCLAIMER}
              </p>
            </div>

            {!isOnline && (
              <div
                role="alert"
                className="form-error"
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}
              >
                <AlertCircle size={16} />
                {OFFLINE_BANNER_TEXT}
              </div>
            )}
            {setupError && (
              <div
                role="alert"
                className="form-error"
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}
              >
                <AlertCircle size={16} />
                {setupError}
              </div>
            )}

            <form onSubmit={handleStartSession} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="chatName">Nama Anda</label>
                {!isCheckingAuth && !isLoggedIn ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                      Silakan login terlebih dahulu untuk menggunakan Live Chat.
                    </p>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={async () => {
                        const supabase = createClient();
                        await supabase.auth.signInWithOAuth({
                          provider: 'google',
                          options: {
                            redirectTo: `${window.location.origin}/auth/callback?next=/chat`,
                          },
                        });
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>
                      Masuk dengan Google
                    </button>
                  </div>
                ) : (
                  <input
                    id="chatName"
                    type="text"
                    className="form-input"
                    placeholder={isCheckingAuth ? "Memuat data profil..." : "Masukkan nama lengkap..."}
                    value={visitorName}
                    onChange={(e) => setVisitorName(e.target.value)}
                    required
                    readOnly={isLoggedIn}
                    style={{ background: isLoggedIn ? 'var(--surface-secondary)' : 'var(--surface-primary)', cursor: isLoggedIn ? 'not-allowed' : 'text' }}
                  />
                )}
              </div>

              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="chatLayanan">Layanan yang Ditanyakan</label>
                <select
                  id="chatLayanan"
                  className="form-select"
                  value={selectedLayananId}
                  onChange={(e) => setSelectedLayananId(e.target.value)}
                  disabled={loadingLayanan}
                  required
                >
                  <option value="">— Pilih layanan tujuan —</option>
                  {layananList.map((layanan) => (
                    <option key={layanan.id} value={layanan.id}>
                      {layanan.nama}
                    </option>
                  ))}
                </select>
              </div>

              {/* I8: PDP consent checkbox — required */}
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                <input
                  id="chatConsent"
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  style={{ marginTop: '4px', width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }}
                  required
                />
                <label
                  htmlFor="chatConsent"
                  style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', cursor: 'pointer', lineHeight: 1.5 }}
                >
                  {CONSENT_TEXT}{' '}
                  <Link
                    href="/kebijakan-privasi"
                    style={{ color: 'var(--color-primary-600)', textDecoration: 'underline' }}
                  >
                    Baca kebijakan
                  </Link>
                </label>
              </div>

              <button
                type="submit"
                className="btn btn--primary btn--lg"
                style={{ width: '100%', marginTop: 'var(--space-2)' }}
                disabled={loadingSetup || loadingLayanan || !isLoggedIn || !consentGiven || !isOnline}
              >
                {loadingSetup ? (
                  <><Loader2 size={20} className="animate-pulse" /> Memulai Sesi...</>
                ) : (
                  !isLoggedIn && !isCheckingAuth ? 'Login untuk Memulai' : 'Mulai Sesi Chat'
                )}
              </button>
            </form>
          </div>
        ) : (
          /* Active Chat Thread */
          <>
            {/* Status Bar */}
            <div className={`${styles.statusBar} ${
              sesiStatus === 'bot' 
                ? styles.statusBarBot 
                : (sesiStatus === 'eskalasi' ? styles.statusBarEskalasi : styles.statusBarAktif)
            }`}>
              {sesiStatus === 'bot' && (
                <>
                  <Bot size={14} />
                  <span>Mode Chatbot FAQ Aktif</span>
                  <button 
                    type="button" 
                    className="btn btn--secondary btn--sm" 
                    style={{ marginLeft: 'auto', padding: 'var(--space-1) var(--space-2)', fontSize: '10px' }}
                    onClick={handleEscalateManual}
                  >
                    Hubungkan ke Petugas
                  </button>
                </>
              )}
              {sesiStatus === 'eskalasi' && (
                <>
                  <Loader2 size={12} className="animate-pulse" />
                  <span>Menghubungkan ke petugas operasional loket... Mohon tunggu.</span>
                </>
              )}
              {sesiStatus === 'aktif' && (
                <>
                  <CheckCircle2 size={12} style={{ color: 'var(--color-success-500)' }} />
                  <span>Terhubung langsung dengan Petugas Loket</span>
                </>
              )}
              {sesiStatus === 'selesai' && (
                <>
                  <AlertCircle size={12} style={{ color: 'var(--color-danger-500)' }} />
                  <span>Sesi chat telah selesai / ditutup</span>
                </>
              )}
            </div>

            {/* Offline Banner */}
            {!isOnline && (
              <div
                role="alert"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-2) var(--space-4)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  background: 'var(--color-danger-50)',
                  color: 'var(--color-danger-700)',
                  borderBottom: '1px solid var(--border-default)',
                }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{OFFLINE_BANNER_TEXT}</span>
              </div>
            )}

            {/* Chatscope UI Container */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <MainContainer responsive>
                <ChatContainer>
                  <MessageList
                    typingIndicator={isBotTyping ? <TypingIndicator content="Bot FAQ sedang mengetik..." /> : undefined}
                  >
                    <div style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5, padding: 'var(--space-2) var(--space-4)' }}>
                      {PII_DISCLAIMER}
                    </div>
                    {messages.map((msg) => (
                      <ChatMessage
                        key={msg.id}
                        model={{
                          message: msg.isi,
                          sentTime: waktuLabel(msg.created_at),
                          sender: msg.pengirim === 'bot' ? 'BOT FAQ' : msg.pengirim === 'petugas' ? 'PETUGAS LOKET' : 'Anda',
                          direction: msg.pengirim === 'pengunjung' ? 'outgoing' : 'incoming',
                          position: 'single',
                        }}
                      >
                        <ChatMessage.Header sender={msg.pengirim === 'bot' ? 'BOT FAQ' : msg.pengirim === 'petugas' ? 'PETUGAS LOKET' : 'Anda'} sentTime={waktuLabel(msg.created_at)} />
                        {msg.local === 'pending' && <ChatMessage.Footer>Mengirim…</ChatMessage.Footer>}
                        {msg.local === 'failed' && (
                          <ChatMessage.Footer>
                            <span style={{ color: 'var(--color-danger-600)' }}>Gagal terkirim. </span>
                            <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleRetry(msg)}>
                              Kirim ulang
                            </button>
                          </ChatMessage.Footer>
                        )}
                      </ChatMessage>
                    ))}
                    
                    {/* Quick FAQ Chips embedded in MessageList as custom component if active */}
                    {sesiStatus === 'bot' && faqs.length > 0 && (
                      <div className={styles.quickFaqSection} style={{ marginTop: 'var(--space-4)', marginBottom: 'var(--space-2)' }}>
                        <span className={styles.quickFaqTitle}>FAQ Cepat:</span>
                        <div className={styles.quickFaqGrid}>
                          {faqs.map((faq) => (
                            <button
                              key={faq.id}
                              type="button"
                              className={styles.quickFaqBtn}
                              onClick={() => handleSendMessage(faq.pertanyaan)}
                            >
                              {faq.pertanyaan}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </MessageList>
                  
                  <MessageInput
                    placeholder={!isOnline ? 'Anda sedang offline...' : (sesiStatus === 'selesai' ? 'Sesi chat ditutup...' : 'Ketik pertanyaan Anda...')}
                    disabled={sesiStatus === 'selesai' || !isOnline}
                    attachButton={false}
                    onSend={(_html, textContent) => handleSendMessage(textContent)}
                  />
                </ChatContainer>
              </MainContainer>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
