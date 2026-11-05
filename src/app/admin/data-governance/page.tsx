'use client';

import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, ScrollText, Users, ArrowLeft } from 'lucide-react';
import Tombol from '@/components/ui/Tombol';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Tabel from '@/components/ui/Tabel';
import Lencana from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Galat from '@/components/ui/Galat';
import { formatTanggalWaktu } from '@/lib/utils';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { todayWIB, addDaysWIB } from '@/lib/time';
import styles from './data-governance.module.css';

interface AuditStats {
  today: number;
  last7: number;
  last30: number;
}

interface ConsentRow {
  tujuan: string;
  disetujui: boolean;
}

interface ConsentAgg {
  tujuan: string;
  total: number;
  approved: number;
  pct: number;
}

interface PiiStats {
  activePii: number;
}

interface AuditEntry {
  id: string;
  actor_role: string | null;
  aksi: string;
  entitas: string;
  entitas_id: string | null;
  created_at: string;
}

export default function DataGovernancePage() {
  const [auditStats, setAuditStats] = useState<AuditStats | null>(null);
  const [consentAgg, setConsentAgg] = useState<ConsentAgg[]>([]);
  const [piiStats, setPiiStats] = useState<PiiStats | null>(null);
  const [recentAudit, setRecentAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [galatAudit, setGalatAudit] = useState(false);
  const [galatPii, setGalatPii] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const startToday = `${todayWIB()}T00:00:00Z`;
      const start7 = `${addDaysWIB(-7)}T00:00:00Z`;
      const start30 = `${addDaysWIB(-30)}T00:00:00Z`;

      // Card 1: audit_log counts. RLS allows admin SELECT.
      const [todayQ, last7Q, last30Q] = await Promise.all([
        supabase
          .from('audit_log')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', startToday),
        supabase
          .from('audit_log')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', start7),
        supabase
          .from('audit_log')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', start30),
      ]);

      setGalatAudit(Boolean(todayQ.error || last7Q.error || last30Q.error));
      setAuditStats({
        today: todayQ.count ?? 0,
        last7: last7Q.count ?? 0,
        last30: last30Q.count ?? 0,
      });

      // Card 2: consent coverage — fetch all rows (small table expected)
      // and aggregate client-side by tujuan.
      const { data: consentRows, error: consentErr } = await supabase
        .from('consent_log')
        .select('tujuan, disetujui');
      if (consentErr) throw consentErr;
      const rowsTyped: ConsentRow[] = (consentRows ?? []) as ConsentRow[];
      const byTujuan: Record<string, { total: number; approved: number }> = {};
      for (const r of rowsTyped) {
        if (!byTujuan[r.tujuan]) byTujuan[r.tujuan] = { total: 0, approved: 0 };
        byTujuan[r.tujuan].total += 1;
        if (r.disetujui) byTujuan[r.tujuan].approved += 1;
      }
      const agg: ConsentAgg[] = Object.entries(byTujuan).map(([tujuan, v]) => ({
        tujuan,
        total: v.total,
        approved: v.approved,
        pct: v.total > 0 ? Math.round((v.approved / v.total) * 100) : 0,
      }));
      setConsentAgg(agg);

      // Card 3: PII aktif — count of pengunjung with email IS NOT NULL
      const { count: piiCount, error: piiError } = await supabase
        .from('pengunjung')
        .select('*', { count: 'exact', head: true })
        .not('email', 'is', null);
      setGalatPii(Boolean(piiError));
      setPiiStats({ activePii: piiCount ?? 0 });

      // Card 4: recent audit entries (last 20)
      const { data: recent, error: recentErr } = await supabase
        .from('audit_log')
        .select('id, actor_role, aksi, entitas, entitas_id, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (recentErr) throw recentErr;
      setRecentAudit((recent ?? []) as AuditEntry[]);
    } catch (e) {
      console.error('DPO dashboard error:', e);
      setError('Gagal memuat data governance. Pastikan Anda login sebagai admin.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  return (
    <>
      <PageHeader title="Tata Kelola Data Pribadi" description="Dasbor DPO: audit log, consent, dan retensi PDP (UU 27/2022)"
        meta="Waktu ditampilkan dalam WIB">
        <Tombol href="/admin" varian="sekunder" ikon={ArrowLeft}>Kembali ke Dasbor</Tombol>
      </PageHeader>
      <div className={styles.govContainer}>
        {loading ? <Skeleton bentuk="kartu" jumlah={3} label="Memuat tata kelola data" /> : error ? (
          <Galat pesan={error} onRetry={() => { void loadData(); }} />
        ) : (
          <>
            <Kartu judul="Audit Log">
              {galatAudit ? <Galat pesan="Gagal memuat statistik audit." onRetry={() => { void loadData(); }} /> : <div className={styles.ringkasan}>
                <KartuStatistik label="Hari ini" nilai={auditStats?.today ?? '—'} ikon={ScrollText} />
                <KartuStatistik label="7 hari terakhir" nilai={auditStats?.last7 ?? '—'} />
                <KartuStatistik label="30 hari terakhir" nilai={auditStats?.last30 ?? '—'} />
              </div>}
            </Kartu>
            <div className={styles.govCards}>
              <Kartu judul="Consent Coverage">
                {consentAgg.length === 0 ? <StatusKosong ikon={ShieldCheck} judul="Belum ada consent" /> : (
                  <Tabel caption="Cakupan persetujuan" baris={consentAgg} kunciBaris="tujuan" kolom={[
                    { kunci: 'tujuan', judul: 'Tujuan', judulBaris: true },
                    { kunci: 'jumlah', judul: 'Persetujuan', angka: true, render: (c) => `${c.approved}/${c.total}` },
                    { kunci: 'cakupan', judul: 'Cakupan', angka: true, render: (c) => `${c.pct}%` },
                  ]} />
                )}
              </Kartu>
              <Kartu judul="PII Aktif">
                {galatPii ? <Galat pesan="Gagal memuat jumlah data pribadi." onRetry={() => { void loadData(); }} /> :
                  <KartuStatistik label="Pengunjung dengan email" nilai={piiStats?.activePii ?? '—'} ikon={Users} />}
                <CatatanKeadaan jenis="info">Anonimisasi otomatis setelah 730 hari inaktif</CatatanKeadaan>
              </Kartu>
            </div>
            <Kartu judul="Audit Log Terbaru (20)" padding="tanpa">
              <Tabel caption="Audit log terbaru (WIB)" baris={recentAudit} kunciBaris="id"
                kosong={<StatusKosong ikon={ScrollText} judul="Belum ada entri audit" />} kolom={[
                  { kunci: 'waktu', judul: 'Waktu', render: (e) => formatTanggalWaktu(e.created_at) },
                  { kunci: 'pelaku', judul: 'Pelaku', render: (e) => <Lencana>{e.actor_role ?? 'system'}</Lencana> },
                  { kunci: 'aksi', judul: 'Aksi', judulBaris: true },
                  { kunci: 'entitas', judul: 'Entitas' },
                  { kunci: 'id', judul: 'Entitas ID', render: (e) => e.entitas_id ? e.entitas_id.slice(0, 8) : '—' },
                ]} />
            </Kartu>
          </>
        )}
      </div>
    </>
  );
}
