'use client';

import { useState, useEffect, useCallback } from 'react';
import { todayWIB } from '@/lib/time';
import {
  BookOpen,
  LogIn,
  LogOut as LogOutIcon,
  UserCheck,
  CheckCircle2,
  XCircle,
  ImageIcon,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import IsiHalaman from '@/components/layout/IsiHalaman';
import Pagination from '@/components/Pagination';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import Tombol from '@/components/ui/Tombol';
import Lencana from '@/components/ui/Lencana';
import Galat from '@/components/ui/Galat';
import StatusKosong from '@/components/ui/StatusKosong';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import PemilihTanggal from '@/components/ui/PemilihTanggal';
import { formatTanggal, formatWaktu } from '@/lib/utils';
import styles from './absensi.module.css';
import { createClient } from '@/lib/supabase/client';
import { mutasiInsert, pesanMutasi } from '@/lib/supabase/mutate';
import { useToast } from '@/components/Toast';
import AbsensiWizardModal from '@/components/admin/AbsensiWizardModal';

const PAGE_SIZE = 25;

interface PetugasData {
  id: string;
  role: string;
  layanan_id: string;
}

interface HadirFo {
  id: string;
  nama_petugas: string;
  created_at: string;
  layanan: { nama: string } | null;
}

interface Absensi {
  id: string;
  petugas_id: string;
  tanggal: string;
  jam_masuk: string | null;
  jam_pulang: string | null;
  status: 'pending' | 'approved' | 'ditolak' | 'alpa';
  petugas: {
    nama: string;
    layanan: {
      nama: string;
    } | null;
  };
}

export default function AbsensiPage() {
  const { toast } = useToast();
  const [filterTanggal, setFilterTanggal] = useState(todayWIB());
  const [absensi, setAbsensi] = useState<Absensi[]>([]);
  const [currentUser, setCurrentUser] = useState<PetugasData | null>(null);
  const [loading, setLoading] = useState(true);
  // Galat memuat dipisah dari "kosong": daftar yang gagal dimuat tidak boleh terbaca sebagai "Belum Ada Absensi".
  const [galatMuat, setGalatMuat] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [foWizardOpen, setFoWizardOpen] = useState(false);
  const [hadirFo, setHadirFo] = useState<HadirFo[]>([]);

  // Mengembalikan baris yang dimuat (null = gagal memuat) agar pemanggil dapat memverifikasi hasil mutasi.
  const fetchData = useCallback(async (): Promise<Absensi[] | null> => {
    try {
      const supabase = createClient();
      
      // Get current user role
      const { data: { user } } = await supabase.auth.getUser();
      let myPetugasId = null;
      let myRole = 'petugas';

      if (user) {
        const { data: p } = await supabase
          .from('petugas')
          .select('id, role, layanan_id')
          .eq('auth_user_id', user.id)
          .single();
        if (p) {
          myPetugasId = p.id;
          myRole = p.role;
          setCurrentUser(p as PetugasData);
        }
      }

      // Fetch absensi
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from('absensi_petugas')
        .select(`
          id, petugas_id, tanggal, jam_masuk, jam_pulang, status,
          petugas:petugas_id (
            nama,
            layanan:layanan_id ( nama )
          )
        `, { count: 'exact' })
        .eq('tanggal', filterTanggal)
        .order('jam_masuk', { ascending: false })
        .range(from, to);

      // If just a regular petugas, only show their own attendance for the day?
      // Wait, the UI allows them to see others? Let's just show theirs if petugas, or all if admin
      if (myRole === 'petugas' && myPetugasId) {
         query = query.eq('petugas_id', myPetugasId);
      }

      const { data, count, error } = await query;
      // supabase-js tidak melempar: tanpa ini galat dianggap daftar kosong ([]), dan pemanggil (mis. verifikasi
      // absen pulang) menyimpulkan "tidak tercatat" padahal sebenarnya hanya gagal memuat. Melempar -> null = tak terbukti.
      if (error) throw error;
      // Handle the case where the join returns array or object due to how supabase types work
      const formattedData = (data || []).map(d => ({
        ...d,
        petugas: Array.isArray(d.petugas) ? d.petugas[0] : d.petugas
      })) as unknown as Absensi[];
      
      // Kehadiran yang dicatat FO dengan nama manual (RLS: hanya admin/FO yang melihat baris).
      if (myRole === 'admin' || myRole === 'front_office') {
        const { data: fo } = await supabase
          .from('absensi_hadir_fo')
          .select('id, nama_petugas, created_at, layanan:layanan_id ( nama )')
          .eq('tanggal', filterTanggal)
          .order('created_at', { ascending: false });
        setHadirFo(((fo ?? []) as unknown[]).map((d) => {
          const r = d as Omit<HadirFo, 'layanan'> & { layanan: HadirFo['layanan'] | HadirFo['layanan'][] };
          return { ...r, layanan: Array.isArray(r.layanan) ? r.layanan[0] ?? null : r.layanan };
        }));
      } else {
        setHadirFo([]);
      }

      setAbsensi(formattedData);
      setTotalCount(count ?? formattedData.length);
      setGalatMuat(false);
      return formattedData;
    } catch (e) {
      console.error(e);
      setGalatMuat(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, [filterTanggal, page]);

  useEffect(() => {
    void Promise.resolve().then(fetchData);
  }, [fetchData]);

  const handleAbsenHadir = async () => {
    if (!currentUser || actionLoading) return;
    try {
      setActionLoading(true);
      const supabase = createClient();
      // SCH-08/I-09: jam absensi dari SERVER via catat_absensi(), bukan dari klien.
      const { error } = await supabase.rpc('catat_absensi', {
        p_petugas_id: currentUser.id,
        p_sumber: 'petugas_ajukan',
        p_dicatat_oleh: currentUser.id,
      });
      if (error) {
        // 42501 = ditolak RLS/fungsi DB (bukan staf aktif / bukan untuk diri sendiri).
        toast(
          error.code === '42501'
            ? 'Anda tidak berhak mengajukan absensi ini. Hubungi Front Office atau Admin.'
            : 'Gagal mengajukan absensi hadir. Coba lagi.',
          'error',
        );
        return;
      }
      toast('Absensi hadir diajukan. Menunggu persetujuan Front Office/Admin.', 'success');
      setLoading(true);
      await fetchData();
    } catch (e) {
      console.error(e);
      toast('Gagal mengajukan absensi hadir. Coba lagi.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAbsenPulang = async () => {
    if (!currentUser) return;

    try {
      setActionLoading(true);
      const supabase = createClient();
      // T-7: jam_pulang dari SERVER via RPC catat_pulang() yang menggunakan now() PostgreSQL (I-09)
      // mutasiInsert: melempar bila RPC mengembalikan error (mis. 42501 -> pesan "tidak berwenang").
      await mutasiInsert(supabase.rpc('catat_pulang', { p_petugas_id: currentUser.id }));
      // SENGAJA idempoten di DB (UPDATE ... WHERE jam_pulang IS NULL) dan SELALU mengembalikan now()
      // walau 0 baris berubah (belum ada absen hadir hari ini / sudah pulang). Jadi hasil RPC TIDAK
      // membuktikan jam_pulang tersimpan: buktikan dari data yang dimuat ulang sebelum melapor sukses.
      setLoading(true);
      const barisBaru = await fetchData();
      const milikSaya = barisBaru?.find((a) => a.petugas_id === currentUser.id);
      if (barisBaru && !milikSaya?.jam_pulang) {
        toast(
          'Absen pulang tidak tercatat. Pastikan absen hadir hari ini sudah tercatat, lalu coba lagi.',
          'error',
        );
        return;
      }
      // barisBaru null = gagal memuat ulang: tak bisa membuktikan, tetapi RPC sendiri tidak error.
      toast('Absen pulang berhasil dicatat', 'success');
    } catch (e) {
      console.error(e);
      toast(pesanMutasi(e, 'Gagal mencatat absen pulang'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // FO & Admin boleh memutuskan absensi (SCH-08) — HANYA lewat RPC setujui_absensi
  // (tabel absensi_petugas tidak lagi di-UPDATE langsung dari klien).
  const handleDecision = async (id: string, status: 'approved' | 'ditolak') => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'front_office')) return;
    if (decidingId) return;
    const aksi = status === 'approved' ? 'menyetujui' : 'menolak';
    setDecidingId(id);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('setujui_absensi', { p_absensi_id: id, p_status: status });
      if (error) {
        toast(
          error.code === '42501'
            ? 'Hanya Front Office atau Admin yang dapat memutuskan absensi.'
            : error.code === 'P0002'
              ? 'Absensi tidak ditemukan. Muat ulang halaman.'
              : `Gagal ${aksi} absensi. Coba lagi.`,
          'error',
        );
        return;
      }
      toast(status === 'approved' ? 'Absensi disetujui' : 'Absensi ditolak', 'success');
      setLoading(true);
      await fetchData();
    } catch (e) {
      console.error(e);
      toast(`Gagal ${aksi} absensi. Coba lagi.`, 'error');
    } finally {
      setDecidingId(null);
    }
  };

  const hadirHariIni = absensi.filter(a => a.status === 'approved' || a.status === 'pending').length;
  const sudahPulang = absensi.filter(a => a.jam_pulang).length;
  const myTodayAbsensi = absensi.find(a => a.petugas_id === currentUser?.id);
  // 'alpa' (ditandai otomatis) bukan kehadiran: petugas boleh mengajukan lagi (jadi 'pending', perlu disetujui FO/Admin).
  const myAlpa = myTodayAbsensi?.status === 'alpa';
  const myHadir = !!myTodayAbsensi && !myAlpa;

  // Galat tanpa data = ganti tabel dengan pesan galat; galat muat ulang saat data lama ada = data tetap tampil + catatan.
  const galatTanpaData = galatMuat && absensi.length === 0;
  const adaAksi = currentUser?.role === 'admin' || currentUser?.role === 'front_office';
  const adalahHariIni = filterTanggal === todayWIB();

  const kolomHadirFo: KolomTabel<HadirFo>[] = [
    { kunci: 'nama', judul: 'Nama Petugas', peran: 'utama', render: (h) => <span className={styles.nama}>{h.nama_petugas}</span> },
    { kunci: 'layanan', judul: 'Layanan', render: (h) => h.layanan?.nama ?? '-' },
    { kunci: 'jam', judul: 'Jam (WIB)', render: (h) => <span className={styles.jam}>{h.created_at ? formatWaktu(h.created_at) : '—'} WIB</span> },
    {
      kunci: 'foto',
      judul: 'Foto',
      peran: 'aksi',
      render: (h) => (
        <Tombol href={`/api/absensi/foto/${h.id}`} target="_blank" varian="hantu" ukuran="kecil" ikon={ImageIcon}>
          Lihat foto
        </Tombol>
      ),
    },
  ];

  const kolomAbsensi: KolomTabel<Absensi>[] = [
    {
      kunci: 'layanan',
      judul: 'Instansi / Layanan',
      peran: 'utama',
      render: (a) => {
        // Fallback for nested data structure depending on how supabase joins
        const layananNama = a.petugas?.layanan
          ? (Array.isArray(a.petugas.layanan) ? a.petugas.layanan[0]?.nama : (a.petugas.layanan as { nama: string }).nama)
          : 'Semua Layanan';
        return <span className={styles.layanan}>{layananNama}</span>;
      },
    },
    { kunci: 'nama', judul: 'Nama Petugas', render: (a) => a.petugas?.nama || 'Petugas' },
    {
      kunci: 'masuk',
      judul: 'Jam Hadir',
      render: (a) => a.jam_masuk ? (
        <span className={styles.jam}>
          <LogIn size={14} strokeWidth={1.75} className={styles.jamHadir} aria-hidden="true" />
          {formatWaktu(a.jam_masuk)}
        </span>
      ) : '—',
    },
    {
      kunci: 'pulang',
      judul: 'Jam Pulang',
      render: (a) => a.jam_pulang ? (
        <span className={styles.jam}>
          <LogOutIcon size={14} strokeWidth={1.75} className={styles.jamPulang} aria-hidden="true" />
          {formatWaktu(a.jam_pulang)}
        </span>
      ) : '—',
    },
    {
      kunci: 'status',
      judul: 'Status',
      render: (a) =>
        a.status === 'approved' ? <Lencana nada="sukses">Disetujui</Lencana>
        : a.status === 'ditolak' ? <Lencana nada="netral">Ditolak</Lencana>
        : a.status === 'alpa' ? <Lencana nada="bahaya">Alpa</Lencana>
        : <Lencana nada="peringatan">Menunggu</Lencana>,
    },
    ...(adaAksi
      ? [{
        kunci: 'aksi',
        judul: 'Aksi',
        peran: 'aksi' as const,
        render: (a: Absensi) => a.status === 'pending' ? (
          <div className={styles.aksi}>
            <Tombol
              varian="sekunder"
              ukuran="kecil"
              onClick={() => handleDecision(a.id, 'approved')}
              disabled={decidingId !== null}
              memuat={decidingId === a.id}
            >
              Setujui
            </Tombol>
            <Tombol
              varian="bahaya"
              ukuran="kecil"
              ikon={XCircle}
              onClick={() => handleDecision(a.id, 'ditolak')}
              disabled={decidingId !== null}
              memuat={decidingId === a.id}
            >
              Tolak
            </Tombol>
          </div>
        ) : null,
      }]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Absensi Instansi Mitra"
        description="Buku P4 Digital — Pencatatan kehadiran petugas instansi mitra"
        meta={formatTanggal(`${filterTanggal}T12:00:00+07:00`)}
      >
        <PemilihTanggal
          nilai={filterTanggal}
          onUbah={(nilai) => {
            if (!nilai) return;
            setLoading(true);
            setFilterTanggal(nilai);
            setPage(0);
          }}
          label="Tanggal absensi"
        />
      </PageHeader>

      <IsiHalaman>
        {/* Tombol Catat Hadir — Front Office / Admin (via wizard) */}
        {adaAksi && adalahHariIni && (
          <Kartu judul="Catat Hadir Petugas">
            <p className={styles.penjelasan}>
              Pilih layanan, ambil foto petugas, lalu ketik nama petugas yang hadir.
            </p>
            <Tombol varian="utama" ikon={LogIn} onClick={() => setFoWizardOpen(true)}>
              Catat Hadir
            </Tombol>
          </Kartu>
        )}

        {hadirFo.length > 0 && (
          <Kartu judul={`Hadir yang Dicatat Front Office (${hadirFo.length})`} padding="tanpa">
            <Tabel
              kolom={kolomHadirFo}
              baris={hadirFo}
              kunciBaris="id"
              caption="Kehadiran yang dicatat Front Office"
              padat
              kartuDiHp
            />
          </Kartu>
        )}

        {/* Tombol Absen Mandiri (Khusus Petugas) */}
        {currentUser?.role === 'petugas' && adalahHariIni && (
          <Kartu judul="Absensi Mandiri Hari Ini">
            <div className={styles.tombolBaris}>
              {!myHadir ? (
                <Tombol
                  varian="utama"
                  ikon={LogIn}
                  onClick={handleAbsenHadir}
                  disabled={actionLoading}
                  memuat={actionLoading}
                >
                  {actionLoading ? 'Memproses...' : myAlpa ? 'Ajukan Kehadiran' : 'Absen Hadir'}
                </Tombol>
              ) : (
                <Tombol varian="sekunder" ikon={CheckCircle2} disabled>
                  Sudah Hadir
                </Tombol>
              )}

              {myHadir && !myTodayAbsensi.jam_pulang ? (
                <Tombol
                  varian="sekunder"
                  ikon={LogOutIcon}
                  onClick={handleAbsenPulang}
                  disabled={actionLoading}
                  memuat={actionLoading}
                >
                  Absen Pulang
                </Tombol>
              ) : myTodayAbsensi?.jam_pulang ? (
                <Tombol varian="sekunder" ikon={CheckCircle2} disabled>
                  Sudah Pulang
                </Tombol>
              ) : null}
            </div>

            {myAlpa && (
              <CatatanKeadaan jenis="info" className={styles.catatan}>
                Anda tercatat Alpa hari ini. Anda masih dapat mengajukan kehadiran, tetapi harus disetujui Front Office/Admin terlebih dahulu.
              </CatatanKeadaan>
            )}
            {myTodayAbsensi && myTodayAbsensi.status === 'pending' && (
              <CatatanKeadaan jenis="info" className={styles.catatan}>
                Absensi Anda sedang menunggu persetujuan Front Office/Admin.
              </CatatanKeadaan>
            )}
            {myTodayAbsensi && myTodayAbsensi.status === 'ditolak' && (
              <CatatanKeadaan jenis="galat" className={styles.catatan}>
                Absensi Anda ditolak. Hubungi Front Office/Admin.
              </CatatanKeadaan>
            )}
          </Kartu>
        )}

        {/* Statistik (disembunyikan saat galat memuat: angka nol palsu lebih menyesatkan daripada kosong) */}
        {!galatTanpaData && (
          <div className={styles.statistik}>
            <KartuStatistik label="Hadir Hari Ini" nilai={hadirHariIni} ikon={UserCheck} memuat={loading} />
            <KartuStatistik label="Sudah Pulang" nilai={sudahPulang} ikon={LogOutIcon} memuat={loading} />
          </div>
        )}

        {galatMuat && !galatTanpaData && !loading && (
          <CatatanKeadaan jenis="info">
            Pembaruan terakhir gagal; data di bawah mungkin belum terbaru.
          </CatatanKeadaan>
        )}

        {/* Daftar kehadiran */}
        <Kartu padding="tanpa" as="section">
          {galatTanpaData && !loading ? (
            <div className={styles.galat}>
              <Galat
                pesan="Daftar absensi tidak dapat dimuat. Periksa koneksi Anda lalu coba lagi."
                onRetry={() => {
                  setLoading(true);
                  void fetchData();
                }}
              />
            </div>
          ) : (
            <>
              <Tabel
                kolom={kolomAbsensi}
                baris={absensi}
                kunciBaris="id"
                caption={`Daftar kehadiran petugas ${formatTanggal(`${filterTanggal}T12:00:00+07:00`)}`}
                memuat={loading}
                kartuDiHp
                kosong={
                  <StatusKosong
                    ikon={BookOpen}
                    judul="Belum Ada Absensi"
                    isi="Tidak ada catatan absensi untuk tanggal ini."
                  />
                }
              />
              {!loading && <Pagination page={page} pageSize={PAGE_SIZE} total={totalCount} onPageChange={setPage} />}
            </>
          )}
        </Kartu>
      </IsiHalaman>

      {/* Wizard hadir FO */}
      {currentUser && (currentUser.role === 'front_office' || currentUser.role === 'admin') && (
        <AbsensiWizardModal
          isOpen={foWizardOpen}
          onClose={() => setFoWizardOpen(false)}
          onSuccess={() => {
            setFoWizardOpen(false);
            setLoading(true);
            void fetchData();
          }}
        />
      )}
    </>
  );
}
