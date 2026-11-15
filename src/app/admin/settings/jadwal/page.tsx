'use client';

import Tombol from '@/components/ui/Tombol';
import DialogKonfirmasi from '@/components/ui/DialogKonfirmasi';
import Kartu from '@/components/ui/Kartu';
import Tabel from '@/components/ui/Tabel';
import Skeleton from '@/components/ui/Skeleton';
import Galat from '@/components/ui/Galat';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import StatusKosong from '@/components/ui/StatusKosong';
import PemilihTanggal from '@/components/ui/PemilihTanggal';
import { formatTanggal as tanggalWIB } from '@/lib/utils';

import tampilan from './page.dasbor.module.css';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarDays, Plus, Trash2, Loader2, Save } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { mutasiWajibBaris, mutasiInsert, MutasiError, pesanMutasi } from '@/lib/supabase/mutate';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';
import { objekBelumAda } from '@/lib/akses-data/galat';
import { useToast } from '@/components/Toast';
import { todayWIB } from '@/lib/time';

interface Layanan {
  id: string;
  nama: string;
  is_ptsp: boolean;
  aktif?: boolean;
}

// Satu baris per hari (1 = Senin ... 7 = Minggu), sama dengan jadwal_standby yang dibaca gerbang DB.
interface HariJadwal {
  hari: number;
  aktif: boolean;
  jam_mulai: string; // 'HH:MM'
  jam_selesai: string; // 'HH:MM'
}

interface JadwalStandbyRow {
  hari: number;
  jam_mulai: string;
  jam_selesai: string;
  aktif: boolean;
}

interface HariLibur {
  tanggal: string;
  keterangan: string | null;
}

const NAMA_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
// Sama dengan jam_tutup_layanan() di DB; trigger menolak jam selesai di atas ini.
const JAM_TUTUP_MAKS = '16:00';
const JAM_MULAI_BAWAAN = '08:00';
const JAM_SELESAI_BAWAAN = '15:30';

const hhmm = (t: string) => t.slice(0, 5);

function barisKosong(): HariJadwal[] {
  return NAMA_HARI.map((_, i) => ({
    hari: i + 1,
    aktif: false,
    jam_mulai: JAM_MULAI_BAWAAN,
    jam_selesai: JAM_SELESAI_BAWAAN,
  }));
}

// Hari tanpa baris di DB = tidak aktif (jam bawaan hanya untuk mempermudah bila diaktifkan).
function dariBaris(rows: JadwalStandbyRow[]): HariJadwal[] {
  const hasil = barisKosong();
  for (const r of rows) {
    const i = r.hari - 1;
    if (i < 0 || i > 6) continue;
    hasil[i] = { hari: r.hari, aktif: r.aktif, jam_mulai: hhmm(r.jam_mulai), jam_selesai: hhmm(r.jam_selesai) };
  }
  return hasil;
}

// Trigger DB menilai SETIAP baris yang ditulis (termasuk aktif = false), jadi semua hari divalidasi.
function validasiJadwal(hari: HariJadwal[]): string | null {
  for (const h of hari) {
    const nama = NAMA_HARI[h.hari - 1];
    if (!h.jam_mulai || !h.jam_selesai) return `Jam buka dan jam tutup hari ${nama} wajib diisi.`;
    if (h.jam_selesai > JAM_TUTUP_MAKS) {
      return `Jam tutup hari ${nama} tidak boleh lewat pukul ${JAM_TUTUP_MAKS} WIB.`;
    }
    if (h.jam_mulai >= h.jam_selesai) return `Jam buka hari ${nama} harus lebih awal dari jam tutup.`;
  }
  return null;
}

// Galat validasi dari trigger DB (22023 JADWAL_TIDAK_VALID) -> pesan yang bisa dibaca Admin.
function pesanGalatJadwal(e: unknown): string {
  if (e instanceof MutasiError) {
    const asal = e.asal as { code?: string; message?: string } | undefined;
    if (asal?.code === '22023') {
      const m = /JADWAL_TIDAK_VALID:\s*(.+)/.exec(asal.message ?? '');
      if (m) return `Jadwal tidak valid: ${m[1].trim()}.`;
    }
  }
  return pesanMutasi(e);
}

// Galat muat dibedakan (R7): objek DB belum ada (migrasi belum diterapkan; "Coba lagi" tidak membantu) vs gangguan koneksi/lainnya.
type GalatMuat = { migrasi: boolean; pesan: string };

const galatMuat = (bagian: string, err: unknown, bagianKoneksi: string = bagian): GalatMuat =>
  objekBelumAda(err)
    ? {
        migrasi: true,
        pesan: `${bagian} belum tersedia di database (migrasi belum diterapkan). Hubungi pengembang; mencoba lagi tidak akan membantu.`,
      }
    : { migrasi: false, pesan: `${bagianKoneksi} tidak dapat dimuat. Periksa koneksi Anda lalu coba lagi.` };

// Daftar layanan. Kolom `aktif` datang dari migrasi 202610270001 (belum tentu sudah diterapkan): bila hanya kolom itu yang
// belum ada, turun ke select lama; galat lain = GalatMuat (JANGAN dijadikan daftar kosong, itu akar C3-13).
async function bacaDaftarLayanan(supabase: ReturnType<typeof createClient>): Promise<Layanan[] | GalatMuat> {
  try {
    const lengkap = await supabase.from('layanan').select('id, nama, is_ptsp, aktif').order('nama');
    if (!lengkap.error) return (lengkap.data ?? []) as Layanan[];
    if (!objekBelumAda(lengkap.error)) return galatMuat('Daftar layanan', lengkap.error);
    const lama = await supabase.from('layanan').select('id, nama, is_ptsp').order('nama');
    if (lama.error) return galatMuat('Layanan', lama.error);
    return (lama.data ?? []) as Layanan[];
  } catch (e) {
    return galatMuat('Daftar layanan', e);
  }
}

const formatTanggal = (tanggal: string) => tanggalWIB(tanggal, { weekday: 'long' });

export default function AdminJadwalPage() {
  const { toast } = useToast();
  const [layananList, setLayananList] = useState<Layanan[]>([]);
  const [selectedLayananId, setSelectedLayananId] = useState('');
  const [jadwal, setJadwal] = useState<HariJadwal[] | null>(null);
  // Salinan jadwal sebagaimana tersimpan di DB: pembanding "belum disimpan" (C3-11).
  const [jadwalAwal, setJadwalAwal] = useState<HariJadwal[] | null>(null);
  // Layanan tujuan yang ditahan karena jadwal yang sedang diedit belum disimpan.
  const [pindahKe, setPindahKe] = useState<string | null>(null);
  const [galatDaftar, setGalatDaftar] = useState<GalatMuat | null>(null);
  const [memuatDaftar, setMemuatDaftar] = useState(false);
  // Hari libur yang menunggu konfirmasi hapus (C3-03) + kunci agar klik ganda tidak menghapus dua kali.
  const [hapusLibur, setHapusLibur] = useState<HariLibur | null>(null);
  const [menghapus, setMenghapus] = useState(false);
  const menghapusRef = useRef(false);
  const pemicuHapusRef = useRef<HTMLElement | null>(null);
  const judulLiburRef = useRef<HTMLHeadingElement>(null);
  const [liburList, setLiburList] = useState<HariLibur[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [galatJadwal, setGalatJadwal] = useState<string | null>(null);
  // Gagal memuat (bukan gagal menyimpan): editor disembunyikan agar jadwal kosong palsu tak bisa disimpan.
  const [galatMuatJadwal, setGalatMuatJadwal] = useState<GalatMuat | null>(null);
  const [galatMuatLibur, setGalatMuatLibur] = useState<GalatMuat | null>(null);

  const [liburTanggal, setLiburTanggal] = useState('');
  const [liburKeterangan, setLiburKeterangan] = useState('');
  const [galatLiburForm, setGalatLiburForm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Hanya muatan terakhir yang boleh mengisi layar (ganti layanan cepat-cepat).
  const muatanTerakhir = useRef(0);

  const loadJadwal = useCallback(async (layananId: string) => {
    const muatan = ++muatanTerakhir.current;
    setJadwal(null);
    setJadwalAwal(null);
    setGalatMuatJadwal(null);
    setGalatJadwal(null);
    let rows: JadwalStandbyRow[] | null = null;
    let galat: unknown = null;
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('jadwal_standby')
        .select('hari, jam_mulai, jam_selesai, aktif')
        .eq('layanan_id', layananId);
      if (error) galat = error;
      else rows = (data ?? []) as JadwalStandbyRow[];
    } catch (e) {
      galat = e;
    }
    if (muatan !== muatanTerakhir.current) return;
    if (rows === null) {
      // Jangan render jadwal kosong (semua hari nonaktif): menyimpannya akan menutup layanan.
      setGalatMuatJadwal(galatMuat('Jadwal layanan ini', galat));
      return;
    }
    const dimuat = dariBaris(rows);
    setJadwal(dimuat);
    setJadwalAwal(dimuat);
  }, []);

  // Hari libur nasional berlaku global; daftar dimulai dari hari ini (WIB).
  const loadLibur = useCallback(async () => {
    setGalatMuatLibur(null);
    let rows: HariLibur[] | null = null;
    let galat: unknown = null;
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('hari_libur')
        .select('tanggal, keterangan')
        .gte('tanggal', todayWIB())
        .order('tanggal');
      if (error) galat = error;
      else rows = (data ?? []) as HariLibur[];
    } catch (e) {
      galat = e;
    }
    if (rows === null) {
      setGalatMuatLibur(galatMuat('Hari libur', galat, 'Daftar hari libur'));
      return;
    }
    setLiburList(rows);
  }, []);

  // Peran + daftar layanan + jadwal layanan pertama. Dipisah dari hari libur agar "Coba lagi" daftar tak memuat ulang libur.
  const muatDaftar = useCallback(async () => {
    setGalatDaftar(null);
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch (e) {
      setGalatDaftar(galatMuat('Daftar layanan', e));
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // RBAC Tahap 0: jadwal & libur dikelola Admin saja (FO & petugas hanya melihat).
        const { data: p } = await supabase
          .from('petugas')
          .select('role')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        setCanEdit(p?.role === 'admin');
      }
    } catch {
      // Peran tak terbaca = tidak boleh mengubah (aman); daftar layanan tetap dicoba di bawah.
      setCanEdit(false);
    }

    const list = await bacaDaftarLayanan(supabase);
    if (!Array.isArray(list)) {
      setGalatDaftar(list);
      return;
    }
    setLayananList(list);
    if (list.length > 0) {
      setSelectedLayananId(list[0].id);
      await loadJadwal(list[0].id);
    }
  }, [loadJadwal]);

  useEffect(() => {
    async function init() {
      await Promise.all([muatDaftar(), loadLibur()]);
      setLoading(false);
    }
    init();
  }, [muatDaftar, loadLibur]);

  const cobaLagiDaftar = async () => {
    setMemuatDaftar(true);
    try {
      await muatDaftar();
    } finally {
      setMemuatDaftar(false);
    }
  };

  // C3-11: jadwal yang diedit berbeda dari yang tersimpan -> pindah layanan harus lewat konfirmasi.
  const kotor = !!jadwal && !!jadwalAwal && JSON.stringify(jadwal) !== JSON.stringify(jadwalAwal);

  const pindahLayanan = async (id: string) => {
    // Jadwal layanan sebelumnya langsung dikosongkan (di dalam loadJadwal) agar tak bisa tersimpan ke layanan baru.
    setPindahKe(null);
    setSelectedLayananId(id);
    await loadJadwal(id);
  };

  const handleSelectLayanan = async (id: string) => {
    if (id === selectedLayananId) return;
    if (kotor) {
      setPindahKe(id); // <select> terkendali: tetap di layanan lama sampai pengguna memilih
      return;
    }
    await pindahLayanan(id);
  };

  const ubahHari = (hari: number, patch: Partial<HariJadwal>) => {
    if (!canEdit) return;
    setJadwal((prev) => prev && prev.map((h) => (h.hari === hari ? { ...h, ...patch } : h)));
    setGalatJadwal(null);
  };

  const handleSaveJadwal = async () => {
    if (!canEdit || !jadwal || !selectedLayananId) return;
    const galat = validasiJadwal(jadwal);
    if (galat) {
      setGalatJadwal(galat);
      toast(galat, 'error');
      return;
    }
    // R6: simpan bisa selesai setelah admin pindah layanan. Hasilnya hanya boleh menyentuh layar bila generasi muat
    // (dinaikkan setiap loadJadwal) masih yang sama; kalau tidak, cukup toast bernama layanan yang disimpan.
    const muatanSaatSimpan = muatanTerakhir.current;
    const layananDisimpan = selectedLayananId;
    const namaLayanan = layananList.find((l) => l.id === layananDisimpan)?.nama ?? 'layanan';
    const masihDiLayar = () => muatanSaatSimpan === muatanTerakhir.current;
    setSaving(true);
    setGalatJadwal(null);
    try {
      const supabase = createClient();
      const rows = jadwal.map((h) => ({
        layanan_id: layananDisimpan,
        hari: h.hari,
        jam_mulai: `${h.jam_mulai}:00`,
        jam_selesai: `${h.jam_selesai}:00`,
        aktif: h.aktif,
      }));
      // .select + mutasiWajibBaris: upsert yang tidak menyentuh baris/ditolak = bukan sukses.
      await mutasiWajibBaris(
        supabase.from('jadwal_standby').upsert(rows, { onConflict: 'layanan_id,hari' }).select('hari'),
      );
      if (masihDiLayar()) {
        setJadwalAwal(jadwal);
        setPindahKe(null);
        toast('Jadwal layanan disimpan.', 'success');
      } else {
        toast(`Jadwal layanan ${namaLayanan} disimpan.`, 'success');
      }
    } catch (e) {
      const pesan = `Gagal menyimpan jadwal${masihDiLayar() ? '' : ` ${namaLayanan}`}. ${pesanGalatJadwal(e)}`;
      if (masihDiLayar()) setGalatJadwal(pesan);
      toast(pesan, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddLibur = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || adding) return;
    // hari_libur.keterangan NOT NULL di DB: keterangan wajib (tanpa nilai kosong/null).
    const keterangan = liburKeterangan.trim();
    if (!liburTanggal) {
      setGalatLiburForm('Pilih tanggal hari libur.');
      return;
    }
    if (!keterangan) {
      setGalatLiburForm('Keterangan wajib diisi, misalnya nama hari libur.');
      return;
    }
    setGalatLiburForm(null);
    setAdding(true);
    try {
      const supabase = createClient();
      await mutasiInsert(
        supabase.from('hari_libur').insert({
          tanggal: liburTanggal,
          keterangan,
        }),
      );
      setLiburTanggal('');
      setLiburKeterangan('');
      await loadLibur();
      toast('Hari libur ditambahkan.', 'success');
    } catch (err) {
      const duplikat = err instanceof MutasiError && (err.asal as { code?: string } | undefined)?.code === '23505';
      toast(
        `Gagal menambah hari libur. ${duplikat ? 'Tanggal itu sudah ada dalam daftar.' : pesanMutasi(err)}`,
        'error',
      );
    } finally {
      setAdding(false);
    }
  };

  const mintaHapusLibur = (lb: HariLibur, pemicu: HTMLElement) => {
    if (!canEdit) return;
    pemicuHapusRef.current = pemicu;
    setHapusLibur(lb);
  };

  const batalHapus = () => {
    if (menghapusRef.current) return;
    setHapusLibur(null);
    pemicuHapusRef.current?.focus();
  };

  const handleDeleteLibur = async (tanggal: string) => {
    if (!canEdit || menghapusRef.current) return;
    menghapusRef.current = true;
    setMenghapus(true);
    try {
      const supabase = createClient();
      // .select + mutasiWajibBaris: DELETE yang ditolak RLS = 0 baris tanpa error -> bukan sukses.
      await mutasiWajibBaris(supabase.from('hari_libur').delete().eq('tanggal', tanggal).select('tanggal'));
      await loadLibur();
      toast('Hari libur dihapus.', 'success');
    } catch (e) {
      toast(`Gagal menghapus hari libur. ${pesanMutasi(e)}`, 'error');
      // Ditolak/0 baris: daftar di layar kemungkinan basi -> muat ulang.
      if (perluMuatUlang(e)) await loadLibur();
    } finally {
      menghapusRef.current = false;
      setMenghapus(false);
      setHapusLibur(null);
      // Barisnya mungkin sudah hilang: pindahkan fokus ke judul bagian agar tidak jatuh ke awal halaman.
      judulLiburRef.current?.focus();
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Jadwal Layanan" description="Jadwal mingguan per layanan dan hari libur nasional" />
        <div className={tampilan.area1}>
          <Skeleton bentuk="kartu" jumlah={2} label="Memuat jadwal" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Jadwal Layanan"
        description="Atur jam layanan per hari untuk setiap layanan, dan hari libur nasional."
      />

      <div className={tampilan.area3}>
        <p className={tampilan.teks4}>
          Antrean (walk-in dan reservasi) ditutup di luar jadwal dan pada hari libur. Live chat tetap bisa dipakai; di luar jadwal, bot yang menjawab.
        </p>

        {!canEdit && (
          <div
            role="status"
            className={tampilan.area5}>
            Jadwal ini ditetapkan Admin sesuai SOP dan jadwal resmi. Anda hanya dapat melihatnya. Hubungi Admin bila ada perubahan.
          </div>
        )}

        {galatDaftar ? (
          galatDaftar.migrasi ? <CatatanKeadaan jenis="menunggu-migrasi">{galatDaftar.pesan}</CatatanKeadaan> :
          <Galat pesan={galatDaftar.pesan} onRetry={cobaLagiDaftar} memuat={memuatDaftar} />
        ) : layananList.length === 0 ? (
          <p role="status" className={tampilan.teks6}>
            Belum ada layanan. Tambahkan layanan di menu Kelola Layanan.
          </p>
        ) : (
          <div className={["form-group", tampilan.area7].filter(Boolean).join(' ')}>
            <label className="form-label" htmlFor="jadwalLayanan">Layanan</label>
            <select
              id="jadwalLayanan"
              className="form-input"
              value={selectedLayananId}
              onChange={(e) => handleSelectLayanan(e.target.value)}>
              {layananList.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nama}{l.is_ptsp ? ' (PTSP)' : ''}{l.aktif === false ? ' (diarsipkan)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {pindahKe && (
          <div
            role="alert"
            aria-label="Perubahan jadwal belum disimpan"
            className={tampilan.area8}>
            <p className={tampilan.teks9}>
              Perubahan jadwal layanan ini belum disimpan. Jika pindah ke{' '}
              {layananList.find((l) => l.id === pindahKe)?.nama ?? 'layanan lain'}, perubahan itu hilang.
            </p>
            <div className={tampilan.baris10}>
              <Tombol type="button" varian="sekunder" ukuran="kecil" onClick={() => setPindahKe(null)}>
                Tetap di sini
              </Tombol>
              <Tombol type="button" varian="hantu" ukuran="kecil" onClick={() => pindahLayanan(pindahKe)}>
                Buang perubahan dan pindah
              </Tombol>
            </div>
          </div>
        )}

        {!jadwal && !galatMuatJadwal && selectedLayananId && (
          <Skeleton bentuk="baris" jumlah={7} label="Memuat jadwal" />
        )}

        {galatMuatJadwal && (
          <>{galatMuatJadwal.migrasi ? <CatatanKeadaan jenis="menunggu-migrasi">{galatMuatJadwal.pesan}</CatatanKeadaan> : <Galat pesan={galatMuatJadwal.pesan} onRetry={() => { void loadJadwal(selectedLayananId); }} />}</>
        )}

        {jadwal && (
          <Kartu className={tampilan.area13}>
            <h3 id="judulJadwal" className={tampilan.judul14}>
              <CalendarDays size={18} aria-hidden="true" /> Jadwal mingguan
            </h3>
            <p className={tampilan.teks15}>
              Centang hari layanan buka. Jam tutup paling lambat pukul {JAM_TUTUP_MAKS} WIB.
            </p>

            <Tabel caption="Jadwal mingguan (WIB)" baris={jadwal} kunciBaris="hari" kolom={[
              { kunci: 'hari', judul: 'Hari', judulBaris: true, render: (h) => (
                <label className={tampilan.area17}>
                  <input type="checkbox" checked={h.aktif} disabled={!canEdit}
                    onChange={(e) => ubahHari(h.hari, { aktif: e.target.checked })} />
                  {NAMA_HARI[h.hari - 1]}
                </label>
              ) },
              { kunci: 'buka', judul: 'Jam buka', render: (h) => <input type="time" className="form-input"
                aria-label={`Jam buka ${NAMA_HARI[h.hari - 1]}`} value={h.jam_mulai} disabled={!canEdit || !h.aktif}
                onChange={(e) => ubahHari(h.hari, { jam_mulai: e.target.value })} /> },
              { kunci: 'tutup', judul: 'Jam tutup', render: (h) => <input type="time" className="form-input"
                aria-label={`Jam tutup ${NAMA_HARI[h.hari - 1]}`} value={h.jam_selesai} max={JAM_TUTUP_MAKS} disabled={!canEdit || !h.aktif}
                onChange={(e) => ubahHari(h.hari, { jam_selesai: e.target.value })} /> },
            ]} />

            {galatJadwal && (
              <p
                role="alert"
                className={tampilan.area12}>
                {galatJadwal}
              </p>
            )}

            {canEdit && (
              <div className={tampilan.area18}>
                <Tombol type="button" varian="utama" onClick={handleSaveJadwal} disabled={saving}>
                  {saving ? <Loader2 size={16} className="animate-pulse" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Simpan jadwal
                </Tombol>
              </div>
            )}
          </Kartu>
        )}

        <Kartu className={tampilan.area19}>
          <h3 id="judulLibur" ref={judulLiburRef} tabIndex={-1} className={tampilan.teks9} >Hari libur nasional</h3>
          <p className={tampilan.teks15}>
            Berlaku untuk semua layanan. Antrean ditutup pada tanggal ini. Daftar dimulai dari hari ini.
          </p>

          {canEdit && (
            <form onSubmit={handleAddLibur} noValidate className={tampilan.baris20}>
              <div className={["form-group", tampilan.area21].filter(Boolean).join(' ')}>
                <label className="form-label" htmlFor="liburTanggal">Tanggal</label>
                <PemilihTanggal id="liburTanggal" label="Tanggal" min={todayWIB()}
                  nilai={liburTanggal} onUbah={(nilai) => { setLiburTanggal(nilai); setGalatLiburForm(null); }} />
              </div>
              <div className={["form-group", tampilan.area22].filter(Boolean).join(' ')}>
                <label className="form-label" htmlFor="liburKeterangan">Keterangan (wajib)</label>
                <input
                  id="liburKeterangan" type="text" className="form-input" maxLength={120} required
                  aria-required="true"
                  aria-invalid={galatLiburForm?.startsWith('Keterangan') ? true : undefined}
                  aria-describedby={galatLiburForm ? 'galatLiburForm' : undefined}
                  placeholder="Contoh: Hari Raya Idul Fitri"
                  value={liburKeterangan} onChange={(e) => { setLiburKeterangan(e.target.value); setGalatLiburForm(null); }}
                />
              </div>
              <Tombol type="submit" varian="utama" disabled={adding}>
                <Plus size={16} aria-hidden="true" /> Tambah
              </Tombol>
              {galatLiburForm && (
                <p
                  id="galatLiburForm" role="alert"
                  className={tampilan.teks23}>
                  {galatLiburForm}
                </p>
              )}
            </form>
          )}

          <DialogKonfirmasi
            terbuka={!!hapusLibur}
            judul={hapusLibur ? `Hapus hari libur ${formatTanggal(hapusLibur.tanggal)}?` : ''}
            deskripsi={hapusLibur ? (
              <>
                {hapusLibur.keterangan ? `“${hapusLibur.keterangan}”. ` : ''}
                Berlaku untuk semua layanan: setelah dihapus, antrean dan chat layanan dibuka lagi pada tanggal itu menurut jadwal mingguan.
              </>
            ) : undefined}
            labelSetuju="Ya, hapus"
            berbahaya
            memuat={menghapus}
            onSetuju={() => { if (hapusLibur) void handleDeleteLibur(hapusLibur.tanggal); }}
            onBatal={batalHapus}
          />

          {galatMuatLibur ? (
            <>{galatMuatLibur.migrasi ? <CatatanKeadaan jenis="menunggu-migrasi">{galatMuatLibur.pesan}</CatatanKeadaan> : <Galat pesan={galatMuatLibur.pesan} onRetry={() => { void loadLibur(); }} />}</>
          ) : liburList.length === 0 ? (
            <StatusKosong ikon={CalendarDays} judul="Belum ada hari libur nasional yang akan datang." isi={canEdit ? 'Tambahkan tanggalnya di atas.' : undefined} />
          ) : (
            <Tabel caption="Hari libur nasional" baris={liburList} kunciBaris="tanggal" kolom={[
              { kunci: 'tanggal', judul: 'Tanggal', judulBaris: true, render: (lb) => formatTanggal(lb.tanggal) },
              { kunci: 'keterangan', judul: 'Keterangan', render: (lb) => lb.keterangan || '—' },
              ...(canEdit ? [{ kunci: 'aksi', judul: 'Aksi', render: (lb: HariLibur) => (
                <Tombol varian="hantu" ukuran="kecil" onClick={(e) => mintaHapusLibur(lb, e.currentTarget)}
                  aria-label={`Hapus hari libur ${formatTanggal(lb.tanggal)}`}><Trash2 size={14} aria-hidden="true" /></Tombol>
              ) }] : []),
            ]} />
          )}
        </Kartu>
      </div>
    </>
  );
}
