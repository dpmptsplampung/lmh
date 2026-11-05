'use client';

import { useState } from 'react';
import { todayWIB } from '@/lib/time';
import KisiKalender from './kalender/KisiKalender';
import PopoverKalender, { useTutupPopover } from './kalender/PopoverKalender';
import {
  PILIHAN_CEPAT_BAWAAN,
  apitkan,
  apitkanRentang,
  formatRentangPanjang,
  formatRentangPendek,
  selisihHari,
  tanggalValid,
  urutkanRentang,
  type PilihanCepat,
  type RentangTanggal,
} from './kalender/tanggal';
import Tombol from './Tombol';
import styles from './PemilihRentang.module.css';

export type { PilihanCepat, RentangTanggal } from './kalender/tanggal';

export interface PemilihRentangProps {
  /** Awal rentang "YYYY-MM-DD" (kalender WIB), termasuk. */
  dari: string;
  /** Akhir rentang "YYYY-MM-DD", termasuk. */
  sampai: string;
  /** Dipanggil setelah Terapkan atau pilihan cepat. Selalu dari <= sampai. */
  onUbah: (rentang: RentangTanggal) => void;
  /** Nama bidang untuk pembaca layar, mis. "Rentang tanggal". */
  label: string;
  min?: string;
  max?: string;
  /** Bawaan: Hari ini, 7 hari terakhir, 30 hari terakhir, Bulan ini, Bulan lalu. Beri `[]` untuk menyembunyikan. */
  pilihanCepat?: PilihanCepat[];
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-describedby'?: string;
}

// Pemilih rentang tanggal buatan sendiri: chip "6 Okt sampai 4 Nov 2026" membuka kalender. Klik pertama = awal, klik kedua =
// akhir (otomatis ditukar bila terbalik). Nilai baru dikirim hanya lewat Terapkan atau pilihan cepat.
export default function PemilihRentang({
  dari,
  sampai,
  onUbah,
  label,
  min,
  max,
  pilihanCepat = PILIHAN_CEPAT_BAWAAN,
  disabled,
  id,
  className,
  ...aria
}: PemilihRentangProps) {
  const valid = tanggalValid(dari) && tanggalValid(sampai);
  const rentang = valid ? urutkanRentang(dari, sampai) : null;
  const teks = rentang ? formatRentangPendek(rentang.dari, rentang.sampai) : 'Pilih rentang tanggal';
  const labelTombol = `${label}: ${rentang ? formatRentangPanjang(rentang.dari, rentang.sampai) : 'belum dipilih'}`;

  return (
    <PopoverKalender
      id={id}
      className={className}
      disabled={disabled}
      teks={teks}
      labelTombol={labelTombol}
      labelDialog={label}
      {...aria}
    >
      <IsiRentang saatIni={rentang} min={min} max={max} pilihanCepat={pilihanCepat} onUbah={onUbah} />
    </PopoverKalender>
  );
}

interface IsiRentangProps {
  saatIni: RentangTanggal | null;
  min?: string;
  max?: string;
  pilihanCepat: PilihanCepat[];
  onUbah: (r: RentangTanggal) => void;
}

interface Rancangan {
  dari: string | null;
  sampai: string | null;
}

function IsiRentang({ saatIni, min, max, pilihanCepat, onUbah }: IsiRentangProps) {
  const tutup = useTutupPopover();
  const hariIni = todayWIB();
  const onTerapkan = (r: RentangTanggal) => {
    if (!saatIni || r.dari !== saatIni.dari || r.sampai !== saatIni.sampai) onUbah(r);
    tutup(true);
  };
  const onBatal = () => tutup(true);
  // Rancangan hidup di sini, bukan di induk: nilai induk tidak berubah sebelum Terapkan.
  const [rancangan, setRancangan] = useState<Rancangan>({ dari: saatIni?.dari ?? null, sampai: saatIni?.sampai ?? null });
  const [fokus, setFokus] = useState(() => apitkan(saatIni?.sampai ?? hariIni, min, max));
  const [sorot, setSorot] = useState<string | null>(null);

  const lengkap = rancangan.dari !== null && rancangan.sampai !== null;

  const pilih = (iso: string) => {
    setFokus(iso);
    if (rancangan.dari && !rancangan.sampai) {
      const r = urutkanRentang(rancangan.dari, iso);
      setRancangan(r);
    } else {
      setRancangan({ dari: iso, sampai: null });
    }
    setSorot(null);
  };

  let ringkasan = 'Pilih tanggal awal';
  if (rancangan.dari && !rancangan.sampai) ringkasan = 'Pilih tanggal akhir';
  if (rancangan.dari && rancangan.sampai) {
    const hari = selisihHari(rancangan.dari, rancangan.sampai) + 1;
    ringkasan = `${formatRentangPanjang(rancangan.dari, rancangan.sampai)} (${hari} hari)`;
  }

  return (
    <div className={styles.isi}>
      {pilihanCepat.length > 0 && (
        <div role="group" aria-label="Pilihan cepat" className={styles.cepat}>
          {pilihanCepat.map((p) => {
            const r = apitkanRentang(p.hitung(hariIni), min, max);
            const aktif = Boolean(r && saatIni && r.dari === saatIni.dari && r.sampai === saatIni.sampai);
            return (
              <button
                key={p.kunci}
                type="button"
                className={styles.pilihan}
                aria-pressed={aktif}
                aria-disabled={!r || undefined}
                onClick={() => {
                  if (r) onTerapkan(r);
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
      <div className={styles.utama}>
        <KisiKalender
          fokus={fokus}
          onFokus={setFokus}
          onPilih={pilih}
          rentang={rancangan}
          sorot={sorot}
          onSorot={setSorot}
          min={min}
          max={max}
          hariIni={hariIni}
        />
        <p className={styles.ringkasan} aria-live="polite" aria-atomic="true">
          {ringkasan}
        </p>
        <div className={styles.kaki}>
          <Tombol varian="sekunder" className={styles.aksi} onClick={onBatal}>
            Batal
          </Tombol>
          <Tombol
            varian="utama"
            className={styles.aksi}
            disabled={!lengkap}
            onClick={() => {
              if (rancangan.dari && rancangan.sampai) onTerapkan({ dari: rancangan.dari, sampai: rancangan.sampai });
            }}
          >
            Terapkan
          </Tombol>
        </div>
      </div>
    </div>
  );
}
