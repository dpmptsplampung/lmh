'use client';

import { useState, useEffect, useCallback } from 'react';
import { UserPlus, Loader2, Copy, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import AkunForm, { AkunDialog, type AkunRow, type LayananOption } from '@/components/admin/AkunForm';
import AkunBaruForm, { type AkunBaruInput } from '@/components/admin/AkunBaruForm';

type Dialog =
  | { kind: 'edit'; akun: AkunRow }
  | { kind: 'reset'; akun: AkunRow }
  | { kind: 'sandi'; akun: AkunRow; sandi: string }
  | { kind: 'status'; akun: AkunRow }
  | { kind: 'baru' }
  | { kind: 'sandiBaru'; nama: string; username: string; sandi: string }
  | null;

const ROLE_LABEL = { admin: 'Admin', petugas: 'Petugas', front_office: 'Front Office' } as const;

const fmtLogin = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Permintaan gagal');
  return json;
}

export default function AdminPetugasPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AkunRow[]>([]);
  const [layananList, setLayananList] = useState<LayananOption[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [alasan, setAlasan] = useState('');

  const load = useCallback(async () => {
    try {
      const [daftar, layanan, me] = await Promise.all([
        api('/api/admin/petugas', 'GET'),
        createClient().from('layanan').select('id, nama').order('nama'),
        api('/api/me/profil', 'GET').catch(() => null),
      ]);
      setRows((daftar.akun ?? []) as AkunRow[]);
      setLayananList((layanan?.data ?? []) as LayananOption[]);
      setSelfId(me?.profil?.id ?? null);
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Gagal memuat daftar akun');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const aktifAdminCount = rows.filter((r) => r.role === 'admin' && r.aktif).length;
  const tutup = useCallback(() => {
    setDialog(null);
    setDialogError('');
    setAlasan('');
  }, []);

  const jalankan = async (fn: () => Promise<void>) => {
    setBusy(true);
    setDialogError('');
    try {
      await fn();
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : 'Gagal');
    } finally {
      setBusy(false);
    }
  };

  const simpanEdit = (akun: AkunRow, patch: Record<string, string | null>) =>
    jalankan(async () => {
      await api(`/api/admin/petugas/${akun.id}`, 'PATCH', patch);
      toast('Akun diperbarui.', 'success');
      tutup();
      await load();
    });

  const buatAkun = (data: AkunBaruInput) =>
    jalankan(async () => {
      const json = await api('/api/admin/petugas', 'POST', data);
      setDialog({ kind: 'sandiBaru', nama: data.nama, username: json.username ?? data.username, sandi: json.sandi_sementara });
      await load();
    });

  const resetSandi = (akun: AkunRow) =>
    jalankan(async () => {
      const json = await api(`/api/admin/petugas/${akun.id}/reset-password`, 'POST');
      setDialog({ kind: 'sandi', akun, sandi: json.sandi_sementara });
      await load();
    });

  const ubahStatus = (akun: AkunRow) =>
    jalankan(async () => {
      if (akun.aktif && !alasan.trim()) throw new Error('Alasan wajib diisi.');
      await api('/api/admin/petugas/status', 'POST',
        akun.aktif
          ? { aksi: 'nonaktifkan', petugas_id: akun.id, alasan: alasan.trim() }
          : { aksi: 'aktifkan', petugas_id: akun.id });
      toast(akun.aktif ? `Akun ${akun.nama} dinonaktifkan.` : `Akun ${akun.nama} diaktifkan kembali.`, 'success');
      tutup();
      await load();
    });

  const salin = async (teks: string) => {
    try {
      await navigator.clipboard.writeText(teks);
      toast('Disalin.', 'success');
    } catch {
      toast('Gagal menyalin. Salin manual.', 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Kelola Akun"
        description="Akun petugas dan akun layanan: data, reset kata sandi, aktif/nonaktif"
      >
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setDialog({ kind: 'baru' })}>
          <UserPlus size={14} /> Buat Akun Layanan
        </button>
        <Link href="/admin/petugas/invite" className="btn btn--secondary btn--sm">
          Undang Petugas
        </Link>
      </PageHeader>

      <div style={{ padding: 'clamp(var(--space-4), 4vw, var(--space-8))' }}>
        <div className="table-wrapper">
          {loading ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="status" aria-label="Memuat">
              <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} />
            </div>
          ) : loadError ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="alert" className="form-error">
              {loadError}
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              Belum ada akun terdaftar.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Nama pengguna</th>
                  <th>Role</th>
                  <th>Layanan</th>
                  <th>No HP</th>
                  <th>Status</th>
                  <th>Terakhir login</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSelf = row.id === selfId;
                  const adminTerakhir = row.role === 'admin' && row.aktif && aktifAdminCount <= 1;
                  const blokirNonaktif = row.aktif && (isSelf || adminTerakhir);
                  return (
                    <tr key={row.id} style={row.aktif ? undefined : { opacity: 0.6 }}>
                      <td style={{ fontWeight: 600 }}>{row.nama}{isSelf ? ' (Anda)' : ''}</td>
                      <td>{row.username ?? '—'}</td>
                      <td>
                        <span className={`badge badge--${row.role === 'admin' ? 'aktif' : 'draft'}`}>
                          {ROLE_LABEL[row.role]}
                        </span>
                      </td>
                      <td>{row.layanan_nama ?? '—'}</td>
                      <td>{row.no_hp ?? '—'}</td>
                      <td>
                        <span className={`badge ${row.aktif ? 'badge--selesai' : 'badge--nonaktif'}`}>
                          {row.aktif ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td>
                        {row.belum_pernah_login
                          ? <span className="badge badge--pending">Belum pernah login</span>
                          : fmtLogin(row.last_sign_in_at)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn--secondary btn--sm"
                            aria-label={`Ubah ${row.nama}`} onClick={() => setDialog({ kind: 'edit', akun: row })}>
                            Ubah
                          </button>
                          <button type="button" className="btn btn--ghost btn--sm"
                            aria-label={`Reset sandi ${row.nama}`} disabled={isSelf}
                            title={isSelf ? 'Gunakan Profil Saya untuk mengganti sandi sendiri' : undefined}
                            onClick={() => setDialog({ kind: 'reset', akun: row })}>
                            Reset sandi
                          </button>
                          <button type="button"
                            className={`btn btn--sm ${row.aktif ? 'btn--danger' : 'btn--secondary'}`}
                            aria-label={`${row.aktif ? 'Nonaktifkan' : 'Aktifkan'} ${row.nama}`}
                            disabled={blokirNonaktif}
                            title={blokirNonaktif ? (isSelf ? 'Tidak bisa menonaktifkan akun sendiri' : 'Admin aktif terakhir tidak bisa dinonaktifkan') : undefined}
                            onClick={() => setDialog({ kind: 'status', akun: row })}>
                            {row.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {dialog?.kind === 'edit' && (
        <AkunDialog title={`Ubah akun: ${dialog.akun.nama}`} onClose={tutup}>
          <AkunForm
            akun={dialog.akun}
            layananList={layananList}
            isSelf={dialog.akun.id === selfId}
            saving={busy}
            error={dialogError}
            onSubmit={(patch) => simpanEdit(dialog.akun, patch)}
            onCancel={tutup}
          />
        </AkunDialog>
      )}

      {dialog?.kind === 'baru' && (
        <AkunDialog title="Buat akun layanan" onClose={tutup}>
          <AkunBaruForm layananList={layananList} saving={busy} error={dialogError} onSubmit={buatAkun} onCancel={tutup} />
        </AkunDialog>
      )}

      {dialog?.kind === 'sandiBaru' && (
        <AkunDialog title="Akun dibuat" onClose={tutup}>
          <p>Nama pengguna: <strong>{dialog.username}</strong></p>
          <p role="alert" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', color: 'var(--color-warning-700, #92400e)' }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>Sandi sementara ini hanya ditampilkan sekali dan tidak disimpan. Salin dan berikan ke <strong>{dialog.nama}</strong> lewat jalur aman. Pengguna wajib menggantinya saat masuk pertama kali.</span>
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', margin: 'var(--space-4) 0' }}>
            <input readOnly className="form-input" value={dialog.sandi} aria-label="Sandi sementara"
              onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'monospace' }} />
            <button type="button" className="btn btn--secondary" onClick={() => salin(dialog.sandi)}>
              <Copy size={16} /> Salin
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn--primary" onClick={tutup}>Selesai</button>
          </div>
        </AkunDialog>
      )}

      {dialog?.kind === 'reset' && (
        <AkunDialog title="Reset kata sandi" onClose={tutup}>
          <p>Buat kata sandi sementara untuk <strong>{dialog.akun.nama}</strong>? Semua sesi akun ini diakhiri dan pengguna wajib menggantinya saat masuk.</p>
          {dialogError && <p className="form-error" role="alert">{dialogError}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button type="button" className="btn btn--ghost" onClick={tutup}>Batal</button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => resetSandi(dialog.akun)}>
              {busy ? <Loader2 size={16} className="animate-pulse" /> : null} Buat sandi sementara
            </button>
          </div>
        </AkunDialog>
      )}

      {dialog?.kind === 'sandi' && (
        <AkunDialog title="Kata sandi sementara akun" onClose={tutup}>
          <p role="alert" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', color: 'var(--color-warning-700, #92400e)' }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>Sandi ini hanya ditampilkan sekali dan tidak disimpan. Salin dan berikan ke <strong>{dialog.akun.nama}</strong> lewat jalur aman.</span>
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', margin: 'var(--space-4) 0' }}>
            <input readOnly className="form-input" value={dialog.sandi} aria-label="Sandi sementara"
              onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'monospace' }} />
            <button type="button" className="btn btn--secondary" onClick={() => salin(dialog.sandi)}>
              <Copy size={16} /> Salin
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn--primary" onClick={tutup}>Selesai</button>
          </div>
        </AkunDialog>
      )}

      {dialog?.kind === 'status' && (
        <AkunDialog title={dialog.akun.aktif ? 'Nonaktifkan akun' : 'Aktifkan akun'} onClose={tutup}>
          {dialog.akun.aktif ? (
            <>
              <p>Akun <strong>{dialog.akun.nama}</strong> tidak akan bisa masuk dan sesinya diakhiri.</p>
              <div className="form-group" style={{ marginTop: 'var(--space-3)' }}>
                <label className="form-label form-label--required" htmlFor="alasanNonaktif">Alasan (tercatat)</label>
                <textarea id="alasanNonaktif" className="form-input" rows={3} value={alasan}
                  onChange={(e) => setAlasan(e.target.value)} />
              </div>
            </>
          ) : (
            <p>Aktifkan kembali akun <strong>{dialog.akun.nama}</strong>?</p>
          )}
          {dialogError && <p className="form-error" role="alert">{dialogError}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button type="button" className="btn btn--ghost" onClick={tutup}>Batal</button>
            <button type="button" className={`btn ${dialog.akun.aktif ? 'btn--danger' : 'btn--primary'}`}
              disabled={busy} onClick={() => ubahStatus(dialog.akun)}>
              {busy ? <Loader2 size={16} className="animate-pulse" /> : null} {dialog.akun.aktif ? 'Nonaktifkan' : 'Aktifkan'}
            </button>
          </div>
        </AkunDialog>
      )}
    </>
  );
}
