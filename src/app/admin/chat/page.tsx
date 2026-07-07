'use client';

import { useState, useEffect, useRef } from 'react';
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

interface Session {
  id: string;
  layanan_id: string;
  kontak_pengunjung: string | null;
  status: 'bot' | 'eskalasi' | 'aktif' | 'selesai';
  created_at: string;
  layanan: { nama: string } | null;
  last_message?: string;
  unread?: number;
}

interface Message {
  id: string;
  pengirim: 'pengunjung' | 'bot' | 'petugas';
  isi: string;
  created_at: string;
}

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchSessions = async (layananId: string | null) => {
    const supabase = createClient();
    let query = supabase
      .from('chat_sesi')
      .select(`
        id, layanan_id, kontak_pengunjung, status, created_at,
        layanan:layanan_id ( nama )
      `)
      .order('created_at', { ascending: false });

    if (layananId) {
      query = query.eq('layanan_id', layananId);
    }

    const { data } = await query;
    if (data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const formatted = data.map(d => ({
        ...d,
        layanan: Array.isArray(d.layanan) ? d.layanan[0] : d.layanan
      })) as any as Session[];
      setSessions(formatted);
      
      // Update selected session if it exists to refresh status
      setSelectedSession(prev => {
        if (!prev) return prev;
        const updated = formatted.find(s => s.id === prev.id);
        return updated || prev;
      });
    }
  };

  // Load User & Sessions
  useEffect(() => {
    async function init() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        let targetLayananId = null;

        if (user) {
          const { data: petugas } = await supabase
            .from('petugas')
            .select('role, layanan_id')
            .eq('auth_user_id', user.id)
            .single();

          if (petugas) {
            if (petugas.role === 'petugas') {
              targetLayananId = petugas.layanan_id;
            }
          }
        }
        
        await fetchSessions(targetLayananId);

        // Subscribe to new sessions
        const channel = supabase.channel('public:chat_sesi')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_sesi' }, () => {
             fetchSessions(targetLayananId);
          })
          .subscribe();

        return () => {
          supabase.removeChannel(channel);
        };
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load Messages for Selected Session
  useEffect(() => {
    if (!selectedSession) return;
    
    let active = true;
    const supabase = createClient();

    async function loadMessages() {
      const { data } = await supabase
        .from('chat_pesan')
        .select('id, pengirim, isi, created_at')
        .eq('sesi_id', selectedSession!.id)
        .order('created_at', { ascending: true });
        
      if (active && data) {
        setMessages(data as Message[]);
      }
    }
    
    loadMessages();

    // Subscribe to new messages for this specific session
    const msgChannel = supabase.channel(`room_${selectedSession.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_pesan', filter: `sesi_id=eq.${selectedSession.id}` }, (payload) => {
        const newMsg = payload.new as Message;
        setMessages(prev => {
          if (prev.find(m => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(msgChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSession?.id]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedSession) return;

    const text = messageInput.trim();
    setMessageInput('');

    try {
      const supabase = createClient();
      await supabase.from('chat_pesan').insert({
        sesi_id: selectedSession.id,
        pengirim: 'petugas',
        isi: text,
      });
      
      // If session was escalated or bot, make it active since staff replied
      if (selectedSession.status !== 'aktif' && selectedSession.status !== 'selesai') {
         await supabase.from('chat_sesi').update({ status: 'aktif' }).eq('id', selectedSession.id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelesaikanSesi = async () => {
    if (!selectedSession) return;
    try {
      const supabase = createClient();
      await supabase.from('chat_sesi').update({ status: 'selesai' }).eq('id', selectedSession.id);
    } catch (e) {
      console.error(e);
    }
  };
  
  const handleAmbilAlih = async () => {
    if (!selectedSession) return;
    try {
      const supabase = createClient();
      await supabase.from('chat_sesi').update({ status: 'aktif' }).eq('id', selectedSession.id);
    } catch (e) {
      console.error(e);
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
              return (
                <div
                  key={session.id}
                  onClick={() => setSelectedSession(session)}
                  style={{
                    padding: 'var(--space-4)',
                    borderBottom: '1px solid var(--color-neutral-100)',
                    cursor: 'pointer',
                    background: selectedSession?.id === session.id ? 'var(--color-primary-50)' : 'transparent',
                    transition: 'background var(--transition-fast)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{session.layanan?.nama || 'Layanan'}</span>
                    <span className={`badge ${config.className}`} style={{ fontSize: '10px' }}>
                      {config.icon} {config.label}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {session.kontak_pengunjung || 'Pengunjung Anonim'}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                      {new Date(session.created_at).toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                </div>
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
