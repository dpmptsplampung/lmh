'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Building2,
  ArrowLeft,
  Send,
  Bot,
  User,
  MessageSquare,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { LAYANAN_LIST, APP_NAME } from '@/lib/constants';
import styles from './chat.module.css';

interface Layanan {
  id: string;
  nama: string;
  chatbot_aktif: boolean;
}

interface Message {
  id: string;
  pengirim: 'pengunjung' | 'bot' | 'petugas';
  isi: string;
  waktu: string;
}

interface FAQ {
  id: string;
  pertanyaan: string;
  jawaban: string;
}

// Module-level counter for pure unique IDs in handlers
let msgIdCounter = 0;

export default function PublicChatPage() {
  const [layananList, setLayananList] = useState<Layanan[]>([]);
  const [loadingLayanan, setLoadingLayanan] = useState(true);

  // Sesi Setup States
  const [visitorName, setVisitorName] = useState('');
  const [selectedLayananId, setSelectedLayananId] = useState('');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [sesiId, setSesiId] = useState<string | null>(null);
  const [loadingSetup, setLoadingSetup] = useState(false);

  // Chat Thread States
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [sesiStatus, setSesiStatus] = useState<'bot' | 'eskalasi' | 'aktif' | 'selesai'>('bot');
  const [faqs, setFaqs] = useState<FAQ[]>([]);

  const threadEndRef = useRef<HTMLDivElement>(null);

  // Load layanan
  useEffect(() => {
    async function loadLayanan() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('layanan')
          .select('id, nama, chatbot_aktif')
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

  // Setup Real-time listener for incoming messages from staff
  useEffect(() => {
    if (!sesiId) return;

    const supabase = createClient();

    // Subscribe to new messages in this session
    const messageChannel = supabase
      .channel(`room_${sesiId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_pesan',
          filter: `sesi_id=eq.${sesiId}`,
        },
        (payload) => {
          const newMsg = payload.new as { id: string; pengirim: string; isi: string; created_at: string };
          if (newMsg.pengirim !== 'pengunjung') {
            setMessages((prev) => {
              // Avoid duplicates
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [
                ...prev,
                {
                  id: newMsg.id,
                  pengirim: newMsg.pengirim as 'bot' | 'petugas',
                  isi: newMsg.isi,
                  waktu: new Date(newMsg.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                },
              ];
            });
          }
        }
      )
      .subscribe();

    // Subscribe to session changes (status updates)
    const sessionChannel = supabase
      .channel(`session_${sesiId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_sesi',
          filter: `id=eq.${sesiId}`,
        },
        (payload) => {
          const updatedSesi = payload.new as { status: 'bot' | 'eskalasi' | 'aktif' | 'selesai' };
          setSesiStatus(updatedSesi.status);

          if (updatedSesi.status === 'aktif') {
            setMessages((prev) => [
              ...prev,
              {
                id: `system-${Date.now()}`,
                pengirim: 'bot',
                isi: '✓ Hubungan tersambung. Anda kini terhubung langsung dengan petugas kami.',
                waktu: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
              },
            ]);
          } else if (updatedSesi.status === 'selesai') {
            setMessages((prev) => [
              ...prev,
              {
                id: `system-${Date.now()}`,
                pengirim: 'bot',
                isi: '✕ Sesi chat telah ditutup oleh petugas. Terima kasih.',
                waktu: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
              },
            ]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messageChannel);
      supabase.removeChannel(sessionChannel);
    };
  }, [sesiId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleStartSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLayananId) return;

    setLoadingSetup(true);
    await fetchFAQs(selectedLayananId);

    const nama = visitorName.trim() || 'Pengunjung Anonim';
    const selectedLayanan = layananList.find((l) => l.id === selectedLayananId);

    try {
      const supabase = createClient();

      // Create session in database
      const { data: session, error } = await supabase
        .from('chat_sesi')
        .insert({
          layanan_id: selectedLayananId,
          kontak_pengunjung: nama,
          status: selectedLayanan?.chatbot_aktif ? 'bot' : 'eskalasi',
        })
        .select()
        .single();

      if (error) throw error;

      setSesiId(session.id);
      setSesiStatus(session.status);

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
          waktu: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch {
      // Offline fallback session
      setSesiId(`fallback-session-${Date.now()}`);
      setSesiStatus(selectedLayanan?.chatbot_aktif ? 'bot' : 'eskalasi');
      setMessages([
        {
          id: 'welcome',
          pengirim: 'bot',
          isi: `Halo Bapak/Ibu ${nama}. (Mode Offline)\nSelamat datang di layanan Live Chat ${selectedLayanan?.nama || 'DPMPTSP'}.\nSilakan pilih FAQ di bawah atau ketik pertanyaan Anda.`,
          waktu: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }

    setIsSessionActive(true);
    setLoadingSetup(false);
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || !sesiId) return;

    const userMsg: Message = {
      id: `user-${msgIdCounter++}`,
      pengirim: 'pengunjung',
      isi: text.trim(),
      waktu: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setMessageInput('');

    // Insert user message to database
    try {
      const supabase = createClient();
      await supabase.from('chat_pesan').insert({
        sesi_id: sesiId,
        pengirim: 'pengunjung',
        isi: text.trim(),
      });
    } catch { /* ignore db error in fallback mode */ }

    // If chatbot mode: analyze text for keyword matching FAQ
    if (sesiStatus === 'bot') {
      setLoadingSetup(true);

      // Simulasikan delay bot mengetik
      setTimeout(async () => {
        // Simple keyword lookup
        const lowerText = text.toLowerCase();
        const matchedFaq = faqs.find(
          (faq) =>
            lowerText.includes(faq.pertanyaan.toLowerCase()) ||
            faq.pertanyaan.toLowerCase().split(' ').some((word) => word.length > 3 && lowerText.includes(word))
        );

        if (matchedFaq) {
          const botReply: Message = {
            id: `bot-reply-${msgIdCounter++}`,
            pengirim: 'bot',
            isi: matchedFaq.jawaban,
            waktu: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
          };

          setMessages((prev) => [...prev, botReply]);

          // Save bot reply to database
          try {
            const supabase = createClient();
            await supabase.from('chat_pesan').insert({
              sesi_id: sesiId,
              pengirim: 'bot',
              isi: matchedFaq.jawaban,
              sumber_faq_id: matchedFaq.id,
            });
          } catch { /* ignore */ }
        } else {
          // No match: explain and escalate
          const botReply: Message = {
            id: `bot-escalate-${Date.now()}`,
            pengirim: 'bot',
            isi: 'Maaf, saya tidak menemukan jawaban yang cocok untuk pertanyaan Anda di database FAQ.\n\nSaya akan meneruskan sesi chat ini ke petugas loket untuk dibantu secara manual. Mohon tunggu...',
            waktu: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
          };

          setMessages((prev) => [...prev, botReply]);
          setSesiStatus('eskalasi');

          // Save bot reply + update session status to database
          try {
            const supabase = createClient();
            await supabase.from('chat_pesan').insert({
              sesi_id: sesiId,
              pengirim: 'bot',
              isi: botReply.isi,
            });
            await supabase
              .from('chat_sesi')
              .update({ status: 'eskalasi' })
              .eq('id', sesiId);
          } catch { /* ignore */ }
        }
        setLoadingSetup(false);
      }, 700);
    }
  };

  const handleEscalateManual = async () => {
    if (!sesiId || sesiStatus !== 'bot') return;

    setMessages((prev) => [
      ...prev,
      {
        id: `system-esc-${Date.now()}`,
        pengirim: 'bot',
        isi: 'Meneruskan chat ke petugas loket...',
        waktu: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      },
    ]);

    setSesiStatus('eskalasi');

    try {
      const supabase = createClient();
      await supabase
        .from('chat_sesi')
        .update({ status: 'eskalasi' })
        .eq('id', sesiId);

      await supabase.from('chat_pesan').insert({
        sesi_id: sesiId,
        pengirim: 'bot',
        isi: 'Pengunjung meminta bantuan petugas loket.',
      });
    } catch { /* ignore */ }
  };

  return (
    <div className={styles.chatPage}>
      {/* Navbar */}
      <header className={styles.chatHeader}>
        <Link href="/" className={styles.brand}>
          <div className={styles.brandIcon}>
            <Building2 size={20} />
          </div>
          <span className={styles.brandText}>{APP_NAME}</span>
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
            </div>

            <form onSubmit={handleStartSession} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="chatName">Nama Anda</label>
                <input
                  id="chatName"
                  type="text"
                  className="form-input"
                  placeholder="Masukkan nama lengkap..."
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  required
                />
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

              <button
                type="submit"
                className="btn btn--primary btn--lg"
                style={{ width: '100%', marginTop: 'var(--space-2)' }}
                disabled={loadingSetup || loadingLayanan}
              >
                {loadingSetup ? (
                  <><Loader2 size={20} className="animate-pulse" /> Memulai Sesi...</>
                ) : (
                  'Mulai Sesi Chat'
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

            {/* Message List */}
            <div className={styles.messageThread}>
              {messages.map((msg) => {
                const isUser = msg.pengirim === 'pengunjung';
                const isBot = msg.pengirim === 'bot';
                return (
                  <div key={msg.id} className={`${styles.msgRow} ${isUser ? styles.msgRowUser : (isBot ? styles.msgRowBot : styles.msgRowStaff)}`}>
                    {!isUser && (
                      <div className={`${styles.avatar} ${isBot ? styles.avatarBot : styles.avatarStaff}`}>
                        {isBot ? <Bot size={16} /> : <User size={16} />}
                      </div>
                    )}
                    <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : (isBot ? styles.bubbleBot : styles.bubbleStaff)}`}>
                      {isBot && (
                        <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--color-primary-600)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <Bot size={10} /> BOT FAQ
                        </div>
                      )}
                      {!isUser && !isBot && (
                        <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--color-accent-700)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <User size={10} /> PETUGAS LOKET
                        </div>
                      )}
                      {msg.isi}
                      <div className={styles.msgTime}>{msg.waktu}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </div>

            {/* Quick FAQ Chips */}
            {sesiStatus === 'bot' && faqs.length > 0 && (
              <div className={styles.quickFaqSection}>
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

            {/* Input Bar */}
            <div className={styles.inputBar}>
              <textarea
                className="form-textarea"
                placeholder={sesiStatus === 'selesai' ? 'Sesi chat ditutup...' : 'Ketik pertanyaan Anda...'}
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                disabled={sesiStatus === 'selesai'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(messageInput);
                  }
                }}
                rows={1}
              />
              <button
                className="btn btn--primary"
                onClick={() => handleSendMessage(messageInput)}
                disabled={!messageInput.trim() || sesiStatus === 'selesai'}
                style={{ height: '44px', width: '44px', padding: 0 }}
              >
                <Send size={18} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
