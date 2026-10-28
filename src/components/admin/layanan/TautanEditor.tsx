'use client';

import { useId, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { TAUTAN_MAKS, tautanSchema, type LayananTautan } from '@/lib/layanan/schemas';
import styles from './KelolaLayanan.module.css';

export type GalatTautan = { label?: string; url?: string };

const kosong = (t: LayananTautan) => t.label.trim() === '' && t.url.trim() === '';

/** Validasi per baris (indeks sama dengan `value`). Baris yang sama sekali kosong dianggap tidak ada dan lolos. */
export function validasiTautan(value: LayananTautan[]): Array<GalatTautan | null> {
  return value.map((t) => {
    if (kosong(t)) return null;
    if (tautanSchema.safeParse(t).success) return null;
    const galat: GalatTautan = {};
    const label = t.label.trim();
    const url = t.url.trim();
    if (label.length < 1) galat.label = 'Isi nama website.';
    else if (label.length > 80) galat.label = 'Nama website maksimal 80 karakter.';
    if (url.length < 1) galat.url = 'Isi alamat website, diawali https://';
    else if (url.length > 500) galat.url = 'Alamat website maksimal 500 karakter.';
    else if (!/^https:\/\/\S+$/.test(url)) galat.url = 'Alamat harus diawali https:// dan tanpa spasi.';
    return galat;
  });
}

/** Nilai siap kirim: dipangkas, baris kosong dibuang. */
export function bersihkanTautan(value: LayananTautan[]): LayananTautan[] {
  return value.filter((t) => !kosong(t)).map((t) => ({ label: t.label.trim(), url: t.url.trim() }));
}

/** Editor daftar website terkait (label + alamat https, maks. 10). */
export default function TautanEditor({
  value, onChange, disabled, tampilkanGalat,
}: {
  value: LayananTautan[];
  onChange: (next: LayananTautan[]) => void;
  disabled?: boolean;
  /** Tampilkan galat semua baris (diset formulir induk setelah percobaan simpan). */
  tampilkanGalat?: boolean;
}) {
  const dasar = useId();
  const tombolTambah = useRef<HTMLButtonElement>(null);
  // Baris yang sudah disentuh (kolom diisi lalu ditinggalkan) menampilkan galatnya tanpa menunggu simpan.
  const [disentuh, setDisentuh] = useState<number[]>([]);
  const galat = validasiTautan(value);
  const penuh = value.length >= TAUTAN_MAKS;
  const idBantuan = `${dasar}-bantuan`;

  const ubah = (i: number, bagian: Partial<LayananTautan>) =>
    onChange(value.map((t, j) => (j === i ? { ...t, ...bagian } : t)));
  const hapus = (i: number) => {
    onChange(value.filter((_, j) => j !== i));
    setDisentuh((d) => d.filter((j) => j !== i).map((j) => (j > i ? j - 1 : j)));
    // Baris yang berfokus hilang: pindahkan fokus ke tombol tambah agar pengguna keyboard tidak kehilangan posisi.
    requestAnimationFrame(() => tombolTambah.current?.focus());
  };
  const tampil = (i: number) => tampilkanGalat || disentuh.includes(i);
  const sentuh = (i: number) => setDisentuh((d) => (d.includes(i) ? d : [...d, i]));

  return (
    <fieldset className={styles.fieldset} disabled={disabled} aria-describedby={idBantuan}>
      <legend className={styles.legend}>Website terkait</legend>
      <p id={idBantuan} className="form-hint" style={{ margin: 0 }}>
        Tautan resmi yang berguna bagi pemohon, misalnya portal perizinan. Alamat harus diawali https://. Maksimal {TAUTAN_MAKS} website.
      </p>
      {value.length === 0 && <p className="form-hint" style={{ margin: 0 }}>Belum ada website terkait.</p>}
      {value.map((t, i) => {
        const n = i + 1;
        const g = tampil(i) ? galat[i] : null;
        const idLabel = `${dasar}-l${i}`;
        const idUrl = `${dasar}-u${i}`;
        return (
          <div key={i} className={styles.tautanRow}>
            <div className={styles.tautanField}>
              <input className="form-input" aria-label={`Nama website ${n}`} placeholder="Nama, mis. OSS RBA"
                value={t.label} maxLength={80}
                aria-invalid={g?.label ? true : undefined} aria-describedby={g?.label ? idLabel : undefined}
                onChange={(e) => ubah(i, { label: e.target.value })} onBlur={() => sentuh(i)} />
              {g?.label && <p id={idLabel} className="form-error" role="alert" style={{ margin: 0 }}>{g.label}</p>}
            </div>
            <div className={styles.tautanField}>
              <input className="form-input" type="url" inputMode="url" aria-label={`Alamat website ${n}`}
                placeholder="https://" value={t.url} maxLength={500} spellCheck={false} autoCapitalize="none"
                aria-invalid={g?.url ? true : undefined} aria-describedby={g?.url ? idUrl : undefined}
                onChange={(e) => ubah(i, { url: e.target.value })} onBlur={() => sentuh(i)} />
              {g?.url && <p id={idUrl} className="form-error" role="alert" style={{ margin: 0 }}>{g.url}</p>}
            </div>
            <button type="button" className="btn btn--ghost btn--sm" aria-label={`Hapus website ${n}`} onClick={() => hapus(i)}>
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <div>
        <button ref={tombolTambah} type="button" className="btn btn--secondary btn--sm" disabled={penuh}
          onClick={() => onChange([...value, { label: '', url: '' }])}>
          <Plus size={16} aria-hidden="true" /> Tambah website
        </button>
        {penuh && <span className="form-hint" style={{ marginLeft: 'var(--space-2)' }}>Sudah mencapai batas {TAUTAN_MAKS} website.</span>}
      </div>
    </fieldset>
  );
}
