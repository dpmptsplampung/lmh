'use client';

// Isian "topik + catatan" penanganan layanan (kontrak FO-ESKALASI §3.2/§3.3): dropdown topik layanan dan catatan
// 1-1000 karakter. Dipakai dialog antrean dan wizard pendataan. Setiap field punya label terhubung (htmlFor/id),
// galat tampil role=alert dan dirujuk aria-describedby.
import { createClient } from '@/lib/supabase/client';
import { KUNCI_REFERENSI, muatTopik } from '@/lib/data/referensi';
import { useReferensi } from '@/lib/data/klien/useReferensi';
import { MAX_CATATAN_LAYANAN } from '@/lib/pelayanan';
import styles from './FormAntrean.module.css';

export interface TopikOpsi {
  id: string;
  nama: string;
}

const TOPIK_KOSONG: TopikOpsi[] = [];
// Tanpa cache (ttlMs 0): hanya penggabungan permintaan yang bersamaan. Daftar ini menentukan topik yang boleh
// tersimpan pada penanganan dan Admin dapat menonaktifkan topik kapan saja, jadi tiap dialog dibuka daftar
// dimuat ulang seperti sebelum refaktor. Naikkan TTL hanya bersama pembuangan cache (`buangCacheReferensi`)
// dari Kelola Topik dan, di test, pada setiap `beforeEach`.
const TTL_TOPIK_MS = 0;

/**
 * Topik aktif milik satu layanan (kontrak §6.5). Dimuat saat `aktif` dan `layananId` tersedia lewat referensi
 * bersama (`lib/data/referensi.ts`); dialog yang memuat daftar sama pada saat yang sama berbagi satu permintaan.
 */
export function useTopikLayanan(layananId: string | null, aktif = true) {
  const id = aktif ? layananId : null;
  const { data, memuat, galat } = useReferensi(
    id ? KUNCI_REFERENSI.topik(id) : null,
    () => muatTopik(createClient(), id ?? ''),
    { ttlMs: TTL_TOPIK_MS },
  );
  return {
    topik: data ?? TOPIK_KOSONG,
    memuat,
    galat: galat ? 'Gagal memuat daftar topik. Tutup dialog lalu coba lagi.' : null,
  };
}

interface Props {
  /** Awalan id unik (mis. dari useId) agar label/aria-describedby tidak bentrok antar dialog. */
  idDasar: string;
  topik: TopikOpsi[];
  memuatTopik?: boolean;
  galatMuat?: string | null;
  topikId: string;
  onTopikId: (id: string) => void;
  topikWajib: boolean;
  catatan: string;
  onCatatan: (v: string) => void;
  catatanWajib: boolean;
  labelCatatan?: string;
  placeholderCatatan?: string;
  bantuanCatatan?: string;
  rows?: number;
  galatTopik?: string | null;
  galatCatatan?: string | null;
  disabled?: boolean;
}


export default function TopikCatatanFields({
  idDasar, topik, memuatTopik, galatMuat, topikId, onTopikId, topikWajib, catatan, onCatatan, catatanWajib,
  labelCatatan = 'Catatan penanganan', placeholderCatatan, bantuanCatatan, rows = 4, galatTopik, galatCatatan, disabled,
}: Props) {
  const idTopik = `${idDasar}-topik`;
  const idTopikGalat = `${idDasar}-topik-galat`;
  const idCatatan = `${idDasar}-catatan`;
  const idCatatanBantuan = `${idDasar}-catatan-bantuan`;
  const idCatatanGalat = `${idDasar}-catatan-galat`;
  const galatTopikTampil = galatTopik ?? galatMuat ?? null;

  return (
    <>
      <div className="form-group">
        <label htmlFor={idTopik} className={`form-label${topikWajib ? ' form-label--required' : ''}`}>
          Topik penanganan{topikWajib ? '' : ' (Opsional)'}
        </label>
        <select
          id={idTopik}
          className="form-select"
          value={topikId}
          disabled={disabled}
          aria-required={topikWajib}
          aria-invalid={galatTopikTampil ? true : undefined}
          aria-describedby={galatTopikTampil ? idTopikGalat : undefined}
          onChange={(e) => onTopikId(e.target.value)}
        >
          <option value="">{memuatTopik ? 'Memuat topik…' : '-- Pilih topik --'}</option>
          {topik.map((t) => (
            <option key={t.id} value={t.id}>{t.nama}</option>
          ))}
        </select>
        {galatTopikTampil && (
          <p id={idTopikGalat} role="alert" className={styles.galat}>{galatTopikTampil}</p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor={idCatatan} className={`form-label${catatanWajib ? ' form-label--required' : ''}`}>
          {labelCatatan}{catatanWajib ? '' : ' (Opsional)'}
        </label>
        <textarea
          id={idCatatan}
          className="form-textarea"
          rows={rows}
          value={catatan}
          maxLength={MAX_CATATAN_LAYANAN}
          disabled={disabled}
          aria-required={catatanWajib}
          aria-invalid={galatCatatan ? true : undefined}
          aria-describedby={galatCatatan ? `${idCatatanBantuan} ${idCatatanGalat}` : idCatatanBantuan}
          placeholder={placeholderCatatan}
          onChange={(e) => onCatatan(e.target.value)}
        />
        <small id={idCatatanBantuan} className={styles.bantuan}>
          {bantuanCatatan ? `${bantuanCatatan} ` : ''}
          {catatan.length}/{MAX_CATATAN_LAYANAN} karakter.
        </small>
        {galatCatatan && (
          <p id={idCatatanGalat} role="alert" className={styles.galat}>{galatCatatan}</p>
        )}
      </div>
    </>
  );
}
