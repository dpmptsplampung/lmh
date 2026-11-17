'use client';

// Wizard Mulai Layanan dua langkah (G5; KONTRAK keputusan 9). Dibuka setelah `layanan_mulai` berhasil, atau dari baris
// antrean lewat tombol "Isi Pendataan" (langkahAwal 2).
//   Langkah 1 "Data dari Front Office": baca-saja (identitas, keperluan/catatan eskalasi, pencatat, jam daftar).
//   Langkah 2: layanan berformulir tetap (OSS/Non OSS) -> wizard formulir yang ada (onLanjutForm); layanan lain -> isian
//   Pendataan Khusus aktif dengan simpan otomatis ke draf. Layanan tanpa isian aktif melompati langkah 2.
// "Tutup, lanjut melayani" menyimpan draf lebih dulu dan mempertahankannya; menutup dengan gagal simpan meminta penegasan.
// Pemanggil memasang komponen dengan `key={tiket.id}` agar state bersih per tiket.
import { useState } from 'react';
import KerangkaModal from '@/components/ui/KerangkaModal';
import Tombol from '@/components/ui/Tombol';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import LangkahDataFo from './LangkahDataFo';
import LangkahPendataan from './LangkahPendataan';
import { useDrafKhusus } from './useDrafKhusus';
import { useDataDariFo, useDefinisiKhusus } from './useDataLangkah';
import styles from './MulaiLayanan.module.css';

export interface TiketMulaiLayanan {
  id: string;
  nomor_display: string;
  layanan_id: string;
  /** Layanan berformulir tetap (OSS/Non OSS): langkah 2 = wizard formulir yang sudah ada. */
  berFormulir: boolean;
}

interface Props {
  tiket: TiketMulaiLayanan;
  langkahAwal?: 1 | 2;
  /** Hanya pemilik tiket (dilayani_oleh = pengguna) yang boleh mengisi; selain itu baca-saja. */
  bolehUbah: boolean;
  onClose: () => void;
  /** Layanan berformulir tetap: dipanggil di langkah 2; pemanggil menutup wizard ini dan membuka wizard formulir. */
  onLanjutForm: () => void;
  /** Tampilan basi (tiket berubah di tempat lain): muat ulang daftar di belakang dialog. */
  onDataBasi?: () => void | Promise<void>;
}

export default function MulaiLayananWizard({ tiket, langkahAwal = 1, bolehUbah, onClose, onLanjutForm, onDataBasi }: Props) {
  const [langkah, setLangkah] = useState<1 | 2>(langkahAwal);
  const [menutup, setMenutup] = useState(false);
  // Setelah satu kali gagal menyimpan, tombol tutup berubah menjadi "Tutup tanpa menyimpan" (penegasan, isian tetap di server lama).
  const [gagalTutup, setGagalTutup] = useState(false);
  const dataFo = useDataDariFo(tiket.id);
  const definisi = useDefinisiKhusus(tiket.layanan_id, !tiket.berFormulir);
  const adaIsian = definisi.tersedia && definisi.fields.length > 0;
  const adaLangkah2 = tiket.berFormulir || adaIsian;
  const menungguDefinisi = !tiket.berFormulir && definisi.memuat;
  const draf = useDrafKhusus({
    tiketId: tiket.id,
    fields: definisi.fields,
    aktif: langkah === 2 && !tiket.berFormulir && adaIsian,
    bolehUbah,
    onBasi: () => { void onDataBasi?.(); definisi.muatUlang(); },
  });

  const tutupSimpan = async () => {
    if (menutup) return;
    if (langkah === 2 && !tiket.berFormulir && bolehUbah && !gagalTutup) {
      setMenutup(true);
      const tersimpan = await draf.simpanSekarang();
      setMenutup(false);
      if (!tersimpan) { setGagalTutup(true); return; }
    }
    onClose();
  };

  const lanjut = () => {
    if (tiket.berFormulir) onLanjutForm();
    else if (adaIsian) setLangkah(2);
    else onClose();
  };

  const judulLangkah = langkah === 1 ? 'Data dari Front Office' : 'Pendataan Khusus';

  return (
    <KerangkaModal
      terbuka
      varian="dialog"
      lebarMaks={640}
      penuhDiHp
      judul={`Mulai layanan — ${tiket.nomor_display}`}
      deskripsi={judulLangkah}
      labelTutup="Tutup"
      onTutup={() => { void tutupSimpan(); }}
      dikunci={menutup}
      bawahKepala={adaLangkah2 ? (
        <ol className={styles.langkah} aria-label="Langkah">
          {([1, 2] as const).map((n) => (
            <li
              key={n}
              className={`${styles.langkahItem}${langkah === n ? ` ${styles.langkahAktif}` : ''}`}
              aria-current={langkah === n ? 'step' : undefined}
            >
              <span className={styles.nomorLangkah} aria-hidden="true">{n}</span>
              Langkah {n} dari 2: {n === 1 ? 'Data dari Front Office' : tiket.berFormulir ? 'Formulir pendataan' : 'Pendataan Khusus'}
            </li>
          ))}
        </ol>
      ) : undefined}
      kaki={
        langkah === 1 ? (
          <>
            {adaLangkah2 ? (
              <Tombol ukuran="kecil" onClick={lanjut} disabled={menungguDefinisi}>
                {menungguDefinisi ? 'Memuat…' : 'Lanjut'}
              </Tombol>
            ) : (
              <Tombol ukuran="kecil" onClick={() => { void tutupSimpan(); }} disabled={menungguDefinisi}>
                {menungguDefinisi ? 'Memuat…' : 'Tutup, lanjut melayani'}
              </Tombol>
            )}
          </>
        ) : (
          <>
            <Tombol varian="hantu" ukuran="kecil" onClick={() => setLangkah(1)} disabled={menutup}>Sebelumnya</Tombol>
            <Tombol ukuran="kecil" onClick={() => { void tutupSimpan(); }} disabled={menutup} memuat={menutup}>
              {gagalTutup ? 'Tutup tanpa menyimpan' : 'Tutup, lanjut melayani'}
            </Tombol>
          </>
        )
      }
    >
      {langkah === 1 ? (
        <>
          <LangkahDataFo data={dataFo.data} memuat={dataFo.memuat} galat={dataFo.galat} onMuatUlang={dataFo.muatUlang} />
          {!tiket.berFormulir && definisi.galat && (
            <p role="alert" className={styles.galat}>
              {definisi.galat} Anda tetap dapat melayani; isian Pendataan Khusus dapat dibuka dari baris antrean.
            </p>
          )}
        </>
      ) : adaIsian ? (
        <LangkahPendataan fields={definisi.fields} draf={draf} bolehUbah={bolehUbah} />
      ) : menungguDefinisi ? (
        <p className={styles.ringkas}>Memuat isian Pendataan Khusus…</p>
      ) : (
        <CatatanKeadaan jenis="info" judul="Tidak ada isian Pendataan Khusus">
          Layanan ini tidak punya isian Pendataan Khusus yang aktif. Tiket dapat langsung diselesaikan dari daftar antrean.
        </CatatanKeadaan>
      )}
    </KerangkaModal>
  );
}
