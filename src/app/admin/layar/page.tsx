'use client';

// WP-29 / DSP-07: Admin page for managing queue display tokens.
// Admin creates tokens that give access to /layar/[token] TV display.

import { useState, useEffect, useCallback } from 'react';
import { Monitor, Plus, XCircle, Copy, CheckCircle2, RefreshCw, ExternalLink } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useToast } from '@/components/Toast';

interface LayarToken {
  id: string;
  token: string;
  nama: string;
  aktif: boolean;
  created_at: string;
}

export default function AdminLayarPage() {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<LayarToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [namaLayar, setNamaLayar] = useState('');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/layar');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setTokens(json.data ?? []);
    } catch (e) {
      toast('Gagal memuat data layar', 'error');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTokens();
  }, [loadTokens]);

  const handleBuat = async () => {
    if (!namaLayar.trim()) {
      toast('Nama layar wajib diisi', 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/admin/layar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'buat', nama: namaLayar.trim() }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      toast(`Token layar "${namaLayar}" berhasil dibuat`, 'success');
      setNamaLayar('');
      await loadTokens();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Gagal membuat token', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleCabut = async (id: string, nama: string) => {
    if (!confirm(`Cabut akses token "${nama}"? Layar yang menggunakan token ini tidak akan bisa menampilkan data.`)) return;
    try {
      const res = await fetch('/api/admin/layar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'cabut', id }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      toast(`Token "${nama}" dicabut`, 'success');
      await loadTokens();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Gagal mencabut token', 'error');
    }
  };

  const handleCopy = async (token: string) => {
    const url = `${window.location.origin}/layar/${token}`;
    await navigator.clipboard.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
    toast('URL layar disalin', 'success');
  };

  const activeTokens  = tokens.filter(t => t.aktif);
  const revokedTokens = tokens.filter(t => !t.aktif);

  return (
    <>
      <PageHeader
        title="Kelola Layar Antrean"
        description="Buat dan kelola token akses untuk layar TV tampilan antrean"
      >
        <button className="btn btn--ghost btn--sm" onClick={loadTokens}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {/* Create new token */}
        <div className="table-wrapper" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
          <h2 style={{ fontWeight: 700, marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Plus size={18} />
            Tambah Layar Baru
          </h2>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Nama layar, misal: Layar Lobby Utama"
              value={namaLayar}
              onChange={e => setNamaLayar(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleBuat()}
              style={{ flex: 1, minWidth: '240px' }}
            />
            <button
              className="btn btn--primary"
              onClick={handleBuat}
              disabled={creating || !namaLayar.trim()}
            >
              {creating ? 'Membuat...' : <><Plus size={16} /> Buat Token</>}
            </button>
          </div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)' }}>
            Setiap token menghasilkan URL unik yang bisa dibuka di browser TV tanpa login.
          </p>
        </div>

        {/* Active tokens */}
        <h2 style={{ fontWeight: 700, marginBottom: 'var(--space-4)' }}>
          <Monitor size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
          Layar Aktif ({activeTokens.length})
        </h2>

        {loading ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
            <div className="spinner" />
          </div>
        ) : activeTokens.length === 0 ? (
          <div className="empty-state">
            <Monitor size={40} className="empty-state__icon" />
            <h3 className="empty-state__title">Belum Ada Layar</h3>
            <p>Tambah token di atas untuk membuat layar TV pertama.</p>
          </div>
        ) : (
          <div className="table-wrapper" style={{ marginBottom: 'var(--space-8)' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Nama Layar</th>
                  <th>URL Layar</th>
                  <th>Dibuat</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {activeTokens.map(t => {
                  const url = `/layar/${t.token}`;
                  return (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600 }}>
                        <Monitor size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6, color: 'var(--color-success-600)' }} />
                        {t.nama}
                      </td>
                      <td>
                        <code style={{ fontSize: 'var(--text-xs)', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>
                          {t.token.slice(0, 12)}…
                        </code>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                        {new Date(t.created_at).toLocaleDateString('id-ID')}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => handleCopy(t.token)}
                            title="Salin URL layar"
                          >
                            {copied === t.token ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                            {copied === t.token ? 'Disalin' : 'Salin URL'}
                          </button>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn--secondary btn--sm"
                            title="Buka layar di tab baru"
                          >
                            <ExternalLink size={14} />
                            Buka
                          </a>
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => handleCabut(t.id, t.nama)}
                            style={{ color: 'var(--color-danger-600)' }}
                            title="Cabut akses token ini"
                          >
                            <XCircle size={14} />
                            Cabut
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Revoked tokens */}
        {revokedTokens.length > 0 && (
          <>
            <h2 style={{ fontWeight: 600, marginBottom: 'var(--space-4)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
              Token Dicabut ({revokedTokens.length})
            </h2>
            <div className="table-wrapper">
              <table className="table">
                <tbody>
                  {revokedTokens.map(t => (
                    <tr key={t.id} style={{ opacity: 0.5 }}>
                      <td>
                        <XCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6, color: 'var(--text-tertiary)' }} />
                        {t.nama}
                      </td>
                      <td style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
                        Dicabut — {new Date(t.created_at).toLocaleDateString('id-ID')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}