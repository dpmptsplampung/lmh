'use client';

// Editor blok homepage (Fase 2): admin menyalakan/mematikan, mengurutkan, dan mengubah teks tiap blok berjenis
// tetap (bukan page builder). Kartu layanan TIDAK diatur di sini: terisi otomatis dari Kelola Layanan.
// Blok mati tidak tampil di homepage (tanpa teks cadangan). Isian kosong = teks bawaan (tampil sebagai placeholder).
// Simpan = satu upsert 7 baris yang DICEK: 0 baris (RLS menolak diam-diam) atau sebagian bukan "berhasil".
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Save } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { useToast } from '@/components/Toast';
import {
  DEFINISI_BLOK,
  JENIS_BLOK,
  gabungkanBlok,
  linkAman,
  type BarisBlok,
  type JenisBlok,
} from '@/lib/homepage/blok';
import styles from './landing.module.css';

type TeksEdit = Record<string, string>;

// Hanya galat "relasi tidak ada" (Postgres 42P01, PostgREST PGRST205) yang berarti migrasi belum diterapkan;
// galat lain (timeout, jaringan, RLS) adalah kegagalan baca biasa.
const KODE_TABEL_HILANG = new Set(['42P01', 'PGRST205']);

const PESAN_TAUTAN = 'Tautan harus diawali / atau https:// (atau dikosongkan untuk memakai bawaan).';

const kosongTeks = (): Record<JenisBlok, TeksEdit> =>
  Object.fromEntries(JENIS_BLOK.map((j) => [j, {}])) as unknown as Record<JenisBlok, TeksEdit>;

export default function EditorBlokHomepagePage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  /** Tabel homepage_blok belum ada / tak terbaca: editor tampil dengan bawaan, simpan dinonaktifkan. */
  const [tabelBelumAda, setTabelBelumAda] = useState(false);
  /** Gagal membaca karena sebab lain: data asli tak diketahui, jadi simpan dinonaktifkan (jangan menimpa dengan bawaan). */
  const [galatMuat, setGalatMuat] = useState(false);
  // Urutan jenis tanpa footer (footer selalu terakhir dan tidak bisa dipindah).
  const [urutan, setUrutan] = useState<JenisBlok[]>(() => JENIS_BLOK.filter((j) => j !== 'footer'));
  const [aktif, setAktif] = useState<Record<JenisBlok, boolean>>(
    () => Object.fromEntries(JENIS_BLOK.map((j) => [j, DEFINISI_BLOK[j].aktifBawaan])) as Record<JenisBlok, boolean>,
  );
  const [teks, setTeks] = useState<Record<JenisBlok, TeksEdit>>(kosongTeks);
  const [galat, setGalat] = useState<Record<string, string>>({});
  const [menyimpan, setMenyimpan] = useState(false);

  const muat = useCallback(async () => {
    setLoading(true);
    let rows: BarisBlok[] | null = null;
    setTabelBelumAda(false);
    setGalatMuat(false);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.from('homepage_blok').select('jenis, aktif, urutan, teks');
      if (error || !Array.isArray(data)) throw error ?? new Error('tak terbaca');
      rows = data as BarisBlok[];
    } catch (e) {
      const kode = (e as { code?: unknown } | null)?.code;
      if (typeof kode === 'string' && KODE_TABEL_HILANG.has(kode)) setTabelBelumAda(true);
      else setGalatMuat(true);
    }
    const tersusun = gabungkanBlok(rows);
    setUrutan(tersusun.filter((b) => b.jenis !== 'footer').map((b) => b.jenis));
    setAktif(Object.fromEntries(tersusun.map((b) => [b.jenis, b.aktif])) as Record<JenisBlok, boolean>);
    // Isian = nilai KUSTOM mentah dari DB (bukan bawaan), agar menyimpan tidak membekukan teks bawaan.
    const mentah = kosongTeks();
    for (const r of rows ?? []) {
      if (!(JENIS_BLOK as readonly string[]).includes(r.jenis) || !r.teks || typeof r.teks !== 'object') continue;
      const j = r.jenis as JenisBlok;
      for (const b of DEFINISI_BLOK[j].bidang) {
        const v = r.teks[b.kunci];
        if (typeof v === 'string') mentah[j][b.kunci] = v;
      }
    }
    setTeks(mentah);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    muat();
  }, [muat]);

  const ubahTeks = (jenis: JenisBlok, kunci: string, nilai: string) => {
    setTeks((prev) => ({ ...prev, [jenis]: { ...prev[jenis], [kunci]: nilai } }));
    setGalat((g) => (g[`${jenis}.${kunci}`] ? { ...g, [`${jenis}.${kunci}`]: '' } : g));
  };

  const pindah = (indeks: number, arah: -1 | 1) => {
    setUrutan((prev) => {
      const tujuan = indeks + arah;
      if (tujuan < 0 || tujuan >= prev.length) return prev;
      const baru = [...prev];
      [baru[indeks], baru[tujuan]] = [baru[tujuan], baru[indeks]];
      return baru;
    });
  };

  const simpan = async () => {
    const semua: JenisBlok[] = [...urutan, 'footer'];
    // Validasi tautan di klien (linkAman juga menyaring saat render).
    const g: Record<string, string> = {};
    for (const j of semua) {
      for (const b of DEFINISI_BLOK[j].bidang) {
        const v = (teks[j][b.kunci] ?? '').trim();
        if (b.tautan && v !== '' && linkAman(v, '', { izinkanWa: b.kunci === 'cta_secondary_link' }) === '') {
          g[`${j}.${b.kunci}`] = PESAN_TAUTAN;
        }
      }
    }
    setGalat(g);
    if (Object.keys(g).length > 0) {
      toast('Periksa isian yang bertanda galat.', 'error');
      return;
    }

    const rows = semua.map((j, i) => ({
      jenis: j,
      aktif: aktif[j],
      urutan: (i + 1) * 10,
      teks: Object.fromEntries(
        DEFINISI_BLOK[j].bidang
          .map((b) => [b.kunci, (teks[j][b.kunci] ?? '').trim()] as const)
          .filter(([, v]) => v !== ''),
      ),
    }));

    setMenyimpan(true);
    try {
      const supabase = createClient();
      // Isian di layar SENGAJA tidak dimuat ulang saat gagal (tidak membuang ketikan); upsert idempoten.
      const tersimpan = await mutasiWajibBaris(
        supabase.from('homepage_blok').upsert(rows, { onConflict: 'jenis' }).select('jenis'),
      );
      if (tersimpan.length < rows.length) {
        toast(`Hanya ${tersimpan.length} dari ${rows.length} blok tersimpan. Simpan ulang untuk mencoba lagi.`, 'error');
        return;
      }
      toast('Blok homepage berhasil disimpan!', 'success');
    } catch (e) {
      toast(`Gagal menyimpan blok homepage. ${pesanMutasi(e)}`, 'error');
    } finally {
      setMenyimpan(false);
    }
  };

  const judul = 'Blok Homepage';
  const deskripsi = 'Atur blok yang tampil di halaman utama: nyalakan, urutkan, dan ubah teksnya';

  if (loading) {
    return (
      <>
        <PageHeader title={judul} description={deskripsi} />
        <div className={styles.landingPage}>
          <div className={styles.loadingState}>
            <Loader2 size={20} className="animate-spin" />
            Memuat blok…
          </div>
        </div>
      </>
    );
  }

  const kartuBlok = (jenis: JenisBlok, indeks: number | null) => {
    const def = DEFINISI_BLOK[jenis];
    return (
      <fieldset key={jenis} className={styles.serviceCard} style={{ margin: 0 }}>
        <legend className={styles.sectionTitle} style={{ padding: '0 var(--space-2)' }}>{def.label}</legend>

        {def.catatan && <p className="form-hint">{def.catatan}</p>}

        <div className={styles.serviceCardHeader}>
          <div className={styles.toggleRow}>
            <label className={styles.toggleSwitch}>
              <input
                type="checkbox"
                aria-label="Tampilkan blok ini di homepage"
                checked={aktif[jenis]}
                onChange={(e) => setAktif((prev) => ({ ...prev, [jenis]: e.target.checked }))}
              />
              <span className={styles.toggleSlider} />
            </label>
            <span className={styles.toggleLabel}>Tampilkan blok ini di homepage</span>
          </div>
          {indeks !== null && (
            <div className={styles.serviceReorder}>
              <button
                type="button"
                className={styles.reorderBtn}
                onClick={() => pindah(indeks, -1)}
                disabled={indeks === 0}
                aria-label={`Naikkan blok ${def.label}`}
              >
                <ChevronUp size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.reorderBtn}
                onClick={() => pindah(indeks, 1)}
                disabled={indeks === urutan.length - 1}
                aria-label={`Turunkan blok ${def.label}`}
              >
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <div className={styles.fieldGrid}>
          {def.bidang.map((b) => {
            const id = `blok-${jenis}-${b.kunci}`;
            const kunciGalat = `${jenis}.${b.kunci}`;
            const bantu = galat[kunciGalat] ? `${id}-galat` : undefined;
            const nilai = teks[jenis][b.kunci] ?? '';
            return (
              <div key={b.kunci} className={b.panjang === 'panjang' ? styles.fieldGridFull : ''}>
                <div className="form-group">
                  <label className="form-label" htmlFor={id}>{b.label}</label>
                  {b.panjang === 'panjang' ? (
                    <textarea
                      id={id}
                      className="form-textarea"
                      rows={3}
                      value={nilai}
                      placeholder={def.bawaan[b.kunci]}
                      aria-invalid={galat[kunciGalat] ? true : undefined}
                      aria-describedby={bantu}
                      onChange={(e) => ubahTeks(jenis, b.kunci, e.target.value)}
                    />
                  ) : (
                    <input
                      id={id}
                      type="text"
                      className="form-input"
                      value={nilai}
                      placeholder={def.bawaan[b.kunci]}
                      aria-invalid={galat[kunciGalat] ? true : undefined}
                      aria-describedby={bantu}
                      onChange={(e) => ubahTeks(jenis, b.kunci, e.target.value)}
                    />
                  )}
                  {galat[kunciGalat] && <p id={`${id}-galat`} className="form-error" role="alert">{galat[kunciGalat]}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>
    );
  };

  return (
    <>
      <PageHeader title={judul} description={deskripsi} />

      <div className={styles.landingPage}>
        <Link href="/admin/settings" className={styles.backLink}>
          <ArrowLeft size={16} />
          Kembali ke Pengaturan
        </Link>

        {galatMuat && (
          <div className="form-error" role="alert">
            <p>Gagal memuat blok homepage. Perubahan belum bisa disimpan agar data yang ada tidak tertimpa; coba muat ulang.</p>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void muat()}>
              Coba lagi
            </button>
          </div>
        )}
        {tabelBelumAda && (
          <p className="form-error" role="alert">
            Tabel blok homepage belum tersedia. Terapkan migrasi 202610280001 lebih dulu; sementara itu homepage memakai
            pengaturan bawaan dan perubahan di sini belum bisa disimpan.
          </p>
        )}
        <p className="form-hint">
          Kartu layanan terisi otomatis dari <Link href="/admin/layanan">Kelola Layanan</Link>. Isian yang dikosongkan memakai
          teks bawaan (ditampilkan abu-abu). Blok yang dimatikan tidak tampil sama sekali.
        </p>

        <div className={styles.serviceCards}>
          {urutan.map((jenis, i) => kartuBlok(jenis, i))}
          {kartuBlok('footer', null)}
        </div>

        <div className={styles.saveBar}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={simpan}
            disabled={menyimpan || tabelBelumAda || galatMuat}
            aria-busy={menyimpan}
          >
            {menyimpan ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Menyimpan...
              </>
            ) : (
              <>
                <Save size={16} />
                Simpan Perubahan
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
