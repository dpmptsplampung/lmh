'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import FotoUmkm from '@/components/umkm/FotoUmkm';
import type { FotoInput } from '@/lib/umkm-katalog/schemas';
import { validasiUrlFoto } from '@/lib/umkm/foto-url';
import styles from './umkm-form.module.css';

export type PratinjauFoto = { src?: string | null; tersembunyi?: boolean };

type Props = {
  nilai: FotoInput[];
  onUbah: (n: FotoInput[]) => void;
  /** Mengunggah berkas ke penyimpanan privat dan mengembalikan foto yang siap dikirim. */
  unggah: (berkas: File) => Promise<FotoInput>;
  maks: number;
  pilihUtama: boolean;
  label: string;
  /** Sumber tampilan foto yang sudah tersimpan (foto unggahan privat tidak punya tautan sendiri). */
  pratinjau?: (foto: FotoInput) => PratinjauFoto | undefined;
  /** Asal foto yang ditambah lewat tautan; satudata hanya untuk petugas. */
  asalTautan?: 'eksternal' | 'satudata';
  nonaktif?: boolean;
};

const MIME = ['image/jpeg', 'image/png', 'image/webp'];

export default function PemilihFoto({
  nilai, onUbah, unggah, maks, pilihUtama, label, pratinjau, asalTautan = 'eksternal', nonaktif,
}: Props) {
  const idTab = useId();
  const [tab, setTab] = useState<'unggah' | 'tautan'>('unggah');
  const [mengunggah, setMengunggah] = useState(false);
  const [galat, setGalat] = useState('');
  const [tautan, setTautan] = useState('');
  const permintaan = useRef(0);
  // Hasil unggahan datang belakangan: pakai daftar dan callback terbaru, bukan yang tertangkap saat berkas dipilih.
  const terbaru = useRef({ nilai, onUbah });
  const terpasang = useRef(true);
  useLayoutEffect(() => { terbaru.current = { nilai, onUbah }; });
  useEffect(() => {
    terpasang.current = true;
    return () => { terpasang.current = false; };
  }, []);
  const akar = useRef<HTMLFieldSetElement>(null);
  const fokusSetelahHapus = useRef<number | null>(null);
  const penuh = nilai.length >= maks;
  const mati = nonaktif || penuh;

  const tambah = (foto: FotoInput) => onUbah([...nilai, foto]);

  const pilihBerkas = async (berkas?: File) => {
    if (!berkas || mati) return;
    const giliran = ++permintaan.current;
    setMengunggah(true); setGalat('');
    try {
      if (!MIME.includes(berkas.type)) throw new Error('Pilih foto JPEG, PNG, atau WebP.');
      const foto = await unggah(berkas);
      if (!terpasang.current) return;
      const sekarang = terbaru.current;
      if (sekarang.nilai.length >= maks) setGalat(`Maksimal ${maks} foto.`);
      else if (giliran === permintaan.current) sekarang.onUbah([...sekarang.nilai, foto]);
    } catch (e) {
      if (giliran === permintaan.current) setGalat(e instanceof Error ? e.message : 'Foto belum berhasil diunggah.');
    } finally {
      if (giliran === permintaan.current) setMengunggah(false);
    }
  };

  const tambahTautan = () => {
    if (mati) return;
    const hasil = validasiUrlFoto(tautan);
    if (!hasil.ok) { setGalat(hasil.alasan); return; }
    setGalat(''); setTautan('');
    tambah({ asal: asalTautan, url: hasil.url });
  };

  const jadikanUtama = (indeks: number) =>
    onUbah(nilai.map((f, i) => {
      const salin = { ...f };
      if (i === indeks) salin.utama = true; else delete salin.utama;
      return salin;
    }));

  const keluarkan = (indeks: number) => {
    fokusSetelahHapus.current = indeks;
    onUbah(nilai.filter((_, i) => i !== indeks));
  };

  // Fokus keyboard tidak boleh hilang saat foto dikeluarkan: pindah ke foto di sekitarnya, atau ke tab.
  useLayoutEffect(() => {
    const indeks = fokusSetelahHapus.current;
    if (indeks === null) return;
    fokusSetelahHapus.current = null;
    const tombol = akar.current?.querySelectorAll<HTMLButtonElement>('[aria-label^="Keluarkan foto "]');
    const sasaran = tombol && tombol.length > 0
      ? tombol[Math.min(indeks, tombol.length - 1)]
      : akar.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    sasaran?.focus();
  }, [nilai]);

  return <fieldset ref={akar} className={styles.foto}>
    <legend>{label}</legend>
    <div role="tablist" aria-label={`Cara menambah ${label.toLowerCase()}`} className={styles.tab}>
      {(['unggah', 'tautan'] as const).map((t) => (
        <button key={t} type="button" role="tab" id={`${idTab}-${t}`} aria-selected={tab === t}
          aria-controls={`${idTab}-panel`} onClick={() => setTab(t)}>
          {t === 'unggah' ? 'Unggah' : 'Tautan'}
        </button>
      ))}
    </div>
    <div role="tabpanel" id={`${idTab}-panel`} aria-labelledby={`${idTab}-${tab}`}>
      {tab === 'unggah'
        ? <Field label="Unggah foto" bantuan="JPEG, PNG, atau WebP. Foto disimpan privat sampai petugas memeriksa.">
          <input type="file" accept={MIME.join(',')} disabled={mati || mengunggah}
            onChange={(e) => { void pilihBerkas(e.target.files?.[0]); e.target.value = ''; }} />
        </Field>
        : <div className={styles.baris}>
          <Field label="Tambah tautan foto HTTPS">
            <input type="url" value={tautan} maxLength={500} disabled={mati}
              onChange={(e) => setTautan(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); tambahTautan(); } }} />
          </Field>
          <Tombol varian="sekunder" disabled={mati || !tautan.trim()} onClick={tambahTautan}>Tambah tautan</Tombol>
        </div>}
    </div>
    {mengunggah && <p role="status" className={styles.catatan}>Mengunggah foto...</p>}
    {penuh && <p className={styles.catatan}>Maksimal {maks} foto.</p>}
    {galat && <p role="alert" className={styles.galat}>{galat}</p>}
    {nilai.length === 0
      ? <p className={styles.catatan}>Belum ada foto.</p>
      : <ul className={styles.daftarFoto}>
        {nilai.map((foto, i) => {
          const info = pratinjau?.(foto);
          const src = info?.src ?? (foto.asal === 'unggahan' ? null : foto.url);
          const idCap = `${idTab}-cap-${i}`;
          return <li key={`${foto.url ?? foto.r2_key}:${i}`}>
            <figure>
              {src
                ? <FotoUmkm src={src} alt={`Foto ${i + 1}`} width={160} height={120} style={{ width: '100%' }} />
                : <p className={styles.catatan}>Foto unggahan baru {i + 1}</p>}
              <figcaption id={idCap}>
                Foto {i + 1}{info?.tersembunyi ? ', disembunyikan' : ''}
                {foto.utama && <> <span className={styles.lencana}>Foto utama</span></>}
              </figcaption>
              {pilihUtama && !foto.utama && <Tombol varian="sekunder" aria-describedby={idCap} disabled={nonaktif}
                onClick={() => jadikanUtama(i)}>Jadikan foto utama</Tombol>}
              <Tombol varian="sekunder" aria-label={`Keluarkan foto ${i + 1}`} disabled={nonaktif}
                onClick={() => keluarkan(i)}>Keluarkan</Tombol>
            </figure>
          </li>;
        })}
      </ul>}
  </fieldset>;
}
