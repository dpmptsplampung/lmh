'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Store,
  Loader2,
  CheckCircle2,
  AlertCircle,
  LogIn,
} from 'lucide-react';
import { KATEGORI_UMKM, type KategoriUMKM } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import styles from './edit.module.css';

interface Listing {
  id: string;
  nama_umkm: string;
  kategori_kebutuhan: string;
  deskripsi: string | null;
  kontak_nama: string;
  kontak_hp: string | null;
  kontak_email: string | null;
  foto_produk: string[] | null;
  status: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no_session' }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; listing: Listing };

export default function UmkmEditPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [form, setForm] = useState({
    nama_umkm: '',
    kategori_kebutuhan: '' as KategoriUMKM | '',
    deskripsi: '',
    kontak_nama: '',
    kontak_hp: '',
    kontak_email: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<
    { kind: 'success' } | { kind: 'error'; message: string } | null
  >(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setState({ kind: 'no_session' });
        return;
      }

      const { data, error } = await supabase
        .from('listing_umkm')
        .select('id, nama_umkm, kategori_kebutuhan, deskripsi, kontak_nama, kontak_hp, kontak_email, foto_produk, status')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        setState({ kind: 'error', message: error.message });
        return;
      }
      if (!data) {
        setState({ kind: 'not_found' });
        return;
      }

      const row = data as Record<string, unknown>;
      const listing: Listing = {
        id: row.id as string,
        nama_umkm: row.nama_umkm as string,
        kategori_kebutuhan: row.kategori_kebutuhan as string,
        deskripsi: (row.deskripsi as string) ?? null,
        kontak_nama: row.kontak_nama as string,
        kontak_hp: (row.kontak_hp as string) ?? null,
        kontak_email: (row.kontak_email as string) ?? null,
        foto_produk: (row.foto_produk as string[]) ?? null,
        status: row.status as string,
      };

      setForm({
        nama_umkm: listing.nama_umkm ?? '',
        kategori_kebutuhan: listing.kategori_kebutuhan as KategoriUMKM | '',
        deskripsi: listing.deskripsi ?? '',
        kontak_nama: listing.kontak_nama ?? '',
        kontak_hp: listing.kontak_hp ?? '',
        kontak_email: listing.kontak_email ?? '',
      });
      setState({ kind: 'ready', listing });
    }
    load();
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.kind !== 'ready') return;

    setSubmitting(true);
    setSubmitResult(null);

    const supabase = createClient();
    const { error } = await supabase
      .from('listing_umkm')
      .update({
        nama_umkm: form.nama_umkm,
        kategori_kebutuhan: form.kategori_kebutuhan,
        deskripsi: form.deskripsi || null,
        kontak_nama: form.kontak_nama,
        kontak_hp: form.kontak_hp || null,
        kontak_email: form.kontak_email || null,
        status: 'pending_review',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    setSubmitting(false);

    if (error) {
      setSubmitResult({ kind: 'error', message: error.message });
      return;
    }
    setSubmitResult({ kind: 'success' });
  };

  // --- Render ---

  if (state.kind === 'loading') {
    return (
      <div className={styles.editPage}>
        <div className={styles.editContainer}>
          <div className={styles.loadingBox}>
            <Loader2 size={32} className={styles.spinner} />
            <p>Memuat data listing…</p>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'no_session') {
    return (
      <div className={styles.editPage}>
        <div className={styles.editContainer}>
          <div className={styles.noticeBox}>
            <LogIn size={32} />
            <h2>Anda perlu masuk untuk mengedit listing</h2>
            <p>
              Link edit hanya berlaku untuk pemilik listing yang terdaftar.
              Silakan minta link edit baru melalui email Anda, lalu klik link
              tersebut untuk masuk.
            </p>
            <Link href={`/umkm?edit_login_required=1`} className={styles.backBtn}>
              <ArrowLeft size={16} />
              Kembali ke daftar UMKM
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'not_found') {
    return (
      <div className={styles.editPage}>
        <div className={styles.editContainer}>
          <div className={styles.noticeBox}>
            <AlertCircle size={32} />
            <h2>Listing tidak ditemukan</h2>
            <p>
              Listing tidak ditemukan atau Anda tidak memiliki izin untuk
              mengeditnya. Pastikan Anda membuka link edit yang dikirim ke
              email pemilik listing.
            </p>
            <Link href="/umkm" className={styles.backBtn}>
              <ArrowLeft size={16} />
              Kembali ke daftar UMKM
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className={styles.editPage}>
        <div className={styles.editContainer}>
          <div className={styles.noticeBox}>
            <AlertCircle size={32} />
            <h2>Terjadi kesalahan</h2>
            <p>{state.message}</p>
            <Link href="/umkm" className={styles.backBtn}>
              <ArrowLeft size={16} />
              Kembali ke daftar UMKM
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const listing = state.listing;

  return (
    <div className={styles.editPage}>
      <div className={styles.editContainer}>
        <Link href="/umkm" className={styles.backBtn}>
          <ArrowLeft size={16} />
          Kembali ke daftar UMKM
        </Link>

        <header className={styles.editHeader}>
          <Store size={28} />
          <div>
            <h1>Edit Listing UMKM</h1>
            <p className={styles.statusBadge}>
              Status saat ini: <strong>{listing.status}</strong> · Perubahan akan dikirim untuk persetujuan admin.
            </p>
          </div>
        </header>

        {submitResult?.kind === 'success' && (
          <div className={styles.successBox}>
            <CheckCircle2 size={20} />
            <span>Perubahan Anda tersimpan dan menunggu persetujuan admin.</span>
          </div>
        )}
        {submitResult?.kind === 'error' && (
          <div className={styles.errorBox}>
            <AlertCircle size={20} />
            <span>Gagal menyimpan: {submitResult.message}</span>
          </div>
        )}

        <form className={styles.editForm} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="nama_umkm">Nama UMKM</label>
            <input
              id="nama_umkm"
              type="text"
              className="form-input"
              value={form.nama_umkm}
              onChange={(e) => setForm({ ...form, nama_umkm: e.target.value })}
              required
              maxLength={200}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="kategori_kebutuhan">Kategori Kebutuhan</label>
            <select
              id="kategori_kebutuhan"
              className="form-input"
              value={form.kategori_kebutuhan}
              onChange={(e) =>
                setForm({ ...form, kategori_kebutuhan: e.target.value as KategoriUMKM })
              }
              required
            >
              <option value="" disabled>
                Pilih kategori…
              </option>
              {Object.entries(KATEGORI_UMKM).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor="deskripsi">Deskripsi</label>
            <textarea
              id="deskripsi"
              className="form-input"
              rows={4}
              value={form.deskripsi}
              onChange={(e) => setForm({ ...form, deskripsi: e.target.value })}
              maxLength={2000}
            />
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label htmlFor="kontak_nama">Nama Kontak</label>
              <input
                id="kontak_nama"
                type="text"
                className="form-input"
                value={form.kontak_nama}
                onChange={(e) => setForm({ ...form, kontak_nama: e.target.value })}
                required
                maxLength={200}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="kontak_hp">No. HP / WhatsApp</label>
              <input
                id="kontak_hp"
                type="text"
                className="form-input"
                value={form.kontak_hp}
                onChange={(e) => setForm({ ...form, kontak_hp: e.target.value })}
                maxLength={50}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label htmlFor="kontak_email">Email Kontak</label>
            <input
              id="kontak_email"
              type="email"
              className="form-input"
              value={form.kontak_email}
              onChange={(e) => setForm({ ...form, kontak_email: e.target.value })}
              maxLength={200}
            />
          </div>

          {listing.foto_produk && listing.foto_produk.length > 0 && (
            <div className={styles.field}>
              <label>Foto Produk (tidak dapat diubah di sini)</label>
              <p className={styles.hint}>
                Foto produk dikelola admin. Hubungi admin jika perlu mengubah foto.
              </p>
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className={styles.spinner} />
                  Menyimpan…
                </>
              ) : (
                'Simpan & Ajukan Review'
              )}
            </button>
            <Link href="/umkm" className={styles.cancelBtn}>
              Batal
            </Link>
          </div>

          <p className={styles.hint}>
            Setelah disimpan, status listing berubah menjadi <strong>pending_review</strong>.
            Listing versi sebelumnya tetap tayang hingga admin menyetujui perubahan.
            Anda tidak dapat mempublikasikan listing sendiri.
          </p>
        </form>
      </div>
    </div>
  );
}
