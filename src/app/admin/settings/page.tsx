'use client';

import Tombol from '@/components/ui/Tombol';
import Kartu from '@/components/ui/Kartu';
import Field from '@/components/ui/Field';
import Skeleton from '@/components/ui/Skeleton';
import Galat from '@/components/ui/Galat';

import tampilan from './page.dasbor.module.css';

import { useState, useEffect } from 'react';
import { Save, ExternalLink } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import { TAG_PUBLIK_KLIEN, segarkanPublik } from '@/lib/data/klien/segarkanPublik';

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
  const [loadError, setLoadError] = useState('');
  const [percobaan, setPercobaan] = useState(0);

  useEffect(() => {
    async function fetchSettings() {
      setLoading(true);
      setLoadError('');
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
        setLoadError('Gagal memuat pengaturan.');
        toast('Gagal memuat pengaturan.', 'error');
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, [toast, percobaan]);

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
        .upsert(updates, { onConflict: 'key' });

      if (error) throw error;

      // Beranda publik (tombol WhatsApp + kontak footer) ber-cache di server: buang setelah simpan berhasil.
      void segarkanPublik(TAG_PUBLIK_KLIEN.beranda);
      toast('Pengaturan berhasil disimpan!', 'success');
    } catch {
      toast('Gagal menyimpan pengaturan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Pengaturan Website" description="Kelola tautan eksternal dan konfigurasi global website" />
      <div className={tampilan.isi}>
        {loading ? <Skeleton bentuk="kartu" jumlah={3} label="Memuat pengaturan" /> : loadError ? (
          <Galat pesan={loadError} onRetry={() => setPercobaan((n) => n + 1)} />
        ) : (
          <form onSubmit={handleSave} className={tampilan.form}>
            <Kartu judul="Pengaturan Eksternal">
              <Field label="URL Portal FOILA" wajib bantuan="Tautan ini akan digunakan di halaman Investment Gallery.">
                <input id="set-foila" type="url" required placeholder="https://..." value={foilaUrl} onChange={(e) => setFoilaUrl(e.target.value)} />
              </Field>
            </Kartu>
            <Kartu judul="Pengaturan Kontak">
              <div className={tampilan.bidang}>
                <Field label="Nomor WhatsApp" bantuan="Format internasional tanpa tanda + (contoh: 6281234567890).">
                  <input id="set-wa" type="text" placeholder="6281234567890" value={waNumber} onChange={(e) => setWaNumber(e.target.value)} />
                </Field>
                <Field label="Pesan Default WhatsApp" bantuan="Pesan otomatis yang terisi saat pengguna mengklik tombol chat WhatsApp.">
                  <textarea id="set-wa-pesan" placeholder="Halo, saya ingin bertanya..." rows={3} value={waDefaultMessage} onChange={(e) => setWaDefaultMessage(e.target.value)} />
                </Field>
              </div>
            </Kartu>
            <Kartu judul="Kontak Resmi" className={tampilan.kontak}>
              <div className={tampilan.bidang}>
                <Field label="Alamat Kantor" bantuan="Ditampilkan di footer landing page bila diisi.">
                  <textarea id="set-alamat" placeholder="Jl. ... , Bandar Lampung" rows={2} value={contactAddress} onChange={(e) => setContactAddress(e.target.value)} />
                </Field>
                <Field label="Jam Layanan">
                  <input id="set-jam" type="text" placeholder="Senin–Jumat, 08.00–16.00 WIB" value={contactHours} onChange={(e) => setContactHours(e.target.value)} />
                </Field>
                <Field label="Email Resmi" bantuan="Dipakai di footer landing dan halaman Investment Gallery.">
                  <input id="set-email" type="email" placeholder="info@dpmptsp.lampungprov.go.id" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
                </Field>
              </div>
            </Kartu>
            <div className={tampilan.aksi}>
              <Tombol type="submit" ikon={Save} disabled={saving} memuat={saving}>
                {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </Tombol>
              <Tombol href="/admin/settings/landing" varian="sekunder" ikon={ExternalLink}>Edit Blok Homepage</Tombol>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
