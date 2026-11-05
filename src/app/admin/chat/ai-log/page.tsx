'use client';

import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, PlusCircle, Bot, MessageSquare, ArrowUpRight, Search } from 'lucide-react';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Field from '@/components/ui/Field';
import Galat from '@/components/ui/Galat';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Lencana from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import Tombol from '@/components/ui/Tombol';
import { formatTanggal, formatWaktu } from '@/lib/utils';
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
    void Promise.resolve().then(loadData);
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

  const fmtSim = (v: number | null): string => {
    if (v === null) return '—';
    return v.toFixed(3);
  };

  const kolom: KolomTabel<AiLogRow>[] = [
    { kunci: 'waktu', judul: 'Waktu (WIB)', render: (row) => <time className={styles.waktu} dateTime={row.created_at}>{formatTanggal(row.created_at, { month: 'short' })}<span>{formatWaktu(row.created_at)} WIB</span></time> },
    { kunci: 'pertanyaan', judul: 'Pertanyaan', judulBaris: true, render: (row) => <span className={styles.pertanyaan} title={row.pertanyaan}>{truncate(row.pertanyaan, 80)}</span> },
    { kunci: 'jawaban', judul: 'Jawaban', render: (row) => <span className={styles.jawaban} title={row.jawaban ?? ''}>{row.eskalasi ? <em className={styles.redup}>{row.reason === 'no_match' ? 'Tidak ada match FAQ' : 'Error AI'}</em> : truncate(row.jawaban, 100)}</span> },
    { kunci: 'similarity', judul: 'Similarity', angka: true, render: (row) => fmtSim(row.top_similarity) },
    { kunci: 'status', judul: 'Status', render: (row) => <Lencana nada={row.eskalasi ? 'peringatan' : 'sukses'}>{row.eskalasi ? 'Eskalasi' : 'Terjawab'}</Lencana> },
    { kunci: 'aksi', judul: 'Aksi', peran: 'aksi', render: (row) => <Tombol href={`/admin/chat/faq?prefill_pertanyaan=${encodeURIComponent(row.pertanyaan)}`} varian="sekunder" ukuran="kecil" ikon={PlusCircle} title="Tambahkan pertanyaan ini ke FAQ">Tambah ke FAQ</Tombol> },
  ];

  return (
    <>
      <PageHeader title="Log Asisten AI" description="Tinjau jawaban bot, eskalasi, dan kecocokan FAQ untuk memperbaiki informasi layanan.">
        <Tombol href="/admin" varian="sekunder" ikon={ArrowLeft}>Kembali ke Dasbor</Tombol>
      </PageHeader>
      <div className={styles.container}>
        <CatatanKeadaan jenis="lingkup">Filter eskalasi dan similarity berlaku pada halaman log yang sedang dimuat.</CatatanKeadaan>
        {!error && (
          <div className={styles.ringkasan}>
            <KartuStatistik label="Jawaban pada halaman ini" nilai={rows.length} ikon={MessageSquare} memuat={loading} />
            <KartuStatistik label="Eskalasi pada halaman ini" nilai={rows.filter((r) => r.eskalasi).length} ikon={ArrowUpRight} memuat={loading} />
            <KartuStatistik label="Similarity di bawah 0.8" nilai={rows.filter((r) => r.top_similarity !== null && r.top_similarity < 0.8).length} ikon={Search} pembanding="Pada halaman yang dimuat" memuat={loading} />
          </div>
        )}
        <Kartu judul="Riwayat jawaban" aksi={
          <Field label="Saring log">
            <select className="form-select" value={filter} onChange={(e) => setFilter(e.target.value as FilterMode)}>
              <option value="all">Semua{!loading && !error ? ` (${totalCount})` : ''}</option>
              <option value="eskalasi">Eskalasi saja{!loading && !error ? ` (${rows.filter((r) => r.eskalasi).length})` : ''}</option>
              <option value="low_similarity">Similarity &lt; 0.8{!loading && !error ? ` (${rows.filter((r) => r.top_similarity !== null && r.top_similarity < 0.8).length})` : ''}</option>
            </select>
          </Field>
        }>
          {loading ? (
            <div role="status"><Skeleton bentuk="baris" jumlah={6} label="Memuat log…" /></div>
          ) : error ? (
            <Galat pesan={error} onRetry={() => void loadData()} />
          ) : filtered.length === 0 ? (
            <StatusKosong ikon={Bot} judul={rows.length === 0 ? 'Belum ada log asisten AI. Log akan muncul setelah pengunjung menggunakan mode chatbot.' : 'Tidak ada log yang cocok dengan filter ini.'} />
          ) : (
            <>
              <Tabel caption="Log jawaban asisten AI" kolom={kolom} baris={filtered} kunciBaris="id" />
              <Pagination page={page} pageSize={PAGE_SIZE} total={totalCount} onPageChange={setPage} />
            </>
          )}
        </Kartu>
      </div>
    </>
  );
}
