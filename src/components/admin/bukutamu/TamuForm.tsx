'use client';

// Form catat tamu kantor (Admin + Front Office). Aturan isian SAMA dengan walk-in Front Office dan server
// (`lib/fo/walkin`): galat per isian saat meninggalkan isian, ringkasan + fokus ke galat pertama saat kirim.
// Tombol kirim sengaja tetap aktif (kecuali sedang mengirim) agar yang kurang bisa dijelaskan, bukan disembunyikan.
import { useRef, useState } from 'react';
import Tombol from '@/components/ui/Tombol';
import { formatHpTampil, normalisasiHp, periksaAsal, periksaHp, periksaNama, rapikanNama } from '@/lib/fo/walkin';
import styles from './TamuForm.module.css';

export interface TamuInput {
  nama: string;
  instansi: string;
  no_hp: string;
  bertemu: string;
  tujuan?: string;
}

type Kunci = 'nama' | 'instansi' | 'no_hp' | 'bertemu';
const URUTAN: Kunci[] = ['nama', 'instansi', 'no_hp', 'bertemu'];
const LABEL: Record<Kunci, string> = { nama: 'Nama tamu', instansi: 'Instansi / asal', no_hp: 'Nomor HP', bertemu: 'Bertemu siapa' };
const ID: Record<Kunci | 'tujuan', string> = {
  nama: 'tamuNama', instansi: 'tamuInstansi', no_hp: 'tamuHp', bertemu: 'tamuBertemu', tujuan: 'tamuTujuan',
};

function periksaBertemu(raw: string): string | undefined {
  return raw.trim().length < 2 ? 'Tulis siapa yang ingin ditemui (minimal 2 karakter).' : undefined;
}

function periksa(k: Kunci, v: string): string | undefined {
  if (k === 'nama') return periksaNama(v);
  if (k === 'instansi') return periksaAsal(v);
  if (k === 'no_hp') return periksaHp(v);
  return periksaBertemu(v);
}

const KOSONG = { nama: '', instansi: '', no_hp: '', bertemu: '', tujuan: '' };

/** onSubmit melempar Error bila gagal; pesannya ditampilkan di atas formulir. */
export default function TamuForm({ onSubmit }: { onSubmit: (data: TamuInput) => Promise<void> }) {
  const [v, setV] = useState(KOSONG);
  const [disentuh, setDisentuh] = useState<Partial<Record<Kunci, boolean>>>({});
  const [ringkasan, setRingkasan] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);

  const galat = (k: Kunci) => (disentuh[k] ? periksa(k, v[k]) : undefined);
  const ubah = (k: keyof typeof KOSONG, nilai: string) => {
    setV((s) => ({ ...s, [k]: nilai }));
    if (error) setError('');
  };
  const lepas = (k: Kunci) => {
    setDisentuh((s) => ({ ...s, [k]: true }));
    // Rapikan nilai yang sudah benar: nama berhuruf seragam jadi Title Case, HP jadi 0812-3456-7890.
    if (k === 'nama' && !periksaNama(v.nama)) ubah('nama', rapikanNama(v.nama));
    else if (k === 'no_hp' && !periksaHp(v.no_hp)) ubah('no_hp', formatHpTampil(normalisasiHp(v.no_hp)));
    else if (k === 'instansi' || k === 'bertemu') ubah(k, v[k].trim());
  };

  const atribut = (k: Kunci) => {
    const g = galat(k);
    return {
      id: ID[k],
      className: 'form-input',
      value: v[k],
      'aria-required': true as const,
      'aria-invalid': g ? (true as const) : undefined,
      'aria-describedby': [g ? `${ID[k]}-galat` : '', k === 'no_hp' ? 'tamuHp-petunjuk' : ''].filter(Boolean).join(' ') || undefined,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => ubah(k, e.target.value),
      onBlur: () => lepas(k),
    };
  };
  const pesan = (k: Kunci) => {
    const g = galat(k);
    return g ? <p id={`${ID[k]}-galat`} className="form-error">{g}</p> : null;
  };

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const salah = URUTAN.filter((k) => periksa(k, v[k]));
    setDisentuh({ nama: true, instansi: true, no_hp: true, bertemu: true });
    setRingkasan(salah.length > 0);
    if (salah.length > 0) {
      form.current?.querySelector<HTMLInputElement>(`#${ID[salah[0]]}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        nama: rapikanNama(v.nama),
        instansi: v.instansi.trim(),
        no_hp: normalisasiHp(v.no_hp),
        bertemu: v.bertemu.trim(),
        ...(v.tujuan.trim() && { tujuan: v.tujuan.trim() }),
      });
      setV(KOSONG);
      setDisentuh({});
      setRingkasan(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mencatat tamu');
    } finally {
      setSaving(false);
    }
  };

  const daftarSalah = URUTAN.filter((k) => galat(k));

  return (
    <form ref={form} onSubmit={handle} noValidate aria-label="Catat tamu" className={styles.form}>
      <h2 className={styles.judul}>Catat tamu baru</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      {ringkasan && daftarSalah.length > 0 && (
        <div className="form-error" role="alert">
          <p>Periksa kembali isian berikut:</p>
          <ul className={styles.ringkasan}>
            {daftarSalah.map((k) => <li key={k}><a href={`#${ID[k]}`}>{LABEL[k]}</a></li>)}
          </ul>
        </div>
      )}
      <div className={styles.kisi}>
        <div className="form-group">
          <label className="form-label form-label--required" htmlFor="tamuNama">Nama tamu</label>
          <input {...atribut('nama')} maxLength={100} autoComplete="off" />
          {pesan('nama')}
        </div>
        <div className="form-group">
          <label className="form-label form-label--required" htmlFor="tamuInstansi">Instansi / asal</label>
          <input {...atribut('instansi')} maxLength={120} autoComplete="off" />
          {pesan('instansi')}
        </div>
        <div className="form-group">
          <label className="form-label form-label--required" htmlFor="tamuHp">Nomor HP</label>
          <input {...atribut('no_hp')} type="tel" inputMode="tel" autoComplete="off" placeholder="0812-3456-7890" maxLength={30} />
          <p id="tamuHp-petunjuk" className="form-hint">Nomor ponsel, boleh diawali 08 atau +62 8.</p>
          {pesan('no_hp')}
        </div>
        <div className="form-group">
          <label className="form-label form-label--required" htmlFor="tamuBertemu">Bertemu siapa</label>
          <input {...atribut('bertemu')} maxLength={200} autoComplete="off" />
          {pesan('bertemu')}
        </div>
        <div className={`form-group ${styles.lebar}`}>
          <label className="form-label" htmlFor="tamuTujuan">Tujuan (opsional)</label>
          <input id="tamuTujuan" className="form-input" value={v.tujuan} maxLength={500} autoComplete="off"
            onChange={(e) => ubah('tujuan', e.target.value)} />
        </div>
      </div>
      <div className={styles.aksi}>
        <Tombol type="submit" className={styles.tombol} disabled={saving} memuat={saving}>
          Catat tamu
        </Tombol>
      </div>
    </form>
  );
}
