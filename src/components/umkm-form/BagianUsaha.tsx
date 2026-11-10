'use client';

import { useState } from 'react';
import Field from '@/components/ui/Field';
import type { Revisi } from '@/lib/umkm-katalog/types';
import {
  BENTUK_USAHA, JENIS_USAHA, KATEGORI_PER_JENIS, LABEL_OMZET, LABEL_TENAGA_KERJA,
  OMZET_RENTANG, TENAGA_KERJA_RENTANG, type JenisUsaha,
} from '@/lib/umkm-katalog/taksonomi';
import styles from './umkm-form.module.css';

type Props = { awal?: Partial<Revisi>; galat?: Record<string, string> };

const jenisSah = (v: string | undefined): v is JenisUsaha => !!v && (JENIS_USAHA as readonly string[]).includes(v);

// Isian tak terkendali: nilai dibaca lewat FormData (lihat bacaIsian). Hanya jenis yang dipantau
// karena daftar kategori bergantung padanya.
export default function BagianUsaha({ awal, galat = {} }: Props) {
  const [jenis, setJenis] = useState<JenisUsaha | ''>(jenisSah(awal?.jenis) ? awal.jenis : '');
  const kategori: readonly string[] = jenis ? KATEGORI_PER_JENIS[jenis] : [];
  const kategoriAwal = jenis === awal?.jenis && awal?.kategori && kategori.includes(awal.kategori) ? awal.kategori : '';
  return <div className={styles.bidang}>
    <Field label="Nama usaha" galat={galat.nama}>
      <input name="nama" defaultValue={awal?.nama} maxLength={200} />
    </Field>
    <Field label="Jenis" galat={galat.jenis}>
      <select name="jenis" value={jenis} onChange={(e) => setJenis(e.target.value as JenisUsaha | '')}>
        <option value="">Pilih jenis</option>
        {JENIS_USAHA.map((j) => <option key={j} value={j}>{j}</option>)}
      </select>
    </Field>
    <Field label="Kategori" galat={galat.kategori}>
      <select key={jenis} name="kategori" defaultValue={kategoriAwal} disabled={!jenis}>
        <option value="">{jenis ? 'Pilih kategori' : 'Pilih jenis dulu'}</option>
        {kategori.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </Field>
    <Field label="Spesifik (opsional)" galat={galat.spesifik}>
      <input name="spesifik" defaultValue={awal?.spesifik ?? ''} maxLength={100} />
    </Field>
    <Field label="Bentuk usaha (opsional)" galat={galat.bentuk_usaha}>
      <select name="bentuk_usaha" defaultValue={awal?.bentuk_usaha ?? ''}>
        <option value="">Belum diketahui</option>
        {BENTUK_USAHA.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
    </Field>
    <Field label="Tahun mulai usaha (opsional)" galat={galat.tahun_mulai}>
      <input name="tahun_mulai" type="number" inputMode="numeric" min={1900} step={1}
        defaultValue={awal?.tahun_mulai ?? ''} />
    </Field>
    <Field label="Omzet per tahun (opsional)" galat={galat.omzet_rentang}
      bantuan="Hanya rentang Rp50 juta ke atas yang tampil di katalog.">
      <select name="omzet_rentang" defaultValue={awal?.omzet_rentang ?? ''}>
        <option value="">Belum diketahui</option>
        {OMZET_RENTANG.map((o) => <option key={o} value={o}>{LABEL_OMZET[o]}</option>)}
      </select>
    </Field>
    <Field label="Jumlah tenaga kerja (opsional)" galat={galat.tenaga_kerja_rentang}>
      <select name="tenaga_kerja_rentang" defaultValue={awal?.tenaga_kerja_rentang ?? ''}>
        <option value="">Belum diketahui</option>
        {TENAGA_KERJA_RENTANG.map((t) => <option key={t} value={t}>{LABEL_TENAGA_KERJA[t]}</option>)}
      </select>
    </Field>
    <Field label="Memiliki NIB (opsional)" galat={galat.memiliki_nib}>
      <select name="memiliki_nib"
        defaultValue={awal?.memiliki_nib == null ? '' : awal.memiliki_nib ? 'ya' : 'tidak'}>
        <option value="">Belum diketahui</option>
        <option value="ya">Ya</option>
        <option value="tidak">Tidak</option>
      </select>
    </Field>
    <Field label="Deskripsi" galat={galat.deskripsi} className={styles.lebar}>
      <textarea name="deskripsi" defaultValue={awal?.deskripsi} maxLength={4000} />
    </Field>
    <Field label="Instagram (opsional)" galat={galat.instagram}>
      <input name="instagram" type="url" defaultValue={awal?.instagram ?? ''} maxLength={500}
        placeholder="https://www.instagram.com/namausaha" />
    </Field>
    <Field label="TikTok (opsional)" galat={galat.tiktok}>
      <input name="tiktok" type="url" defaultValue={awal?.tiktok ?? ''} maxLength={500}
        placeholder="https://www.tiktok.com/@namausaha" />
    </Field>
  </div>;
}
