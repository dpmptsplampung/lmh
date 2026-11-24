'use client';

import { useId, useState } from 'react';
import { SearchX, Landmark, SlidersHorizontal } from 'lucide-react';
import type { KartuPublik } from '@/lib/data/publik-server';
import KartuIpro from '@/components/investasi/KartuIpro';
import Field from '@/components/ui/Field';
import StatusKosong from '@/components/ui/StatusKosong';
import Tombol from '@/components/ui/Tombol';
import { useSaringHash } from '../_hook/useSaringHash';
import { jumlahKisi } from '../_logika/kisi';
import { adaSaringan, pilihanDari, terapkanSaringan } from '../_logika/saring';
import styles from '../investasi.module.css';

/**
 * Daftar proyek PTSP dengan saringan sektor, kabupaten/kota, dan tahap kajian (disimpan di hash URL).
 * Di HP saringan dilipat di balik satu tombol (menampilkan jumlah saringan aktif) supaya kartu pertama tidak terdorong.
 */
export default function SeksiIproPtsp({ daftar }: { daftar: KartuPublik[] }) {
  const { saringan, atur, reset } = useSaringHash();
  const [terbuka, setTerbuka] = useState(false);
  const idForm = useId();
  const pilihan = pilihanDari(daftar);
  const tampil = terapkanSaringan(daftar, saringan);
  const aktif = [saringan.sektor, saringan.kab, saringan.tahap].filter(Boolean).length;

  return (
    <section className={styles.pita} aria-labelledby="proyek-ptsp">
      <div className={styles.pitaIsi}>
        <div className={styles.seksiKepala}>
          <h2 id="proyek-ptsp" className={styles.seksiJudul}>Proyek siap ditawarkan (IPRO)</h2>
          <p className={styles.seksiIntro}>Proyek yang sudah disiapkan DPMPTSP Provinsi Lampung bersama pemilik proyek. Pilih proyek untuk melihat rincian dan menghubungi petugas.</p>
        </div>

        {daftar.length === 0 ? (
          <StatusKosong ikon={Landmark} judul="Belum ada proyek yang dipublikasikan" isi="Proyek baru akan tampil di sini setelah diterbitkan petugas." />
        ) : (
          <>
            <button type="button" className={styles.saringTombol} aria-expanded={terbuka} aria-controls={idForm} onClick={() => setTerbuka(t => !t)}>
              <SlidersHorizontal size={16} aria-hidden="true" />
              {aktif > 0 ? `Saringan (${aktif} aktif)` : 'Saring proyek'}
            </button>
            <form id={idForm} className={styles.saring} data-terbuka={terbuka} onSubmit={e => e.preventDefault()} aria-label="Saring proyek">
              <Field label="Sektor">
                <select value={saringan.sektor} onChange={e => atur('sektor', e.target.value)}>
                  <option value="">Semua sektor</option>
                  {pilihan.sektor.map(p => <option key={p.nilai} value={p.nilai}>{p.label}</option>)}
                </select>
              </Field>
              <Field label="Kabupaten/Kota">
                <select value={saringan.kab} onChange={e => atur('kab', e.target.value)}>
                  <option value="">Semua wilayah</option>
                  {pilihan.kab.map(p => <option key={p.nilai} value={p.nilai}>{p.label}</option>)}
                </select>
              </Field>
              <Field label="Tahap kajian">
                <select value={saringan.tahap} onChange={e => atur('tahap', e.target.value)}>
                  <option value="">Semua tahap</option>
                  {pilihan.tahap.map(p => <option key={p.nilai} value={p.nilai}>{p.label}</option>)}
                </select>
              </Field>
              {adaSaringan(saringan) && <Tombol varian="hantu" onClick={reset}>Hapus saringan</Tombol>}
            </form>
            <p className={styles.saringHasil} role="status">
              Menampilkan {tampil.length} dari {daftar.length} proyek
            </p>
            {tampil.length === 0 ? (
              <StatusKosong
                ikon={SearchX}
                judul="Tidak ada proyek yang cocok"
                isi="Coba ubah atau hapus saringan."
                aksi={<Tombol varian="sekunder" onClick={reset}>Hapus saringan</Tombol>}
              />
            ) : (
              <ul className={styles.kisi} data-jumlah={jumlahKisi(tampil.length)}>
                {tampil.map(k => <li key={k.id}><KartuIpro kartu={k} /></li>)}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
