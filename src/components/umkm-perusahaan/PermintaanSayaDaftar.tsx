'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import Tombol from '@/components/ui/Tombol';
import styles from '@/components/umkm-katalog/katalog.module.css';
import { formatTanggal } from '@/lib/utils';
import { KatalogError, ambil, kirim } from './api';
import type { Daftar, NomorDibuka, PermintaanSaya, StatusPermintaan } from './types';

const LABEL: Record<StatusPermintaan, { teks: string; nada: NadaLencana }> = {
  diajukan: { teks: 'Diajukan', nada: 'info' },
  menunggu_izin: { teks: 'Menunggu konfirmasi UMKM', nada: 'peringatan' },
  nomor_dibuka: { teks: 'Nomor dibuka', nada: 'sukses' },
  ditolak: { teks: 'Belum dapat dilanjutkan', nada: 'bahaya' },
  dibatalkan: { teks: 'Dibatalkan', nada: 'netral' },
};
const PERINGATAN = 'DPMPTSP tidak menjamin transaksi; jangan mengirim uang sebelum ada kesepakatan tertulis.';

export default function PermintaanSayaDaftar({ muatUlang }: { muatUlang: number }) {
  const [items, setItems] = useState<PermintaanSaya[]>([]);
  const [berikut, setBerikut] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');
  const muat = useCallback(async (cursor: string | null, signal?: AbortSignal) => {
    setMemuat(true); setGalat('');
    try {
      const data = await ambil<Daftar<PermintaanSaya>>(
        `/permintaan${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, signal);
      setItems((lama) => (cursor ? [...lama, ...data.items] : data.items));
      setBerikut(data.next_cursor);
    } catch (e) {
      if (signal?.aborted) return;
      setGalat(e instanceof KatalogError ? e.message : 'Daftar belum berhasil dimuat.');
    } finally { if (!signal?.aborted) setMemuat(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- daftar selalu dibaca ulang dari server
    void muat(null, controller.signal);
    return () => controller.abort();
  }, [muat, muatUlang]);

  return <section aria-labelledby="judul-permintaan" className={styles.hasil}>
    <h2 id="judul-permintaan">Permintaan saya</h2>
    {galat && <div role="alert" className={styles.galat}>{galat}{' '}
      <Tombol varian="sekunder" onClick={() => void muat(null)}>Coba lagi</Tombol></div>}
    {memuat && items.length === 0 && !galat && <p role="status">Memuat permintaan...</p>}
    {!memuat && !galat && items.length === 0 && <p>Belum ada permintaan. Buka profil UMKM lalu tekan Hubungi UMKM.</p>}
    <ul className={styles.daftarBaris}>
      {items.map((item) => <BarisPermintaan key={item.id} item={item}
        onBatal={() => setItems((lama) => lama.map((x) => x.id === item.id ? { ...x, status: 'dibatalkan' } : x))} />)}
    </ul>
    {berikut && <Tombol varian="sekunder" memuat={memuat} onClick={() => void muat(berikut)}>Muat lebih banyak</Tombol>}
  </section>;
}

function BarisPermintaan({ item, onBatal }: { item: PermintaanSaya; onBatal: () => void }) {
  const label = LABEL[item.status];
  const [nomor, setNomor] = useState<NomorDibuka | 'tidak' | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');
  const bisaBatal = item.status === 'diajukan' || item.status === 'menunggu_izin';

  const tampilkan = async () => {
    if (sibuk) return;
    setSibuk(true); setGalat('');
    try {
      setNomor(await ambil<NomorDibuka>(`/permintaan/${item.id}/nomor`));
    } catch (e) {
      if (e instanceof KatalogError && e.code === 'NOMOR_TIDAK_TERSEDIA') setNomor('tidak');
      else setGalat(e instanceof KatalogError ? e.message : 'Nomor belum berhasil diambil. Silakan coba lagi.');
    } finally { setSibuk(false); }
  };
  const batalkan = async () => {
    if (sibuk) return;
    setSibuk(true); setGalat('');
    try { await kirim(`/permintaan/${item.id}/batal`); onBatal(); } catch (e) {
      setGalat(e instanceof KatalogError ? e.message : 'Permintaan belum berhasil dibatalkan.');
    } finally { setSibuk(false); }
  };

  return <li className={styles.baris}>
    <h3><Link href={`/umkm/katalog/${item.profil_id}`}>{item.profil_nama}</Link></h3>
    <p><Lencana nada={label.nada}>{label.teks}</Lencana></p>
    <p className={styles.label}>
      Kode {item.kode} · Diajukan <time dateTime={item.dibuat_pada}>{formatTanggal(item.dibuat_pada)}</time>
    </p>
    {item.status === 'diajukan' && <p>Permintaan Anda kami terima pada {formatTanggal(item.dibuat_pada)}.
      Petugas memeriksa sesuai urutan masuk.</p>}
    {item.status === 'ditolak' && <p>Permintaan untuk {item.profil_nama} belum dapat dilanjutkan.
      {item.alasan_tolak ? ` Alasan: ${item.alasan_tolak}.` : ''} Anda dapat memilih UMKM lain atau mengisi
      formulir Hubungi lewat petugas.</p>}
    {item.petugas_nama && <p>Petugas: {item.petugas_nama}
      {item.petugas_hp_akhir ? `, HP berakhiran ${item.petugas_hp_akhir}` : ''}</p>}
    {galat && <div role="alert" className={styles.galat}>{galat}</div>}
    {item.status === 'nomor_dibuka' && nomor === null && <div className={styles.aksi}>
      <Tombol memuat={sibuk} onClick={() => void tampilkan()}>Tampilkan nomor</Tombol>
    </div>}
    {nomor === 'tidak' && <p role="status">Nomor {item.profil_nama} tidak lagi ditampilkan. Untuk informasi, isi{' '}
      <Link href={`/umkm/katalog/${item.profil_id}`}>formulir Hubungi lewat petugas</Link>.</p>}
    {nomor && nomor !== 'tidak' && <div role="status" className={styles.baris}>
      <p>Nomor {item.profil_nama}: <span className={styles.nomor}>{nomor.nomor}</span></p>
      <p>Dibuka petugas {nomor.petugas_nama} pada {formatTanggal(nomor.dibuka_pada)}. Sebutkan kode {nomor.kode}{' '}
        saat menghubungi.</p>
      <p className={styles.peringatan}>{PERINGATAN}</p>
      <div className={styles.aksi}>
        <Tombol varian="sekunder" onClick={() => setNomor(null)}>Sembunyikan nomor</Tombol>
      </div>
    </div>}
    {bisaBatal && <div className={styles.aksi}>
      <Tombol varian="hantu" memuat={sibuk} onClick={() => void batalkan()}>Batalkan permintaan</Tombol>
    </div>}
  </li>;
}
