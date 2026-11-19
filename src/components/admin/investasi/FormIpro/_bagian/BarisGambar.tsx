'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, ImageOff, Star, Trash2 } from 'lucide-react';
import Field from '@/components/ui/Field';
import Lencana from '@/components/ui/Lencana';
import Tombol from '@/components/ui/Tombol';
import type { GambarIproKelola } from '@/lib/data/investasi';
import styles from '../../FormIpro.module.css';

export interface PropsBarisGambar {
  gambar: GambarIproKelola;
  nomor: number;
  jumlah: number;
  bolehUtama: boolean;
  sibuk: boolean;
  onSimpan: (id: string, isian: { alt: string; alt_en: string | null; keterangan: string | null }) => void;
  onUtama: (id: string) => void;
  onGeser: (id: string, arah: -1 | 1) => void;
  onHapus: (id: string) => void;
}

const atauNull = (v: string) => (v.trim() === '' ? null : v.trim());

export default function BarisGambar({ gambar: g, nomor, jumlah, bolehUtama, sibuk, onSimpan, onUtama, onGeser, onHapus }: PropsBarisGambar) {
  const [alt, setAlt] = useState(g.alt);
  const [altEn, setAltEn] = useState(g.alt_en ?? '');
  const [keterangan, setKeterangan] = useState(g.keterangan ?? '');
  const url = g.url_mini;
  const berubah = alt !== g.alt || altEn !== (g.alt_en ?? '') || keterangan !== (g.keterangan ?? '');
  const altSah = alt.trim().length >= 3 && alt.trim().length <= 200;
  return (
    <li className={styles.itemGambar}>
      <div className={styles.cuplikan}>
        {url ? (
          // Gambar hasil olahan di R2 publik; ukuran tetap lewat CSS.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={g.alt} width={g.lebar} height={g.tinggi} loading="lazy" />
        ) : (
          <span className={styles.tanpaCuplikan}><ImageOff size={20} aria-hidden="true" />Pratinjau gambar belum tersedia</span>
        )}
        {g.utama && <Lencana nada="primer" ikon={Star}>Gambar utama</Lencana>}
      </div>
      <div className={styles.isiGambar}>
        <Field label={`Teks alternatif gambar ${nomor}`} wajib galat={altSah ? undefined : 'Teks alternatif 3-200 karakter.'}
          bantuan="Jelaskan isi gambar untuk pembaca layar.">
          <input value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} disabled={sibuk} />
        </Field>
        <Field label={`Teks alternatif gambar ${nomor} (Inggris)`}>
          <input value={altEn} maxLength={200} onChange={(e) => setAltEn(e.target.value)} disabled={sibuk} />
        </Field>
        <Field label={`Keterangan gambar ${nomor}`}>
          <input value={keterangan} maxLength={300} onChange={(e) => setKeterangan(e.target.value)} disabled={sibuk} />
        </Field>
        <div className={styles.aksiBaris}>
          <Tombol type="button" ukuran="kecil" varian="sekunder" disabled={sibuk || !berubah || !altSah}
            onClick={() => onSimpan(g.id, { alt: alt.trim(), alt_en: atauNull(altEn), keterangan: atauNull(keterangan) })}>
            Simpan teks gambar {nomor}
          </Tombol>
          {bolehUtama && !g.utama && (
            <Tombol type="button" ukuran="kecil" varian="sekunder" ikon={Star} disabled={sibuk} onClick={() => onUtama(g.id)}>
              Jadikan gambar utama {nomor}
            </Tombol>
          )}
          {jumlah > 1 && (
            <>
              <Tombol type="button" ukuran="kecil" varian="hantu" ikon={ArrowUp} disabled={sibuk || nomor === 1} onClick={() => onGeser(g.id, -1)}>
                Naikkan gambar {nomor}
              </Tombol>
              <Tombol type="button" ukuran="kecil" varian="hantu" ikon={ArrowDown} disabled={sibuk || nomor === jumlah} onClick={() => onGeser(g.id, 1)}>
                Turunkan gambar {nomor}
              </Tombol>
            </>
          )}
          <Tombol type="button" ukuran="kecil" varian="bahaya" ikon={Trash2} disabled={sibuk} onClick={() => onHapus(g.id)}>
            Hapus gambar {nomor}
          </Tombol>
        </div>
      </div>
    </li>
  );
}
