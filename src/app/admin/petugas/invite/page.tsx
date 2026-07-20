'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Copy, Check, Mail, UserPlus, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import styles from './invite.module.css';

interface LayananOption {
  id: string;
  nama: string;
}

type Role = 'petugas' | 'admin';

export default function InvitePetugasPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [nama, setNama] = useState('');
  const [password, setPassword] = useState('');
  const [layananId, setLayananId] = useState('');
  const [role, setRole] = useState<Role>('petugas');
  const [layananList, setLayananList] = useState<LayananOption[]>([]);
  const [loadingLayanan, setLoadingLayanan] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const loadLayanan = useCallback(async () => {
    setLoadingLayanan(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('layanan')
        .select('id, nama')
        .order('nama');
      if (error) throw error;
      setLayananList((data ?? []) as LayananOption[]);
    } catch {
      toast('Gagal memuat daftar layanan.', 'error');
      setLayananList([]);
    } finally {
      setLoadingLayanan(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLayanan();
  }, [loadLayanan]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setIsSuccess(false);

    try {
      const res = await fetch('/api/admin/petugas/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, nama, layanan_id: layananId, role }),
      });
      const json = await res.json();

      if (!res.ok) {
        const msg = json?.error ?? 'Gagal membuat akun petugas.';
        toast(msg, 'error');
        return;
      }

      setIsSuccess(true);
      toast('Akun petugas berhasil dibuat.', 'success');
    } catch {
      toast('Gagal menghubungi server.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setEmail('');
    setNama('');
    setPassword('');
    setLayananId('');
    setRole('petugas');
    setIsSuccess(false);
  };

  return (
    <>
      <PageHeader
        title="Tambah Petugas"
        description="Buat akun petugas baru dengan menentukan email dan password."
      >
        <Link href="/admin" className="btn btn--ghost btn--sm">
          <ArrowLeft size={14} /> Kembali ke Dashboard
        </Link>
      </PageHeader>

      <div className={styles.container}>
        {isSuccess ? (
          <div className={styles.successCard}>
            <div className={styles.successIcon}>
              <Check size={28} />
            </div>
            <h2 className={styles.successTitle}>Akun Berhasil Dibuat</h2>
            <p className={styles.successText}>
              Akun petugas telah berhasil dibuat. Petugas sekarang dapat login 
              menggunakan email dan password yang baru saja Anda atur.
            </p>
            
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleReset}
              style={{ marginTop: 'var(--space-6)' }}
            >
              <UserPlus size={16} /> Tambah Petugas Lain
            </button>
          </div>
        ) : (
          <form className={styles.formCard} onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label form-label--required" htmlFor="inviteEmail">
                Email Petugas
              </label>
              <input
                id="inviteEmail"
                type="email"
                className="form-input"
                placeholder="nama@lmh.go.id"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label form-label--required" htmlFor="inviteNama">
                Nama Petugas
              </label>
              <input
                id="inviteNama"
                type="text"
                className="form-input"
                placeholder="Contoh: Petugas OSS"
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                autoComplete="off"
                required
                minLength={2}
              />
            </div>

            <div className="form-group">
              <label className="form-label form-label--required" htmlFor="invitePassword">
                Password
              </label>
              <input
                id="invitePassword"
                type="password"
                className="form-input"
                placeholder="Minimal 6 karakter"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={6}
              />
            </div>

            <div className="form-group">
              <label className="form-label form-label--required" htmlFor="inviteLayanan">
                Layanan
              </label>
              {loadingLayanan ? (
                <div className={styles.loadingRow}>
                  <Loader2 size={16} className="animate-pulse" /> Memuat layanan...
                </div>
              ) : layananList.length === 0 ? (
                <p className="form-error">Tidak ada layanan tersedia.</p>
              ) : (
                <select
                  id="inviteLayanan"
                  className="form-input"
                  value={layananId}
                  onChange={(e) => setLayananId(e.target.value)}
                  required
                >
                  <option value="">— Pilih Layanan —</option>
                  {layananList.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nama}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Role</label>
              <div className={styles.roleRow}>
                <label className={`${styles.roleOption} ${role === 'petugas' ? styles.roleOptionActive : ''}`}>
                  <input
                    type="radio"
                    name="role"
                    value="petugas"
                    checked={role === 'petugas'}
                    onChange={() => setRole('petugas')}
                  />
                  <span>Petugas</span>
                </label>
                <label className={`${styles.roleOption} ${role === 'admin' ? styles.roleOptionActive : ''}`}>
                  <input
                    type="radio"
                    name="role"
                    value="admin"
                    checked={role === 'admin'}
                    onChange={() => setRole('admin')}
                  />
                  <span>Admin</span>
                </label>
              </div>
            </div>

            <div className={styles.actions}>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={submitting || loadingLayanan || layananList.length === 0}
              >
                {submitting ? (
                  <><Loader2 size={16} className="animate-pulse" /> Memproses...</>
                ) : (
                  <><UserPlus size={16} /> Tambah Petugas</>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
