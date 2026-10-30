'use client';

// Edit langsung di tabel (docs/superpowers/plans/2026-10-30-tabel-dan-edit-inline.md): pengganti dialog kecil untuk mengubah satu nilai teks
// dan menambah baris baru.
//  - SelTeksInline : sel teks yang bila diklik/Enter menjadi input. Enter atau blur = simpan, Esc = batal.
//    Galat tampil di bawah input (aria-describedby); saat menyimpan input diberi aria-busy; hasil diumumkan lewat aria-live.
//  - BarisTambah   : baris "+ Tambah ..." di ujung tabel (input kosong + tombol Tambah). Enter di input = Tambah.
// Keduanya hanya mengurus tampilan dan keyboard; penyimpanan (dan galatnya) ada di pemanggil lewat fungsi yang
// mengembalikan pesan galat (string) atau null bila berhasil.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Pencil, Plus } from 'lucide-react';
import styles from './SuntingInline.module.css';

const kapitalAwal = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

interface SelTeksProps {
  nilai: string;
  /** Nama kontrol tanpa kata kerja, mis. "nama topik Pengaduan". Tombol bernama "Ubah <label>", input bernama label. */
  label: string;
  /** Simpan nilai baru (sudah dipangkas). Kembalikan pesan galat, atau null bila berhasil. */
  onSimpan: (baru: string) => Promise<string | null>;
  /** Pemeriksaan di klien sebelum onSimpan; kembalikan pesan galat atau null. */
  validasi?: (baru: string) => string | null;
  maxLength?: number;
  /** Teks pengganti saat nilai kosong (mis. "Tambah singkatan"). */
  teksKosong?: string;
  /** Tanpa kemampuan edit (peran tanpa hak ubah): hanya teks. */
  bacaSaja?: boolean;
}

export function SelTeksInline({ nilai, label, onSimpan, validasi, maxLength, teksKosong, bacaSaja }: SelTeksProps) {
  const idGalat = useId();
  const [edit, setEdit] = useState(false);
  const [draf, setDraf] = useState(nilai);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pengumuman, setPengumuman] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const tombolRef = useRef<HTMLButtonElement>(null);
  const batalRef = useRef(false);
  const kirimRef = useRef(false);
  const fokusTombolRef = useRef(false);

  useEffect(() => {
    if (edit) {
      batalRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (fokusTombolRef.current) {
      fokusTombolRef.current = false;
      tombolRef.current?.focus();
    }
  }, [edit]);

  if (bacaSaja) return <span>{nilai || '—'}</span>;

  const mulai = () => {
    setDraf(nilai);
    setGalat(null);
    setPengumuman('');
    setEdit(true);
  };

  const keluar = (fokusKembali: boolean) => {
    fokusTombolRef.current = fokusKembali;
    setGalat(null);
    setEdit(false);
  };

  const simpan = async (dariBlur: boolean) => {
    if (kirimRef.current) return;
    const baru = draf.trim();
    if (baru === nilai) {
      keluar(!dariBlur);
      return;
    }
    const g = validasi?.(baru) ?? null;
    if (g) {
      setGalat(g);
      return;
    }
    kirimRef.current = true;
    setSibuk(true);
    setGalat(null);
    let hasil: string | null;
    try {
      hasil = await onSimpan(baru);
    } catch {
      hasil = 'Gagal menyimpan. Coba lagi.';
    }
    kirimRef.current = false;
    setSibuk(false);
    if (hasil) {
      setGalat(hasil);
      return;
    }
    setPengumuman(`${kapitalAwal(label)} disimpan.`);
    keluar(!dariBlur);
  };

  const tombolKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void simpan(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      batalRef.current = true;
      keluar(true);
    }
  };

  return (
    <div className={styles.sel}>
      {edit ? (
        <>
          <input
            ref={inputRef}
            className={`form-input ${styles.input}`}
            value={draf}
            maxLength={maxLength}
            readOnly={sibuk}
            aria-label={kapitalAwal(label)}
            aria-busy={sibuk || undefined}
            aria-invalid={galat ? true : undefined}
            aria-describedby={galat ? idGalat : undefined}
            onChange={(e) => { setDraf(e.target.value); setGalat(null); }}
            onKeyDown={tombolKey}
            onBlur={() => { if (!batalRef.current) void simpan(true); }}
          />
          {galat && <p id={idGalat} role="alert" className={styles.galat}>{galat}</p>}
        </>
      ) : (
        <button type="button" ref={tombolRef} className={styles.tombol} aria-label={`Ubah ${label}`} onClick={mulai}>
          <span className={nilai ? styles.teks : styles.teksKosong}>{nilai || teksKosong || '—'}</span>
          <Pencil size={12} className={styles.pensil} aria-hidden="true" />
        </button>
      )}
      <span className="sr-only" role="status" aria-live="polite">{pengumuman}</span>
    </div>
  );
}

export type BidangTambah =
  | { kunci: string; label: string; jenis?: 'teks'; placeholder?: string; maxLength?: number }
  | { kunci: string; label: string; jenis: 'pilih'; opsi: ReadonlyArray<{ nilai: string; label: string }>; awal: string }
  | { kunci: string; label: string; jenis: 'kotak'; teksKotak?: string }
  | { kunci: string; label: string; jenis: 'area'; placeholder?: string; bantuan?: string; tampilJika?: (nilai: Record<string, string>) => boolean };

interface BarisTambahProps {
  /** Jumlah kolom tabel; bidang non-area mengisi kolom dari kiri, tombol Tambah di kolom terakhir. */
  kolom: number;
  bidang: BidangTambah[];
  labelTombol?: string;
  ariaTombol?: string;
  /** Kembalikan pesan galat, atau null bila berhasil (isian dikosongkan dan fokus kembali ke bidang pertama). */
  onTambah: (nilai: Record<string, string>) => Promise<string | null>;
  /** Mis. batas jumlah tercapai: baris diganti keterangan. */
  nonaktif?: boolean;
  ketNonaktif?: string;
}

function nilaiAwal(bidang: BidangTambah[]): Record<string, string> {
  const n: Record<string, string> = {};
  for (const b of bidang) n[b.kunci] = b.jenis === 'pilih' ? b.awal : '';
  return n;
}

export function BarisTambah({ kolom, bidang, labelTombol = 'Tambah', ariaTombol, onTambah, nonaktif, ketNonaktif }: BarisTambahProps) {
  const idGalat = useId();
  const [nilai, setNilai] = useState<Record<string, string>>(() => nilaiAwal(bidang));
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pengumuman, setPengumuman] = useState('');
  const pertamaRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  if (nonaktif) {
    return (
      <tr>
        <td colSpan={kolom} className={styles.ketNonaktif}>{ketNonaktif}</td>
      </tr>
    );
  }

  const utama = bidang.filter((b) => b.jenis !== 'area');
  const area = bidang.filter((b) => b.jenis === 'area' && (b.tampilJika ? b.tampilJika(nilai) : true));
  const atur = (kunci: string, v: string) => { setNilai((s) => ({ ...s, [kunci]: v })); setGalat(null); };

  const kirim = async () => {
    if (sibuk) return;
    setSibuk(true);
    setGalat(null);
    let hasil: string | null;
    try {
      hasil = await onTambah(nilai);
    } catch {
      hasil = 'Gagal menambah. Coba lagi.';
    }
    setSibuk(false);
    if (hasil) {
      setGalat(hasil);
      return;
    }
    setNilai(nilaiAwal(bidang));
    setPengumuman('Berhasil ditambahkan.');
    pertamaRef.current?.focus();
  };

  const enter = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void kirim();
    }
  };

  const bantu = galat ? idGalat : undefined;

  return (
    <>
      <tr className={styles.barisTambah}>
        {utama.map((b, i) => {
          const colSpan = i === utama.length - 1 ? Math.max(1, kolom - 1 - (utama.length - 1)) : 1;
          return (
            <td key={b.kunci} colSpan={colSpan}>
              {b.jenis === 'pilih' ? (
                <select
                  ref={i === 0 ? (pertamaRef as React.RefObject<HTMLSelectElement>) : undefined}
                  className="form-select"
                  aria-label={b.label}
                  value={nilai[b.kunci]}
                  disabled={sibuk}
                  onChange={(e) => atur(b.kunci, e.target.value)}
                >
                  {b.opsi.map((o) => <option key={o.nilai} value={o.nilai}>{o.label}</option>)}
                </select>
              ) : b.jenis === 'kotak' ? (
                <label className={styles.kotak}>
                  <input
                    type="checkbox"
                    checked={nilai[b.kunci] === 'true'}
                    disabled={sibuk}
                    onChange={(e) => atur(b.kunci, e.target.checked ? 'true' : '')}
                  />
                  {b.teksKotak ?? b.label}
                </label>
              ) : (
                <input
                  ref={i === 0 ? (pertamaRef as React.RefObject<HTMLInputElement>) : undefined}
                  className="form-input"
                  aria-label={b.label}
                  placeholder={b.placeholder}
                  maxLength={b.maxLength}
                  value={nilai[b.kunci]}
                  readOnly={sibuk}
                  aria-invalid={galat && i === 0 ? true : undefined}
                  aria-describedby={i === 0 ? bantu : undefined}
                  onChange={(e) => atur(b.kunci, e.target.value)}
                  onKeyDown={enter}
                />
              )}
              {i === 0 && galat && <p id={idGalat} role="alert" className={styles.galat}>{galat}</p>}
            </td>
          );
        })}
        <td className="kol-aksi">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            aria-label={ariaTombol}
            aria-busy={sibuk || undefined}
            disabled={sibuk}
            onClick={() => void kirim()}
          >
            <Plus size={14} aria-hidden="true" /> {labelTombol}
          </button>
          <span className="sr-only" role="status" aria-live="polite">{pengumuman}</span>
        </td>
      </tr>
      {area.length > 0 && (
        <tr className={styles.barisTambah}>
          <td colSpan={kolom}>
            {area.map((b) => b.jenis === 'area' && (
              <div key={b.kunci} className={styles.area}>
                <textarea
                  className="form-textarea"
                  rows={4}
                  aria-label={b.label}
                  aria-describedby={b.bantuan ? `${idGalat}-${b.kunci}` : undefined}
                  placeholder={b.placeholder}
                  value={nilai[b.kunci]}
                  readOnly={sibuk}
                  onChange={(e) => atur(b.kunci, e.target.value)}
                />
                {b.bantuan && <small id={`${idGalat}-${b.kunci}`} className={styles.bantuan}>{b.bantuan}</small>}
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}
