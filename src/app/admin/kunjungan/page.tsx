'use client';

// WP-22: Reads migrated from visit → kunjungan + tiket_antrean.
// visit remains the write source; dual-write trigger keeps kunjungan in sync.
// Gaya Dasbor: filter di URL (A13), kartu di HP (A14), keadaan memuat/kosong/galat dibedakan (A7, A15), waktu WIB (A9).

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { todayWIB } from '@/lib/time';
import { Search, RefreshCw, QrCode, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import IsiHalaman from '@/components/layout/IsiHalaman';
import Pagination from '@/components/Pagination';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Galat from '@/components/ui/Galat';
import Kartu from '@/components/ui/Kartu';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import PemilihTanggal from '@/components/ui/PemilihTanggal';
import StatusKosong from '@/components/ui/StatusKosong';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import Tombol from '@/components/ui/Tombol';
import { formatWaktu } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeRefetch } from '@/lib/hooks/useRealtimeRefetch';
import SurveiQrDialog from '@/components/admin/SurveiQrDialog';
import SurveiStatusBadge from '@/components/admin/SurveiStatusBadge';
import {
  muatKunjunganFo,
  BATAS_CARI,
  jendelaTanggalFo,
  tanggalDalamJendela,
  pesanJendelaTanggal,
  galatTanggalDiluarBatas,
} from '@/lib/fo/akses-antrean';
import { muatKoordinator } from '@/lib/akses-data/lingkup';
import { ambilStatusSurvei, type StatusSurvei } from '@/lib/survei/staf';
import styles from './kunjungan.module.css';

const PAGE_SIZE = 25;
const JEDA_CARI_MS = 300; // jeda ketukan sebelum pencarian dikirim ke server

interface TiketData {
  nomor_display: string | null;
  waktu_selesai: string | null;
  layanan: { nama: string } | { nama: string }[] | null;
}

interface KunjunganRow {
  id: string;
  nama: string;
  asal: string;
  status: 'terjadwal' | 'menunggu' | 'dilayani' | 'selesai' | 'tidak_terlayani' | 'no_show';
  waktu_masuk: string | null;
  tanggal: string;
  tiket_antrean: TiketData[] | TiketData | null;
}

type FilterStatus = 'semua' | 'menunggu' | 'dilayani' | 'selesai';
const DAFTAR_STATUS: FilterStatus[] = ['semua', 'menunggu', 'dilayani', 'selesai'];
const LABEL_FILTER: Record<FilterStatus, string> = {
  semua: 'Semua',
  menunggu: 'Menunggu',
  dilayani: 'Dilayani',
  selesai: 'Selesai',
};
const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

interface FilterUrl {
  tanggal: string;
  status: FilterStatus;
  page: number;
}

// Tanggal, status, dan halaman hidup di URL (A13); pencarian identitas hanya di state lokal.
function bacaFilterUrl(sp: { get(k: string): string | null } | null): FilterUrl {
  const tanggal = sp?.get('tanggal') ?? '';
  const status = sp?.get('status') ?? '';
  const halaman = Number.parseInt(sp?.get('halaman') ?? '', 10);
  return {
    tanggal: POLA_TANGGAL.test(tanggal) ? tanggal : todayWIB(),
    status: (DAFTAR_STATUS as string[]).includes(status) ? (status as FilterStatus) : 'semua',
    page: Number.isFinite(halaman) && halaman > 1 ? halaman - 1 : 0,
  };
}

function susunQueryFilter(f: FilterUrl): string {
  const q = new URLSearchParams();
  if (f.tanggal !== todayWIB()) q.set('tanggal', f.tanggal);
  if (f.status !== 'semua') q.set('status', f.status);
  if (f.page > 0) q.set('halaman', String(f.page + 1));
  return q.toString();
}

const NADA_STATUS: Record<KunjunganRow['status'], { nada: NadaLencana; label: string }> = {
  menunggu: { nada: 'peringatan', label: 'Menunggu' },
  dilayani: { nada: 'info', label: 'Sedang dilayani' },
  selesai: { nada: 'sukses', label: 'Selesai' },
  terjadwal: { nada: 'netral', label: 'Terjadwal' },
  tidak_terlayani: { nada: 'bahaya', label: 'Tidak terlayani' },
  no_show: { nada: 'netral', label: 'Tidak datang' },
};

// useSearchParams menuntut Suspense (guide Next.js: use-search-params).
export default function KunjunganPage() {
  return (
    <Suspense fallback={<KunjunganMemuat />}>
      <KunjunganIsi />
    </Suspense>
  );
}

function KunjunganMemuat() {
  return (
    <>
      <PageHeader title="Kunjungan" description="Memuat daftar kunjungan…" />
      <IsiHalaman>
        <Kartu padding="tanpa" as="div">
          <Tabel kolom={[]} baris={[]} kunciBaris={() => 0} caption="daftar kunjungan" memuat />
        </Kartu>
      </IsiHalaman>
    </>
  );
}

function KunjunganIsi() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const awal = bacaFilterUrl(sp);
  // search = isi kotak (langsung); cariAktif = nilai yang dikirim ke server setelah jeda ketukan.
  const [search, setSearch] = useState('');
  const [cariAktif, setCariAktif] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(awal.status);
  const [kunjungan, setKunjungan] = useState<KunjunganRow[]>([]);
  // loading = skeleton: hanya muat awal / ganti tanggal / ganti halaman. Muat ulang dari realtime, polling, dan tombol
  // Refresh berjalan senyap (daftar tetap tampil, B-01).
  const [loading, setLoading] = useState(true);
  const [menyegarkan, setMenyegarkan] = useState(false);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [galatSegar, setGalatSegar] = useState(false);
  const muatanRef = useRef(0); // hanya respons permintaan terakhir yang boleh mengisi layar
  const adaDataRef = useRef(false); // sudah ada data valid untuk tanggal/halaman yang tampil
  // true = server menyaring sebelum paginasi (total = terfilter); false = RPC lama/kueri lama, saring halaman di klien.
  const [disaringServer, setDisaringServer] = useState(false);
  const bataRef = useRef<AbortController | null>(null);
  const [peran, setPeran] = useState<{ role: string; koordinator: boolean } | null>(null);
  const [pesanTanggal, setPesanTanggal] = useState<string | null>(null);
  const peranRef = useRef<typeof peran>(null);
  const jendela = useMemo(() => jendelaTanggalFo(peran), [peran]);
  const [page, setPage] = useState(awal.page);
  const [totalCount, setTotalCount] = useState(0);
  const [filterTanggal, setFilterTanggal] = useState(awal.tanggal);
  // URL berubah dari luar (tombol kembali, tautan yang dibagikan): ikuti. Perubahan dari halaman ini sendiri sudah sama.
  const queryUrl = sp?.toString() ?? '';
  const [queryUrlSebelumnya, setQueryUrlSebelumnya] = useState(queryUrl);
  if (queryUrl !== queryUrlSebelumnya) {
    setQueryUrlSebelumnya(queryUrl);
    const f = bacaFilterUrl(sp);
    setFilterTanggal(f.tanggal);
    setFilterStatus(f.status);
    setPage(f.page);
  }
  useEffect(() => {
    // Bersihkan tautan lama tanpa memulihkan atau mengirim ulang kata cari sebagai filter.
    const q = new URLSearchParams(queryUrl);
    if (!q.has('cari')) return;
    q.delete('cari');
    const query = q.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [queryUrl, router, pathname]);
  const tulisUrl = useCallback((f: FilterUrl) => {
    const q = susunQueryFilter(f);
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [router, pathname]);
  const [namaFo, setNamaFo] = useState<Record<string, string>>({});
  // Pesan Perilaku (survei terpadu): status per kunjungan selesai + kunjungan yang QR-nya sedang ditampilkan.
  const [statusSurvei, setStatusSurvei] = useState<ReadonlyMap<string, StatusSurvei>>(new Map());
  const [qrKunjunganId, setQrKunjunganId] = useState<string | null>(null);

  // Nama Front Office yang melayani tiap kunjungan (keputusan CEO 2026-10-14: semua FO melihat semua pengunjung, dengan
  // nama FO yang melayani). Sumber: tahap 'fo' ber-penangan pada tabel penanganan (RLS: Admin & FO semua, 202610140013).
  // Pelengkap: kegagalan memuatnya tidak menggagalkan daftar kunjungan.
  const muatNamaFo = useCallback(async (supabase: ReturnType<typeof createClient>, ids: string[]) => {
    if (ids.length === 0) {
      setNamaFo({});
      return;
    }
    try {
      const { data, error } = await supabase
        .from('penanganan')
        .select('kunjungan_id, tahap_ke, penangan_id, penangan:penangan_id(nama)')
        .in('kunjungan_id', ids)
        .eq('peran_tahap', 'fo')
        .not('penangan_id', 'is', null)
        .order('tahap_ke', { ascending: true });
      if (error) throw error;
      const peta: Record<string, string[]> = {};
      for (const r of (data ?? []) as unknown as Array<{
        kunjungan_id: string; penangan: { nama: string } | { nama: string }[] | null;
      }>) {
        const nama = (Array.isArray(r.penangan) ? r.penangan[0] : r.penangan)?.nama;
        if (!nama) continue;
        const daftar = (peta[r.kunjungan_id] ??= []);
        if (!daftar.includes(nama)) daftar.push(nama);
      }
      setNamaFo(Object.fromEntries(Object.entries(peta).map(([k, v]) => [k, v.join(', ')])));
    } catch (e) {
      console.error('Gagal memuat nama Front Office:', e);
      setNamaFo({});
    }
  }, []);

  // Status Pesan Perilaku kunjungan selesai (view v_survei_status), sekali per muat data. Pelengkap: kegagalan memuatnya
  // tidak menggagalkan daftar (lencana tidak ditampilkan alih-alih menampilkan status keliru).
  const muatStatusSurvei = useCallback(async (supabase: ReturnType<typeof createClient>, baris: KunjunganRow[]) => {
    const ids = baris.filter((k) => k.status === 'selesai').map((k) => k.id);
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
  }, []);

  const loadData = useCallback(async (senyap = false) => {
    const muatan = ++muatanRef.current;
    bataRef.current?.abort(); // permintaan sebelumnya sudah usang
    const kendali = new AbortController();
    bataRef.current = kendali;
    if (senyap) {
      setMenyegarkan(true);
    } else {
      adaDataRef.current = false;
      setLoading(true);
      setGalatMuat(null);
    }
    try {
      const supabase = createClient();
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // Akses FO (migrasi 202611030015): daftar dibuka untuk semua Front Office lewat RPC berkolom aman (tanpa HP/email),
      // sudah memuat nama FO. Migrasi belum diterapkan -> kueri lama di bawah; galat lain gagal eksplisit.
      // Pencarian + status ikut ke server (migrasi 202611040001) agar disaring SEBELUM paginasi; total = terfilter.
      const lewat = await muatKunjunganFo(supabase, {
        tanggal: filterTanggal, batas: PAGE_SIZE, lewati: from, cari: cariAktif, status: filterStatus, signal: kendali.signal,
      });
      let server = false;
      let normalized: KunjunganRow[];
      let total: number;
      let namaDariRpc: Record<string, string> | null = null;
      if (lewat.tersedia) {
        normalized = lewat.data.rows.map((k) => ({ ...k })) as unknown as KunjunganRow[];
        total = lewat.data.total;
        server = lewat.data.disaringServer;
        namaDariRpc = Object.fromEntries(lewat.data.rows.filter((k) => k.fo_nama).map((k) => [k.id, k.fo_nama as string]));
      } else {
        // WP-22: query kunjungan filtered by tanggal (date column, Asia/Jakarta-aware).
        // tiket_antrean joined for layanan name, nomor_display, and waktu_selesai.
        const { data, count, error } = await supabase
          .from('kunjungan')
          .select(`
            id, nama, asal, status, waktu_masuk, tanggal,
            tiket_antrean(nomor_display, waktu_selesai, layanan:layanan_id(nama))
          `, { count: 'exact' })
          .eq('tanggal', filterTanggal)
          .order('waktu_masuk', { ascending: false, nullsFirst: false })
          .range(from, to);

        if (error) throw error;

        // Normalize tiket_antrean to always be an array
        normalized = (data || []).map(k => ({
          ...k,
          tiket_antrean: Array.isArray(k.tiket_antrean)
            ? k.tiket_antrean
            : (k.tiket_antrean ? [k.tiket_antrean] : []),
        })) as KunjunganRow[];
        total = count ?? normalized.length;
      }

      if (muatan !== muatanRef.current) return;
      setKunjungan(normalized);
      setTotalCount(total);
      setDisaringServer(server);
      adaDataRef.current = true;
      setGalatMuat(null);
      setGalatSegar(false);
      if (namaDariRpc) setNamaFo(namaDariRpc);
      await Promise.all([
        namaDariRpc ? Promise.resolve() : muatNamaFo(supabase, normalized.map((k) => k.id)),
        muatStatusSurvei(supabase, normalized),
      ]);
    } catch (e) {
      console.error('Error loading kunjungan:', e);
      if (muatan !== muatanRef.current) return;
      if (galatTanggalDiluarBatas(e)) {
        // Batas tanggal FO non-Koordinator: pesan jelas, bukan "periksa koneksi".
        adaDataRef.current = false;
        setGalatMuat(pesanJendelaTanggal(jendelaTanggalFo(peranRef.current)));
      } else if (adaDataRef.current) {
        // Muat ulang senyap gagal: daftar lama tetap tampil, diberi catatan (tanpa toast tiap 30 dtk).
        setGalatSegar(true);
      } else {
        setGalatMuat('Data kunjungan tidak dapat dimuat. Periksa koneksi Anda lalu coba lagi.');
      }
    } finally {
      if (muatan === muatanRef.current) {
        setLoading(false);
        setMenyegarkan(false);
      }
    }
  }, [filterTanggal, page, cariAktif, filterStatus, muatNamaFo, muatStatusSurvei]);

  const muatSenyap = useCallback(() => loadData(true), [loadData]);

  // Peran dibaca sekali: FO non-Koordinator dibatasi jendela tanggal (server menegakkan; klien mencegah galat dan
  // memberi pesan jelas). Pelengkap: gagal membaca = tanpa batas di klien, server tetap menolak dengan pesan jelas.
  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: p } = await supabase.from('petugas').select('id, role').eq('auth_user_id', user.id).maybeSingle();
        if (!p || batal) return;
        const koordinator = p.role === 'front_office' ? await muatKoordinator(supabase, p.id) : false;
        if (batal) return;
        const hasil = { role: p.role as string, koordinator };
        peranRef.current = hasil;
        setPeran(hasil);
      } catch (e) {
        console.error('Gagal memuat peran pengguna:', e);
      }
    })();
    return () => { batal = true; };
  }, []);

  // Batalkan permintaan yang masih berjalan saat halaman ditutup.
  useEffect(() => () => {
    bataRef.current?.abort();
  }, []);

  useEffect(() => {
    const kata = search.trim();
    if (cariAktif === kata) return;
    // Navigasi tanggal/status/halaman tidak menimpa ketikan; gunakan filter terbaru saat jeda berakhir.
    const jeda = setTimeout(() => {
      setCariAktif(kata);
      setPage(0);
      if (page > 0) tulisUrl({ tanggal: filterTanggal, status: filterStatus, page: 0 });
    }, JEDA_CARI_MS);
    return () => clearTimeout(jeda);
  }, [search, cariAktif, page, filterTanggal, filterStatus, tulisUrl]);

  const ubahCari = (nilai: string) => {
    setSearch(nilai);
  };

  const ubahStatus = (s: FilterStatus) => {
    const kata = search.trim();
    setCariAktif(kata);
    setFilterStatus(s);
    setPage(0);
    tulisUrl({ tanggal: filterTanggal, status: s, page: 0 });
  };

  const ubahHalaman = (p: number) => {
    setPage(p);
    tulisUrl({ tanggal: filterTanggal, status: filterStatus, page: p });
  };

  const ubahTanggal = (nilai: string) => {
    if (!nilai) return; // kolom dikosongkan: pertahankan tanggal yang tampil
    if (!tanggalDalamJendela(nilai, jendela)) {
      setPesanTanggal(pesanJendelaTanggal(jendela));
      return;
    }
    const kata = search.trim();
    setCariAktif(kata);
    setPesanTanggal(null);
    setFilterTanggal(nilai);
    setPage(0);
    tulisUrl({ tanggal: nilai, status: filterStatus, page: 0 });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  // Fase 3: data menyegarkan sendiri via realtime + polling cadangan 30 dtk.
  // visit = arsip baca-saja sejak WP-24 (tak pernah berubah lagi): dengarkan tiket_antrean + penanganan (tabel yang
  // bergerak di alur FO/antrean; kunjungan sendiri tidak ada di publikasi realtime, perubahannya terjemput polling).
  useRealtimeRefetch(muatSenyap, { tables: ['tiket_antrean', 'penanganan'], pollMs: 30_000 });

  const getTiket = (k: KunjunganRow): TiketData | null => {
    const arr = Array.isArray(k.tiket_antrean) ? k.tiket_antrean : (k.tiket_antrean ? [k.tiket_antrean] : []);
    return arr[0] ?? null;
  };

  const getLayananNama = (k: KunjunganRow): string => {
    const t = getTiket(k);
    if (!t?.layanan) return '—';
    if (Array.isArray(t.layanan)) return t.layanan[0]?.nama || '—';
    return t.layanan.nama || '—';
  };

  const getNomorDisplay = (k: KunjunganRow): string => {
    return getTiket(k)?.nomor_display ?? '—';
  };

  const getWaktuSelesai = (k: KunjunganRow): string | null => {
    return getTiket(k)?.waktu_selesai ?? null;
  };

  // Server menyaring sebelum paginasi (RPC baru); RPC/kueri lama: saring halaman yang tampil di klien.
  const filtered = disaringServer ? kunjungan : kunjungan.filter((k) => {
    const layananNama = getLayananNama(k);
    const matchSearch = k.nama.toLowerCase().includes(search.toLowerCase()) ||
      layananNama.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'semua' || k.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const jam = (iso: string | null) => (iso ? formatWaktu(iso) : '—');
  const adaFilter = cariAktif !== '' || search.trim() !== '' || filterStatus !== 'semua';

  const kolom: KolomTabel<KunjunganRow>[] = [
    {
      kunci: 'no', judul: '#', lebar: '56px', sembunyiDiHp: true,
      render: (_k, i) => <span className={styles.redup}>{page * PAGE_SIZE + i + 1}</span>,
    },
    {
      kunci: 'tiket', judul: 'Nomor antrean',
      render: (k) => <span className={styles.nomor}>{getNomorDisplay(k)}</span>,
    },
    { kunci: 'nama', judul: 'Nama', peran: 'utama', render: (k) => <span className={styles.nama}>{k.nama}</span> },
    { kunci: 'layanan', judul: 'Layanan', render: (k) => getLayananNama(k) },
    { kunci: 'fo', judul: 'Front Office', render: (k) => namaFo[k.id] ?? '—' },
    { kunci: 'masuk', judul: 'Waktu Masuk', render: (k) => jam(k.waktu_masuk) },
    { kunci: 'selesai', judul: 'Waktu Selesai', render: (k) => <span className={styles.redup}>{jam(getWaktuSelesai(k))}</span> },
    {
      kunci: 'status', judul: 'Status',
      render: (k) => {
        const s = NADA_STATUS[k.status];
        return s ? <Lencana nada={s.nada} titik>{s.label}</Lencana> : k.status;
      },
    },
    {
      kunci: 'survei', judul: 'Pesan Perilaku', peran: 'aksi',
      render: (k) =>
        k.status === 'selesai' && statusSurvei.get(k.id) ? (
          <div className={styles.survei}>
            <SurveiStatusBadge status={statusSurvei.get(k.id) as StatusSurvei} />
            {statusSurvei.get(k.id) === 'belum_diisi' && (
              <Tombol
                varian="sekunder"
                ukuran="kecil"
                ikon={QrCode}
                onClick={() => setQrKunjunganId(k.id)}
                aria-label={`Tampilkan QR Pesan Perilaku untuk ${k.nama}`}
              >
                Tampilkan QR
              </Tombol>
            )}
          </div>
        ) : (
          '—'
        ),
    },
  ];

  const kosong = adaFilter ? (
    <StatusKosong
      ikon={Search}
      judul="Tidak ada kunjungan yang cocok"
      isi="Belum ada kunjungan yang sesuai pencarian atau status yang dipilih. Ubah filter untuk melihat yang lain."
    />
  ) : (
    <StatusKosong
      ikon={Users}
      judul="Belum ada kunjungan"
      isi="Belum ada pengunjung yang tercatat pada tanggal ini."
    />
  );

  return (
    <>
      <PageHeader
        title="Kunjungan"
        description="Daftar pengunjung yang tercatat pada tanggal yang dipilih (WIB)"
      >
        <Tombol
          varian="sekunder"
          ikon={RefreshCw}
          onClick={() => { void muatSenyap(); }}
          disabled={menyegarkan}
          memuat={menyegarkan}
        >
          Refresh
        </Tombol>
      </PageHeader>

      <IsiHalaman>
        <CatatanKeadaan jenis="info">Penyelesaian layanan dilakukan di menu Antrean.</CatatanKeadaan>

        <Kartu padding="rapat" as="div" className={styles.alat}>
          <div className={styles.filter}>
            <div className={styles.cari}>
              <Search size={16} strokeWidth={1.75} className={styles.cariIkon} aria-hidden="true" />
              <input
                type="text"
                className={styles.cariInput}
                placeholder="Cari nama atau layanan..."
                aria-label="Cari nama atau layanan"
                value={search}
                maxLength={BATAS_CARI}
                onChange={(e) => ubahCari(e.target.value)}
              />
            </div>

            <PemilihTanggal
              nilai={filterTanggal}
              onUbah={ubahTanggal}
              label="Tanggal kunjungan"
              min={jendela?.min}
              max={jendela?.max}
              aria-describedby={pesanTanggal ? 'pesan-tanggal-kunjungan' : undefined}
            />

            <div className={styles.status} role="group" aria-label="Filter status">
              {DAFTAR_STATUS.map((s) => (
                <Tombol
                  key={s}
                  varian={filterStatus === s ? 'utama' : 'sekunder'}
                  ukuran="kecil"
                  aria-pressed={filterStatus === s}
                  onClick={() => ubahStatus(s)}
                >
                  {LABEL_FILTER[s]}
                </Tombol>
              ))}
            </div>
          </div>

          {pesanTanggal && (
            <p id="pesan-tanggal-kunjungan" role="alert" className={styles.pesanTanggal}>
              {pesanTanggal}
            </p>
          )}

          {disaringServer && (cariAktif !== '' || filterStatus !== 'semua') && !loading && !galatMuat && (
            <p role="status" className={styles.ringkas}>
              {totalCount} kunjungan sesuai filter
            </p>
          )}
        </Kartu>

        {galatSegar && !galatMuat && (
          <CatatanKeadaan jenis="galat">
            Pembaruan terakhir gagal; daftar di bawah mungkin belum terbaru.
          </CatatanKeadaan>
        )}

        {galatMuat ? (
          <Kartu as="div">
            <Galat pesan={galatMuat} onRetry={() => { void loadData(); }} memuat={loading} />
          </Kartu>
        ) : (
          <Kartu padding="tanpa" as="div">
            <div aria-busy={menyegarkan || undefined}>
              <Tabel
                kolom={kolom}
                baris={filtered}
                kunciBaris="id"
                caption="Daftar kunjungan"
                memuat={loading}
                kosong={kosong}
                kartuDiHp
              />
            </div>
            {!loading && <Pagination page={page} pageSize={PAGE_SIZE} total={totalCount} onPageChange={ubahHalaman} />}
          </Kartu>
        )}
      </IsiHalaman>

      {qrKunjunganId && (
        <SurveiQrDialog key={qrKunjunganId} kunjunganId={qrKunjunganId} onTutup={() => setQrKunjunganId(null)} />
      )}
    </>
  );
}
