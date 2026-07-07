'use client';

import { useState } from 'react';
import {
  MessageSquare,
  User,
  Bot,
  Send,
  CheckCircle2,
  Clock,
  AlertCircle,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';

// Demo chat sessions
const demoSessions = [
  {
    id: '1',
    layanan: 'Helpdesk OSS',
    kontak: '081234567890',
    status: 'eskalasi',
    created_at: '2026-07-06T10:20:00Z',
    last_message: 'Saya ingin bertanya soal perubahan data NIB',
    unread: 2,
  },
  {
    id: '2',
    layanan: 'CS BPJS Kesehatan',
    kontak: 'siti@email.com',
    status: 'aktif',
    created_at: '2026-07-06T10:00:00Z',
    last_message: 'Terima kasih atas informasinya',
    unread: 0,
  },
  {
    id: '3',
    layanan: 'Helpdesk OSS',
    kontak: null,
    status: 'bot',
    created_at: '2026-07-06T09:45:00Z',
    last_message: 'Bagaimana cara daftar NIB?',
    unread: 0,
  },
  {
    id: '4',
    layanan: 'Sertifikasi Halal',
    kontak: '087654321000',
    status: 'selesai',
    created_at: '2026-07-06T09:00:00Z',
    last_message: 'Baik, saya akan datang besok',
    unread: 0,
  },
];

const demoPesan = [
  { id: '1', pengirim: 'pengunjung', isi: 'Halo, saya ingin bertanya soal perubahan data NIB', waktu: '10:20' },
  { id: '2', pengirim: 'bot', isi: 'Selamat datang di Helpdesk OSS! Untuk perubahan data NIB, Anda perlu menyiapkan dokumen berikut:\n1. KTP pemilik usaha\n2. NPWP\n3. Akta perubahan (jika ada)\n\nApakah ada pertanyaan lain?', waktu: '10:20' },
  { id: '3', pengirim: 'pengunjung', isi: 'Apakah bisa diproses online atau harus datang langsung?', waktu: '10:22' },
  { id: '4', pengirim: 'bot', isi: 'Maaf, saya tidak yakin dengan jawaban untuk pertanyaan ini. Saya akan menghubungkan Anda dengan petugas. Mohon tunggu sebentar.', waktu: '10:22' },
];

const statusConfig = {
  bot: { label: 'Bot', icon: <Bot size={12} />, className: 'badge--bot' },
  eskalasi: { label: 'Menunggu Petugas', icon: <AlertCircle size={12} />, className: 'badge--eskalasi' },
  aktif: { label: 'Aktif', icon: <MessageSquare size={12} />, className: 'badge--aktif' },
  selesai: { label: 'Selesai', icon: <CheckCircle2 size={12} />, className: 'badge--selesai' },
};

export default function AdminChatPage() {
  const [selectedSession, setSelectedSession] = useState(demoSessions[0]);
  const [messageInput, setMessageInput] = useState('');

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
            Sesi Chat ({demoSessions.filter(s => s.status !== 'selesai').length} aktif)
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {demoSessions.map((session) => {
              const config = statusConfig[session.status as keyof typeof statusConfig];
              return (
                <div
                  key={session.id}
                  onClick={() => setSelectedSession(session)}
                  style={{
                    padding: 'var(--space-4)',
                    borderBottom: '1px solid var(--color-neutral-100)',
                    cursor: 'pointer',
                    background: selectedSession.id === session.id ? 'var(--color-primary-50)' : 'transparent',
                    transition: 'background var(--transition-fast)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{session.layanan}</span>
                    <span className={`badge ${config.className}`} style={{ fontSize: '10px' }}>
                      {config.icon} {config.label}
                    </span>
                  </div>
                  <p style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {session.last_message}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                      {session.kontak || 'Tanpa kontak'}
                    </span>
                    {session.unread > 0 && (
                      <span style={{
                        background: 'var(--color-primary-600)',
                        color: 'white',
                        fontSize: '10px',
                        fontWeight: 700,
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        {session.unread}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chat Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Chat Header */}
          <div style={{
            padding: 'var(--space-4) var(--space-6)',
            borderBottom: '1px solid var(--border-default)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{selectedSession.layanan}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {selectedSession.kontak || 'Tanpa kontak'} · {new Date(selectedSession.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {selectedSession.status === 'eskalasi' && (
                <button className="btn btn--primary btn--sm">Ambil Alih</button>
              )}
              {selectedSession.status === 'aktif' && (
                <button className="btn btn--secondary btn--sm">
                  <CheckCircle2 size={14} />
                  Selesai
                </button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--space-6)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
            background: 'var(--color-neutral-50)',
          }}>
            {demoPesan.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  justifyContent: msg.pengirim === 'pengunjung' ? 'flex-start' : 'flex-end',
                  gap: 'var(--space-2)',
                }}
              >
                {msg.pengirim === 'pengunjung' && (
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: 'var(--color-neutral-200)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <User size={16} />
                  </div>
                )}
                <div style={{
                  maxWidth: '70%',
                  padding: 'var(--space-3) var(--space-4)',
                  borderRadius: msg.pengirim === 'pengunjung'
                    ? '4px var(--radius-lg) var(--radius-lg) var(--radius-lg)'
                    : 'var(--radius-lg) 4px var(--radius-lg) var(--radius-lg)',
                  background: msg.pengirim === 'pengunjung'
                    ? 'var(--surface-elevated)'
                    : msg.pengirim === 'bot'
                      ? 'var(--color-primary-50)'
                      : 'var(--color-primary-600)',
                  color: msg.pengirim === 'petugas' ? 'white' : 'var(--text-primary)',
                  fontSize: 'var(--text-sm)',
                  lineHeight: 1.6,
                  boxShadow: 'var(--shadow-xs)',
                  whiteSpace: 'pre-line',
                }}>
                  {msg.pengirim === 'bot' && (
                    <div style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      color: 'var(--color-primary-600)',
                      marginBottom: 'var(--space-1)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-1)',
                    }}>
                      <Bot size={12} /> Chatbot
                    </div>
                  )}
                  {msg.isi}
                  <div style={{
                    fontSize: '10px',
                    marginTop: 'var(--space-1)',
                    opacity: 0.6,
                    textAlign: 'right',
                  }}>
                    {msg.waktu}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <div style={{
            padding: 'var(--space-4) var(--space-6)',
            borderTop: '1px solid var(--border-default)',
            display: 'flex',
            gap: 'var(--space-3)',
            alignItems: 'flex-end',
          }}>
            <textarea
              className="form-textarea"
              placeholder="Ketik balasan..."
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              rows={2}
              style={{ minHeight: '44px', resize: 'none' }}
            />
            <button className="btn btn--primary" style={{ height: '44px' }}>
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
