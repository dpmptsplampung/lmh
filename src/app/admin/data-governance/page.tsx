'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  ScrollText,
  Users,
  ArrowLeft,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
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

const todayStart = (): string => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
};
const daysAgoStart = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
};

export default function DataGovernancePage() {
  const [auditStats, setAuditStats] = useState<AuditStats | null>(null);
  const [consentAgg, setConsentAgg] = useState<ConsentAgg[]>([]);
  const [piiStats, setPiiStats] = useState<PiiStats | null>(null);
  const [recentAudit, setRecentAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const startToday = todayStart();
      const start7 = daysAgoStart(7);
      const start30 = daysAgoStart(30);

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
      const { count: piiCount } = await supabase
        .from('pengunjung')
        .select('*', { count: 'exact', head: true })
        .not('email', 'is', null);
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

  const formatTime = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <>
      <PageHeader
        title="Tata Kelola Data Pribadi"
        description="Dashboard DPO — audit log, consent, dan retensi PDP (UU 27/2022)"
      />

      <div className={styles.govContainer}>
        <div className={styles.govHeader}>
          <div>
            <h2 className={styles.govTitle}>Dashboard DPO</h2>
            <p className={styles.govSubtitle}>
              Pantau kepatuhan Pelindungan Data Pribadi (PDP) — audit trail,
              persetujuan, dan jumlah data PII aktif.
            </p>
          </div>
          <Link href="/admin" className={styles.govBackLink}>
            <ArrowLeft size={16} />
            Kembali ke Dashboard
          </Link>
        </div>

        {error && (
          <div className={styles.govError} role="alert">
            <AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {error}
          </div>
        )}

        {loading ? (
          <div className={styles.govLoading}>
            <Loader2 size={28} className="animate-pulse" />
          </div>
        ) : (
          <>
            <div className={styles.govCards}>
              {/* Card 1: Audit log counts */}
              <div className={styles.govCard}>
                <div className={styles.govCardHeader}>
                  <div className={`${styles.govCardIcon} ${styles.govIconIndigo}`}>
                    <ScrollText size={20} />
                  </div>
                  <span className={styles.govCardTitle}>Audit Log</span>
                </div>
                <div className={styles.govCardBody}>
                  <div className={styles.govStatRow}>
                    <span>Hari ini</span>
                    <strong>{auditStats?.today ?? 0}</strong>
                  </div>
                  <div className={styles.govStatRow}>
                    <span>7 hari terakhir</span>
                    <strong>{auditStats?.last7 ?? 0}</strong>
                  </div>
                  <div className={styles.govStatRow}>
                    <span>30 hari terakhir</span>
                    <strong>{auditStats?.last30 ?? 0}</strong>
                  </div>
                </div>
              </div>

              {/* Card 2: Consent coverage */}
              <div className={styles.govCard}>
                <div className={styles.govCardHeader}>
                  <div className={`${styles.govCardIcon} ${styles.govIconGreen}`}>
                    <ShieldCheck size={20} />
                  </div>
                  <span className={styles.govCardTitle}>Consent Coverage</span>
                </div>
                <div className={styles.govCardBody}>
                  {consentAgg.length === 0 ? (
                    <div className={styles.govTableEmpty}>Belum ada consent</div>
                  ) : (
                    consentAgg.map((c) => (
                      <div key={c.tujuan} className={styles.govStatRow}>
                        <span>{c.tujuan}</span>
                        <strong>
                          {c.approved}/{c.total}{' '}
                          <span className={styles.govStatRowPct}>({c.pct}%)</span>
                        </strong>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Card 3: PII aktif */}
              <div className={styles.govCard}>
                <div className={styles.govCardHeader}>
                  <div className={`${styles.govCardIcon} ${styles.govIconAmber}`}>
                    <Users size={20} />
                  </div>
                  <span className={styles.govCardTitle}>PII Aktif</span>
                </div>
                <div className={styles.govCardBody}>
                  <div className={styles.govStatRow}>
                    <span>Pengunjung dengan email</span>
                    <strong>{piiStats?.activePii ?? 0}</strong>
                  </div>
                  <div className={styles.govTableEmpty}>
                    Anonimisasi otomatis setelah 730 hari inaktif
                  </div>
                </div>
              </div>
            </div>

            {/* Card 4: Recent audit entries */}
            <div className={styles.govTableSection}>
              <h3 className={styles.govTableTitle}>Audit Log Terbaru (20)</h3>
              <div className={styles.govTableWrapper}>
                <table className={styles.govTable}>
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Pelaku</th>
                      <th>Aksi</th>
                      <th>Entitas</th>
                      <th>Entitas ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAudit.length === 0 ? (
                      <tr>
                        <td colSpan={5} className={styles.govTableEmpty}>
                          Belum ada entri audit
                        </td>
                      </tr>
                    ) : (
                      recentAudit.map((e) => (
                        <tr key={e.id}>
                          <td>{formatTime(e.created_at)}</td>
                          <td>
                            <span className={styles.govBadge}>
                              {e.actor_role ?? 'system'}
                            </span>
                          </td>
                          <td>{e.aksi}</td>
                          <td>{e.entitas}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.8em' }}>
                            {e.entitas_id ? e.entitas_id.slice(0, 8) : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
