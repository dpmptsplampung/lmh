'use client';

// WP-22: Queue reads migrated from visit → tiket_antrean + kunjungan.
// A3 (migrasi 202610140002_tiket_kepemilikan): transisi status lewat RPC atomik, BUKAN UPDATE langsung visit.
//   - "Mulai Layanan" -> rpc layanan_mulai: guard atomik di tiket (satu pemenang), dilayani_oleh = pemanggil.
//   - "Selesai" (layanan tanpa pendataan) -> rpc layanan_selesai: hanya pemilik tiket (yang memulai).
//   - Layanan pendataan diselesaikan lewat PelayananWizardModal -> POST /api/admin/pelayanan/[tiketId].
//   - Admin dapat "Ambil alih" tiket yang dilayani orang lain (rpc admin_ambil_alih, alasan wajib).
// B4 (migrasi 202610140004, kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md): tiket HASIL ESKALASI Front Office
//   (penanganan_asal_id terisi) menampilkan catatan eskalasi FO; menyelesaikannya: layanan ber-Pendataan cukup
//   Pendataan (202610140015: topik NULL, catatan diturunkan DB), layanan tanpa Pendataan wajib topik + catatan
//   (layanan_selesai 5 parameter), pemilik dapat "Kembalikan ke FO" (layanan_kembalikan), Admin dapat "Alihkan"
//   (admin_alihkan). Tiket lama (penanganan_asal_id null) tetap tanpa topik/catatan.
// RPC bekerja langsung pada kunjungan/tiket/penanganan (visit = arsip sejak WP-24; SKM/notifikasi/estimasi lewat trigger kunjungan).

import { Suspense, useState, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { todayWIB } from '@/lib/time';
import {
  Clock,
  Users,
  TrendingUp,
  CheckCircle2,
  Play,
  AlertCircle,
  Volume2,
  FileText,
  FileEdit,
  Pencil,
  UserCheck,
  ChevronDown,
  ChevronUp,
  Download,
  UserCog,
  Undo2,
  ArrowRightLeft,
  MessageSquare,
  QrCode,
  BellRing,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import Tab, { PanelTab } from '@/components/ui/Tab';
import Tombol from '@/components/ui/Tombol';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import Galat from '@/components/ui/Galat';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import PemilihTanggal from '@/components/ui/PemilihTanggal';
import PanelSekarang, { type TiketPanel, type OpsiLayananPanel } from './PanelSekarang';
import {
  bacaParamAntrean,
  susunQueryAntrean,
  STATUS_PER_FILTER,
  type FilterStatus,
} from './antrianUrl';
import { formatTanggal, formatWaktu } from '@/lib/utils';
import styles from './antrian.module.css';
import CalendarBanner from '@/components/admin/CalendarBanner';
import RoleNote from '@/components/admin/RoleNote';
import Pagination from '@/components/Pagination';
import WalkinWizard from '@/components/WalkinWizard';
import PelayananWizardModal from '@/components/admin/PelayananWizardModal';
import KoreksiPelayananModal from '@/components/admin/KoreksiPelayananModal';
import AmbilAlihTiketModal, { type ModeAmbilAlih, type TiketAmbilAlih } from '@/components/admin/AmbilAlihTiketModal';
import PemberitahuanAmbilAlih from '@/components/admin/PemberitahuanAmbilAlih';
import { bolehKoordinatorAmbilAlihTiket, muatKoordinator } from '@/lib/akses-data/lingkup';
import AlihkanTiketModal, { type TiketAlihkan } from '@/components/admin/AlihkanTiketModal';
import KembalikanKeFoModal, { type TiketKembalikan } from '@/components/admin/KembalikanKeFoModal';
import SelesaiEskalasiModal, { type TiketSelesaiEskalasi } from '@/components/admin/SelesaiEskalasiModal';
import SurveiQrDialog from '@/components/admin/SurveiQrDialog';
import SurveiStatusBadge from '@/components/admin/SurveiStatusBadge';
import { ambilStatusSurvei, type StatusSurvei } from '@/lib/survei/staf';
import {
  formPendataanLayanan,
  bolehMulaiTiket,
  bolehSelesaikanTiket,
  bolehAmbilAlihTiket,
  bolehKembalikanTiket,
  bolehAlihkanTiket,
  tiketHasilEskalasi,
  kodeGalatDariError,
  PESAN_GALAT_ANTREAN,
  type KodeGalatAntrean,
} from '@/lib/pelayanan';
import { createClient } from '@/lib/supabase/client';
import { mutasiInsert, mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';
import { toCsv } from '@/lib/csv';
import { useToast } from '@/components/Toast';
import { useRealtimeRefetch } from '@/lib/hooks/useRealtimeRefetch';
import {
  muatAntreanFo,
  jendelaTanggalFo,
  tanggalDalamJendela,
  pesanJendelaTanggal,
  galatTanggalDiluarBatas,
} from '@/lib/fo/akses-antrean';

const PAGE_SIZE = 25;
// Jeda kunci tombol Panggil setelah panggilan sukses (hanya mencegah klik ganda tak sengaja, bukan batas jumlah panggilan).
const JEDA_PANGGIL_MS = 1500;

// Galat RPC yang berarti tampilan antrean basi (tiket berubah di tempat lain) -> muat ulang daftar.
const KODE_MUAT_ULANG: ReadonlySet<KodeGalatAntrean> = new Set<KodeGalatAntrean>([
  'SUDAH_DIAMBIL', 'BUKAN_PEMILIK', 'INVALID_STATUS', 'NOT_FOUND', 'DIVERGENSI', 'TRANSISI_LEWAT_RPC', 'TIKET_LAMA',
]);

interface HasilMulai {
  ok: boolean;
  sudah_milik_anda?: boolean;
}

interface PetugasData {
  id: string;
  role: string;
  layanan_id: string;
  layanan?: { nama: string } | { nama: string }[];
  /** Fase 3: penanda Koordinator (false bila migrasi 202610290001 belum diterapkan). */
  koordinator?: boolean;
}

interface KunjunganEmbed {
  nama: string;
  asal: 'walk_in' | 'reservasi';
  waktu_masuk: string | null;
}

interface LayananEmbed {
  nama: string;
  form_pendataan?: string | null;
}

interface AntrianRow {
  id: string;             // tiket_antrean.id
  kunjungan_id: string;   // kunci status/QR Pesan Perilaku (survei terpadu); '' bila tiket lama tanpa kunjungan
  legacy_visit_id: string;
  /** Nama Front Office yang mendaftarkan/menerima pengunjung (RPC fo_antrean_daftar, migrasi 202611030015). */
  fo_nama?: string | null;
  layanan_id: string;
  dilayani_oleh: string | null; // petugas.id yang memulai layanan (pemilik tiket)
  penanganan_asal_id?: string | null; // tahap FO yang melahirkan tiket; null/kosong = tiket lama (alur visit)
  pelayan: { nama: string } | { nama: string }[] | null; // nama pemilik (RLS: petugas hanya membaca barisnya sendiri)
  nomor: number;
  nomor_display: string;
  status: 'menunggu' | 'dilayani' | 'selesai' | 'tidak_terlayani' | 'no_show' | 'batal' | 'dikembalikan' | 'dialihkan';
  waktu_terbit: string | null;
  waktu_mulai_layan: string | null;
  waktu_selesai: string | null;
  // form_pendataan: jenis Formulir Pendataan wajib (migrasi 202610140012; ditegakkan layanan_selesai).
  layanan: LayananEmbed | LayananEmbed[] | null;
  kunjungan: KunjunganEmbed | KunjunganEmbed[] | null;
}

// Catatan eskalasi dari Front Office (kontrak §6.3): topik + catatan tahap FO yang melahirkan tiket.
interface CatatanEskalasi {
  topik: string | null;
  catatan: string | null;
  foNama: string | null;
}

interface AbsensiRekap {
  id: string;
  petugas_id: string;
  tanggal: string;
  jam_masuk: string | null;
  jam_pulang: string | null;
  status: string;
  petugas: { nama: string } | null;
}

// A13: tanggal, saringan status, dan halaman ada di URL. useSearchParams menuntut Suspense (guide Next.js: use-search-params).
export default function AntrianPage() {
  return (
    <Suspense fallback={<AntrianMemuat />}>
      <AntrianIsi />
    </Suspense>
  );
}

function AntrianMemuat() {
  return (
    <>
      <PageHeader title="Antrean" description="Memuat antrean…" />
      <div className={styles.halaman}>
        <Skeleton bentuk="kartu" jumlah={2} label="Memuat antrean…" />
      </div>
    </>
  );
}

/** "2026-11-04" -> "4 November 2026" (kalender WIB; jam 12 siang menghindari geseran hari). */
const tanggalPanjang = (t: string) => formatTanggal(`${t}T12:00:00+07:00`);

const NADA_STATUS: Record<string, NadaLencana> = {
  menunggu: 'peringatan',
  dilayani: 'info',
  selesai: 'sukses',
  tidak_terlayani: 'bahaya',
  no_show: 'netral',
  batal: 'netral',
  dikembalikan: 'peringatan',
  dialihkan: 'info',
};

const BATAS_TIKET_KLIEN = 10_000;
const PESAN_BATAS_TIKET = 'Antrean tanggal ini melebihi batas pemuatan 10.000 tiket. Hubungi Admin untuk membuka data lengkap.';

const LABEL_FILTER: Record<FilterStatus, string> = { aktif: 'Aktif', selesai: 'Selesai', semua: 'Semua' };

const TAB_STATUS = [
  { kunci: 'aktif', label: 'Aktif' },
  { kunci: 'selesai', label: 'Selesai' },
  { kunci: 'semua', label: 'Semua' },
];

function AntrianIsi() {
  const { toast } = useToast();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const awal = bacaParamAntrean(sp, todayWIB());
  const [tanggal, setTanggal] = useState(awal.tanggal);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(awal.status);
  // URL berubah dari luar (tombol kembali, tautan yang dibagikan): ikuti. Perubahan dari halaman ini sendiri sudah sama.
  const queryUrl = sp?.toString() ?? '';
  const [queryUrlSebelumnya, setQueryUrlSebelumnya] = useState(queryUrl);
  const [pesanTanggal, setPesanTanggal] = useState<string | null>(null);
  const [antrian, setAntrian] = useState<AntrianRow[]>([]);
  const [antrianPanel, setAntrianPanel] = useState<AntrianRow[]>([]);
  const [currentUser, setCurrentUser] = useState<PetugasData | null>(null);
  const [unassigned, setUnassigned] = useState(false);
  // loading = skeleton: HANYA muat awal / ganti tanggal / ganti halaman (data di layar bukan milik parameter ini).
  // Muat ulang dari realtime, polling, dan setelah aksi berjalan senyap (tabel tetap, B-01).
  const [loading, setLoading] = useState(true);
  const [menyegarkan, setMenyegarkan] = useState(false);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [galatSegar, setGalatSegar] = useState(false);
  // Waktu muat sukses terakhir (ISO): ditampilkan di kepala halaman sebagai "Data terakhir 10.42 WIB".
  const [terakhir, setTerakhir] = useState<string | null>(null);
  const muatanRef = useRef(0); // hanya respons permintaan terakhir yang boleh mengisi layar
  const adaDataRef = useRef(false); // sudah ada data valid untuk tanggal/halaman yang tampil
  const profilRef = useRef<{ role: string; layananId: string | null; koordinator?: boolean } | null>(null);
  const [page, setPage] = useState(awal.halaman);
  if (queryUrl !== queryUrlSebelumnya) {
    setQueryUrlSebelumnya(queryUrl);
    setTanggal(awal.tanggal);
    setFilterStatus(awal.status);
    setPage(awal.halaman);
  }
  // A13: tulis ke URL tanpa menambah riwayat; nilai bawaan tidak ditulis.
  const tulisUrl = (p: { tanggal: string; status: FilterStatus; halaman: number }) => {
    const q = susunQueryAntrean(p, todayWIB());
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const [totalCount, setTotalCount] = useState(0);
  const [totalHarian, setTotalHarian] = useState(0);
  // Daftar dari RPC akses FO (semua FO melihat seluruh antrean; kolom "Front Office" tersedia). False = kueri lama.
  const [aksesFo, setAksesFo] = useState(false);
  const [serverStats, setServerStats] = useState<{
    totalSelesai: number;
    rataWaktuMenit: number;
  }>({ totalSelesai: 0, rataWaktuMenit: 0 });
  const [activeWizardTiketId, setActiveWizardTiketId] = useState<string | null>(null);
  const [koreksiTiketId, setKoreksiTiketId] = useState<string | null>(null);
  const [ambilAlihTiket, setAmbilAlihTiket] = useState<TiketAmbilAlih | null>(null);
  const [modeAmbilAlih, setModeAmbilAlih] = useState<ModeAmbilAlih>('admin');
  const [alihkanTiket, setAlihkanTiket] = useState<TiketAlihkan | null>(null);
  const [kembalikanTiket, setKembalikanTiket] = useState<TiketKembalikan | null>(null);
  const [selesaiEskalasiTiket, setSelesaiEskalasiTiket] = useState<TiketSelesaiEskalasi | null>(null);
  // Pesan Perilaku (survei terpadu): kunjungan yang QR-nya sedang ditampilkan + status per kunjungan (tiket selesai).
  const [qrKunjunganId, setQrKunjunganId] = useState<string | null>(null);
  const [statusSurvei, setStatusSurvei] = useState<ReadonlyMap<string, StatusSurvei>>(new Map());
  // penanganan_asal_id -> catatan eskalasi FO (dimuat bersama daftar; kosong bila tak terbaca).
  const [catatanEskalasi, setCatatanEskalasi] = useState<Record<string, CatatanEskalasi>>({});
  // Tiket yang sedang diproses: tombolnya dikunci sampai RPC selesai (ref = penjaga klik ganda sebelum render ulang).
  const [sedangProses, setSedangProses] = useState<ReadonlySet<string>>(new Set());
  const prosesRef = useRef<Set<string>>(new Set());
  // Tombol Panggil: terkunci sebentar setelah klik (penjaga klik ganda tak sengaja), lalu bisa diklik ulang tanpa batas.
  const [sedangPanggil, setSedangPanggil] = useState<ReadonlySet<string>>(new Set());
  const panggilRef = useRef<Set<string>>(new Set());
  const [pengumuman, setPengumuman] = useState('');
  // Panel Sekarang: Layanan yang dipilih Admin/FO (null = Layanan pertama yang punya tiket menunggu).
  const [panelLayananId, setPanelLayananId] = useState<string | null>(null);

  // ── Rekapitulasi Absen ────────────────────────────────────────────────────
  const [rekapOpen, setRekapOpen] = useState(false);
  const [rekapAbsensi, setRekapAbsensi] = useState<AbsensiRekap[]>([]);
  const [rekapLoading, setRekapLoading] = useState(false);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tanggal, page, filterStatus]);

  // Fase 3: antrean menyegarkan sendiri saat ada perubahan tiket
  // (postgres_changes — staff RLS) + polling cadangan 30 dtk.
  useRealtimeRefetch(muatSenyap, { table: 'tiket_antrean', pollMs: 30_000 });

  // Muat ulang tanpa membongkar tabel (realtime, polling, setelah aksi). Muat awal/ganti parameter memakai fetchData().
  function muatSenyap() {
    return fetchData(true);
  }

  async function fetchData(senyap = false) {
    const muatan = ++muatanRef.current;
    if (senyap) {
      setMenyegarkan(true);
    } else {
      adaDataRef.current = false;
      setLoading(true);
      setGalatMuat(null);
    }
    try {
      const supabase = createClient();

      // Profil/peran dibaca sekali per sesi halaman, bukan di tiap polling.
      let myRole = 'admin';
      let myLayananId: string | null = null;
      if (profilRef.current) {
        myRole = profilRef.current.role;
        myLayananId = profilRef.current.layananId;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: p, error: errProfil } = await supabase
            .from('petugas')
            .select('id, role, layanan_id, layanan:layanan_id(nama)')
            .eq('auth_user_id', user.id)
            .single();
          // PGRST116 = tidak ada baris (perilaku lama: dianggap tanpa profil); galat lain = gagal memuat.
          if (errProfil && errProfil.code !== 'PGRST116') throw errProfil;
          if (p) {
            myRole = p.role;
            myLayananId = p.layanan_id;
            // Penanda dibaca terpisah: select kolom yang belum ada akan menggagalkan seluruh kueri sebelum migrasi.
            const koordinator = p.role !== 'admin' ? await muatKoordinator(supabase, p.id) : false;
            if (muatan !== muatanRef.current) return;
            setCurrentUser({ ...(p as unknown as PetugasData), koordinator });
            profilRef.current = { role: myRole, layananId: myLayananId, koordinator };
          }
        }
      }

      // Petugas tanpa layanan tidak boleh melihat antrian
      if (myRole === 'petugas' && !myLayananId) {
        if (muatan !== muatanRef.current) return;
        adaDataRef.current = true;
        setUnassigned(true);
        setAntrian([]);
        setTotalCount(0);
        setTotalHarian(0);
        setAntrianPanel([]);
        return;
      }

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // Akses FO (migrasi 202611030015): Admin dan Front Office membaca antrean lewat RPC berkolom aman, sehingga semua FO
      // melihat seluruh antrean (nomor, layanan, status, jam, nama, FO) tanpa HP/email/isian rekan. Petugas (termasuk
      // Koordinator) tetap memakai kueri lama berlingkup Layanannya. RPC belum ada -> kueri lama untuk semua peran.
      if (myRole === 'admin' || myRole === 'front_office') {
        const lewat = await muatAntreanFo(supabase, { tanggal, batas: PAGE_SIZE, lewati: 0 });
        if (lewat.tersedia) {
          if (muatan !== muatanRef.current) return;
          // RPC lama belum punya filter status: kumpulkan halaman berkolom aman satu tanggal.
          // Batas eksplisit mencegah pemindaian tanpa batas; gagal tertutup, jangan tampilkan panel yang tak lengkap.
          const semua = [...lewat.data.rows];
          if (lewat.data.total > BATAS_TIKET_KLIEN) throw new Error(PESAN_BATAS_TIKET);
          while (semua.length < lewat.data.total) {
            const lanjutan = await muatAntreanFo(supabase, { tanggal, batas: 200, lewati: semua.length });
            if (muatan !== muatanRef.current) return;
            if (!lanjutan.tersedia || !lanjutan.data.rows.length) throw new Error('Daftar antrean berubah saat dimuat. Coba lagi.');
            semua.push(...lanjutan.data.rows);
          }
          const seluruhBaris = semua.map((r) => ({ ...r, kunjungan_id: r.kunjungan_id ?? '', legacy_visit_id: '' })) as unknown as AntrianRow[];
          const statusDipilih = STATUS_PER_FILTER[filterStatus];
          const terfilter = statusDipilih ? seluruhBaris.filter((a) => statusDipilih.includes(a.status)) : seluruhBaris;
          const baris = terfilter.slice(from, to + 1);
          setAntrianPanel(seluruhBaris);
          setUnassigned(false);
          setAksesFo(true);
          setAntrian(baris);
          setTotalCount(terfilter.length);
          setTotalHarian(lewat.data.total);
          setServerStats(lewat.data.statistik);
          adaDataRef.current = true;
          setGalatMuat(null);
          setGalatSegar(false);
          setTerakhir(new Date().toISOString());
          await Promise.all([muatCatatanEskalasi(supabase, baris), muatStatusSurvei(supabase, baris)]);
          return;
        }
      }

      // WP-22: read from tiket_antrean filtered by tanggal (date column).
      // kunjungan embedded for nama, asal, waktu_masuk.
      // Only rows with issued tickets are included — terjadwal reservations have no ticket yet.
      let query = supabase
        .from('tiket_antrean')
        .select(`
          id, kunjungan_id, legacy_visit_id, layanan_id, dilayani_oleh, penanganan_asal_id, nomor, nomor_display, status,
          waktu_terbit, waktu_mulai_layan, waktu_selesai,
          layanan:layanan_id(nama, form_pendataan),
          pelayan:dilayani_oleh(nama),
          kunjungan(nama, asal, waktu_masuk)
        `, { count: 'exact' })
        .eq('tanggal', tanggal)
        .order('nomor', { ascending: true });

      // A2: saringan status di server sebelum paginasi (statistik di bawah tetap dari kueri statistik terpisah).
      const statusDipilih = STATUS_PER_FILTER[filterStatus];
      if (statusDipilih) {
        query = query.in('status', [...statusDipilih]);
      }

      if (myRole === 'petugas' && myLayananId) {
        query = query.eq('layanan_id', myLayananId);
      }

      const { data, count, error: errTiket } = await query.range(from, to);
      if (errTiket) throw errTiket; // galat tidak boleh tampil sebagai "Belum Ada Antrean"
      if (muatan !== muatanRef.current) return;
      const barisAntrian = (data || []) as unknown as AntrianRow[];

      // Panel hari ini berdiri sendiri: seluruh tiket aktif, terurut, terlepas dari tab/halaman tabel.
      const barisPanel: AntrianRow[] = [];
      if (tanggal === todayWIB() && filterStatus !== 'selesai') {
        let totalPanel = 0;
        do {
          let panelQuery = supabase.from('tiket_antrean').select(`
            id, kunjungan_id, legacy_visit_id, layanan_id, dilayani_oleh, penanganan_asal_id, nomor, nomor_display, status,
            waktu_terbit, waktu_mulai_layan, waktu_selesai,
            layanan:layanan_id(nama, form_pendataan), pelayan:dilayani_oleh(nama), kunjungan(nama, asal, waktu_masuk)
          `, { count: 'exact' }).eq('tanggal', tanggal).order('nomor', { ascending: true })
            .in('status', ['menunggu', 'dilayani']);
          if (myRole === 'petugas' && myLayananId) panelQuery = panelQuery.eq('layanan_id', myLayananId);
          const hasil = await panelQuery.range(barisPanel.length, barisPanel.length + 199);
          if (hasil.error) throw hasil.error;
          if (muatan !== muatanRef.current) return;
          totalPanel = hasil.count ?? (hasil.data?.length ?? 0);
          if (totalPanel > BATAS_TIKET_KLIEN) throw new Error(PESAN_BATAS_TIKET);
          if (!hasil.data?.length && barisPanel.length < totalPanel) throw new Error('Daftar antrean berubah saat dimuat. Coba lagi.');
          barisPanel.push(...((hasil.data ?? []) as unknown as AntrianRow[]));
        } while (barisPanel.length < totalPanel);
      }
      if (muatan !== muatanRef.current) return;

      // T-5: Stats dari server, bukan dari halaman aktif saja
      let statsQuery = supabase
        .from('tiket_antrean')
        .select('waktu_mulai_layan, waktu_selesai', { count: 'exact' })
        .eq('tanggal', tanggal)
        .eq('status', 'selesai');

      if (myRole === 'petugas' && myLayananId) {
        statsQuery = statsQuery.eq('layanan_id', myLayananId);
      }

      const { data: statsData, count: selesaiCount, error: errStats } = await statsQuery;
      if (errStats) throw errStats;
      if (muatan !== muatanRef.current) return;
      const selesaiRows = statsData ?? [];
      const totalDurasiMenit = selesaiRows.reduce((sum, row) => {
        if (!row.waktu_selesai || !row.waktu_mulai_layan) return sum;
        return sum + (new Date(row.waktu_selesai).getTime() - new Date(row.waktu_mulai_layan).getTime()) / 60000;
      }, 0);
      // Total harian memakai cakupan tanggal/Layanan yang sama, tanpa saringan tab dan tanpa baris payload.
      let totalQuery = supabase.from('tiket_antrean').select('id', { count: 'exact', head: true }).eq('tanggal', tanggal);
      if (myRole === 'petugas' && myLayananId) totalQuery = totalQuery.eq('layanan_id', myLayananId);
      const harian = await totalQuery;
      if (harian.error) throw harian.error;
      if (muatan !== muatanRef.current) return;
      setTotalHarian(harian.count ?? 0);
      // Semua kueri utama sukses: baru sekarang layar diganti (satu kali, tanpa keadaan setengah jadi).
      setUnassigned(false);
      setAksesFo(false);
      setAntrian(barisAntrian);
      setAntrianPanel(barisPanel);
      setTotalCount(count ?? (data?.length ?? 0));
      setServerStats({
        totalSelesai: selesaiCount ?? selesaiRows.length,
        rataWaktuMenit: selesaiRows.length > 0 ? Math.round(totalDurasiMenit / selesaiRows.length) : 0,
      });
      adaDataRef.current = true;
      setGalatMuat(null);
      setGalatSegar(false);
      setTerakhir(new Date().toISOString());
      await Promise.all([muatCatatanEskalasi(supabase, barisAntrian), muatStatusSurvei(supabase, barisAntrian)]);
    } catch (e) {
      console.error(e);
      if (muatan !== muatanRef.current) return;
      if (galatTanggalDiluarBatas(e)) {
        // Batas tanggal FO non-Koordinator ditolak server: pesan jelas, bukan "periksa koneksi".
        adaDataRef.current = false;
        setGalatMuat(pesanJendelaTanggal(jendelaTanggalFo(profilRef.current)));
      } else if (e instanceof Error && e.message === PESAN_BATAS_TIKET) {
        adaDataRef.current = false;
        setGalatMuat(PESAN_BATAS_TIKET);
      } else if (adaDataRef.current) {
        // Muat ulang senyap gagal: data lama tetap tampil, diberi catatan (tanpa toast tiap 30 dtk).
        setGalatSegar(true);
      } else {
        setGalatMuat('Antrean tidak dapat dimuat. Periksa koneksi Anda lalu coba lagi.');
      }
    } finally {
      if (muatan === muatanRef.current) {
        setLoading(false);
        setMenyegarkan(false);
      }
    }
  }

  // Kontrak §6.3: catatan eskalasi FO per tiket = baris penanganan tahap asal. Kegagalan memuat catatan tidak boleh
  // menggagalkan daftar antrean (catatan hanya pelengkap tampilan).
  async function muatCatatanEskalasi(supabase: ReturnType<typeof createClient>, baris: AntrianRow[]) {
    const ids = Array.from(new Set(baris.map((b) => b.penanganan_asal_id).filter((v): v is string => !!v)));
    if (ids.length === 0) {
      setCatatanEskalasi({});
      return;
    }
    try {
      const { data, error } = await supabase
        .from('penanganan')
        .select('id, topik, catatan, penangan:penangan_id(nama)')
        .in('id', ids);
      if (error) throw error;
      const peta: Record<string, CatatanEskalasi> = {};
      for (const r of (data ?? []) as unknown as Array<{
        id: string; topik: string | null; catatan: string | null; penangan: { nama: string } | { nama: string }[] | null;
      }>) {
        const fo = Array.isArray(r.penangan) ? r.penangan[0] : r.penangan;
        peta[r.id] = { topik: r.topik, catatan: r.catatan, foNama: fo?.nama ?? null };
      }
      setCatatanEskalasi(peta);
    } catch (e) {
      console.error('Gagal memuat catatan eskalasi:', e);
      setCatatanEskalasi({});
    }
  }

  // Status Pesan Perilaku tiket selesai (view v_survei_status), sekali per muat data. Pelengkap: kegagalan memuatnya tidak
  // boleh menggagalkan daftar antrean (lencana tidak ditampilkan alih-alih menampilkan status keliru).
  async function muatStatusSurvei(supabase: ReturnType<typeof createClient>, baris: AntrianRow[]) {
    const ids = baris.filter((b) => b.status === 'selesai' && b.kunjungan_id).map((b) => b.kunjungan_id);
    if (ids.length === 0) {
      setStatusSurvei(new Map());
      return;
    }
    try {
      setStatusSurvei(await ambilStatusSurvei(supabase, ids));
    } catch (e) {
      console.error('Gagal memuat status Pesan Perilaku:', e);
      setStatusSurvei(new Map());
    }
  }

  // Setelah tiket diselesaikan: buka dialog QR secara spekulatif; dialog menutup dirinya bila kunjungan belum selesai
  // (mis. masih ada tahap lain) sehingga tidak ada QR yang salah tampil.
  const bukaQrTiket = (tiketId: string | null) => {
    const kunjunganId = (antrian.find((a) => a.id === tiketId) ?? antrianPanel.find((a) => a.id === tiketId))?.kunjungan_id;
    if (kunjunganId) setQrKunjunganId(kunjunganId);
  };

  // Tiap panggilan sukses = satu kejadian baru di layar TV (pita + bunyi). Panggil ulang sengaja diizinkan berkali-kali;
  // kunci hanya selama request berjalan dan JEDA_PANGGIL_MS agar klik ganda tak sengaja tidak jadi dua panggilan.
  const lepasPanggil = (tiketId: string) => {
    panggilRef.current.delete(tiketId);
    setSedangPanggil(new Set(panggilRef.current));
  };
  // Mengembalikan true bila panggilan tersiar ke layar TV (dipakai Panel Sekarang untuk menandai "Sudah dipanggil").
  const handlePanggil = async (tiketId: string, nomorDisplay: string): Promise<boolean> => {
    if (panggilRef.current.has(tiketId)) return false;
    panggilRef.current.add(tiketId);
    setSedangPanggil(new Set(panggilRef.current));
    const mulai = Date.now();
    let berhasil = false;
    try {
      const supabase = createClient();
      // panggil_tiket mengembalikan nomor_display, atau NULL TANPA error bila tiket bukan 'menunggu'
      // (sudah dilayani/batal/dst.) -> tak ada kejadian ke layar TV. NULL (array kosong) = tidak dipanggil.
      const dipanggil = await mutasiInsert(supabase.rpc('panggil_tiket', { p_tiket_id: tiketId }));
      if (dipanggil.length === 0) {
        toast(`${nomorDisplay} tidak dipanggil: tiket sudah tidak berstatus menunggu. Daftar dimuat ulang.`, 'error');
        await muatSenyap();
        return false;
      }
      berhasil = true;
      toast(`Memanggil ${nomorDisplay}…`, 'success');
    } catch (e) {
      console.error('Gagal memanggil tiket:', e);
      toast(`Gagal memanggil ${nomorDisplay}. ${pesanMutasi(e)}`, 'error');
    } finally {
      // Gagal = langsung bisa dicoba lagi; sukses = tahan sampai jeda habis.
      const sisa = berhasil ? Math.max(0, JEDA_PANGGIL_MS - (Date.now() - mulai)) : 0;
      if (sisa === 0) lepasPanggil(tiketId);
      else setTimeout(() => lepasPanggil(tiketId), sisa);
    }
    return berhasil;
  };

  // Kunci tombol per tiket selama request berjalan (mencegah klik ganda / dua aksi bersamaan pada tiket yang sama).
  const jalankanAksi = async (tiketId: string, label: string, aksi: () => Promise<void>) => {
    if (prosesRef.current.has(tiketId)) return;
    prosesRef.current.add(tiketId);
    setSedangProses(new Set(prosesRef.current));
    setPengumuman(label);
    try {
      await aksi();
    } finally {
      prosesRef.current.delete(tiketId);
      setSedangProses(new Set(prosesRef.current));
      setPengumuman('');
    }
  };

  // Galat RPC antrean -> pesan jelas; muat ulang bila tampilan kemungkinan basi.
  const tanganiGalatAksi = async (e: unknown, awalan: string) => {
    const kode = kodeGalatDariError(e);
    if (kode === 'SUDAH_DIAMBIL') {
      toast(PESAN_GALAT_ANTREAN.SUDAH_DIAMBIL, 'error');
    } else {
      toast(`${awalan} ${kode ? PESAN_GALAT_ANTREAN[kode] : pesanMutasi(e)}`, 'error');
    }
    if (perluMuatUlang(e) || (kode !== null && KODE_MUAT_ULANG.has(kode))) await muatSenyap();
  };

  // A3: rpc layanan_mulai (atomik). Pemenang menjadi pemilik tiket (dilayani_oleh).
  const handleMulaiLayanan = (a: AntrianRow) =>
    jalankanAksi(a.id, `Memulai layanan ${a.nomor_display}…`, async () => {
      try {
        const supabase = createClient();
        // Balasan jsonb tunggal; kosong/null tanpa error dianggap gagal (mutasiWajibBaris).
        const [hasil] = await mutasiWajibBaris<HasilMulai>(
          supabase.rpc('layanan_mulai', { p_tiket_id: a.id }),
        );
        toast(hasil?.sudah_milik_anda ? 'Layanan tiket ini sudah Anda mulai sebelumnya' : 'Layanan dimulai', 'success');
        await muatSenyap();
        // Buka wizard pendataan untuk layanan yang didukung (Helpdesk OSS / Non OSS).
        // Layanan lain (mis. P4 / investasi) tidak punya form pendataan.
        if (punyaPendataan(a)) {
          setActiveWizardTiketId(a.id);
        } else {
          toast('Layanan ini tidak memiliki form pendataan', 'info');
        }
      } catch (e) {
        console.error('Gagal memulai layanan:', e);
        await tanganiGalatAksi(e, 'Gagal memulai layanan.');
      }
    });

  const handleSelesaikan = (a: AntrianRow) => {
    if (punyaPendataan(a)) {
      // Wizard pendataan. Tiket hasil eskalasi: cukup Pendataan (tanpa topik/catatan; 202610140015).
      setActiveWizardTiketId(a.id);
      return Promise.resolve();
    }
    if (tiketHasilEskalasi(a)) {
      // Tiket hasil eskalasi tanpa pendataan: dialog topik + catatan wajib (layanan_selesai 5 parameter).
      setSelesaiEskalasiTiket({ id: a.id, nomor_display: a.nomor_display, layanan_id: a.layanan_id });
      return Promise.resolve();
    }
    // A3: rpc layanan_selesai tanpa pendataan; hanya pemilik tiket (ditegakkan DB: BUKAN_PEMILIK).
    return jalankanAksi(a.id, `Menyelesaikan ${a.nomor_display}…`, async () => {
      try {
        const supabase = createClient();
        await mutasiWajibBaris(supabase.rpc('layanan_selesai', { p_tiket_id: a.id }));
        toast('Kunjungan berhasil diselesaikan', 'success');
        bukaQrTiket(a.id);
        await muatSenyap();
      } catch (e) {
        console.error('Gagal menyelesaikan antrean:', e);
        await tanganiGalatAksi(e, 'Gagal menyelesaikan antrean.');
      }
    });
  };

  const resolveKunjungan = (a: AntrianRow): KunjunganEmbed | null => {
    if (!a.kunjungan) return null;
    return Array.isArray(a.kunjungan) ? a.kunjungan[0] ?? null : a.kunjungan;
  };

  const resolvePelayanNama = (a: AntrianRow): string | null => {
    if (!a.pelayan) return null;
    return (Array.isArray(a.pelayan) ? a.pelayan[0]?.nama : a.pelayan.nama) ?? null;
  };

  // Layanan wajib Formulir Pendataan: kolom DB layanan.form_pendataan (fallback nama bila kolom tak ter-select).
  const punyaPendataan = (a: AntrianRow): boolean =>
    formPendataanLayanan(Array.isArray(a.layanan) ? a.layanan[0] : a.layanan) !== null;

  const resolveLayananNama = (a: AntrianRow): string => {
    if (!a.layanan) return '—';
    if (Array.isArray(a.layanan)) return a.layanan[0]?.nama ?? '—';
    return (a.layanan as { nama: string }).nama ?? '—';
  };

  const layananNamaHeader = (() => {
    const l = currentUser?.layanan;
    if (!l) return null;
    if (Array.isArray(l)) return l[0]?.nama;
    return (l as { nama: string }).nama;
  })();

  const headerTitle = currentUser?.role === 'petugas' && layananNamaHeader
    ? `Antrean ${layananNamaHeader}`
    : 'Antrean Semua Layanan';

  const statusLabel = (status: string) => {
    switch (status) {
      case 'menunggu': return 'Menunggu';
      case 'dilayani': return 'Dilayani';
      case 'selesai': return 'Selesai';
      case 'tidak_terlayani': return 'Tidak terlayani (petugas tidak hadir)';
      case 'no_show': return 'Tidak datang (warga)';
      case 'batal': return 'Batal';
      case 'dikembalikan': return 'Dikembalikan ke FO';
      case 'dialihkan': return 'Dialihkan';
      default: return status;
    }
  };

  const asalLabel = (asal: string) => (asal === 'reservasi' ? 'Reservasi' : 'Walk-in');
  const isAdminLike = currentUser?.role === 'admin' || currentUser?.role === 'front_office';

  // ── Rekap Absen: load saat section dibuka atau tanggal berubah ────────────
  const fetchRekapAbsensi = async () => {
    if (!currentUser?.layanan_id && currentUser?.role === 'petugas') return;
    setRekapLoading(true);
    try {
      const supabase = createClient();
      let query = supabase
        .from('absensi_petugas')
        .select(`id, petugas_id, tanggal, jam_masuk, jam_pulang, status, petugas:petugas_id(nama)`)
        .eq('tanggal', tanggal)
        .order('jam_masuk', { ascending: true });
      // Petugas & admin/FO: filter ke layanan_id kalau bukan admin/FO
      if (currentUser?.role === 'petugas' && currentUser.layanan_id) {
        // join via petugas tabel: filter by layanan_id
        query = query.eq('petugas.layanan_id' as never, currentUser.layanan_id);
      }
      const { data } = await query;
      const normalized = (data ?? []).map(d => ({
        ...d,
        petugas: Array.isArray(d.petugas) ? (d.petugas[0] ?? null) : d.petugas,
      })) as AbsensiRekap[];
      setRekapAbsensi(normalized);
    } finally {
      setRekapLoading(false);
    }
  };

  const handleDownloadAbsenCsv = () => {
    const layananLabel = layananNamaHeader ?? 'semua_layanan';
    const rowsAbsen = rekapAbsensi.map((a) => ({
      tanggal: a.tanggal,
      nama_petugas: a.petugas?.nama ?? '',
      jam_masuk: a.jam_masuk ? formatWaktu(a.jam_masuk) : '',
      jam_pulang: a.jam_pulang ? formatWaktu(a.jam_pulang) : '',
      status:
        a.status === 'approved' ? 'Disetujui'
        : a.status === 'pending' ? 'Menunggu'
        : a.status === 'ditolak' ? 'Ditolak'
        : 'Alpa',
    }));
    const rows_csv = toCsv(
      [
        { key: 'tanggal', label: 'Tanggal' },
        { key: 'nama_petugas', label: 'Nama Petugas' },
        { key: 'jam_masuk', label: 'Jam Masuk' },
        { key: 'jam_pulang', label: 'Jam Pulang' },
        { key: 'status', label: 'Status' },
      ],
      rowsAbsen,
    );
    const blob = new Blob([`﻿${rows_csv}`], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daftar_hadir_${layananLabel.replace(/\s+/g, '_')}_${tanggal}.csv`;
    a.click();
  };

  // FO non-Koordinator hanya boleh membuka [hari ini-7, hari ini+1] (server menegakkan; di sini mencegah galat).
  const jendelaFo = jendelaTanggalFo(currentUser);
  const ubahTanggal = (nilai: string) => {
    if (!nilai) return; // kolom dikosongkan: pertahankan tanggal yang tampil
    if (!tanggalDalamJendela(nilai, jendelaFo)) {
      setPesanTanggal(pesanJendelaTanggal(jendelaFo));
      return;
    }
    setPesanTanggal(null);
    setTanggal(nilai);
    setPage(0);
    tulisUrl({ tanggal: nilai, status: filterStatus, halaman: 0 });
  };
  const gantiStatus = (kunci: string) => {
    const status = kunci as FilterStatus;
    if (status === filterStatus) return;
    setFilterStatus(status);
    setPage(0);
    tulisUrl({ tanggal, status, halaman: 0 });
  };
  const gantiHalaman = (p: number) => {
    setPage(p);
    tulisUrl({ tanggal, status: filterStatus, halaman: p });
  };

  // ── Turunan murni dari data yang sudah dimuat ─────────────────────────────
  const barisTampil = antrian;
  const hariIni = todayWIB();

  // Panel Sekarang (A1): hanya untuk hari ini dan saat tab bukan "Selesai" (data panel terpisah dari halaman tabel).
  const tampilPanel = !unassigned && !galatMuat && !loading && tanggal === hariIni && filterStatus !== 'selesai';
  const opsiLayananPanel: OpsiLayananPanel[] = (() => {
    const peta = new Map<string, string>();
    for (const a of antrianPanel) if (a.status === 'menunggu') peta.set(a.layanan_id, resolveLayananNama(a));
    return Array.from(peta, ([id, nama]) => ({ id, nama })).sort((x, y) => x.nama.localeCompare(y.nama, 'id'));
  })();
  const layananPanelAktif = opsiLayananPanel.some((o) => o.id === panelLayananId)
    ? panelLayananId
    : (opsiLayananPanel[0]?.id ?? null);
  const keTiketPanel = (a: AntrianRow, waktu: string | null): TiketPanel => ({
    id: a.id,
    nomor_display: a.nomor_display,
    layananNama: resolveLayananNama(a),
    namaPengunjung: resolveKunjungan(a)?.nama ?? '—',
    waktu,
    bolehMulai: bolehMulaiTiket(currentUser, a),
    bolehSelesai: bolehSelesaikanTiket(currentUser, a),
  });
  const barisSaya = antrianPanel.find((a) => bolehSelesaikanTiket(currentUser, a));
  const barisBerikutnya = antrianPanel
    .filter((a) => a.status === 'menunggu' && a.layanan_id === layananPanelAktif)
    .sort((x, y) => x.nomor - y.nomor)[0];
  const panelSedangDilayani = barisSaya ? keTiketPanel(barisSaya, barisSaya.waktu_mulai_layan) : null;
  const panelBerikutnya = barisBerikutnya
    ? keTiketPanel(barisBerikutnya, resolveKunjungan(barisBerikutnya)?.waktu_masuk ?? barisBerikutnya.waktu_terbit)
    : null;
  const barisDariPanel = (t: TiketPanel) => antrianPanel.find((a) => a.id === t.id);

  // ── Kolom tabel ───────────────────────────────────────────────────────────
  const renderNama = (a: AntrianRow) => {
    const k = resolveKunjungan(a);
    const catatanFo = a.penanganan_asal_id ? catatanEskalasi[a.penanganan_asal_id] : undefined;
    return (
      <>
        <span className={styles.nama}>{k?.nama ?? '—'}</span>
        {tiketHasilEskalasi(a) && (
          <div className={styles.eskalasi}>
            <strong className={styles.eskalasiJudul}>
              <MessageSquare size={12} aria-hidden="true" /> Eskalasi dari Front Office
            </strong>
            {catatanFo?.topik && <div>Topik: {catatanFo.topik}</div>}
            {catatanFo?.catatan && <div className={styles.catatanFo}>{catatanFo.catatan}</div>}
            {catatanFo?.foNama && <div className={styles.oleh}>oleh {catatanFo.foNama}</div>}
          </div>
        )}
      </>
    );
  };

  const renderStatus = (a: AntrianRow) => {
    const milikSaya = bolehSelesaikanTiket(currentUser, a);
    const pelayanNama = resolvePelayanNama(a);
    return (
      <>
        <Lencana nada={NADA_STATUS[a.status] ?? 'netral'}>{statusLabel(a.status)}</Lencana>
        {a.status === 'dilayani' && (
          <small className={styles.sekunder}>{milikSaya ? 'oleh Anda' : `oleh ${pelayanNama ?? 'petugas lain'}`}</small>
        )}
      </>
    );
  };

  const renderAksi = (a: AntrianRow) => {
    const k = resolveKunjungan(a);
    const waktuMasuk = k?.waktu_masuk ?? a.waktu_terbit;
    let durasi = '—';
    if (a.waktu_selesai) {
      const start = a.waktu_mulai_layan
        ? new Date(a.waktu_mulai_layan).getTime()
        : new Date(waktuMasuk || new Date().toISOString()).getTime();
      const diff = Math.round((new Date(a.waktu_selesai).getTime() - start) / 60000);
      durasi = `${diff} menit`;
    }
    const layananNama = resolveLayananNama(a);
    const pelayanNama = resolvePelayanNama(a);
    const milikSaya = bolehSelesaikanTiket(currentUser, a);
    const sibuk = sedangProses.has(a.id);
    const tombolAlihkan = bolehAlihkanTiket(currentUser, a) && (
      <Tombol
        varian="sekunder"
        ukuran="kecil"
        ikon={ArrowRightLeft}
        onClick={() =>
          setAlihkanTiket({ id: a.id, nomor_display: a.nomor_display, layanan_id: a.layanan_id, layanan_nama: layananNama })
        }
        disabled={sibuk}
        aria-label={`Alihkan tiket ${a.nomor_display} ke layanan lain`}
        title="Pindahkan tiket ini ke layanan lain (Admin; wajib alasan, tercatat di audit)"
      >
        Alihkan
      </Tombol>
    );

    if (a.status === 'menunggu') {
      return (
        <div className={styles.aksi}>
          {/* QUE-17: panggil ulang — emit nomor_dipanggil event */}
          <Tombol
            varian="hantu"
            ukuran="kecil"
            ikon={sedangPanggil.has(a.id) ? BellRing : Volume2}
            onClick={() => handlePanggil(a.id, a.nomor_display)}
            disabled={sedangPanggil.has(a.id)}
            title="Panggil ke layar antrean. Bisa diklik lagi untuk memanggil ulang."
          >
            {sedangPanggil.has(a.id) ? 'Terpanggil' : 'Panggil'}
          </Tombol>
          {/* Keputusan CEO 7.5: tidak ada "Lengkapi Data" sebelum Mulai Layanan. Draf pendataan
              hanya ditulis pemilik tiket yang sedang dilayani (wizard terbuka otomatis setelah Mulai). */}
          {bolehMulaiTiket(currentUser, a) && (
            <Tombol
              varian="utama"
              ukuran="kecil"
              ikon={Play}
              onClick={() => handleMulaiLayanan(a)}
              disabled={sibuk}
              memuat={sibuk}
            >
              {sibuk ? 'Memproses…' : 'Mulai Layanan'}
            </Tombol>
          )}
          {tombolAlihkan}
        </div>
      );
    }

    if (a.status === 'dilayani') {
      if (milikSaya) {
        return (
          <div className={styles.aksi}>
            {punyaPendataan(a) && (
              <Tombol varian="utama" ukuran="kecil" ikon={FileEdit} onClick={() => setActiveWizardTiketId(a.id)} disabled={sibuk}>
                Form Pendataan
              </Tombol>
            )}
            <Tombol
              varian="sekunder"
              ukuran="kecil"
              ikon={CheckCircle2}
              onClick={() => handleSelesaikan(a)}
              disabled={sibuk}
              memuat={sibuk}
            >
              {sibuk ? 'Memproses…' : 'Selesai'}
            </Tombol>
            {bolehKembalikanTiket(currentUser, a) && (
              <Tombol
                varian="hantu"
                ukuran="kecil"
                ikon={Undo2}
                onClick={() =>
                  setKembalikanTiket({ id: a.id, nomor_display: a.nomor_display, layanan_id: a.layanan_id })
                }
                disabled={sibuk}
                aria-label={`Kembalikan tiket ${a.nomor_display} ke Front Office`}
                title="Kembalikan pengunjung ke kotak masuk Front Office (wajib catatan)"
              >
                Kembalikan ke FO
              </Tombol>
            )}
            {tombolAlihkan}
          </div>
        );
      }
      return (
        <div className={styles.aksiKolom}>
          <small className={styles.catatanAksi}>
            Hanya {pelayanNama ?? 'petugas yang memulai'} yang dapat menyelesaikan tiket ini.
          </small>
          <div className={styles.aksi}>
            {punyaPendataan(a) && (
              <Tombol varian="hantu" ukuran="kecil" ikon={FileText} onClick={() => setActiveWizardTiketId(a.id)}>
                Lihat Data
              </Tombol>
            )}
            {(bolehAmbilAlihTiket(currentUser, a) || bolehKoordinatorAmbilAlihTiket(currentUser, a)) && (
              <Tombol
                varian="sekunder"
                ukuran="kecil"
                ikon={UserCog}
                onClick={() => {
                  setModeAmbilAlih(bolehAmbilAlihTiket(currentUser, a) ? 'admin' : 'koordinator_tiket');
                  setAmbilAlihTiket({ id: a.id, nomor_display: a.nomor_display, pemilik_nama: pelayanNama });
                }}
                disabled={sibuk}
                title={bolehAmbilAlihTiket(currentUser, a)
                  ? 'Darurat: jadikan Anda penanggung jawab tiket ini (wajib alasan, tercatat di audit)'
                  : 'Koordinator: ambil alih pendataan ini (wajib alasan, tercatat di audit; petugas semula diberi tahu)'}
              >
                Ambil alih
              </Tombol>
            )}
            {tombolAlihkan}
          </div>
        </div>
      );
    }

    return (
      <div className={styles.aksiKolom}>
        <span className={styles.durasi}>{durasi}</span>
        {punyaPendataan(a) && (
          <Tombol varian="hantu" ukuran="kecil" ikon={FileText} onClick={() => setActiveWizardTiketId(a.id)}>
            Lihat Data
          </Tombol>
        )}
        {a.status === 'selesai' && statusSurvei.get(a.kunjungan_id) && (
          <div className={styles.surveiBaris}>
            <small className={styles.surveiLabel}>Pesan Perilaku</small>
            <SurveiStatusBadge status={statusSurvei.get(a.kunjungan_id) as StatusSurvei} />
            {statusSurvei.get(a.kunjungan_id) === 'belum_diisi' && (
              <Tombol
                varian="sekunder"
                ukuran="kecil"
                ikon={QrCode}
                onClick={() => setQrKunjunganId(a.kunjungan_id)}
                aria-label={`Tampilkan QR Pesan Perilaku tiket ${a.nomor_display}`}
              >
                Tampilkan QR
              </Tombol>
            )}
          </div>
        )}
        {a.status === 'selesai' && punyaPendataan(a) && (
          isAdminLike ? (
            <Tombol
              varian="sekunder"
              ukuran="kecil"
              ikon={Pencil}
              onClick={() => setKoreksiTiketId(a.id)}
              title="Koreksi data yang sudah dikunci (wajib alasan, tercatat di riwayat)"
            >
              Koreksi Data
            </Tombol>
          ) : currentUser?.role === 'petugas' && (
            <small className={styles.catatanAksi}>
              Data sudah dikunci. Hubungi Front Office atau Admin untuk koreksi.
            </small>
          )
        )}
      </div>
    );
  };

  const kolomTiket: KolomTabel<AntrianRow>[] = [
    {
      kunci: 'nomor',
      judul: 'No. Tiket',
      peran: 'utama',
      render: (a) => <span className={styles.nomor}>{a.nomor_display}</span>,
    },
    ...(isAdminLike
      ? [{ kunci: 'layanan', judul: 'Layanan', render: (a: AntrianRow) => <span className={styles.layanan}>{resolveLayananNama(a)}</span> }]
      : []),
    { kunci: 'nama', judul: 'Nama', render: renderNama },
    {
      kunci: 'asal',
      judul: 'Asal',
      render: (a) => {
        const asal = resolveKunjungan(a)?.asal ?? 'walk_in';
        return <Lencana nada={asal === 'reservasi' ? 'info' : 'netral'}>{asalLabel(asal)}</Lencana>;
      },
    },
    ...(aksesFo
      ? [{ kunci: 'fo', judul: 'Front Office', render: (a: AntrianRow) => a.fo_nama ?? '—' }]
      : []),
    {
      kunci: 'waktu',
      judul: 'Waktu Masuk',
      render: (a) => {
        const waktuMasuk = resolveKunjungan(a)?.waktu_masuk ?? a.waktu_terbit;
        return <span className={styles.waktu}>{waktuMasuk ? formatWaktu(waktuMasuk) : '—'}</span>;
      },
    },
    { kunci: 'status', judul: 'Status', render: renderStatus },
    { kunci: 'aksi', judul: 'Aksi / Durasi', peran: 'aksi', render: renderAksi },
  ];

  const kolomAbsen: KolomTabel<AbsensiRekap>[] = [
    { kunci: 'nama', judul: 'Nama Petugas', peran: 'utama', render: (a) => <span className={styles.nama}>{a.petugas?.nama ?? '—'}</span> },
    { kunci: 'masuk', judul: 'Jam Masuk', render: (a) => (a.jam_masuk ? formatWaktu(a.jam_masuk) : '—') },
    { kunci: 'pulang', judul: 'Jam Pulang', render: (a) => (a.jam_pulang ? formatWaktu(a.jam_pulang) : '—') },
    {
      kunci: 'status',
      judul: 'Status',
      render: (a) =>
        a.status === 'approved' ? <Lencana nada="sukses">Disetujui</Lencana>
        : a.status === 'pending' ? <Lencana nada="peringatan">Menunggu</Lencana>
        : a.status === 'ditolak' ? <Lencana nada="netral">Ditolak</Lencana>
        : <Lencana nada="bahaya">Alpa</Lencana>,
    },
  ];

  // Keadaan kosong: beda antara "memang kosong" dan "kosong karena saringan status".
  const kosongTabel = (() => {
    if (filterStatus === 'semua') {
      return <StatusKosong ikon={Users} judul="Belum Ada Antrean" isi="Belum ada tiket untuk tanggal ini." />;
    }
    return (
      <StatusKosong
        ikon={Users}
        judul={filterStatus === 'aktif' ? 'Tidak ada antrean aktif' : 'Belum ada tiket selesai'}
        isi={filterStatus === 'aktif'
          ? 'Tidak ada tiket menunggu atau sedang dilayani pada tanggal ini. Lihat tab Selesai atau Semua.'
          : 'Belum ada tiket yang selesai pada tanggal ini. Lihat tab Aktif atau Semua.'}
      />
    );
  })();

  const metaKepala = (
    <>
      {tanggalPanjang(tanggal)}
      {terakhir && <> · Data terakhir {formatWaktu(terakhir)} WIB</>}
    </>
  );

  return (
    <>
      <PageHeader
        title={headerTitle}
        description="Urutan kedatangan harian: walk-in dan reservasi (setelah scan)"
        meta={metaKepala}
      >
        <div className={styles.aksiKepala}>
          <WalkinWizard
            fixedLayananId={currentUser?.role === 'petugas' ? currentUser.layanan_id : null}
            onSuccess={muatSenyap}
            triggerLabel="+ Walk-in"
            triggerClassName="btn btn--primary btn--sm"
          />
          <PemilihTanggal
            nilai={tanggal}
            onUbah={ubahTanggal}
            label="Tanggal antrean"
            min={jendelaFo?.min}
            max={jendelaFo?.max}
            aria-describedby={pesanTanggal ? 'pesan-tanggal-antrian' : undefined}
          />
        </div>
      </PageHeader>

      <div className={styles.halaman}>
        <CalendarBanner />
        {pesanTanggal && (
          <CatatanKeadaan jenis="galat" judul="Tanggal di luar batas">
            <span id="pesan-tanggal-antrian">{pesanTanggal}</span>
          </CatatanKeadaan>
        )}
        <PemberitahuanAmbilAlih petugasId={currentUser?.id} />
        {currentUser?.role === 'petugas' && layananNamaHeader && (
          <RoleNote>
            Anda melayani antrean {layananNamaHeader}. Pengunjung layanan lain diatur Front Office.
          </RoleNote>
        )}
        {unassigned ? (
          <Kartu>
            <StatusKosong
              ikon={AlertCircle}
              judul="Belum Ditugaskan"
              isi="Akun Anda belum ditugaskan ke layanan. Hubungi admin."
            />
          </Kartu>
        ) : (
          <>
            {tampilPanel && (
              <PanelSekarang
                sedangDilayani={panelSedangDilayani}
                berikutnya={panelBerikutnya}
                layananOpsi={isAdminLike ? opsiLayananPanel : []}
                layananId={layananPanelAktif}
                onLayananChange={setPanelLayananId}
                sedangPanggil={(id) => sedangPanggil.has(id)}
                sedangProses={(id) => sedangProses.has(id)}
                onPanggil={(t) => handlePanggil(t.id, t.nomor_display)}
                onMulai={(t) => {
                  const a = barisDariPanel(t);
                  return a ? handleMulaiLayanan(a) : undefined;
                }}
                onSelesai={(t) => {
                  const a = barisDariPanel(t);
                  return a ? handleSelesaikan(a) : undefined;
                }}
                tanpaTiketSaya={currentUser?.role === 'front_office'}
              />
            )}

            {/* Statistik (disembunyikan saat galat muat awal: angka nol palsu lebih menyesatkan daripada kosong) */}
            {!galatMuat && (
              <div className={styles.statistik}>
                <KartuStatistik label="Total Tiket" nilai={totalHarian} ikon={Users} memuat={loading} />
                <KartuStatistik label="Selesai Dilayani" nilai={serverStats.totalSelesai} ikon={TrendingUp} memuat={loading} />
                <KartuStatistik label="Rata-rata Durasi" nilai={`${serverStats.rataWaktuMenit} mnt`} ikon={Clock} memuat={loading} />
              </div>
            )}

            {/* ── Rekapitulasi Absen ── */}
            <Kartu padding="tanpa" as="section">
              <button
                type="button"
                className={styles.rekapToggle}
                aria-expanded={rekapOpen}
                aria-controls="rekap-absen-isi"
                onClick={async () => {
                  const next = !rekapOpen;
                  setRekapOpen(next);
                  if (next) await fetchRekapAbsensi();
                }}
              >
                <span className={styles.rekapJudul}>
                  <UserCheck size={16} strokeWidth={1.75} aria-hidden="true" />
                  Rekapitulasi Absen — {tanggalPanjang(tanggal)}
                  {rekapAbsensi.length > 0 && <Lencana nada="primer">{rekapAbsensi.length} petugas</Lencana>}
                </span>
                {rekapOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              </button>
              {rekapOpen && (
                <div id="rekap-absen-isi" className={styles.rekapIsi}>
                  <div className={styles.rekapAlat}>
                    <Tombol varian="hantu" ukuran="kecil" ikon={Download} onClick={handleDownloadAbsenCsv} disabled={rekapAbsensi.length === 0}>
                      Unduh CSV
                    </Tombol>
                  </div>
                  {rekapLoading ? (
                    <Skeleton bentuk="baris" jumlah={3} label="Memuat rekapitulasi absen…" />
                  ) : rekapAbsensi.length === 0 ? (
                    <p className={styles.rekapCatatan}>Belum ada catatan absensi untuk tanggal ini.</p>
                  ) : (
                    <Tabel
                      kolom={kolomAbsen}
                      baris={rekapAbsensi}
                      kunciBaris="id"
                      caption="Rekapitulasi absen petugas"
                      padat
                      kartuDiHp
                    />
                  )}
                </div>
              )}
            </Kartu>

            {galatSegar && !galatMuat && (
              <CatatanKeadaan
                jenis="info"
                aksi={
                  <Tombol varian="hantu" ukuran="kecil" onClick={() => muatSenyap()} disabled={menyegarkan} memuat={menyegarkan}>
                    {menyegarkan ? 'Memuat…' : 'Muat ulang'}
                  </Tombol>
                }
              >
                Pembaruan terakhir gagal; data di bawah mungkin belum terbaru.
                {terakhir && <> Terakhir diperbarui {formatWaktu(terakhir)} WIB.</>}
              </CatatanKeadaan>
            )}

            {/* Daftar antrean */}
            <Kartu padding="tanpa" as="section">
              <div className={styles.alatTabel}>
                <Tab
                  id="antrian-status"
                  label="Saringan status antrean"
                  aktif={filterStatus}
                  onGanti={gantiStatus}
                  tab={TAB_STATUS}
                />
              </div>
              <PanelTab idTab="antrian-status" kunci={filterStatus} aktif={filterStatus}>
                {galatMuat ? (
                  <div className={styles.tidakAda}>
                    <Galat pesan={galatMuat} onRetry={() => fetchData()} memuat={loading} />
                  </div>
                ) : (
                  <div aria-busy={menyegarkan || undefined}>
                    <Tabel
                      kolom={kolomTiket}
                      baris={barisTampil}
                      kunciBaris="id"
                      caption={`Daftar antrean ${tanggalPanjang(tanggal)}, tab ${LABEL_FILTER[filterStatus]}`}
                      memuat={loading}
                      kartuDiHp
                      kosong={kosongTabel}
                    />
                    {!loading && (
                      <Pagination page={page} pageSize={PAGE_SIZE} total={totalCount} onPageChange={gantiHalaman} />
                    )}
                  </div>
                )}
              </PanelTab>
            </Kartu>
          </>
        )}
      </div>

      <p role="status" aria-live="polite" className="sr-only">{pengumuman}</p>

      {ambilAlihTiket && (
        <AmbilAlihTiketModal
          key={ambilAlihTiket.id}
          tiket={ambilAlihTiket}
          mode={modeAmbilAlih}
          onClose={() => setAmbilAlihTiket(null)}
          onSuccess={muatSenyap}
        />
      )}

      {alihkanTiket && (
        <AlihkanTiketModal
          key={alihkanTiket.id}
          tiket={alihkanTiket}
          onClose={() => setAlihkanTiket(null)}
          onSuccess={muatSenyap}
        />
      )}

      {kembalikanTiket && (
        <KembalikanKeFoModal
          key={kembalikanTiket.id}
          tiket={kembalikanTiket}
          onClose={() => setKembalikanTiket(null)}
          onSuccess={muatSenyap}
        />
      )}

      {selesaiEskalasiTiket && (
        <SelesaiEskalasiModal
          key={selesaiEskalasiTiket.id}
          tiket={selesaiEskalasiTiket}
          onClose={() => setSelesaiEskalasiTiket(null)}
          onSuccess={async () => {
            // Dipanggil juga setelah galat "tampilan basi"; dialog QR menutup sendiri bila tidak ada token.
            bukaQrTiket(selesaiEskalasiTiket.id);
            await muatSenyap();
          }}
        />
      )}

      <KoreksiPelayananModal
        isOpen={Boolean(koreksiTiketId)}
        tiketId={koreksiTiketId}
        onClose={() => setKoreksiTiketId(null)}
        onSuccess={muatSenyap}
      />

      <PelayananWizardModal
        isOpen={Boolean(activeWizardTiketId)}
        tiketId={activeWizardTiketId}
        onClose={() => setActiveWizardTiketId(null)}
        onSuccess={async () => {
          bukaQrTiket(activeWizardTiketId);
          await muatSenyap();
        }}
        onDataBasi={muatSenyap}
      />

      {qrKunjunganId && (
        <SurveiQrDialog key={qrKunjunganId} kunjunganId={qrKunjunganId} onTutup={() => setQrKunjunganId(null)} />
      )}
    </>
  );
}
