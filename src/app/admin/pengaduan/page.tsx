'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlarmClock, Inbox, ShieldAlert, UserCheck } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import PanelPengaduan from '@/components/admin/PanelPengaduan';
import Pagination from '@/components/Pagination';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Galat from '@/components/ui/Galat';
import Kartu from '@/components/ui/Kartu';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Tab from '@/components/ui/Tab';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import Tombol from '@/components/ui/Tombol';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { tampilWaktuLaporan } from '@/lib/waktu-anonim';
import {
  STATUS_LABEL, STATUS_PENJELASAN, filterValid, namaPelapor, ringkasIsi, statusTertutup, teksBatas, teksSisaHariKerja,
  type FilterPengaduan, type PengaduanKerja, type RingkasanPengaduan,
} from '@/lib/pengaduan/tampilan';
import styles from './pengaduan.module.css';

// Dashboard pengaduan untuk Admin dan Front Office (petugas layanan hanya membaca layanannya sendiri).
// Ringkasan angka = filter; tabel kerja; klik baris membuka panel rincian dengan satu formulir aksi.
// SLA dihitung di server dalam hari kerja (view v_pengaduan_kerja, migrasi 202611030013); jalur integritas hanya Admin (I-15).

const PAGE_SIZE = 50;

const NADA_STATUS: Record<string, NadaLencana> = {
  baru: 'info',
  diverifikasi: 'info',
  diproses: 'primer',
  eskalasi: 'peringatan',
  selesai: 'sukses',
  ditolak: 'netral',
};

type Jalur = 'layanan' | 'integritas';

const KETERANGAN_FILTER: Record<FilterPengaduan, string> = {
  aktif: 'Menampilkan pengaduan yang perlu ditindaklanjuti. Yang batasnya paling dekat ada di atas.',
  baru: 'Menampilkan pengaduan baru yang belum ada penanganannya.',
  diproses: 'Menampilkan pengaduan yang sedang diproses.',
  mendekati: 'Menampilkan pengaduan yang batasnya tinggal 2 hari kerja atau kurang.',
  terlambat: 'Menampilkan pengaduan yang melewati batas hari kerja.',
  selesai: 'Menampilkan pengaduan yang sudah selesai atau ditolak.',
  arsip: 'Menampilkan pengaduan yang sudah selesai atau ditolak.',
  semua: 'Menampilkan semua pengaduan, yang butuh tindakan di atas.',
};

type StatusMuat = 'memuat' | 'siap' | 'galat' | 'izin';

function IsiPengaduan() {
  const { toast } = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const [rows, setRows] = useState<PengaduanKerja[]>([]);
  const [status, setStatus] = useState<StatusMuat>('memuat');
  // A13: saringan hidup di URL (?jalur=&filter=&halaman=) supaya bertahan saat muat ulang dan bisa dibagikan.
  const [tab, setTab] = useState<Jalur>(sp?.get('jalur') === 'integritas' ? 'integritas' : 'layanan');
  const [filter, setFilter] = useState<FilterPengaduan>(filterValid(sp?.get('filter')));
  const [userRole, setUserRole] = useState<string | null>(null);
  const [sayaId, setSayaId] = useState<string | null>(null);
  const [pesanGalat, setPesanGalat] = useState('');
  const [page, setPage] = useState(() => {
    const n = Number.parseInt(sp?.get('halaman') ?? '', 10);
    return Number.isFinite(n) && n > 1 ? n - 1 : 0;
  });
  const [total, setTotal] = useState(0);
  const [ringkasan, setRingkasan] = useState<RingkasanPengaduan | null>(null);
  const [fiturKerja, setFiturKerja] = useState(true);
  const [terpilih, setTerpilih] = useState<PengaduanKerja | null>(null);
  const [sibukTangani, setSibukTangani] = useState<string | null>(null);
  const pemicuRef = useRef<HTMLElement | null>(null);
  const urutan = useRef(0);

  const load = useCallback(async () => {
    // Hanya respons untuk permintaan terakhir yang boleh memperbarui state (filter/tab/halaman bisa berganti cepat).
    const saya = ++urutan.current;
    setStatus('memuat');
    setPesanGalat('');
    try {
      const res = await fetch(`/api/admin/pengaduan?jalur=${tab}&filter=${filter}&page=${page}&page_size=${PAGE_SIZE}`);
      const json = await res.json().catch(() => ({}));
      if (saya !== urutan.current) return;
      if (res.status === 401 || res.status === 403) { setRows([]); setStatus('izin'); return; }
      if (!res.ok) { setPesanGalat(json.error ?? 'Pengaduan tidak dapat dimuat.'); setRows([]); setStatus('galat'); return; }
      setRows((json.rows ?? []) as PengaduanKerja[]);
      setTotal(json.total ?? 0);
      setRingkasan((json.ringkasan ?? null) as RingkasanPengaduan | null);
      setFiturKerja(json.fitur?.kerja !== false);
      setStatus('siap');
    } catch {
      if (saya !== urutan.current) return;
      setPesanGalat('Gangguan jaringan. Pengaduan tidak dapat dimuat.');
      setRows([]);
      setStatus('galat');
    }
  }, [tab, filter, page]);

  const loadRole = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from('petugas').select('id, role').eq('auth_user_id', user.id).maybeSingle();
      if (p) { setUserRole(p.role); setSayaId((p as { id?: string }).id ?? null); }
    } catch { /* abaikan: peran belum terbukti = paling terbatas */ }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadRole);
  }, [loadRole]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  // Peran belum terbukti -> paling terbatas. Admin: semua jalur; FO: jalur layanan; petugas: baca saja.
  const isAdmin = userRole === 'admin';
  const isPetugas = userRole === 'petugas';
  const tinjau = isAdmin || userRole === 'front_office';

  // Sinkronkan juga navigasi URL dari riwayat/perubahan tautan tanpa menonaktifkan aturan hooks.
  const parameterUrl = sp?.toString() ?? '';
  useEffect(() => {
    let batal = false;
    void Promise.resolve().then(() => {
      if (batal) return;
      const parameter = new URLSearchParams(parameterUrl);
      const nomor = Number.parseInt(parameter.get('halaman') ?? '', 10);
      setTab(parameter.get('jalur') === 'integritas' ? 'integritas' : 'layanan');
      setFilter(filterValid(parameter.get('filter')));
      setPage(Number.isFinite(nomor) && nomor > 1 ? nomor - 1 : 0);
    });
    return () => { batal = true; };
  }, [parameterUrl]);

  const tulisUrl = (t: Jalur, f: FilterPengaduan, h: number) => {
    const qs = new URLSearchParams(parameterUrl);
    if (t !== 'layanan') qs.set('jalur', t); else qs.delete('jalur');
    if (f !== 'aktif') qs.set('filter', f); else qs.delete('filter');
    if (h > 0) qs.set('halaman', String(h + 1)); else qs.delete('halaman');
    const teks = qs.toString();
    router.replace(`${window.location.pathname}${teks ? `?${teks}` : ''}`, { scroll: false });
  };
  const ubahFilter = (f: FilterPengaduan) => { setFilter(f); setPage(0); tulisUrl(tab, f, 0); };
  const ubahTab = (t: Jalur) => { setTab(t); setFilter('aktif'); setPage(0); setTerpilih(null); tulisUrl(t, 'aktif', 0); };
  const ubahHalaman = (h: number) => { setPage(h); tulisUrl(tab, filter, h); };

  const buka = (r: PengaduanKerja, el: HTMLElement | null) => { pemicuRef.current = el; setTerpilih(r); };
  const tutupPanel = () => { setTerpilih(null); pemicuRef.current?.focus?.(); };

  // Setelah aksi: muat ulang daftar dan segarkan baris yang sedang dibuka (baris bisa pindah dari filter aktif).
  const setelahBerubah = useCallback(async (id: string) => {
    void load();
    try {
      const res = await fetch(`/api/admin/pengaduan?jalur=${tab}&id=${id}&page=0&page_size=1`);
      if (!res.ok) return;
      const json = await res.json().catch(() => ({}));
      const baru = (json.rows ?? [])[0] as PengaduanKerja | undefined;
      if (baru) setTerpilih((lama) => (lama && lama.id === id ? baru : lama));
    } catch { /* biarkan tampilan lama; daftar sudah dimuat ulang */ }
  }, [load, tab]);

  const tangani = async (r: PengaduanKerja) => {
    setSibukTangani(r.id);
    try {
      const res = await fetch(`/api/admin/pengaduan/${r.id}/tangani`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json.kode === 'PENANGAN_SUDAH_ADA' ? `Pengaduan ini sudah ditangani ${json.penangan_nama ?? 'orang lain'}.` : (json.error ?? 'Gagal menangani pengaduan'), 'error');
        void load();
        return;
      }
      toast('Anda sekarang menangani pengaduan ini', 'success');
      void load();
    } catch {
      // Jaringan putus: hasil tidak diketahui (penangan mungkin sudah tersimpan), jadi muat ulang agar tampilan jujur.
      toast('Gangguan jaringan. Penangan mungkin belum tersimpan; periksa daftar lalu coba lagi.', 'error');
      void load();
    } finally {
      setSibukTangani(null);
    }
  };

  const tile = (nilai: FilterPengaduan, label: string, jumlah: number | null, kelasAngka?: string, bantuan?: string) => (
    <button
      key={nilai}
      type="button"
      className={`${styles.tile} ${filter === nilai ? styles.tileAktif : ''}`}
      aria-pressed={filter === nilai}
      title={bantuan}
      onClick={() => ubahFilter(nilai)}
    >
      <span className={styles.tileLabel}>{label}</span>
      {jumlah !== null && <span className={`${styles.angka} ${kelasAngka ?? ''}`}>{jumlah}</span>}
    </button>
  );

  const r = status === 'galat' || status === 'izin' ? null : ringkasan;

  const kolom: KolomTabel<PengaduanKerja>[] = [
    {
      kunci: 'nomor', judul: 'Nomor', peran: 'utama',
      render: (row) => (
        <>
          <button
            type="button"
            className={styles.tautanNomor}
            aria-label={`Buka rincian pengaduan ${row.nomor_tiket}`}
            onClick={(e) => buka(row, e.currentTarget)}
          >
            {row.nomor_tiket}
          </button>
          {row.jalur === 'integritas' && (
            <span className={styles.sub}><Lencana nada="bahaya" ikon={ShieldAlert}>Integritas</Lencana></span>
          )}
        </>
      ),
    },
    {
      kunci: 'layanan', judul: 'Layanan',
      render: (row) => <span title={row.layanan_nama ?? undefined}>{row.layanan_nama ?? (row.layanan_id ? '-' : 'Umum')}</span>,
    },
    { kunci: 'isi', judul: 'Isi', render: (row) => <span className={styles.ringkas} title={row.isi}>{ringkasIsi(row.isi)}</span> },
    ...(tinjau ? [{ kunci: 'pelapor', judul: 'Pelapor', render: (row: PengaduanKerja) => namaPelapor(row) }] : []),
    { kunci: 'masuk', judul: 'Masuk', render: (row) => <span className={styles.waktu}>{tampilWaktuLaporan(row.created_at, row.anonim)}</span> },
    {
      kunci: 'batas', judul: 'Batas',
      render: (row) => {
        const sisa = teksSisaHariKerja(row.sisa_hari_kerja, row.sla_status);
        return (
          <>
            <span className={styles.waktu}>{teksBatas(row)}</span>
            {sisa && (
              <span className={styles.sub}>
                {row.sla_status === 'terlambat' ? <Lencana nada="bahaya" ikon={AlarmClock}>{sisa}</Lencana>
                  : row.sla_status === 'mendekati' ? <Lencana nada="peringatan" ikon={AlarmClock}>{sisa}</Lencana>
                    : <Lencana nada="sukses">{sisa}</Lencana>}
              </span>
            )}
          </>
        );
      },
    },
    {
      kunci: 'status', judul: 'Status',
      render: (row) => (
        <span title={STATUS_PENJELASAN[row.status]}>
          <Lencana nada={NADA_STATUS[row.status] ?? 'netral'} titik>{STATUS_LABEL[row.status] ?? row.status}</Lencana>
        </span>
      ),
    },
    ...(tinjau ? [{
      kunci: 'penangan', judul: 'Penangan', peran: 'aksi' as const,
      render: (row: PengaduanKerja) => {
        const bisaTangani = fiturKerja && !row.penangan_id && !statusTertutup(row.status);
        return row.penangan_id
          ? <span className={styles.penangan}><UserCheck size={14} aria-hidden="true" /> {row.penangan_id === sayaId ? 'Anda' : (row.penangan_nama ?? 'Petugas lain')}</span>
          : bisaTangani
            ? <Tombol ukuran="kecil" varian="sekunder" memuat={sibukTangani === row.id} disabled={sibukTangani !== null} onClick={() => void tangani(row)}>Tangani</Tombol>
            : <span className={styles.mati}>{fiturKerja ? 'Belum ada' : '-'}</span>;
      },
    }] : []),
  ];

  return (
    <div className={styles.halaman}>
      <PageHeader title="Pengaduan" description="Laporan dari pengunjung. Yang perlu ditindaklanjuti tampil paling atas." />
      <div className={styles.isi}>
        {isPetugas && (
          <CatatanKeadaan jenis="lingkup">
            Anda hanya dapat melihat pengaduan layanan Anda. Hubungi Admin/Front Office untuk tindak lanjut.
          </CatatanKeadaan>
        )}

        {isAdmin && (
          <Tab
            label="Jalur pengaduan"
            aktif={tab}
            onGanti={(k) => ubahTab(k as Jalur)}
            tab={[
              { kunci: 'layanan', label: 'Pengaduan Layanan' },
              { kunci: 'integritas', label: 'Integritas (rahasia)' },
            ]}
          />
        )}

        {tinjau && (
          <>
            <div className={styles.ringkasan} role="group" aria-label="Ringkasan pengaduan, tekan untuk menyaring">
              {tile('aktif', 'Butuh tindakan', r ? r.baru + r.diproses : null)}
              {tile('baru', 'Baru', r ? r.baru : null, undefined, STATUS_PENJELASAN.baru)}
              {tile('diproses', 'Sedang diproses', r ? r.diproses : null, undefined, STATUS_PENJELASAN.diproses)}
              {r && tile('mendekati', 'Mendekati batas', r.mendekati, styles.angkaMendekati, 'Batas tinggal 2 hari kerja atau kurang')}
              {r && tile('terlambat', 'Terlambat', r.terlambat, styles.angkaTerlambat, 'Melewati batas hari kerja')}
              {tile('arsip', 'Selesai', r ? r.selesai + r.ditolak : null, undefined, 'Selesai dan ditolak')}
              {tile('semua', 'Semua', null)}
            </div>
            <p className={styles.keterangan} aria-live="polite">{KETERANGAN_FILTER[filter]}</p>
            {!fiturKerja && status === 'siap' && (
              <CatatanKeadaan jenis="menunggu-migrasi">
                Penangan dan hitungan batas hari kerja belum aktif karena pembaruan basis data belum diterapkan. Daftar dan tanggapan tetap dapat dipakai.
              </CatatanKeadaan>
            )}
          </>
        )}

        {status === 'galat' && <Galat pesan={pesanGalat} onRetry={() => void load()} />}
        {status === 'izin' && (
          <CatatanKeadaan jenis="galat">Anda tidak memiliki izin untuk melihat halaman ini.</CatatanKeadaan>
        )}

        {status === 'memuat' && rows.length === 0 ? (
          <Kartu padding="normal">
            <div role="status">
              <Skeleton bentuk="baris" jumlah={6} label="Memuat pengaduan…" />
            </div>
          </Kartu>
        ) : status === 'siap' && rows.length === 0 ? (
          <Kartu>
            <StatusKosong
              ikon={Inbox}
              judul={filter === 'aktif' || !tinjau ? 'Belum ada pengaduan yang perlu ditindaklanjuti.' : 'Tidak ada pengaduan pada saringan ini.'}
              isi={filter !== 'aktif' && tinjau ? 'Pilih saringan lain di atas untuk melihat pengaduan yang lain.' : undefined}
            />
          </Kartu>
        ) : rows.length > 0 ? (
          <Kartu padding="tanpa">
            <div aria-busy={status === 'memuat'}>
              <Tabel
                caption="Daftar pengaduan"
                kolom={kolom}
                baris={rows}
                kunciBaris="id"
                kartuDiHp
              />
              <div className={styles.pagination}>
                <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={ubahHalaman} />
              </div>
            </div>
          </Kartu>
        ) : null}
      </div>

      {terpilih && (
        <PanelPengaduan
          key={terpilih.id}
          row={terpilih}
          mode={tinjau ? 'tinjau' : 'baca'}
          sayaId={sayaId}
          fiturKerja={fiturKerja}
          onClose={tutupPanel}
          onBerubah={() => void setelahBerubah(terpilih.id)}
          onToast={toast}
        />
      )}
    </div>
  );
}

export default function AdminPengaduanPage() {
  return (
    <Suspense fallback={<div role="status"><Skeleton bentuk="baris" jumlah={6} label="Memuat pengaduan…" /></div>}>
      <IsiPengaduan />
    </Suspense>
  );
}
