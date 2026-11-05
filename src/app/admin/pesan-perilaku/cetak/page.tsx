'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Galat from '@/components/ui/Galat';
import Skeleton from '@/components/ui/Skeleton';
import Tombol from '@/components/ui/Tombol';
import PemilihRentang from '@/components/ui/PemilihRentang';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import { formatTanggal, formatWaktu } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { toWIBDateString, todayWIB } from '@/lib/time';
import { AMBANG_IKM, KETERANGAN_AMBANG_IKM, fmtIkm } from '@/lib/ikm';
import { KODE_MIGRASI_BELUM, objekBelumAda } from '@/lib/akses-data/galat';
import { fmtAngka, fmtPersen, jumlahPer, persen, type PengaduanBaris, type SaranBaris } from '@/lib/survei/laporan';
import { rentangPreset } from '@/lib/survei/rentang';
import type { RingkasanIkmGlobal, RingkasanSpakGlobal } from '@/lib/survei/ringkasan-global';
import styles from './cetak.module.css';

interface RingkasanGlobal { ikm: RingkasanIkmGlobal; spak: RingkasanSpakGlobal; responseRate: { diundang: number; mengisi: number; persen: number | null }; terpotong: boolean }
interface SaranIsi { id: string; isi: string; created_at: string; pelapor_nama: string | null; unit: string; layanan: { nama: string } | { nama: string }[] | null }

const STATUS_PENGADUAN: Record<string, string> = {
  baru: 'Baru', diverifikasi: 'Diverifikasi', diproses: 'Diproses', eskalasi: 'Eskalasi', selesai: 'Selesai', ditolak: 'Ditolak',
};
const SUMBER: Record<string, string> = { web: 'Formulir web', publik: 'Tautan publik', wizard: 'Pesan Perilaku', impor: 'Impor' };

const tglId = (iso: string) => formatTanggal(`${iso}T00:00:00+07:00`);

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const BATAS_SARAN = 300;

/** Semua data satu laporan beserta periode yang benar-benar dimuat (label periode selalu mengikuti data, bukan isian filter). */
interface Muatan {
  dari: string;
  sampai: string;
  global: RingkasanGlobal;
  /** null = migrasi pengaduan/saran belum diterapkan (bagian tertulis "belum tersedia", bukan nol). */
  pengaduan: PengaduanBaris[] | null;
  saranRingkas: SaranBaris[] | null;
  saranIsi: SaranIsi[] | null;
  /** Jumlah saran menurut query isi (count exact); cadangan bila RPC ringkasan belum ada. */
  saranTotalQuery: number | null;
  dicetakPada: string;
}

function Batang({ nilai, maks = 100 }: { nilai: number | null; maks?: number }) {
  const lebar = nilai === null ? 0 : Math.max(0, Math.min(100, (nilai / maks) * 100));
  return (
    <span className={styles.batang} role="img" aria-label={nilai === null ? 'tidak ada data' : `${nilai.toFixed(1)} dari ${maks}`}>
      <span className={styles.batangIsi} style={{ width: `${lebar}%` }} /><span className={styles.batangNilai}>{nilai === null ? '—' : nilai.toFixed(1)}</span>
    </span>
  );
}

function CetakPesanPerilaku() {
  const params = useSearchParams();
  const awal = rentangPreset('bulan', todayWIB());
  const dariUrl = params.get('dari');
  const sampaiUrl = params.get('sampai');
  const urlSah = dariUrl !== null && sampaiUrl !== null && POLA_TANGGAL.test(dariUrl) && POLA_TANGGAL.test(sampaiUrl) && dariUrl <= sampaiUrl;
  const [dari, setDari] = useState(urlSah ? dariUrl : awal.dari);
  const [sampai, setSampai] = useState(urlSah ? sampaiUrl : awal.sampai);
  const [loading, setLoading] = useState(true);
  const [galat, setGalat] = useState('');
  const [belum, setBelum] = useState(false);
  const [muatan, setMuatan] = useState<Muatan | null>(null);
  const permintaanTerakhir = useRef(0);

  const muat = useCallback(async () => {
    // Hanya jawaban permintaan terakhir yang dipakai: ganti periode cepat tidak boleh menampilkan respons basi.
    const nomor = ++permintaanTerakhir.current;
    setLoading(true);
    setGalat('');
    setBelum(false);
    // Data periode sebelumnya dibuang: galat tidak boleh menyisakan angka lama di bawah label periode baru.
    setMuatan(null);
    try {
      const supabase = createClient();
      const arg = { p_start: dari, p_end: sampai };
      const [g, d, e, f] = await Promise.all([
        fetch(`/api/admin/survei/ringkasan?dari=${dari}&sampai=${sampai}`, { cache: 'no-store' }),
        supabase.rpc('ringkasan_pengaduan', arg),
        supabase.rpc('ringkasan_saran', arg),
        supabase
          .from('saran')
          .select('id, isi, created_at, pelapor_nama, unit, layanan:layanan_id ( nama )', { count: 'exact' })
          .gte('created_at', `${dari}T00:00:00+07:00`)
          .lt('created_at', `${toWIBDateString(new Date(new Date(`${sampai}T00:00:00+07:00`).getTime() + 86_400_000))}T00:00:00+07:00`)
          .order('created_at', { ascending: false })
          .limit(BATAS_SARAN),
      ]);
      if (!g.ok) {
        const isi = await g.json().catch(() => null);
        if (isi?.code === KODE_MIGRASI_BELUM || isi?.error === KODE_MIGRASI_BELUM || objekBelumAda(isi)) throw { code: 'PGRST202' };
        throw new Error(`ringkasan ${g.status}`);
      }
      // Saran/pengaduan boleh belum tersedia karena migrasi belum diterapkan (ditandai null, bukan nol).
      // Galat lain (timeout, izin, jaringan) TIDAK boleh menjadi nol di kertas: laporan gagal seluruhnya.
      for (const hasil of [d, e, f]) {
        if (hasil.error && !objekBelumAda(hasil.error)) throw new Error(hasil.error.message);
      }
      const global = (await g.json()) as RingkasanGlobal;
      if (nomor !== permintaanTerakhir.current) return;
      setMuatan({
        dari,
        sampai,
        global,
        pengaduan: d.error ? null : ((d.data ?? []) as PengaduanBaris[]),
        saranRingkas: e.error ? null : ((e.data ?? []) as SaranBaris[]),
        saranIsi: f.error ? null : ((f.data ?? []) as unknown as SaranIsi[]),
        saranTotalQuery: f.error ? null : (f.count ?? (f.data ?? []).length),
        dicetakPada: `${formatTanggal(new Date())} ${formatWaktu(new Date())}`,
      });
    } catch (err) {
      if (nomor !== permintaanTerakhir.current) return;
      console.error('Laporan Pesan Perilaku:', err);
      setBelum(objekBelumAda(err));
      setGalat('Gagal memuat data laporan. Laporan tidak dapat dicetak sampai semua bagian berhasil dimuat.');
    } finally {
      if (nomor === permintaanTerakhir.current) setLoading(false);
    }
  }, [dari, sampai]);

  useEffect(() => {
    void Promise.resolve().then(() => muat());
  }, [muat]);

  const global = muatan?.global;
  const ikm = global?.ikm;
  const spak = global?.spak;
  const rrGab = global?.responseRate ?? { diundang: 0, mengisi: 0, persen: null };
  const pengaduan = muatan?.pengaduan ?? [];
  const saranIsi = muatan?.saranIsi ?? [];
  const pengaduanBelum = muatan !== null && muatan.pengaduan === null;
  const saranBelum = muatan !== null && muatan.saranIsi === null;
  const totalPengaduan = pengaduan.reduce((s, r) => s + r.jumlah, 0);
  const perStatus = jumlahPer(pengaduan, (r) => r.status);
  const perSumber = jumlahPer(pengaduan, (r) => r.sumber);
  const totalSaran: number | null = muatan?.saranRingkas
    ? muatan.saranRingkas.reduce((s, r) => s + r.jumlah, 0)
    : muatan?.saranTotalQuery ?? null;
  const saranTerpotong = totalSaran !== null && saranIsi.length < totalSaran;

  return (
    <>
      <div data-cetak="sembunyi">
        <PageHeader title="Laporan Pesan Perilaku" description="Rekap survei (IKM, SPAK), saran, dan pengaduan untuk dicetak atau disimpan sebagai PDF">
          <Tombol href="/admin/pesan-perilaku" varian="sekunder" ikon={ArrowLeft}>Kembali</Tombol>
        </PageHeader>
      </div>

      <div className={styles.layar}>
        <div className={styles.alat} data-cetak="sembunyi">
          <PemilihRentang dari={dari} sampai={sampai} onUbah={(r) => { setDari(r.dari); setSampai(r.sampai); }} label="Rentang tanggal" />
          <Tombol ikon={Printer} onClick={() => window.print()} disabled={loading || !muatan}>Cetak / Simpan PDF</Tombol>
        </div>

        {loading ? (
          <Skeleton bentuk="kartu" jumlah={3} label="Memuat laporan" />
        ) : belum ? (
          <CatatanKeadaan jenis="menunggu-migrasi" aksi={<Tombol varian="sekunder" onClick={() => void muat()}>Coba lagi</Tombol>}>
            Data laporan belum tersedia; pembaruan basis data belum diterapkan.
          </CatatanKeadaan>
        ) : galat || !muatan ? (
          <Galat pesan={galat || 'Data laporan belum tersedia.'} onRetry={() => void muat()} />
        ) : (
          <article id="laporan-cetak" className={styles.kertas}>
            <header className={styles.kop}>
              <h1>DINAS PENANAMAN MODAL DAN PELAYANAN TERPADU SATU PINTU</h1>
              <p>Provinsi Lampung</p>
            </header>
            <h2 className={styles.judul}>Laporan Pesan Perilaku</h2>
            <p className={styles.periode}>Periode {tglId(muatan.dari)} s.d. {tglId(muatan.sampai)}</p>

            <p className={styles.catatan}>Seluruh angka survei di laporan ini adalah gabungan seluruh pelayanan (tidak dipecah per Layanan).</p>
            {global?.terpotong && <p className={styles.catatan}>Catatan: jawaban melebihi batas baris dan terpotong; persempit periode agar lengkap.</p>}

            <section className={styles.bagian} aria-label="Ringkasan">
              <h2>1. Ringkasan</h2>
              <div className={styles.kartuRingkas}>
                <div className={styles.kartu}><b>{fmtIkm(ikm?.ikm ?? null)}</b><span>IKM ({ikm?.ikm == null ? '—' : ikm.mutuLabel})</span></div>
                <div className={styles.kartu}><b>{fmtAngka(spak?.indeks ?? null)}</b><span>Indeks SPAK (0–100)</span></div>
                <div className={styles.kartu}><b>{fmtPersen(spak?.persenSetuju ?? null)}</b><span>SPAK: jawaban setuju</span></div>
                <div className={styles.kartu}><b>{totalSaran ?? '—'}</b><span>Saran</span></div>
                <div className={styles.kartu}><b>{pengaduanBelum ? '—' : totalPengaduan}</b><span>Pengaduan</span></div>
              </div>
              <p className={styles.catatan}>
                Responden SKM: {ikm?.responden ?? 0}. Responden SPAK: {spak?.responden ?? 0}. Undangan terkirim {rrGab.diundang}, mengisi {rrGab.mengisi} ({fmtPersen(rrGab.persen)}).
              </p>
            </section>

            <section className={styles.bagian} aria-label="Indeks Kepuasan Masyarakat">
              <h2>2. Indeks Kepuasan Masyarakat (IKM)</h2>
              {!ikm || ikm.responden === 0 ? <p className={styles.kosong}>Belum ada jawaban pada periode ini.</p> : (
                <>
                  <p className={styles.catatan}><b>IKM {fmtIkm(ikm.ikm)}</b> — {ikm.mutuLabel} ({ikm.responden} responden)</p>
                  <table className={styles.tabel}>
                    <thead><tr><th>Unsur</th><th className={styles.angka}>Jawaban</th><th className={styles.angka}>Rata-rata (1–4)</th><th className={styles.angka}>Nilai (25–100)</th><th>Grafik (0–100)</th></tr></thead>
                    <tbody>
                      {ikm.unsur.map((u) => (
                        <tr key={u.kunci}>
                          <td><b>{u.kunci.toUpperCase()}</b> {u.teks}</td>
                          <td className={styles.angka}>{u.jawaban}</td>
                          <td className={styles.angka}>{fmtAngka(u.rata, 2)}</td>
                          <td className={styles.angka}>{fmtIkm(u.nilai)}</td>
                          <td><Batang nilai={u.nilai} /></td>
                        </tr>
                      ))}
                      <tr>
                        <th>Keseluruhan</th><th className={styles.angka}>{ikm.responden}</th><th />
                        <th className={styles.angka}>{fmtIkm(ikm.ikm)}</th><th><Batang nilai={ikm.ikm} /></th>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
              <p className={styles.catatan}>IKM = rata-rata nilai unsur yang terisi × 25 (skala 25–100). {KETERANGAN_AMBANG_IKM} ({AMBANG_IKM.rujukan}).</p>
            </section>

            <section className={styles.bagian} aria-label="Survei Persepsi Anti Korupsi">
              <h2>3. Survei Persepsi Anti Korupsi (SPAK)</h2>
              {!spak || spak.responden === 0 ? <p className={styles.kosong}>Belum ada jawaban pada periode ini.</p> : (
                <>
                  <p className={styles.catatan}>
                    <b>Indeks SPAK {fmtAngka(spak.indeks)}</b> (rata-rata {fmtAngka(spak.rata, 2)} dari 6) — {spak.responden} responden. Setuju {fmtPersen(spak.persenSetuju)},
                    netral {fmtPersen(spak.persenNetral)}, tidak setuju {fmtPersen(spak.persenTidakSetuju)}.
                  </p>
                  <table className={styles.tabel}>
                    <thead>
                      <tr>
                        <th>Pernyataan</th><th className={styles.angka}>Rata-rata</th><th className={styles.angka}>Indeks</th>
                        <th className={styles.angka}>Setuju</th><th className={styles.angka}>Netral</th><th className={styles.angka}>Tidak setuju</th><th>Grafik setuju</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spak.butir.map((b) => (
                        <tr key={b.kunci}>
                          <td><b>{b.kunci.toUpperCase()}</b> {b.teks}</td>
                          <td className={styles.angka}>{fmtAngka(b.rata, 2)}</td>
                          <td className={styles.angka}>{fmtAngka(b.indeks)}</td>
                          <td className={styles.angka}>{fmtPersen(b.persenSetuju)}</td>
                          <td className={styles.angka}>{fmtPersen(b.persenNetral)}</td>
                          <td className={styles.angka}>{fmtPersen(b.persenTidakSetuju)}</td>
                          <td><Batang nilai={b.persenSetuju} /></td>
                        </tr>
                      ))}
                      <tr>
                        <th>Keseluruhan</th><th className={styles.angka}>{fmtAngka(spak.rata, 2)}</th><th className={styles.angka}>{fmtAngka(spak.indeks)}</th>
                        <th className={styles.angka}>{fmtPersen(spak.persenSetuju)}</th><th className={styles.angka}>{fmtPersen(spak.persenNetral)}</th>
                        <th className={styles.angka}>{fmtPersen(spak.persenTidakSetuju)}</th><th><Batang nilai={spak.persenSetuju} /></th>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
              <p className={styles.catatan}>Skala 1 (sangat tidak setuju) sampai 6 (sangat setuju); makin tinggi makin baik. Indeks = rata-rata ÷ 6 × 100. Setuju = nilai 5–6, netral = 3–4, tidak setuju = 1–2 (persen dari jumlah jawaban).</p>
            </section>

            <section className={styles.bagian} aria-label="Tingkat pengisian">
              <h2>4. Tingkat Pengisian Survei</h2>
              {rrGab.diundang === 0 ? <p className={styles.kosong}>Belum ada undangan pada periode ini.</p> : (
                <table className={styles.tabel}>
                  <thead><tr><th>Diundang</th><th className={styles.angka}>Mengisi</th><th className={styles.angka}>Persen</th><th>Grafik</th></tr></thead>
                  <tbody>
                    <tr>
                      <td>{rrGab.diundang}</td><td className={styles.angka}>{rrGab.mengisi}</td>
                      <td className={styles.angka}>{fmtPersen(persen(rrGab.mengisi, rrGab.diundang))}</td><td><Batang nilai={persen(rrGab.mengisi, rrGab.diundang)} /></td>
                    </tr>
                  </tbody>
                </table>
              )}
            </section>

            <section className={styles.bagian} aria-label="Pengaduan">
              <h2>5. Pengaduan</h2>
              {pengaduanBelum ? <CatatanKeadaan jenis="menunggu-migrasi">Data pengaduan belum tersedia (pembaruan basis data belum diterapkan); angka pengaduan tidak dapat dicetak.</CatatanKeadaan>
                : totalPengaduan === 0 ? <p className={styles.kosong}>Tidak ada pengaduan pada periode ini.</p> : (
                <table className={styles.tabel}>
                  <thead><tr><th>Kelompok</th><th>Rincian</th><th className={styles.angka}>Jumlah</th></tr></thead>
                  <tbody>
                    {Object.entries(perStatus).map(([k, v]) => <tr key={`s-${k}`}><td>Status</td><td>{STATUS_PENGADUAN[k] ?? k}</td><td className={styles.angka}>{v}</td></tr>)}
                    {Object.entries(perSumber).map(([k, v]) => <tr key={`m-${k}`}><td>Sumber</td><td>{SUMBER[k] ?? k}</td><td className={styles.angka}>{v}</td></tr>)}
                    <tr><th colSpan={2}>Total</th><th className={styles.angka}>{totalPengaduan}</th></tr>
                  </tbody>
                </table>
              )}
              <p className={styles.catatan}>Isi pengaduan tidak dicetak di laporan ini; tindak lanjut ada di menu Pengaduan.</p>
            </section>

            <section className={styles.bagian} aria-label="Saran">
              <h2>6. Saran</h2>
              {saranBelum ? <CatatanKeadaan jenis="menunggu-migrasi">Data saran belum tersedia (pembaruan basis data belum diterapkan); saran tidak dapat dicetak.</CatatanKeadaan> : (
                <p className={styles.catatan}>Jumlah saran pada periode ini: {totalSaran ?? '—'}.</p>
              )}
              {saranTerpotong && <p className={styles.catatan}>Catatan: laporan ini menampilkan {saranIsi.length} dari {totalSaran} saran terbaru; sisanya dapat dilihat di menu Saran.</p>}
              {saranBelum ? null : saranIsi.length === 0 ? <p className={styles.kosong}>Tidak ada saran pada periode ini.</p> : (
                <ol className={styles.daftarSaran}>
                  {saranIsi.map((s) => {
                    const lay = Array.isArray(s.layanan) ? s.layanan[0]?.nama : s.layanan?.nama;
                    return (
                      <li key={s.id}>
                        {s.isi}
                        <div className={styles.meta}>
                          {formatTanggal(s.created_at)} · {s.unit === 'fo' ? 'Front Office' : lay ?? 'Unit tidak diketahui'} · {s.pelapor_nama ?? 'Anonim'}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            <div className={styles.ttd}>
              <div>
                Bandar Lampung, {tglId(toWIBDateString(new Date()))}
                <span />
                (................................)
              </div>
            </div>
            <p className={styles.catatan}>Dicetak dari Lampung Maju Hub pada {muatan.dicetakPada} WIB.</p>
          </article>
        )}
      </div>
    </>
  );
}

export default function CetakPesanPerilakuPage() {
  return (
    <Suspense fallback={<Skeleton bentuk="kartu" label="Memuat laporan" />}>
      <CetakPesanPerilaku />
    </Suspense>
  );
}
