'use client';

// A5: kartu "Perlu tindakan sekarang" di Dasbor. Daftar berurut berbobot dari lencana sidebar (useNavBadges, sudah
// disaring per peran) dan hitungan SLA pengaduan. Tanpa kueri sendiri; semua angka datang dari induk.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import Kartu from '@/components/ui/Kartu';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import { formatAngka } from '@/components/ui/format';
import type { NavBadges } from '@/lib/hooks/useNavBadges';
import styles from './PerluTindakan.module.css';

export interface SlaPengaduan {
  terlambat: number;
  mendekati: number;
}

export interface BarisTindakan {
  kunci: string;
  bobot: number;
  jumlah: number;
  teks: string;
  href: string;
  nada: NadaLencana;
}

/** Waktu tunggu (ms) sebelum daftar yang belum juga siap dinyatakan belum dapat dimuat. */
export const BATAS_MEMUAT_MS = 10_000;

const jumlahDari = (b: NavBadges, k: keyof NavBadges) => b[k]?.count ?? 0;

/** Susun baris yang jumlahnya > 0, bobot terbesar di atas. Kunci lencana yang tidak berhak bagi peran memang tidak ada. */
export function susunTindakan(badges: NavBadges, sla: SlaPengaduan | null): BarisTindakan[] {
  const baris: BarisTindakan[] = [];
  const tambah = (b: BarisTindakan) => {
    if (b.jumlah > 0) baris.push(b);
  };
  if (sla) {
    tambah({ kunci: 'sla-terlambat', bobot: 100, jumlah: sla.terlambat, teks: 'pengaduan terlambat SLA', href: '/admin/pengaduan', nada: 'bahaya' });
    tambah({ kunci: 'sla-mendekati', bobot: 90, jumlah: sla.mendekati, teks: 'pengaduan mendekati batas SLA', href: '/admin/pengaduan', nada: 'peringatan' });
  }
  tambah({ kunci: 'kotakMasukFo', bobot: 80, jumlah: jumlahDari(badges, 'kotakMasukFo'), teks: 'di Kotak Masuk FO menunggu diambil', href: '/admin/fo/kotak-masuk', nada: 'peringatan' });
  tambah({ kunci: 'liveChat', bobot: 70, jumlah: jumlahDari(badges, 'liveChat'), teks: 'chat menunggu diambil', href: '/admin/chat', nada: 'peringatan' });
  tambah({ kunci: 'pengaduan', bobot: 60, jumlah: jumlahDari(badges, 'pengaduan'), teks: 'pengaduan baru belum ditangani', href: '/admin/pengaduan', nada: 'info' });
  tambah({ kunci: 'antrian', bobot: 50, jumlah: jumlahDari(badges, 'antrian'), teks: 'tiket menunggu di antrean', href: '/admin/antrian', nada: 'info' });
  tambah({ kunci: 'penangananFo', bobot: 40, jumlah: jumlahDari(badges, 'penangananFo'), teks: 'penanganan masih berjalan', href: '/admin/fo/penanganan', nada: 'netral' });
  tambah({ kunci: 'saran', bobot: 30, jumlah: jumlahDari(badges, 'saran'), teks: 'saran belum ditinjau', href: '/admin/saran', nada: 'netral' });
  return baris.sort((a, b) => b.bobot - a.bobot);
}

interface Props {
  badges: NavBadges;
  /** null = tidak tersedia (view belum ada atau gagal dihitung): baris SLA disembunyikan, bukan dinolkan. */
  sla: SlaPengaduan | null;
  /** True selama daftar belum pernah terisi (peran belum dikenal atau lencana belum dihitung). */
  memuat: boolean;
  className?: string;
}

export default function PerluTindakan({ badges, sla, memuat, className }: Props) {
  const [terlalulama, setTerlaluLama] = useState(false);
  useEffect(() => {
    if (!memuat) return;
    const t = setTimeout(() => setTerlaluLama(true), BATAS_MEMUAT_MS);
    return () => {
      clearTimeout(t);
      setTerlaluLama(false);
    };
  }, [memuat]);

  const baris = susunTindakan(badges, sla);

  return (
    <Kartu judul="Perlu tindakan sekarang" className={className}>
      {memuat ? (
        terlalulama ? (
          <CatatanKeadaan jenis="info">Daftar ini belum dapat dimuat. Angka per menu tetap terlihat di menu samping.</CatatanKeadaan>
        ) : (
          <Skeleton bentuk="baris" jumlah={3} label="Memuat yang perlu tindakan" />
        )
      ) : baris.length === 0 ? (
        <div className={styles.baik} role="status">
          <span className={styles.ikonBaik}>
            <CheckCircle2 size={20} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div>
            <p className={styles.judulBaik}>Tidak ada yang mendesak</p>
            <p className={styles.isiBaik}>Tidak ada antrean, chat, atau pengaduan yang menunggu tindakan Anda saat ini.</p>
          </div>
        </div>
      ) : (
        <ul className={styles.daftar}>
          {baris.map((b) => (
            <li key={b.kunci}>
              <Link href={b.href} className={styles.baris}>
                <Lencana nada={b.nada} className={styles.angka}>
                  {formatAngka(b.jumlah)}
                </Lencana>
                <span className={styles.teks}>{b.teks}</span>
                <ChevronRight size={16} strokeWidth={1.75} className={styles.panah} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Kartu>
  );
}
