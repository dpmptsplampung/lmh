'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toWIBDateString } from '@/lib/time';
import {
  ArrowLeft,
  Download,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import RoleNote from '@/components/admin/RoleNote';
import SpakPanel, { type SpakRow } from '@/components/admin/SpakPanel';
import IkmPanel from '@/components/IkmPanel';
import type { IkmRow } from '@/lib/ikm';
import styles from './pesanPerilaku.module.css';

type Period = 'month' | 'quarter' | 'year';
type Tab = 'ikm' | 'spak';
type Role = 'admin' | 'front_office' | 'petugas';

/** Baris `ringkasan_ikm`: `layanan_id` null untuk Front Office dan data tidak terklasifikasi. */
interface RingkasanIkmRow {
  layanan_id: string | null;
  unit: string;
  nama: string;
  ikm: number | string | null;
  responden: number | null;
}

function getDateRange(period: Period): { start: string; end: string } {
  const now = new Date();
  const end = toWIBDateString(now); // batas hari memakai Asia/Jakarta (RPT-07)
  let start: Date;
  if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'quarter') {
    const qMonth = Math.floor(now.getMonth() / 3) * 3;
    start = new Date(now.getFullYear(), qMonth, 1);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
  }
  return { start: toWIBDateString(start), end };
}

export default function SkmAdminPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [tab, setTab] = useState<Tab>('ikm');
  const [rows, setRows] = useState<IkmRow[]>([]);
  const [spakRows, setSpakRows] = useState<SpakRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [spakLoading, setSpakLoading] = useState(false);
  const [error, setError] = useState('');
  const [spakError, setSpakError] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [petugasLayanan, setPetugasLayanan] = useState<string | null>(null); // nama layanan bila role petugas
  const [petugasLayananId, setPetugasLayananId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: p } = await supabase
          .from('petugas')
          .select('role, layanan_id, layanan:layanan_id(nama)')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        if (p?.role !== 'admin' && p?.role !== 'front_office' && p?.role !== 'petugas') return;
        setRole(p.role);
        if (p.role !== 'petugas') return;
        const l = p.layanan as { nama: string } | { nama: string }[] | null;
        setPetugasLayanan((Array.isArray(l) ? l[0]?.nama : l?.nama) ?? 'Anda');
        setPetugasLayananId((p.layanan_id as string | null) ?? null);
      } catch {
        /* catatan role bersifat informasi; abaikan bila gagal */
      }
    })();
  }, []);

  const bolehSpak = role === 'admin' || role === 'front_office';

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const { start, end } = getDateRange(period);
      // Satu panggilan untuk semua unit (layanan, Front Office, tidak terklasifikasi).
      const { data, error: rpcErr } = await supabase.rpc('ringkasan_ikm', {
        p_start: start,
        p_end: end,
      });
      if (rpcErr) throw rpcErr;
      const hasil = ((data ?? []) as RingkasanIkmRow[]).map((r): IkmRow => ({
        layanan_id: r.layanan_id ?? (r.unit === 'fo' ? 'fo' : 'tidak_diketahui'),
        layanan_nama: r.nama,
        ikm: r.ikm === null || r.ikm === undefined ? null : Number(r.ikm),
        responden: r.responden ?? 0,
      }));
      setRows(hasil);
    } catch (e) {
      console.error('SKM dashboard error:', e);
      setError('Gagal memuat data IKM. Pastikan Anda masuk sebagai admin/petugas.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  const loadSpak = useCallback(async () => {
    setSpakLoading(true);
    setSpakError('');
    try {
      const supabase = createClient();
      const { start, end } = getDateRange(period);
      const { data, error: rpcErr } = await supabase.rpc('ringkasan_spak', {
        p_start: start,
        p_end: end,
      });
      if (rpcErr) throw rpcErr;
      setSpakRows((data ?? []) as SpakRow[]);
    } catch (e) {
      console.error('SPAK dashboard error:', e);
      setSpakError('Gagal memuat data SPAK. Pastikan Anda masuk sebagai admin atau Front Office.');
    } finally {
      setSpakLoading(false);
    }
  }, [period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (tab !== 'spak' || !bolehSpak) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSpak();
  }, [tab, bolehSpak, loadSpak]);

  const periodLabel = period === 'month' ? 'Bulan Ini' : period === 'quarter' ? 'Kuartal Ini' : 'Tahun Ini';
  const { start, end } = getDateRange(period);
  const tabAktif: Tab = bolehSpak ? tab : 'ikm';
  // Petugas hanya melihat IKM layanannya; admin dan FO melihat semua unit.
  const barisIkm = role === 'petugas' ? rows.filter((r) => r.layanan_id === petugasLayananId) : rows;

  return (
    <>
      <PageHeader
        title="Dashboard SKM"
        description="Indeks Kepuasan Masyarakat (PermenPANRB 14/2017) dan SPAK per unit"
      />

      <div className={styles.skmContainer}>
        {petugasLayanan && (
          <RoleNote>Data ini hanya untuk layanan {petugasLayanan}. Setiap ekspor tercatat.</RoleNote>
        )}
        <div className={styles.skmHeader}>
          <div>
            <h2 className={styles.skmTitle}>IKM per Layanan</h2>
            <p className={styles.skmSubtitle}>
              {periodLabel} — 9 sampai 11 unsur kepuasan, skala 25-100
            </p>
          </div>
          <Link href="/admin" className={styles.skmBackLink}>
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
            <span className={styles.filterLabel}>Periode</span>
            <select
              className={styles.filterSelect}
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              aria-label="Pilih periode"
            >
              <option value="month">Bulan Ini</option>
              <option value="quarter">Kuartal Ini</option>
              <option value="year">Tahun Ini</option>
            </select>
          </div>
          {bolehSpak && (
            <a
              className={styles.downloadLink}
              href={`/api/admin/survei/export?dari=${start}&sampai=${end}`}
            >
              <Download size={16} aria-hidden="true" />
              Unduh
            </a>
          )}
        </div>

        {bolehSpak && (
          <div className={styles.tabs} role="tablist" aria-label="Jenis survei">
            {(['ikm', 'spak'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`tab-${t}`}
                aria-selected={tabAktif === t}
                aria-controls={`panel-${t}`}
                className={`${styles.tab} ${tabAktif === t ? styles.tabActive : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'ikm' ? 'IKM' : 'SPAK'}
              </button>
            ))}
          </div>
        )}

        {tabAktif === 'ikm' ? (
          <div id="panel-ikm" role={bolehSpak ? 'tabpanel' : undefined} aria-labelledby={bolehSpak ? 'tab-ikm' : undefined}>
            {loading ? (
              <div className={styles.loading}>
                <Loader2 size={28} className="animate-pulse" />
              </div>
            ) : (
              <IkmPanel rows={barisIkm} periodLabel={periodLabel} mode="admin" />
            )}
          </div>
        ) : (
          <div id="panel-spak" role="tabpanel" aria-labelledby="tab-spak">
            {spakError && (
              <div className={styles.errorBox} role="alert">
                <AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                {spakError}
              </div>
            )}
            {spakLoading ? (
              <div className={styles.loading}>
                <Loader2 size={28} className="animate-pulse" />
              </div>
            ) : (
              !spakError && <SpakPanel rows={spakRows} periodLabel={periodLabel} />
            )}
          </div>
        )}
      </div>
    </>
  );
}
