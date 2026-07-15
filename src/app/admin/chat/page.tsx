'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare,
  User,
  Bot,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import { truncate, relativeTime } from '@/lib/utils';

interface Session {
  id: string;
  layanan_id: string;
  kontak_pengunjung: string | null;
  status: 'bot' | 'eskalasi' | 'aktif' | 'selesai';
  created_at: string;
  updated_at: string;
  layanan: { nama: string } | null;
  last_message?: string;
  last_message_at?: string;
  unread?: number;
}

interface Message {
  id: string;
  pengirim: 'pengunjung' | 'bot' | 'petugas';
  isi: string;
  created_at: string;
}

type SessionQueryRow = {
  id: string;
  layanan_id: string;
  kontak_pengunjung: string | null;
  status: 'bot' | 'eskalasi' | 'aktif' | 'selesai';
  created_at: string;
  updated_at: string;
  layanan: { nama: string } | { nama: string }[] | null;
};

const statusConfig = {
  bot: { label: 'Bot', icon: <Bot size={12} />, className: 'badge--bot' },
  eskalasi: { label: 'Menunggu Petugas', icon: <AlertCircle size={12} />, className: 'badge--eskalasi' },
  aktif: { label: 'Aktif', icon: <MessageSquare size={12} />, className: 'badge--aktif' },
  selesai: { label: 'Selesai', icon: <CheckCircle2 size={12} />, className: 'badge--selesai' },
};

export default function AdminChatPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastReadTimestamps, setLastReadTimestamps] = useState<Record<string, string>>({});

  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchSessions = useCallback(async (layananId: string | null) => {
    const supabase = createClient();
    let query = supabase
      .from('chat_sesi')
      .select(`
        id, layanan_id, kontak_pengunjung, status, created_at, updated_at,
        layanan:layanan_id ( nama )
      `)
      .order('updated_at', { ascending: false });

    if (layananId) {
      query = query.eq('layanan_id', layananId);
    }

    const { data, error: fetchErr } = await query;
    if (fetchErr) {
      toast('Gagal memuat sesi chat', 'error');
      return;
    }

    if (!data) return;

    const formatted: Session[] = (data as SessionQueryRow[]).map(d => ({
      ...d,
      layanan: Array.isArray(d.layanan) ? d.layanan[0] : d.layanan,
    }));

    const sessionIds = formatted.map(s => s.id);
    const latestMap: Record<string, { isi: string; created_at: string }> = {};

    if (sessionIds.length > 0) {
      const { data: latestMessages } = await supabase
        .from('chat_pesan')
        .select('sesi_id, isi, created_at')
        .in('sesi_id', sessionIds)
        .order('created_at', { ascending: false });

      for (const msg of latestMessages || []) {
        if (!latestMap[msg.sesi_id]) {
          latestMap[msg.sesi_id] = { isi: msg.isi, created_at: msg.created_at };
        }
      }
    }

    const withMessages: Session[] = formatted.map(s => ({
      ...s,
      last_message: latestMap[s.id]?.isi,
      last_message_at: latestMap[s.id]?.created_at,
    }));

    setSessions(withMessages);

    setSelectedSession(prev => {
      if (!prev) return prev;
      const updated = withMessages.find(s => s.id === prev.id);
      return updated || prev;
    });
  }, [toast]);

  // Effect 1: Load user + session list subscription (mount only)
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser();

        let layananId: string | null = null;

        if (user) {
          const { data: petugas } = await supabase
            .from('petugas')
            .select('role, layanan_id')
            .eq('auth_user_id', user.id)
            .single();

          if (petugas) {
            if (petugas.role === 'petugas') {
              layananId = petugas.layanan_id;
            }
          }
        }

        await fetchSessions(layananId);

        channel = supabase
          .channel('chat-sesi-changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_sesi' }, () => {
            fetchSessions(layananId);
          })
          .subscribe();
      } catch (e) {
        console.error(e);
        toast('Gagal menginisialisasi chat', 'error');
      } finally {
        setLoading(false);
      }
    }
    init();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [fetchSessions, toast]);

  // Effect 2: Message subscription (depends on selectedSession)
  useEffect(() => {
    if (!selectedSession) {
      return;
    }

    let active = true;
    const supabase = createClient();

    async function loadMessages() {
      const { data, error: fetchErr } = await supabase
        .from('chat_pesan')
        .select('id, pengirim, isi, created_at')
        .eq('sesi_id', selectedSession!.id)
        .order('created_at', { ascending: true });

      if (fetchErr) {
        toast('Gagal memuat pesan', 'error');
        return;
      }

      if (active && data) {
        setMessages(data as Message[]);
      }
    }

    loadMessages();

    const channel = supabase
      .channel(`chat-pesan-${selectedSession.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_pesan',
        filter: `sesi_id=eq.${selectedSession.id}`,
      }, (payload) => {
        setMessages(prev => {
          const newMsg = payload.new as Message;
          if (prev.find(m => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [selectedSession, toast]);

  const handleSelectSession = (session: Session) => {
    setSelectedSession(session);
    setLastReadTimestamps(prev => ({
      ...prev,
      [session.id]: new Date().toISOString(),
    }));
  };

  const unreadCount = (session: Session): number => {
    const lastRead = lastReadTimestamps[session.id];
    if (!lastRead) return 0;
    return messages.filter(
      m => m.pengirim === 'pengunjung' && m.created_at > lastRead
    ).length;
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedSession) return;

    const text = messageInput.trim();
    setMessageInput('');

    try {
      const supabase = createClient();
      const { error: insertErr } = await supabase.from('chat_pesan').insert({
        sesi_id: selectedSession.id,
        pengirim: 'petugas',
        isi: text,
      });

      if (insertErr) throw insertErr;

      if (selectedSession.status !== 'aktif' && selectedSession.status !== 'selesai') {
        const { error: updateErr } = await supabase
          .from('chat_sesi')
          .update({ status: 'aktif' })
          .eq('id', selectedSession.id);
        if (updateErr) throw updateErr;
      }
    } catch (err) {
      console.error(err);
      toast('Gagal mengirim pesan', 'error');
    }
  };

  const handleSelesaikanSesi = async () => {
    if (!selectedSession) return;
    try {
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from('chat_sesi')
        .update({ status: 'selesai' })
        .eq('id', selectedSession.id);
      if (updateErr) throw updateErr;
      toast('Sesi chat diselesaikan', 'success');
    } catch (err) {
      console.error(err);
      toast('Gagal menyelesaikan sesi', 'error');
    }
  };

  const handleAmbilAlih = async () => {
    if (!selectedSession) return;
    try {
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from('chat_sesi')
        .update({ status: 'aktif' })
        .eq('id', selectedSession.id);
      if (updateErr) throw updateErr;
      toast('Berhasil mengambil alih chat', 'success');
    } catch (err) {
      console.error(err);
      toast('Gagal mengambil alih chat', 'error');
    }
  };

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
            Sesi Chat ({sessions.filter(s => s.status !== 'selesai').length} aktif)
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
              const unread = session.id === selectedSession?.id
                ? unreadCount(session)
                : (session.last_message_at && !lastReadTimestamps[session.id] ? 1 : 0);
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
                    background: selectedSession?.id === session.id ? 'var(--color-primary-50)' : 'transparent',
                    transition: 'background var(--transition-fast)',
                    minHeight: '44px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{session.layanan?.nama || 'Layanan'}</span>
                    <span className={`badge ${config.className}`} style={{ fontSize: '10px' }}>
                      {config.icon} {config.label}
                    </span>
                  </div>
                  {session.last_message && (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: 'var(--space-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {truncate(session.last_message, 40)}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {session.kontak_pengunjung || 'Pengunjung Anonim'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      {unread > 0 && (
                        <span style={{
                          background: 'var(--color-danger-500)',
                          color: 'white',
                          fontSize: '10px',
                          fontWeight: 700,
                          borderRadius: '999px',
                          padding: '1px 6px',
                          minWidth: '18px',
                          textAlign: 'center',
                        }}>
                          {unread}
                        </span>
                      )}
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        {session.last_message_at
                          ? relativeTime(session.last_message_at)
                          : relativeTime(session.created_at)}
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
                  <h3 style={{ fontWeight: 600, fontSize: 'var(--text-md)', marginBottom: '4px' }}>
                    {selectedSession.kontak_pengunjung || 'Pengunjung Anonim'}
                  </h3>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    Layanan: {selectedSession.layanan?.nama || '—'}
                  </div>
                </div>
                {selectedSession.status !== 'selesai' && (
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    {selectedSession.status === 'eskalasi' && (
                      <button className="btn btn--primary btn--sm" onClick={handleAmbilAlih}>
                        Ambil Alih Chat
                      </button>
                    )}
                    <button className="btn btn--secondary btn--sm" onClick={handleSelesaikanSesi}>
                      Selesaikan Chat
                    </button>
                  </div>
                )}
              </div>

              {/* Messages Area */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {messages.map((msg) => {
                  const isStaff = msg.pengirim === 'petugas';
                  const isBot = msg.pengirim === 'bot';
                  return (
                    <div key={msg.id} style={{ display: 'flex', gap: 'var(--space-3)', alignSelf: isStaff ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                      {!isStaff && (
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                          background: isBot ? 'var(--color-primary-100)' : 'var(--color-neutral-200)',
                          color: isBot ? 'var(--color-primary-700)' : 'var(--text-secondary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          {isBot ? <Bot size={16} /> : <User size={16} />}
                        </div>
                      )}

                      <div style={{
                        background: isStaff ? 'var(--color-primary-600)' : 'var(--surface-primary)',
                        color: isStaff ? 'white' : 'var(--text-primary)',
                        padding: '12px 16px',
                        borderRadius: '16px',
                        borderTopRightRadius: isStaff ? '4px' : '16px',
                        borderTopLeftRadius: !isStaff ? '4px' : '16px',
                        boxShadow: 'var(--shadow-sm)',
                        border: isStaff ? 'none' : '1px solid var(--border-default)',
                      }}>
                        {isBot && (
                          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-primary-600)', marginBottom: '4px' }}>
                            BOT FAQ
                          </div>
                        )}
                        <div style={{ fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                          {msg.isi}
                        </div>
                        <div style={{ fontSize: '10px', marginTop: '6px', textAlign: 'right', opacity: isStaff ? 0.8 : 0.5, color: isStaff ? 'white' : 'inherit' }}>
                          {new Date(msg.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input */}
              {selectedSession.status !== 'selesai' ? (
                <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-default)', background: 'var(--surface-primary)' }}>
                  <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ketik balasan..."
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      style={{ flex: 1, borderRadius: '999px', paddingLeft: 'var(--space-4)' }}
                    />
                    <button
                      type="submit"
                      className="btn btn--primary"
                      style={{ borderRadius: '50%', width: '40px', height: '40px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      disabled={!messageInput.trim()}
                    >
                      <Send size={18} />
                    </button>
                  </form>
                </div>
              ) : (
                <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-default)', background: 'var(--surface-primary)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
                  Sesi chat ini sudah selesai.
                </div>
              )}
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
