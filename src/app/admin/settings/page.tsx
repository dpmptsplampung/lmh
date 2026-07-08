'use client';

import { useState, useEffect } from 'react';
import { Settings, Save, Globe } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';

export default function AdminSettingsPage() {
  const [foilaUrl, setFoilaUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function fetchSettings() {
      const supabase = createClient();
      const { data } = await supabase.from('site_settings').select('value').eq('key', 'foila_url').single();
      if (data) {
        setFoilaUrl(data.value);
      }
      setLoading(false);
    }
    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    const supabase = createClient();
    const { error } = await supabase
      .from('site_settings')
      .upsert({ key: 'foila_url', value: foilaUrl, updated_at: new Date().toISOString() });

    if (error) {
      setMessage('Gagal menyimpan pengaturan.');
    } else {
      setMessage('Pengaturan berhasil disimpan!');
    }
    setSaving(false);
  };

  return (
    <>
      <PageHeader
        title="Pengaturan Website"
        description="Kelola tautan eksternal dan konfigurasi global website"
      />

      <div style={{ padding: 'var(--space-8)', maxWidth: '600px' }}>
        <form onSubmit={handleSave} style={{
          background: 'var(--color-neutral-0)',
          padding: 'var(--space-6)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-neutral-200)'
        }}>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-6)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings size={20} /> Konfigurasi Tautan
          </h3>

          <div style={{ marginBottom: 'var(--space-6)' }}>
            <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
              URL Portal FOILA
            </label>
            <div style={{ position: 'relative' }}>
              <Globe size={18} style={{
                position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text-tertiary)'
              }} />
              <input
                type="url"
                required
                className="form-input"
                style={{ paddingLeft: '40px', width: '100%' }}
                placeholder="https://..."
                value={foilaUrl}
                onChange={(e) => setFoilaUrl(e.target.value)}
                disabled={loading}
              />
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              Tautan ini akan digunakan di halaman Investment Gallery.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button type="submit" className="btn btn--primary" disabled={loading || saving}>
              <Save size={16} />
              {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
            </button>
            {message && (
              <span style={{ fontSize: 'var(--text-sm)', color: message.includes('Gagal') ? 'var(--color-danger-600)' : 'var(--color-success-600)' }}>
                {message}
              </span>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
