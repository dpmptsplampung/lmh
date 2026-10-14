'use client';

// Isian "topik + catatan" penanganan layanan (kontrak FO-ESKALASI §3.2/§3.3): dropdown topik layanan dan catatan
// 1-1000 karakter. Dipakai dialog antrean dan wizard pendataan. Setiap field punya label terhubung (htmlFor/id),
// galat tampil role=alert dan dirujuk aria-describedby.
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MAX_CATATAN_LAYANAN } from '@/lib/pelayanan';

export interface TopikOpsi {
  id: string;
  nama: string;
}

/** Topik aktif milik satu layanan (kontrak §6.5). Dimuat saat `aktif` dan `layananId` tersedia. */
export function useTopikLayanan(layananId: string | null, aktif = true) {
  const [topik, setTopik] = useState<TopikOpsi[]>([]);
  const [memuat, setMemuat] = useState(aktif && !!layananId);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    if (!aktif || !layananId) return;
    let batal = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setMemuat(true);
    setGalat(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('topik_penanganan')
          .select('id, nama, urut')
          .eq('aktif', true)
          .eq('layanan_id', layananId)
          .order('urut')
          .order('nama');
        if (batal) return;
        if (error) throw error;
        setTopik((data ?? []) as TopikOpsi[]);
      } catch {
        if (!batal) setGalat('Gagal memuat daftar topik. Tutup dialog lalu coba lagi.');
      } finally {
        if (!batal) setMemuat(false);
      }
    })();
    return () => {
      batal = true;
    };
  }, [layananId, aktif]);

  return { topik, memuat, galat };
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

const GAYA_GALAT: React.CSSProperties = { color: 'var(--color-danger-600)', fontSize: 12, margin: '4px 0 0' };

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
          <p id={idTopikGalat} role="alert" style={GAYA_GALAT}>{galatTopikTampil}</p>
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
        <small id={idCatatanBantuan} style={{ color: 'var(--text-tertiary)' }}>
          {bantuanCatatan ? `${bantuanCatatan} ` : ''}
          {catatan.length}/{MAX_CATATAN_LAYANAN} karakter.
        </small>
        {galatCatatan && (
          <p id={idCatatanGalat} role="alert" style={GAYA_GALAT}>{galatCatatan}</p>
        )}
      </div>
    </>
  );
}
