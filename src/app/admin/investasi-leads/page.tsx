'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  TrendingUp,
  Search,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import styles from './investasi-leads.module.css';

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

function statusClass(status: LeadStatus): string {
  switch (status) {
    case 'baru': return styles.statusBaru;
    case 'dihubungi': return styles.statusDihubungi;
    case 'berlanjut': return styles.statusBerlanjut;
    case 'ditolak': return styles.statusDitolak;
    case 'selesai': return styles.statusSelesai;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

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

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const { data, error: fetchErr } = await supabase
        .from('investasi_lead')
        .select('id, doc_id, nama, email, instansi, minat, catatan, status, created_at, investment_documents(judul)')
        .order('created_at', { ascending: false });

      if (fetchErr) throw fetchErr;
      setRows((data ?? []) as LeadRow[]);
    } catch (e) {
      console.error('Investasi leads error:', e);
      setError('Gagal memuat data lead. Pastikan Anda login sebagai admin/petugas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

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

  const filtered = rows.filter((r) => {
    if (statusFilter !== 'semua' && r.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      return r.nama.toLowerCase().includes(q) || r.email.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <>
      <PageHeader
        title="Lead Investasi"
        description="CRM-lite: permintaan minat investasi dari Investment Gallery"
      />

      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>
              <TrendingUp size={20} style={{ color: 'var(--color-primary-500)' }} />
              Daftar Lead
            </h2>
            <p className={styles.subtitle}>
              {filtered.length} dari {rows.length} lead
            </p>
          </div>
          <Link href="/admin" className={styles.backLink}>
            <ArrowLeft size={16} />
            Kembali ke Dashboard
          </Link>
        </div>

        {error && (
          <div className={styles.errorBox} role="alert">
            <AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {error}
          </div>
        )}

        <div className={styles.filterBar}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Status</span>
            <select
              className={styles.filterSelect}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'semua' | LeadStatus)}
              aria-label="Filter status"
            >
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

        {loading ? (
          <div className={styles.loading}>
            <Loader2 size={28} className="animate-pulse" />
          </div>
        ) : (
          <div className={styles.tableSection}>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Dokumen</th>
                    <th>Nama</th>
                    <th>Email</th>
                    <th>Instansi</th>
                    <th>Minat</th>
                    <th>Status</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className={styles.tableEmpty}>
                        <TrendingUp size={20} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                        Belum ada lead investasi
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r) => (
                      <tr key={r.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.created_at)}</td>
                        <td>{r.investment_documents?.[0]?.judul ?? '—'}</td>
                        <td style={{ fontWeight: 500 }}>{r.nama}</td>
                        <td style={{ fontSize: 'var(--text-xs)' }}>{r.email}</td>
                        <td>{r.instansi ?? '—'}</td>
                        <td style={{ maxWidth: '200px' }} title={r.minat ?? ''}>{truncate(r.minat, 60)}</td>
                        <td>
                          <span className={`${styles.statusBadge} ${statusClass(r.status)}`}>
                            {STATUS_LABELS[r.status]}
                          </span>
                        </td>
                        <td>
                          <select
                            className={styles.actionSelect}
                            value={r.status}
                            onChange={(e) => handleStatusChange(r.id, e.target.value as LeadStatus)}
                            disabled={updatingId === r.id}
                            aria-label={`Ubah status lead ${r.nama}`}
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
