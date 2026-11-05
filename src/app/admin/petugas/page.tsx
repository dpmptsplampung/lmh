'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { UserPlus, Copy, AlertTriangle, Check, Loader2, Users, UserCheck, UserX, LogIn, Search, SearchX, Mail } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import Lencana from '@/components/ui/Lencana';
import Tombol from '@/components/ui/Tombol';
import Field from '@/components/ui/Field';
import Skeleton from '@/components/ui/Skeleton';
import Galat from '@/components/ui/Galat';
import StatusKosong from '@/components/ui/StatusKosong';
import { formatTanggal, formatWaktu } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import AkunForm, { AkunDialog, type AkunRow, type LayananOption } from '@/components/admin/AkunForm';
import AkunBaruForm, { type AkunBaruInput } from '@/components/admin/AkunBaruForm';
import styles from './petugas.module.css';

type Dialog =
  | { kind: 'kelola'; akun: AkunRow }
  | { kind: 'edit'; akun: AkunRow }
  | { kind: 'cabutKoordinator'; akun: AkunRow }
  | { kind: 'reset'; akun: AkunRow }
  | { kind: 'sandi'; akun: AkunRow; sandi: string }
  | { kind: 'status'; akun: AkunRow }
  | { kind: 'baru' }
  | { kind: 'sandiBaru'; nama: string; username: string; sandi: string }
  | null;

const ROLE_LABEL = { admin: 'Admin', petugas: 'Petugas', front_office: 'Front Office' } as const;

// Waktu login selalu WIB (formatTanggal/formatWaktu), bukan zona perangkat.
const fmtLogin = (iso: string | null) =>
  iso ? `${formatTanggal(iso, { month: 'short' })} ${formatWaktu(iso)}` : 'Belum ada';

type FilterStatus = 'semua' | 'aktif' | 'nonaktif';
const FILTER_STATUS: { nilai: FilterStatus; label: string }[] = [
  { nilai: 'semua', label: 'Semua' },
  { nilai: 'aktif', label: 'Aktif' },
  { nilai: 'nonaktif', label: 'Nonaktif' },
];

interface Kelompok {
  kunci: string;
  judul: string;
  akun: AkunRow[];
}

/** Admin, Front Office, lalu satu kelompok per Layanan untuk Petugas (urut abjad). Kelompok kosong tidak dibuat. */
function kelompokkan(rows: AkunRow[]): Kelompok[] {
  const urutNama = (a: AkunRow, b: AkunRow) => a.nama.localeCompare(b.nama, 'id');
  const hasil: Kelompok[] = [];
  const admin = rows.filter((r) => r.role === 'admin').sort(urutNama);
  const fo = rows.filter((r) => r.role === 'front_office').sort(urutNama);
  if (admin.length) hasil.push({ kunci: 'admin', judul: 'Admin', akun: admin });
  if (fo.length) hasil.push({ kunci: 'front_office', judul: 'Front Office', akun: fo });
  const perLayanan = new Map<string, Kelompok>();
  for (const r of rows.filter((x) => x.role === 'petugas')) {
    const judul = r.layanan_nama ?? 'Petugas tanpa layanan';
    const kunci = `layanan:${r.layanan_id ?? 'kosong'}`;
    const k = perLayanan.get(kunci) ?? { kunci, judul, akun: [] };
    k.akun.push(r);
    perLayanan.set(kunci, k);
  }
  const kelompokLayanan = [...perLayanan.values()].sort((a, b) => a.judul.localeCompare(b.judul, 'id'));
  for (const k of kelompokLayanan) hasil.push({ ...k, akun: k.akun.sort(urutNama) });
  return hasil;
}

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Permintaan gagal');
  return json;
}

// Server membalas ok + `peringatan` bila perubahan SUDAH tersimpan tetapi langkah lanjutan gagal (mis. sesi/blokir Auth
// tak berhasil diakhiri). Itu bukan sukses penuh: tampilkan jelas sebagai peringatan, bukan hanya toast sukses.
function peringatanServer(json: unknown): string | null {
  const p = (json as { peringatan?: unknown } | null)?.peringatan;
  return typeof p === 'string' && p.trim() ? p : null;
}

export default function AdminPetugasPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AkunRow[]>([]);
  const [layananList, setLayananList] = useState<LayananOption[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const dialogRef = useRef<Dialog>(null);
  useEffect(() => { dialogRef.current = dialog; }, [dialog]);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [alasan, setAlasan] = useState('');
  // Fase 3: penanda Koordinator tersedia setelah migrasi 202610290001 (server mengirim koordinator_tersedia).
  const [koordinatorTersedia, setKoordinatorTersedia] = useState(false);
  const [mengubahKoordinator, setMengubahKoordinator] = useState<string | null>(null);
  // Saklar Operator harian tersedia setelah migrasi 202611030014 (server mengirim operator_aktif_tersedia).
  const [operatorTersedia, setOperatorTersedia] = useState(false);
  const [mengubahOperator, setMengubahOperator] = useState(false);
  const [galatOperator, setGalatOperator] = useState('');
  const [cari, setCari] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('semua');

  const load = useCallback(async () => {
    try {
      const [daftar, layanan, me] = await Promise.all([
        api('/api/admin/petugas', 'GET'),
        createClient().from('layanan').select('id, nama').order('nama'),
        api('/api/me/profil', 'GET').catch(() => null),
      ]);
      setRows((daftar.akun ?? []) as AkunRow[]);
      setKoordinatorTersedia(daftar.koordinator_tersedia === true);
      setOperatorTersedia(daftar.operator_aktif_tersedia === true);
      setLayananList((layanan?.data ?? []) as LayananOption[]);
      setSelfId(me?.profil?.id ?? null);
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Gagal memuat daftar akun');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const aktifAdminCount = rows.filter((r) => r.role === 'admin' && r.aktif).length;
  const kelompok = useMemo(() => {
    const kata = cari.trim().toLowerCase();
    const cocok = (r: AkunRow) =>
      (filterStatus === 'semua' || (filterStatus === 'aktif') === r.aktif) &&
      (!kata || r.nama.toLowerCase().includes(kata) || (r.username ?? '').toLowerCase().includes(kata));
    return kelompokkan(rows.filter(cocok));
  }, [rows, cari, filterStatus]);
  const totalTampil = kelompok.reduce((n, k) => n + k.akun.length, 0);
  const tutup = useCallback(() => {
    setDialog(null);
    setDialogError('');
    setGalatOperator('');
    setAlasan('');
  }, []);

  // Saklar Operator harian: body khusus {operator_aktif}; keadaan baru dibaca dari server (muat ulang), bukan ditebak.
  const ubahOperator = async (akun: AkunRow) => {
    const baru = !akun.operator_aktif;
    setMengubahOperator(true);
    setGalatOperator('');
    try {
      await api(`/api/admin/petugas/${akun.id}`, 'PATCH', { operator_aktif: baru });
      toast(
        baru
          ? `Operator harian diaktifkan untuk ${akun.nama}.`
          : `Operator harian dinonaktifkan untuk ${akun.nama}.`,
        'success',
      );
      await load();
    } catch (e) {
      setGalatOperator(e instanceof Error ? e.message : 'Gagal mengubah Operator harian');
    } finally {
      setMengubahOperator(false);
    }
  };

  const jalankan = async (fn: () => Promise<void>) => {
    setBusy(true);
    setDialogError('');
    try {
      await fn();
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : 'Gagal');
    } finally {
      setBusy(false);
    }
  };

  const simpanEdit = (akun: AkunRow, patch: Record<string, string | null>) =>
    jalankan(async () => {
      const json = await api(`/api/admin/petugas/${akun.id}`, 'PATCH', patch);
      toast('Akun diperbarui.', 'success');
      const peringatan = peringatanServer(json);
      if (peringatan) toast(peringatan, 'warning');
      tutup();
      await load();
    });

  // Penanda Koordinator (spec §6.1): memperluas lingkup DATA akun FO/Petugas Layanan; role dan operasional tetap.
  const ubahKoordinator = async (akun: AkunRow) => {
    const baru = !akun.koordinator;
    setMengubahKoordinator(akun.id);
    try {
      await api(`/api/admin/petugas/${akun.id}/koordinator`, 'PATCH', { koordinator: baru });
      toast(baru ? `${akun.nama} kini Koordinator.` : `Status Koordinator ${akun.nama} dicabut.`, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengubah status Koordinator', 'error');
    } finally {
      setMengubahKoordinator(null);
      // Tutup hanya dialog konfirmasi pencabutan akun ini; dialog lain (mis. Ubah data akun lain) dibiarkan.
      const d = dialogRef.current;
      if (d?.kind === 'cabutKoordinator' && d.akun.id === akun.id) tutup();
    }
  };

  const buatAkun = (data: AkunBaruInput) =>
    jalankan(async () => {
      const json = await api('/api/admin/petugas', 'POST', data);
      setDialog({ kind: 'sandiBaru', nama: data.nama, username: json.username ?? data.username, sandi: json.sandi_sementara });
      await load();
    });

  const resetSandi = (akun: AkunRow) =>
    jalankan(async () => {
      const json = await api(`/api/admin/petugas/${akun.id}/reset-password`, 'POST');
      setDialog({ kind: 'sandi', akun, sandi: json.sandi_sementara });
      await load();
    });

  const ubahStatus = (akun: AkunRow) =>
    jalankan(async () => {
      if (akun.aktif && !alasan.trim()) throw new Error('Alasan wajib diisi.');
      const json = await api('/api/admin/petugas/status', 'POST',
        akun.aktif
          ? { aksi: 'nonaktifkan', petugas_id: akun.id, alasan: alasan.trim() }
          : { aksi: 'aktifkan', petugas_id: akun.id });
      toast(akun.aktif ? `Akun ${akun.nama} dinonaktifkan.` : `Akun ${akun.nama} diaktifkan kembali.`, 'success');
      const peringatan = peringatanServer(json);
      if (peringatan) toast(peringatan, 'warning');
      tutup();
      await load();
    });

  const salin = async (teks: string) => {
    try {
      await navigator.clipboard.writeText(teks);
      toast('Disalin.', 'success');
    } catch {
      toast('Gagal menyalin. Salin manual.', 'error');
    }
  };

  const kolomAkun = (): KolomTabel<AkunRow>[] => [
    {
      kunci: 'akun',
      judul: 'Akun',
      judulBaris: true,
      render: (row) => (
        <span className={styles.akun}>
          <span className={styles.akunNama}>{row.nama}{row.id === selfId ? ' (Anda)' : ''}</span>
          <span className={styles.akunSub}>{row.username ?? 'Belum ada nama pengguna'}</span>
        </span>
      ),
    },
    {
      kunci: 'status',
      judul: 'Status',
      render: (row) => (
        <Lencana nada={row.aktif ? 'sukses' : 'netral'} titik>{row.aktif ? 'Aktif' : 'Nonaktif'}</Lencana>
      ),
    },
    {
      kunci: 'login',
      judul: 'Terakhir login',
      sembunyiDiHp: true,
      render: (row) =>
        row.belum_pernah_login
          ? <Lencana nada="peringatan">Belum pernah login</Lencana>
          : <span className={styles.kolLogin}>{fmtLogin(row.last_sign_in_at)}</span>,
    },
    ...(koordinatorTersedia
      ? [{
          kunci: 'koordinator',
          judul: 'Koordinator',
          render: (row: AkunRow) =>
            row.role !== 'admin' ? (
              <button type="button"
                className={`${styles.koordinator} ${row.koordinator ? styles.koordinatorNyala : ''}`}
                aria-pressed={!!row.koordinator}
                aria-label={`Koordinator ${row.nama}`}
                disabled={mengubahKoordinator === row.id}
                onClick={() => (row.koordinator ? setDialog({ kind: 'cabutKoordinator', akun: row }) : ubahKoordinator(row))}>
                {row.koordinator && <Check size={14} aria-hidden="true" />}
                Koordinator
              </button>
            ) : null,
        } as KolomTabel<AkunRow>]
      : []),
    {
      kunci: 'aksi',
      judul: <span className="sr-only">Aksi</span>,
      labelHp: 'Aksi',
      peran: 'aksi',
      render: (row) => {
        const isSelf = row.id === selfId;
        const adminTerakhir = row.role === 'admin' && row.aktif && aktifAdminCount <= 1;
        const blokirNonaktif = row.aktif && (isSelf || adminTerakhir);
        return <div className={styles.aksiBaris}>
          <Tombol varian="sekunder" ukuran="kecil" aria-label={`Ubah ${row.nama}`}
            onClick={() => setDialog({ kind: 'edit', akun: row })}>Ubah</Tombol>
          <Tombol varian="hantu" ukuran="kecil" aria-label={`Reset sandi ${row.nama}`} disabled={isSelf}
            title={isSelf ? 'Gunakan Profil Saya untuk mengganti sandi sendiri' : undefined}
            onClick={() => setDialog({ kind: 'reset', akun: row })}>Reset sandi</Tombol>
          <Tombol varian={row.aktif ? 'bahaya' : 'sekunder'} ukuran="kecil"
            aria-label={`${row.aktif ? 'Nonaktifkan' : 'Aktifkan'} ${row.nama}`} disabled={blokirNonaktif}
            title={blokirNonaktif ? (isSelf ? 'Anda tidak bisa menonaktifkan akun sendiri' : 'Admin aktif terakhir tidak bisa dinonaktifkan') : undefined}
            onClick={() => setDialog({ kind: 'status', akun: row })}>{row.aktif ? 'Nonaktifkan' : 'Aktifkan'}</Tombol>
          <Tombol varian="hantu" ukuran="kecil" aria-label={`Kelola ${row.nama}`}
            onClick={() => { setGalatOperator(''); setDialog({ kind: 'kelola', akun: row }); }}>Kelola</Tombol>
        </div>;
      },
    },
  ];

  const jumlahAktif = rows.filter((r) => r.aktif).length;
  const jumlahBelumLogin = rows.filter((r) => r.belum_pernah_login).length;

  return (
    <>
      <PageHeader
        title="Kelola Akun"
        meta="Waktu ditampilkan dalam WIB"
        description="Akun petugas dan akun layanan: data, reset kata sandi, aktif/nonaktif">
        <Tombol ikon={UserPlus} onClick={() => setDialog({ kind: 'baru' })}>Buat Akun Layanan</Tombol>
        <Tombol varian="sekunder" href="/admin/petugas/invite" ikon={Mail}>Undang Petugas</Tombol>
      </PageHeader>

      <div className={styles.isi}>
        {loading ? (
          <div className={styles.tengah} role="status" aria-label="Memuat">
            <Skeleton bentuk="kartu" jumlah={2} label="Memuat daftar akun" />
          </div>
        ) : loadError ? (
          <Galat pesan={loadError} onRetry={() => { setLoading(true); void load(); }} />
        ) : rows.length === 0 ? (
          <StatusKosong ikon={Users} judul="Belum ada akun terdaftar"
            isi="Buat akun layanan atau undang petugas untuk memulai."
            aksi={<Tombol ikon={UserPlus} onClick={() => setDialog({ kind: 'baru' })}>Buat Akun Layanan</Tombol>} />
        ) : (
          <>
            <div className={styles.statistik}>
              <KartuStatistik label="Total akun" nilai={rows.length} ikon={Users} />
              <KartuStatistik label="Aktif" nilai={jumlahAktif} ikon={UserCheck} />
              <KartuStatistik label="Nonaktif" nilai={rows.length - jumlahAktif} ikon={UserX} />
              <KartuStatistik label="Belum pernah masuk" nilai={jumlahBelumLogin} ikon={LogIn} />
            </div>

            <div className={styles.bilah}>
              <div className={styles.cari}>
                <Field label="Cari akun (nama atau nama pengguna)" className={styles.cariField}>
                  <input
                    type="search"
                    placeholder="Cari nama atau nama pengguna"
                    value={cari}
                    onChange={(e) => setCari(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
              </div>
              <div className={styles.filter} role="group" aria-label="Filter status akun">
                {FILTER_STATUS.map((f) => (
                  <button
                    key={f.nilai}
                    type="button"
                    className={`${styles.filterTombol} ${filterStatus === f.nilai ? styles.filterAktif : ''}`}
                    aria-pressed={filterStatus === f.nilai}
                    onClick={() => setFilterStatus(f.nilai)}>
                    {f.label}
                  </button>
                ))}
              </div>
              <p className={styles.ringkasan} role="status">
                {totalTampil === rows.length ? `${rows.length} akun` : `${totalTampil} dari ${rows.length} akun`}
              </p>
            </div>

            {kelompok.length === 0 ? (
              <StatusKosong ikon={SearchX} judul="Tidak ada akun yang cocok dengan pencarian atau filter ini."
                aksi={<Tombol varian="sekunder" ukuran="kecil" ikon={Search}
                  onClick={() => { setCari(''); setFilterStatus('semua'); }}>
                  Hapus pencarian dan filter
                </Tombol>} />
            ) : (
              kelompok.map((k) => (
                <Kartu key={k.kunci} padding="tanpa"
                  judul={<>{k.judul} <span className={styles.jumlah}>{k.akun.length}</span></>}>
                  <Tabel
                    caption={`Akun ${k.judul}`}
                    kolom={kolomAkun()}
                    baris={k.akun}
                    kunciBaris="id"
                    kelasBaris={(row) => (row.aktif ? undefined : styles.nonaktif)}
                    kartuDiHp
                  />
                </Kartu>
              ))
            )}
          </>
        )}
      </div>

      {dialog?.kind === 'kelola' && (() => {
        const akun = rows.find((r) => r.id === dialog.akun.id) ?? dialog.akun;
        const isSelf = akun.id === selfId;
        const adminTerakhir = akun.role === 'admin' && akun.aktif && aktifAdminCount <= 1;
        const blokirNonaktif = akun.aktif && (isSelf || adminTerakhir);
        return (
          <AkunDialog title={`Kelola akun: ${akun.nama}`} onClose={tutup}
            kaki={
              <>
                <Tombol varian="sekunder" onClick={() => setDialog({ kind: 'edit', akun })}>Ubah data</Tombol>
                <Tombol varian="hantu" disabled={isSelf}
                  title={isSelf ? 'Gunakan Profil Saya untuk mengganti sandi sendiri' : undefined}
                  onClick={() => setDialog({ kind: 'reset', akun })}>
                  Reset sandi
                </Tombol>
                <Tombol varian={akun.aktif ? 'bahaya' : 'sekunder'} disabled={blokirNonaktif}
                  title={blokirNonaktif ? (isSelf ? 'Anda tidak bisa menonaktifkan akun sendiri' : 'Admin aktif terakhir tidak bisa dinonaktifkan') : undefined}
                  onClick={() => setDialog({ kind: 'status', akun })}>
                  {akun.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                </Tombol>
              </>
            }>
            <dl className={styles.rincian}>
              <dt>Nama pengguna</dt><dd>{akun.username ?? 'Belum ada'}</dd>
              <dt>Peran</dt>
              <dd>
                {ROLE_LABEL[akun.role]}{akun.layanan_nama ? `, ${akun.layanan_nama}` : ''}
                {akun.koordinator && akun.role !== 'admin' ? ', Koordinator' : ''}
              </dd>
              <dt>Nomor HP</dt><dd>{akun.no_hp ?? 'Belum diisi'}</dd>
              <dt>Email notifikasi</dt>
              <dd>
                {akun.email_notifikasi_tersamar
                  ? `${akun.email_notifikasi_tersamar} (${akun.email_notifikasi_terverifikasi ? 'terverifikasi' : 'belum terverifikasi'})`
                  : 'Belum diisi'}
              </dd>
              <dt>Terakhir login</dt>
              <dd>{akun.belum_pernah_login ? 'Belum pernah login' : fmtLogin(akun.last_sign_in_at)}</dd>
              <dt>Status</dt>
              <dd>
                {akun.aktif ? 'Aktif' : 'Nonaktif'}
                {!akun.aktif && akun.nonaktif_alasan ? `. Alasan: ${akun.nonaktif_alasan}` : ''}
              </dd>
            </dl>
            {operatorTersedia && (
              <div className={styles.operator}>
                <div className={styles.operatorTeks}>
                  <span id="operator-label" className={styles.operatorJudul}>Operator harian</span>
                  <span id="operator-ket" className={styles.hint}>
                    Pemilik akun boleh mengisi nama petugas yang bertugas hari ini di Profil Saya. Gunakan hanya bila satu akun dipakai bergantian.
                  </span>
                </div>
                <button type="button" role="switch" aria-checked={!!akun.operator_aktif}
                  aria-labelledby="operator-label" aria-describedby="operator-ket"
                  className={`${styles.saklar} ${akun.operator_aktif ? styles.saklarNyala : ''}`}
                  disabled={mengubahOperator} onClick={() => ubahOperator(akun)}>
                  {mengubahOperator ? <Loader2 size={14} className="animate-pulse" aria-hidden="true" /> : akun.operator_aktif ? 'Aktif' : 'Mati'}
                </button>
              </div>
            )}
            {galatOperator && <p className={styles.galat} role="alert">{galatOperator}</p>}
          </AkunDialog>
        );
      })()}

      {dialog?.kind === 'cabutKoordinator' && (
        <AkunDialog title="Cabut status Koordinator" onClose={tutup}
          kaki={
            <>
              <Tombol varian="hantu" onClick={tutup}>Batal</Tombol>
              <Tombol varian="bahaya" memuat={mengubahKoordinator === dialog.akun.id}
                onClick={() => ubahKoordinator(dialog.akun)}>
                Cabut Koordinator
              </Tombol>
            </>
          }>
          <p>
            <strong>{dialog.akun.nama}</strong> hanya akan melihat data yang ditanganinya sendiri.
            Peran dan akses halamannya tidak berubah.
          </p>
        </AkunDialog>
      )}

      {dialog?.kind === 'edit' && (
        <AkunDialog title={`Ubah akun: ${dialog.akun.nama}`} onClose={tutup}>
          <AkunForm
            akun={dialog.akun}
            layananList={layananList}
            isSelf={dialog.akun.id === selfId}
            saving={busy}
            error={dialogError}
            onSubmit={(patch) => simpanEdit(dialog.akun, patch)}
            onCancel={tutup}
          />
        </AkunDialog>
      )}

      {dialog?.kind === 'baru' && (
        <AkunDialog title="Buat akun layanan" onClose={tutup}>
          <AkunBaruForm layananList={layananList} saving={busy} error={dialogError} onSubmit={buatAkun} onCancel={tutup} />
        </AkunDialog>
      )}

      {dialog?.kind === 'sandiBaru' && (
        <AkunDialog title="Akun dibuat" onClose={tutup}
          kaki={<Tombol onClick={tutup}>Selesai</Tombol>}>
          <p>Nama pengguna: <strong>{dialog.username}</strong></p>
          <p role="alert" className={styles.peringatan}>
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Sandi sementara ini hanya ditampilkan sekali dan tidak disimpan. Salin dan berikan ke <strong>{dialog.nama}</strong> lewat jalur aman. Pengguna wajib menggantinya saat masuk pertama kali.</span>
          </p>
          <div className={styles.sandiBaris}>
            <input readOnly value={dialog.sandi} aria-label="Sandi sementara"
              onFocus={(e) => e.currentTarget.select()} className={styles.sandiInput} />
            <Tombol varian="sekunder" ikon={Copy} onClick={() => salin(dialog.sandi)}>Salin</Tombol>
          </div>
        </AkunDialog>
      )}

      {dialog?.kind === 'reset' && (
        <AkunDialog title="Reset kata sandi" onClose={tutup}
          kaki={
            <>
              <Tombol varian="hantu" onClick={tutup}>Batal</Tombol>
              <Tombol memuat={busy} onClick={() => resetSandi(dialog.akun)}>Buat sandi sementara</Tombol>
            </>
          }>
          <p>Buat kata sandi sementara untuk <strong>{dialog.akun.nama}</strong>? Semua sesi akun ini diakhiri dan pengguna wajib menggantinya saat masuk.</p>
          {dialogError && <p className={styles.galat} role="alert">{dialogError}</p>}
        </AkunDialog>
      )}

      {dialog?.kind === 'sandi' && (
        <AkunDialog title="Kata sandi sementara akun" onClose={tutup}
          kaki={<Tombol onClick={tutup}>Selesai</Tombol>}>
          <p role="alert" className={styles.peringatan}>
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Sandi ini hanya ditampilkan sekali dan tidak disimpan. Salin dan berikan ke <strong>{dialog.akun.nama}</strong> lewat jalur aman.</span>
          </p>
          <div className={styles.sandiBaris}>
            <input readOnly value={dialog.sandi} aria-label="Sandi sementara"
              onFocus={(e) => e.currentTarget.select()} className={styles.sandiInput} />
            <Tombol varian="sekunder" ikon={Copy} onClick={() => salin(dialog.sandi)}>Salin</Tombol>
          </div>
        </AkunDialog>
      )}

      {dialog?.kind === 'status' && (
        <AkunDialog title={dialog.akun.aktif ? 'Nonaktifkan akun' : 'Aktifkan akun'} onClose={tutup}
          kaki={
            <>
              <Tombol varian="hantu" onClick={tutup}>Batal</Tombol>
              <Tombol varian={dialog.akun.aktif ? 'bahaya' : 'utama'} memuat={busy} onClick={() => ubahStatus(dialog.akun)}>
                {dialog.akun.aktif ? 'Nonaktifkan' : 'Aktifkan'}
              </Tombol>
            </>
          }>
          {dialog.akun.aktif ? (
            <>
              <p>Akun <strong>{dialog.akun.nama}</strong> tidak akan bisa masuk dan sesinya diakhiri.</p>
              <Field label="Alasan (tercatat)" wajib className={styles.alasan}>
                <textarea rows={3} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
              </Field>
            </>
          ) : (
            <p>Aktifkan kembali akun <strong>{dialog.akun.nama}</strong>?</p>
          )}
          {dialogError && <p className={styles.galat} role="alert">{dialogError}</p>}
        </AkunDialog>
      )}
    </>
  );
}
