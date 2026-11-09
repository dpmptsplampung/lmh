'use client';

import { useState } from 'react';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import styles from '@/components/umkm-katalog/katalog.module.css';
import { KatalogError, kirim } from './api';

// Kode dari petugas untuk permintaan yang dicatatkan petugas. Pesan sukses dan gagal sengaja tenang.
export default function KodeTautan({ onTertaut }: { onTertaut: () => void }) {
  const [kode, setKode] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<{ jenis: 'ok' | 'gagal'; teks: string } | null>(null);
  const kirimKode = async () => {
    if (sibuk) return;
    setSibuk(true); setPesan(null);
    try {
      await kirim('/tautkan', { kode: kode.trim() });
      setKode(''); onTertaut();
      setPesan({ jenis: 'ok', teks: 'Kode diterima. Permintaan dari petugas kini ada di daftar Anda.' });
    } catch (e) {
      setPesan({ jenis: 'gagal', teks: e instanceof KatalogError && e.code === 'TERLALU_BANYAK' ? e.message
        : 'Kode belum dapat dipakai. Periksa kembali kode Anda, atau minta kode baru kepada petugas.' });
    } finally { setSibuk(false); }
  };
  return <section aria-labelledby="judul-kode" className={styles.hasil}>
    <h2 id="judul-kode">Punya kode dari petugas?</h2>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void kirimKode(); }}>
      <Field label="Kode dari petugas" bantuan="Bentuknya XXXX-XXXX-XXXX. Huruf besar atau kecil sama saja.">
        <input value={kode} maxLength={24} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          required onChange={(event) => setKode(event.target.value)} />
      </Field>
      {pesan && <div role={pesan.jenis === 'ok' ? 'status' : 'alert'}
        className={pesan.jenis === 'ok' ? styles.berhasil : styles.galat}>{pesan.teks}</div>}
      <div className={styles.aksi}><Tombol type="submit" memuat={sibuk}>Pakai kode</Tombol></div>
    </form>
  </section>;
}
