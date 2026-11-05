import type { PanggilanLayar } from './usePanggilanLayar';
import styles from './elemen.module.css';

/** Riwayat visual dari feed yang sama; hanya pita utama mengumumkan panggilan. */
export default function PanggilanTerakhir({ riwayat, namaLayanan }: {
  riwayat: PanggilanLayar[];
  namaLayanan: (id: string) => string | undefined;
}) {
  return (
    <aside className={styles.terakhir} aria-label="Panggilan terakhir hari ini" data-testid="panggilan-terakhir">
      <h2 className={styles.terakhirJudul}>Panggilan terakhir</h2>
      <ol className={styles.terakhirDaftar}>
        {riwayat.slice(0, 4).map(p => (
          <li key={p.id} className={styles.terakhirItem}>
            <strong className={styles.terakhirNomor}>{p.nomor_display}</strong>
            <span className={styles.terakhirNama}>{namaLayanan(p.layanan_id) ?? p.label ?? 'Layanan'}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
