import styles from './HasilGlobal.module.css';

export default function KartuKpi({ label, nilai, satuan, catatan }: { label: string; nilai: string; satuan?: string; catatan?: string }) {
  return (
    <div className={styles.kartuKpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiNilai}>
        {nilai}
        {satuan && nilai !== '—' && <span className={styles.kpiSatuan}> {satuan}</span>}
      </span>
      {catatan && <span className={styles.kpiCatatan}>{catatan}</span>}
    </div>
  );
}
