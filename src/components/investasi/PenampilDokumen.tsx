'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, FileText, Info, Mail, RefreshCw } from 'lucide-react';
import { satuanHalaman } from './dokumen-logika';
import LapisanTautan from './LapisanTautan';
import { useTautanDokumen } from './useTautanDokumen';
import { usePramuatHalaman } from './usePramuatHalaman';
import KerangkaModal from '@/components/ui/KerangkaModal';
import Tombol from '@/components/ui/Tombol';
import styles from './penampil.module.css';

export type PropsPenampilDokumen = {
  dokumenId: string;
  judul: string;
  /** Jumlah halaman siap baca (aturan tunggal: `dokumenSiap`); 0 = dokumen masih diproses. */
  jumlahHalaman: number;
  /** Email lembaga untuk dokumen yang belum siap. */
  kontakEmail?: string;
  /** Kategori dokumen: "Peta Potensi" (slideshow) memakai satuan "slide" dan kotak lebih lebar. */
  kategori?: string;
  /** Bila ada, kaki penampil memuat tombol "Ajukan minat". */
  onMinat?: () => void;
  onTutup: () => void;
};

type StatusGambar = 'memuat' | 'siap' | 'gagal';

/**
 * Penampil dokumen (hanya lihat), dipakai bersama oleh /gallery, hub /investasi, dan detail IPRO.
 * Halaman PDF dirender server menjadi gambar ber-watermark (`/api/investment-docs/page-image`). Dipasang hanya saat
 * dibuka (induk merender bersyarat), jadi halaman selalu mulai dari 1. Di HP memenuhi layar.
 * Fokus awal, jebak fokus, Escape, dan pengembalian fokus ke pemicu dibawa KerangkaModal.
 */
export default function PenampilDokumen({ dokumenId, judul, jumlahHalaman, kategori, kontakEmail, onMinat, onTutup }: PropsPenampilDokumen) {
  const [halaman, setHalaman] = useState(1);
  // Status dicatat per percobaan (halaman + nomor coba ulang) supaya pindah halaman otomatis kembali ke "memuat".
  const [percobaan, setPercobaan] = useState(0);
  const [hasil, setHasil] = useState<{ kunci: string; status: StatusGambar }>({ kunci: '', status: 'memuat' });
  // Gambar terakhir yang selesai dimuat: tetap tampil (dan tautannya tetap bisa diklik) sampai gambar baru siap.
  const [terakhir, setTerakhir] = useState<{ halaman: number; src: string } | null>(null);
  const siap = jumlahHalaman > 0;
  const idLompat = useId();
  const kunci = `${halaman}:${percobaan}`;
  const status: StatusGambar = hasil.kunci === kunci ? hasil.status : 'memuat';
  const satuan = satuanHalaman(kategori);
  const tautanPerHalaman = useTautanDokumen(dokumenId, jumlahHalaman);
  const { sumber } = usePramuatHalaman(dokumenId, halaman, jumlahHalaman, siap && status === 'siap');
  const src = sumber(halaman, percobaan);
  const satuanJudul = satuan === 'slide' ? 'Slide' : 'Halaman';
  const pindah = (ke: number) => setHalaman(Math.min(Math.max(1, ke), jumlahHalaman));

  // Isian "Ke slide": dikirim lewat Enter atau saat fokus keluar; nilai di luar rentang dijepit, isian kosong dibatalkan.
  const [isian, setIsian] = useState<string | null>(null);
  const kirimIsian = () => {
    const n = Math.trunc(Number(isian));
    if (isian !== null && isian.trim() !== '' && Number.isFinite(n)) pindah(n);
    setIsian(null);
  };
  const akarRef = useRef<HTMLDivElement>(null);

  // Panah kiri/kanan, Home, End membalik halaman. Hanya bila fokus ada di penampil ini (bukan di dialog di atasnya,
  // bukan di isian angka yang memakai panah untuk kursor).
  useEffect(() => {
    if (jumlahHalaman <= 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const ke = e.key === 'ArrowLeft' ? 'mundur' : e.key === 'ArrowRight' ? 'maju' : e.key === 'Home' ? 'awal' : e.key === 'End' ? 'akhir' : null;
      if (!ke) return;
      const target = e.target;
      if (target instanceof HTMLElement && target.closest('input, select, textarea, [contenteditable]')) return;
      const dialog = akarRef.current?.closest('dialog');
      if (!dialog) return;
      const terbuka = Array.from(document.querySelectorAll('dialog[open]'));
      if (terbuka.length > 0 && terbuka[terbuka.length - 1] !== dialog) return;
      if (target instanceof Node && target !== document.body && target !== document.documentElement && !dialog.contains(target)) return;
      e.preventDefault();
      setHalaman(h => Math.min(Math.max(1, ke === 'mundur' ? h - 1 : ke === 'maju' ? h + 1 : ke === 'awal' ? 1 : jumlahHalaman), jumlahHalaman));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [jumlahHalaman]);

  const kaki = (
    <div className={styles.kaki}>
      {siap && (
        <div className={styles.nav}>
          <Tombol varian="sekunder" ikon={ChevronLeft} onClick={() => pindah(halaman - 1)} disabled={halaman <= 1}>
            Sebelumnya
          </Tombol>
          <form
            className={styles.lompat}
            onSubmit={(e: FormEvent) => { e.preventDefault(); kirimIsian(); }}
          >
            <label htmlFor={idLompat} className={styles.lompatLabel}>Ke {satuan}</label>
            <input
              id={idLompat}
              type="number"
              inputMode="numeric"
              enterKeyHint="go"
              min={1}
              max={jumlahHalaman}
              className={styles.lompatIsian}
              value={isian ?? String(halaman)}
              onChange={e => setIsian(e.target.value)}
              onFocus={e => e.target.select()}
              onBlur={kirimIsian}
            />
            <span className={styles.lompatDari}>dari {jumlahHalaman}</span>
          </form>
          <Tombol varian="sekunder" ikonAkhir={ChevronRight} onClick={() => pindah(halaman + 1)} disabled={halaman >= jumlahHalaman} data-autofocus="">
            Berikutnya
          </Tombol>
        </div>
      )}
      {onMinat && (
        <Tombol varian="utama" ikon={Mail} onClick={onMinat} className={styles.minat}>Ajukan minat</Tombol>
      )}
    </div>
  );

  return (
    <KerangkaModal
      terbuka
      varian="dialog"
      onTutup={onTutup}
      lebarMaks={kategori === 'Peta Potensi' ? 1200 : 960}
      penuhDiHp
      judul={judul || 'Dokumen investasi'}
      labelTutup="Tutup penampil dokumen"
      deskripsi={
        <span className={styles.peringatan}>
          <Info size={14} aria-hidden="true" />
          Hanya lihat (unduh dinonaktifkan)
        </span>
      }
      kaki={siap || onMinat ? kaki : undefined}
    >
      {/* Klik kanan dimatikan sebagai penghalang tambahan; perlindungan sebenarnya ada di watermark dan batas laju server. */}
      <div ref={akarRef} className={styles.badan} role="presentation" onContextMenu={e => e.preventDefault()}>
        {!siap ? (
          <div className={styles.kosong}>
            <FileText size={48} aria-hidden="true" />
            <p>Dokumen ini sedang diproses.</p>
            {kontakEmail && <a href={`mailto:${kontakEmail}`}>Hubungi DPMPTSP untuk informasi lebih lanjut</a>}
          </div>
        ) : (
          <>
            <p className="sr-only" role="status" aria-live="polite">{satuanJudul} {halaman} dari {jumlahHalaman}</p>
            <div className={styles.halaman} aria-busy={status === 'memuat'}>
              {status === 'memuat' && <span className={styles.memuat} role="status">Memuat {satuan} {halaman}…</span>}
              {status === 'gagal' ? (
                <div className={styles.gagal} role="alert">
                  <p>{satuanJudul} {halaman} belum dapat dimuat.</p>
                  <Tombol varian="sekunder" ikon={RefreshCw} onClick={() => setPercobaan(n => n + 1)}>Coba lagi</Tombol>
                </div>
              ) : (
                <>
                  {status === 'memuat' && terakhir && terakhir.halaman !== halaman && (
                    <div className={styles.kotak}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- gambar lama bertahan sampai yang baru siap */}
                      <img src={terakhir.src} alt="" className={styles.gambar} draggable={false} />
                      <LapisanTautan tautan={tautanPerHalaman.get(terakhir.halaman) ?? []} satuan={satuan} onLompat={pindah} />
                    </div>
                  )}
                  <div className={styles.kotak} data-status={status}>
                    {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions -- gambar berwatermark dinamis (next/image tidak berlaku); onError memunculkan coba ulang */}
                    <img
                      key={kunci}
                      ref={el => { if (el && status === 'memuat' && el.complete && el.naturalWidth > 0) setHasil({ kunci, status: 'siap' }); }}
                      src={src}
                      alt={`${judul}, ${satuan} ${halaman} dari ${jumlahHalaman}`}
                      className={styles.gambar}
                      data-status={status}
                      draggable={false}
                      onLoad={() => { setHasil({ kunci, status: 'siap' }); setTerakhir({ halaman, src }); }}
                      onError={() => setHasil({ kunci, status: 'gagal' })}
                    />
                    {status === 'siap' && <LapisanTautan tautan={tautanPerHalaman.get(halaman) ?? []} satuan={satuan} onLompat={pindah} />}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </KerangkaModal>
  );
}
