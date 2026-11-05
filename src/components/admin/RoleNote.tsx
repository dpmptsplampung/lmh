import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import styles from './RoleNote.module.css';

// Keterangan lingkup per role di atas halaman admin (RBAC Tahap 1). Tampil sebagai catatan netral, bukan galat.
export default function RoleNote({ children }: { children: React.ReactNode }) {
  return <CatatanKeadaan jenis="lingkup" className={styles.catatan}>{children}</CatatanKeadaan>;
}
