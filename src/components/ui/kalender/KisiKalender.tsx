'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import styles from './KisiKalender.module.css';
import {
  NAMA_HARI_PANJANG,
  NAMA_HARI_PENDEK,
  akhirBulan,
  akhirPekan,
  apitkan,
  awalBulan,
  awalPekan,
  diLuarBatas,
  formatBulanTahun,
  formatPanjang,
  susunBulan,
  tambahBulan,
  tambahHari,
  tambahTahun,
  tanggalValid,
  uraiTanggal,
} from './tanggal';

export interface RentangPilihan {
  dari: string | null;
  sampai: string | null;
}

export interface KisiKalenderProps {
  /** Tanggal yang memegang fokus papan ketik (tabindex 0). Bulan yang tampil = bulan tanggal ini. Wajib valid. */
  fokus: string;
  /** Fokus berpindah (panah, PageUp/Down, tombol bulan). Belum memilih apa pun. */
  onFokus: (iso: string) => void;
  /** Tanggal dipilih (klik, Enter, atau Spasi). */
  onPilih: (iso: string) => void;
  /** Mode satu tanggal. */
  terpilih?: string | null;
  /** Mode rentang. `sampai` null = menunggu klik kedua; pratinjau mengikuti `sorot` atau fokus. */
  rentang?: RentangPilihan | null;
  /** Tanggal yang sedang disorot kursor, untuk pratinjau rentang. */
  sorot?: string | null;
  onSorot?: (iso: string | null) => void;
  min?: string;
  max?: string;
  /** "Hari ini" WIB, dari todayWIB(). */
  hariIni: string;
}

// Kisi bulan berpola ARIA grid. Satu bulan; hari di luar bulan dikosongkan. Fokus berpindah dengan tabindex bergulir:
// hanya satu hari yang bisa dijangkau Tab, sisanya lewat panah.
export default function KisiKalender({
  fokus: fokusMasuk,
  onFokus,
  onPilih,
  terpilih = null,
  rentang = null,
  sorot = null,
  onSorot,
  min,
  max,
  hariIni,
}: KisiKalenderProps) {
  const idJudul = useId();
  const kisi = useRef<HTMLTableElement>(null);
  const perluFokusDom = useRef(false);

  // Fokus yang rusak tidak boleh menjatuhkan halaman: pakai hari ini, lalu 1 Januari 1970.
  const fokus = tanggalValid(fokusMasuk) ? fokusMasuk : tanggalValid(hariIni) ? hariIni : '1970-01-01';
  const uraian = uraiTanggal(fokus) ?? { tahun: 1970, bulan: 1, hari: 1 };
  const pekan = useMemo(() => susunBulan(uraian.tahun, uraian.bulan), [uraian.tahun, uraian.bulan]);

  // Pindahkan fokus DOM hanya setelah gerak papan ketik, bukan setelah klik tombol bulan atau render awal.
  useEffect(() => {
    if (!perluFokusDom.current) return;
    perluFokusDom.current = false;
    kisi.current?.querySelector<HTMLElement>(`button[data-tanggal="${fokus}"]`)?.focus();
  }, [fokus]);

  const bolehMundur = !(min && akhirBulan(tambahBulan(fokus, -1)) < min);
  const bolehMaju = !(max && awalBulan(tambahBulan(fokus, 1)) > max);

  const pindahBulan = (arah: 1 | -1) => {
    if (arah === -1 && !bolehMundur) return;
    if (arah === 1 && !bolehMaju) return;
    onFokus(apitkan(tambahBulan(fokus, arah), min, max));
  };

  const gerak = (target: string) => {
    perluFokusDom.current = true;
    onFokus(apitkan(target, min, max));
  };

  const tombolHari = (e: KeyboardEvent<HTMLButtonElement>, iso: string) => {
    let target: string | null = null;
    switch (e.key) {
      case 'ArrowLeft':
        target = tambahHari(iso, -1);
        break;
      case 'ArrowRight':
        target = tambahHari(iso, 1);
        break;
      case 'ArrowUp':
        target = tambahHari(iso, -7);
        break;
      case 'ArrowDown':
        target = tambahHari(iso, 7);
        break;
      case 'Home':
        target = awalPekan(iso);
        break;
      case 'End':
        target = akhirPekan(iso);
        break;
      case 'PageUp':
        target = e.shiftKey ? tambahTahun(iso, -1) : tambahBulan(iso, -1);
        break;
      case 'PageDown':
        target = e.shiftKey ? tambahTahun(iso, 1) : tambahBulan(iso, 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!diLuarBatas(iso, min, max)) onPilih(iso);
        return;
      default:
        return;
    }
    e.preventDefault();
    gerak(target);
  };

  // Rentang yang digambar: terikat (dua ujung) atau pratinjau (satu ujung + sorot/fokus).
  const akhirRentang = rentang?.dari ? (rentang.sampai ?? sorot ?? fokus) : null;
  const terikat = Boolean(rentang?.dari && rentang.sampai);
  const [lo, hi] =
    rentang?.dari && akhirRentang
      ? rentang.dari <= akhirRentang
        ? [rentang.dari, akhirRentang]
        : [akhirRentang, rentang.dari]
      : [null, null];

  return (
    <div className={styles.kalender}>
      <div className={styles.kepala}>
        <button
          type="button"
          className={styles.navigasi}
          aria-label="Bulan sebelumnya"
          aria-disabled={!bolehMundur || undefined}
          onClick={() => pindahBulan(-1)}
        >
          <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <div id={idJudul} className={styles.judul} aria-live="polite" aria-atomic="true">
          {formatBulanTahun(fokus)}
        </div>
        <button
          type="button"
          className={styles.navigasi}
          aria-label="Bulan berikutnya"
          aria-disabled={!bolehMaju || undefined}
          onClick={() => pindahBulan(1)}
        >
          <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <table ref={kisi} role="grid" aria-labelledby={idJudul} className={styles.kisi} onMouseLeave={() => onSorot?.(null)}>
        <thead>
          <tr>
            {NAMA_HARI_PENDEK.map((h, i) => (
              <th key={h} scope="col" abbr={NAMA_HARI_PANJANG[i]} className={styles.namaHari}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pekan.map((baris, bi) => (
            <tr key={bi}>
              {baris.map((iso, ci) => {
                if (!iso) return <td key={ci} className={styles.kosong} aria-hidden="true" />;
                const nonaktif = diLuarBatas(iso, min, max);
                const adalahAwal = lo !== null && iso === lo;
                const adalahAkhir = hi !== null && iso === hi;
                const dalam = lo !== null && hi !== null && iso > lo && iso < hi;
                const dipilih = terpilih === iso || (terikat ? adalahAwal || adalahAkhir || dalam : rentang?.dari === iso);
                // Hanya ujung yang sudah pasti diisi penuh; hari pratinjau cukup berlatar pita.
                const terisi = terpilih === iso || (terikat ? adalahAwal || adalahAkhir : rentang?.dari === iso);
                const hariIniSel = iso === hariIni;
                const keterangan: string[] = [];
                if (hariIniSel) keterangan.push('hari ini');
                if (rentang?.dari === iso && !terikat) keterangan.push('awal rentang');
                if (terikat && adalahAwal && adalahAkhir) keterangan.push('awal dan akhir rentang');
                else if (terikat && adalahAwal) keterangan.push('awal rentang');
                else if (terikat && adalahAkhir) keterangan.push('akhir rentang');
                if (nonaktif) keterangan.push('tidak tersedia');
                const label = [formatPanjang(iso), ...keterangan].join(', ');
                const hari = uraiTanggal(iso)?.hari;
                return (
                  <td
                    key={ci}
                    role="gridcell"
                    aria-selected={nonaktif ? undefined : dipilih}
                    aria-disabled={nonaktif || undefined}
                    className={cn(
                      styles.sel,
                      lo !== null && hi !== null && lo !== hi && adalahAwal && styles.selAwal,
                      lo !== null && hi !== null && lo !== hi && adalahAkhir && styles.selAkhir,
                      dalam && styles.selDalam,
                    )}
                  >
                    <button
                      type="button"
                      className={cn(
                        styles.hari,
                        terisi && styles.terpilih,
                        hariIniSel && styles.hariIni,
                        nonaktif && styles.nonaktif,
                      )}
                      data-tanggal={iso}
                      tabIndex={iso === fokus ? 0 : -1}
                      aria-label={label}
                      aria-current={hariIniSel ? 'date' : undefined}
                      aria-disabled={nonaktif || undefined}
                      onClick={() => {
                        if (!nonaktif) onPilih(iso);
                      }}
                      onKeyDown={(e) => tombolHari(e, iso)}
                      onKeyUp={(e) => {
                        // Cegah klik ganda: Enter dan Spasi sudah ditangani saat keydown.
                        if (e.key === ' ') e.preventDefault();
                      }}
                      onMouseEnter={() => onSorot?.(iso)}
                    >
                      <span aria-hidden="true">{hari}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
