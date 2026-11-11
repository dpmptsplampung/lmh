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
import { ClipboardCheck, Download, MessageCircle, RefreshCw, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import RoleNote from '@/components/admin/RoleNote';
import Tombol from '@/components/ui/Tombol';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Tab, { idPanelTab, idTab } from '@/components/ui/Tab';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import Field from '@/components/ui/Field';
import Galat from '@/components/ui/Galat';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import PemilihRentang from '@/components/ui/PemilihRentang';
import { BISA_DIFOKUS } from '@/components/ui/fokus';
import Pagination from '@/components/Pagination';
import { useToast } from '@/components/Toast';
import { addDaysWIB, todayWIB } from '@/lib/time';
import { formatMenit, formatTanggalId } from '@/lib/rekap/format';
import { DEFINISI_DILAYANI } from '@/lib/rekap/definisi';
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
import RingkasanDilayani from '@/components/admin/RingkasanDilayani';
import { ambilDilayani, type Dilayani } from '@/lib/fo/akses-antrean';
import styles from './rekap.module.css';

type Bagian = 'harian' | 'oss' | 'perizinan' | 'data' | 'kinerja';
type BagianForm = 'oss' | 'perizinan';

const BAGIAN: { kunci: Bagian; label: string }[] = [
  { kunci: 'harian', label: 'Rekap Harian' },
  { kunci: 'oss', label: 'Helpdesk OSS' },
  { kunci: 'perizinan', label: 'Non OSS' },
  { kunci: 'data', label: 'Data Pelayanan' },
  { kunci: 'kinerja', label: 'Kinerja Petugas' },
];

const ID_TAB = 'rekap';

const KOLOM_HARIAN: KolomTabel<BarisHarian>[] = [
  { kunci: 'tanggal', judul: 'Tanggal', judulBaris: true, peran: 'utama', render: (r) => formatTanggalId(r.tanggal) },
  { kunci: 'unit', judul: 'Unit', render: (r) => namaUnit(r) },
  { kunci: 'tatap_muka', judul: 'Tatap muka', angka: true },
  { kunci: 'live_chat', judul: 'Live Chat', angka: true },
  { kunci: 'jumlah', judul: 'Jumlah', angka: true, render: (r) => <strong>{r.jumlah}</strong> },
];

const KOLOM_KINERJA: KolomTabel<BarisKinerja>[] = [
  { kunci: 'penangan_nama', judul: 'Petugas', judulBaris: true, peran: 'utama', render: (r) => r.penangan_nama ?? '(tanpa nama)' },
  { kunci: 'unit', judul: 'Unit', render: (r) => namaUnit(r) },
  { kunci: 'jumlah', judul: 'Dilayani', angka: true },
  { kunci: 'live_chat', judul: 'Live Chat', angka: true },
  { kunci: 'rata_durasi_menit', judul: 'Rata durasi', angka: true, render: (r) => formatMenit(r.rata_durasi_menit) },
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
  // "Dilayani saya / total" (migrasi 202611030015): null = belum ada / migrasi belum diterapkan -> ringkasan disembunyikan.
  const [dilayani, setDilayani] = useState<Dilayani | null>(null);
  const [halaman, setHalaman] = useState(0);
  // Tampilan kolom Data Pelayanan: null = bawaan (Ringkas; tab Helpdesk OSS / Non OSS langsung Semua kolom agar kolom formulirnya tampil).
  const [tampilanPilihan, setTampilan] = useState<TampilanKolom | null>(null);
  const permintaanTerakhir = useRef(0);
  // Total + ringkasan per kunci filter (semua parameter kecuali page): pindah halaman cukup mengirim hemat=1.
  const hitungTersimpan = useRef<{ kunci: string; total: number; dilayani: Dilayani | null } | null>(null);

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
  // Harian dan Kinerja memuat semua Layanan, jadi filternya juga semua; hanya Data Pelayanan yang terbatas ke Layanan tanpa formulir.
  const daftarFilterLayanan = bagian === 'data' ? layananLain : (info?.opsi_layanan ?? []);

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

  // Data lama dibuang bila permintaan gagal: tabel/kartu tidak boleh menampilkan hasil filter sebelumnya di bawah filter baru.
  const buangData = useCallback((b: Bagian) => {
    hitungTersimpan.current = null;
    setDilayani(null);
    if (b === 'harian') setHarian(null);
    else if (b === 'kinerja') setKinerja(null);
    else setData(null);
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
      const kunci = `${bagian}?${params}`;
      const tersimpan = hitungTersimpan.current?.kunci === kunci ? hitungTersimpan.current : null;
      if (tersimpan && (bagian === 'data' || adalahBagianForm(bagian))) p.set('hemat', '1');
      const r = await ambilJson(`/api/admin/rekap/terpadu?${p}`);
      if (nomor !== permintaanTerakhir.current) return;
      if (!r.ok) {
        buangData(bagian);
        return tanganiGagal(r);
      }
      setStatus({ jenis: 'siap' });
      const hemat = r.body.total == null && tersimpan != null && (bagian === 'data' || adalahBagianForm(bagian));
      if (hemat) {
        setDilayani(tersimpan.dilayani);
      } else {
        const dilayaniBaru = ambilDilayani(r.body);
        setDilayani(dilayaniBaru);
        hitungTersimpan.current = typeof r.body.total === 'number' ? { kunci, total: r.body.total, dilayani: dilayaniBaru } : null;
      }
      if (hemat) setData({ ...(r.body as unknown as { rows: BarisPelayanan[]; form_type: FormPendataan | null; kolom_khusus?: FieldKhusus[] }), total: tersimpan.total });
      else if (bagian === 'harian') setHarian(r.body as unknown as { rows: BarisHarian[]; ringkasan: RingkasanHarian });
      else if (bagian === 'kinerja') setKinerja((r.body.rows ?? []) as BarisKinerja[]);
      else setData(r.body as unknown as { rows: BarisPelayanan[]; total: number; form_type: FormPendataan | null; kolom_khusus?: FieldKhusus[] });
    } catch {
      if (nomor === permintaanTerakhir.current) {
        buangData(bagian);
        setStatus({ jenis: 'galat', pesan: 'Gagal memuat rekap' });
      }
    } finally {
      if (nomor === permintaanTerakhir.current) setMemuat(false);
    }
  }, [bagian, halaman, params, layananTab, tanganiGagal, buangData]);

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
  const galatMuat = status.jenis !== 'siap';
  const pesanKosong = (kosong: string) => (memuat ? 'Memuat…' : galatMuat ? 'Data tidak dapat ditampilkan; lihat pesan di atas.' : kosong);
  const pilihLayanan = !tabForm && daftarFilterLayanan.length > 0 && unit !== 'fo';
  const pindahBagian = (kunci: Bagian) => {
    if (kunci === bagian) return;
    setHalaman(0);
    // Pilihan Layanan berformulir tidak sah di Data Pelayanan: buang agar tidak terkirim diam-diam tanpa tampil di pilihan.
    if (kunci === 'data' && layananId && !layananLain.some((o) => o.id === layananId)) setLayananId('');
    // Tab data berbagi satu tabel: kosongkan agar kolom/isian tab sebelumnya tidak sempat tampil di tab ini.
    if (kunci === 'data' || adalahBagianForm(kunci)) setData(null);
    setBagian(kunci);
  };

  const daftarTab = bagianTampil.map(({ kunci, label }) => ({ kunci, label }));
  const kosongTabel = (teks: string) => (
    <CatatanKeadaan jenis={galatMuat ? 'info' : 'kosong'}>{pesanKosong(teks)}</CatatanKeadaan>
  );

  return (
    <>
      <PageHeader title="Rekap Pelayanan" description="Rekap harian, data pelayanan, dan kinerja petugas sesuai hak akses Anda">
        <Tombol varian="hantu" ukuran="kecil" ikon={RefreshCw} onClick={muat} memuat={memuat}>
          Muat ulang
        </Tombol>
      </PageHeader>

      <div className={styles.wadah}>
        {info && <RoleNote>{info.label} Setiap unduhan tercatat.</RoleNote>}
        <p className={styles.definisi}>{DEFINISI_DILAYANI}</p>

        {status.jenis === 'migrasi' && <CatatanKeadaan jenis="menunggu-migrasi">{status.pesan}</CatatanKeadaan>}
        {status.jenis === 'galat' && <Galat pesan={status.pesan} onRetry={muat} memuat={memuat} />}

        <Kartu className={styles.kartuFilter}>
          <div className={styles.filter}>
            <Field label="Rentang tanggal">
              {(f) => (
                <PemilihRentang
                  id={f.id}
                  label="Rentang tanggal"
                  dari={dari}
                  sampai={sampai}
                  onUbah={(r) => {
                    setHalaman(0);
                    setDari(r.dari);
                    setSampai(r.sampai);
                  }}
                />
              )}
            </Field>
            {info && !tabForm && info.unit_opsi.length > 1 && (
              <Field label="Unit" className={styles.filterSelect}>
                <select value={unit} onChange={(e) => ubahFilter(setUnit)(e.target.value as '' | UnitRekap)}>
                  <option value="">Semua unit</option>
                  <option value="fo">Front Office</option>
                  <option value="layanan">Layanan</option>
                </select>
              </Field>
            )}
            {pilihLayanan && info && (
              <Field label="Layanan" className={styles.filterSelect}>
                <select value={layananId} onChange={(e) => ubahFilter(setLayananId)(e.target.value)}>
                  <option value="">Semua Layanan</option>
                  {daftarFilterLayanan.map((o) => <option key={o.id} value={o.id}>{o.nama}</option>)}
                </select>
              </Field>
            )}
            {tabForm && daftarForm.length > 1 && (
              <Field label="Layanan" className={styles.filterSelect}>
                <select value={layananTab}
                  onChange={(e) => ubahFilter((v: string) => setLayananForm((s) => ({ ...s, [tabForm]: v })))(e.target.value)}>
                  {daftarForm.map((o) => <option key={o.id} value={o.id}>{o.nama}</option>)}
                </select>
              </Field>
            )}
          </div>
        </Kartu>

        <Tab id={ID_TAB} label="Bagian rekap" tab={daftarTab} aktif={bagian} onGanti={(k) => pindahBagian(k as Bagian)} />

        <div
          role="tabpanel"
          id={idPanelTab(ID_TAB, bagian)}
          aria-labelledby={idTab(ID_TAB, bagian)}
          aria-busy={memuat}
          data-memuat={memuat ? 'true' : undefined}
          className={styles.isiTab}
          data-redup={memuat ? 'true' : 'false'}
          {...BISA_DIFOKUS}
        >
          {status.jenis === 'siap' && <RingkasanDilayani dilayani={dilayani} memuat={memuat} />}
          {bagian === 'harian' && (
            <>
              <section className={styles.kartu} aria-label="Ringkasan periode">
                <KartuStatistik label="Dilayani (periode)" ikon={ClipboardCheck} nilai={harian ? harian.ringkasan.jumlah : '—'} memuat={memuat && !harian && !galatMuat} />
                <KartuStatistik label="Tatap muka" ikon={Users} nilai={harian ? harian.ringkasan.tatap_muka : '—'} memuat={memuat && !harian && !galatMuat} />
                <KartuStatistik label="Live Chat" ikon={MessageCircle} nilai={harian ? harian.ringkasan.live_chat : '—'} memuat={memuat && !harian && !galatMuat} />
              </section>
              <Kartu padding="tanpa">
                <Tabel
                  caption="Jumlah pelayanan dilayani per tanggal dan unit"
                  kolom={KOLOM_HARIAN}
                  baris={harian?.rows ?? []}
                  kunciBaris={(r) => `${r.tanggal}-${r.unit}-${r.layanan_id ?? 'fo'}`}
                  kartuDiHp
                  memuat={memuat && !harian}
                  kosong={kosongTabel('Belum ada pelayanan dilayani pada rentang ini.')}
                />
              </Kartu>
            </>
          )}

          {(bagian === 'data' || tabForm) && (
            <>
              {bagian === 'data' && (opsiForm.oss.length > 0 || opsiForm.perizinan.length > 0) && (
                <p className={styles.definisi}>Tidak termasuk Helpdesk OSS dan Non OSS; datanya ada di tab masing-masing.</p>
              )}
              <div className={styles.aksi}>
                <p className={styles.jumlah}>{data ? `${data.total} pelayanan` : ''}{!tabForm && !(data?.kolom_khusus?.length) && ' · pilih satu Layanan untuk menampilkan kolom Pendataan Khusus-nya'}</p>
                <div className={styles.aksiKanan}>
                  <div className={styles.segmen} role="group" aria-label="Tampilan kolom">
                    <button type="button" aria-pressed={tampilan === 'ringkas'} onClick={() => setTampilan('ringkas')}>Ringkas</button>
                    <button type="button" aria-pressed={tampilan === 'semua'} onClick={() => setTampilan('semua')}>Semua kolom</button>
                  </div>
                  <Tombol varian="utama" ukuran="kecil" ikon={Download} onClick={unduh} memuat={mengekspor}
                    disabled={memuat || mengekspor || status.jenis !== 'siap'}>
                    Unduh Excel
                  </Tombol>
                </div>
              </div>
              <Kartu padding="tanpa">
                <TabelDataPelayanan
                  rows={data?.rows ?? []}
                  kolom={kolom}
                  tampilan={tampilan}
                  keadaan={pesanKosong('Belum ada pelayanan dilayani pada rentang ini.')}
                />
                {data && <Pagination page={halaman} pageSize={UKURAN_HALAMAN} total={data.total} onPageChange={setHalaman} />}
              </Kartu>
            </>
          )}

          {bagian === 'kinerja' && (
            <Kartu padding="tanpa">
              <Tabel
                caption="Kinerja petugas: jumlah pelayanan dilayani per petugas dan unit"
                kolom={KOLOM_KINERJA}
                baris={kinerja ?? []}
                kunciBaris={(r) => `${r.penangan_id}-${r.unit}-${r.layanan_id ?? 'fo'}`}
                kartuDiHp
                memuat={memuat && !kinerja}
                kosong={kosongTabel('Belum ada data kinerja pada rentang ini.')}
              />
            </Kartu>
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
