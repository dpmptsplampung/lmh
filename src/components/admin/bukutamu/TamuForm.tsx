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
  /** Terisi bila "bertemu" dipilih dari daftar petugas; `bertemu` berisi nama petugasnya. */
  menemui_petugas_id?: string;
  tujuan?: string;
}

export interface PilihanPetugas {
  id: string;
  nama: string;
}

/** Nilai pilihan "tulis sendiri" pada daftar petugas (bukan UUID, jadi tak bisa bentrok). */
const LAIN = 'lain';

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
const PESAN_PILIH_PETUGAS = 'Pilih petugas yang ditemui, atau pilih "Lainnya" lalu tulis sendiri.';

/**
 * onSubmit melempar Error bila gagal; pesannya ditampilkan di atas formulir.
 * `petugas` terisi = "Bertemu siapa" berupa pilihan petugas (+ "Lainnya" untuk teks bebas). Kosong/null (belum
 * dimuat atau gagal dimuat) = isian teks biasa, jadi formulir tetap bisa dipakai.
 */
export default function TamuForm({ onSubmit, petugas }: { onSubmit: (data: TamuInput) => Promise<void>; petugas?: PilihanPetugas[] | null }) {
  const [v, setV] = useState(KOSONG);
  const [petugasId, setPetugasId] = useState('');
  const modePilih = !!petugas && petugas.length > 0;
  const petugasTerpilih = modePilih ? petugas.find((p) => p.id === petugasId) : undefined;
  const [disentuh, setDisentuh] = useState<Partial<Record<Kunci, boolean>>>({});
  const [ringkasan, setRingkasan] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);

  const periksaIsian = (k: Kunci): string | undefined => {
    if (k === 'bertemu' && modePilih && petugasId !== LAIN) return petugasTerpilih ? undefined : PESAN_PILIH_PETUGAS;
    return periksa(k, v[k]);
  };
  // Elemen yang harus difokus/ditaut untuk galat sebuah isian.
  const idIsian = (k: Kunci) => (k === 'bertemu' && modePilih && petugasId !== LAIN ? 'tamuPetugas' : ID[k]);
  const galat = (k: Kunci) => (disentuh[k] ? periksaIsian(k) : undefined);
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
    const salah = URUTAN.filter((k) => periksaIsian(k));
    setDisentuh({ nama: true, instansi: true, no_hp: true, bertemu: true });
    setRingkasan(salah.length > 0);
    if (salah.length > 0) {
      form.current?.querySelector<HTMLElement>(`#${idIsian(salah[0])}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        nama: rapikanNama(v.nama),
        instansi: v.instansi.trim(),
        no_hp: normalisasiHp(v.no_hp),
        bertemu: petugasTerpilih ? petugasTerpilih.nama : v.bertemu.trim(),
        ...(petugasTerpilih && { menemui_petugas_id: petugasTerpilih.id }),
        ...(v.tujuan.trim() && { tujuan: v.tujuan.trim() }),
      });
      setV(KOSONG);
      setPetugasId('');
      setDisentuh({});
      setRingkasan(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mencatat tamu');
    } finally {
      setSaving(false);
    }
  };

  const daftarSalah = URUTAN.filter((k) => galat(k));
  const galatBertemu = galat('bertemu');

  return (
    <form ref={form} onSubmit={handle} noValidate aria-label="Catat tamu" className={styles.form}>
      <h2 className={styles.judul}>Catat tamu baru</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      {ringkasan && daftarSalah.length > 0 && (
        <div className="form-error" role="alert">
          <p>Periksa kembali isian berikut:</p>
          <ul className={styles.ringkasan}>
            {daftarSalah.map((k) => <li key={k}><a href={`#${idIsian(k)}`}>{LABEL[k]}</a></li>)}
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
        {modePilih && (
          <div className="form-group">
            <label className="form-label form-label--required" htmlFor="tamuPetugas">Bertemu siapa</label>
            <select
              id="tamuPetugas"
              className="form-input"
              value={petugasId}
              aria-required="true"
              aria-invalid={galatBertemu && petugasId !== LAIN ? true : undefined}
              aria-describedby={galatBertemu && petugasId !== LAIN ? 'tamuBertemu-galat' : undefined}
              onChange={(e) => { setPetugasId(e.target.value); if (error) setError(''); }}
              onBlur={() => lepas('bertemu')}
            >
              <option value="">Pilih petugas yang ditemui</option>
              {petugas.map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
              <option value={LAIN}>Lainnya (tulis sendiri)</option>
            </select>
            {petugasId !== LAIN && pesan('bertemu')}
          </div>
        )}
        {(!modePilih || petugasId === LAIN) && (
          <div className="form-group">
            <label className="form-label form-label--required" htmlFor="tamuBertemu">{modePilih ? 'Nama yang ditemui' : 'Bertemu siapa'}</label>
            <input {...atribut('bertemu')} maxLength={200} autoComplete="off" />
            {pesan('bertemu')}
          </div>
        )}
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
