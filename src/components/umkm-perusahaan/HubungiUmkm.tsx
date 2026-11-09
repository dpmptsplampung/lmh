'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Dialog from '@/components/ui/Dialog';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import styles from '@/components/umkm-katalog/katalog.module.css';
import type { FilterKatalog } from '@/lib/umkm-katalog/types';
import { formatTanggal } from '@/lib/utils';
import { KatalogError, ambil, kirim } from './api';
import FormPerusahaan from './FormPerusahaan';
import type { Daftar, HasilAjukan, Kebutuhan, Perusahaan } from './types';

const BARU = 'baru';

// Tombol "Hubungi UMKM" pada profil. Belum masuk: tautan ke /login. Sudah masuk: dialog data perusahaan
// (sekali), pilih atau tulis Kebutuhan, lalu kirim permintaan.
export default function HubungiUmkm({ profilId, profilNama, masuk, perusahaan, onPerusahaan }: {
  profilId: string; profilNama: string; masuk: boolean; perusahaan: Perusahaan | null;
  onPerusahaan: (perusahaan: Perusahaan) => void;
}) {
  const [terbuka, setTerbuka] = useState(false);
  if (!masuk) {
    const kembali = encodeURIComponent(`/umkm/katalog/${profilId}`);
    return <Tombol href={`/login?next=${kembali}`}>Hubungi UMKM</Tombol>;
  }
  return <>
    <Tombol onClick={() => setTerbuka(true)}>Hubungi UMKM</Tombol>
    {terbuka && <DialogHubungi profilId={profilId} profilNama={profilNama} perusahaan={perusahaan}
      onPerusahaan={onPerusahaan} onTutup={() => setTerbuka(false)} />}
  </>;
}

function DialogHubungi({ profilId, profilNama, perusahaan, onPerusahaan, onTutup }: {
  profilId: string; profilNama: string; perusahaan: Perusahaan | null;
  onPerusahaan: (perusahaan: Perusahaan) => void; onTutup: () => void;
}) {
  const [kebutuhan, setKebutuhan] = useState<Kebutuhan[] | null>(null);
  const [berikut, setBerikut] = useState<string | null>(null);
  const [memuatLagi, setMemuatLagi] = useState(false);
  const [filter, setFilter] = useState<FilterKatalog | null>(null);
  const [pilihan, setPilihan] = useState(BARU);
  const [teks, setTeks] = useState('');
  const [kategori, setKategori] = useState('');
  const [kabupaten, setKabupaten] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');
  const [selesai, setSelesai] = useState<string | null>(null);
  const operasi = useRef<{ tanda: string; id: string } | null>(null);
  const dibuat = useRef<{ tanda: string; id: string } | null>(null);

  useEffect(() => {
    if (!perusahaan) return;
    const controller = new AbortController();
    void Promise.all([
      ambil<Daftar<Kebutuhan>>('/kebutuhan', controller.signal),
      ambil<FilterKatalog>('/filter', controller.signal),
    ]).then(([daftar, opsi]) => {
      if (controller.signal.aborted) return;
      const aktif = daftar.items.filter((item) => item.status === 'aktif');
      setKebutuhan(aktif); setBerikut(daftar.next_cursor); setFilter(opsi);
      if (aktif.length > 0) setPilihan(aktif[0].id);
    }).catch((e) => {
      if (controller.signal.aborted) return;
      setKebutuhan([]);
      setGalat(e instanceof KatalogError ? e.message : 'Data belum berhasil dimuat. Silakan coba lagi.');
    });
    return () => controller.abort();
  }, [perusahaan]);

  // Kebutuhan aktif bisa berada di luar halaman pertama (halaman awal bisa penuh Kebutuhan tertutup).
  const muatLagi = async () => {
    if (!berikut || memuatLagi) return;
    setMemuatLagi(true); setGalat('');
    try {
      const daftar = await ambil<Daftar<Kebutuhan>>(`/kebutuhan?cursor=${encodeURIComponent(berikut)}`);
      const aktif = daftar.items.filter((item) => item.status === 'aktif');
      setKebutuhan((lama) => [...(lama ?? []), ...aktif]);
      setBerikut(daftar.next_cursor);
    } catch (e) {
      setGalat(e instanceof KatalogError ? e.message : 'Data belum berhasil dimuat. Silakan coba lagi.');
    } finally { setMemuatLagi(false); }
  };

  const kirimPermintaan = async () => {
    if (sibuk) return;
    setSibuk(true); setGalat('');
    try {
      let kebutuhanId = pilihan;
      if (pilihan === BARU) {
        const tandaBaru = JSON.stringify([teks.trim(), kategori, kabupaten]);
        if (dibuat.current?.tanda !== tandaBaru) {
          const hasil = await kirim<Kebutuhan>('/kebutuhan', {
            teks: teks.trim(), kategori, ...(kabupaten ? { kabupaten_kota: kabupaten } : {}),
          });
          dibuat.current = { tanda: tandaBaru, id: hasil.id };
        }
        kebutuhanId = dibuat.current.id;
      }
      const tanda = `${kebutuhanId}:${profilId}`;
      if (operasi.current?.tanda !== tanda) operasi.current = { tanda, id: crypto.randomUUID() };
      await kirim<HasilAjukan>('/permintaan', {
        kebutuhan_id: kebutuhanId, profil_ids: [profilId], operasi_id: operasi.current.id,
      });
      setSelesai(formatTanggal(new Date()));
    } catch (e) {
      setGalat(e instanceof KatalogError ? e.message : 'Permintaan belum pasti terkirim. Coba kirim kembali.');
    } finally { setSibuk(false); }
  };

  const judul = 'Hubungi UMKM';
  if (!perusahaan) {
    return <Dialog terbuka onTutup={onTutup} judul={judul} deskripsi={`Untuk meminta nomor ${profilNama}.`}>
      <FormPerusahaan onSimpan={onPerusahaan} onBatal={onTutup} />
    </Dialog>;
  }
  return <Dialog terbuka onTutup={onTutup} judul={judul} dikunci={sibuk}>
    {selesai ? <div className={styles.form}>
      <p role="status">Permintaan diterima pada {selesai}. Petugas memeriksa sesuai urutan masuk.</p>
      <p><Link href="/me/umkm">Lihat permintaan saya</Link></p>
      <Tombol onClick={onTutup}>Selesai</Tombol>
    </div> : <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void kirimPermintaan(); }}>
      <p className={styles.keterangan}>
        Nomor pemilik usaha tidak ditampilkan. Bila disetujui petugas, nomor {profilNama} tampil di akun Anda.
      </p>
      {galat && <div role="alert" className={styles.galat}>{galat}</div>}
      {kebutuhan === null ? <p role="status">Memuat kebutuhan Anda...</p> : <fieldset disabled={sibuk}
        className={styles.form}>
        <legend>Kebutuhan Anda</legend>
        {kebutuhan.length > 0 && <div className={styles.pilihan} role="radiogroup" aria-label="Pilih Kebutuhan">
          {kebutuhan.map((item) => <label key={item.id} className={styles.centang}>
            <input type="radio" name="kebutuhan" checked={pilihan === item.id} onChange={() => setPilihan(item.id)} />
            <span>{item.teks} ({item.kategori})</span>
          </label>)}
          <label className={styles.centang}>
            <input type="radio" name="kebutuhan" checked={pilihan === BARU} onChange={() => setPilihan(BARU)} />
            <span>Tulis Kebutuhan baru</span>
          </label>
        </div>}
        {berikut && <Tombol varian="sekunder" memuat={memuatLagi} onClick={() => void muatLagi()}>
          Muat lebih banyak</Tombol>}
        {pilihan === BARU && <>
          <Field label="Kebutuhan" wajib bantuan="Satu kalimat singkat, paling banyak 200 huruf.">
            <textarea value={teks} maxLength={200} required onChange={(event) => setTeks(event.target.value)} />
          </Field>
          <Field label="Kategori" wajib><select value={kategori} required
            onChange={(event) => setKategori(event.target.value)}>
            <option value="">Pilih kategori</option>
            {(filter?.kategori ?? []).map((nama) => <option key={nama} value={nama}>{nama}</option>)}
          </select></Field>
          <Field label="Kabupaten/kota (opsional)"><select value={kabupaten}
            onChange={(event) => setKabupaten(event.target.value)}>
            <option value="">Semua wilayah</option>
            {(filter?.kabupaten_kota ?? []).map((nama) => <option key={nama} value={nama}>{nama}</option>)}
          </select></Field>
        </>}
      </fieldset>}
      <div className={styles.aksi}>
        <Tombol type="submit" memuat={sibuk} disabled={kebutuhan === null}>Kirim permintaan</Tombol>
        <Tombol varian="hantu" onClick={onTutup} disabled={sibuk}>Batal</Tombol>
      </div>
    </form>}
  </Dialog>;
}
