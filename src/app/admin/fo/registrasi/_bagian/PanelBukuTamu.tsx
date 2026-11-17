'use client';

// Tab "Buku Tamu" di Registrasi Pengunjung: catat tamu kantor (bukan antrean), daftar ber-filter, catat keluar, unduh.
// Hanya merakit hook dan bagian; tanpa query langsung.
import { useMemo } from 'react';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Galat from '@/components/ui/Galat';
import Kartu from '@/components/ui/Kartu';
import RoleNote from '@/components/admin/RoleNote';
import TamuForm from '@/components/admin/bukutamu/TamuForm';
import Pagination from '@/components/Pagination';
import { createClient } from '@/lib/supabase/client';
import { KUNCI_REFERENSI, muatPetugasRingkas } from '@/lib/data/referensi';
import { useReferensi } from '@/lib/data/klien/useReferensi';
import { todayWIB } from '@/lib/time';
import { petugasPilihan, ringkasanDaftar } from '../_logika/bukuTamu';
import { useBukuTamu } from '../_hook/useBukuTamu';
import { useUnduhBukuTamu } from '../_hook/useUnduhBukuTamu';
import FilterBukuTamu from './FilterBukuTamu';
import TabelBukuTamu from './TabelBukuTamu';
import UnduhBukuTamu, { CatatanUnduh } from './UnduhBukuTamu';
import styles from './bukuTamu.module.css';

export default function PanelBukuTamu() {
  const b = useBukuTamu();
  const unduh = useUnduhBukuTamu(b.filter);
  // Daftar petugas gagal dimuat = formulir tetap jalan dengan isian teks (tanpa pilihan).
  const petugas = useReferensi(KUNCI_REFERENSI.petugasRingkas, () => muatPetugasRingkas(createClient()));
  const pilihan = useMemo(() => petugasPilihan(petugas.data), [petugas.data]);

  const hariIniSaja = b.dari === todayWIB() && b.sampai === todayWIB();
  const tampilDaftar = !b.galatTanggal && !b.galatMuat;

  return (
    <div className={styles.isi}>
      <RoleNote>
        Admin dan Front Office mencatat tamu kantor di sini; ini terpisah dari antrean layanan. Daftar menampilkan semua
        tamu pada tanggal yang dipilih (bawaan: hari ini). Catat waktu keluar saat tamu pulang.
      </RoleNote>
      <Kartu as="div"><TamuForm onSubmit={b.catat} petugas={pilihan} /></Kartu>
      <Kartu judul="Daftar tamu" className={styles.daftar}>
        <FilterBukuTamu
          dari={b.dari}
          sampai={b.sampai}
          cari={b.cari}
          q={b.q}
          onRentang={b.ubahRentang}
          onCari={b.setCari}
          onHariIni={b.hariIni}
        />
        {b.galatTanggal && <p className="form-error" role="alert">{b.galatTanggal}</p>}
        <div className={styles.bilahAtas}>
          {tampilDaftar && !b.memuat ? (
            <p className={styles.ringkas} role="status">{ringkasanDaftar(b.total, b.filter)}</p>
          ) : <span />}
          <UnduhBukuTamu sedang={unduh.sedang} nonaktif={!!b.galatTanggal} onUnduh={unduh.unduh} />
        </div>
        <CatatanUnduh galat={unduh.galat} peringatan={unduh.peringatan} />
        {b.galatTanggal ? (
          <CatatanKeadaan jenis="info">Ubah tanggal untuk menampilkan daftar tamu.</CatatanKeadaan>
        ) : b.galatMuat && !b.memuat ? (
          <Galat pesan={b.galatMuat} onRetry={b.muatUlang} />
        ) : (
          <TabelBukuTamu
            items={b.items}
            memuat={b.memuat}
            adaCari={!!b.q}
            hariIniSaja={hariIniSaja}
            sedangKeluar={b.sedangKeluar}
            onCatatKeluar={b.catatKeluar}
          />
        )}
        {tampilDaftar && !b.memuat && b.items.length > 0 && (
          <Pagination page={b.page} pageSize={b.batas} total={b.total} onPageChange={b.setPage} />
        )}
      </Kartu>
    </div>
  );
}
