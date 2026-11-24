import KerangkaInvestasi from '@/components/investasi/KerangkaInvestasi';
import Skeleton from '@/components/ui/Skeleton';
import styles from './gallery.module.css';

/** Keadaan memuat: kerangka tetap tampil, daftar diganti kerangka pemuatan. */
export default function MemuatGallery() {
  return (
    <KerangkaInvestasi aktif="dokumen">
      <div className={styles.isi}>
        <Skeleton bentuk="kartu" jumlah={3} label="Memuat dokumen investasi" />
      </div>
    </KerangkaInvestasi>
  );
}
