'use client';

import { useId } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import IsiHalaman from '@/components/layout/IsiHalaman';
import Kartu from '@/components/ui/Kartu';
import Tab, { PanelTab } from '@/components/ui/Tab';
import Skeleton from '@/components/ui/Skeleton';
import Galat from '@/components/ui/Galat';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import DialogKonfirmasi from '@/components/ui/DialogKonfirmasi';
import Tombol from '@/components/ui/Tombol';
import type { SumberIpro } from './FormIpro/_logika/nilai-form';
import { labelKekurangan } from './FormIpro/_logika/syarat';
import { HREF_DAFTAR_IPRO, type BasisIpro } from './FormIpro/_logika/rute';
import { useFormIpro, type AksiKonfirmasi } from './FormIpro/_hook/useFormIpro';
import { useGambarIpro } from './FormIpro/_hook/useGambarIpro';
import KepalaAksi from './FormIpro/_bagian/KepalaAksi';
import PesanForm from './FormIpro/_bagian/PesanForm';
import FormKartuFoila from './FormIpro/_bagian/FormKartuFoila';
import TabInformasi from './FormIpro/_bagian/TabInformasi';
import TabAngka from './FormIpro/_bagian/TabAngka';
import TabLokasi from './FormIpro/_bagian/TabLokasi';
import TabGambar from './FormIpro/_bagian/TabGambar';
import TabKontak from './FormIpro/_bagian/TabKontak';
import TabInggris from './FormIpro/_bagian/TabInggris';
import TabPratinjau from './FormIpro/_bagian/TabPratinjau';
import styles from './FormIpro.module.css';

export interface PropsFormIpro {
  /** admin = /admin/ipro, petugas = /petugas/investasi/ipro. */
  basis: BasisIpro;
  /** Kosong = proyek baru (butuh `sumberBaru`). */
  id?: string;
  sumberBaru?: SumberIpro;
}

const TAB_PTSP = [
  { kunci: 'informasi', label: 'Informasi' }, { kunci: 'angka', label: 'Angka' }, { kunci: 'lokasi', label: 'Lokasi' },
  { kunci: 'gambar', label: 'Gambar' }, { kunci: 'kontak', label: 'Dokumen & Kontak' },
  { kunci: 'inggris', label: 'Bahasa Inggris' }, { kunci: 'pratinjau', label: 'Pratinjau' },
];
const TAB_FOILA = [{ kunci: 'informasi', label: 'Kartu' }, { kunci: 'gambar', label: 'Gambar' }, { kunci: 'pratinjau', label: 'Pratinjau' }];

const KONFIRMASI: Record<AksiKonfirmasi, { judul: string; deskripsi: string; setuju: string; bahaya?: boolean }> = {
  terbit: { judul: 'Terbitkan IPRO ini?', deskripsi: 'IPRO akan tampil di halaman Investasi publik. Sistem memeriksa kelengkapan sebelum menerbitkan.', setuju: 'Terbitkan' },
  arsip: { judul: 'Arsipkan IPRO ini?', deskripsi: 'IPRO tidak lagi tampil di halaman publik. Alamat dan riwayat pesan tetap tersimpan, dan bisa dikembalikan ke draf.', setuju: 'Arsipkan' },
  kembali_draf: { judul: 'Kembalikan ke draf?', deskripsi: 'IPRO tidak lagi tampil di halaman publik sampai diterbitkan kembali.', setuju: 'Kembalikan ke draf' },
  hapus: { judul: 'Hapus draf ini?', deskripsi: 'Draf dan gambarnya dihapus permanen. Hanya draf yang bisa dihapus; tindakan ini tidak dapat dibatalkan.', setuju: 'Hapus draf', bahaya: true },
};

export default function FormIpro({ basis, id, sumberBaru }: PropsFormIpro) {
  const hrefDaftar = HREF_DAFTAR_IPRO[basis];
  const idTab = useId();
  const f = useFormIpro({ hrefDaftar, id, sumberBaru });
  const gambarOp = useGambarIpro(f.proyek?.id ?? null, f.gambar, f.segarkan, f.tangani);
  const foila = f.sumber === 'foila';
  const judulHalaman = f.proyek ? f.proyek.judul : foila ? 'Tambah kartu FOILA' : 'Tambah IPRO PTSP';
  const kembali = { href: hrefDaftar, label: 'Daftar IPRO' };

  if (f.tahap === 'memuat') {
    return <><PageHeader title="Memuat IPRO" kembali={kembali} /><IsiHalaman><Skeleton bentuk="kartu" label="Memuat IPRO…" /></IsiHalaman></>;
  }
  if (f.tahap === 'galat') {
    return (
      <><PageHeader title="IPRO" kembali={kembali} />
        <IsiHalaman><Galat pesan="IPRO belum dapat dimuat. Periksa koneksi atau hak akses Anda." onRetry={f.muatUlang} /></IsiHalaman></>
    );
  }
  if (f.tahap === 'tidakAda') {
    return (
      <><PageHeader title="IPRO tidak ditemukan" kembali={kembali} />
        <IsiHalaman><CatatanKeadaan jenis="kosong" judul="IPRO tidak ditemukan"
          aksi={<Tombol href={hrefDaftar} varian="sekunder">Kembali ke daftar</Tombol>}>
          Data mungkin sudah dihapus atau alamatnya salah.</CatatanKeadaan></IsiHalaman></>
    );
  }

  const isian = { nilai: f.nilai, galat: f.galatField, ubah: f.ubah, nonaktif: f.sedang !== null };
  const aktif = foila && !['informasi', 'gambar', 'pratinjau'].includes(f.tab) ? 'informasi' : f.tab;
  const kurang = f.proyek?.status === 'draf' && f.kurangKlien.length > 0 ? labelKekurangan(f.kurangKlien) : [];
  const dialog = f.konfirmasi ? KONFIRMASI[f.konfirmasi] : null;

  return (
    <>
      <PageHeader title={judulHalaman} kembali={kembali}
        description={foila ? 'Kartu proyek dari FOILA: hanya cuplikan dan tautan keluar.' : 'Proyek investasi siap tawar (IPRO) milik PTSP.'} />
      <IsiHalaman>
        <Kartu padding="normal">
          <KepalaAksi proyek={f.proyek} sumber={f.sumber} kotor={f.kotor} sedang={f.sedang} onSimpan={() => void f.simpan()} onAksi={f.setKonfirmasi} />
          <PesanForm pesan={f.pesan} konflik={f.konflik} kekurangan={f.kekurangan} onMuatUlang={f.muatUlang} />
          {kurang.length > 0 && (
            <div className={styles.info} aria-label="Kelengkapan untuk terbit">
              <p>Sebelum diterbitkan:</p>
              <ul>{kurang.map((k) => <li key={k}>{k}</li>)}</ul>
            </div>
          )}
        </Kartu>
        <Kartu padding="normal">
          <Tab id={idTab} label="Bagian formulir IPRO" tab={foila ? TAB_FOILA : TAB_PTSP} aktif={aktif} onGanti={f.setTab} />
          <div className={styles.panel}>
            <PanelTab idTab={idTab} kunci="informasi" aktif={aktif}>
              {foila ? <FormKartuFoila {...isian} /> : <TabInformasi {...isian} />}
            </PanelTab>
            <PanelTab idTab={idTab} kunci="angka" aktif={aktif}><TabAngka {...isian} /></PanelTab>
            <PanelTab idTab={idTab} kunci="lokasi" aktif={aktif}><TabLokasi {...isian} /></PanelTab>
            <PanelTab idTab={idTab} kunci="gambar" aktif={aktif}>
              <TabGambar sumber={f.sumber} proyekId={f.proyek?.id ?? null} gambar={f.gambar} op={gambarOp} />
            </PanelTab>
            <PanelTab idTab={idTab} kunci="kontak" aktif={aktif}><TabKontak {...isian} dokumen={f.dokumen} /></PanelTab>
            <PanelTab idTab={idTab} kunci="inggris" aktif={aktif}><TabInggris {...isian} /></PanelTab>
            <PanelTab idTab={idTab} kunci="pratinjau" aktif={aktif}><TabPratinjau nilai={f.nilai} sumber={f.sumber} gambar={f.gambar} /></PanelTab>
          </div>
        </Kartu>
      </IsiHalaman>
      <DialogKonfirmasi terbuka={!!dialog} judul={dialog?.judul ?? ''} deskripsi={dialog?.deskripsi} labelSetuju={dialog?.setuju}
        berbahaya={dialog?.bahaya} memuat={f.sedang === 'status'} onBatal={() => f.setKonfirmasi(null)} onSetuju={() => void f.jalankanKonfirmasi()} />
    </>
  );
}
