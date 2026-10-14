'use client';

// Performa pelayanan (Tahap D, K9; hanya Admin): pengunjung dilayani, durasi per tahap, waktu tunggu layanan,
// tingkat eskalasi FO -> layanan dan tingkat pengembalian, per orang / per layanan / per hari (WIB).
// Agregasi dihitung server (api/admin/rekap/performa, src/lib/rekap/performa.ts); halaman ini hanya menampilkan.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useToast } from '@/components/Toast';
import { addDaysWIB, todayWIB } from '@/lib/time';
import { formatMenit, formatPersen, formatTanggalId } from '@/lib/rekap/format';
import type { HasilPerforma } from '@/lib/rekap/performa';
import styles from './performa.module.css';

type Respons = HasilPerforma & { dari: string; sampai: string; truncated: boolean };

function Kartu({ nilai, label }: { nilai: string | number; label: string }) {
  return (
    <div className="stat-card">
      <span className="stat-card__value">{nilai}</span>
      <span className="stat-card__label">{label}</span>
    </div>
  );
}

function Tabel({ judul, children }: { judul: string; children: React.ReactNode }) {
  return (
    <section className={styles.bagian}>
      <h2 className={styles.judul}>{judul}</h2>
      <div className="table-wrapper">{children}</div>
    </section>
  );
}

export default function PerformaPage() {
  const { toast } = useToast();
  const [dari, setDari] = useState(() => addDaysWIB(-29));
  const [sampai, setSampai] = useState(() => todayWIB());
  const [data, setData] = useState<Respons | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const muat = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rekap/performa?${new URLSearchParams({ dari, sampai })}`);
      const body = await res.json().catch(() => ({}));
      if (seq !== seqRef.current) return;
      if (!res.ok) {
        const pesan = res.status === 403 ? 'Hanya Admin yang dapat melihat performa' : (body.error ?? 'Gagal memuat performa');
        setError(pesan);
        setData(null);
        toast(pesan, 'error');
        return;
      }
      setData(body as Respons);
    } catch {
      if (seq !== seqRef.current) return;
      setError('Tidak ada koneksi');
      toast('Tidak ada koneksi', 'error');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [dari, sampai, toast]);

  useEffect(() => {
    const t = setTimeout(() => void muat(), 0);
    return () => clearTimeout(t);
  }, [muat]);

  const maksHari = data ? Math.max(1, ...data.per_hari.map((h) => h.pengunjung)) : 1;
  const r = data?.ringkasan;

  return (
    <>
      <PageHeader
        title="Performa Pelayanan"
        description="Jumlah dilayani, durasi, waktu tunggu, dan tingkat eskalasi/pengembalian"
      >
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void muat()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        <div className={styles.filter}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="performa-dari">Dari tanggal</label>
            <input id="performa-dari" type="date" className="form-input" value={dari} onChange={(e) => setDari(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="performa-sampai">Sampai tanggal</label>
            <input id="performa-sampai" type="date" className="form-input" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
        </div>

        <p className={styles.catatan} role="note">
          Keterangan: waktu tunggu pengunjung sebelum disapa Front Office tidak terukur (belum ada tiket pada tahap itu).
          Waktu tunggu yang ditampilkan adalah waktu tunggu di layanan (dari dieskalasi sampai petugas mulai melayani).
          Hari dihitung menurut WIB dari waktu mulai tahap. Tingkat ditampilkan &quot;—&quot; bila belum ada data pembanding.
        </p>

        {error && (
          <div role="alert" style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-danger-700)' }}>
            <AlertCircle size={32} style={{ margin: '0 auto var(--space-3)' }} />
            <p>{error}</p>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void muat()}>Coba Lagi</button>
          </div>
        )}

        {data?.truncated && (
          <p className={styles.catatan}>Data melebihi 50.000 baris dan dipotong. Persempit rentang tanggal.</p>
        )}

        {loading && !data && !error && <div className="skeleton" style={{ height: 120, width: '100%' }} />}

        {data && r && !error && (
          <>
            <div className={styles.kartu}>
              <Kartu nilai={r.pengunjung_dilayani} label="Pengunjung dilayani" />
              <Kartu nilai={r.fo.tahap_selesai} label="Tahap Front Office selesai" />
              <Kartu nilai={formatPersen(r.fo.tingkat_eskalasi)} label="Tingkat eskalasi FO ke layanan" />
              <Kartu nilai={formatMenit(r.fo.rata_durasi_menit)} label="Rata durasi tahap FO" />
              <Kartu nilai={r.layanan.tahap_selesai} label="Tahap layanan selesai" />
              <Kartu nilai={formatPersen(r.layanan.tingkat_pengembalian)} label="Tingkat dikembalikan ke FO" />
              <Kartu nilai={formatMenit(r.layanan.rata_durasi_menit)} label="Rata durasi tahap layanan" />
              <Kartu nilai={formatMenit(r.layanan.rata_tunggu_menit)} label="Rata waktu tunggu layanan" />
            </div>

            <Tabel judul="Per orang">
              <table className="table" aria-label="Performa per orang">
                <thead>
                  <tr>
                    <th>Nama</th><th>Peran</th><th>Tahap selesai</th><th>Pengunjung</th>
                    <th>Rata durasi</th><th>Rata tunggu</th><th>Eskalasi</th><th>Dikembalikan</th>
                  </tr>
                </thead>
                <tbody>
                  {data.per_orang.length === 0 ? (
                    <tr><td colSpan={8} style={{ color: 'var(--text-tertiary)' }}>Belum ada data pada rentang ini.</td></tr>
                  ) : data.per_orang.map((o) => (
                    <tr key={`${o.penangan_id}-${o.peran}`}>
                      <td style={{ fontWeight: 600 }}>{o.nama}</td>
                      <td>{o.peran === 'fo' ? 'Front Office' : 'Petugas layanan'}</td>
                      <td className={styles.angka}>{o.tahap_selesai}</td>
                      <td className={styles.angka}>{o.pengunjung}</td>
                      <td>{formatMenit(o.rata_durasi_menit)}</td>
                      <td>{o.peran === 'layanan' ? formatMenit(o.rata_tunggu_menit) : '—'}</td>
                      <td>{o.peran === 'fo' ? formatPersen(o.tingkat_eskalasi) : '—'}</td>
                      <td>{o.peran === 'layanan' ? formatPersen(o.tingkat_pengembalian) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Tabel>

            <Tabel judul="Per layanan">
              <table className="table" aria-label="Performa per layanan">
                <thead>
                  <tr>
                    <th>Layanan</th><th>Tahap selesai</th><th>Pengunjung</th><th>Rata durasi</th>
                    <th>Rata tunggu</th><th>Dikembalikan</th>
                  </tr>
                </thead>
                <tbody>
                  {data.per_layanan.length === 0 ? (
                    <tr><td colSpan={6} style={{ color: 'var(--text-tertiary)' }}>Belum ada data pada rentang ini.</td></tr>
                  ) : data.per_layanan.map((l) => (
                    <tr key={l.layanan_id}>
                      <td style={{ fontWeight: 600 }}>{l.nama}</td>
                      <td className={styles.angka}>{l.tahap_selesai}</td>
                      <td className={styles.angka}>{l.pengunjung}</td>
                      <td>{formatMenit(l.rata_durasi_menit)}</td>
                      <td>{formatMenit(l.rata_tunggu_menit)}</td>
                      <td>{formatPersen(l.tingkat_pengembalian)} ({l.dikembalikan})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Tabel>

            <Tabel judul="Per hari">
              <table className="table" aria-label="Performa per hari">
                <thead>
                  <tr>
                    <th>Tanggal</th><th>Pengunjung dilayani</th><th>Tahap FO</th><th>Eskalasi</th>
                    <th>Tahap layanan</th><th>Dikembalikan</th><th>Rata durasi FO</th><th>Rata durasi layanan</th>
                  </tr>
                </thead>
                <tbody>
                  {data.per_hari.length === 0 ? (
                    <tr><td colSpan={8} style={{ color: 'var(--text-tertiary)' }}>Belum ada data pada rentang ini.</td></tr>
                  ) : data.per_hari.map((h) => (
                    <tr key={h.tanggal}>
                      <td className={styles.angka}>{formatTanggalId(h.tanggal)}</td>
                      <td>
                        <div className={styles.angka}>{h.pengunjung}</div>
                        <div className={styles.batangLatar} aria-hidden="true">
                          <div className={styles.batang} style={{ width: `${(h.pengunjung / maksHari) * 100}%` }} />
                        </div>
                      </td>
                      <td className={styles.angka}>{h.fo.tahap_selesai}</td>
                      <td>{formatPersen(h.fo.tingkat_eskalasi)}</td>
                      <td className={styles.angka}>{h.layanan.tahap_selesai}</td>
                      <td>{formatPersen(h.layanan.tingkat_pengembalian)}</td>
                      <td>{formatMenit(h.fo.rata_durasi_menit)}</td>
                      <td>{formatMenit(h.layanan.rata_durasi_menit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Tabel>
          </>
        )}
      </div>
    </>
  );
}
