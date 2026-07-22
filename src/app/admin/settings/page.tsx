'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Settings, Save, Globe, MessageCircle, ExternalLink, MapPin } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

export default function AdminSettingsPage() {
  const { toast } = useToast();
  const [foilaUrl, setFoilaUrl] = useState('');
  const [waNumber, setWaNumber] = useState('');
  const [waDefaultMessage, setWaDefaultMessage] = useState('');
  const [contactAddress, setContactAddress] = useState('');
  const [contactHours, setContactHours] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('site_settings')
          .select('key, value');

        if (error) throw error;

        if (data) {
          const settingsMap = new Map(data.map((row) => [row.key, row.value]));
          setFoilaUrl(settingsMap.get('foila_url') || '');
          setWaNumber(settingsMap.get('wa_number') || '');
          setWaDefaultMessage(settingsMap.get('wa_default_message') || '');
          setContactAddress(settingsMap.get('contact_address') || '');
          setContactHours(settingsMap.get('contact_hours') || '');
          setContactEmail(settingsMap.get('contact_email') || '');
        }
      } catch {
        toast('Gagal memuat pengaturan.', 'error');
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, [toast]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const supabase = createClient();
    const now = new Date().toISOString();
    const updates = [
      { key: 'foila_url', value: foilaUrl, updated_at: now },
      { key: 'wa_number', value: waNumber, updated_at: now },
      { key: 'wa_default_message', value: waDefaultMessage, updated_at: now },
      { key: 'contact_address', value: contactAddress, updated_at: now },
      { key: 'contact_hours', value: contactHours, updated_at: now },
      { key: 'contact_email', value: contactEmail, updated_at: now },
    ];

    try {
      const { error } = await supabase
        .from('site_settings')
        .upsert(updates);

      if (error) throw error;

      toast('Pengaturan berhasil disimpan!', 'success');
    } catch {
      toast('Gagal menyimpan pengaturan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader
          title="Pengaturan Website"
          description="Kelola tautan eksternal dan konfigurasi global website"
        />
        <div style={{ padding: 'var(--space-8)' }}>
          <p style={{ color: 'var(--text-tertiary)' }}>Memuat pengaturan...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Pengaturan Website"
        description="Kelola tautan eksternal dan konfigurasi global website"
      />

      <div style={{ padding: 'var(--space-8)', maxWidth: '640px' }}>
        <form onSubmit={handleSave} style={{
          background: 'var(--surface-elevated)',
          padding: 'var(--space-6)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--border-default)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-8)',
        }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-5)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Settings size={20} /> Pengaturan Eksternal
            </h3>

            <div className="form-group">
              <label className="form-label">URL Portal FOILA</label>
              <div style={{ position: 'relative' }}>
                <Globe size={18} style={{
                  position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--text-tertiary)'
                }} />
                <input
                  type="url"
                  required
                  className="form-input"
                  style={{ paddingLeft: '40px' }}
                  placeholder="https://..."
                  value={foilaUrl}
                  onChange={(e) => setFoilaUrl(e.target.value)}
                />
              </div>
              <p className="form-hint">Tautan ini akan digunakan di halaman Investment Gallery.</p>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-5)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageCircle size={20} /> Pengaturan Kontak
            </h3>

            <div className="form-group" style={{ marginBottom: 'var(--space-5)' }}>
              <label className="form-label">Nomor WhatsApp</label>
              <input
                type="text"
                className="form-input"
                placeholder="6281234567890"
                value={waNumber}
                onChange={(e) => setWaNumber(e.target.value)}
              />
              <p className="form-hint">Format internasional tanpa tanda + (contoh: 6281234567890).</p>
            </div>

            <div className="form-group">
              <label className="form-label">Pesan Default WhatsApp</label>
              <textarea
                className="form-textarea"
                placeholder="Halo, saya ingin bertanya..."
                rows={3}
                value={waDefaultMessage}
                onChange={(e) => setWaDefaultMessage(e.target.value)}
              />
              <p className="form-hint">Pesan otomatis yang terisi saat pengguna mengklik tombol chat WhatsApp.</p>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-5)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MapPin size={20} /> Kontak Resmi
            </h3>

            <div className="form-group" style={{ marginBottom: 'var(--space-5)' }}>
              <label className="form-label">Alamat Kantor</label>
              <textarea
                className="form-textarea"
                placeholder="Jl. ... , Bandar Lampung"
                rows={2}
                value={contactAddress}
                onChange={(e) => setContactAddress(e.target.value)}
              />
              <p className="form-hint">Ditampilkan di footer landing page bila diisi.</p>
            </div>

            <div className="form-group" style={{ marginBottom: 'var(--space-5)' }}>
              <label className="form-label">Jam Layanan</label>
              <input
                type="text"
                className="form-input"
                placeholder="Senin–Jumat, 08.00–16.00 WIB"
                value={contactHours}
                onChange={(e) => setContactHours(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Email Resmi</label>
              <input
                type="email"
                className="form-input"
                placeholder="info@dpmptsp.lampungprov.go.id"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
              <p className="form-hint">Dipakai di footer landing dan halaman Investment Gallery.</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              <Save size={16} />
              {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
            </button>
            <Link href="/admin/settings/landing" className="btn btn--secondary">
              <ExternalLink size={16} />
              Edit Konten Landing Page
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}
