'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { Loader2, X } from 'lucide-react';
import { adminFetch } from '@/components/admin/adminFetch';
import { useDialogFokus } from '@/components/admin/useDialogFokus';
import type { InstansiRow } from '@/lib/layanan/schemas';
import styles from './KelolaLayanan.module.css';
import dialogStyles from '@/components/admin/AkunForm.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  instansi: InstansiRow[];
  /** Dipanggil setelah instansi berhasil dibuat/diubah agar induk memuat ulang daftar. */
  onSaved: () => void | Promise<void>;
}

export default function InstansiDialog(props: Props) {
  if (!props.open) return null;
  return <IsiDialog {...props} />;
}

const labelInstansi = (i: InstansiRow) => (i.singkatan ? `${i.nama} (${i.singkatan})` : i.nama);

function IsiDialog({ onClose, instansi, onSaved }: Props) {
  const idDasar = useId();
  const idJudul = `${idDasar}-judul`;
  const idGalat = `${idDasar}-galat`;
  const wadah = useRef<HTMLDivElement>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [nama, setNama] = useState('');
  const [singkatan, setSingkatan] = useState('');
  const [saving, setSaving] = useState(false);
  const [galat, setGalat] = useState('');
  const [info, setInfo] = useState('');

  useDialogFokus(true, wadah, () => { if (!saving) onClose(); });

  const reset = () => { setEditId(null); setNama(''); setSingkatan(''); setGalat(''); };
  const mulaiUbah = (i: InstansiRow) => {
    setEditId(i.id); setNama(i.nama); setSingkatan(i.singkatan ?? ''); setGalat(''); setInfo('');
    // Fokus ke isian nama agar pengguna keyboard/pembaca layar langsung masuk ke form ubah.
    requestAnimationFrame(() => document.getElementById(`${idDasar}-nama`)?.focus());
  };

  const kirim = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const namaBersih = nama.trim();
    if (namaBersih.length < 2 || namaBersih.length > 150) {
      setGalat('Nama instansi 2 sampai 150 karakter.');
      document.getElementById(`${idDasar}-nama`)?.focus();
      return;
    }
    if (singkatan.trim().length > 30) {
      setGalat('Singkatan maksimal 30 karakter.');
      document.getElementById(`${idDasar}-singkatan`)?.focus();
      return;
    }
    setSaving(true);
    setGalat('');
    setInfo('');
    const badan = { nama: namaBersih, singkatan: singkatan.trim() || null };
    try {
      if (editId) await adminFetch(`/api/admin/instansi/${editId}`, 'PATCH', badan);
      else await adminFetch('/api/admin/instansi', 'POST', badan);
      setInfo(editId ? `Instansi ${namaBersih} diperbarui.` : `Instansi ${namaBersih} ditambahkan.`);
      reset();
      await onSaved();
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal menyimpan instansi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={dialogStyles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div ref={wadah} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={idJudul} className={dialogStyles.dialog}>
        <div className={dialogStyles.dialogHead}>
          <h2 id={idJudul} className={dialogStyles.dialogTitle}>Kelola Instansi</h2>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Tutup">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className={styles.sectionHint}>
          Instansi adalah pemilik layanan, misalnya dinas atau lembaga. Layanan memilih instansinya di formulir layanan.
        </p>
        {instansi.length === 0 ? (
          <p className="form-hint" style={{ marginBottom: 'var(--space-4)' }}>Belum ada instansi. Tambahkan yang pertama di bawah.</p>
        ) : (
          <ul className={styles.instansiList}>
            {instansi.map((i) => (
              <li key={i.id} className={styles.instansiItem}>
                <span className={styles.instansiNama}>{labelInstansi(i)}</span>
                <button type="button" className="btn btn--secondary btn--sm" aria-label={`Ubah instansi ${i.nama}`}
                  onClick={() => mulaiUbah(i)}>Ubah</button>
              </li>
            ))}
          </ul>
        )}
        <p role="status" className="form-hint" style={{ minHeight: '1.2em', margin: '0 0 var(--space-2)' }}>{info}</p>
        <form onSubmit={kirim} noValidate className={styles.instansiForm} aria-label={editId ? 'Ubah instansi' : 'Tambah instansi'}>
          <div className="form-group">
            <label className="form-label form-label--required" htmlFor={`${idDasar}-nama`}>Nama instansi</label>
            <input id={`${idDasar}-nama`} className="form-input" value={nama} maxLength={150}
              aria-invalid={galat ? true : undefined} aria-describedby={galat ? idGalat : undefined}
              onChange={(e) => setNama(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor={`${idDasar}-singkatan`}>Singkatan (opsional)</label>
            <input id={`${idDasar}-singkatan`} className="form-input" value={singkatan} maxLength={30}
              onChange={(e) => setSingkatan(e.target.value)} />
          </div>
          {galat && <p id={idGalat} className="form-error" role="alert" style={{ margin: 0 }}>{galat}</p>}
          <div className={dialogStyles.actions}>
            {editId && <button type="button" className="btn btn--ghost" onClick={reset} disabled={saving}>Batal ubah</button>}
            <button type="submit" className="btn btn--primary" disabled={saving} aria-busy={saving}>
              {saving ? <Loader2 size={16} className="animate-pulse" aria-hidden="true" /> : null}
              {editId ? 'Simpan perubahan' : 'Tambah instansi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
