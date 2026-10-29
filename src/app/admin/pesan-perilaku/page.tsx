'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Download, Loader2, Printer } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import RoleNote from '@/components/admin/RoleNote';
import FilterPeriode from '@/components/admin/survei/FilterPeriode';
import PanelIkmGlobal from '@/components/admin/survei/PanelIkmGlobal';
import PanelSpakGlobal, { type ResponseRateGlobal } from '@/components/admin/survei/PanelSpakGlobal';
import IkmPanel from '@/components/IkmPanel';
import type { IkmRow } from '@/lib/ikm';
import { labelRentang, rentangPreset } from '@/lib/survei/rentang';
import type { RingkasanIkmGlobal, RingkasanSpakGlobal } from '@/lib/survei/ringkasan-global';
import { todayWIB } from '@/lib/time';
import styles from './pesanPerilaku.module.css';

type Tab = 'ikm' | 'spak';
type Role = 'admin' | 'front_office' | 'petugas';
type StatusRole = { tahap: 'memuat' } | { tahap: 'gagal' } | { tahap: 'siap'; role: Role; layananNama: string | null; layananId: string | null };

interface RingkasanGlobal {
  ikm: RingkasanIkmGlobal;
  spak: RingkasanSpakGlobal;
  responseRate: ResponseRateGlobal;
  terpotong: boolean;
}

/** Baris `ringkasan_ikm` (hanya dipakai petugas): `layanan_id` null untuk Front Office dan data tidak terklasifikasi. */
interface RingkasanIkmRow {
  layanan_id: string | null;
  unit: string;
  nama: string;
  ikm: number | string | null;
  responden: number | null;
}

// Hasil Survei Pesan Perilaku. Admin dan Front Office: IKM dan SPAK GLOBAL (seluruh pelayanan digabung, bukan per Layanan),
// dengan filter tanggal, dashboard persen, dan unduhan. Petugas layanan: hanya IKM untuk Layanannya sendiri (batas data petugas).
export default function HasilSurveiPage() {
  const [status, setStatus] = useState<StatusRole>({ tahap: 'memuat' });

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setStatus({ tahap: 'gagal' });
          return;
        }
        const { data: p } = await supabase
          .from('petugas')
          .select('role, layanan_id, layanan:layanan_id(nama)')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        if (p?.role !== 'admin' && p?.role !== 'front_office' && p?.role !== 'petugas') {
          setStatus({ tahap: 'gagal' });
          return;
        }
        const l = p.layanan as { nama: string } | { nama: string }[] | null;
        setStatus({
          tahap: 'siap',
          role: p.role,
          layananNama: (Array.isArray(l) ? l[0]?.nama : l?.nama) ?? 'Anda',
          layananId: (p.layanan_id as string | null) ?? null,
        });
      } catch {
        setStatus({ tahap: 'gagal' });
      }
    })();
  }, []);

  const bolehGlobal = status.tahap === 'siap' && status.role !== 'petugas';

  return (
    <>
      <PageHeader
        title="Hasil Survei Pesan Perilaku"
        description={
          bolehGlobal
            ? 'Indeks Kepuasan Masyarakat (IKM, PermenPANRB 14/2017) dan Persepsi Anti Korupsi (SPAK), gabungan seluruh pelayanan'
            : 'Indeks Kepuasan Masyarakat (IKM, PermenPANRB 14/2017)'
        }
      >
        {bolehGlobal && (
          <Link href="/admin/pesan-perilaku/cetak" className="btn btn--secondary btn--sm">
            <Printer size={16} aria-hidden="true" /> Laporan &amp; Cetak
          </Link>
        )}
      </PageHeader>

      <div className={styles.skmContainer}>
        {status.tahap === 'memuat' && (
          <div className={styles.loading} role="status" aria-label="Memuat">
            <Loader2 size={28} className="animate-pulse" />
          </div>
        )}
        {status.tahap === 'gagal' && (
          <div className={styles.errorBox} role="alert">
            <AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Peran Anda tidak dapat dipastikan. Muat ulang halaman atau masuk kembali.
          </div>
        )}
        {status.tahap === 'siap' && status.role !== 'petugas' && <HasilGlobal />}
        {status.tahap === 'siap' && status.role === 'petugas' && (
          <HasilPetugas layananNama={status.layananNama ?? 'Anda'} layananId={status.layananId} />
        )}
      </div>
    </>
  );
}

function HasilGlobal() {
  const hariIni = todayWIB();
  const [rentang, setRentang] = useState(() => rentangPreset('bulan', hariIni));
  const [tab, setTab] = useState<Tab>('ikm');
  const [data, setData] = useState<RingkasanGlobal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { dari, sampai } = rentang;

  const muat = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/survei/ringkasan?dari=${dari}&sampai=${sampai}`, { cache: 'no-store', signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as RingkasanGlobal);
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
      console.error('Hasil survei global:', e);
      setData(null);
      setError('Gagal memuat hasil survei. Pastikan Anda masuk sebagai admin atau Front Office, lalu coba lagi.');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [dari, sampai]);

  useEffect(() => {
    const kontrol = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void muat(kontrol.signal);
    return () => kontrol.abort();
  }, [muat]);

  const periodeLabel = labelRentang(dari, sampai);

  return (
    <>
      <div className={styles.skmHeader}>
        <div>
          <h2 className={styles.skmTitle}>Hasil Survei — Seluruh Pelayanan</h2>
          <p className={styles.skmSubtitle}>Angka digabung dari semua Layanan dan Front Office; tidak dipecah per Layanan.</p>
        </div>
        <Link href="/admin" className={styles.skmBackLink}>
          <ArrowLeft size={16} />
          Kembali ke Dashboard
        </Link>
      </div>

      <FilterPeriode dari={dari} sampai={sampai} hariIni={hariIni} onUbah={setRentang}>
        <a className={styles.downloadLink} href={`/api/admin/survei/export?dari=${dari}&sampai=${sampai}`}>
          <Download size={16} aria-hidden="true" />
          Unduh Excel
        </a>
        <Link className={styles.downloadLink} href={`/admin/pesan-perilaku/cetak?dari=${dari}&sampai=${sampai}`}>
          <Printer size={16} aria-hidden="true" />
          Cetak / PDF
        </Link>
      </FilterPeriode>

      {error && (
        <div className={styles.errorBox} role="alert">
          <AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {error}
        </div>
      )}
      {data?.terpotong && (
        <p role="status" style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-sm)' }}>
          Jawaban melebihi batas baris dan terpotong; persempit periode agar angka lengkap.
        </p>
      )}

      <div className={styles.tabs} role="tablist" aria-label="Jenis survei">
        {(['ikm', 'spak'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'ikm' ? 'IKM' : 'SPAK'}
          </button>
        ))}
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {loading ? (
          <div className={styles.loading} role="status" aria-label="Memuat">
            <Loader2 size={28} className="animate-pulse" />
          </div>
        ) : data ? (
          tab === 'ikm' ? (
            <PanelIkmGlobal data={data.ikm} responseRate={data.responseRate} periodeLabel={periodeLabel} />
          ) : (
            <PanelSpakGlobal data={data.spak} responseRate={data.responseRate} periodeLabel={periodeLabel} />
          )
        ) : null}
      </div>
    </>
  );
}

function HasilPetugas({ layananNama, layananId }: { layananNama: string; layananId: string | null }) {
  const hariIni = todayWIB();
  const [rentang, setRentang] = useState(() => rentangPreset('bulan', hariIni));
  const [rows, setRows] = useState<IkmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { dari, sampai } = rentang;

  useEffect(() => {
    let batal = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { data, error: rpcErr } = await createClient().rpc('ringkasan_ikm', { p_start: dari, p_end: sampai });
        if (rpcErr) throw rpcErr;
        if (batal) return;
        setRows(
          ((data ?? []) as RingkasanIkmRow[]).map((r): IkmRow => ({
            layanan_id: r.layanan_id ?? (r.unit === 'fo' ? 'fo' : 'tidak_diketahui'),
            layanan_nama: r.nama,
            ikm: r.ikm === null || r.ikm === undefined ? null : Number(r.ikm),
            responden: r.responden ?? 0,
          })),
        );
      } catch (e) {
        console.error('SKM dashboard error:', e);
        if (!batal) setError('Gagal memuat data IKM. Pastikan Anda masuk sebagai admin/petugas.');
      } finally {
        if (!batal) setLoading(false);
      }
    })();
    return () => {
      batal = true;
    };
  }, [dari, sampai]);

  // Petugas hanya melihat IKM Layanannya.
  const barisIkm = rows.filter((r) => r.layanan_id === layananId);

  return (
    <>
      <RoleNote>Data ini hanya untuk layanan {layananNama}. Setiap ekspor tercatat.</RoleNote>
      <div className={styles.skmHeader}>
        <div>
          <h2 className={styles.skmTitle}>IKM Layanan {layananNama}</h2>
          <p className={styles.skmSubtitle}>{labelRentang(dari, sampai)} — 9 sampai 11 unsur kepuasan, skala 25-100</p>
        </div>
      </div>
      <FilterPeriode dari={dari} sampai={sampai} hariIni={hariIni} onUbah={setRentang} />
      {error && (
        <div className={styles.errorBox} role="alert">
          <AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {error}
        </div>
      )}
      {loading ? (
        <div className={styles.loading} role="status" aria-label="Memuat">
          <Loader2 size={28} className="animate-pulse" />
        </div>
      ) : (
        <IkmPanel rows={barisIkm} periodLabel={labelRentang(dari, sampai)} mode="admin" />
      )}
    </>
  );
}
