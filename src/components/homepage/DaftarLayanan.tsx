'use client';

// Blok "Cari dan daftar layanan": judul (memuat jumlah kartu yang dihitung dari data), kolom pencarian,
// dan kartu layanan. Kartu = artikel dengan nama sebagai tombol (area klik dibentangkan lewat CSS) yang
// membuka popup; tidak ada kartu cadangan: daftar kosong hanya menampilkan keterangan.
import { useId, useMemo, useState, type ElementType } from 'react';
import { Building2, ClipboardCheck, FileText, HeartHandshake, Search, Shield, Sparkles, Store } from 'lucide-react';
import { judulLayanan } from '@/lib/homepage/blok';
import { ikonKartu, type LayananEtalase, type StatusHariIni } from '@/lib/homepage/data';
import { ringkasStatus } from '@/lib/homepage/status';
import landing from '@/app/landing.module.css';
import styles from './Homepage.module.css';

const IKON: Record<string, ElementType> = { ClipboardCheck, Shield, HeartHandshake, Store, FileText, Building2, Sparkles };

interface Props {
  layanan: LayananEtalase[];
  status: Map<string, StatusHariIni> | null;
  teks: Record<string, string>;
  /** Dipanggil dengan slug layanan saat kartu diklik. */
  onBuka: (slug: string) => void;
}

const cocok = (l: LayananEtalase, q: string): boolean =>
  [l.nama, l.instansi ?? '', l.instansiSingkatan ?? '', l.deskripsi ?? ''].some((t) => t.toLowerCase().includes(q));

export default function DaftarLayanan({ layanan, status, teks, onBuka }: Props) {
  const [kueri, setKueri] = useState('');
  const idCari = useId();
  const q = kueri.trim().toLowerCase();
  const tampil = useMemo(() => (q ? layanan.filter((l) => cocok(l, q)) : layanan), [layanan, q]);

  return (
    <section id="layanan" className={landing.services}>
      <div className={landing.sectionHeader}>
        {teks.label && <p className={landing.sectionLabel}>{teks.label}</p>}
        <h2 className={landing.sectionTitle}>{judulLayanan(teks.title, layanan.length)}</h2>
        {teks.description && <p className={landing.sectionDescription}>{teks.description}</p>}
      </div>

      {layanan.length > 0 && (
        <div className={styles.cari}>
          <label htmlFor={idCari} className={styles.cariLabel}>Cari layanan</label>
          <div className={styles.cariKotak}>
            <Search size={18} aria-hidden="true" />
            <input
              id={idCari}
              type="search"
              className={styles.cariInput}
              placeholder="Ketik nama layanan atau instansi"
              value={kueri}
              onChange={(e) => setKueri(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
      )}

      {layanan.length === 0 ? (
        <p className={styles.kosong}>Daftar layanan sedang disiapkan. Silakan kembali lagi nanti.</p>
      ) : tampil.length === 0 ? (
        <p className={styles.kosong} role="status">Tidak ada layanan yang cocok dengan “{kueri.trim()}”.</p>
      ) : (
        <div className={landing.serviceGrid}>
          {tampil.map((l) => {
            const { ikon, warna } = ikonKartu(l.slug);
            const Ikon = IKON[ikon] ?? ClipboardCheck;
            const segera = l.statusTampilan === 'coming_soon';
            const ringkas = segera ? null : ringkasStatus(status?.get(l.id));
            return (
              <article key={l.id} className={`${landing.serviceCard} ${styles.kartu}`}>
                <div className={`${landing.serviceIcon} ${landing[warna]}`}>
                  <Ikon size={28} aria-hidden="true" />
                </div>
                <h3 className={landing.serviceTitle}>
                  <button type="button" className={styles.kartuTombol} aria-haspopup="dialog" onClick={() => onBuka(l.slug)}>
                    {l.nama}
                  </button>
                </h3>
                {l.instansi && <p className={styles.kartuInstansi}>{l.instansiSingkatan ?? l.instansi}</p>}
                {l.deskripsi && <p className={`${landing.serviceDescription} ${styles.kartuDeskripsi}`}>{l.deskripsi}</p>}
                {segera && <p className={`${styles.chip} ${styles.chipSegera}`}>Segera hadir</p>}
                {ringkas && <p className={`${styles.chip} ${styles[`chip_${ringkas.nada}`]}`}>{ringkas.teks}</p>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
