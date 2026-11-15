'use client';

import tampilan from './page.dasbor.module.css';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, Search } from 'lucide-react';
import Kartu from '@/components/ui/Kartu';
import Tabel from '@/components/ui/Tabel';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Galat from '@/components/ui/Galat';
import { formatTanggal } from '@/lib/utils';
import PageHeader from '@/components/layout/PageHeader';
import IsiHalaman from '@/components/layout/IsiHalaman';
import Pagination from '@/components/Pagination';
import { createClient } from '@/lib/supabase/client';
import styles from './investasi-leads.module.css';

const PAGE_SIZE = 25;

type LeadStatus = 'baru' | 'dihubungi' | 'berlanjut' | 'ditolak' | 'selesai';

const STATUS_OPTIONS: LeadStatus[] = ['baru', 'dihubungi', 'berlanjut', 'ditolak', 'selesai'];

const STATUS_LABELS: Record<LeadStatus, string> = {
  baru: 'Baru',
  dihubungi: 'Dihubungi',
  berlanjut: 'Berlanjut',
  ditolak: 'Ditolak',
  selesai: 'Selesai',
};

interface LeadRow {
  id: string;
  doc_id: string | null;
  nama: string;
  email: string;
  instansi: string | null;
  minat: string | null;
  catatan: string | null;
  status: LeadStatus;
  created_at: string;
  investment_documents: { judul: string }[] | null;
}

const statusNada = (status: LeadStatus): NadaLencana => status === 'baru' ? 'info' : status === 'ditolak' ? 'bahaya' : status === 'selesai' ? 'sukses' : 'netral';
const formatDate = (iso: string) => formatTanggal(iso, { day: '2-digit', month: 'short' });

function truncate(text: string | null, max: number): string {
  if (!text) return '—';
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

export default function InvestasiLeadsAdminPage() {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'semua' | LeadStatus>('semua');
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from('investasi_lead')
        .select('id, doc_id, nama, email, instansi, minat, catatan, status, created_at, investment_documents(judul)', { count: 'exact' })
        .order('created_at', { ascending: false });

      // T-15: Server-side filter
      if (statusFilter !== 'semua') {
        query = query.eq('status', statusFilter);
      }
      if (search.trim()) {
        const q = search.trim();
        query = query.or(`nama.ilike.%${q}%,email.ilike.%${q}%`);
      }

      const { data, count, error: fetchErr } = await query.range(from, to);

      if (fetchErr) throw fetchErr;
      setRows((data ?? []) as LeadRow[]);
      setTotalCount(count ?? (data?.length ?? 0));
    } catch (e) {
      console.error('Investasi leads error:', e);
      setError('Gagal memuat data lead. Pastikan Anda login sebagai admin/petugas.');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(0);
  }, [statusFilter, search]);

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    setUpdatingId(leadId);
    try {
      const res = await fetch(`/api/investasi/lead/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Gagal memperbarui status');
      }
      const updated = await res.json();
      setRows((prev) =>
        prev.map((r) => (r.id === leadId ? { ...r, status: updated.status as LeadStatus } : r)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memperbarui status');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Lead Investasi"
        description="CRM-lite: permintaan minat investasi dari Investment Gallery"
      />

      <IsiHalaman>
        {/* Satu anak blok: jarak antarbagian di halaman ini diatur margin header dan filterBar (bukan gap grid). */}
        <div>
          <div className={styles.header}>
            <div>
              <h2 className={styles.title}>
                <TrendingUp size={20} className={tampilan.area1}  />
                Daftar Lead
              </h2>
              <p className={styles.subtitle}>
                {error ? '—' : totalCount} lead{statusFilter !== 'semua' ? ` (${STATUS_LABELS[statusFilter]})` : ''}
              </p>
            </div>
            <Link href="/admin" className={styles.backLink}>
              <ArrowLeft size={16} />
              Kembali ke Dasbor
            </Link>
          </div>

          <div className={styles.filterBar}>
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Status</span>
              <select
                className={styles.filterSelect}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'semua' | LeadStatus)}
                aria-label="Filter status">
                <option value="semua">Semua</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Cari</span>
              <div className={styles.searchWrap}>
                <Search size={14} className={styles.searchIcon} />
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Nama atau email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Cari nama atau email"
                />
              </div>
            </div>
          </div>

          <Kartu judul="Lead investasi" padding="tanpa">
            {loading ? <Skeleton bentuk="baris" jumlah={5} label="Memuat lead investasi" /> : error ? (
              <Galat pesan={error} onRetry={() => { void loadData(); }} />
            ) : (
              <>
                <Tabel caption="Daftar lead investasi (WIB)" baris={rows} kunciBaris="id"
                  kosong={<StatusKosong ikon={TrendingUp} judul="Belum ada lead investasi" />} kolom={[
                    { kunci: 'tanggal', judul: 'Tanggal', render: (r) => formatDate(r.created_at) },
                    { kunci: 'dokumen', judul: 'Dokumen', render: (r) => r.investment_documents?.[0]?.judul ?? '—' },
                    { kunci: 'nama', judul: 'Nama', judulBaris: true },
                    { kunci: 'email', judul: 'Email' },
                    { kunci: 'instansi', judul: 'Instansi', render: (r) => r.instansi ?? '—' },
                    { kunci: 'minat', judul: 'Minat', render: (r) => <span title={r.minat ?? ''}>{truncate(r.minat, 60)}</span> },
                    { kunci: 'status', judul: 'Status', render: (r) => <Lencana nada={statusNada(r.status)}>{STATUS_LABELS[r.status]}</Lencana> },
                    { kunci: 'aksi', judul: 'Aksi', render: (r) => <select className={styles.actionSelect} value={r.status}
                      onChange={(e) => handleStatusChange(r.id, e.target.value as LeadStatus)} disabled={updatingId === r.id}
                      aria-label={`Ubah status lead ${r.nama}`}>
                      {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                    </select> },
                  ]} />
                <Pagination page={page} pageSize={PAGE_SIZE} total={totalCount} onPageChange={setPage} />
              </>
            )}
          </Kartu>
        </div>
      </IsiHalaman>
    </>
  );
}
