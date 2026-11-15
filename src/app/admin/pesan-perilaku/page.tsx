'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, Printer, MessageSquare, MessagesSquare } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import RoleNote from '@/components/admin/RoleNote';
import FilterPeriode from './FilterHasil';
import Tombol from '@/components/ui/Tombol';
import Kartu from '@/components/ui/Kartu';
import Skeleton from '@/components/ui/Skeleton';
import Galat from '@/components/ui/Galat';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import { objekBelumAda, KODE_MIGRASI_BELUM } from '@/lib/akses-data/galat';
import { PanelIkm as PanelIkmGlobal, PanelSpak as PanelSpakGlobal } from './PanelHasil';
import Tab, { PanelTab } from '@/components/ui/Tab';
import { type ResponseRateGlobal } from '@/components/admin/survei/PanelSpakGlobal';
import { IkmPanelMalas as IkmPanel } from '@/components/ui/grafik/dinamis';
import type { IkmRow } from '@/lib/ikm';
import { labelRentang, rentangPreset } from '@/lib/survei/rentang';
import type { RingkasanIkmGlobal, RingkasanSpakGlobal } from '@/lib/survei/ringkasan-global';
import { todayWIB } from '@/lib/time';
import styles from './pesanPerilaku.module.css';

type JenisSurvei = 'ikm' | 'spak';
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
  const [ulang, setUlang] = useState(0);

  useEffect(() => {
    (async () => {
      setStatus({ tahap: 'memuat' });
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
  }, [ulang]);

  const bolehGlobal = status.tahap === 'siap' && status.role !== 'petugas';

  return (
    <>
      <PageHeader
        title="Hasil Survei"
        description={
          bolehGlobal
            ? 'Indeks Kepuasan Masyarakat (IKM, PermenPANRB 14/2017) dan Persepsi Anti Korupsi (SPAK), gabungan seluruh pelayanan'
            : 'Indeks Kepuasan Masyarakat (IKM, PermenPANRB 14/2017)'
        }
      >
        {bolehGlobal && (
          <Tombol href="/admin/pesan-perilaku/cetak" varian="sekunder" ikon={Printer}>Laporan &amp; Cetak</Tombol>
        )}
      </PageHeader>

      <div className={styles.skmContainer}>
        {status.tahap === 'memuat' && (
          <Skeleton bentuk="kartu" jumlah={3} label="Memuat hasil survei" />
        )}
        {status.tahap === 'gagal' && (
          <Galat pesan="Peran Anda tidak dapat dipastikan. Muat ulang halaman atau masuk kembali." onRetry={() => setUlang((n) => n + 1)} />
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
  const [tab, setTab] = useState<JenisSurvei>('ikm');
  const [data, setData] = useState<RingkasanGlobal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [belum, setBelum] = useState(false);
  const [ulang, setUlang] = useState(0);
  const [mengunduh, setMengunduh] = useState(false);
  const [galatUnduh, setGalatUnduh] = useState('');
  const { dari, sampai } = rentang;

  async function unduhExcel() {
    if (mengunduh) return;
    setMengunduh(true);
    setGalatUnduh('');
    let pesan = 'Gagal mengunduh Excel. Pastikan Anda masih masuk, lalu coba lagi.';
    let url: string | undefined;
    try {
      const res = await fetch(`/api/admin/survei/export?dari=${dari}&sampai=${sampai}`, { cache: 'no-store' });
      if (res.status === 409) {
        pesan = 'Unduh Excel belum tersedia; pembaruan basis data belum diterapkan. Coba lagi setelah pembaruan selesai.';
        throw new Error('Ekspor belum tersedia');
      }
      const tipe = res.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
      if (!res.ok || tipe !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        !/^attachment\b/i.test(res.headers.get('Content-Disposition') ?? '')) {
        throw new Error('Respons bukan berkas Excel');
      }
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('Berkas Excel kosong');
      url = URL.createObjectURL(blob);
      const tautan = document.createElement('a');
      tautan.href = url;
      tautan.download = `survei-${dari}-sd-${sampai}.xlsx`;
      document.body.appendChild(tautan);
      try { tautan.click(); } finally { tautan.remove(); }
    } catch {
      setGalatUnduh(pesan);
    } finally {
      if (url) {
        const objekUrl = url;
        setTimeout(() => URL.revokeObjectURL(objekUrl), 0);
      }
      setMengunduh(false);
    }
  }

  const muat = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError('');
    setBelum(false);
    try {
      const res = await fetch(`/api/admin/survei/ringkasan?dari=${dari}&sampai=${sampai}`, { cache: 'no-store', signal });
      if (!res.ok) {
        const isi = await res.json().catch(() => null);
        if (isi?.code === KODE_MIGRASI_BELUM || isi?.error === KODE_MIGRASI_BELUM || objekBelumAda(isi)) throw { code: 'PGRST202' };
        throw new Error(`HTTP ${res.status}`);
      }
      setData((await res.json()) as RingkasanGlobal);
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
      console.error('Hasil survei global:', e);
      setData(null);
      setBelum(objekBelumAda(e));
      setError('Gagal memuat hasil survei. Pastikan Anda masuk sebagai admin atau Front Office, lalu coba lagi.');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [dari, sampai]);

  useEffect(() => {
    const kontrol = new AbortController();
    void Promise.resolve().then(() => { if (!kontrol.signal.aborted) return muat(kontrol.signal); });
    return () => kontrol.abort();
  }, [muat, ulang]);

  const periodeLabel = labelRentang(dari, sampai);

  return (
    <>
      <div className={styles.skmHeader}>
        <div>
          <h2 className={styles.skmTitle}>Hasil Survei — Seluruh Pelayanan</h2>
          <p className={styles.skmSubtitle}>Angka digabung dari semua Layanan dan Front Office; tidak dipecah per Layanan.</p>
        </div>
        <Tombol href="/admin" varian="sekunder" ikon={ArrowLeft}>Kembali ke Dasbor</Tombol>
      </div>

      <FilterPeriode dari={dari} sampai={sampai} hariIni={hariIni} onUbah={setRentang}>
        <Tombol varian="sekunder" ikon={Download} memuat={mengunduh} download href={`/api/admin/survei/export?dari=${dari}&sampai=${sampai}`} onClick={(e) => { e.preventDefault(); void unduhExcel(); }}>Unduh Excel</Tombol>
        <Tombol varian="sekunder" ikon={Printer} href={`/admin/pesan-perilaku/cetak?dari=${dari}&sampai=${sampai}`}>Cetak / PDF</Tombol>
      </FilterPeriode>

      {galatUnduh && <Galat pesan={galatUnduh} onRetry={() => { void unduhExcel(); }} />}
      {belum ? <CatatanKeadaan jenis="menunggu-migrasi" aksi={<Tombol varian="sekunder" onClick={() => setUlang((n) => n + 1)}>Coba lagi</Tombol>}>Hasil survei belum tersedia; pembaruan basis data belum diterapkan.</CatatanKeadaan> : error && <Galat pesan={error} onRetry={() => setUlang((n) => n + 1)} />}
      {data?.terpotong && (
        <CatatanKeadaan jenis="info">Jawaban melebihi batas baris dan terpotong; persempit periode agar angka lengkap.</CatatanKeadaan>
      )}

      <Kartu padding="rapat"><Tab id="survei" label="Jenis survei" tab={[{ kunci: 'ikm', label: 'IKM' }, { kunci: 'spak', label: 'SPAK' }]} aktif={tab} onGanti={(t) => setTab(t as JenisSurvei)} /></Kartu>
      <PanelTab idTab="survei" kunci={tab} aktif={tab}>
        {loading ? (
          <Skeleton bentuk="kartu" jumlah={3} label="Memuat hasil survei" />
        ) : data ? (
          tab === 'ikm' ? (
            <PanelIkmGlobal data={data.ikm} responseRate={data.responseRate} periodeLabel={periodeLabel} />
          ) : (
            <PanelSpakGlobal data={data.spak} responseRate={data.responseRate} periodeLabel={periodeLabel} />
          )
        ) : null}
      </PanelTab>
      <div className={styles.aksi}>
        <Tombol href="/admin/saran" varian="sekunder" ikon={MessageSquare}>Saran</Tombol>
        <Tombol href="/admin/pengaduan" varian="sekunder" ikon={MessagesSquare}>Pengaduan</Tombol>
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
  const [belum, setBelum] = useState(false);
  const [ulang, setUlang] = useState(0);
  const { dari, sampai } = rentang;

  useEffect(() => {
    let batal = false;
    (async () => {
      setLoading(true);
      setError('');
      setBelum(false);
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
        if (!batal) {
          setRows([]);
          setBelum(objekBelumAda(e));
          setError('Gagal memuat data IKM. Pastikan Anda masuk sebagai admin/petugas.');
        }
      } finally {
        if (!batal) setLoading(false);
      }
    })();
    return () => {
      batal = true;
    };
  }, [dari, sampai, ulang]);

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
      {loading ? <Skeleton bentuk="kartu" jumlah={3} label="Memuat IKM layanan" />
        : belum ? <CatatanKeadaan jenis="menunggu-migrasi" aksi={<Tombol varian="sekunder" onClick={() => setUlang((n) => n + 1)}>Coba lagi</Tombol>}>Data IKM belum tersedia; pembaruan basis data belum diterapkan.</CatatanKeadaan>
        : error ? <Galat pesan={error} onRetry={() => setUlang((n) => n + 1)} />
        : <IkmPanel rows={barisIkm} periodLabel={labelRentang(dari, sampai)} mode="admin" />}
    </>
  );
}
