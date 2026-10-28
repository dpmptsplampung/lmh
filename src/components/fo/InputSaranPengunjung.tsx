'use client';

// Isian Nama / Nomor HP formulir walk-in FO yang menjadi ARIA combobox (Fase 6): setelah >= 3 huruf nama (atau >= 3 angka
// HP) muncul paling banyak 5 saran pengunjung lama tepat di bawah isian itu. Memilih saran mengambil identitas lengkap
// lewat RPC dan memanggil `onPilih` (formulir terisi). Sifat penting:
//  - pencarian hanya dipicu KETIKAN pengguna (bukan perubahan nilai dari kode), jeda 300 ms, permintaan lama dibatalkan
//    (AbortSignal) dan hasilnya dibuang bila bukan permintaan terbaru; daftar lama tetap tampil selama menunggu (tanpa kedip);
//  - tidak pernah memblokir ketikan/kirim: galat, lambat, atau RPC belum ada = tanpa saran (diam-diam), isian berperilaku
//    seperti input biasa; `aktif=false` merender input biasa tanpa atribut combobox;
//  - papan ketik: panah atas/bawah menyorot, Enter memilih (hanya bila ada sorotan; selain itu Enter berperilaku seperti
//    sebelumnya), Esc menutup, Tab tidak dibajak; mouse/sentuh lewat klik, blur menutup daftar tanpa menelan klik.
import { useCallback, useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  ambilPengunjung,
  cariPengunjung,
  jenisQuery,
  type PengunjungTerpilih,
  type SaranPengunjung,
} from '@/lib/fo/cari-pengunjung';
import { todayWIB } from '@/lib/time';
import styles from './saran-pengunjung.module.css';

export const JEDA_CARI_MS = 300;
const JEDA_TUTUP_BLUR_MS = 150;

function formatTanggalId(tanggal: string): string {
  const d = new Date(`${tanggal}T00:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return tanggal;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
}

const PESAN_AMBIL = {
  dibatasi: 'Terlalu banyak pengambilan data dalam waktu singkat. Isi manual atau coba lagi beberapa menit lagi.',
  tidak_ada: 'Data pengunjung ini tidak lagi tersedia. Isi manual.',
  sesi: 'Sesi Anda berakhir. Muat ulang halaman lalu masuk kembali.',
  galat: 'Gagal mengambil data pengunjung. Isi manual atau coba lagi.',
} as const;

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'role'> {
  /** Isian ini mencari berdasarkan nama atau nomor HP. */
  jenis: 'nama' | 'hp';
  /** false = input biasa (fitur belum tersedia / bukan FO-admin). */
  aktif: boolean;
  value: string;
  onChange: (nilai: string) => void;
  /** Identitas lengkap pengunjung yang dipilih. */
  onPilih: (data: PengunjungTerpilih) => void;
  /** Server menyatakan fitur tidak tersedia: induk menonaktifkan semua isian saran. */
  onTidakTersedia?: () => void;
}

export default function InputSaranPengunjung({
  jenis,
  aktif,
  value,
  onChange,
  onPilih,
  onTidakTersedia,
  onKeyDown,
  onBlur,
  ...rest
}: Props) {
  const idDaftar = `${useId()}-saran`;
  const [saran, setSaran] = useState<SaranPengunjung[]>([]);
  const [buka, setBuka] = useState(false);
  const [sorot, setSorot] = useState(-1);
  const [catatan, setCatatan] = useState('');
  const [pengumuman, setPengumuman] = useState('');
  // Nomor urut permintaan: setiap ketikan/pilihan menaikkannya; hasil dengan nomor lama dibuang.
  const urutanRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tutupRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const batalkan = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(
    () => () => {
      batalkan();
      if (tutupRef.current) clearTimeout(tutupRef.current);
    },
    [batalkan],
  );

  const reset = () => {
    setSaran([]);
    setBuka(false);
    setSorot(-1);
    setPengumuman('');
  };

  const jadwalkan = (nilai: string) => {
    const urutan = ++urutanRef.current;
    batalkan();
    setCatatan('');
    if (!aktif || jenisQuery(nilai) !== jenis) {
      reset();
      return;
    }
    timerRef.current = setTimeout(() => {
      const ac = new AbortController();
      abortRef.current = ac;
      void cariPengunjung(createClient(), nilai, ac.signal).then((r) => {
        if (urutan !== urutanRef.current) return;
        if (r.status === 'tidak_tersedia') {
          reset();
          onTidakTersedia?.();
          return;
        }
        if (r.status !== 'ok') {
          // Diam-diam: tanpa saran, isian tetap bisa dipakai.
          reset();
          return;
        }
        setSaran(r.hasil);
        setSorot(-1);
        setBuka(r.hasil.length > 0);
        setPengumuman(r.hasil.length > 0 ? `${r.hasil.length} saran pengunjung lama. Gunakan panah atas dan bawah, lalu Enter.` : '');
      });
    }, JEDA_CARI_MS);
  };

  const pilih = async (s: SaranPengunjung) => {
    const urutan = ++urutanRef.current;
    batalkan();
    setBuka(false);
    setSorot(-1);
    const r = await ambilPengunjung(createClient(), s.id);
    // Pengguna sudah mengetik lagi selagi menunggu: jangan menimpa isiannya.
    if (urutan !== urutanRef.current) return;
    if (r.status === 'ok') {
      setSaran([]);
      setCatatan('');
      setPengumuman('Formulir diisi dari data pengunjung lama.');
      onPilih(r.data);
    } else {
      setCatatan(PESAN_AMBIL[r.status]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (aktif && !e.nativeEvent.isComposing) {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && saran.length > 0) {
        e.preventDefault();
        setBuka(true);
        setSorot((i) => (e.key === 'ArrowDown' ? (i + 1) % saran.length : i <= 0 ? saran.length - 1 : i - 1));
        return;
      }
      if (e.key === 'Enter' && buka && sorot >= 0 && saran[sorot]) {
        e.preventDefault();
        void pilih(saran[sorot]);
        return;
      }
      if (e.key === 'Escape' && buka) {
        e.preventDefault();
        setBuka(false);
        setSorot(-1);
        return;
      }
    }
    onKeyDown?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    onBlur?.(e);
    if (tutupRef.current) clearTimeout(tutupRef.current);
    // Jeda singkat: klik pada saran yang sampai setelah blur tetap terbaca.
    tutupRef.current = setTimeout(() => {
      setBuka(false);
      setSorot(-1);
    }, JEDA_TUTUP_BLUR_MS);
  };

  const hariIni = todayWIB();
  const daftarTampil = aktif && buka && saran.length > 0;

  return (
    <div className={styles.pembungkus}>
      <input
        {...rest}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          jadwalkan(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onFocus={(e) => {
          if (tutupRef.current) clearTimeout(tutupRef.current);
          rest.onFocus?.(e);
        }}
        {...(aktif
          ? {
              role: 'combobox' as const,
              'aria-autocomplete': 'list' as const,
              'aria-expanded': daftarTampil,
              'aria-controls': daftarTampil ? idDaftar : undefined,
              'aria-activedescendant': daftarTampil && sorot >= 0 ? `${idDaftar}-${sorot}` : undefined,
            }
          : {})}
      />
      {aktif && (
        <span className={styles.srOnly} role="status" aria-live="polite">
          {pengumuman}
        </span>
      )}
      {daftarTampil && (
        <ul
          id={idDaftar}
          role="listbox"
          aria-label={jenis === 'nama' ? 'Saran pengunjung lama berdasarkan nama' : 'Saran pengunjung lama berdasarkan nomor HP'}
          className={styles.daftar}
        >
          {saran.map((s, i) => (
            <li
              key={s.id}
              id={`${idDaftar}-${i}`}
              role="option"
              aria-selected={i === sorot}
              className={`${styles.opsi} ${i === sorot ? styles.opsiAktif : ''}`}
              // mousedown dicegah agar input tidak kehilangan fokus (blur) sebelum klik terbaca.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void pilih(s)}
              onMouseMove={() => setSorot(i)}
            >
              <span className={styles.nama}>{s.nama}</span>
              <span className={styles.rincian}>
                {s.hpSamar ? `${s.hpSamar} · ` : ''}
                {s.asal}
              </span>
              <span className={styles.rincian}>
                Kunjungan terakhir {s.tanggal ? formatTanggalId(s.tanggal) : '-'}
                {s.tanggal === hariIni && <span className={styles.peringatan}> (hari ini, cek pendaftaran ganda)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {catatan && (
        <span className={styles.catatan} role="status">
          {catatan}
        </span>
      )}
    </div>
  );
}
