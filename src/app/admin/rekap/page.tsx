'use client';

// Rekap terpadu (Fase 3, spec §6.3): satu halaman, otomatis dibatasi lingkup akses §6.1 (ditegakkan RPC database
// migrasi 202610290002, lewat /api/admin/rekap/terpadu). Tiga bagian: Rekap Harian, Data Pelayanan (+ unduh Excel),
// Kinerja Petugas. Menggantikan tab OSS / Non OSS / Per Layanan / Petugas Layanan dan halaman Rekap Front Office.
// Satu definisi "dilayani" untuk semua angka (lihat DEFINISI_DILAYANI). Tidak ada tombol "Rollup": selalu terkini.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BarChart2, Download, Loader2, RefreshCw, Table2, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import RoleNote from '@/components/admin/RoleNote';
import Pagination from '@/components/Pagination';
import { useToast } from '@/components/Toast';
import { addDaysWIB, todayWIB } from '@/lib/time';
import { formatMenit, formatTanggalId } from '@/lib/rekap/format';
import { DEFINISI_DILAYANI } from '@/lib/rekap/excelTerpadu';
import {
  kolomDataPelayanan,
  namaUnit,
  type BarisHarian,
  type BarisKinerja,
  type BarisPelayanan,
  type FormPendataan,
  type RingkasanHarian,
  type UnitRekap,
} from '@/lib/rekap/terpadu';
import styles from './rekap.module.css';

type Bagian = 'harian' | 'data' | 'kinerja';

const BAGIAN: { kunci: Bagian; label: string; ikon: typeof BarChart2 }[] = [
  { kunci: 'harian', label: 'Rekap Harian', ikon: BarChart2 },
  { kunci: 'data', label: 'Data Pelayanan', ikon: Table2 },
  { kunci: 'kinerja', label: 'Kinerja Petugas', ikon: Users },
];

const UKURAN_HALAMAN = 50;

interface InfoLingkup {
  label: string;
  opsi_layanan: { id: string; nama: string; form_pendataan: string | null }[];
  unit_opsi: UnitRekap[];
}

type Status = { jenis: 'siap' } | { jenis: 'migrasi'; pesan: string } | { jenis: 'galat'; pesan: string };

async function ambilJson(url: string): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

function RekapTerpadu() {
  const { toast } = useToast();
  const sp = useSearchParams();
  const bagianAwal = sp.get('bagian');
  const unitAwal = sp.get('unit');
  const [bagian, setBagian] = useState<Bagian>(
    bagianAwal === 'data' || bagianAwal === 'kinerja' ? bagianAwal : 'harian',
  );
  const [dari, setDari] = useState(addDaysWIB(-6));
  const [sampai, setSampai] = useState(todayWIB());
  const [unit, setUnit] = useState<'' | UnitRekap>(unitAwal === 'fo' || unitAwal === 'layanan' ? unitAwal : '');
  const [layananId, setLayananId] = useState('');
  const [info, setInfo] = useState<InfoLingkup | null>(null);
  const [status, setStatus] = useState<Status>({ jenis: 'siap' });
  const [memuat, setMemuat] = useState(true);
  const [mengekspor, setMengekspor] = useState(false);
  const [harian, setHarian] = useState<{ rows: BarisHarian[]; ringkasan: RingkasanHarian } | null>(null);
  const [data, setData] = useState<{ rows: BarisPelayanan[]; total: number; form_type: FormPendataan | null } | null>(null);
  const [kinerja, setKinerja] = useState<BarisKinerja[] | null>(null);
  const [halaman, setHalaman] = useState(0);

  const params = useMemo(() => {
    const p = new URLSearchParams({ dari, sampai });
    if (unit) p.set('unit', unit);
    if (layananId && unit !== 'fo') p.set('layanan_id', layananId);
    return p;
  }, [dari, sampai, unit, layananId]);

  const tanganiGagal = useCallback((r: { status: number; body: Record<string, unknown> }) => {
    const pesan = typeof r.body.error === 'string' ? r.body.error : 'Gagal memuat rekap';
    if (r.status === 409 && r.body.kode === 'MIGRASI_BELUM_DITERAPKAN') setStatus({ jenis: 'migrasi', pesan });
    else setStatus({ jenis: 'galat', pesan });
  }, []);

  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        const r = await ambilJson('/api/admin/rekap/terpadu?bagian=lingkup');
        if (batal) return;
        if (!r.ok) return tanganiGagal(r);
        setInfo(r.body as unknown as InfoLingkup);
      } catch {
        if (!batal) setStatus({ jenis: 'galat', pesan: 'Gagal memuat lingkup data' });
      }
    })();
    return () => {
      batal = true;
    };
  }, [tanganiGagal]);

  const muat = useCallback(async () => {
    setMemuat(true);
    try {
      const p = new URLSearchParams(params);
      p.set('bagian', bagian);
      if (bagian === 'data') {
        p.set('page', String(halaman));
        p.set('page_size', String(UKURAN_HALAMAN));
      }
      const r = await ambilJson(`/api/admin/rekap/terpadu?${p}`);
      if (!r.ok) return tanganiGagal(r);
      setStatus({ jenis: 'siap' });
      if (bagian === 'harian') setHarian(r.body as unknown as { rows: BarisHarian[]; ringkasan: RingkasanHarian });
      else if (bagian === 'data') setData(r.body as unknown as { rows: BarisPelayanan[]; total: number; form_type: FormPendataan | null });
      else setKinerja((r.body.rows ?? []) as BarisKinerja[]);
    } catch {
      setStatus({ jenis: 'galat', pesan: 'Gagal memuat rekap' });
    } finally {
      setMemuat(false);
    }
  }, [bagian, halaman, params, tanganiGagal]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    muat();
  }, [muat]);

  const unduh = async () => {
    setMengekspor(true);
    try {
      const res = await fetch(`/api/admin/rekap/terpadu/export?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(body.error ?? 'Gagal mengunduh Excel', 'error');
        return;
      }
      const blob = await res.blob();
      const nama = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1]
        ?? `data-pelayanan-${dari}-sd-${sampai}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nama;
      a.click();
      URL.revokeObjectURL(url);
      toast(
        res.headers.get('X-Rekap-Truncated') === 'true'
          ? 'Data terpotong ke 50.000 baris. Persempit rentang tanggal.'
          : 'Berkas Excel berhasil diunduh',
        res.headers.get('X-Rekap-Truncated') === 'true' ? 'warning' : 'success',
      );
    } catch {
      toast('Gagal mengunduh Excel', 'error');
    } finally {
      setMengekspor(false);
    }
  };

  const ubahFilter = <T,>(setter: (v: T) => void) => (v: T) => {
    setHalaman(0);
    setter(v);
  };

  const kolom = kolomDataPelayanan(data?.form_type ?? null);
  const pilihLayanan = (info?.opsi_layanan.length ?? 0) > 0 && unit !== 'fo';

  return (
    <>
      <PageHeader title="Rekap Pelayanan" description="Rekap harian, data pelayanan, dan kinerja petugas sesuai hak akses Anda">
        <button type="button" className="btn btn--ghost btn--sm" onClick={muat} disabled={memuat}>
          <RefreshCw size={16} className={memuat ? 'animate-spin' : ''} aria-hidden="true" /> Muat ulang
        </button>
      </PageHeader>

      <div className={styles.wadah}>
        {info && <RoleNote>{info.label} Setiap unduhan tercatat.</RoleNote>}
        <p className={styles.definisi}>{DEFINISI_DILAYANI}</p>

        {status.jenis === 'migrasi' && <p className={styles.peringatan} role="status">{status.pesan}</p>}
        {status.jenis === 'galat' && <p className={styles.peringatan} role="alert">{status.pesan}</p>}

        <div className={styles.filter}>
          <div className="form-group">
            <label className="form-label" htmlFor="rekap-dari">Dari tanggal</label>
            <input id="rekap-dari" type="date" className="form-input" value={dari} max={sampai}
              onChange={(e) => ubahFilter(setDari)(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="rekap-sampai">Sampai tanggal</label>
            <input id="rekap-sampai" type="date" className="form-input" value={sampai} min={dari}
              onChange={(e) => ubahFilter(setSampai)(e.target.value)} />
          </div>
          {info && info.unit_opsi.length > 1 && (
            <div className="form-group">
              <label className="form-label" htmlFor="rekap-unit">Unit</label>
              <select id="rekap-unit" className="form-input" value={unit}
                onChange={(e) => ubahFilter(setUnit)(e.target.value as '' | UnitRekap)}>
                <option value="">Semua unit</option>
                <option value="fo">Front Office</option>
                <option value="layanan">Layanan</option>
              </select>
            </div>
          )}
          {pilihLayanan && info && (
            <div className="form-group">
              <label className="form-label" htmlFor="rekap-layanan">Layanan</label>
              <select id="rekap-layanan" className="form-input" value={layananId}
                onChange={(e) => ubahFilter(setLayananId)(e.target.value)}>
                <option value="">Semua Layanan</option>
                {info.opsi_layanan.map((o) => <option key={o.id} value={o.id}>{o.nama}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className={styles.tab} role="tablist" aria-label="Bagian rekap">
          {BAGIAN.map(({ kunci, label, ikon: Ikon }) => (
            <button
              key={kunci}
              type="button"
              role="tab"
              id={`tab-${kunci}`}
              aria-selected={bagian === kunci}
              aria-controls={`panel-${kunci}`}
              className={`btn ${bagian === kunci ? 'btn--primary' : 'btn--ghost'} btn--sm`}
              onClick={() => { setHalaman(0); setBagian(kunci); }}
            >
              <Ikon size={16} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${bagian}`} aria-labelledby={`tab-${bagian}`} aria-busy={memuat}>
          {bagian === 'harian' && (
            <>
              <div className={styles.kartu}>
                <div className="stat-card"><span className="stat-card__value">{harian?.ringkasan.jumlah ?? 0}</span><span className="stat-card__label">Dilayani (periode)</span></div>
                <div className="stat-card"><span className="stat-card__value">{harian?.ringkasan.tatap_muka ?? 0}</span><span className="stat-card__label">Tatap muka</span></div>
                <div className="stat-card"><span className="stat-card__value">{harian?.ringkasan.live_chat ?? 0}</span><span className="stat-card__label">Live Chat</span></div>
              </div>
              <div className="table-wrapper">
                <table className="table">
                  <caption className={styles.caption}>Jumlah pelayanan dilayani per tanggal dan unit</caption>
                  <thead>
                    <tr>
                      <th scope="col">Tanggal</th><th scope="col">Unit</th><th scope="col">Tatap muka</th>
                      <th scope="col">Live Chat</th><th scope="col">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(harian?.rows ?? []).length === 0 ? (
                      <tr><td colSpan={5} className={styles.kosong}>{memuat ? 'Memuat…' : 'Belum ada pelayanan dilayani pada rentang ini.'}</td></tr>
                    ) : (
                      harian!.rows.map((r) => (
                        <tr key={`${r.tanggal}-${r.unit}-${r.layanan_id ?? 'fo'}`}>
                          <td className={styles.angka}>{formatTanggalId(r.tanggal)}</td>
                          <td style={{ fontWeight: 600 }}>{namaUnit(r)}</td>
                          <td className={styles.angka}>{r.tatap_muka}</td>
                          <td className={styles.angka}>{r.live_chat}</td>
                          <td className={styles.angka} style={{ fontWeight: 700 }}>{r.jumlah}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {bagian === 'data' && (
            <>
              <div className={styles.aksi}>
                <span>{data ? `${data.total} pelayanan` : ''}{!data?.form_type && ' · pilih satu Layanan ber-formulir untuk menampilkan kolom formulirnya'}</span>
                <button type="button" className="btn btn--primary btn--sm" onClick={unduh}
                  disabled={memuat || mengekspor || status.jenis !== 'siap'}>
                  {mengekspor ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
                  {' '}Unduh Excel
                </button>
              </div>
              <div className="table-wrapper">
                <table className="table">
                  <caption className={styles.caption}>Data pelayanan, satu baris per pelayanan</caption>
                  <thead>
                    <tr>{kolom.map((k) => <th key={k.kunci} scope="col">{k.judul}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(data?.rows ?? []).length === 0 ? (
                      <tr><td colSpan={kolom.length} className={styles.kosong}>{memuat ? 'Memuat…' : 'Belum ada pelayanan dilayani pada rentang ini.'}</td></tr>
                    ) : (
                      data!.rows.map((r) => (
                        <tr key={r.pelayanan_id}>
                          {kolom.map((k) => <td key={k.kunci} className={styles.selSempit}>{k.ambil(r) ?? '—'}</td>)}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {data && <Pagination page={halaman} pageSize={UKURAN_HALAMAN} total={data.total} onPageChange={setHalaman} />}
              </div>
            </>
          )}

          {bagian === 'kinerja' && (
            <div className="table-wrapper">
              <table className="table">
                <caption className={styles.caption}>Kinerja petugas: jumlah pelayanan dilayani per petugas dan unit</caption>
                <thead>
                  <tr>
                    <th scope="col">Petugas</th><th scope="col">Unit</th><th scope="col">Dilayani</th>
                    <th scope="col">Live Chat</th><th scope="col">Rata durasi</th>
                  </tr>
                </thead>
                <tbody>
                  {(kinerja ?? []).length === 0 ? (
                    <tr><td colSpan={5} className={styles.kosong}>{memuat ? 'Memuat…' : 'Belum ada data kinerja pada rentang ini.'}</td></tr>
                  ) : (
                    kinerja!.map((r) => (
                      <tr key={`${r.penangan_id}-${r.unit}-${r.layanan_id ?? 'fo'}`}>
                        <td style={{ fontWeight: 600 }}>{r.penangan_nama ?? '(tanpa nama)'}</td>
                        <td>{namaUnit(r)}</td>
                        <td className={styles.angka}>{r.jumlah}</td>
                        <td className={styles.angka}>{r.live_chat}</td>
                        <td className={styles.angka}>{formatMenit(r.rata_durasi_menit)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function AdminRekapPage() {
  return (
    <Suspense fallback={null}>
      <RekapTerpadu />
    </Suspense>
  );
}
