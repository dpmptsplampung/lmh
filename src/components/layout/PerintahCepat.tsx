'use client';

// Perintah cepat (A4): Ctrl K atau "/" membuka daftar tersaring. Sumber = menu sesuai peran (buildNavTree, jadi
// hak akses otomatis benar) ditambah tindakan tetap per peran. Pencarian teks di klien; tanpa backend dan tanpa
// data pengunjung. Pola ARIA combobox + listbox; semua pilihan berupa tautan biasa (Link).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { buildNavTree, canAccessAdminPath, type AdminRole } from '@/lib/admin-nav';
import styles from './PerintahCepat.module.css';

export interface Perintah {
  id: string;
  label: string;
  href: string;
  /** "Tindakan", atau nama grup menu ("Front Office", ...), atau "Menu". */
  kelompok: string;
  /** Kata tambahan untuk pencarian. */
  kata?: string;
}

// Tindakan tetap per peran. Hak akses tetap disaring lewat canAccessAdminPath (rute + role), bukan hanya daftar ini.
// "Panggil berikutnya" sengaja belum ada (gelombang 2).
const TINDAKAN: (Perintah & { roles: AdminRole[] })[] = [
  { id: 'tindakan-walkin', label: 'Registrasi Walk-in', href: '/admin/fo/registrasi?tab=walkin', kelompok: 'Tindakan', kata: 'daftar pengunjung loket', roles: ['admin', 'front_office'] },
  { id: 'tindakan-scan', label: 'Scan QR', href: '/admin/fo/registrasi?tab=scan', kelompok: 'Tindakan', kata: 'kode qr reservasi', roles: ['admin', 'front_office'] },
  { id: 'tindakan-layar', label: 'Buka layar TV', href: '/admin/layar', kelompok: 'Tindakan', kata: 'tv antrean kelola layar', roles: ['admin'] },
];

/** Daftar perintah untuk satu peran: tindakan dulu, lalu semua entri menu yang terlihat di sidebar peran itu. */
export function susunPerintah(role: string | null | undefined): Perintah[] {
  if (role !== 'admin' && role !== 'petugas' && role !== 'front_office') return [];
  const hasil: Perintah[] = TINDAKAN.filter(
    (t) => t.roles.includes(role) && canAccessAdminPath(role, t.href.split('?')[0]),
  ).map((t) => ({ id: t.id, label: t.label, href: t.href, kelompok: t.kelompok, kata: t.kata }));
  for (const item of buildNavTree(role)) {
    if (item.type === 'link') {
      hasil.push({ id: `menu-${item.entry.href}`, label: item.entry.label, href: item.entry.href, kelompok: 'Menu' });
    } else {
      for (const e of item.children) {
        hasil.push({ id: `menu-${e.href}`, label: e.label, href: e.href, kelompok: item.group.label });
      }
    }
  }
  return hasil;
}

const normal = (s: string) => s.toLocaleLowerCase('id-ID').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Semua kata kueri harus ada di label, kelompok, atau kata tambahan. Kueri kosong = semua. */
export function saring(daftar: Perintah[], kueri: string): Perintah[] {
  const kata = normal(kueri).split(/\s+/).filter(Boolean);
  if (kata.length === 0) return daftar;
  return daftar.filter((p) => {
    const jerami = normal(`${p.label} ${p.kelompok} ${p.kata ?? ''}`);
    return kata.every((k) => jerami.includes(k));
  });
}

function sedangMengetik(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export interface PerintahCepatProps {
  role: string | null | undefined;
  /** Terkait dengan tombol pembuka di AppBar; dipakai mengembalikan fokus. */
  pembukaRef?: React.RefObject<HTMLButtonElement | null>;
  /** Hanya untuk tes: mulai dalam keadaan terbuka. */
  bukaAwal?: boolean;
  /** Dipanggil saat pilihan dipakai atau dialog ditutup. */
  onTutup?: () => void;
  /** Kontrol dari luar (tombol di AppBar). */
  buka?: boolean;
  onUbah?: (buka: boolean) => void;
}

export default function PerintahCepat({ role, pembukaRef, buka: bukaLuar, onUbah, onTutup }: PerintahCepatProps) {
  const [bukaDalam, setBukaDalam] = useState(false);
  const buka = bukaLuar ?? bukaDalam;
  const atur = (v: boolean) => {
    if (bukaLuar === undefined) setBukaDalam(v);
    onUbah?.(v);
    if (!v) onTutup?.();
  };
  const [kueri, setKueri] = useState('');
  const [aktif, setAktif] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const pembukaTerakhir = useRef<HTMLElement | null>(null);
  const idDaftar = useId();
  const idJudul = useId();

  const semua = useMemo(() => susunPerintah(role), [role]);
  const hasil = useMemo(() => saring(semua, kueri), [semua, kueri]);
  const aktifAman = hasil.length === 0 ? -1 : Math.min(aktif, hasil.length - 1);

  // Pintasan global: Ctrl/Cmd+K membuka (juga dari isian); "/" hanya bila tidak sedang mengetik.
  useEffect(() => {
    if (semua.length === 0) return;
    const saatKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const kombinasi = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k';
      const garis = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !sedangMengetik(e.target);
      if (!kombinasi && !garis) return;
      e.preventDefault();
      pembukaTerakhir.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setKueri('');
      setAktif(0);
      if (bukaLuar === undefined) setBukaDalam(true);
      onUbah?.(true);
    };
    document.addEventListener('keydown', saatKey);
    return () => document.removeEventListener('keydown', saatKey);
  }, [semua.length, bukaLuar, onUbah]);

  // Terbuka: fokus ke isian. Tertutup: kembalikan fokus ke pembuka.
  const sudahBuka = useRef(false);
  useEffect(() => {
    if (buka) {
      sudahBuka.current = true;
      input.current?.focus();
    } else if (sudahBuka.current) {
      sudahBuka.current = false;
      const target = pembukaRef?.current ?? pembukaTerakhir.current;
      target?.focus();
    }
  }, [buka, pembukaRef]);

  // Gulir body dikunci selama terbuka.
  useEffect(() => {
    if (!buka) return;
    const sebelum = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = sebelum;
    };
  }, [buka]);

  if (!buka || semua.length === 0) return null;

  const pindah = (arah: number) => {
    if (hasil.length === 0) return;
    setAktif((((aktifAman + arah) % hasil.length) + hasil.length) % hasil.length);
  };

  const saatKeyInput = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        pindah(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        pindah(-1);
        break;
      case 'Home':
        e.preventDefault();
        setAktif(0);
        break;
      case 'End':
        e.preventDefault();
        setAktif(Math.max(0, hasil.length - 1));
        break;
      case 'Enter': {
        e.preventDefault();
        // Klik tautan aktif: navigasi klien Next berjalan lewat Link.
        document.getElementById(`${idDaftar}-${aktifAman}`)?.click();
        break;
      }
      case 'Escape':
        e.preventDefault();
        atur(false);
        break;
      case 'Tab':
        // Satu-satunya kontrol terfokus adalah isian; fokus tidak boleh lari ke halaman di belakang.
        e.preventDefault();
        break;
    }
  };

  return (
    <div className={styles.latar} role="presentation" data-cetak="sembunyi" onMouseDown={(e) => { if (e.target === e.currentTarget) atur(false); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={idJudul}>
        <h2 id={idJudul} className={styles.srOnly}>Perintah cepat</h2>
        <div className={styles.cari}>
          <Search size={18} strokeWidth={1.75} aria-hidden="true" className={styles.ikon} />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={idDaftar}
            aria-activedescendant={aktifAman >= 0 ? `${idDaftar}-${aktifAman}` : undefined}
            aria-autocomplete="list"
            aria-label="Cari menu atau tindakan"
            placeholder="Cari menu atau tindakan"
            autoComplete="off"
            spellCheck={false}
            className={styles.isian}
            value={kueri}
            onChange={(e) => { setKueri(e.target.value); setAktif(0); }}
            onKeyDown={saatKeyInput}
          />
          <kbd className={styles.kbd} aria-hidden="true">Esc</kbd>
        </div>
        <ul id={idDaftar} role="listbox" aria-label="Hasil" className={styles.daftar}>
          {hasil.map((p, i) => {
            // Judul bagian muncul saat kelompok berganti (urutan hasil tidak diubah).
            const judulBaru = i === 0 || hasil[i - 1].kelompok !== p.kelompok;
            return (
              <li key={p.id} role="presentation" className={styles.butirWadah}>
                {judulBaru && <span className={styles.kelompok} aria-hidden="true">{p.kelompok}</span>}
                <Link
                  id={`${idDaftar}-${i}`}
                  href={p.href}
                  role="option"
                  aria-selected={i === aktifAman}
                  tabIndex={-1}
                  className={styles.butir}
                  onClick={() => atur(false)}
                  onMouseMove={() => { if (i !== aktifAman) setAktif(i); }}
                >
                  <span>{p.label}</span>
                  <span className={styles.sub}>{p.kelompok}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        {hasil.length === 0 && <p className={styles.kosong} role="status">Tidak ada menu atau tindakan yang cocok.</p>}
        <p className={styles.bantu} aria-hidden="true">Panah untuk memilih, Enter untuk membuka</p>
      </div>
    </div>
  );
}
