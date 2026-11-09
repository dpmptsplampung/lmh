'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Tombol from '@/components/ui/Tombol';
import type { ProfilPublik } from '@/lib/umkm-katalog/types';
import { toWIBDateString } from '@/lib/time';
import { KatalogError, katalogRequest } from './api';
import FotoKatalog from './FotoKatalog';
import FormulirKatalog, { type KonteksFormulir } from './FormulirKatalog';
import KeadaanKatalog from './KeadaanKatalog';
import StatistikProfil from './StatistikProfil';
import SukaProfil from './SukaProfil';
import UmkmSerupa from './UmkmSerupa';
import PencatatStatistik from './PencatatStatistik';
import HubungiUmkm from '@/components/umkm-perusahaan/HubungiUmkm';
import { useTahapB } from '@/components/umkm-perusahaan/useTahapB';
import KlaimUsaha from '@/components/umkm-pemilik/KlaimUsaha';
import styles from './katalog.module.css';

export default function ProfilKatalog({ id }: { id: string }) {
  const [profile, setProfile] = useState<ProfilPublik | null>(null);
  const [error, setError] = useState<KatalogError | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<'pesan' | 'laporan' | null>(null);
  const [formKind, setFormKind] = useState<'pesan' | 'laporan'>('pesan');
  const [context, setContext] = useState<KonteksFormulir>({ profil_id: id });
  const tahapB = useTahapB();
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- detail selalu dibaca ulang dari server
    setLoading(true); setError(null); setProfile(null);
    void katalogRequest<ProfilPublik>(`/${id}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setProfile(data); })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof KatalogError ? e : new KatalogError('GAGAL_INTERNAL', 500));
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, attempt]);
  const open = (kind: 'pesan' | 'laporan', photo?: string) => {
    setFormKind(kind); setContext({ profil_id: id, nama: profile?.nama, ...(photo ? { foto_id: photo } : {}) });
    setDialog(kind);
  };
  return <div className={styles.halaman}>
    <Link href="/umkm/katalog" className={styles.kembali}>Kembali ke katalog</Link>
    {loading && <><h1>Profil UMKM</h1><p role="status">Memuat profil UMKM...</p></>}
    {error && (error.status === 404 ? <div className={styles.keadaan}>
      <h1>Profil belum dapat ditampilkan</h1>
      <p>Profil mungkin belum terbit atau sedang diperiksa kembali. Silakan pilih usaha lain di katalog.</p>
    </div> : <><h1>Profil UMKM</h1><KeadaanKatalog error={error} onRetry={reload} /></>)}
    {!loading && profile && <>
      <PencatatStatistik key={id} id={id} aktif={profile.telemetri_opsional_aktif} jenis="dilihat" />
      <header className={styles.kepala}>
        <p className={styles.label}>{profile.kabupaten_kota}</p>
        <h1>{profile.nama}</h1>
        <p>{[profile.jenis, profile.kategori, profile.spesifik].filter(Boolean).join(' · ')}</p>
        <StatistikProfil suka={profile.suka} dilihat={profile.dilihat} baru={profile.baru} />
        {profile.telemetri_opsional_aktif && profile.statistik_mulai_pada && <p>
          Dicatat sejak <time dateTime={profile.statistik_mulai_pada}>
            {toWIBDateString(new Date(profile.statistik_mulai_pada))} WIB
          </time>
        </p>}
        <SukaProfil key={id} id={id} onJumlah={(value) => setProfile((previous) => previous
          ? { ...previous, suka: value } : null)} />
      </header>
      <p className={styles.deskripsi}>{profile.deskripsi}</p>
      <section className={styles.kontak} aria-label="Informasi melalui petugas">
        {tahapB.fase === 'ya' ? <p>Nomor pemilik usaha tidak ditampilkan. Tekan Hubungi UMKM. Bila disetujui
          petugas, nomor tampil di akun Anda.</p> : <p>Nomor pemilik usaha tidak ditampilkan. Tekan Hubungi lewat
          petugas untuk mengisi formulir singkat; petugas akan menghubungi Anda.</p>}
        <div className={styles.aksi}>
          {tahapB.fase === 'ya' && <HubungiUmkm profilId={id} profilNama={profile.nama} masuk={tahapB.masuk}
            perusahaan={tahapB.perusahaan} onPerusahaan={tahapB.setPerusahaan} />}
          <Tombol varian={tahapB.fase === 'ya' ? 'sekunder' : 'utama'} onClick={() => open('pesan')}>
            Hubungi lewat petugas</Tombol>
          <Tombol varian="sekunder" onClick={() => open('laporan')}>Laporkan</Tombol>
        </div>
        <KlaimUsaha profilId={id} profilNama={profile.nama} />
      </section>
      {(profile.instagram || profile.tiktok) && <nav className={styles.aksi} aria-label="Media sosial usaha">
        {profile.instagram && <a href={profile.instagram} target="_blank" rel="noopener noreferrer">
          Lihat Instagram {profile.nama} (tab baru)
        </a>}
        {profile.tiktok && <a href={profile.tiktok} target="_blank" rel="noopener noreferrer">
          Lihat TikTok {profile.nama} (tab baru)
        </a>}
      </nav>}
      <section aria-label="Foto usaha">
        <h2>Foto usaha</h2>
        {profile.foto.length === 0 ? <p>Foto belum tersedia.</p> : <div className={styles.galeri}>
          {profile.foto.map((photo, index) => <figure key={photo.id}>
            <FotoKatalog src={photo.url} alt={`Foto ${index + 1} ${profile.nama}`} />
            <figcaption><Tombol varian="hantu" onClick={() => open('laporan', photo.id)}
              aria-label={`Laporkan foto ${index + 1} ${profile.nama}`}>Laporkan foto {index + 1}</Tombol></figcaption>
          </figure>)}
        </div>}
      </section>
      <UmkmSerupa key={id} id={id} onHubungi={(value) => {
        setFormKind('pesan'); setContext(value); setDialog('pesan');
      }} />
    </>}
    <FormulirKatalog key={`${formKind}:${JSON.stringify(context)}`} terbuka={dialog !== null}
      jenis={formKind} konteks={context} onTutup={() => setDialog(null)}
      telemetriAktif={context.profil_id === id ? profile?.telemetri_opsional_aktif : undefined} />
  </div>;
}
