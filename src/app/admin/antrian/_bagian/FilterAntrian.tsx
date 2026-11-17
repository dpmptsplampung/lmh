'use client';

// Tab saringan status antrean (Aktif / Selesai / Semua) dan, khusus Admin/Front Office, pilihan Layanan. Nilainya hidup
// di URL lewat useFilterAntrian; komponen ini hanya menampilkan dan meneruskan pilihan. `ID_TAB_STATUS` menghubungkan
// tab ini dengan PanelTab pembungkus isi daftar.
import Field from '@/components/ui/Field';
import Tab from '@/components/ui/Tab';
import type { FilterStatus } from '../antrianUrl';
import styles from '../antrian.module.css';

export const ID_TAB_STATUS = 'antrian-status';

export const LABEL_FILTER: Record<FilterStatus, string> = { aktif: 'Aktif', selesai: 'Selesai', semua: 'Semua' };

const TAB_STATUS = (Object.keys(LABEL_FILTER) as FilterStatus[]).map((kunci) => ({ kunci, label: LABEL_FILTER[kunci] }));

/** Pilihan Layanan (hanya Admin/Front Office; Petugas selalu melihat seluruh Layanannya, tanpa pilihan). */
export interface SaringanLayanan {
  /** Id Layanan terpilih; null = semua Layanan. */
  nilai: string | null;
  opsi: ReadonlyArray<{ id: string; nama: string }>;
  onGanti: (id: string | null) => void;
}

export interface FilterAntrianProps {
  aktif: FilterStatus;
  onGanti: (kunci: string) => void;
  /** Tanpa ini (Petugas) pilihan Layanan tidak tampil. */
  layanan?: SaringanLayanan | null;
}

export default function FilterAntrian({ aktif, onGanti, layanan }: FilterAntrianProps) {
  return (
    <div className={styles.alatTabel}>
      <Tab id={ID_TAB_STATUS} label="Saringan status antrean" aktif={aktif} onGanti={onGanti} tab={TAB_STATUS} />
      {layanan && (
        <Field label="Layanan">
          <select value={layanan.nilai ?? ''} onChange={(e) => layanan.onGanti(e.target.value || null)}>
            <option value="">Semua layanan</option>
            {layanan.opsi.map((o) => (
              <option key={o.id} value={o.id}>{o.nama}</option>
            ))}
          </select>
        </Field>
      )}
    </div>
  );
}
