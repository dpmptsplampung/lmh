'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCheck, CheckCircle2, Lightbulb } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Pagination from '@/components/Pagination';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { segarkanBadge } from '@/lib/hooks/useNavBadges';
import { todayWIB, toWIBDateString } from '@/lib/time';
import { formatTanggal, formatWaktu } from '@/lib/utils';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Galat from '@/components/ui/Galat';
import Kartu from '@/components/ui/Kartu';
import Lencana from '@/components/ui/Lencana';
import PemilihRentang from '@/components/ui/PemilihRentang';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Tombol from '@/components/ui/Tombol';
import { objekBelumAda } from '@/lib/akses-data/galat';
import styles from './saran.module.css';

const PAGE_SIZE = 25;
const UKURAN_HALAMAN_ID = 1000; // batas baris per permintaan PostgREST; himpunan sasaran dibaca per halaman
const UKURAN_BATCH_RPC = 500; // batas p_ids pada RPC tandai_saran_ditinjau
const JEDA_CARI_MS = 300;
const KOLOM = 'id, isi, created_at, unit, pelapor_nama, sumber, layanan:layanan_id ( nama )';

// Tingkat skema yang didukung basis data, dari yang terbaru:
// 0 = anonim (202611030010) + ditinjau_pada (202611030013); 1 = anonim saja; 2 = tabel dasar (202611030003).
// Tingkat turun otomatis bila kolom belum ada, supaya halaman tidak rusak sebelum migrasi diterapkan.
const KOLOM_TINGKAT = [`${KOLOM}, anonim, ditinjau_pada`, `${KOLOM}, anonim`, KOLOM] as const;

type StatusTinjau = 'belum' | 'sudah' | 'semua';
type SumberFilter = '' | 'layanan' | 'fo' | 'publik';

interface Saran {
  id: string;
  isi: string;
  created_at: string;
  unit: string;
  pelapor_nama: string | null;
  /** Migrasi 202611030010. Tidak ada bila migrasi belum diterapkan. */
  anonim?: boolean | null;
  /** Migrasi 202611030013. Tidak ada bila migrasi belum diterapkan. */
  ditinjau_pada?: string | null;
  sumber?: string | null;
  layanan: { nama: string } | { nama: string }[] | null;
}

interface Filter {
  dari: string;
  sampai: string;
  layananId: string;
  sumber: SumberFilter;
  cari: string;
}

interface Ringkasan {
  belum: number;
  sudah: number;
}

// Kiriman anonim dibulatkan ke 00:00 WIB oleh migrasi anonimitas: jam tidak bermakna, tampilkan tanggal saja.
function waktuSaran(s: Saran): string {
  return s.anonim === true
    ? formatTanggal(s.created_at, { month: 'short' })
    : `${formatTanggal(s.created_at, { month: 'short' })} ${formatWaktu(s.created_at)} WIB`;
}

function awalBulan(): string {
  return `${todayWIB().slice(0, 7)}-01`;
}

function namaLayanan(s: Saran): string | undefined {
  return Array.isArray(s.layanan) ? s.layanan[0]?.nama : s.layanan?.nama;
}

/** Asal saran, dinyatakan jelas agar petugas tahu ke mana menindaklanjuti. */
function labelSumber(s: Saran): string {
  if (s.sumber === 'publik') return 'Tautan publik';
  if (s.sumber === 'impor') return 'Data impor';
  if (s.unit === 'fo') return 'Dari survei · Front Office';
  if (s.unit === 'layanan') return `Dari survei · ${namaLayanan(s) ?? 'Layanan'}`;
  return 'Dari survei · Unit tidak diketahui';
}

const escapePola = (kata: string) => kata.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Penyaring yang dipakai bersama oleh kueri daftar, hitungan, dan pengambilan id. Tipe builder Supabase dengan
 * daftar kolom dinamis terlalu dalam bagi inferensi generik (TS2589), jadi parameternya sengaja longgar.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rantai = any;

function saring(q: Rantai, f: Filter, status: StatusTinjau): Rantai {
  const akhir = toWIBDateString(new Date(new Date(`${f.sampai}T00:00:00+07:00`).getTime() + 86_400_000));
  let r = q.gte('created_at', `${f.dari}T00:00:00+07:00`).lt('created_at', `${akhir}T00:00:00+07:00`);
  if (f.layananId) r = r.eq('layanan_id', f.layananId);
  if (f.sumber === 'publik') r = r.eq('sumber', 'publik');
  else if (f.sumber === 'fo') r = r.eq('sumber', 'wizard').eq('unit', 'fo');
  else if (f.sumber === 'layanan') r = r.eq('sumber', 'wizard').eq('unit', 'layanan');
  if (f.cari) r = r.ilike('isi', `%${escapePola(f.cari)}%`);
  if (status === 'belum') r = r.is('ditinjau_pada', null);
  else if (status === 'sudah') r = r.not('ditinjau_pada', 'is', null);
  return r;
}

// Saran dari Pesan Perilaku dan tautan publik /saran. Hanya admin dan Front Office (RLS tabel saran);
// petugas layanan tidak membaca saran.
export default function SaranPage() {
  const { toast } = useToast();
  const [dari, setDari] = useState(awalBulan);
  const [sampai, setSampai] = useState(todayWIB);
  const [layananId, setLayananId] = useState('');
  const [sumber, setSumber] = useState<SumberFilter>('');
  const [cariInput, setCariInput] = useState('');
  const [cari, setCari] = useState('');
  const [status, setStatus] = useState<StatusTinjau>('belum');
  const [page, setPage] = useState(0);

  const [daftarLayanan, setDaftarLayanan] = useState<{ id: string; nama: string }[]>([]);
  const [baris, setBaris] = useState<Saran[]>([]);
  const [total, setTotal] = useState(0);
  const [ringkasan, setRingkasan] = useState<Ringkasan | null>(null);
  const [tinjauAda, setTinjauAda] = useState(true);
  const [sudahMuat, setSudahMuat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [galat, setGalat] = useState('');
  const [sibuk, setSibuk] = useState<string | null>(null);
  // Himpunan id yang dibekukan saat konfirmasi "Tandai semua" disiapkan (null = tidak ada konfirmasi).
  // Jumlah yang ditampilkan dan id yang dikirim ke RPC berasal dari himpunan ini, bukan dari kueri ulang.
  const [sasaran, setSasaran] = useState<string[] | null>(null);

  const tingkat = useRef(0);
  const urutan = useRef(0);
  const urutanSasaran = useRef(0);

  const muat = useCallback(async () => {
    const saya = ++urutan.current;
    setLoading(true);
    setGalat('');
    try {
      const supabase = createClient();
      const filter: Filter = { dari, sampai, layananId, sumber, cari };
      for (;;) {
        const t = tingkat.current;
        const adaTinjau = t === 0;
        const res = await saring(
          supabase.from('saran').select(KOLOM_TINGKAT[t], adaTinjau ? undefined : { count: 'exact' }),
          filter,
          adaTinjau ? status : 'semua',
        )
          .order('created_at', { ascending: false })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        if (res.error && objekBelumAda(res.error) && t < KOLOM_TINGKAT.length - 1) {
          tingkat.current = t + 1; // migrasi belum diterapkan: turun satu tingkat dan ulangi
          continue;
        }
        if (res.error) throw res.error;
        if (saya !== urutan.current) return;
        const hitung = (s: StatusTinjau) =>
          saring(supabase.from('saran').select('id', { count: 'exact', head: true }), filter, s);
        let jumlah = res.count ?? 0;
        let rk: Ringkasan | null = null;
        if (adaTinjau) {
          const [b, s] = await Promise.all([hitung('belum'), hitung('sudah')]);
          if (b.error) throw b.error;
          if (s.error) throw s.error;
          rk = { belum: b.count ?? 0, sudah: s.count ?? 0 };
          jumlah = status === 'belum' ? rk.belum : status === 'sudah' ? rk.sudah : rk.belum + rk.sudah;
        }
        if (saya !== urutan.current) return;
        setBaris((res.data ?? []) as unknown as Saran[]);
        setTotal(jumlah);
        setRingkasan(rk);
        setTinjauAda(adaTinjau);
        setSudahMuat(true);
        break;
      }
    } catch (e) {
      if (saya !== urutan.current) return;
      console.error('Saran:', e);
      setGalat('Gagal memuat saran.');
    } finally {
      if (saya === urutan.current) setLoading(false);
    }
  }, [dari, sampai, layananId, sumber, cari, status, page]);

  useEffect(() => {
    void Promise.resolve().then(muat);
  }, [muat]);

  // Daftar Layanan untuk penyaring. Gagal = penyaring tetap tampil tanpa pilihan (bukan galat halaman).
  useEffect(() => {
    let batal = false;
    void (async () => {
      const { data } = await createClient().from('layanan').select('id, nama').order('nama');
      if (!batal && data) setDaftarLayanan(data as unknown as { id: string; nama: string }[]);
    })();
    return () => { batal = true; };
  }, []);

  // Kotak cari: tunggu jeda mengetik sebelum mengirim kueri.
  useEffect(() => {
    if (cariInput.trim() === cari) return;
    const t = setTimeout(() => { setCari(cariInput.trim()); setPage(0); }, JEDA_CARI_MS);
    return () => clearTimeout(t);
  }, [cariInput, cari]);

  const ubah = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
    urutanSasaran.current++; // pengambilan sasaran yang masih berjalan menjadi usang
    setSasaran(null);
  };
  const ubahStatus = ubah(setStatus);

  const pesanGalatRpc = (error: unknown): string => {
    console.error('Saran: tandai ditinjau:', error);
    return objekBelumAda(error)
      ? 'Penandaan ditinjau belum aktif karena pembaruan basis data belum diterapkan. Hubungi administrator sistem.'
      : 'Gagal menandai saran. Coba lagi.';
  };

  async function tandai(id: string) {
    setSibuk(id);
    try {
      const { error } = await createClient().rpc('tandai_saran_ditinjau', { p_ids: [id], p_ditinjau: true });
      if (error) { toast(pesanGalatRpc(error), 'error'); return; }
      toast('Saran ditandai sudah ditinjau.', 'success');
      segarkanBadge();
      await muat();
    } finally {
      setSibuk(null);
    }
  }

  /**
   * Ambil seluruh id yang belum ditinjau dan cocok dengan penyaring, per halaman (tanpa batas diam-diam).
   * Urutan naik menurut waktu lalu id, jadi kiriman baru masuk di ujung dan tidak menggeser halaman yang sudah dibaca.
   * Waktu saran anonim dibulatkan ke hari, maka pembatas waktu tidak dipakai; himpunan beku inilah pembatasnya.
   */
  async function ambilSasaran(filter: Filter): Promise<string[]> {
    const supabase = createClient();
    const ids = new Set<string>();
    for (let dari0 = 0; ; dari0 += UKURAN_HALAMAN_ID) {
      const res = await saring(supabase.from('saran').select('id'), filter, 'belum')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(dari0, dari0 + UKURAN_HALAMAN_ID - 1);
      if (res.error) throw res.error;
      const data = (res.data ?? []) as unknown as { id: string }[];
      for (const r of data) ids.add(r.id);
      if (data.length < UKURAN_HALAMAN_ID) break;
    }
    return [...ids];
  }

  async function siapkanTandaiSemua() {
    const saya = ++urutanSasaran.current;
    setSibuk('siapkan');
    try {
      const daftarId = await ambilSasaran({ dari, sampai, layananId, sumber, cari });
      if (saya !== urutanSasaran.current) return;
      if (daftarId.length === 0) { toast('Tidak ada saran yang perlu ditandai.', 'info'); return; }
      setSasaran(daftarId);
    } catch (e) {
      if (saya === urutanSasaran.current) toast(pesanGalatRpc(e), 'error');
    } finally {
      setSibuk(null);
    }
  }

  async function tandaiSemua() {
    if (!sasaran) return;
    setSibuk('semua');
    try {
      const supabase = createClient();
      // RPC menerima paling banyak 500 id per panggilan.
      let berubah = 0;
      for (let i = 0; i < sasaran.length; i += UKURAN_BATCH_RPC) {
        const batch = sasaran.slice(i, i + UKURAN_BATCH_RPC);
        const { data, error } = await supabase.rpc('tandai_saran_ditinjau', { p_ids: batch, p_ditinjau: true });
        if (error) { toast(pesanGalatRpc(error), 'error'); if (berubah > 0) { segarkanBadge(); await muat(); } return; }
        berubah += typeof data === 'number' ? data : batch.length;
      }
      toast(`${berubah} saran ditandai sudah ditinjau.`, 'success');
      setSasaran(null);
      segarkanBadge();
      await muat();
    } finally {
      setSibuk(null);
    }
  }

  const filterAktif = !!(layananId || sumber || cari);
  const pesanKosong = filterAktif
    ? 'Tidak ada saran yang cocok dengan penyaring ini.'
    : status === 'belum' && tinjauAda
      ? 'Tidak ada saran yang belum ditinjau pada periode ini.'
      : status === 'sudah' && tinjauAda
        ? 'Belum ada saran yang ditandai sudah ditinjau pada periode ini.'
        : 'Belum ada saran pada periode ini.';
  const belum = ringkasan?.belum ?? 0;

  return (
    <>
      <PageHeader
        title="Saran"
        description="Saran dari pengunjung, dikirim lewat survei Pesan Perilaku atau halaman publik /saran. Baca, lalu tandai yang sudah ditinjau."
      />
      <div className={styles.halaman}>
        {tinjauAda && ringkasan && !galat && (
          <div className={styles.ringkasan} role="group" aria-label="Status tinjauan">
            {([
              ['belum', 'Belum ditinjau', ringkasan.belum],
              ['sudah', 'Sudah ditinjau', ringkasan.sudah],
              ['semua', 'Semua', ringkasan.belum + ringkasan.sudah],
            ] as const).map(([kunci, label, angka]) => (
              <button
                key={kunci}
                type="button"
                className={styles.ringkasanTombol}
                aria-pressed={status === kunci}
                onClick={() => ubahStatus(kunci)}
              >
                {label} <span className={styles.ringkasanAngka}>{angka}</span>
              </button>
            ))}
          </div>
        )}

        <Kartu judul="Saring saran">
        <div className={styles.penyaring}>
          <div className={styles.bidang}>
            <PemilihRentang dari={dari} sampai={sampai} label="Rentang tanggal saran" onUbah={(r) => { ubah(setDari)(r.dari); ubah(setSampai)(r.sampai); }} />
          </div>
          <label className={styles.bidang}>
            Layanan
            <select className="form-select" value={layananId} onChange={(e) => ubah(setLayananId)(e.target.value)}>
              <option value="">Semua layanan</option>
              {daftarLayanan.map((l) => <option key={l.id} value={l.id}>{l.nama}</option>)}
            </select>
          </label>
          <label className={styles.bidang}>
            Sumber
            <select className="form-select" value={sumber} onChange={(e) => ubah(setSumber)(e.target.value as SumberFilter)}>
              <option value="">Semua sumber</option>
              <option value="layanan">Dari survei · Layanan</option>
              <option value="fo">Dari survei · Front Office</option>
              <option value="publik">Tautan publik</option>
            </select>
          </label>
          <label className={styles.bidangCari}>
            Cari isi saran
            <input
              type="search"
              className="form-input"
              placeholder="Ketik kata kunci"
              value={cariInput}
              onChange={(e) => setCariInput(e.target.value)}
            />
          </label>
        </div>

        </Kartu>

        {sudahMuat && !tinjauAda && (
          <CatatanKeadaan jenis="menunggu-migrasi">
            Penandaan sudah ditinjau belum aktif karena pembaruan basis data belum diterapkan. Daftar saran tetap dapat dibaca.
          </CatatanKeadaan>
        )}

        {tinjauAda && !galat && belum > 0 && status !== 'sudah' && (
          sasaran ? (
            <div className={styles.konfirmasi} role="group" aria-label="Konfirmasi tandai semua">
              <span>Tandai {sasaran.length} saran yang cocok dengan penyaring ini sebagai sudah ditinjau?</span>
              <Tombol ukuran="kecil" ikon={CheckCheck} memuat={sibuk === 'semua'} disabled={sibuk !== null} onClick={() => void tandaiSemua()}>Ya, tandai</Tombol>
              <Tombol varian="sekunder" ukuran="kecil" disabled={sibuk !== null} onClick={() => setSasaran(null)}>Batal</Tombol>
            </div>
          ) : (
            <div className={styles.tindakan}>
              <Tombol varian="sekunder" ukuran="kecil" ikon={CheckCheck} memuat={sibuk === 'siapkan'} disabled={sibuk !== null} onClick={() => void siapkanTandaiSemua()}>Tandai semua ditinjau</Tombol>
            </div>
          )
        )}

        {galat && <Galat pesan={galat} onRetry={() => void muat()} />}

        {loading && !sudahMuat ? (
          <Kartu><div role="status"><Skeleton bentuk="baris" jumlah={5} label="Memuat saran…" /></div></Kartu>
        ) : galat ? null : baris.length === 0 ? (
          <Kartu><StatusKosong ikon={Lightbulb} judul={pesanKosong} /></Kartu>
        ) : (
          <ul className={`${styles.daftar} ${loading ? styles.memuatUlang : ''}`} aria-busy={loading}>
            {baris.map((s) => {
              const sudahDitinjau = tinjauAda && !!s.ditinjau_pada;
              return (
                <li key={s.id} className={`${styles.kartu} ${tinjauAda && !sudahDitinjau ? styles.kartuBelum : ''}`}>
                  <p className={styles.isi}>{s.isi}</p>
                  <div className={styles.kartuFoot}>
                    <div className={styles.meta}>
                      <Lencana nada="netral" className={styles.lencanaSumber}>{labelSumber(s)}</Lencana>
                      {tinjauAda && (
                        sudahDitinjau
                          ? <Lencana nada="sukses">Ditinjau {formatTanggal(s.ditinjau_pada as string, { month: 'short' })}</Lencana>
                          : <Lencana nada="peringatan">Belum ditinjau</Lencana>
                      )}
                      <span>
                        {waktuSaran(s)} · {s.anonim || !s.pelapor_nama ? 'Anonim' : s.pelapor_nama}
                      </span>
                    </div>
                    {tinjauAda && !sudahDitinjau && (
                      <Tombol
                        varian="sekunder"
                        ukuran="kecil"
                        ikon={CheckCircle2}
                        memuat={sibuk === s.id}
                        disabled={sibuk !== null}
                        aria-label={`Tandai ditinjau: ${s.isi.slice(0, 40)}`}
                        onClick={() => void tandai(s.id)}
                      >
                        Tandai ditinjau
                      </Tombol>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {sudahMuat && !galat && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
      </div>
    </>
  );
}
