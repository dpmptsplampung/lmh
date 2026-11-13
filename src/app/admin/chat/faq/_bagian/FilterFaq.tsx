// Bilah alat Kelola FAQ (refaktor G8, tugas 8.2): cari, cakupan, status, dan tombol Tambah. Hanya tampilan.
import { Plus, Search } from 'lucide-react';
import Tombol from '@/components/ui/Tombol';
import { UMUM_KEY } from '@/components/admin/faq/types';
import type { OpsiFaqLayanan } from '@/lib/faq-scope';
import { FILTER_STATUS, type FilterStatus } from '../_logika/saringFaq';
import styles from '../faq.module.css';

export interface FilterFaqProps {
  cari: string;
  onCari: (nilai: string) => void;
  /** Dropdown "Untuk" tampil hanya bila ada lebih dari satu cakupan. */
  opsiLayanan: readonly OpsiFaqLayanan[];
  cakupan: string;
  onCakupan: (nilai: string) => void;
  status: FilterStatus;
  onStatus: (nilai: FilterStatus) => void;
  onTambah: () => void;
}

export default function FilterFaq({ cari, onCari, opsiLayanan, cakupan, onCakupan, status, onStatus, onTambah }: FilterFaqProps) {
  return (
    <div className={styles.alat}>
      <div className={`form-group ${styles.alatCari}`}>
        <label className="form-label" htmlFor="cariFaq">Cari FAQ</label>
        <div className={styles.cariWadah}>
          <Search size={16} aria-hidden="true" className={styles.cariIkon} />
          <input
            id="cariFaq"
            type="search"
            className={`form-input ${styles.cariInput}`}
            placeholder="Ketik kata dari pertanyaan atau jawaban"
            value={cari}
            onChange={(e) => onCari(e.target.value)}
          />
        </div>
      </div>
      {opsiLayanan.length > 1 && (
        <div className={`form-group ${styles.alatCakupan}`}>
          <label className="form-label" htmlFor="cakupanFaq">Untuk</label>
          <select id="cakupanFaq" className="form-select" value={cakupan} onChange={(e) => onCakupan(e.target.value)}>
            <option value="">Semua FAQ</option>
            {opsiLayanan.map((o) => (
              <option key={o.id ?? UMUM_KEY} value={o.id ?? UMUM_KEY}>
                {o.id === null ? 'FAQ umum (semua layanan)' : o.nama}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="form-group">
        <span className="form-label" id="statusFaqLabel">Status</span>
        <div className={styles.kelompokStatus} role="group" aria-labelledby="statusFaqLabel">
          {FILTER_STATUS.map((s) => (
            <Tombol
              key={s.nilai}
              varian={status === s.nilai ? 'utama' : 'sekunder'}
              ukuran="kecil"
              aria-pressed={status === s.nilai}
              onClick={() => onStatus(s.nilai)}
            >
              {s.label}
            </Tombol>
          ))}
        </div>
      </div>
      <Tombol ikon={Plus} className={styles.alatTambah} onClick={onTambah}>
        Tambah pertanyaan
      </Tombol>
    </div>
  );
}
