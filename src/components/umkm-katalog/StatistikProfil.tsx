import styles from './katalog.module.css';

const tepat = new Intl.NumberFormat('id-ID');
const ringkas = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

export function angkaRingkas(value: number) {
  if (value < 1000) return tepat.format(value);
  const [unit, label]: [number, string] = value >= 1e12 ? [1e12, 'triliun'] : value >= 1e9 ? [1e9, 'miliar']
    : value >= 1e6 ? [1e6, 'jt'] : [1000, 'rb'];
  return `${ringkas.format(Math.floor(value / unit * 10) / 10)} ${label}`;
}

export function AngkaStatistik({ nilai, label }: { nilai: number; label: string }) {
  return <span>
    <span aria-hidden="true">{angkaRingkas(nilai)} {label}</span>
    <span className="sr-only">{tepat.format(nilai)} {label}</span>
  </span>;
}

export default function StatistikProfil({ suka, dilihat, baru }: {
  suka: number; dilihat: number | null; baru: boolean;
}) {
  return <div className={styles.statistik}>
    {baru && <span className={styles.baru}>Baru</span>}
    <AngkaStatistik nilai={suka} label="Suka" />
    {dilihat !== null && <AngkaStatistik nilai={dilihat} label="Dilihat" />}
  </div>;
}
