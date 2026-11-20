'use client';

import { Plus } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import IsiHalaman from '@/components/layout/IsiHalaman';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import Galat from '@/components/ui/Galat';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import { adaSaringan, jumlahHalaman, ringkasanRentang } from './DaftarIpro/_logika/daftar';
import { useDaftarIpro } from './DaftarIpro/_hook/useDaftarIpro';
import SaringanIpro from './DaftarIpro/_bagian/SaringanIpro';
import TabelIpro from './DaftarIpro/_bagian/TabelIpro';
import { HREF_DAFTAR_IPRO, type BasisIpro } from './FormIpro/_logika/rute';
import styles from './DaftarIpro.module.css';

export default function DaftarIpro({ basis }: { basis: BasisIpro }) {
  const href = HREF_DAFTAR_IPRO[basis];
  const d = useDaftarIpro();
  const total = jumlahHalaman(d.total);
  const kosong = adaSaringan(d.saringan)
    ? <CatatanKeadaan jenis="kosong" judul="Tidak ada hasil">Tidak ada IPRO yang cocok dengan saringan ini. Ubah atau kosongkan saringan.</CatatanKeadaan>
    : <CatatanKeadaan jenis="kosong" judul="Belum ada IPRO">Mulai dengan menambah IPRO PTSP atau kartu FOILA.</CatatanKeadaan>;
  return (
    <>
      <PageHeader title="IPRO" description="Proyek investasi siap tawar milik PTSP dan kartu proyek dari FOILA.">
        <div className={styles.aksiKepala}>
          <Tombol href={`${href}/baru?sumber=ptsp`} ikon={Plus}>Tambah IPRO PTSP</Tombol>
          <Tombol href={`${href}/baru?sumber=foila`} ikon={Plus} varian="sekunder">Tambah kartu FOILA</Tombol>
        </div>
      </PageHeader>
      <IsiHalaman>
        <Kartu>
          <SaringanIpro saringan={d.saringan} onUbah={d.ubah} />
        </Kartu>
        {d.galat ? (
          <Galat pesan="Daftar IPRO belum dapat dimuat. Periksa koneksi atau hak akses Anda." onRetry={d.coba} />
        ) : (
          <Kartu padding="tanpa">
            <TabelIpro baris={d.baris} hrefDaftar={href} memuat={d.memuat} kosong={kosong} />
            {/* Daftar kosong sudah dijelaskan oleh pesan kosong di tabel: footer rentang tidak diulang. */}
            {(d.memuat || d.baris.length > 0) && <div className={styles.paginasi}>
              <p className={styles.ringkasan} aria-live="polite">{d.memuat ? 'Memuat…' : ringkasanRentang(d.halaman, d.baris.length, d.total)}</p>
              {total > 1 && (
                <nav className={styles.navHalaman} aria-label="Halaman daftar IPRO">
                  <Tombol type="button" ukuran="kecil" varian="sekunder" disabled={d.halaman <= 1 || d.memuat} onClick={() => d.setHalaman(d.halaman - 1)}>Sebelumnya</Tombol>
                  <span>Halaman {d.halaman} dari {total}</span>
                  <Tombol type="button" ukuran="kecil" varian="sekunder" disabled={d.halaman >= total || d.memuat} onClick={() => d.setHalaman(d.halaman + 1)}>Berikutnya</Tombol>
                </nav>
              )}
            </div>}
          </Kartu>
        )}
      </IsiHalaman>
    </>
  );
}
