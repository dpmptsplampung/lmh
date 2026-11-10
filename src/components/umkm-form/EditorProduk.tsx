'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import type { ProdukInput } from '@/lib/umkm-katalog/schemas';
import { PERIODE_KAPASITAS, SARAN_SATUAN } from '@/lib/umkm-katalog/taksonomi';
import PemilihFoto, { type PratinjauFoto } from './PemilihFoto';
import styles from './umkm-form.module.css';

const MAKS_PRODUK = 20;

type Props = {
  nilai: ProdukInput[];
  onUbah: (n: ProdukInput[]) => void;
  unggah: Parameters<typeof PemilihFoto>[0]['unggah'];
  /** Galat per isian dengan kunci `produk.<indeks>.<kolom>`. */
  galat?: Record<string, string>;
  pratinjau?: (urutan: number, foto: NonNullable<ProdukInput['foto']>) => PratinjauFoto | undefined;
  nonaktif?: boolean;
};

let penghitung = 0;
const kunciBaru = () => `produk-${++penghitung}`;

// Isian teks tak terkendali (defaultValue) dengan kunci tetap per produk, supaya mengetik angka
// seperti "1." tidak terpotong dan urutan ulang memindahkan isian bersama produknya.
export default function EditorProduk({ nilai, onUbah, unggah, galat = {}, pratinjau, nonaktif }: Props) {
  const [kunci, setKunci] = useState<string[]>(() => nilai.map(kunciBaru));
  const kunciSelaras = kunci.length === nilai.length ? kunci : nilai.map((_, i) => kunci[i] ?? kunciBaru());
  if (kunciSelaras !== kunci) setKunci(kunciSelaras);

  // Unggahan foto dan isian bisa selesai belakangan: semua perubahan memakai daftar terbaru dan
  // menunjuk produk lewat kunci tetap, bukan indeks yang tertangkap saat render lama.
  const terbaru = useRef({ nilai, kunci: kunciSelaras, onUbah });
  const akar = useRef<HTMLDivElement>(null);
  const tombolTambah = useRef<HTMLButtonElement>(null);
  const fokusSetelahHapus = useRef<number | null>(null);
  useLayoutEffect(() => { terbaru.current = { nilai, kunci: kunciSelaras, onUbah }; });
  useLayoutEffect(() => {
    const indeks = fokusSetelahHapus.current;
    if (indeks === null) return;
    fokusSetelahHapus.current = null;
    const kartu = akar.current?.querySelectorAll<HTMLElement>('[data-produk]');
    if (!kartu || kartu.length === 0) { tombolTambah.current?.focus(); return; }
    kartu[Math.max(0, Math.min(indeks - 1, kartu.length - 1))].querySelector<HTMLElement>('input')?.focus();
  }, [nilai]);

  const ubahProduk = (kunciProduk: string, bagian: Partial<ProdukInput>) => {
    const { nilai: sekarang, kunci: daftarKunci, onUbah: ubah } = terbaru.current;
    const i = daftarKunci.indexOf(kunciProduk);
    if (i < 0) return;
    ubah(sekarang.map((p, j) => (j === i ? { ...p, ...bagian } : p)));
  };
  const tambah = () => {
    const { nilai: sekarang, onUbah: ubah } = terbaru.current;
    if (sekarang.length >= MAKS_PRODUK) return;
    setKunci([...terbaru.current.kunci, kunciBaru()]);
    ubah([...sekarang, { nama: '' }]);
  };
  const hapus = (i: number) => {
    const { nilai: sekarang, kunci: daftarKunci, onUbah: ubah } = terbaru.current;
    fokusSetelahHapus.current = i;
    setKunci(daftarKunci.filter((_, j) => j !== i));
    ubah(sekarang.filter((_, j) => j !== i));
  };
  const geser = (i: number, arah: -1 | 1) => {
    const { nilai: sekarang, kunci: daftarKunci, onUbah: ubah } = terbaru.current;
    const j = i + arah;
    if (j < 0 || j >= sekarang.length) return;
    const k = [...daftarKunci]; [k[i], k[j]] = [k[j], k[i]];
    const n = [...sekarang]; [n[i], n[j]] = [n[j], n[i]];
    setKunci(k);
    ubah(n);
  };
  const g = (i: number, kolom: string) => galat[`produk.${i}.${kolom}`];

  return <div ref={akar} className={styles.produk}>
    <datalist id="saran-satuan-kapasitas">
      {SARAN_SATUAN.map((s) => <option key={s} value={s} />)}
    </datalist>
    {nilai.length === 0 && <p className={styles.catatan}>Belum ada produk. Produk membantu pembeli memahami apa yang Anda jual.</p>}
    {nilai.map((p, i) => (
      <fieldset key={kunciSelaras[i]} data-produk className={styles.kartuProduk}>
        <legend>Produk {i + 1}</legend>
        <Field label="Nama produk" galat={g(i, 'nama')}>
          <input defaultValue={p.nama} maxLength={100} disabled={nonaktif}
            onChange={(e) => ubahProduk(kunciSelaras[i], { nama: e.target.value })} />
        </Field>
        <Field label="Keterangan produk (opsional)" galat={g(i, 'keterangan')}>
          <textarea defaultValue={p.keterangan ?? ''} maxLength={500} disabled={nonaktif}
            onChange={(e) => ubahProduk(kunciSelaras[i], { keterangan: e.target.value || null })} />
        </Field>
        <div className={styles.kapasitas}>
          <Field label="Jumlah kapasitas" galat={g(i, 'kapasitas_jumlah')}
            bantuan="Kosongkan bila tidak ingin mengisi kapasitas.">
            <input type="number" inputMode="decimal" min={0} step="0.01" defaultValue={p.kapasitas_jumlah ?? ''}
              disabled={nonaktif}
              onChange={(e) => ubahProduk(kunciSelaras[i], { kapasitas_jumlah: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Satuan kapasitas" galat={g(i, 'kapasitas_satuan')}>
            <input list="saran-satuan-kapasitas" defaultValue={p.kapasitas_satuan ?? ''} maxLength={20}
              disabled={nonaktif} autoComplete="off"
              onChange={(e) => ubahProduk(kunciSelaras[i], { kapasitas_satuan: e.target.value || null })} />
          </Field>
          <Field label="Periode kapasitas" galat={g(i, 'kapasitas_periode')}>
            <select defaultValue={p.kapasitas_periode ?? ''} disabled={nonaktif}
              onChange={(e) => ubahProduk(kunciSelaras[i], {
                kapasitas_periode: (e.target.value || null) as ProdukInput['kapasitas_periode'],
              })}>
              <option value="">Pilih periode</option>
              {PERIODE_KAPASITAS.map((x) => <option key={x} value={x}>per {x}</option>)}
            </select>
          </Field>
        </div>
        <PemilihFoto label="Foto produk" maks={1} pilihUtama={false} unggah={unggah} nonaktif={nonaktif}
          nilai={p.foto ? [p.foto] : []}
          pratinjau={pratinjau && ((f) => pratinjau(i + 1, f))}
          onUbah={(n) => ubahProduk(kunciSelaras[i], { foto: n[0] ?? null })} />
        <div className={styles.aksiProduk}>
          <Tombol varian="sekunder" aria-label={`Naikkan produk ${i + 1}`} disabled={nonaktif || i === 0}
            onClick={() => geser(i, -1)}>Naikkan</Tombol>
          <Tombol varian="sekunder" aria-label={`Turunkan produk ${i + 1}`}
            disabled={nonaktif || i === nilai.length - 1} onClick={() => geser(i, 1)}>Turunkan</Tombol>
          <Tombol varian="bahaya" aria-label={`Hapus produk ${i + 1}`} disabled={nonaktif}
            onClick={() => hapus(i)}>Hapus</Tombol>
        </div>
      </fieldset>
    ))}
    <Tombol ref={tombolTambah} varian="sekunder" disabled={nonaktif || nilai.length >= MAKS_PRODUK} onClick={tambah}>Tambah produk</Tombol>
    {nilai.length >= MAKS_PRODUK && <p className={styles.catatan}>Maksimal {MAKS_PRODUK} produk.</p>}
  </div>;
}
