'use client';

// Tab saringan status antrean (Aktif / Selesai / Semua). Nilainya hidup di URL lewat useFilterAntrian; komponen ini
// hanya menampilkan dan meneruskan pilihan. `ID_TAB_STATUS` menghubungkan tab ini dengan PanelTab pembungkus isi daftar.
import Tab from '@/components/ui/Tab';
import type { FilterStatus } from '../antrianUrl';
import styles from '../antrian.module.css';

export const ID_TAB_STATUS = 'antrian-status';

export const LABEL_FILTER: Record<FilterStatus, string> = { aktif: 'Aktif', selesai: 'Selesai', semua: 'Semua' };

const TAB_STATUS = (Object.keys(LABEL_FILTER) as FilterStatus[]).map((kunci) => ({ kunci, label: LABEL_FILTER[kunci] }));

export interface FilterAntrianProps {
  aktif: FilterStatus;
  onGanti: (kunci: string) => void;
}

export default function FilterAntrian({ aktif, onGanti }: FilterAntrianProps) {
  return (
    <div className={styles.alatTabel}>
      <Tab id={ID_TAB_STATUS} label="Saringan status antrean" aktif={aktif} onGanti={onGanti} tab={TAB_STATUS} />
    </div>
  );
}
