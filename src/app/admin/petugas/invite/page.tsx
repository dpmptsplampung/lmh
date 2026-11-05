'use client';

import { useEffect, useState, useCallback } from 'react';
import { Check, UserPlus, ArrowLeft } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Kartu from '@/components/ui/Kartu';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import Skeleton from '@/components/ui/Skeleton';
import Galat from '@/components/ui/Galat';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import styles from './invite.module.css';

interface LayananOption {
  id: string;
  nama: string;
}

type Role = 'petugas' | 'admin' | 'front_office';

export default function InvitePetugasPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [nama, setNama] = useState('');
  const [layananId, setLayananId] = useState('');
  const [role, setRole] = useState<Role>('petugas');
  const [layananList, setLayananList] = useState<LayananOption[]>([]);
  const [loadingLayanan, setLoadingLayanan] = useState(true);
  const [galatLayanan, setGalatLayanan] = useState('');
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
      setGalatLayanan('');
    } catch {
      setGalatLayanan('Gagal memuat daftar layanan.');
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
        // FO/admin tidak punya layanan (keputusan CEO: FO hanya FAQ umum); server menolak layanan_id untuk keduanya.
        body: JSON.stringify({ email, nama, layanan_id: role === 'petugas' ? layananId || null : null, role }),
      });
      const json = await res.json();

      if (!res.ok) {
        const msg = json?.error ?? 'Gagal membuat akun petugas.';
        toast(msg, 'error');
        return;
      }

      setIsSuccess(true);
      toast('Akun petugas berhasil dibuat. Tautan pengaturan kata sandi dikirim ke email petugas.', 'success');
    } catch {
      toast('Gagal menghubungi server.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setEmail('');
    setNama('');
    setLayananId('');
    setRole('petugas');
    setIsSuccess(false);
  };

  const tanpaLayanan = role !== 'petugas';
  const ROLE_PILIHAN: { nilai: Role; label: string }[] = [
    { nilai: 'petugas', label: 'Petugas' },
    { nilai: 'admin', label: 'Admin' },
    { nilai: 'front_office', label: 'Front Office' },
  ];

  return (
    <>
      <PageHeader
        title="Tambah Petugas"
        description="Buat akun petugas baru. Tautan pengaturan kata sandi akan dikirim ke email petugas."
        kembali={{ href: '/admin/petugas', label: 'Daftar Petugas' }}>
        <Tombol varian="hantu" href="/admin/petugas" ikon={ArrowLeft}>Daftar Petugas</Tombol>
      </PageHeader>

      <div className={styles.container}>
        {isSuccess ? (
          <Kartu className={styles.successCard}>
            <div className={styles.successIcon}>
              <Check size={28} aria-hidden="true" />
            </div>
            <h2 className={styles.successTitle}>Akun Berhasil Dibuat</h2>
            <p className={styles.successText}>
              Tautan pengaturan kata sandi dikirim ke email petugas.
              Petugas dapat mengatur kata sandi melalui tautan tersebut lalu masuk.
            </p>
            <Tombol ikon={UserPlus} onClick={handleReset}>Tambah Petugas Lain</Tombol>
          </Kartu>
        ) : (
          <Kartu judul="Data petugas">
            <form className={styles.form} onSubmit={handleSubmit}>
              <Field label="Email Petugas" wajib>
                <input
                  type="email"
                  placeholder="nama@lmh.go.id"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                  required
                />
              </Field>

              <Field label="Nama Petugas" wajib>
                <input
                  type="text"
                  placeholder="Contoh: Petugas OSS"
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  autoComplete="off"
                  required
                  minLength={2}
                />
              </Field>

              {loadingLayanan ? (
                <Skeleton bentuk="baris" label="Memuat layanan" />
              ) : galatLayanan ? (
                <Galat pesan={galatLayanan} onRetry={() => { void loadLayanan(); }} />
              ) : layananList.length === 0 ? (
                <CatatanKeadaan jenis="tanpa-layanan">Tidak ada layanan tersedia.</CatatanKeadaan>
              ) : (
                <Field
                  label={tanpaLayanan ? `Layanan (tidak dipakai untuk ${role === 'admin' ? 'admin' : 'front office'})` : 'Layanan'}
                  wajib={!tanpaLayanan}>
                  <select value={layananId} onChange={(e) => setLayananId(e.target.value)} required={role === 'petugas'}>
                    <option value="">{role === 'petugas' ? 'Pilih layanan' : 'Tanpa layanan'}</option>
                    {layananList.map((l) => (
                      <option key={l.id} value={l.id}>{l.nama}</option>
                    ))}
                  </select>
                </Field>
              )}

              <div className={styles.roleBlok}>
                <span className={styles.roleLabel} id="invite-role-label">Role</span>
                <div className={styles.roleRow} role="radiogroup" aria-labelledby="invite-role-label">
                  {ROLE_PILIHAN.map((r) => (
                    <label key={r.nilai} className={`${styles.roleOption} ${role === r.nilai ? styles.roleOptionActive : ''}`}>
                      <input type="radio" name="role" value={r.nilai} checked={role === r.nilai} onChange={() => setRole(r.nilai)} />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className={styles.actions}>
                <Tombol
                  type="submit"
                  ikon={UserPlus}
                  memuat={submitting}
                  disabled={loadingLayanan || (role === 'petugas' && layananList.length === 0)}>
                  {submitting ? 'Memproses...' : 'Tambah Petugas'}
                </Tombol>
              </div>
            </form>
          </Kartu>
        )}
      </div>
    </>
  );
}
