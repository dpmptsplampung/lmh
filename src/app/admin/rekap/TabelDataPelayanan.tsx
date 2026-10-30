'use client';

// Tabel Data Pelayanan (Rekap terpadu). Dua tampilan: "Ringkas" (kolom inti, sel dua baris) dan "Semua kolom"
// (seluruh kolom Excel, tiap sel satu baris dengan title). Teks bebas tidak pernah membuat baris tinggi; isian lengkap
// satu pelayanan dibuka lewat baris detail (klik baris atau tombol Detail). Excel tidak terpengaruh: kolom tetap
// berasal dari kolomDataPelayanan().
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit } from '@/lib/rekap/format';
import { labelHasil, namaUnit, type BarisPelayanan, type KolomData, type NilaiSel } from '@/lib/rekap/terpadu';
import styles from './rekap.module.css';

export type TampilanKolom = 'ringkas' | 'semua';

interface Props {
  rows: BarisPelayanan[];
  /** Seluruh kolom (Umum + formulir + Khusus), sama dengan Excel. */
  kolom: KolomData[];
  tampilan: TampilanKolom;
  /** Pesan satu kalimat bila tidak ada baris (memuat / kosong). */
  keadaan: string | null;
}

const TIDAK_ADA = '—';
const teksSel = (v: NilaiSel): string => (v == null || v === '' ? TIDAK_ADA : String(v));

const KOLOM_RINGKAS = ['Tanggal', 'Pengunjung', 'Unit / Layanan', 'Topik', 'Hasil', 'Petugas'] as const;

/** Waktu satu baris: "09:10–09:25 · 15 mnt"; bagian yang kosong dibuang. */
function ringkasWaktu(r: BarisPelayanan): string {
  const mulai = formatWaktuId(r.mulai_at);
  const selesai = formatWaktuId(r.selesai_at);
  const durasi = hitungDurasiMenit(r.mulai_at, r.selesai_at);
  const rentang = mulai && selesai ? `${mulai}–${selesai}` : mulai || selesai;
  return [rentang, durasi != null ? `${durasi} mnt` : ''].filter(Boolean).join(' · ');
}

const kontak = (r: BarisPelayanan): string => [r.pengunjung_hp, r.pengunjung_email].filter(Boolean).join(' · ');

export default function TabelDataPelayanan({ rows, kolom, tampilan, keadaan }: Props) {
  const [terbuka, setTerbuka] = useState<Set<string>>(new Set());
  const ringkas = tampilan === 'ringkas';
  const jumlahKolom = (ringkas ? KOLOM_RINGKAS.length : kolom.length) + 1;

  const alihkan = (id: string) =>
    setTerbuka((s) => {
      const baru = new Set(s);
      if (baru.has(id)) baru.delete(id);
      else baru.add(id);
      return baru;
    });

  return (
    <table className={`table ${styles.tabelData}`}>
      <caption className="sr-only">Data pelayanan, satu baris per pelayanan</caption>
      <thead>
        <tr>
          {ringkas
            ? KOLOM_RINGKAS.map((j, i) => <th key={j} scope="col" className={i === 0 ? styles.kolPertama : undefined}>{j}</th>)
            : kolom.map((k, i) => (
                <th key={k.kunci} scope="col" className={[i === 0 ? styles.kolPertama : '', k.kunci === 'durasi' ? 'kol-angka' : ''].filter(Boolean).join(' ') || undefined}>
                  {k.judul}
                </th>
              ))}
          <th scope="col" className="kol-aksi"><span className="sr-only">Aksi</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={jumlahKolom} className="kosong-sel">{keadaan ?? 'Belum ada pelayanan dilayani pada rentang ini.'}</td></tr>
        )}
        {rows.map((r) => {
          const buka = terbuka.has(r.pelayanan_id);
          const idDetail = `detail-${r.pelayanan_id}`;
          return (
            <Fragment key={r.pelayanan_id}>
              <tr className={styles.barisData} onClick={() => alihkan(r.pelayanan_id)} data-terbuka={buka || undefined}>
                {ringkas ? (
                  <>
                    <td className={`kol-utama kol-waktu ${styles.kolPertama}`}>
                      {r.tanggal ? formatTanggalId(r.tanggal) : TIDAK_ADA}
                      {ringkasWaktu(r) && <span className="sub">{ringkasWaktu(r)}</span>}
                    </td>
                    <td className={`kol-utama ${styles.kolPengunjung}`}>
                      {r.pengunjung_nama ?? TIDAK_ADA}
                      {kontak(r) && <span className="sub" title={kontak(r)}>{kontak(r)}</span>}
                    </td>
                    <td className="kol-teks" title={namaUnit(r)}>{namaUnit(r)}</td>
                    <td className="kol-teks" title={r.topik ?? '(tidak tercatat)'}>{r.topik ?? '(tidak tercatat)'}</td>
                    <td>{r.hasil ? <span className={`badge ${r.hasil === 'selesai' ? 'badge--selesai' : ''}`} title={labelHasil(r.hasil)}>{labelHasil(r.hasil)}</span> : TIDAK_ADA}</td>
                    <td className="kol-teks" title={r.penangan_nama ?? ''}>{r.penangan_nama ?? TIDAK_ADA}</td>
                  </>
                ) : (
                  kolom.map((k, i) => {
                    const teks = teksSel(k.ambil(r));
                    const kelas = [
                      i === 0 ? styles.kolPertama : '',
                      k.kunci === 'durasi' ? 'kol-angka' : ['tanggal', 'mulai', 'selesai', 'nomor_tiket'].includes(k.kunci) ? 'kol-waktu' : 'kol-teks',
                    ].filter(Boolean).join(' ');
                    return <td key={k.kunci} className={kelas} title={teks}>{teks}</td>;
                  })
                )}
                <td className="kol-aksi">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    aria-label={`Detail pelayanan ${r.pengunjung_nama ?? ''}`.trim()}
                    aria-expanded={buka}
                    aria-controls={idDetail}
                    onClick={(e) => {
                      e.stopPropagation();
                      alihkan(r.pelayanan_id);
                    }}
                  >
                    {buka ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                    Detail
                  </button>
                </td>
              </tr>
              {buka && (
                <tr id={idDetail} className={styles.barisDetail}>
                  <td colSpan={jumlahKolom}>
                    <dl className={styles.detail}>
                      {kolom.map((k) => (
                        <div key={k.kunci} className={styles.detailItem}>
                          <dt>{k.judul}</dt>
                          <dd>{teksSel(k.ambil(r))}</dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
