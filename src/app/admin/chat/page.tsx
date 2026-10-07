'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare,
  Bot,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import { truncate, relativeTime } from '@/lib/utils';
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

const statusConfig = {
  bot: { label: 'Bot', icon: <Bot size={12} />, className: 'badge--bot' },
  eskalasi: { label: 'Menunggu Petugas', icon: <AlertCircle size={12} />, className: 'badge--eskalasi' },
  aktif: { label: 'Aktif', icon: <MessageSquare size={12} />, className: 'badge--aktif' },
  selesai: { label: 'Selesai', icon: <CheckCircle2 size={12} />, className: 'badge--selesai' },
};

export default function AdminChatPage() {
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

  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const layananFilterRef = useRef<string | null>(null);
  const showSelesaiRef = useRef(false);
  const listSeq = useRef(0);
  const msgSeq = useRef(0);
  // client_uuid dipertahankan selama teks yang sama belum terkirim, sehingga
  // klik ulang setelah gagal bersifat idempoten di server.
  const pendingSend = useRef<{ text: string; uuid: string } | null>(null);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Daftar sesi: satu RPC ringkas (tanpa memuat semua pesan). Urutan respons
  // dijaga lewat nomor urut agar fetch lama tidak menimpa yang baru.
  const fetchSessions = useCallback(async () => {
    const seq = ++listSeq.current;
    const supabase = createClient();
    const { data, error } = await supabase.rpc('chat_sesi_ringkas', {
      p_limit: 100,
      p_include_selesai: showSelesaiRef.current,
    });
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
    setSessions(rows);
  }, [toast]);

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
            if (petugas.role === 'petugas') layananFilterRef.current = petugas.layanan_id;
          }
        }

        // Nama layanan & petugas: tabel kecil, diambil sekali (best-effort).
        const [{ data: lay }, { data: pet }] = await Promise.all([
          supabase.from('layanan').select('id, nama'),
          supabase.from('petugas').select('id, nama'),
        ]);
        if (active) {
          setLayananNama(Object.fromEntries((lay ?? []).map((l) => [l.id, l.nama])));
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
      const next = { ...c, [session.id]: session.last_pesan_at };
      // Sesi yang ditinggalkan: tandai terbaca sampai pesan lebih baru.
      const prevRow = selectedId ? sessions.find((s) => s.id === selectedId) : null;
      if (prevRow) next[prevRow.id] = prevRow.last_pesan_at;
      return next;
    });
    // Nama pengunjung tidak ada di RPC ringkas: ambil satu baris saat dibuka.
    if (!kontak[session.id]) {
      createClient()
        .from('chat_sesi')
        .select('kontak_pengunjung')
        .eq('id', session.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.kontak_pengunjung) {
            setKontak((k) => ({ ...k, [session.id]: data.kontak_pengunjung as string }));
          }
        });
    }
  };

  const holderName = (s: RingkasRow) =>
    s.ditangani_oleh ? petugasNama[s.ditangani_oleh] ?? 'petugas lain' : null;
  const isMine = (s: RingkasRow) => !s.ditangani_oleh || s.ditangani_oleh === myPetugasId;
  // Boleh membalas hanya bila sesi aktif dan dipegang petugas ini.
  const canReply = !!selectedSession && selectedSession.status === 'aktif' && isMine(selectedSession);

  const sesiAction = async (aksi: 'takeover' | 'kembali_ke_bot' | 'selesaikan', okMsg: string, failMsg: string) => {
    if (!selectedSession) return;
    try {
      const res = await fetch('/api/chat/sesi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sesi_id: selectedSession.id, aksi }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const holder = body?.holder?.nama ? ` (ditangani ${body.holder.nama})` : '';
        throw new Error(`${body.error ?? failMsg}${res.status === 409 ? holder : ''}`);
      }
      toast(okMsg, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : failMsg, 'error');
    } finally {
      // Status sesungguhnya dari server (juga untuk kasus 409).
      fetchSessions();
      loadMessages();
    }
  };

  const handleAmbilAlih = () => {
    if (!selectedSession) return;
    const holder = selectedSession.status === 'aktif' && !isMine(selectedSession) ? holderName(selectedSession) : null;
    if (holder && !window.confirm(`Chat ini sedang ditangani ${holder}. Ambil alih sekarang?`)) return;
    sesiAction('takeover', 'Berhasil mengambil alih chat', 'Gagal mengambil alih chat');
  };
  const handleKembalikanKeBot = () =>
    sesiAction('kembali_ke_bot', 'Sesi dikembalikan ke bot', 'Gagal mengembalikan sesi ke bot');
  const handleSelesaikanSesi = () =>
    sesiAction('selesaikan', 'Sesi chat diselesaikan', 'Gagal menyelesaikan sesi');

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
    p === 'petugas' ? 'Petugas' : p === 'bot' ? 'BOT FAQ' : 'Pengunjung';

  return (
    <>
      <PageHeader
        title="Live Chat"
        description="Panel petugas — tangani chat pengunjung yang masuk"
      />

      <div style={{
        display: 'flex',
        height: 'calc(100vh - var(--header-height) - 80px)',
        margin: 'var(--space-8)',
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        border: '1px solid var(--border-default)',
        background: 'var(--surface-elevated)',
      }}>
        {/* Session List */}
        <div style={{
          width: '340px',
          borderRight: '1px solid var(--border-default)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface-primary)',
        }}>
          <div style={{
            padding: 'var(--space-4)',
            borderBottom: '1px solid var(--border-default)',
            fontWeight: 600,
            fontSize: 'var(--text-sm)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Sesi Chat ({sessions.filter(s => s.status !== 'selesai').length} aktif)</span>
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
            ) : sessions.map((session) => {
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
                      {config.icon} {config.label}
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {selectedSession ? (
            <>
              {/* Thread Header */}
              <div style={{
                padding: 'var(--space-4)',
                borderBottom: '1px solid var(--border-default)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--surface-primary)',
              }}>
                <div>
                  <h3 style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginBottom: '4px' }}>
                    {kontak[selectedSession.id] || 'Pengunjung'}
                  </h3>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    Layanan: {layananNama[selectedSession.layanan_id] || '—'}
                    {selectedSession.status === 'aktif' && (
                      <> · Ditangani oleh {isMine(selectedSession) && myPetugasId ? 'Anda' : holderName(selectedSession) ?? '—'}</>
                    )}
                  </div>
                </div>
                {selectedSession.status !== 'selesai' && (
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    {!canReply && (
                      <button className="btn btn--primary btn--sm" onClick={handleAmbilAlih}>
                        Ambil Alih Chat
                      </button>
                    )}
                    {selectedSession.status === 'aktif' && isMine(selectedSession) && (
                      <button className="btn btn--secondary btn--sm" onClick={handleKembalikanKeBot}>
                        Kembalikan ke Bot
                      </button>
                    )}
                    <button className="btn btn--secondary btn--sm" onClick={handleSelesaikanSesi}>
                      Selesaikan Chat
                    </button>
                  </div>
                )}
              </div>

              {selectedSession.status !== 'selesai' ? (
                <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface-primary)', borderBottom: '1px solid var(--border-default)' }}>
                        {!canReply && (
                          <div role="status" style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                            {selectedSession.status === 'aktif'
                              ? `Chat ini sedang ditangani ${holderName(selectedSession) ?? 'petugas lain'}. Tekan "Ambil Alih Chat" untuk membalas.`
                              : 'Tekan "Ambil Alih Chat" untuk mulai membalas pengunjung.'}
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
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <MainContainer responsive>
                  <ChatContainer>
                    <MessageList>
                      {messages.map((msg) => (
                        <ChatMessage
                          key={msg.id}
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
                        placeholder={canReply ? 'Ketik balasan Anda...' : 'Ambil alih chat untuk membalas'}
                        value={messageInput}
                        onChange={(val) => setMessageInput(val)}
                        onSend={(_html, textContent) => handleSendMessage(textContent)}
                        attachButton={false}
                        disabled={!canReply || sending}
                      />
                    )}
                  </ChatContainer>
                </MainContainer>
                <div ref={messagesEndRef} />
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
    </>
  );
}
