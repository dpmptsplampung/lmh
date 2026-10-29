'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { toWIBDateString } from '@/lib/time';
import { fmtIkm, ikmQualityLabel, type IkmRow } from '@/lib/ikm';
import { PERTANYAAN_SPAK } from '@/lib/survei/pertanyaan';
import {
  angka, fmtAngka, fmtPersen, ikmGabungan, indeksSpak, jumlahPer, persen, rataSpakBaris, responseRateGabungan, spakGabungan,
  type PengaduanBaris, type ResponseRateBaris, type SaranBaris, type SpakBaris,
} from '@/lib/survei/laporan';
import styles from './cetak.module.css';

interface RingkasanIkmBaris { layanan_id: string | null; unit: string; nama: string; ikm: number | string | null; responden: number | null }
interface SaranIsi { id: string; isi: string; created_at: string; pelapor_nama: string | null; unit: string; layanan: { nama: string } | { nama: string }[] | null }

const STATUS_PENGADUAN: Record<string, string> = {
  baru: 'Baru', diverifikasi: 'Diverifikasi', diproses: 'Diproses', eskalasi: 'Eskalasi', selesai: 'Selesai', ditolak: 'Ditolak',
};
const SUMBER: Record<string, string> = { web: 'Formulir web', wizard: 'Pesan Perilaku', impor: 'Impor' };

const tglId = (iso: string) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

function awalBulan(): string {
  const n = new Date();
  return toWIBDateString(new Date(n.getFullYear(), n.getMonth(), 1));
}

function Batang({ nilai, maks = 100 }: { nilai: number | null; maks?: number }) {
  const lebar = nilai === null ? 0 : Math.max(0, Math.min(100, (nilai / maks) * 100));
  return (
    <span className={styles.batang} role="img" aria-label={nilai === null ? 'tidak ada data' : `${nilai.toFixed(1)} dari ${maks}`}>
      <span className={styles.batangIsi} style={{ width: `${lebar}%` }} />
    </span>
  );
}

export default function CetakPesanPerilakuPage() {
  const [dari, setDari] = useState(awalBulan);
  const [sampai, setSampai] = useState(() => toWIBDateString(new Date()));
  const [loading, setLoading] = useState(true);
  const [galat, setGalat] = useState('');
  const [ikm, setIkm] = useState<IkmRow[]>([]);
  const [spak, setSpak] = useState<SpakBaris[]>([]);
  const [rr, setRr] = useState<ResponseRateBaris[]>([]);
  const [pengaduan, setPengaduan] = useState<PengaduanBaris[]>([]);
  const [saranRingkas, setSaranRingkas] = useState<SaranBaris[]>([]);
  const [saranIsi, setSaranIsi] = useState<SaranIsi[]>([]);
  const [dicetakPada, setDicetakPada] = useState('');

  const muat = useCallback(async () => {
    setLoading(true);
    setGalat('');
    try {
      const supabase = createClient();
      const arg = { p_start: dari, p_end: sampai };
      const [a, b, c, d, e, f] = await Promise.all([
        supabase.rpc('ringkasan_ikm', arg),
        supabase.rpc('ringkasan_spak', arg),
        supabase.rpc('ringkasan_response_rate', arg),
        supabase.rpc('ringkasan_pengaduan', arg),
        supabase.rpc('ringkasan_saran', arg),
        supabase
          .from('saran')
          .select('id, isi, created_at, pelapor_nama, unit, layanan:layanan_id ( nama )')
          .gte('created_at', `${dari}T00:00:00+07:00`)
          .lt('created_at', `${toWIBDateString(new Date(new Date(`${sampai}T00:00:00+07:00`).getTime() + 86_400_000))}T00:00:00+07:00`)
          .order('created_at', { ascending: false })
          .limit(300),
      ]);
      // Saran/pengaduan boleh belum tersedia (migrasi belum diterapkan): bagian itu kosong, laporan survei tetap tampil.
      if (a.error) throw a.error;
      setIkm(((a.data ?? []) as RingkasanIkmBaris[]).map((r) => ({
        layanan_id: r.layanan_id ?? r.unit, layanan_nama: r.nama, ikm: angka(r.ikm), responden: r.responden ?? 0,
      })));
      setSpak(((b.data ?? []) as SpakBaris[]));
      setRr((c.data ?? []) as ResponseRateBaris[]);
      setPengaduan((d.data ?? []) as PengaduanBaris[]);
      setSaranRingkas((e.data ?? []) as SaranBaris[]);
      setSaranIsi((f.data ?? []) as unknown as SaranIsi[]);
      setDicetakPada(new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' }));
    } catch (err) {
      console.error('Laporan Pesan Perilaku:', err);
      setGalat('Gagal memuat data laporan.');
    } finally {
      setLoading(false);
    }
  }, [dari, sampai]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void muat();
  }, [muat]);

  const gab = ikmGabungan(ikm);
  const spakGab = spakGabungan(spak);
  const rrGab = responseRateGabungan(rr);
  const totalPengaduan = pengaduan.reduce((s, r) => s + r.jumlah, 0);
  const perStatus = jumlahPer(pengaduan, (r) => r.status);
  const perSumber = jumlahPer(pengaduan, (r) => r.sumber);
  const totalSaran = saranRingkas.reduce((s, r) => s + r.jumlah, 0);

  return (
    <>
      {/* Cetak: hanya #laporan-cetak yang tampil (sidebar, header, dan kontrol disembunyikan). */}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #laporan-cetak, #laporan-cetak * { visibility: visible !important; }
        #laporan-cetak { position: absolute; left: 0; top: 0; width: 100%; max-width: none; border: 0; border-radius: 0; padding: 0; }
        @page { size: A4; margin: 14mm 12mm; }
      }`}</style>

      <PageHeader title="Laporan Pesan Perilaku" description="Rekap survei (IKM, SPAK), saran, dan pengaduan untuk dicetak atau disimpan sebagai PDF">
        <Link href="/admin/pesan-perilaku" className="btn btn--ghost btn--sm"><ArrowLeft size={16} /> Kembali</Link>
      </PageHeader>

      <div className={styles.layar}>
        <div className={styles.alat}>
          <label>Dari<input type="date" value={dari} max={sampai} onChange={(e) => e.target.value && setDari(e.target.value)} /></label>
          <label>Sampai<input type="date" value={sampai} min={dari} onChange={(e) => e.target.value && setSampai(e.target.value)} /></label>
          <button type="button" className="btn btn--primary" onClick={() => window.print()} disabled={loading}>
            <Printer size={16} /> Cetak / Simpan PDF
          </button>
        </div>

        {galat && <p role="alert" style={{ color: 'var(--color-danger-600, #dc2626)' }}>{galat}</p>}
        {loading ? (
          <p><Loader2 size={20} className="animate-pulse" aria-hidden="true" /> Memuat…</p>
        ) : (
          <article id="laporan-cetak" className={styles.kertas}>
            <header className={styles.kop}>
              <h1>DINAS PENANAMAN MODAL DAN PELAYANAN TERPADU SATU PINTU</h1>
              <p>Provinsi Lampung</p>
            </header>
            <h2 className={styles.judul}>Laporan Pesan Perilaku</h2>
            <p className={styles.periode}>Periode {tglId(dari)} s.d. {tglId(sampai)}</p>

            <section className={styles.bagian} aria-label="Ringkasan">
              <h2>1. Ringkasan</h2>
              <div className={styles.kartuRingkas}>
                <div className={styles.kartu}><b>{fmtIkm(gab.ikm)}</b><span>IKM ({gab.ikm === null ? '—' : ikmQualityLabel(gab.ikm)})</span></div>
                <div className={styles.kartu}><b>{fmtAngka(spakGab.rata, 2)}</b><span>Rata-rata SPAK (skala 1–6)</span></div>
                <div className={styles.kartu}><b>{totalSaran}</b><span>Saran</span></div>
                <div className={styles.kartu}><b>{totalPengaduan}</b><span>Pengaduan</span></div>
              </div>
              <p className={styles.catatan}>
                Responden SKM: {gab.responden}. Responden SPAK: {spakGab.responden}. Undangan terkirim {rrGab.diundang}, mengisi {rrGab.mengisi} ({fmtPersen(rrGab.persen)}).
              </p>
            </section>

            <section className={styles.bagian} aria-label="Indeks Kepuasan Masyarakat">
              <h2>2. Indeks Kepuasan Masyarakat (IKM) per Unit</h2>
              {ikm.length === 0 ? <p className={styles.kosong}>Belum ada jawaban pada periode ini.</p> : (
                <table className={styles.tabel}>
                  <thead><tr><th>Unit</th><th className={styles.angka}>Responden</th><th className={styles.angka}>IKM</th><th>Mutu</th><th>Grafik (0–100)</th></tr></thead>
                  <tbody>
                    {ikm.map((r) => (
                      <tr key={r.layanan_id}>
                        <td>{r.layanan_nama}</td>
                        <td className={styles.angka}>{r.responden}</td>
                        <td className={styles.angka}>{fmtIkm(r.ikm)}</td>
                        <td>{ikmQualityLabel(r.ikm)}</td>
                        <td><Batang nilai={r.ikm} /></td>
                      </tr>
                    ))}
                    <tr>
                      <th>Keseluruhan</th><th className={styles.angka}>{gab.responden}</th><th className={styles.angka}>{fmtIkm(gab.ikm)}</th><th>{ikmQualityLabel(gab.ikm)}</th><th><Batang nilai={gab.ikm} /></th>
                    </tr>
                  </tbody>
                </table>
              )}
              <p className={styles.catatan}>IKM = rata-rata nilai unsur yang terisi × 25 (skala 25–100). Keseluruhan dibobot jumlah responden.</p>
            </section>

            <section className={styles.bagian} aria-label="Survei Persepsi Anti Korupsi">
              <h2>3. Survei Persepsi Anti Korupsi (SPAK)</h2>
              {spak.length === 0 ? <p className={styles.kosong}>Belum ada jawaban pada periode ini.</p> : (
                <table className={styles.tabel}>
                  <thead>
                    <tr>
                      <th>Unit</th><th className={styles.angka}>Resp.</th>
                      {PERTANYAAN_SPAK.map((p, i) => <th key={p.kunci} className={styles.angka} title={p.teks}>P{i + 1}</th>)}
                      <th className={styles.angka}>Rata-rata</th><th className={styles.angka}>Indeks</th><th>Grafik</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spak.map((r) => {
                      const rata = rataSpakBaris(r);
                      return (
                        <tr key={`${r.unit}-${r.layanan_id ?? r.nama}`}>
                          <td>{r.nama}</td><td className={styles.angka}>{r.responden}</td>
                          {(['p1', 'p2', 'p3', 'p4', 'p5'] as const).map((k) => <td key={k} className={styles.angka}>{fmtAngka(angka(r[k]), 2)}</td>)}
                          <td className={styles.angka}>{fmtAngka(rata, 2)}</td>
                          <td className={styles.angka}>{fmtAngka(indeksSpak(rata))}</td>
                          <td><Batang nilai={indeksSpak(rata)} /></td>
                        </tr>
                      );
                    })}
                    <tr>
                      <th>Keseluruhan</th><th className={styles.angka}>{spakGab.responden}</th>
                      {(['p1', 'p2', 'p3', 'p4', 'p5'] as const).map((k) => <th key={k} className={styles.angka}>{fmtAngka(spakGab.p[k], 2)}</th>)}
                      <th className={styles.angka}>{fmtAngka(spakGab.rata, 2)}</th><th className={styles.angka}>{fmtAngka(indeksSpak(spakGab.rata))}</th><th><Batang nilai={indeksSpak(spakGab.rata)} /></th>
                    </tr>
                  </tbody>
                </table>
              )}
              <ol className={styles.catatan} style={{ paddingLeft: 18 }}>
                {PERTANYAAN_SPAK.map((p) => <li key={p.kunci}>{p.teks}</li>)}
              </ol>
              <p className={styles.catatan}>Skala 1 (sangat tidak setuju) sampai 6 (sangat setuju); makin tinggi makin baik. Indeks = rata-rata ÷ 6 × 100.</p>
            </section>

            <section className={styles.bagian} aria-label="Tingkat pengisian">
              <h2>4. Tingkat Pengisian Survei</h2>
              {rr.length === 0 ? <p className={styles.kosong}>Belum ada undangan pada periode ini.</p> : (
                <table className={styles.tabel}>
                  <thead><tr><th>Unit</th><th className={styles.angka}>Diundang</th><th className={styles.angka}>Mengisi</th><th className={styles.angka}>Persen</th><th>Grafik</th></tr></thead>
                  <tbody>
                    {rr.map((r) => (
                      <tr key={`${r.unit}-${r.layanan_id ?? r.nama}`}>
                        <td>{r.nama}</td><td className={styles.angka}>{r.diundang}</td><td className={styles.angka}>{r.mengisi}</td>
                        <td className={styles.angka}>{fmtPersen(persen(r.mengisi, r.diundang))}</td><td><Batang nilai={persen(r.mengisi, r.diundang)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className={styles.bagian} aria-label="Pengaduan">
              <h2>5. Pengaduan</h2>
              {totalPengaduan === 0 ? <p className={styles.kosong}>Tidak ada pengaduan pada periode ini.</p> : (
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
              {saranRingkas.length > 0 && (
                <table className={styles.tabel}>
                  <thead><tr><th>Unit</th><th className={styles.angka}>Jumlah saran</th></tr></thead>
                  <tbody>{saranRingkas.map((r) => <tr key={`${r.unit}-${r.layanan_id ?? r.nama}`}><td>{r.nama}</td><td className={styles.angka}>{r.jumlah}</td></tr>)}</tbody>
                </table>
              )}
              {saranIsi.length === 0 ? <p className={styles.kosong}>Tidak ada saran pada periode ini.</p> : (
                <ol className={styles.daftarSaran}>
                  {saranIsi.map((s) => {
                    const lay = Array.isArray(s.layanan) ? s.layanan[0]?.nama : s.layanan?.nama;
                    return (
                      <li key={s.id}>
                        {s.isi}
                        <div className={styles.meta}>
                          {new Date(s.created_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' })} · {s.unit === 'fo' ? 'Front Office' : lay ?? 'Unit tidak diketahui'} · {s.pelapor_nama ?? 'Anonim'}
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
            <p className={styles.catatan}>Dicetak dari Lampung Maju Hub pada {dicetakPada} WIB.</p>
          </article>
        )}
      </div>
    </>
  );
}
