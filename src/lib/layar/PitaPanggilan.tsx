'use client';

import type { PanggilanLayar } from './usePanggilanLayar';
import styles from './elemen.module.css';

/**
 * Pita panggilan di bagian atas layar: "Antrean OS-014, silakan ke Helpdesk OSS".
 * Wadah selalu ada (region live tetap terpasang); pita hanya ada selama panggilan ditampilkan.
 * `namaLayanan` = nama tampil layanan menurut data layar saat ini; bila layanan tidak ada di layar
 * dipakai label dari kejadian panggilan.
 */
export default function PitaPanggilan({
  panggilan,
  namaLayanan,
}: {
  panggilan: PanggilanLayar | null;
  namaLayanan: (layananId: string) => string | undefined;
}) {
  const nama = panggilan ? (namaLayanan(panggilan.layanan_id) ?? panggilan.label ?? '') : '';
  return (
    <div className={styles.pitaWadah} role="status" aria-live="polite" aria-atomic="true" data-testid="pita-panggilan">
      {panggilan && (
        <div className={styles.pita} key={panggilan.id}>
          <span>Antrean</span>{' '}
          <span className={styles.pitaNomor}>{panggilan.nomor_display}</span>{' '}
          <span>{nama ? `silakan ke ${nama}` : 'silakan ke layanan'}</span>
        </div>
      )}
    </div>
  );
}
