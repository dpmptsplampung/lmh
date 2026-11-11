'use client';

// WP-29 / DSP-07: Admin page for managing queue display tokens.
// Admin creates tokens that give access to /layar/[token] TV display.

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Monitor, Plus, XCircle, Copy, CheckCircle2, RefreshCw, ExternalLink,
  ChevronUp, ChevronDown, AlertTriangle,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Kartu from '@/components/ui/Kartu';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import DialogKonfirmasi from '@/components/ui/DialogKonfirmasi';
import Lencana from '@/components/ui/Lencana';
import StatusKosong from '@/components/ui/StatusKosong';
import Skeleton from '@/components/ui/Skeleton';
import Galat from '@/components/ui/Galat';
import { BISA_DIFOKUS } from '@/components/ui/fokus';
import { formatTanggal } from '@/lib/utils';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { objekBelumAda } from '@/lib/akses-data/galat';
import {
  KUNCI_PENGUMUMAN_LAYAR,
  BATAS_PENGUMUMAN_LAYAR,
  BATAS_NAMA_LAYAR,
  urutkanUntukLayar,
} from '@/lib/layar/pengaturan';
import styles from './layar.module.css';
import tokenStyles from './token.module.css';
import { formatTokenTampilan, tokenBerupaAngka, tautanLayar } from './tokenTampilan';

interface LayarToken {
  id: string;
  token: string;
  nama: string;
  aktif: boolean;
  created_at: string;
}

interface LayananLayar {
  id: string;
  nama: string;
  nama_layar: string | null;
  urutan_layar: number | null;
}

const NAMA_TAMPIL_KOSONG = (v: string) => (v.trim() === '' ? null : v.trim());

export default function AdminLayarPage() {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<LayarToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [galatToken, setGalatToken] = useState(false);
  const [galatLayanan, setGalatLayanan] = useState(false);
  const [namaLayar, setNamaLayar] = useState('');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Layanan di layar TV: daftar asli dari DB, urutan kerja (ids), dan isian nama tampil per layanan.
  const [layananAsli, setLayananAsli] = useState<LayananLayar[]>([]);
  const [urutan, setUrutan] = useState<string[]>([]);
  const [namaDraft, setNamaDraft] = useState<Record<string, string>>({});
  const [memuatLayanan, setMemuatLayanan] = useState(true);
  const [menyimpanTampilan, setMenyimpanTampilan] = useState(false);
  // Migrasi layar TV (202611030012): kolom layanan.nama_layar/urutan_layar dan tabel panggilan_layar.
  const [kolomBelumAda, setKolomBelumAda] = useState(false);
  const [panggilanBelumAda, setPanggilanBelumAda] = useState(false);

  // Pengumuman teks berjalan (tiga kunci site_settings).
  const [pengumuman, setPengumuman] = useState<string[]>(KUNCI_PENGUMUMAN_LAYAR.map(() => ''));
  const [menyimpanPengumuman, setMenyimpanPengumuman] = useState(false);
  // Nilai awal kosong bukan nilai tersimpan: isian dan Simpan terkunci sampai bacaan berhasil, supaya gangguan baca
  // tidak berakhir dengan pengumuman tersimpan yang terhapus.
  const [statusPengumuman, setStatusPengumuman] = useState<'memuat' | 'siap' | 'galat'>('memuat');

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setGalatToken(false);
    try {
      const res = await fetch('/api/admin/layar');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setTokens(json.data ?? []);
    } catch (e) {
      setGalatToken(true);
      toast('Gagal memuat data layar', 'error');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    let batal = false;
    queueMicrotask(() => { if (!batal) void loadTokens(); });
    return () => { batal = true; };
  }, [loadTokens]);

  const muatLayanan = useCallback(async () => {
    setMemuatLayanan(true);
    setGalatLayanan(false);
    try {
      const supabase = createClient();
      const baca = (kolom: string) =>
        supabase.from('layanan').select(kolom).eq('aktif', true).eq('tampil_di_layar', true);
      let kolomHilang = false;
      let hasil = await baca('id, nama, nama_layar, urutan_layar');
      if (hasil.error && objekBelumAda(hasil.error)) {
        kolomHilang = true;
        hasil = await baca('id, nama');
      }
      if (hasil.error) throw hasil.error;
      const baris = ((hasil.data ?? []) as unknown as Array<Partial<LayananLayar> & { id: string; nama: string }>).map((r) => ({
        id: r.id,
        nama: r.nama,
        nama_layar: r.nama_layar ?? null,
        urutan_layar: r.urutan_layar ?? null,
      }));
      const terurut = urutkanUntukLayar(baris);
      setKolomBelumAda(kolomHilang);
      setLayananAsli(terurut);
      setUrutan(terurut.map((l) => l.id));
      setNamaDraft(Object.fromEntries(terurut.map((l) => [l.id, l.nama_layar ?? ''])));

      const probe = await supabase.from('panggilan_layar').select('id').limit(1);
      setPanggilanBelumAda(Boolean(probe.error && objekBelumAda(probe.error)));
    } catch (e) {
      setGalatLayanan(true);
      toast('Gagal memuat daftar layanan', 'error');
      console.error(e);
    } finally {
      setMemuatLayanan(false);
    }
  }, [toast]);

  const muatPengumuman = useCallback(async () => {
    setStatusPengumuman('memuat');
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('site_settings')
        .select('key, value')
        .in('key', [...KUNCI_PENGUMUMAN_LAYAR]);
      if (error) throw error;
      const peta = new Map((data ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value ?? '']));
      setPengumuman(KUNCI_PENGUMUMAN_LAYAR.map((k) => peta.get(k) ?? ''));
      setStatusPengumuman('siap');
    } catch (e) {
      setStatusPengumuman('galat');
      toast('Gagal memuat pengumuman', 'error');
      console.error(e);
    }
  }, [toast]);

  useEffect(() => {
    let batal = false;
    queueMicrotask(() => { if (!batal) { void muatLayanan(); void muatPengumuman(); } });
    return () => { batal = true; };
  }, [muatLayanan, muatPengumuman]);

  const asliPerId = useMemo(() => new Map(layananAsli.map((l) => [l.id, l])), [layananAsli]);
  const daftar = urutan.map((id) => asliPerId.get(id)).filter((l): l is LayananLayar => Boolean(l));

  // Baris yang perlu ditulis: urutan baru (1..n) atau nama tampil berbeda dari yang tersimpan.
  const perubahan = daftar
    .map((l, i) => ({
      id: l.id,
      urutan_layar: i + 1,
      nama_layar: NAMA_TAMPIL_KOSONG(namaDraft[l.id] ?? ''),
      berubah: l.urutan_layar !== i + 1 || (l.nama_layar ?? null) !== NAMA_TAMPIL_KOSONG(namaDraft[l.id] ?? ''),
    }))
    .filter((x) => x.berubah);

  const geser = (indeks: number, arah: -1 | 1) => {
    const tujuan = indeks + arah;
    if (tujuan < 0 || tujuan >= urutan.length) return;
    const baru = [...urutan];
    [baru[indeks], baru[tujuan]] = [baru[tujuan], baru[indeks]];
    setUrutan(baru);
  };

  const handleSimpanTampilan = async () => {
    if (perubahan.length === 0 || kolomBelumAda) return;
    setMenyimpanTampilan(true);
    try {
      const supabase = createClient();
      for (const { id, urutan_layar, nama_layar } of perubahan) {
        await mutasiWajibBaris(
          supabase.from('layanan').update({ urutan_layar, nama_layar }).eq('id', id).select('id'),
        );
      }
      toast('Tampilan layar tersimpan', 'success');
      await muatLayanan();
    } catch (e) {
      toast(`Gagal menyimpan tampilan layar. ${pesanMutasi(e)}`, 'error');
      await muatLayanan();
    } finally {
      setMenyimpanTampilan(false);
    }
  };

  const handleSimpanPengumuman = async () => {
    if (statusPengumuman !== 'siap') return;
    setMenyimpanPengumuman(true);
    try {
      const supabase = createClient();
      const now = new Date().toISOString();
      const baris = KUNCI_PENGUMUMAN_LAYAR.map((key, i) => ({
        key,
        value: (pengumuman[i] ?? '').trim().slice(0, BATAS_PENGUMUMAN_LAYAR),
        updated_at: now,
      }));
      const { error } = await supabase.from('site_settings').upsert(baris, { onConflict: 'key' });
      if (error) throw error;
      toast('Pengumuman tersimpan', 'success');
      setPengumuman(baris.map((b) => b.value));
    } catch (e) {
      toast('Gagal menyimpan pengumuman. Coba lagi.', 'error');
      console.error(e);
    } finally {
      setMenyimpanPengumuman(false);
    }
  };

  const handleBuat = async () => {
    if (creating) return;
    if (!namaLayar.trim()) {
      toast('Nama layar wajib diisi', 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/admin/layar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'buat', nama: namaLayar.trim() }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      toast(`Token layar "${namaLayar}" berhasil dibuat`, 'success');
      setNamaLayar('');
      await loadTokens();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Gagal membuat token', 'error');
    } finally {
      setCreating(false);
    }
  };

  const [cabutToken, setCabutToken] = useState<{ id: string; nama: string } | null>(null);
  const [mencabut, setMencabut] = useState(false);

  const handleCabut = async (id: string, nama: string) => {
    setMencabut(true);
    try {
      const res = await fetch('/api/admin/layar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'cabut', id }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      toast(`Token "${nama}" dicabut`, 'success');
      await loadTokens();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Gagal mencabut token', 'error');
    } finally {
      setMencabut(false);
      setCabutToken(null);
    }
  };

  const handleCopy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(tautanLayar(window.location.origin, token));
    } catch {
      toast('Tidak bisa menyalin tautan. Salin dari bilah alamat setelah menekan Buka.', 'error');
      return;
    }
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
    toast('Tautan layar disalin', 'success');
  };

  const activeTokens  = tokens.filter(t => t.aktif);
  const revokedTokens = tokens.filter(t => !t.aktif);

  return (
    <>
      <DialogKonfirmasi
        terbuka={!!cabutToken}
        judul={cabutToken ? `Cabut akses token "${cabutToken.nama}"?` : ''}
        deskripsi="Layar yang menggunakan token ini tidak akan bisa menampilkan data."
        labelSetuju="Ya, cabut"
        berbahaya
        memuat={mencabut}
        onSetuju={() => { if (cabutToken) void handleCabut(cabutToken.id, cabutToken.nama); }}
        onBatal={() => { if (!mencabut) setCabutToken(null); }}
      />
      <PageHeader title="Kelola Layar Antrean" description="Atur isi layar TV antrean dan kelola token aksesnya">
        <Tombol varian="hantu" ukuran="kecil" ikon={RefreshCw} onClick={() => { void loadTokens(); void muatLayanan(); void muatPengumuman(); }}>
          Refresh
        </Tombol>
      </PageHeader>
      <div className={styles.halaman}>
        {(kolomBelumAda || panggilanBelumAda) && (
          <div className={styles.peringatan} role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <p><strong>Migrasi layar TV belum diterapkan di database.</strong></p>
              {kolomBelumAda && <p>Urutan dan nama di layar belum bisa disimpan sampai migrasi diterapkan. Daftar di bawah masih menurut urutan bawaan.</p>}
              {panggilanBelumAda && <p>Pita panggilan dan bunyi di layar belum aktif karena tabel panggilan belum ada. Tombol Panggil di halaman Antrean belum menghasilkan pemberitahuan di layar.</p>}
            </div>
          </div>
        )}
        <Kartu judul="Layanan di Layar TV" aksi={<Lencana nada="info">{daftar.length} layanan</Lencana>}>
          <p className={styles.bantuan}>Atur urutan kartu dan nama yang tampil di layar. Kosongkan nama tampil untuk memakai nama layanan. Layar hanya menampilkan layanan yang punya jadwal hari ini.</p>
          {memuatLayanan ? <Skeleton jumlah={3} label="Memuat layanan…" /> : galatLayanan ? (
            <Galat pesan="Daftar layanan tidak dapat dimuat." onRetry={() => void muatLayanan()} />
          ) : daftar.length === 0 ? (
            <StatusKosong ikon={Monitor} judul="Belum ada layanan yang tampil di layar" isi="Layanan aktif dan bertanda tampil di layar akan muncul di sini." />
          ) : (
            <>
              <div className={styles.kepala} aria-hidden="true"><span>Urutan</span><span>Layanan</span><span>Nama di layar TV</span><span>Geser</span></div>
              <ol className={styles.daftar} aria-label="Layanan di layar TV">
                {daftar.map((l, i) => (
                  <li key={l.id} className={styles.baris}>
                    <span className={styles.nomor}>{i + 1}</span>
                    <span className={styles.namaLayanan}>{l.nama}</span>
                    <Field className={styles.isian} label={`Nama di layar TV untuk ${l.nama}`}>
                      <input type="text" placeholder={l.nama} maxLength={BATAS_NAMA_LAYAR} value={namaDraft[l.id] ?? ''}
                        disabled={kolomBelumAda || menyimpanTampilan}
                        onChange={e => setNamaDraft(d => ({ ...d, [l.id]: e.target.value }))} />
                    </Field>
                    <div className={styles.urut}>
                      <Tombol varian="hantu" ukuran="kecil" aria-label={`Naikkan ${l.nama}`} disabled={kolomBelumAda || menyimpanTampilan || i === 0} onClick={() => geser(i, -1)}><ChevronUp size={18} aria-hidden="true" /></Tombol>
                      <Tombol varian="hantu" ukuran="kecil" aria-label={`Turunkan ${l.nama}`} disabled={kolomBelumAda || menyimpanTampilan || i === daftar.length - 1} onClick={() => geser(i, 1)}><ChevronDown size={18} aria-hidden="true" /></Tombol>
                    </div>
                  </li>
                ))}
              </ol>
              <div className={styles.aksi}>
                <Tombol onClick={handleSimpanTampilan} disabled={kolomBelumAda || menyimpanTampilan || perubahan.length === 0} memuat={menyimpanTampilan}>Simpan Tampilan</Tombol>
                {perubahan.length > 0 && !kolomBelumAda && <span className={styles.belumDisimpan} role="status">Ada perubahan yang belum disimpan.</span>}
              </div>
            </>
          )}
        </Kartu>
        <Kartu judul="Pengumuman Teks Berjalan">
          <p className={styles.bantuan}>Hingga tiga pengumuman. Layar menampilkannya bergantian: satu pengumuman bergulir sampai habis, jeda 5 detik, lalu pengumuman berikutnya. Pengumuman yang kosong dilewati.</p>
          {statusPengumuman === 'memuat' && <Skeleton label="Memuat pengumuman…" />}
          {statusPengumuman === 'galat' && <Galat pesan="Pengumuman tidak dapat dimuat, jadi penyimpanan dikunci agar pengumuman yang sudah ada tidak terhapus." onRetry={() => void muatPengumuman()} />}
          <div className={styles.pengumuman}>
            {KUNCI_PENGUMUMAN_LAYAR.map((kunci, i) => (
              <Field key={kunci} label={`Pengumuman ${i + 1}`} bantuan={`${(pengumuman[i] ?? '').length}/${BATAS_PENGUMUMAN_LAYAR} karakter`}>
                <input id={`pengumuman-${i + 1}`} type="text" maxLength={BATAS_PENGUMUMAN_LAYAR} value={pengumuman[i] ?? ''}
                  disabled={menyimpanPengumuman || statusPengumuman !== 'siap'} onChange={e => setPengumuman(p => p.map((v, j) => j === i ? e.target.value : v))} />
              </Field>
            ))}
          </div>
          <div className={styles.aksi}><Tombol onClick={handleSimpanPengumuman} disabled={menyimpanPengumuman || statusPengumuman !== 'siap'} memuat={menyimpanPengumuman}>Simpan Pengumuman</Tombol></div>
        </Kartu>
        <Kartu judul="Tambah Layar Baru">
          <div className={styles.buatToken}>
            <Field label="Nama layar" className={styles.namaToken} wajib>
              <input type="text" placeholder="Nama layar, misal: Layar Lobby Utama" value={namaLayar} onChange={e => setNamaLayar(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleBuat()} />
            </Field>
            <Tombol ikon={Plus} onClick={handleBuat} disabled={creating || !namaLayar.trim()} memuat={creating}>Buat Token</Tombol>
          </div>
          <p className={styles.petunjuk}>Setiap layar mendapat kode 8 angka. Ketik kode itu dengan remote TV, atau salin tautan lengkapnya ke peramban TV. Tidak perlu login.</p>
        </Kartu>
        <Kartu judul={`Layar Aktif (${activeTokens.length})`} aksi={<Lencana nada="sukses" titik>Aktif</Lencana>}>
          {loading ? <Skeleton jumlah={3} label="Memuat layar…" /> : galatToken ? (
            <Galat pesan="Data layar tidak dapat dimuat." onRetry={() => void loadTokens()} />
          ) : activeTokens.length === 0 ? (
            <StatusKosong ikon={Monitor} judul="Belum Ada Layar" isi="Tambah token di atas untuk membuat layar TV pertama." />
          ) : (
            <div className={styles.tabelWadah} role="region" aria-label="Daftar layar aktif" {...BISA_DIFOKUS}>
              <table className={`table ${styles.tabel}`}>
                <caption className="sr-only">Token akses layar TV aktif</caption>
                <thead><tr><th scope="col">Nama Layar</th><th scope="col">Kode Layar</th><th scope="col">Dibuat</th><th scope="col">Aksi</th></tr></thead>
                <tbody>{activeTokens.map(t => (
                  <tr key={t.id}>
                    <th scope="row">{t.nama}</th>
                    <td>{tokenBerupaAngka(t.token) ? <code className={tokenStyles.kode}>{formatTokenTampilan(t.token)}</code> : <><code className={tokenStyles.kodeLama}>{t.token}</code><span className={tokenStyles.petunjuk}>Kode lama, masih berlaku</span></>}</td>
                    <td className={styles.tanggal}>{formatTanggal(t.created_at)}</td>
                    <td><div className={styles.aksiToken}>
                      <Tombol varian="hantu" ukuran="kecil" ikon={copied === t.token ? CheckCircle2 : Copy} onClick={() => void handleCopy(t.token)} aria-label={`Salin tautan ${t.nama}`}>{copied === t.token ? 'Disalin' : 'Salin tautan'}</Tombol>
                      <Tombol varian="sekunder" ukuran="kecil" ikon={ExternalLink} href={`/layar/${t.token}`} eksternal target="_blank" rel="noopener noreferrer" title="Buka layar di tab baru">Buka</Tombol>
                      <Tombol varian="bahaya" ukuran="kecil" ikon={XCircle} onClick={() => setCabutToken({ id: t.id, nama: t.nama })} aria-label={`Cabut ${t.nama}`} title="Cabut akses token ini">Cabut</Tombol>
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Kartu>
        {revokedTokens.length > 0 && <Kartu judul={`Token Dicabut (${revokedTokens.length})`}>
          <ul className={styles.dicabut}>{revokedTokens.map(t => <li key={t.id}><span>{t.nama}</span><Lencana nada="netral" ikon={XCircle}>Dicabut</Lencana><span className={styles.tanggal}>Dibuat {formatTanggal(t.created_at)}</span></li>)}</ul>
        </Kartu>}
      </div>
    </>
  );
}
