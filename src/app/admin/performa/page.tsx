'use client';

// Performa pelayanan (Tahap D, K9; hanya Admin): pengunjung dilayani, durasi per tahap, waktu tunggu layanan,
// tingkat eskalasi FO -> layanan dan tingkat pengembalian, per orang / per layanan / per hari (WIB).
// Agregasi dihitung server (api/admin/rekap/performa, src/lib/rekap/performa.ts); halaman ini hanya menampilkan.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, CornerUpLeft, RefreshCw, Send, Timer, UserCheck, UserRoundCheck, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Tombol from '@/components/ui/Tombol';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import Field from '@/components/ui/Field';
import Galat from '@/components/ui/Galat';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Skeleton from '@/components/ui/Skeleton';
import PemilihRentang from '@/components/ui/PemilihRentang';
import { useToast } from '@/components/Toast';
import { addDaysWIB, todayWIB } from '@/lib/time';
import { formatMenit, formatPersen, formatTanggalId } from '@/lib/rekap/format';
import type { HasilPerforma } from '@/lib/rekap/performa';
import styles from './performa.module.css';

type Respons = HasilPerforma & { dari: string; sampai: string; truncated: boolean };
type BarisOrang = Respons['per_orang'][number];
type BarisLayanan = Respons['per_layanan'][number];
type BarisHari = Respons['per_hari'][number];

const KOLOM_ORANG: KolomTabel<BarisOrang>[] = [
  { kunci: 'nama', judul: 'Nama', judulBaris: true, peran: 'utama' },
  { kunci: 'peran', judul: 'Peran', render: (o) => (o.peran === 'fo' ? 'Front Office' : 'Petugas layanan') },
  { kunci: 'tahap_selesai', judul: 'Tahap selesai', angka: true },
  { kunci: 'pengunjung', judul: 'Pengunjung', angka: true },
  { kunci: 'rata_durasi_menit', judul: 'Rata durasi', angka: true, render: (o) => formatMenit(o.rata_durasi_menit) },
  { kunci: 'rata_tunggu_menit', judul: 'Rata tunggu', angka: true, render: (o) => (o.peran === 'layanan' ? formatMenit(o.rata_tunggu_menit) : '—') },
  { kunci: 'tingkat_eskalasi', judul: 'Eskalasi', angka: true, render: (o) => (o.peran === 'fo' ? formatPersen(o.tingkat_eskalasi) : '—') },
  { kunci: 'tingkat_pengembalian', judul: 'Dikembalikan', angka: true, render: (o) => (o.peran === 'layanan' ? formatPersen(o.tingkat_pengembalian) : '—') },
];

const KOLOM_LAYANAN: KolomTabel<BarisLayanan>[] = [
  { kunci: 'nama', judul: 'Layanan', judulBaris: true, peran: 'utama' },
  { kunci: 'tahap_selesai', judul: 'Tahap selesai', angka: true },
  { kunci: 'pengunjung', judul: 'Pengunjung', angka: true },
  { kunci: 'rata_durasi_menit', judul: 'Rata durasi', angka: true, render: (l) => formatMenit(l.rata_durasi_menit) },
  { kunci: 'rata_tunggu_menit', judul: 'Rata tunggu', angka: true, render: (l) => formatMenit(l.rata_tunggu_menit) },
  { kunci: 'tingkat_pengembalian', judul: 'Dikembalikan', angka: true, render: (l) => `${formatPersen(l.tingkat_pengembalian)} (${l.dikembalikan})` },
];

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
  const kolomHari: KolomTabel<BarisHari>[] = [
    { kunci: 'tanggal', judul: 'Tanggal', judulBaris: true, peran: 'utama', render: (h) => formatTanggalId(h.tanggal) },
    {
      kunci: 'pengunjung',
      judul: 'Pengunjung dilayani',
      render: (h) => (
        <div className={styles.sel}>
          <span className={styles.angka}>{h.pengunjung}</span>
          <div className={styles.batangLatar} aria-hidden="true">
            <div className={styles.batang} style={{ width: `${(h.pengunjung / maksHari) * 100}%` }} />
          </div>
        </div>
      ),
    },
    { kunci: 'tahap_fo', judul: 'Tahap FO', angka: true, render: (h) => h.fo.tahap_selesai },
    { kunci: 'eskalasi', judul: 'Eskalasi', angka: true, render: (h) => formatPersen(h.fo.tingkat_eskalasi) },
    { kunci: 'tahap_layanan', judul: 'Tahap layanan', angka: true, render: (h) => h.layanan.tahap_selesai },
    { kunci: 'dikembalikan', judul: 'Dikembalikan', angka: true, render: (h) => formatPersen(h.layanan.tingkat_pengembalian) },
    { kunci: 'durasi_fo', judul: 'Rata durasi FO', angka: true, render: (h) => formatMenit(h.fo.rata_durasi_menit) },
    { kunci: 'durasi_layanan', judul: 'Rata durasi layanan', angka: true, render: (h) => formatMenit(h.layanan.rata_durasi_menit) },
  ];
  const kosong = <CatatanKeadaan jenis="kosong">Belum ada data pada rentang ini.</CatatanKeadaan>;
  const memuatAwal = loading && !data && !error;

  return (
    <>
      <PageHeader
        title="Performa Pelayanan"
        description="Jumlah dilayani, durasi, waktu tunggu, dan tingkat eskalasi/pengembalian"
      >
        <Tombol varian="hantu" ukuran="kecil" ikon={RefreshCw} onClick={() => void muat()} memuat={loading}>
          Refresh
        </Tombol>
      </PageHeader>

      <div className={styles.wadah}>
        <Kartu>
          <div className={styles.filter}>
            <Field label="Rentang tanggal">
              {(f) => (
                <PemilihRentang
                  id={f.id}
                  label="Rentang tanggal"
                  dari={dari}
                  sampai={sampai}
                  onUbah={(rentang) => {
                    setDari(rentang.dari);
                    setSampai(rentang.sampai);
                  }}
                />
              )}
            </Field>
          </div>
        </Kartu>

        <CatatanKeadaan jenis="info">
          Keterangan: waktu tunggu pengunjung sebelum disapa Front Office tidak terukur (belum ada tiket pada tahap itu).
          Waktu tunggu yang ditampilkan adalah waktu tunggu di layanan (dari dieskalasi sampai petugas mulai melayani).
          Hari dihitung menurut WIB dari waktu mulai tahap. Tingkat ditampilkan &quot;—&quot; bila belum ada data pembanding.
        </CatatanKeadaan>

        {error && <Galat pesan={error} onRetry={() => void muat()} memuat={loading} />}

        {data?.truncated && (
          <CatatanKeadaan jenis="info">Data melebihi 50.000 baris dan dipotong. Persempit rentang tanggal.</CatatanKeadaan>
        )}

        {memuatAwal && <Skeleton bentuk="kartu" jumlah={4} label="Memuat ringkasan performa" />}

        {data && r && !error && (
          <>
            <section className={styles.kartu} aria-label="Ringkasan performa">
              <KartuStatistik label="Pengunjung dilayani" ikon={Users} nilai={r.pengunjung_dilayani} />
              <KartuStatistik label="Tahap Front Office selesai" ikon={UserCheck} nilai={r.fo.tahap_selesai} />
              <KartuStatistik label="Tingkat eskalasi FO ke layanan" ikon={Send} nilai={formatPersen(r.fo.tingkat_eskalasi)} />
              <KartuStatistik label="Rata durasi tahap FO" ikon={Timer} nilai={formatMenit(r.fo.rata_durasi_menit)} />
              <KartuStatistik label="Tahap layanan selesai" ikon={UserRoundCheck} nilai={r.layanan.tahap_selesai} />
              <KartuStatistik label="Tingkat dikembalikan ke FO" ikon={CornerUpLeft} nilai={formatPersen(r.layanan.tingkat_pengembalian)} />
              <KartuStatistik label="Rata durasi tahap layanan" ikon={Timer} nilai={formatMenit(r.layanan.rata_durasi_menit)} />
              <KartuStatistik label="Rata waktu tunggu layanan" ikon={Clock} nilai={formatMenit(r.layanan.rata_tunggu_menit)} />
            </section>

            <Kartu judul="Per orang" padding="tanpa">
              <Tabel caption="Performa per orang" kolom={KOLOM_ORANG} baris={data.per_orang}
                kunciBaris={(o) => `${o.penangan_id}-${o.peran}`} kartuDiHp kosong={kosong} />
            </Kartu>

            <Kartu judul="Per layanan" padding="tanpa">
              <Tabel caption="Performa per layanan" kolom={KOLOM_LAYANAN} baris={data.per_layanan}
                kunciBaris="layanan_id" kartuDiHp kosong={kosong} />
            </Kartu>

            <Kartu judul="Per hari" padding="tanpa">
              <Tabel caption="Performa per hari" kolom={kolomHari} baris={data.per_hari}
                kunciBaris="tanggal" kartuDiHp kosong={kosong} />
            </Kartu>
          </>
        )}
      </div>
    </>
  );
}
