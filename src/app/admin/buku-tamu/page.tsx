'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Pagination from '@/components/Pagination';
import { useToast } from '@/components/Toast';
import RoleNote from '@/components/admin/RoleNote';
import { adminFetch } from '@/components/admin/adminFetch';
import TamuForm, { type TamuInput } from '@/components/admin/bukutamu/TamuForm';

interface Tamu {
  id: string;
  nama: string;
  instansi: string | null;
  no_hp: string | null;
  bertemu: string | null;
  tujuan: string | null;
  waktu_masuk: string;
}

const LIMIT = 50;
const jam = (iso: string) =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

export default function BukuTamuPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<Tamu[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async (p: number) => {
    try {
      // Tanpa dari/sampai: server memakai hari ini (WIB).
      const json = await adminFetch<{ items: Tamu[]; total: number }>(`/api/admin/buku-tamu?page=${p + 1}&limit=${LIMIT}`);
      setItems(json.items ?? []);
      setTotal(json.total ?? 0);
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Gagal memuat buku tamu');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(page);
  }, [load, page]);

  const catat = async (data: TamuInput) => {
    await adminFetch('/api/admin/buku-tamu', 'POST', data);
    toast('Tamu dicatat.', 'success');
    if (page === 0) await load(0); else setPage(0);
  };

  return (
    <>
      <PageHeader title="Buku Tamu" description="Catatan tamu kantor hari ini" />
      <div style={{ padding: 'clamp(var(--space-4), 4vw, var(--space-8))' }}>
        <RoleNote>Admin dan Front Office dapat mencatat tamu kantor. Daftar di bawah menampilkan tamu hari ini.</RoleNote>
        <TamuForm onSubmit={catat} />
        <div className="table-wrapper">
          {loading ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="status" aria-label="Memuat">
              <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} />
            </div>
          ) : loadError ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="alert" className="form-error">{loadError}</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>Belum ada tamu tercatat hari ini.</div>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr><th>Jam</th><th>Nama</th><th>Instansi</th><th>Bertemu</th><th>Tujuan</th></tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id}>
                      <td>{jam(t.waktu_masuk)}</td>
                      <td style={{ fontWeight: 600 }}>{t.nama}</td>
                      <td>{t.instansi ?? '—'}</td>
                      <td>{t.bertemu ?? '—'}</td>
                      <td>{t.tujuan ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={page} pageSize={LIMIT} total={total} onPageChange={setPage} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
