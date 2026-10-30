'use client';

// Rekap terpadu (Fase 3, spec §6.3): satu halaman, otomatis dibatasi lingkup akses §6.1 (ditegakkan RPC database
// migrasi 202610290002, lewat /api/admin/rekap/terpadu). Bagian: Rekap Harian, Helpdesk OSS, Non OSS, Data Pelayanan
// (+ unduh Excel), Kinerja Petugas. Helpdesk OSS dan Non OSS (volume terbanyak) punya tab sendiri, terpisah dari
// Layanan lain: tab itu terkunci ke Layanan berformulir 'oss' / 'perizinan' sehingga kolom formulirnya langsung tampil
// tanpa memilih Layanan dulu. Tab itu hanya muncul bila Layanan berformulir tersebut ada dalam lingkup pengguna.
// Data Pelayanan = Layanan lain: mengirim tanpa_form=1 (migrasi 202611010005) sehingga Layanan berformulir tidak ikut
// (tab itu disembunyikan bila lingkup pengguna hanya berisi Layanan berformulir). Rekap Harian/Kinerja memuat semuanya.
// Satu definisi "dilayani" untuk semua angka (lihat DEFINISI_DILAYANI). Tidak ada tombol "Rollup": selalu terkini.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BarChart2, Building2, Download, FileCheck, Loader2, RefreshCw, Table2, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import RoleNote from '@/components/admin/RoleNote';
import Pagination from '@/components/Pagination';
import { useToast } from '@/components/Toast';
import { addDaysWIB, todayWIB } from '@/lib/time';
import { formatMenit, formatTanggalId } from '@/lib/rekap/format';
import { DEFINISI_DILAYANI } from '@/lib/rekap/excelTerpadu';
import { kolomKhusus } from '@/lib/rekap/khusus';
import type { FieldKhusus } from '@/lib/pendataan-khusus/jenis';
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
import TabelDataPelayanan, { type TampilanKolom } from './TabelDataPelayanan';
import styles from './rekap.module.css';

type Bagian = 'harian' | 'oss' | 'perizinan' | 'data' | 'kinerja';
type BagianForm = 'oss' | 'perizinan';

const BAGIAN: { kunci: Bagian; label: string; ikon: typeof BarChart2 }[] = [
  { kunci: 'harian', label: 'Rekap Harian', ikon: BarChart2 },
  { kunci: 'oss', label: 'Helpdesk OSS', ikon: Building2 },
  { kunci: 'perizinan', label: 'Non OSS', ikon: FileCheck },
  { kunci: 'data', label: 'Data Pelayanan', ikon: Table2 },
  { kunci: 'kinerja', label: 'Kinerja Petugas', ikon: Users },
];

const adalahBagianForm = (b: Bagian): b is BagianForm => b === 'oss' || b === 'perizinan';

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
  const [bagianPilihan, setBagian] = useState<Bagian>(
    bagianAwal === 'data' || bagianAwal === 'kinerja' || bagianAwal === 'oss' || bagianAwal === 'perizinan'
      ? bagianAwal
      : 'harian',
  );
  const [dari, setDari] = useState(addDaysWIB(-6));
  const [sampai, setSampai] = useState(todayWIB());
  const [unit, setUnit] = useState<'' | UnitRekap>(unitAwal === 'fo' || unitAwal === 'layanan' ? unitAwal : '');
  const [layananId, setLayananId] = useState('');
  // Layanan terpilih di tab Helpdesk OSS / Non OSS (hanya bermakna bila ada lebih dari satu Layanan berformulir itu).
  const [layananForm, setLayananForm] = useState<Partial<Record<BagianForm, string>>>({});
  const [info, setInfo] = useState<InfoLingkup | null>(null);
  const [status, setStatus] = useState<Status>({ jenis: 'siap' });
  const [memuat, setMemuat] = useState(true);
  const [mengekspor, setMengekspor] = useState(false);
  const [harian, setHarian] = useState<{ rows: BarisHarian[]; ringkasan: RingkasanHarian } | null>(null);
  const [data, setData] = useState<{ rows: BarisPelayanan[]; total: number; form_type: FormPendataan | null; kolom_khusus?: FieldKhusus[] } | null>(null);
  const [kinerja, setKinerja] = useState<BarisKinerja[] | null>(null);
  const [halaman, setHalaman] = useState(0);
  // Tampilan kolom Data Pelayanan: null = bawaan (Ringkas; tab Helpdesk OSS / Non OSS langsung Semua kolom agar kolom formulirnya tampil).
  const [tampilanPilihan, setTampilan] = useState<TampilanKolom | null>(null);
  const permintaanTerakhir = useRef(0);

  // Tab Helpdesk OSS / Non OSS ada bila lingkup pengguna memuat Layanan berformulir itu (admin dan Koordinator FO:
  // semua; Petugas: Layanannya). Alamat ?bagian=oss tanpa Layanan seperti itu jatuh ke Data Pelayanan.
  const opsiForm = useMemo<Record<BagianForm, { id: string; nama: string }[]>>(() => {
    const berformulir = (f: BagianForm) => (info?.opsi_layanan ?? []).filter((o) => o.form_pendataan === f);
    return { oss: berformulir('oss'), perizinan: berformulir('perizinan') };
  }, [info]);
  // Data Pelayanan = Layanan lain (tanpa Helpdesk OSS / Non OSS, migrasi 202611010005). Tab itu disembunyikan bila lingkup
  // pengguna HANYA berisi Layanan berformulir (mis. Petugas Helpdesk OSS): isinya pasti kosong, datanya ada di tab OSS.
  const adaLayananLain = !info || info.unit_opsi.includes('fo') || info.opsi_layanan.length === 0
    || info.opsi_layanan.some((o) => !o.form_pendataan);
  const bagianTersedia = (kunci: Bagian) => (adalahBagianForm(kunci) ? opsiForm[kunci].length > 0 : kunci !== 'data' || adaLayananLain);
  const bagianCadangan: Bagian = adaLayananLain ? 'data' : (opsiForm.oss.length > 0 ? 'oss' : opsiForm.perizinan.length > 0 ? 'perizinan' : 'harian');
  const bagian: Bagian = info && !bagianTersedia(bagianPilihan) ? bagianCadangan : bagianPilihan;
  const tabForm = adalahBagianForm(bagian) ? bagian : null;
  const daftarForm = tabForm ? opsiForm[tabForm] : [];
  const layananTab = tabForm ? (layananForm[tabForm] ?? daftarForm[0]?.id ?? '') : '';
  const bagianTampil = BAGIAN.filter(({ kunci }) => !info || bagianTersedia(kunci));
  const layananLain = (info?.opsi_layanan ?? []).filter((o) => !o.form_pendataan);

  const params = useMemo(() => {
    const p = new URLSearchParams({ dari, sampai });
    if (tabForm) {
      // Tab berformulir selalu terkunci ke Layanan berformulir itu (unit Layanan); Unit/Layanan umum diabaikan.
      p.set('unit', 'layanan');
      if (layananTab) p.set('layanan_id', layananTab);
    } else {
      if (unit) p.set('unit', unit);
      if (layananId && unit !== 'fo') p.set('layanan_id', layananId);
      // Data Pelayanan (dan unduhannya) = Layanan lain; harian/kinerja tetap memuat semua Layanan.
      if (bagian === 'data') p.set('tanpa_form', '1');
    }
    return p;
  }, [dari, sampai, unit, layananId, tabForm, layananTab, bagian]);

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
    // Tab berformulir menunggu daftar Layanan (info) agar permintaan pertamanya sudah terkunci ke Layanan yang benar.
    if (adalahBagianForm(bagian) && !layananTab) return;
    // Hanya jawaban permintaan terakhir yang dipakai: pindah tab/filter cepat tidak boleh menampilkan data basi.
    const nomor = ++permintaanTerakhir.current;
    setMemuat(true);
    try {
      const p = new URLSearchParams(params);
      p.set('bagian', adalahBagianForm(bagian) ? 'data' : bagian);
      if (bagian === 'data' || adalahBagianForm(bagian)) {
        p.set('page', String(halaman));
        p.set('page_size', String(UKURAN_HALAMAN));
      }
      const r = await ambilJson(`/api/admin/rekap/terpadu?${p}`);
      if (nomor !== permintaanTerakhir.current) return;
      if (!r.ok) return tanganiGagal(r);
      setStatus({ jenis: 'siap' });
      if (bagian === 'harian') setHarian(r.body as unknown as { rows: BarisHarian[]; ringkasan: RingkasanHarian });
      else if (bagian === 'kinerja') setKinerja((r.body.rows ?? []) as BarisKinerja[]);
      else setData(r.body as unknown as { rows: BarisPelayanan[]; total: number; form_type: FormPendataan | null; kolom_khusus?: FieldKhusus[] });
    } catch {
      if (nomor === permintaanTerakhir.current) setStatus({ jenis: 'galat', pesan: 'Gagal memuat rekap' });
    } finally {
      if (nomor === permintaanTerakhir.current) setMemuat(false);
    }
  }, [bagian, halaman, params, layananTab, tanganiGagal]);

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

  const tampilan: TampilanKolom = tampilanPilihan ?? (tabForm ? 'semua' : 'ringkas');
  const kolom = kolomDataPelayanan(data?.form_type ?? null, kolomKhusus(data?.kolom_khusus ?? []));
  const pilihLayanan = !tabForm && layananLain.length > 0 && unit !== 'fo';
  const pindahBagian = (kunci: Bagian) => {
    if (kunci === bagian) return;
    setHalaman(0);
    // Tab data berbagi satu tabel: kosongkan agar kolom/isian tab sebelumnya tidak sempat tampil di tab ini.
    if (kunci === 'data' || adalahBagianForm(kunci)) setData(null);
    setBagian(kunci);
  };

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
          {info && !tabForm && info.unit_opsi.length > 1 && (
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
                {layananLain.map((o) => <option key={o.id} value={o.id}>{o.nama}</option>)}
              </select>
            </div>
          )}
          {tabForm && daftarForm.length > 1 && (
            <div className="form-group">
              <label className="form-label" htmlFor="rekap-layanan-form">Layanan</label>
              <select id="rekap-layanan-form" className="form-input" value={layananTab}
                onChange={(e) => ubahFilter((v: string) => setLayananForm((s) => ({ ...s, [tabForm]: v })))(e.target.value)}>
                {daftarForm.map((o) => <option key={o.id} value={o.id}>{o.nama}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className={styles.tab} role="tablist" aria-label="Bagian rekap">
          {bagianTampil.map(({ kunci, label, ikon: Ikon }) => (
            <button
              key={kunci}
              type="button"
              role="tab"
              id={`tab-${kunci}`}
              aria-selected={bagian === kunci}
              aria-controls={`panel-${kunci}`}
              className={`btn ${bagian === kunci ? 'btn--primary' : 'btn--ghost'} btn--sm`}
              onClick={() => pindahBagian(kunci)}
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
                      <th scope="col">Tanggal</th><th scope="col">Unit</th><th scope="col" className="kol-angka">Tatap muka</th>
                      <th scope="col" className="kol-angka">Live Chat</th><th scope="col" className="kol-angka">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(harian?.rows ?? []).length === 0 ? (
                      <tr><td colSpan={5} className="kosong-sel">{memuat ? 'Memuat…' : 'Belum ada pelayanan dilayani pada rentang ini.'}</td></tr>
                    ) : (
                      harian!.rows.map((r) => (
                        <tr key={`${r.tanggal}-${r.unit}-${r.layanan_id ?? 'fo'}`}>
                          <td className="kol-waktu">{formatTanggalId(r.tanggal)}</td>
                          <td className="kol-utama">{namaUnit(r)}</td>
                          <td className="kol-angka">{r.tatap_muka}</td>
                          <td className="kol-angka">{r.live_chat}</td>
                          <td className="kol-angka" style={{ fontWeight: 600 }}>{r.jumlah}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {(bagian === 'data' || tabForm) && (
            <>
              {bagian === 'data' && (opsiForm.oss.length > 0 || opsiForm.perizinan.length > 0) && (
                <p className={styles.definisi}>Tidak termasuk Helpdesk OSS dan Non OSS; datanya ada di tab masing-masing.</p>
              )}
              <div className={styles.aksi}>
                <span className={styles.definisi} style={{ margin: 0 }}>{data ? `${data.total} pelayanan` : ''}{!tabForm && !(data?.kolom_khusus?.length) && ' · pilih satu Layanan untuk menampilkan kolom Pendataan Khusus-nya'}</span>
                <div className={styles.aksiKanan}>
                  <div className={styles.segmen} role="group" aria-label="Tampilan kolom">
                    <button type="button" aria-pressed={tampilan === 'ringkas'} onClick={() => setTampilan('ringkas')}>Ringkas</button>
                    <button type="button" aria-pressed={tampilan === 'semua'} onClick={() => setTampilan('semua')}>Semua kolom</button>
                  </div>
                  <button type="button" className="btn btn--primary btn--sm" onClick={unduh}
                    disabled={memuat || mengekspor || status.jenis !== 'siap'}>
                    {mengekspor ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
                    {' '}Unduh Excel
                  </button>
                </div>
              </div>
              <div className="table-wrapper">
                <TabelDataPelayanan
                  rows={data?.rows ?? []}
                  kolom={kolom}
                  tampilan={tampilan}
                  keadaan={memuat ? 'Memuat…' : 'Belum ada pelayanan dilayani pada rentang ini.'}
                />
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
                    <th scope="col">Petugas</th><th scope="col">Unit</th><th scope="col" className="kol-angka">Dilayani</th>
                    <th scope="col" className="kol-angka">Live Chat</th><th scope="col" className="kol-angka">Rata durasi</th>
                  </tr>
                </thead>
                <tbody>
                  {(kinerja ?? []).length === 0 ? (
                    <tr><td colSpan={5} className="kosong-sel">{memuat ? 'Memuat…' : 'Belum ada data kinerja pada rentang ini.'}</td></tr>
                  ) : (
                    kinerja!.map((r) => (
                      <tr key={`${r.penangan_id}-${r.unit}-${r.layanan_id ?? 'fo'}`}>
                        <td className="kol-utama">{r.penangan_nama ?? '(tanpa nama)'}</td>
                        <td>{namaUnit(r)}</td>
                        <td className="kol-angka">{r.jumlah}</td>
                        <td className="kol-angka">{r.live_chat}</td>
                        <td className="kol-angka">{formatMenit(r.rata_durasi_menit)}</td>
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
