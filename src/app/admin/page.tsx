'use client';

// WP-22: Stats reads migrated from visit → kunjungan + tiket_antrean.
// Pendaftaran walk-in dilakukan Front Office di /admin/fo/registrasi?tab=walkin (rpc fo_mulai_kunjungan); halaman ini hanya membaca.
// Gaya "Dasbor": kepala + aksi utama, pintasan Admin, Perlu tindakan (A5), Status hari ini, KPI, grafik, tabel ringkas.
// Semua angka berasal dari kueri yang sudah ada; satu-satunya tambahan adalah hitungan SLA pengaduan (A5, v_pengaduan_kerja).

import { useEffect, useState, useCallback, useRef } from 'react';
import { todayWIB, addDaysWIB } from '@/lib/time';
import { formatTanggal, formatWaktu } from '@/lib/utils';
import {
  Users,
  Clock,
  CheckCircle2,
  Timer,
  UserPlus,
  ShieldCheck,
  ClipboardList,
  Bot,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import CalendarBanner from '@/components/admin/CalendarBanner';
import BannerEmailNotifikasi from '@/components/admin/BannerEmailNotifikasi';
import PerluTindakan, { type SlaPengaduan } from '@/components/admin/PerluTindakan';
import Tombol from '@/components/ui/Tombol';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Galat from '@/components/ui/Galat';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import { formatAngka } from '@/components/ui/format';
import PanelGrafik from '@/components/ui/grafik/PanelGrafik';
import { GrafikGarisMalas as GrafikGaris, GrafikBatangMalas as GrafikBatang, GrafikDonatMalas as GrafikDonat } from '@/components/ui/grafik/dinamis';
import TabelRingkas from '@/components/ui/grafik/TabelRingkas';
import type { ItemBilahStatus } from '@/components/ui/grafik/BilahStatus';
import type { KolomTabel } from '@/components/ui/Tabel';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeRefetch } from '@/lib/hooks/useRealtimeRefetch';
import { useNavBadges, type PenggunaBadge } from '@/lib/hooks/useNavBadges';
import StatusHariIni from './dashboard/StatusHariIni';
import {
  hariTersibuk,
  irisanDonat,
  jumlahKunjungan,
  rataMenit,
  ringkasPerLayanan,
  susunHarian,
  type BarisLayanan,
  type HariKunjungan,
} from './dashboard/turunan';
import styles from './dashboard.module.css';

interface RecentVisit {
  id: string;
  nama: string;
  layanan: string;
  waktu: string;
  status: string;
  nomor_display: string;
}

interface DataDasbor {
  totalHariIni: number;
  menunggu: number;
  selesai: number;
  /** null = belum ada tiket selesai yang lengkap waktunya (bukan 0). */
  rataLayan: number | null;
  rataTunggu: number | null;
  jumlahUkur: number;
  recent: RecentVisit[];
  harian: HariKunjungan[];
  layanan: BarisLayanan[];
  diperbarui: Date;
}

const STATUS_LENCANA: Record<string, { nada: NadaLencana; label: string }> = {
  menunggu: { nada: 'peringatan', label: 'Menunggu' },
  dilayani: { nada: 'info', label: 'Sedang dilayani' },
  selesai: { nada: 'sukses', label: 'Selesai' },
};

const KOLOM_LAYANAN: KolomTabel<BarisLayanan>[] = [
  { kunci: 'nama', judul: 'Layanan', judulBaris: true, peran: 'utama' },
  { kunci: 'menunggu', judul: 'Menunggu', angka: true },
  { kunci: 'dilayani', judul: 'Dilayani', angka: true },
  { kunci: 'selesai', judul: 'Selesai', angka: true },
];

const KOLOM_RECENT: KolomTabel<RecentVisit>[] = [
  { kunci: 'nomor_display', judul: 'No. tiket', render: (v) => <span className={styles.nomor}>{v.nomor_display}</span> },
  { kunci: 'nama', judul: 'Nama', render: (v) => <span className={styles.nama}>{v.nama}</span> },
  { kunci: 'layanan', judul: 'Layanan' },
  { kunci: 'waktu', judul: 'Waktu', angka: true },
  {
    kunci: 'status',
    judul: 'Status',
    render: (v) => {
      const s = STATUS_LENCANA[v.status] ?? { nada: 'netral' as const, label: v.status };
      return <Lencana nada={s.nada} titik>{s.label}</Lencana>;
    },
  },
];

const namaDari = (obj: unknown): string | null => {
  if (!obj) return null;
  const satu = Array.isArray(obj) ? obj[0] : obj;
  return (satu as { nama?: string } | undefined)?.nama ?? null;
};

export default function AdminDashboard() {
  // Dashboard untuk Admin dan Front Office. Petugas → antrian.
  // Tombol Tambah Petugas / Tata Kelola Data / Log AI hanya untuk Admin;
  // sebelum role terbukti admin, tombol itu tidak ditampilkan ("tolak dulu").
  const [who, setWho] = useState<PenggunaBadge | null>(null);
  const isAdmin = who?.role === 'admin';

  // Lencana yang sama dengan menu samping (satu sumber hitungan); dipakai kartu "Perlu tindakan sekarang".
  const badges = useNavBadges(who);
  const badgeSiap = Object.keys(badges).length > 0;

  const [data, setData] = useState<DataDasbor | null>(null);
  // loading = kerangka: hanya muat awal. Muat ulang dari realtime/polling berjalan senyap (angka & grafik tetap tampil, B-01).
  const [loading, setLoading] = useState(true);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [galatSegar, setGalatSegar] = useState(false);
  // SLA pengaduan (A5). null = view belum ada atau gagal dihitung: baris SLA disembunyikan (bukan 0).
  const [sla, setSla] = useState<SlaPengaduan | null>(null);
  const [slaMigrasi, setSlaMigrasi] = useState(false);
  const muatanRef = useRef(0); // hanya respons permintaan terakhir yang boleh mengisi layar
  const adaDataRef = useRef(false); // sudah pernah memuat data valid
  const roleRef = useRef<string | null>(null);
  const role = who?.role ?? null;
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const loadData = useCallback(async (senyap = false) => {
    const muatan = ++muatanRef.current;
    if (!senyap) {
      adaDataRef.current = false;
      setLoading(true);
      setGalatMuat(null);
    }
    try {
      const supabase = createClient();
      const today = todayWIB();

      // --- 1. Total kunjungan hari ini (all loket, checked-in) ---
      const { count: total, error: errTotal } = await supabase
        .from('kunjungan')
        .select('*', { count: 'exact', head: true })
        .eq('tanggal', today)
        .neq('status', 'terjadwal');

      // --- 2. Sedang menunggu (via tiket_antrean) ---
      const { count: waiting, error: errMenunggu } = await supabase
        .from('tiket_antrean')
        .select('*', { count: 'exact', head: true })
        .eq('tanggal', today)
        .eq('status', 'menunggu');

      // --- 3. Selesai dilayani (via tiket_antrean) ---
      const { count: done, error: errSelesai } = await supabase
        .from('tiket_antrean')
        .select('*', { count: 'exact', head: true })
        .eq('tanggal', today)
        .eq('status', 'selesai');

      const galatHitung = errTotal ?? errMenunggu ?? errSelesai;
      if (galatHitung) throw galatHitung; // galat tidak boleh tampil sebagai angka 0

      // --- 4. Rata-rata waktu layan dan waktu tunggu (tiket selesai hari ini) ---
      const { data: completedTickets, error: errDurasi } = await supabase
        .from('tiket_antrean')
        .select('waktu_terbit, waktu_mulai_layan, waktu_selesai')
        .eq('tanggal', today)
        .eq('status', 'selesai')
        .not('waktu_selesai', 'is', null);

      if (errDurasi) throw errDurasi;
      const tiketSelesai = completedTickets ?? [];
      const layan = rataMenit(tiketSelesai.map((t) => [t.waktu_mulai_layan, t.waktu_selesai]));
      const tunggu = rataMenit(tiketSelesai.map((t) => [t.waktu_terbit, t.waktu_mulai_layan]));

      // --- 5. Kunjungan terbaru (last 5 hari ini) ---
      const { data: recent, error: errRecent } = await supabase
        .from('kunjungan')
        .select('id, nama, status, waktu_masuk, tiket_antrean(nomor_display, layanan:layanan_id(nama))')
        .eq('tanggal', today)
        .neq('status', 'terjadwal')
        .order('waktu_masuk', { ascending: false, nullsFirst: false })
        .limit(5);

      if (errRecent) throw errRecent;
      const recentBaru = (recent ?? []).map((r) => {
        const tiket = Array.isArray(r.tiket_antrean) ? r.tiket_antrean[0] : r.tiket_antrean;
        return {
          id: r.id,
          nama: r.nama,
          layanan: namaDari(tiket?.layanan) ?? '—',
          nomor_display: tiket?.nomor_display ?? '—',
          waktu: r.waktu_masuk ? formatWaktu(r.waktu_masuk) : '—',
          status: r.status,
        };
      });

      // --- 7. Volume kunjungan mingguan (last 7 days via kunjungan.tanggal) ---
      const sevenDaysAgo = addDaysWIB(-6);
      const { data: weekly, error: errWeekly } = await supabase
        .from('kunjungan')
        .select('tanggal')
        .gte('tanggal', sevenDaysAgo)
        .lte('tanggal', today)
        .neq('status', 'terjadwal');

      if (errWeekly) throw errWeekly;
      const counts: Record<string, number> = {};
      const urutan: string[] = [];
      for (let i = 6; i >= 0; i--) {
        const t = addDaysWIB(-i);
        urutan.push(t);
        counts[t] = 0;
      }
      (weekly ?? []).forEach((w) => {
        if (counts[w.tanggal] !== undefined) counts[w.tanggal]++;
      });

      // --- 8. Breakdown per layanan hari ini (via tiket_antrean) ---
      const { data: breakdown, error: errBreakdown } = await supabase
        .from('tiket_antrean')
        .select('status, layanan:layanan_id(nama)')
        .eq('tanggal', today)
        .in('status', ['menunggu', 'dilayani', 'selesai']);

      if (errBreakdown) throw errBreakdown;
      const layananBaru = ringkasPerLayanan(
        (breakdown ?? []).map((b) => ({ nama: namaDari(b.layanan), status: (b as { status?: string }).status })),
      );

      // Semua kueri sukses: layar diganti sekali (tanpa keadaan setengah jadi).
      if (muatan !== muatanRef.current) return;
      setData({
        totalHariIni: total ?? 0,
        menunggu: waiting ?? 0,
        selesai: done ?? 0,
        rataLayan: layan.rata,
        rataTunggu: tunggu.rata,
        jumlahUkur: layan.jumlah,
        recent: recentBaru,
        harian: susunHarian(urutan, counts),
        layanan: layananBaru,
        diperbarui: new Date(),
      });
      adaDataRef.current = true;
      setGalatMuat(null);
      setGalatSegar(false);
    } catch {
      if (muatan !== muatanRef.current) return;
      if (adaDataRef.current) {
        // Muat ulang senyap gagal: angka lama tetap tampil, diberi label "Data terakhir ..., mencoba lagi" (tanpa toast tiap 30 dtk).
        setGalatSegar(true);
      } else {
        setGalatMuat('Data dashboard tidak dapat dimuat. Periksa koneksi Anda lalu coba lagi.');
      }
    } finally {
      if (muatan === muatanRef.current) setLoading(false);
    }
  }, []);

  // A5: hitungan SLA pengaduan dari v_pengaduan_kerja (dihitung server dalam hari kerja). Galat apa pun = baris SLA
  // disembunyikan (nilai terakhir dipertahankan), tidak pernah ditampilkan sebagai 0 dan tidak membatalkan dasbor.
  const muatSla = useCallback(async (peranBaru?: string) => {
    const peran = peranBaru ?? roleRef.current;
    if (!peran) return;
    try {
      const supabase = createClient();
      const hitung = async (status: 'terlambat' | 'mendekati') => {
        let q = supabase.from('v_pengaduan_kerja').select('id', { count: 'exact', head: true }).eq('sla_status', status);
        if (peran === 'front_office') q = q.eq('jalur', 'layanan'); // FO tidak pernah melihat jalur integritas
        const { count, error } = await q;
        return { n: error ? null : (count ?? 0), kode: error?.code };
      };
      const [t, m] = await Promise.all([hitung('terlambat'), hitung('mendekati')]);
      if (t.n === null || m.n === null) {
        // 42P01 = view belum ada (migrasi belum diterapkan): sembunyikan baris SLA seperti di halaman Pengaduan.
        if (t.kode === '42P01' || m.kode === '42P01') {
          setSla(null);
          setSlaMigrasi(true);
        }
        return;
      }
      setSlaMigrasi(false);
      setSla({ terlambat: t.n, mendekati: m.n });
    } catch {
      /* baris SLA tidak tampil */
    }
  }, []);

  const muatSenyap = useCallback(async () => {
    await Promise.all([loadData(true), muatSla()]);
  }, [loadData, muatSla]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  // Peran dibaca sekali; hitungan SLA dimulai dari callback hasilnya (bukan dari efek) agar setState tidak sinkron di efek.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('petugas').select('id, role, layanan_id').eq('auth_user_id', user.id).maybeSingle()
        .then(({ data }) => {
          if (data?.role === 'petugas') window.location.replace('/admin/antrian');
          else if (data?.role) {
            setWho({ role: data.role, petugasId: data.id ?? null, layananId: data.layanan_id ?? null });
            void muatSla(data.role);
          }
        });
    });
  }, [muatSla]);

  // Fase 3: data menyegarkan sendiri via realtime + polling cadangan 30 dtk.
  // visit = arsip baca-saja sejak WP-24 (tak pernah berubah lagi): dengarkan tiket_antrean + penanganan (tabel yang
  // bergerak di alur FO/antrean; kunjungan sendiri tidak ada di publikasi realtime, perubahannya terjemput polling).
  useRealtimeRefetch(muatSenyap, { tables: ['tiket_antrean', 'penanganan'], pollMs: 30_000 });

  const memuatAwal = loading && !data;
  const harian = data?.harian ?? [];
  const totalMinggu = jumlahKunjungan(harian);
  const puncak = hariTersibuk(harian);
  const irisan = irisanDonat(data?.layanan ?? []);
  const totalTiket = irisan.reduce((j, i) => j + i.nilai, 0);
  const jam = data ? formatWaktu(data.diperbarui) : null;

  // Kesegaran data ("Data terakhir ... WIB") ada di meta kepala halaman; bilah ini memuat status lain.
  const itemStatus: ItemBilahStatus[] = [];
  if (memuatAwal) itemStatus.push({ kunci: 'segar', nada: 'netral', label: 'Memuat data hari ini' });
  else if (galatMuat) itemStatus.push({ kunci: 'segar', nada: 'bahaya', label: 'Data hari ini belum dapat dimuat' });
  if (data) {
    const n = data.layanan.length;
    itemStatus.push(
      n > 0
        ? { kunci: 'layanan', nada: 'sukses', label: `${n} Layanan menerima antrean hari ini` }
        : { kunci: 'layanan', nada: 'netral', label: 'Belum ada antrean hari ini' },
    );
  }
  if (slaMigrasi) itemStatus.push({ kunci: 'migrasi-sla', nada: 'info', label: 'Pemantauan SLA pengaduan menunggu migrasi' });

  return (
    <>
      <PageHeader
        title="Dasbor"
        description={`Ringkasan pelayanan hari ini, ${formatTanggal(new Date(), { weekday: 'long' })} (WIB).`}
        meta={
          jam ? (
            <span role={galatSegar ? 'status' : undefined}>
              {galatSegar ? `Data terakhir ${jam} WIB, mencoba lagi` : `Data terakhir ${jam} WIB`}
            </span>
          ) : undefined
        }
      >
        <Tombol href="/admin/fo/registrasi?tab=walkin" varian="utama" ikon={UserPlus} className={styles.walkin}>
          Daftarkan Pengunjung Walk-in
        </Tombol>
      </PageHeader>

      <div className={styles.dashboard}>
        <div className={styles.pintasan} role="group" aria-label="Pintasan">
          {isAdmin && (
            <Tombol href="/admin/petugas/invite" varian="sekunder" ikon={UserPlus}>
              Tambah Petugas
            </Tombol>
          )}
          {isAdmin && (
            <Tombol href="/admin/data-governance" varian="sekunder" ikon={ShieldCheck}>
              Tata Kelola Data (DPO)
            </Tombol>
          )}
          <Tombol href="/admin/pesan-perilaku" varian="sekunder" ikon={ClipboardList}>
            Pesan Perilaku
          </Tombol>
          {isAdmin && (
            <Tombol href="/admin/chat/ai-log" varian="sekunder" ikon={Bot}>
              Log Asisten AI
            </Tombol>
          )}
        </div>

        <div className={styles.atas}>
          <PerluTindakan badges={badges} sla={sla} memuat={!badgeSiap} className={styles.perlu} />
          <div className={styles.kolomStatus}>
            <StatusHariIni item={itemStatus} adalahAdmin={isAdmin} className={styles.statusHariIni} />
            <CalendarBanner />
          </div>
        </div>

        <div className={styles.banner}>
          <BannerEmailNotifikasi />
        </div>

        {galatMuat ? (
          <div className={styles.galat}>
            <Galat pesan={galatMuat} onRetry={() => { void loadData(); }} memuat={loading} />
          </div>
        ) : (
          <>
            <section className={styles.kpi} aria-label="Statistik utama">
              <KartuStatistik
                label="Hadir hari ini"
                ikon={Users}
                nilai={data?.totalHariIni ?? 0}
                pembanding="Walk-in dan reservasi"
                href="/admin/kunjungan"
                memuat={memuatAwal}
              />
              <KartuStatistik
                label="Sedang menunggu"
                ikon={Clock}
                nilai={data?.menunggu ?? 0}
                pembanding={data?.rataTunggu != null ? `Tunggu rata-rata ${data.rataTunggu} mnt (tiket selesai)` : 'Antrean hari ini'}
                href="/admin/antrian"
                memuat={memuatAwal}
              />
              <KartuStatistik
                label="Selesai dilayani"
                ikon={CheckCircle2}
                nilai={data?.selesai ?? 0}
                pembanding="Tiket selesai hari ini"
                memuat={memuatAwal}
              />
              <KartuStatistik
                label="Rata-rata waktu layan"
                ikon={Timer}
                nilai={data?.rataLayan != null ? `${data.rataLayan} mnt` : '—'}
                pembanding={data && data.jumlahUkur > 0 ? `Dari ${formatAngka(data.jumlahUkur)} tiket selesai` : 'Belum ada tiket selesai'}
                memuat={memuatAwal}
              />
            </section>

            <div className={styles.utama}>
              <div className={styles.kolom}>
                <PanelGrafik
                  judul="Tren kunjungan"
                  meta="7 hari terakhir"
                  nilaiUtama={
                    <>
                      {formatAngka(totalMinggu)} <span className={styles.satuan}>kunjungan</span>
                    </>
                  }
                  legenda={[{ label: 'Kunjungan per hari', warna: 'var(--chart-1)' }]}
                  tabel={{
                    kolom: [{ kunci: 'tanggal', label: 'Tanggal' }, { kunci: 'kunjungan', label: 'Kunjungan' }],
                    baris: harian.map((h) => ({ tanggal: `${h.hari}, ${h.tanggalPendek}`, kunjungan: h.kunjungan })),
                  }}
                  namaBerkas="kunjungan-7-hari"
                  laporanHref="/admin/rekap"
                  memuat={memuatAwal}
                  kosong={
                    totalMinggu === 0 ? (
                      <CatatanKeadaan jenis="kosong">Belum ada kunjungan dalam 7 hari terakhir.</CatatanKeadaan>
                    ) : undefined
                  }
                >
                  <GrafikGaris
                    label="Grafik garis kunjungan 7 hari terakhir"
                    data={harian.map((h) => ({ label: h.label, kunjungan: h.kunjungan }))}
                    sumbuX="label"
                    seri={[{ kunci: 'kunjungan', label: 'Kunjungan', area: true }]}
                  />
                </PanelGrafik>

                <TabelRingkas
                  judul="Layanan tersibuk hari ini"
                  kolom={KOLOM_LAYANAN}
                  baris={data?.layanan ?? []}
                  kunciBaris="nama"
                  lihatSemua={{ href: '/admin/rekap', label: 'Lihat semua di Rekap' }}
                  memuat={memuatAwal}
                  kosong={<CatatanKeadaan jenis="kosong">Belum ada antrean hari ini.</CatatanKeadaan>}
                />
              </div>

              <div className={styles.samping}>
                <PanelGrafik
                  judul="Hari tersibuk"
                  meta="7 hari terakhir"
                  tabel={{
                    kolom: [{ kunci: 'tanggal', label: 'Tanggal' }, { kunci: 'kunjungan', label: 'Kunjungan' }],
                    baris: harian.map((h) => ({ tanggal: `${h.hari}, ${h.tanggalPendek}`, kunjungan: h.kunjungan })),
                  }}
                  namaBerkas="hari-tersibuk"
                  memuat={memuatAwal}
                  kosong={
                    totalMinggu === 0 ? (
                      <CatatanKeadaan jenis="kosong">Belum ada kunjungan dalam 7 hari terakhir.</CatatanKeadaan>
                    ) : undefined
                  }
                  kaki={
                    puncak ? (
                      <p className={styles.kaki}>
                        Tersibuk: {puncak.hariPanjang}, {puncak.tanggalPendek} ({formatAngka(puncak.kunjungan)} kunjungan)
                      </p>
                    ) : undefined
                  }
                >
                  <GrafikBatang
                    label="Grafik batang kunjungan per hari, 7 hari terakhir"
                    data={harian.map((h) => ({ hari: h.hari, tanggal: h.tanggal, kunjungan: h.kunjungan }))}
                    sumbuX="hari"
                    nilai="kunjungan"
                    labelNilai="Kunjungan"
                    sorot={puncak ? (b) => b.tanggal === puncak.tanggal : []}
                    tinggi={200}
                  />
                </PanelGrafik>

                <PanelGrafik
                  judul="Breakdown per Layanan"
                  meta="hari ini"
                  tabel={{
                    kolom: [{ kunci: 'nama', label: 'Layanan' }, { kunci: 'nilai', label: 'Tiket' }],
                    baris: irisan.map((i) => ({ nama: i.nama, nilai: i.nilai })),
                  }}
                  namaBerkas="breakdown-layanan"
                  laporanHref="/admin/rekap"
                  memuat={memuatAwal}
                  kosong={
                    irisan.length === 0 ? (
                      <CatatanKeadaan jenis="kosong">Belum ada antrean hari ini.</CatatanKeadaan>
                    ) : undefined
                  }
                >
                  <GrafikDonat
                    label="Grafik donat tiket per Layanan hari ini"
                    data={irisan}
                    tengah={{ nilai: formatAngka(totalTiket), label: 'tiket' }}
                  />
                </PanelGrafik>
              </div>

              <div className={styles.penuh}>
                <TabelRingkas
                  judul="Kunjungan Terbaru"
                  kolom={KOLOM_RECENT}
                  baris={data?.recent ?? []}
                  kunciBaris="id"
                  lihatSemua={{ href: '/admin/kunjungan', label: 'Lihat Semua' }}
                  memuat={memuatAwal}
                  kosong={<CatatanKeadaan jenis="kosong">Belum ada kunjungan hari ini.</CatatanKeadaan>}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
