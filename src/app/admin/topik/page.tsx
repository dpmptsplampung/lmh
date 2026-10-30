'use client';

// Kelola Topik Penanganan (Admin; kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §1.6 dan §6.5).
// Topik dipilih FO saat menyelesaikan/mengeskalasi kunjungan (layanan_id NULL = topik Front Office) dan oleh petugas
// layanan saat menyelesaikan tiket hasil eskalasi (topik milik layanannya). Admin menulis LANGSUNG lewat PostgREST
// (RLS topik_penanganan_admin_tulis), tanpa RPC. Topik yang sudah terpakai TIDAK dihapus: nonaktifkan (aktif=false);
// nama topik disalin ke baris penanganan saat ditutup, jadi mengganti nama / menonaktifkan tidak mengubah riwayat.
// Penyuntingan langsung di tabel (tanpa dialog): nama diklik lalu diketik, urutan lewat tombol naik/turun, status lewat
// saklar, topik baru lewat baris terakhir. "Lainnya" (urutan >= 99) tetap di bawah.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import RoleNote from '@/components/admin/RoleNote';
import { BarisTambah, SelTeksInline } from '@/components/admin/SuntingInline';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { MutasiError, mutasiInsert, mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';
import { bisaGeser, hitungGeser, terkunci } from './urutan';
import styles from './topik.module.css';

const FO = '__fo__';
const NAMA_MIN = 2;
const NAMA_MAX = 100;

interface Topik {
  id: string;
  layanan_id: string | null;
  nama: string;
  aktif: boolean;
  urut: number;
}

interface LayananOpsi {
  id: string;
  nama: string;
}

/** Pesan galat penyimpanan topik: bentrok nama (23505) dan pelanggaran CHECK panjang nama (23514) dijelaskan. */
function pesanGalatSimpan(err: unknown): string {
  if (err instanceof MutasiError) {
    const kode = (err.asal as { code?: unknown } | undefined)?.code;
    if (kode === '23505') return 'Sudah ada topik dengan nama itu pada cakupan ini (huruf besar/kecil dianggap sama).';
    if (kode === '23514') return `Nama topik harus ${NAMA_MIN}-${NAMA_MAX} karakter.`;
  }
  return `Gagal menyimpan topik. ${pesanMutasi(err)}`;
}

export default function KelolaTopikPage() {
  const { toast } = useToast();
  const idDasar = useId();
  const [topik, setTopik] = useState<Topik[]>([]);
  const [layanan, setLayanan] = useState<LayananOpsi[]>([]);
  const [loading, setLoading] = useState(true);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [cakupan, setCakupan] = useState<string>(FO);
  const [sibuk, setSibuk] = useState<ReadonlySet<string>>(new Set());
  const [pengumuman, setPengumuman] = useState('');
  // Setelah menggeser, fokus dikembalikan ke tombol geser yang sama (atau lawannya bila tombol itu jadi nonaktif).
  const fokusRef = useRef<{ id: string; arah: -1 | 1 } | null>(null);

  const muat = useCallback(async () => {
    try {
      const supabase = createClient();
      const [t, l] = await Promise.all([
        supabase.from('topik_penanganan').select('id, layanan_id, nama, aktif, urut').order('urut').order('nama'),
        supabase.from('layanan').select('id, nama').order('nama'),
      ]);
      if (t.error) throw t.error;
      if (l.error) throw l.error;
      setTopik((t.data ?? []) as Topik[]);
      setLayanan((l.data ?? []) as LayananOpsi[]);
      setGalatMuat(null);
    } catch {
      setGalatMuat('Gagal memuat topik penanganan. Muat ulang halaman atau coba lagi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    muat();
  }, [muat]);

  const layananId = cakupan === FO ? null : cakupan;
  const namaCakupan = cakupan === FO ? 'Front Office' : layanan.find((l) => l.id === cakupan)?.nama ?? 'Layanan';
  const daftar = useMemo(
    () => topik.filter((t) => (t.layanan_id ?? FO) === cakupan),
    [topik, cakupan],
  );
  const jumlahPerCakupan = useMemo(() => {
    const peta = new Map<string, number>();
    for (const t of topik) peta.set(t.layanan_id ?? FO, (peta.get(t.layanan_id ?? FO) ?? 0) + 1);
    return peta;
  }, [topik]);
  const pilihanCakupan = useMemo(
    () => [{ id: FO, nama: 'Front Office' }, ...layanan],
    [layanan],
  );

  const urutBerikut = useMemo(() => {
    const biasa = daftar.filter((t) => !terkunci(t)).map((t) => t.urut);
    return biasa.length ? Math.min(98, Math.max(...biasa) + 1) : 1;
  }, [daftar]);

  useEffect(() => {
    const f = fokusRef.current;
    if (!f) return;
    fokusRef.current = null;
    const utama = document.getElementById(`${idDasar}-${f.id}-${f.arah === -1 ? 'naik' : 'turun'}`) as HTMLButtonElement | null;
    const lawan = document.getElementById(`${idDasar}-${f.id}-${f.arah === -1 ? 'turun' : 'naik'}`) as HTMLButtonElement | null;
    (utama && !utama.disabled ? utama : lawan)?.focus();
  }, [topik, idDasar]);

  const namaSudahAda = (nama: string, kecuali?: string) =>
    daftar.some((t) => t.nama.trim().toLowerCase() === nama.toLowerCase() && t.id !== kecuali);

  const validasiNama = (nama: string, kecuali?: string): string | null => {
    if (nama.length < NAMA_MIN || nama.length > NAMA_MAX) return `Nama topik harus ${NAMA_MIN}-${NAMA_MAX} karakter.`;
    if (namaSudahAda(nama, kecuali)) return 'Sudah ada topik dengan nama itu pada cakupan ini.';
    return null;
  };

  const ubahNama = async (t: Topik, nama: string): Promise<string | null> => {
    try {
      const supabase = createClient();
      await mutasiWajibBaris(
        supabase.from('topik_penanganan').update({ nama }).eq('id', t.id).select('id'),
      );
      toast(`Topik "${nama}" diperbarui`, 'success');
      await muat();
      return null;
    } catch (e) {
      if (perluMuatUlang(e)) await muat();
      return pesanGalatSimpan(e);
    }
  };

  const tambah = async (nilai: Record<string, string>): Promise<string | null> => {
    const nama = (nilai.nama ?? '').trim();
    const galat = validasiNama(nama);
    if (galat) return galat;
    try {
      const supabase = createClient();
      await mutasiInsert(
        supabase.from('topik_penanganan').insert({ layanan_id: layananId, nama, urut: urutBerikut, aktif: true }).select('id'),
      );
      toast(`Topik "${nama}" ditambahkan`, 'success');
      await muat();
      return null;
    } catch (e) {
      if (perluMuatUlang(e)) await muat();
      return pesanGalatSimpan(e);
    }
  };

  const tandaiSibuk = (ids: string[], nyala: boolean) =>
    setSibuk((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (nyala) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  const ubahAktif = async (t: Topik) => {
    if (sibuk.has(t.id)) return;
    tandaiSibuk([t.id], true);
    setPengumuman(`${t.aktif ? 'Menonaktifkan' : 'Mengaktifkan'} topik ${t.nama}…`);
    try {
      const supabase = createClient();
      await mutasiWajibBaris(
        supabase.from('topik_penanganan').update({ aktif: !t.aktif }).eq('id', t.id).select('id'),
      );
      toast(`Topik "${t.nama}" ${t.aktif ? 'dinonaktifkan' : 'diaktifkan'}`, 'success');
      await muat();
    } catch (e) {
      toast(`Gagal mengubah status topik. ${pesanMutasi(e)}`, 'error');
      if (perluMuatUlang(e)) await muat();
    } finally {
      tandaiSibuk([t.id], false);
      setPengumuman('');
    }
  };

  const geser = async (indeks: number, arah: -1 | 1) => {
    const t = daftar[indeks];
    const perubahan = hitungGeser(daftar, indeks, arah);
    if (!t || perubahan.length === 0) return;
    const ids = perubahan.map((p) => p.id);
    if (ids.some((id) => sibuk.has(id))) return;
    tandaiSibuk(ids, true);
    fokusRef.current = { id: t.id, arah };
    try {
      const supabase = createClient();
      await Promise.all(
        perubahan.map((p) =>
          mutasiWajibBaris(supabase.from('topik_penanganan').update({ urut: p.urut }).eq('id', p.id).select('id')),
        ),
      );
      await muat();
      setPengumuman(`Topik ${t.nama} dipindah ke posisi ${indeks + arah + 1} dari ${daftar.length}.`);
    } catch (e) {
      fokusRef.current = null;
      toast(`Gagal mengubah urutan topik. ${pesanMutasi(e)}`, 'error');
      await muat();
    } finally {
      tandaiSibuk(ids, false);
    }
  };

  return (
    <>
      <PageHeader
        title="Topik Penanganan"
        description="Daftar topik yang dipilih Front Office dan petugas layanan saat menyelesaikan penanganan"
      />

      <div style={{ padding: 'clamp(var(--space-4), 4vw, var(--space-8))' }}>
        <RoleNote>
          Hanya Admin yang dapat mengelola topik. Topik yang sudah pernah dipakai tidak dihapus: nonaktifkan agar tidak
          muncul lagi di pilihan. Riwayat penanganan menyimpan salinan nama topik, jadi mengubah nama atau
          menonaktifkan tidak mengubah data lama.
        </RoleNote>

        <div className={styles.tata}>
          <nav className={styles.cakupanDaftar} aria-label="Pilih cakupan topik">
            <ul>
              {pilihanCakupan.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`${styles.cakupanItem} ${cakupan === c.id ? styles.cakupanAktif : ''}`}
                    aria-current={cakupan === c.id ? 'true' : undefined}
                    onClick={() => setCakupan(c.id)}
                  >
                    <span className={styles.cakupanNama}>{c.nama}</span>{' '}
                    <span className={styles.cakupanJumlah}>{jumlahPerCakupan.get(c.id) ?? 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className={`form-group ${styles.cakupanSelect}`}>
            <select
              className="form-select"
              aria-label="Cakupan topik"
              value={cakupan}
              onChange={(e) => setCakupan(e.target.value)}
            >
              {pilihanCakupan.map((c) => (
                <option key={c.id} value={c.id}>{c.nama} ({jumlahPerCakupan.get(c.id) ?? 0})</option>
              ))}
            </select>
          </div>

          <div className={`table-wrapper ${styles.tabel}`}>
            {loading ? (
              <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="status" aria-label="Memuat">
                <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto' }} aria-hidden="true" />
              </div>
            ) : galatMuat ? (
              <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="alert" className="form-error">
                {galatMuat}
              </div>
            ) : (
              <table className="table">
                <caption className="sr-only">Topik penanganan {namaCakupan}</caption>
                <thead>
                  <tr>
                    <th scope="col">Topik</th>
                    <th scope="col">Urutan</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {daftar.length === 0 && (
                    <tr>
                      <td colSpan={3} className="kosong-sel">
                        Belum ada topik untuk {namaCakupan}. Tulis namanya di baris paling bawah untuk membuatnya.
                      </td>
                    </tr>
                  )}
                  {daftar.map((t, i) => {
                    const sedang = sibuk.has(t.id);
                    return (
                      <tr key={t.id}>
                        <td className="kol-utama">
                          <SelTeksInline
                            nilai={t.nama}
                            label={`nama topik ${t.nama}`}
                            maxLength={NAMA_MAX}
                            validasi={(baru) => validasiNama(baru, t.id)}
                            onSimpan={(baru) => ubahNama(t, baru)}
                          />
                        </td>
                        <td>
                          <div className={styles.geser}>
                            <button
                              type="button"
                              id={`${idDasar}-${t.id}-naik`}
                              className="btn btn--ghost btn--sm"
                              aria-label={`Naikkan ${t.nama}`}
                              disabled={!bisaGeser(daftar, i, -1) || sedang}
                              onClick={() => void geser(i, -1)}
                            >
                              <ArrowUp size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              id={`${idDasar}-${t.id}-turun`}
                              className="btn btn--ghost btn--sm"
                              aria-label={`Turunkan ${t.nama}`}
                              disabled={!bisaGeser(daftar, i, 1) || sedang}
                              onClick={() => void geser(i, 1)}
                            >
                              <ArrowDown size={14} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                        <td>
                          <label className={styles.saklarBaris}>
                            <input
                              type="checkbox"
                              role="switch"
                              className="saklar"
                              aria-label={`Aktif: ${t.nama}`}
                              checked={t.aktif}
                              disabled={sedang}
                              aria-busy={sedang || undefined}
                              onChange={() => void ubahAktif(t)}
                            />
                            <span>{t.aktif ? 'Aktif' : 'Nonaktif'}</span>
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                  <BarisTambah
                    kolom={3}
                    labelTombol="Tambah"
                    ariaTombol={`Tambah topik ${namaCakupan}`}
                    bidang={[{ kunci: 'nama', label: 'Topik baru', placeholder: `+ Tambah topik ${namaCakupan}`, maxLength: NAMA_MAX }]}
                    onTambah={tambah}
                  />
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {pengumuman}
      </p>
    </>
  );
}
