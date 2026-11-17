'use client';

// Lihat Data baca-saja untuk Layanan TANPA formulir tetap (Pendataan Khusus; G5b). Membaca GET /api/admin/pelayanan/[tiketId]
// (diaudit server: lintas pembuat FO tercatat) dan menampilkan jawaban final berlabel terbaru serta draf bila ada.
// Tidak ada aksi ubah di sini; koreksi dan penyelesaian tetap lewat alur masing-masing.
import { useCallback, useEffect, useState } from 'react';
import KerangkaModal from '@/components/ui/KerangkaModal';
import Tombol from '@/components/ui/Tombol';
import Skeleton from '@/components/ui/Skeleton';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Lencana from '@/components/ui/Lencana';
import { formatWaktu } from '@/lib/utils';
import {
  susunDraf,
  susunJawabanFinal,
  type BarisKhusus,
  type DefinisiKhususApi,
  type DrafApi,
  type JawabanFinalApi,
} from './susunKhusus';
import styles from './LihatDataKhususModal.module.css';

interface MuatanLihatData {
  nama_pemohon: string;
  layanan_nama: string;
  dilayani_oleh_nama: string | null;
  status_tiket: string;
  khusus: JawabanFinalApi[];
  definisi_khusus: DefinisiKhususApi[];
  draf: DrafApi | null;
}

export interface LihatDataKhususModalProps {
  tiket: { id: string; nomor_display: string };
  onClose: () => void;
}

function DaftarBaris({ baris, label }: { baris: BarisKhusus[]; label: string }) {
  return (
    <dl className={styles.daftar} aria-label={label}>
      {baris.map((b) => (
        <div key={b.kunci} className={styles.baris}>
          <dt className={styles.label}>
            {b.label}
            {b.tersembunyi && <> <Lencana nada="netral">Isian disembunyikan</Lencana></>}
          </dt>
          <dd className={`${styles.nilai}${b.teks === null ? ` ${styles.kosong}` : ''}`}>{b.teks ?? 'Belum diisi'}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function LihatDataKhususModal({ tiket, onClose }: LihatDataKhususModalProps) {
  const [data, setData] = useState<MuatanLihatData | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [versi, setVersi] = useState(0);
  const muatUlang = useCallback(() => setVersi((v) => v + 1), []);

  useEffect(() => {
    let batal = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setMemuat(true);
    setGalat(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    (async () => {
      try {
        const res = await fetch(`/api/admin/pelayanan/${tiket.id}`, { cache: 'no-store' });
        const badan = await res.json().catch(() => null);
        if (batal) return;
        if (!res.ok) {
          setGalat(typeof badan?.error === 'string' ? badan.error : 'Gagal memuat data pendataan.');
        } else {
          setData({
            ...badan,
            khusus: Array.isArray(badan.khusus) ? badan.khusus : [],
            definisi_khusus: Array.isArray(badan.definisi_khusus) ? badan.definisi_khusus : [],
            draf: badan.draf ?? null,
          });
        }
      } catch {
        if (!batal) setGalat('Gagal memuat data pendataan. Periksa koneksi lalu coba lagi.');
      }
      if (!batal) setMemuat(false);
    })();
    return () => { batal = true; };
  }, [tiket.id, versi]);

  const tahap = data ? susunJawabanFinal(data.khusus) : [];
  const barisDraf = data?.draf ? susunDraf(data.draf, data.definisi_khusus) : [];
  const kosong = data !== null && tahap.length === 0 && data.draf === null;

  return (
    <KerangkaModal
      terbuka
      varian="dialog"
      lebarMaks={640}
      penuhDiHp
      judul={`Lihat Data — ${tiket.nomor_display}`}
      deskripsi={data ? `${data.nama_pemohon} · ${data.layanan_nama}` : 'Pendataan Khusus (baca-saja)'}
      labelTutup="Tutup"
      onTutup={onClose}
      kaki={<Tombol ukuran="kecil" onClick={onClose}>Tutup</Tombol>}
    >
      {memuat ? (
        <Skeleton bentuk="kartu" jumlah={1} label="Memuat data pendataan…" />
      ) : galat ? (
        <div>
          <p role="alert" className={styles.galat}>{galat}</p>
          <Tombol varian="sekunder" ukuran="kecil" onClick={muatUlang}>Coba lagi</Tombol>
        </div>
      ) : data ? (
        <>
          <p className={styles.ringkas}>
            Data Pendataan Khusus hanya dapat dibaca.
            {data.dilayani_oleh_nama ? ` Dilayani oleh ${data.dilayani_oleh_nama}.` : ''}
          </p>
          {kosong && (
            <CatatanKeadaan jenis="kosong" judul="Belum ada data pendataan">
              Belum ada jawaban Pendataan Khusus maupun draf untuk tiket ini.
            </CatatanKeadaan>
          )}
          {tahap.length > 0 && (
            <section className={styles.bagian} aria-label="Jawaban final">
              <h3 className={styles.judulBagian}>Jawaban final</h3>
              {tahap.map((t, i) => (
                <div key={t.kunci} className={styles.bagian}>
                  {tahap.length > 1 && <h4 className={styles.judulBagian}>Tahap {i + 1}</h4>}
                  <DaftarBaris baris={t.baris} label={tahap.length > 1 ? `Jawaban final tahap ${i + 1}` : 'Jawaban final'} />
                </div>
              ))}
            </section>
          )}
          {data.draf && (
            <section className={styles.bagian} aria-label="Draf">
              <h3 className={styles.judulBagian}>
                Draf <Lencana nada="peringatan">Belum final</Lencana>
              </h3>
              <p className={styles.ringkas}>Terakhir diubah {formatWaktu(data.draf.updated_at)} WIB.</p>
              {barisDraf.length > 0
                ? <DaftarBaris baris={barisDraf} label="Isi draf" />
                : <p className={styles.ringkas}>Draf kosong.</p>}
            </section>
          )}
        </>
      ) : null}
    </KerangkaModal>
  );
}
