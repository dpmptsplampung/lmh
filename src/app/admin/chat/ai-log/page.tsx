'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  PlusCircle,
  Filter,
  Bot,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Pagination from '@/components/Pagination';
import { createClient } from '@/lib/supabase/client';
import styles from './ai-log.module.css';

const PAGE_SIZE = 25;

interface AiLogRow {
  id: string;
  sesi_id: string | null;
  pertanyaan: string;
  context_faq_ids: string[] | null;
  jawaban: string | null;
  top_similarity: number | null;
  eskalasi: boolean;
  reason: string | null;
  created_at: string;
}

type FilterMode = 'all' | 'eskalasi' | 'low_similarity';

export default function AdminAiLogPage() {
  const [rows, setRows] = useState<AiLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const query = supabase
        .from('chat_ai_log')
        .select(
          'id, sesi_id, pertanyaan, context_faq_ids, jawaban, top_similarity, eskalasi, reason, created_at',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false });

      const paged = typeof query.range === 'function' ? query.range(from, to) : query.limit(PAGE_SIZE);
      const { data, count, error: fetchErr } = await paged;

      if (fetchErr) throw fetchErr;
      setRows((data ?? []) as AiLogRow[]);
      setTotalCount(count ?? (data?.length ?? 0));
    } catch {
      setError('Gagal memuat log AI. Pastikan Anda login sebagai admin.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const filtered = rows.filter((r) => {
    if (filter === 'eskalasi') return r.eskalasi;
    if (filter === 'low_similarity') {
      return r.top_similarity !== null && r.top_similarity < 0.8;
    }
    return true;
  });

  const truncate = (s: string | null, n: number): string => {
    if (!s) return '—';
    return s.length > n ? s.slice(0, n) + '…' : s;
  };

  const fmtTime = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const fmtSim = (v: number | null): string => {
    if (v === null) return '—';
    return v.toFixed(3);
  };

  return (
    <>
      <PageHeader
        title="Log Asisten AI"
        description="Audit jawaban asisten AI ber-RAG — tinjau eskalasi & similarity rendah"
      />

      <div className={styles.container}>
        <div className={styles.toolbar}>
          <Link href="/admin" className={styles.backLink}>
            <ArrowLeft size={16} />
            Kembali ke Dashboard
          </Link>

          <div className={styles.filterGroup}>
            <Filter size={14} />
            <select
              className={styles.filterSelect}
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterMode)}
            >
              <option value="all">Semua ({totalCount})</option>
              <option value="eskalasi">
                Eskalasi saja ({rows.filter((r) => r.eskalasi).length})
              </option>
              <option value="low_similarity">
                Similarity &lt; 0.8 ({rows.filter((r) => r.top_similarity !== null && r.top_similarity < 0.8).length})
              </option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className={styles.loadingState}>
            <Loader2 size={24} className="animate-pulse" />
            <span>Memuat log...</span>
          </div>
        ) : error ? (
          <div className={styles.errorState}>
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <Bot size={32} />
            <p>Belum ada log asisten AI. Log akan muncul setelah pengunjung menggunakan mode chatbot.</p>
          </div>
        ) : (
          <>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Pertanyaan</th>
                  <th>Jawaban</th>
                  <th>Similarity</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 'var(--text-xs)' }}>
                      {fmtTime(row.created_at)}
                    </td>
                    <td style={{ maxWidth: 260 }}>
                      <span title={row.pertanyaan}>{truncate(row.pertanyaan, 80)}</span>
                    </td>
                    <td style={{ maxWidth: 300 }}>
                      <span title={row.jawaban ?? ''}>
                        {row.eskalasi ? (
                          <em style={{ color: 'var(--text-tertiary)' }}>
                            {row.reason === 'no_match' ? 'Tidak ada match FAQ' : 'Error AI'}
                          </em>
                        ) : (
                          truncate(row.jawaban, 100)
                        )}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>
                      {fmtSim(row.top_similarity)}
                    </td>
                    <td>
                      {row.eskalasi ? (
                        <span className="badge badge--eskalasi">⚠ Eskalasi</span>
                      ) : (
                        <span className="badge badge--aktif">✓ Terjawab</span>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/admin/chat/faq?prefill_pertanyaan=${encodeURIComponent(row.pertanyaan)}`}
                        className={styles.addFaqBtn}
                        title="Tambahkan pertanyaan ini ke FAQ"
                      >
                        <PlusCircle size={14} />
                        Tambah ke FAQ
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={totalCount} onPageChange={setPage} />
          </>
        )}
      </div>
    </>
  );
}
