'use client';

// Popup rincian layanan di etalase homepage. Dialog modal aksesibel (role=dialog + aria-modal + judul terhubung,
// Esc menutup, focus trap, fokus kembali ke pemicu lewat useDialogFokus). Komponen murni: data (termasuk antrean)
// datang lewat props; alamat /?layanan=<slug> diurus pemanggil (page.tsx).
import { useEffect, useId, useRef } from 'react';
import Link from 'next/link';
import { CalendarClock, ExternalLink, Globe, MessageSquare, Users, X } from 'lucide-react';
import { useDialogFokus } from '@/components/admin/useDialogFokus';
import { barisJadwalMingguan } from '@/lib/jadwal-teks';
import type { AntreanLayanan, LayananEtalase, StatusHariIni } from '@/lib/homepage/data';
import { ringkasStatus } from '@/lib/homepage/status';
import styles from './Homepage.module.css';

interface Props {
  layanan: LayananEtalase;
  /** null = status tidak diketahui (RPC belum ada): baris status dan jadwal tidak ditampilkan. */
  status: StatusHariIni | null;
  /** undefined = sedang dimuat; null = gagal dimuat; objek = antrean saat ini. */
  antrean: AntreanLayanan | null | undefined;
  onTutup: () => void;
}

export default function LayananPopup({ layanan, status, antrean, onTutup }: Props) {
  const idDasar = useId();
  const idJudul = `${idDasar}-judul`;
  const wadah = useRef<HTMLDivElement>(null);
  useDialogFokus(true, wadah, onTutup);

  // Kunci gulir halaman di belakang dialog.
  useEffect(() => {
    const sebelumnya = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = sebelumnya;
    };
  }, []);

  const segera = layanan.statusTampilan === 'coming_soon';
  const ringkas = segera ? null : ringkasStatus(status);
  const tampilJadwal = !segera && status !== null;
  const tampilAntrean = !segera && layanan.punyaAntrean && (status === null || status.buka);
  const nama = layanan.instansi
    ? layanan.instansiSingkatan ? `${layanan.instansi} (${layanan.instansiSingkatan})` : layanan.instansi
    : null;

  return (
    <div
      className={styles.latar}
      data-testid="latar-popup"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onTutup();
      }}
    >
      <div ref={wadah} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={idJudul} className={styles.dialog}>
        <div className={styles.dialogHeader}>
          <div>
            <h2 id={idJudul} className={styles.dialogJudul}>{layanan.nama}</h2>
            {nama && <p className={styles.dialogInstansi}>{nama}</p>}
          </div>
          <button type="button" className={styles.tutup} onClick={onTutup} aria-label="Tutup">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.dialogIsi}>
          {segera && <p className={`${styles.chip} ${styles.chipSegera}`}>Segera hadir</p>}
          {ringkas && (
            <p className={`${styles.chip} ${styles[`chip_${ringkas.nada}`]}`}>{ringkas.teks}</p>
          )}

          {layanan.deskripsi && <p className={styles.deskripsi}>{layanan.deskripsi}</p>}

          {tampilAntrean && (
            <section aria-labelledby={`${idDasar}-antrean`}>
              <h3 id={`${idDasar}-antrean`} className={styles.subjudul}><Users size={16} aria-hidden="true" /> Antrean saat ini</h3>
              {antrean === undefined && <p className={styles.redup}>Memuat antrean…</p>}
              {antrean === null && <p className={styles.redup}>Antrean belum bisa dimuat.</p>}
              {antrean && antrean.antre === 0 && <p>Belum ada antrean.</p>}
              {antrean && antrean.antre > 0 && (
                <p>
                  {antrean.antre} menunggu
                  {antrean.estimasiTungguMenit > 0 ? `, perkiraan tunggu sekitar ${antrean.estimasiTungguMenit} menit.` : '.'}
                </p>
              )}
            </section>
          )}

          {tampilJadwal && (
            <section aria-labelledby={`${idDasar}-jadwal`}>
              <h3 id={`${idDasar}-jadwal`} className={styles.subjudul}><CalendarClock size={16} aria-hidden="true" /> Jadwal pelayanan</h3>
              <table className={styles.jadwal} aria-label="Jadwal mingguan">
                <tbody>
                  {barisJadwalMingguan(status.jadwal).map((b) => (
                    <tr key={b.hari}>
                      <th scope="row">{b.nama}</th>
                      <td className={b.jam ? undefined : styles.redup}>{b.jam ?? 'Tutup'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {layanan.websiteTerkait.length > 0 && (
            <section aria-labelledby={`${idDasar}-web`}>
              <h3 id={`${idDasar}-web`} className={styles.subjudul}><Globe size={16} aria-hidden="true" /> Website terkait</h3>
              <ul className={styles.daftarTautan}>
                {layanan.websiteTerkait.map((t) => (
                  <li key={`${t.label}-${t.url}`}>
                    <a href={t.url} target="_blank" rel="noopener noreferrer">
                      {t.label} <ExternalLink size={13} aria-hidden="true" />
                      <span className={styles.srOnly}> (membuka tab baru)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {layanan.punyaChat && (
            <p className={styles.tautanChat}>
              <Link href={`/chat?layanan=${encodeURIComponent(layanan.id)}`}>
                <MessageSquare size={14} aria-hidden="true" /> Tanya lewat live chat
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
