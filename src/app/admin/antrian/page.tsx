'use client';

// WP-22: Queue reads migrated from visit → tiket_antrean + kunjungan.
// A3 (migrasi 202610140002_tiket_kepemilikan): transisi status lewat RPC atomik, BUKAN UPDATE langsung visit.
//   - "Mulai Layanan" -> rpc layanan_mulai: guard atomik di tiket (satu pemenang), dilayani_oleh = pemanggil.
//   - "Selesai" (layanan tanpa pendataan) -> rpc layanan_selesai: hanya pemilik tiket (yang memulai).
//   - Layanan pendataan diselesaikan lewat PelayananWizardModal -> POST /api/admin/pelayanan/[tiketId].
//   - Admin dapat "Ambil alih" tiket yang dilayani orang lain (rpc admin_ambil_alih, alasan wajib).
// RPC menyinkronkan visit dalam transaksi yang sama (SKM/notifikasi/estimasi tetap jalan).

import { useState, useEffect, useRef } from 'react';
import { todayWIB } from '@/lib/time';
import {
  Calendar,
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
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import CalendarBanner from '@/components/admin/CalendarBanner';
import RoleNote from '@/components/admin/RoleNote';
import Pagination from '@/components/Pagination';
import WalkinWizard from '@/components/WalkinWizard';
import PelayananWizardModal from '@/components/admin/PelayananWizardModal';
import KoreksiPelayananModal from '@/components/admin/KoreksiPelayananModal';
import AmbilAlihTiketModal, { type TiketAmbilAlih } from '@/components/admin/AmbilAlihTiketModal';
import {
  isLayananPendataan,
  bolehMulaiTiket,
  bolehSelesaikanTiket,
  bolehAmbilAlihTiket,
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

const PAGE_SIZE = 25;

// Galat RPC yang berarti tampilan antrean basi (tiket berubah di tempat lain) -> muat ulang daftar.
const KODE_MUAT_ULANG: ReadonlySet<KodeGalatAntrean> = new Set<KodeGalatAntrean>([
  'SUDAH_DIAMBIL', 'BUKAN_PEMILIK', 'INVALID_STATUS', 'NOT_FOUND', 'DIVERGENSI', 'TRANSISI_LEWAT_RPC',
]);

// Teks khusus pembaca layar (pengumuman status proses), tidak tampil di layar.
const SR_ONLY: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0,
};

interface HasilMulai {
  ok: boolean;
  sudah_milik_anda?: boolean;
}

interface PetugasData {
  id: string;
  role: string;
  layanan_id: string;
  layanan?: { nama: string } | { nama: string }[];
}

interface KunjunganEmbed {
  nama: string;
  asal: 'walk_in' | 'reservasi';
  waktu_masuk: string | null;
}

interface AntrianRow {
  id: string;             // tiket_antrean.id
  legacy_visit_id: string;
  layanan_id: string;
  dilayani_oleh: string | null; // petugas.id yang memulai layanan (pemilik tiket)
  pelayan: { nama: string } | { nama: string }[] | null; // nama pemilik (RLS: petugas hanya membaca barisnya sendiri)
  nomor: number;
  nomor_display: string;
  status: 'menunggu' | 'dilayani' | 'selesai' | 'tidak_terlayani' | 'no_show' | 'batal';
  waktu_terbit: string | null;
  waktu_mulai_layan: string | null;
  waktu_selesai: string | null;
  layanan: { nama: string } | { nama: string }[] | null;
  kunjungan: KunjunganEmbed | KunjunganEmbed[] | null;
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

export default function AntrianPage() {
  const { toast } = useToast();
  const [tanggal, setTanggal] = useState(todayWIB());
  const [antrian, setAntrian] = useState<AntrianRow[]>([]);
  const [currentUser, setCurrentUser] = useState<PetugasData | null>(null);
  const [unassigned, setUnassigned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [serverStats, setServerStats] = useState<{
    totalSelesai: number;
    rataWaktuMenit: number;
  }>({ totalSelesai: 0, rataWaktuMenit: 0 });
  const [activeWizardTiketId, setActiveWizardTiketId] = useState<string | null>(null);
  const [koreksiTiketId, setKoreksiTiketId] = useState<string | null>(null);
  const [ambilAlihTiket, setAmbilAlihTiket] = useState<TiketAmbilAlih | null>(null);
  // Tiket yang sedang diproses: tombolnya dikunci sampai RPC selesai (ref = penjaga klik ganda sebelum render ulang).
  const [sedangProses, setSedangProses] = useState<ReadonlySet<string>>(new Set());
  const prosesRef = useRef<Set<string>>(new Set());
  const [pengumuman, setPengumuman] = useState('');

  // ── Rekapitulasi Absen ────────────────────────────────────────────────────
  const [rekapOpen, setRekapOpen] = useState(false);
  const [rekapAbsensi, setRekapAbsensi] = useState<AbsensiRekap[]>([]);
  const [rekapLoading, setRekapLoading] = useState(false);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tanggal, page]);

  // Fase 3: antrean menyegarkan sendiri saat ada perubahan tiket
  // (postgres_changes — staff RLS) + polling cadangan 30 dtk.
  useRealtimeRefetch(fetchData, { table: 'tiket_antrean', pollMs: 30_000 });

  async function fetchData() {
    try {
      setLoading(true);
      const supabase = createClient();

      const { data: { user } } = await supabase.auth.getUser();
      let myRole = 'admin';
      let myLayananId: string | null = null;

      if (user) {
        const { data: p } = await supabase
          .from('petugas')
          .select('id, role, layanan_id, layanan:layanan_id(nama)')
          .eq('auth_user_id', user.id)
          .single();
        if (p) {
          myRole = p.role;
          myLayananId = p.layanan_id;
          setCurrentUser(p as unknown as PetugasData);
        }
      }

      // Petugas tanpa layanan tidak boleh melihat antrian
      if (myRole === 'petugas' && !myLayananId) {
        setUnassigned(true);
        setAntrian([]);
        setTotalCount(0);
        return;
      }
      setUnassigned(false);

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // WP-22: read from tiket_antrean filtered by tanggal (date column).
      // kunjungan embedded for nama, asal, waktu_masuk.
      // Only rows with issued tickets are included — terjadwal reservations have no ticket yet.
      let query = supabase
        .from('tiket_antrean')
        .select(`
          id, legacy_visit_id, layanan_id, dilayani_oleh, nomor, nomor_display, status,
          waktu_terbit, waktu_mulai_layan, waktu_selesai,
          layanan:layanan_id(nama),
          pelayan:dilayani_oleh(nama),
          kunjungan(nama, asal, waktu_masuk)
        `, { count: 'exact' })
        .eq('tanggal', tanggal)
        .order('nomor', { ascending: true });

      if (myRole === 'petugas' && myLayananId) {
        query = query.eq('layanan_id', myLayananId);
      }

      const { data, count } = await query.range(from, to);
      setAntrian((data || []) as unknown as AntrianRow[]);
      setTotalCount(count ?? (data?.length ?? 0));

      // T-5: Stats dari server, bukan dari halaman aktif saja
      let statsQuery = supabase
        .from('tiket_antrean')
        .select('waktu_mulai_layan, waktu_selesai', { count: 'exact' })
        .eq('tanggal', tanggal)
        .eq('status', 'selesai');

      if (myRole === 'petugas' && myLayananId) {
        statsQuery = statsQuery.eq('layanan_id', myLayananId);
      }

      const { data: statsData, count: selesaiCount } = await statsQuery;
      const selesaiRows = statsData ?? [];
      const totalDurasiMenit = selesaiRows.reduce((sum, row) => {
        if (!row.waktu_selesai || !row.waktu_mulai_layan) return sum;
        return sum + (new Date(row.waktu_selesai).getTime() - new Date(row.waktu_mulai_layan).getTime()) / 60000;
      }, 0);
      setServerStats({
        totalSelesai: selesaiCount ?? selesaiRows.length,
        rataWaktuMenit: selesaiRows.length > 0 ? Math.round(totalDurasiMenit / selesaiRows.length) : 0,
      });
    } catch (e) {
      console.error(e);
      toast('Gagal memuat data antrian', 'error');
    } finally {
      setLoading(false);
    }
  }

  // WP-23 QUE-17: emit nomor_dipanggil event via panggil_tiket RPC.
  const handlePanggil = async (tiketId: string, nomorDisplay: string) => {
    try {
      const supabase = createClient();
      // panggil_tiket mengembalikan nomor_display, atau NULL TANPA error bila tiket bukan 'menunggu'
      // (sudah dilayani/batal/dst.) -> tak ada event ke layar TV. NULL (array kosong) = tidak dipanggil.
      const dipanggil = await mutasiInsert(supabase.rpc('panggil_tiket', { p_tiket_id: tiketId }));
      if (dipanggil.length === 0) {
        toast(`${nomorDisplay} tidak dipanggil: tiket sudah tidak berstatus menunggu. Daftar dimuat ulang.`, 'error');
        await fetchData();
        return;
      }
      toast(`Memanggil ${nomorDisplay}…`, 'success');
    } catch (e) {
      console.error('Gagal memanggil tiket:', e);
      toast(`Gagal memanggil ${nomorDisplay}. ${pesanMutasi(e)}`, 'error');
    }
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
    if (perluMuatUlang(e) || (kode !== null && KODE_MUAT_ULANG.has(kode))) await fetchData();
  };

  // A3: rpc layanan_mulai (atomik). Pemenang menjadi pemilik tiket (dilayani_oleh).
  const handleMulaiLayanan = (a: AntrianRow, layananNama: string) =>
    jalankanAksi(a.id, `Memulai layanan ${a.nomor_display}…`, async () => {
      try {
        const supabase = createClient();
        // Balasan jsonb tunggal; kosong/null tanpa error dianggap gagal (mutasiWajibBaris).
        const [hasil] = await mutasiWajibBaris<HasilMulai>(
          supabase.rpc('layanan_mulai', { p_tiket_id: a.id }),
        );
        toast(hasil?.sudah_milik_anda ? 'Layanan tiket ini sudah Anda mulai sebelumnya' : 'Layanan dimulai', 'success');
        await fetchData();
        // Buka wizard pendataan untuk layanan yang didukung (Helpdesk OSS / Non OSS).
        // Layanan lain (mis. P4 / investasi) tidak punya form pendataan.
        if (isLayananPendataan(layananNama)) {
          setActiveWizardTiketId(a.id);
        } else {
          toast('Layanan ini tidak memiliki form pendataan', 'info');
        }
      } catch (e) {
        console.error('Gagal memulai layanan:', e);
        await tanganiGalatAksi(e, 'Gagal memulai layanan.');
      }
    });

  const handleSelesaikan = (a: AntrianRow, layananNama: string) => {
    if (isLayananPendataan(layananNama)) {
      setActiveWizardTiketId(a.id);
      return Promise.resolve();
    }
    // A3: rpc layanan_selesai tanpa pendataan; hanya pemilik tiket (ditegakkan DB: BUKAN_PEMILIK).
    return jalankanAksi(a.id, `Menyelesaikan ${a.nomor_display}…`, async () => {
      try {
        const supabase = createClient();
        await mutasiWajibBaris(supabase.rpc('layanan_selesai', { p_tiket_id: a.id }));
        toast('Kunjungan berhasil diselesaikan', 'success');
        await fetchData();
      } catch (e) {
        console.error('Gagal menyelesaikan antrian:', e);
        await tanganiGalatAksi(e, 'Gagal menyelesaikan antrian.');
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
    ? `Log Antrian ${layananNamaHeader}`
    : 'Log Antrian Semua Layanan';

  const statusLabel = (status: string) => {
    switch (status) {
      case 'menunggu': return '● Menunggu';
      case 'dilayani': return '▶ Dilayani';
      case 'selesai': return '✓ Selesai';
      case 'tidak_terlayani': return '✗ Tidak Terlayani (petugas tidak hadir)';
      case 'no_show': return '○ Tidak Datang (warga)';
      case 'batal': return '⊘ Batal';
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
      jam_masuk: a.jam_masuk
        ? new Date(a.jam_masuk).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        : '',
      jam_pulang: a.jam_pulang
        ? new Date(a.jam_pulang).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        : '',
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
    const blob = new Blob([`\ufeff${rows_csv}`], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daftar_hadir_${layananLabel.replace(/\s+/g, '_')}_${tanggal}.csv`;
    a.click();
  };

  return (
    <>
      <PageHeader
        title={headerTitle}
        description="Urutan kedatangan harian — walk-in dan reservasi (setelah scan)"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <WalkinWizard
            fixedLayananId={currentUser?.role === 'petugas' ? currentUser.layanan_id : null}
            onSuccess={fetchData}
            triggerLabel="+ Walk-in"
            triggerClassName="btn btn--primary btn--sm"
          />
          <Calendar size={16} style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="date"
            className="form-input"
            value={tanggal}
            onChange={(e) => { setTanggal(e.target.value); setPage(0); }}
            style={{ width: '160px', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}
          />
        </div>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        <CalendarBanner />
        {currentUser?.role === 'petugas' && layananNamaHeader && (
          <RoleNote>
            Anda melayani antrean {layananNamaHeader}. Pengunjung layanan lain diatur Front Office.
          </RoleNote>
        )}
        {unassigned ? (
          <div className="table-wrapper">
            <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
              <AlertCircle size={40} className="empty-state__icon" />
              <h3 className="empty-state__title">Belum Ditugaskan</h3>
              <p>Akun Anda belum ditugaskan ke layanan. Hubungi admin.</p>
            </div>
          </div>
        ) : (
          <>
            {/* ── Rekapitulasi Absen ── */}
            <div style={{
              background: 'var(--surface-elevated)',
              borderRadius: 'var(--radius-xl)',
              border: '1px solid var(--border-default)',
              marginBottom: 'var(--space-8)',
              overflow: 'hidden',
            }}>
              {/* Header / Toggle */}
              <button
                onClick={async () => {
                  const next = !rekapOpen;
                  setRekapOpen(next);
                  if (next) await fetchRekapAbsensi();
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 'var(--space-4) var(--space-6)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <UserCheck size={16} style={{ color: 'var(--color-primary-600)' }} />
                  Rekapitulasi Absen — {tanggal}
                  {rekapAbsensi.length > 0 && (
                    <span style={{
                      marginLeft: 'var(--space-2)',
                      background: 'var(--color-primary-100)',
                      color: 'var(--color-primary-700)',
                      borderRadius: 'var(--radius-full)',
                      padding: '1px 8px',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 700,
                    }}>
                      {rekapAbsensi.length} petugas
                    </span>
                  )}
                </span>
                {rekapOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {/* Collapsible body */}
              {rekapOpen && (
                <div style={{ borderTop: '1px solid var(--border-default)' }}>
                  <div style={{ padding: 'var(--space-3) var(--space-6)', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={handleDownloadAbsenCsv}
                      disabled={rekapAbsensi.length === 0}
                    >
                      <Download size={14} /> Unduh CSV
                    </button>
                  </div>
                  {rekapLoading ? (
                    <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
                      Memuat…
                    </div>
                  ) : rekapAbsensi.length === 0 ? (
                    <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
                      Belum ada catatan absensi untuk tanggal ini.
                    </div>
                  ) : (
                    <div className="table-wrapper" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                    <table className="table" style={{ marginTop: 0 }}>
                      <thead>
                        <tr>
                          <th>Nama Petugas</th>
                          <th>Jam Masuk</th>
                          <th>Jam Pulang</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rekapAbsensi.map(a => (
                          <tr key={a.id}>
                            <td style={{ fontWeight: 600 }}>{a.petugas?.nama ?? '—'}</td>
                            <td>
                              {a.jam_masuk
                                ? new Date(a.jam_masuk).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                                : '—'}
                            </td>
                            <td>
                              {a.jam_pulang
                                ? new Date(a.jam_pulang).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                                : '—'}
                            </td>
                            <td>
                              {a.status === 'approved' ? (
                                <span className="badge badge--selesai">Disetujui</span>
                              ) : a.status === 'pending' ? (
                                <span className="badge badge--eskalasi">Menunggu</span>
                              ) : a.status === 'ditolak' ? (
                                <span className="badge badge--nonaktif">Ditolak</span>
                              ) : (
                                <span className="badge badge--nonaktif" style={{ background: 'var(--color-danger-100)', color: 'var(--color-danger-700)' }}>Alpa</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="grid-stats" style={{ marginBottom: 'var(--space-8)' }}>
              <div className="stat-card">
                <div className="stat-card__icon" style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
                  <Users size={22} />
                </div>
                <span className="stat-card__value">{totalCount}</span>
                <span className="stat-card__label">Total Hari Ini</span>
              </div>
              <div className="stat-card">
                <div className="stat-card__icon" style={{ background: 'var(--color-success-50)', color: 'var(--color-success-600)' }}>
                  <TrendingUp size={22} />
                </div>
                <span className="stat-card__value">{serverStats.totalSelesai}</span>
                <span className="stat-card__label">Selesai Dilayani</span>
              </div>
              <div className="stat-card">
                <div className="stat-card__icon" style={{ background: 'var(--color-accent-50)', color: 'var(--color-accent-600)' }}>
                  <Clock size={22} />
                </div>
                <span className="stat-card__value">
                  {serverStats.rataWaktuMenit} <small style={{ fontSize: '0.4em', fontWeight: 400 }}>mnt</small>
                </span>
                <span className="stat-card__label">Rata-rata Durasi</span>
              </div>
            </div>

            {/* Table */}
            <div className="table-wrapper">
              {loading ? (
                <table className="table" aria-hidden="true">
                  <tbody>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={isAdminLike ? 7 : 6} style={{ padding: 'var(--space-3) var(--space-4)' }}>
                          <div className="skeleton" style={{ height: '20px', width: '100%' }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>No. Tiket</th>
                      {isAdminLike && <th>Layanan</th>}
                      <th>Nama</th>
                      <th>Asal</th>
                      <th>Waktu Masuk</th>
                      <th>Status</th>
                      <th>Aksi / Durasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {antrian.map((a) => {
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

                      return (
                        <tr key={a.id}>
                          <td>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              minWidth: '48px',
                              padding: '2px 8px',
                              borderRadius: 'var(--radius-md)',
                              background: 'var(--color-primary-50)',
                              color: 'var(--color-primary-700)',
                              fontWeight: 700,
                              fontSize: 'var(--text-sm)',
                            }}>
                              {a.nomor_display}
                            </span>
                          </td>
                          {isAdminLike && (
                            <td style={{ fontWeight: 600 }}>{resolveLayananNama(a)}</td>
                          )}
                          <td style={{ fontWeight: 600 }}>{k?.nama ?? '—'}</td>
                          <td>
                            <span className={`badge badge--${k?.asal === 'reservasi' ? 'pending' : 'draft'}`}>
                              {asalLabel(k?.asal ?? 'walk_in')}
                            </span>
                          </td>
                          <td>
                            {waktuMasuk
                              ? new Date(waktuMasuk).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                              : '—'}
                          </td>
                          <td>
                            <span className={`badge badge--${a.status}`}>
                              {statusLabel(a.status)}
                            </span>
                            {a.status === 'dilayani' && (
                              <small style={{ display: 'block', marginTop: 2, color: 'var(--text-tertiary)' }}>
                                {milikSaya ? 'oleh Anda' : `oleh ${pelayanNama ?? 'petugas lain'}`}
                              </small>
                            )}
                          </td>
                          <td>
                            {a.status === 'menunggu' ? (
                              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                {/* QUE-17: panggil ulang — emit nomor_dipanggil event */}
                                <button
                                  className="btn btn--ghost btn--sm"
                                  onClick={() => handlePanggil(a.id, a.nomor_display)}
                                  title="Panggil ulang ke layar antrean"
                                  style={{ padding: '4px 10px', fontSize: '12px' }}
                                >
                                  <Volume2 size={14} style={{ marginRight: '4px' }} />
                                  Panggil
                                </button>
                                {/* Keputusan CEO 7.5: tidak ada "Lengkapi Data" sebelum Mulai Layanan. Draf pendataan
                                   hanya ditulis pemilik tiket yang sedang dilayani (wizard terbuka otomatis setelah Mulai). */}
                                {bolehMulaiTiket(currentUser, a) && (
                                  <button
                                    className="btn btn--primary btn--sm"
                                    onClick={() => handleMulaiLayanan(a, layananNama)}
                                    disabled={sibuk}
                                    aria-busy={sibuk}
                                    style={{ padding: '4px 12px', fontSize: '12px' }}
                                  >
                                    <Play size={14} style={{ marginRight: '4px' }} aria-hidden="true" />
                                    {sibuk ? 'Memproses…' : 'Mulai Layanan'}
                                  </button>
                                )}
                              </div>
                            ) : a.status === 'dilayani' ? (
                              milikSaya ? (
                                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                  {isLayananPendataan(layananNama) && (
                                    <button
                                      className="btn btn--primary btn--sm"
                                      onClick={() => setActiveWizardTiketId(a.id)}
                                      disabled={sibuk}
                                      style={{ padding: '4px 10px', fontSize: '12px' }}
                                    >
                                      <FileEdit size={14} style={{ marginRight: '4px' }} aria-hidden="true" />
                                      Form Pendataan
                                    </button>
                                  )}
                                  <button
                                    className="btn btn--secondary btn--sm"
                                    onClick={() => handleSelesaikan(a, layananNama)}
                                    disabled={sibuk}
                                    aria-busy={sibuk}
                                    style={{ padding: '4px 12px', fontSize: '12px' }}
                                  >
                                    <CheckCircle2 size={14} style={{ marginRight: '4px', color: 'var(--color-success-600)' }} aria-hidden="true" />
                                    {sibuk ? 'Memproses…' : 'Selesai'}
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <small style={{ color: 'var(--text-secondary)', maxWidth: 240 }}>
                                    Hanya {pelayanNama ?? 'petugas yang memulai'} yang dapat menyelesaikan tiket ini.
                                  </small>
                                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                    {isLayananPendataan(layananNama) && (
                                      <button
                                        className="btn btn--ghost btn--xs"
                                        onClick={() => setActiveWizardTiketId(a.id)}
                                        style={{ fontSize: '11px', padding: '2px 6px', width: 'fit-content' }}
                                      >
                                        <FileText size={12} style={{ marginRight: '3px' }} aria-hidden="true" />
                                        Lihat Data
                                      </button>
                                    )}
                                    {bolehAmbilAlihTiket(currentUser, a) && (
                                      <button
                                        className="btn btn--secondary btn--xs"
                                        onClick={() =>
                                          setAmbilAlihTiket({ id: a.id, nomor_display: a.nomor_display, pemilik_nama: pelayanNama })
                                        }
                                        disabled={sibuk}
                                        title="Darurat: jadikan Anda penanggung jawab tiket ini (wajib alasan, tercatat di audit)"
                                        style={{ fontSize: '11px', padding: '2px 6px', width: 'fit-content' }}
                                      >
                                        <UserCog size={12} style={{ marginRight: '3px' }} aria-hidden="true" />
                                        Ambil alih
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>{durasi}</span>
                                {isLayananPendataan(resolveLayananNama(a)) && (
                                  <button
                                    className="btn btn--ghost btn--xs"
                                    onClick={() => setActiveWizardTiketId(a.id)}
                                    style={{ fontSize: '11px', padding: '2px 6px', width: 'fit-content' }}
                                  >
                                    <FileText size={12} style={{ marginRight: '3px' }} />
                                    Lihat Data
                                  </button>
                                )}
                                {a.status === 'selesai' && isLayananPendataan(resolveLayananNama(a)) && (
                                  isAdminLike ? (
                                    <button
                                      className="btn btn--secondary btn--xs"
                                      onClick={() => setKoreksiTiketId(a.id)}
                                      title="Koreksi data yang sudah dikunci (wajib alasan, tercatat di riwayat)"
                                      style={{ fontSize: '11px', padding: '2px 6px', width: 'fit-content' }}
                                    >
                                      <Pencil size={12} style={{ marginRight: '3px' }} />
                                      Koreksi Data
                                    </button>
                                  ) : currentUser?.role === 'petugas' && (
                                    <small style={{ color: 'var(--text-tertiary)', maxWidth: 220 }}>
                                      Data sudah dikunci. Hubungi Front Office atau Admin untuk koreksi.
                                    </small>
                                  )
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {antrian.length === 0 && (
                      <tr>
                        <td colSpan={isAdminLike ? 7 : 6}>
                          <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                            <Users size={40} className="empty-state__icon" />
                            <h3 className="empty-state__title">Belum Ada Antrian</h3>
                            <p>Belum ada tiket untuk tanggal ini.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              {!loading && (
                <Pagination page={page} pageSize={PAGE_SIZE} total={totalCount} onPageChange={setPage} />
              )}
            </div>
          </>
        )}
      </div>

      <p role="status" aria-live="polite" style={SR_ONLY}>{pengumuman}</p>

      {ambilAlihTiket && (
        <AmbilAlihTiketModal
          key={ambilAlihTiket.id}
          tiket={ambilAlihTiket}
          onClose={() => setAmbilAlihTiket(null)}
          onSuccess={fetchData}
        />
      )}

      <KoreksiPelayananModal
        isOpen={Boolean(koreksiTiketId)}
        tiketId={koreksiTiketId}
        onClose={() => setKoreksiTiketId(null)}
        onSuccess={fetchData}
      />

      <PelayananWizardModal
        isOpen={Boolean(activeWizardTiketId)}
        tiketId={activeWizardTiketId}
        onClose={() => setActiveWizardTiketId(null)}
        onSuccess={async () => {
          await fetchData();
        }}
        onDataBasi={fetchData}
      />
    </>
  );
}