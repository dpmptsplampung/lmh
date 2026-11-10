'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Flag, MapPin } from 'lucide-react';
import Tombol from '@/components/ui/Tombol';
import type { ProfilPublik } from '@/lib/umkm-katalog/types';
import { LABEL_TENAGA_KERJA, formatKapasitas } from '@/lib/umkm-katalog/taksonomi';
import { toWIBDateString } from '@/lib/time';
import { KatalogError, katalogRequest } from './api';
import FotoKatalog, { inisialNama } from './FotoKatalog';
import FormulirKatalog, { type KonteksFormulir } from './FormulirKatalog';
import KeadaanKatalog from './KeadaanKatalog';
import StatistikProfil from './StatistikProfil';
import SukaProfil from './SukaProfil';
import UmkmSerupa from './UmkmSerupa';
import PencatatStatistik from './PencatatStatistik';
import HubungiUmkm from '@/components/umkm-perusahaan/HubungiUmkm';
import { useTahapB } from '@/components/umkm-perusahaan/useTahapB';
import KlaimUsaha from '@/components/umkm-pemilik/KlaimUsaha';
import styles from './publik.module.css';

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
  const [utama, ...lain] = profile?.foto ?? [];
  // Server lama (migrasi produk belum diterapkan) belum mengirim kolom baru.
  const produk = profile?.produk ?? [];
  const fakta = profile ? [
    profile.bentuk_usaha && `Bentuk usaha: ${profile.bentuk_usaha}`,
    profile.tahun_mulai && `Mulai usaha: ${profile.tahun_mulai}`,
    profile.skala && `Skala usaha: ${profile.skala}`,
    profile.omzet_label,
    profile.tenaga_kerja_rentang && `Tenaga kerja: ${LABEL_TENAGA_KERJA[profile.tenaga_kerja_rentang] ?? profile.tenaga_kerja_rentang}`,
  ].filter((v): v is string => !!v) : [];
  return <div className={styles.halaman}>
    <div className={styles.profilBingkai}>
      <nav aria-label="Jejak halaman" className={styles.jejak}>
        <Link href="/umkm/katalog" className={styles.kembali}>
          <ArrowLeft size={18} aria-hidden="true" />Kembali ke katalog</Link>
      </nav>
      {loading && <div className={styles.profilMemuat}>
        <h1 className={styles.judulProfil}>Profil UMKM</h1>
        <p role="status" className={styles.memuat}>Memuat profil UMKM...</p>
        <span className={styles.kerangkaFoto} aria-hidden="true" />
      </div>}
      {error && (error.status === 404 ? <div className={styles.panel}>
        <h1 className={styles.judulProfil}>Profil belum dapat ditampilkan</h1>
        <p>Profil mungkin belum terbit atau sedang diperiksa kembali. Silakan pilih usaha lain di katalog.</p>
      </div> : <><h1 className={styles.judulProfil}>Profil UMKM</h1><KeadaanKatalog error={error} onRetry={reload} /></>)}
      {!loading && profile && <>
        <PencatatStatistik key={`dilihat-${id}`} id={id} aktif={profile.telemetri_opsional_aktif} jenis="dilihat" />
        <div className={styles.profilGrid}>
          <header className={styles.profilJudul}>
            <p className={styles.wilayah}><MapPin size={16} aria-hidden="true" />{[profile.kecamatan, profile.kabupaten_kota].filter(Boolean).join(', ')}</p>
            <h1 className={styles.judulProfil}>{profile.nama}</h1>
            <p className={styles.jenisProfil}>
              {[profile.jenis, profile.kategori, profile.spesifik].filter(Boolean).map((value) =>
                <span key={value} className={styles.label}>{value}</span>)}
            </p>
            <StatistikProfil suka={profile.suka} dilihat={profile.dilihat} baru={profile.baru} />
            {profile.telemetri_opsional_aktif && profile.statistik_mulai_pada && <p className={styles.catatan}>
              Dicatat sejak <time dateTime={profile.statistik_mulai_pada}>
                {toWIBDateString(new Date(profile.statistik_mulai_pada))} WIB
              </time>
            </p>}
          </header>

          <section aria-labelledby="judul-foto" className={styles.galeri}>
            <h2 id="judul-foto" className="sr-only">Foto usaha</h2>
            {!utama ? <FotoKatalog src={null} alt={`Foto ${profile.nama}`} isi inisial={inisialNama(profile.nama)}
              className={styles.fotoUtama} /> : <>
              <figure className={styles.figur}>
                <FotoKatalog src={utama.url} alt={`Foto 1 ${profile.nama}`} isi className={styles.fotoUtama} />
                <figcaption><Tombol varian="hantu" ukuran="kecil" onClick={() => open('laporan', utama.id)}
                  aria-label={`Laporkan foto 1 ${profile.nama}`}>Laporkan foto 1</Tombol></figcaption>
              </figure>
              {lain.length > 0 && <div className={styles.fotoLain}>
                {lain.map((photo, index) => <figure key={photo.id} className={styles.figur}>
                  <FotoKatalog src={photo.url} alt={`Foto ${index + 2} ${profile.nama}`} isi
                    className={styles.fotoKecil} />
                  <figcaption><Tombol varian="hantu" ukuran="kecil" onClick={() => open('laporan', photo.id)}
                    aria-label={`Laporkan foto ${index + 2} ${profile.nama}`}>Laporkan foto {index + 2}</Tombol>
                  </figcaption>
                </figure>)}
              </div>}
            </>}
          </section>

          <section className={styles.aksiPanel} aria-labelledby="judul-aksi">
            <h2 id="judul-aksi">Hubungi usaha ini</h2>
            {tahapB.fase === 'ya' ? <>
              <p>Nomor pemilik usaha tidak tampil untuk umum.</p>
              <div className={styles.jalur}>
                <p className={styles.jalurJudul}>Perusahaan yang membutuhkan nomor</p>
                <p>Masuk lalu kirim permintaan. Bila disetujui petugas, nomor tampil di akun Anda.</p>
                <HubungiUmkm profilId={id} profilNama={profile.nama} masuk={tahapB.masuk}
                  perusahaan={tahapB.perusahaan} onPerusahaan={tahapB.setPerusahaan} />
              </div>
              <div className={styles.jalur}>
                <p className={styles.jalurJudul}>Pertanyaan umum</p>
                <p>Tanpa akun. Isi formulir singkat, lalu petugas menghubungi Anda.</p>
                <Tombol varian="sekunder" onClick={() => open('pesan')}>Hubungi lewat petugas</Tombol>
              </div>
            </> : <>
              <p>Nomor pemilik usaha tidak tampil untuk umum. Tekan Hubungi lewat petugas untuk mengisi formulir
                singkat; petugas akan menghubungi Anda.</p>
              <Tombol onClick={() => open('pesan')} className={styles.tombolPenuh}>Hubungi lewat petugas</Tombol>
            </>}
            <div className={styles.aksiKecil}>
              <SukaProfil key={id} id={id} onJumlah={(value) => setProfile((previous) => previous
                ? { ...previous, suka: value } : null)} />
              <Tombol varian="sekunder" ikon={Flag} onClick={() => open('laporan')}>Laporkan</Tombol>
            </div>
            <KlaimUsaha profilId={id} profilNama={profile.nama} />
          </section>

          <section aria-labelledby="judul-tentang" className={styles.tentang}>
            <h2 id="judul-tentang">Tentang usaha</h2>
            <p className={styles.deskripsi}>{profile.deskripsi}</p>
            {fakta.length > 0 && <ul className={styles.fakta} aria-label="Keterangan usaha">
              {fakta.map((teks) => <li key={teks}>{teks}</li>)}
            </ul>}
            {(profile.instagram || profile.tiktok) && <nav className={styles.sosial} aria-label="Media sosial usaha">
              {profile.instagram && <a href={profile.instagram} target="_blank" rel="noopener noreferrer">
                <span className="sr-only">Lihat </span>Instagram<span className="sr-only"> {profile.nama} (tab baru)</span>
                <ExternalLink size={16} aria-hidden="true" />
              </a>}
              {profile.tiktok && <a href={profile.tiktok} target="_blank" rel="noopener noreferrer">
                <span className="sr-only">Lihat </span>TikTok<span className="sr-only"> {profile.nama} (tab baru)</span>
                <ExternalLink size={16} aria-hidden="true" />
              </a>}
            </nav>}
          </section>

          {produk.length > 0 && <section aria-labelledby="judul-produk" className={styles.produk}>
            <h2 id="judul-produk">Produk</h2>
            <ul className={styles.produkDaftar}>
              {produk.map((p) => <li key={p.urutan} className={styles.produkItem}>
                {p.foto && <FotoKatalog src={p.foto.url} alt={`Foto ${p.nama}`} isi className={styles.produkFoto} />}
                <h3>{p.nama}</h3>
                {p.keterangan && <p>{p.keterangan}</p>}
                {p.kapasitas_jumlah != null && p.kapasitas_satuan && p.kapasitas_periode && <p className={styles.kapasitas}>
                  {formatKapasitas({ kapasitas_jumlah: p.kapasitas_jumlah, kapasitas_satuan: p.kapasitas_satuan,
                    kapasitas_periode: p.kapasitas_periode })}</p>}
              </li>)}
            </ul>
          </section>}
        </div>
        <UmkmSerupa key={`serupa-${id}`} id={id} onHubungi={(value) => {
          setFormKind('pesan'); setContext(value); setDialog('pesan');
        }} />
      </>}
    </div>
    <FormulirKatalog key={`${formKind}:${JSON.stringify(context)}`} terbuka={dialog !== null}
      jenis={formKind} konteks={context} onTutup={() => setDialog(null)}
      telemetriAktif={context.profil_id === id ? profile?.telemetri_opsional_aktif : undefined} />
  </div>;
}
