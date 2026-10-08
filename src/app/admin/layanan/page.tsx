'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useToast } from '@/components/Toast';
import RoleNote from '@/components/admin/RoleNote';
import { AkunDialog } from '@/components/admin/AkunForm';
import { adminFetch } from '@/components/admin/adminFetch';
import LayananForm, { STATUS_LABEL, type LayananRow } from '@/components/admin/layanan/LayananForm';

const ya = (v: boolean) => (v ? 'Ya' : 'Tidak');

export default function KelolaLayananPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<LayananRow[]>([]);
  const [bisaUbah, setBisaUbah] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [edit, setEdit] = useState<LayananRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const load = useCallback(async () => {
    try {
      const json = await adminFetch<{ layanan: LayananRow[]; bisa_ubah: boolean }>('/api/admin/layanan');
      setRows(json.layanan ?? []);
      setBisaUbah(json.bisa_ubah === true);
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Gagal memuat layanan');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const tutup = useCallback(() => { setEdit(null); setDialogError(''); }, []);

  const simpan = async (row: LayananRow, patch: Record<string, string | boolean | null>) => {
    setBusy(true);
    setDialogError('');
    try {
      await adminFetch(`/api/admin/layanan/${row.id}`, 'PATCH', patch);
      toast('Layanan diperbarui.', 'success');
      tutup();
      await load();
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };

  const ubahBot = async (row: LayananRow) => {
    try {
      await adminFetch(`/api/admin/layanan/${row.id}/bot`, 'PATCH', { aktif: !row.chatbot_aktif });
      toast(`Bot ${row.nama} ${row.chatbot_aktif ? 'dimatikan' : 'dihidupkan'}.`, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengubah bot', 'error');
    }
  };

  return (
    <>
      <PageHeader title="Kelola Layanan" description="Nama, loket, prefiks, tampilan publik, layar TV, antrean, chat, dan bot" />
      <div style={{ padding: 'clamp(var(--space-4), 4vw, var(--space-8))' }}>
        {!loading && !loadError && (
          <RoleNote>
            {bisaUbah
              ? 'Admin: Anda dapat mengubah layanan. Setiap perubahan tercatat di Riwayat Perubahan.'
              : 'Front Office: halaman ini hanya untuk dilihat. Perubahan layanan dilakukan oleh Admin.'}
          </RoleNote>
        )}
        <div className="table-wrapper">
          {loading ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="status" aria-label="Memuat">
              <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} />
            </div>
          ) : loadError ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="alert" className="form-error">{loadError}</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>Belum ada layanan.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Layanan</th><th>Loket</th><th>Prefiks</th><th>Halaman utama</th>
                  <th>Layar TV</th><th>Antrean</th><th>Chat</th><th>Bot</th>
                  {bisaUbah && <th>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.nama}</td>
                    <td>{r.nomor_loket ?? '—'}</td>
                    <td>{r.prefiks_antrean ?? '—'}</td>
                    <td>{STATUS_LABEL[r.status_tampilan] ?? r.status_tampilan}</td>
                    <td>{ya(r.tampil_di_layar)}</td>
                    <td>{ya(r.punya_antrean)}</td>
                    <td>{ya(r.punya_chat)}</td>
                    <td>
                      {bisaUbah ? (
                        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                          <input type="checkbox" role="switch" aria-label={`Bot ${r.nama}`}
                            checked={r.chatbot_aktif} onChange={() => ubahBot(r)} />
                          {r.chatbot_aktif ? 'Hidup' : 'Mati'}
                        </label>
                      ) : (r.chatbot_aktif ? 'Hidup' : 'Mati')}
                    </td>
                    {bisaUbah && (
                      <td>
                        <button type="button" className="btn btn--secondary btn--sm"
                          aria-label={`Ubah ${r.nama}`} onClick={() => setEdit(r)}>Ubah</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {edit && (
        <AkunDialog title={`Ubah layanan: ${edit.nama}`} onClose={tutup}>
          <LayananForm layanan={edit} saving={busy} error={dialogError}
            onSubmit={(patch) => simpan(edit, patch)} onCancel={tutup} />
        </AkunDialog>
      )}
    </>
  );
}
