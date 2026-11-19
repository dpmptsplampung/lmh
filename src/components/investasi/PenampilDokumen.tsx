'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Info } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Tombol from '@/components/ui/Tombol';
import styles from './investasi.module.css';

export type PropsPenampilDokumen = {
  dokumenId: string;
  judul: string;
  /** Jumlah halaman yang sudah dirender; 0 = dokumen masih diproses. */
  jumlahHalaman: number;
  /** Email lembaga untuk dokumen yang belum siap. */
  kontakEmail?: string;
  onTutup: () => void;
};

/**
 * Penampil dokumen kajian (view-only): halaman PDF dirender server menjadi gambar ber-watermark
 * (`/api/investment-docs/page-image`). Dipasang hanya saat dibuka (induk merender bersyarat), jadi halaman selalu mulai dari 1.
 * Fokus awal, jebak fokus, Escape, dan pengembalian fokus ke pemicu dibawa Dialog.
 */
export default function PenampilDokumen({ dokumenId, judul, jumlahHalaman, kontakEmail, onTutup }: PropsPenampilDokumen) {
  const [halaman, setHalaman] = useState(1);
  const [gagalDi, setGagalDi] = useState<number | null>(null);
  const siap = jumlahHalaman > 0;

  return (
    <Dialog
      terbuka
      onTutup={onTutup}
      lebarMaks={860}
      judul={judul || 'Dokumen Investasi'}
      deskripsi={
        <span className={styles.penampilPeringatan}>
          <Info size={12} aria-hidden="true" />
          View-only (Unduh dinonaktifkan)
        </span>
      }
    >
      {/* Klik kanan dimatikan sebagai penghalang tambahan; perlindungan sebenarnya ada di watermark dan batas laju server. */}
      <div className={styles.penampilBadan} role="presentation" onContextMenu={e => e.preventDefault()}>
        {!siap ? (
          <div className={styles.penampilKosong}>
            <FileText size={48} aria-hidden="true" />
            <p>Dokumen ini sedang diproses.</p>
            {kontakEmail && <a href={`mailto:${kontakEmail}`}>Hubungi admin untuk informasi lebih lanjut</a>}
          </div>
        ) : (
          <>
            <div className={styles.penampilHalaman}>
              <span className={styles.penampilTanda} aria-hidden="true">DPMPTSP PROV LAMPUNG — DILINDUNGI</span>
              {gagalDi === halaman ? (
                <p className={styles.penampilGagal} role="alert">Halaman ini belum dapat dimuat. Coba halaman lain atau muat ulang.</p>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions -- PNG berwatermark dinamis (next/image tidak berlaku); onError hanya memunculkan pesan galat
                <img
                  key={halaman}
                  src={`/api/investment-docs/page-image?doc_id=${dokumenId}&page=${halaman}`}
                  alt={`Halaman ${halaman} dari ${jumlahHalaman}`}
                  className={styles.penampilGambar}
                  draggable={false}
                  onError={() => setGagalDi(halaman)}
                />
              )}
            </div>
            <div className={styles.penampilNav}>
              <Tombol varian="sekunder" ukuran="kecil" ikon={ChevronLeft} onClick={() => setHalaman(p => Math.max(1, p - 1))} disabled={halaman <= 1}>
                Sebelumnya
              </Tombol>
              <span className={styles.penampilNomor}>Halaman {halaman} dari {jumlahHalaman}</span>
              <Tombol varian="sekunder" ukuran="kecil" ikonAkhir={ChevronRight} onClick={() => setHalaman(p => Math.min(jumlahHalaman, p + 1))} disabled={halaman >= jumlahHalaman}>
                Berikutnya
              </Tombol>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
