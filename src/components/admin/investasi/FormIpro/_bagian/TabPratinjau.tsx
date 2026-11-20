'use client';

import { ImageOff } from 'lucide-react';
import type { GambarIproKelola } from '@/lib/data/investasi';
import { SKEMA_IPRO, STATUS_LAHAN, TAHAP_KAJIAN } from '@/lib/investasi/konstanta';
import { validasiUrlFoila } from '@/lib/investasi/foila';
import type { KartuPublik } from '@/lib/data/publik-server';
import AngkaKunci from '@/components/investasi/AngkaKunci';
import KartuFoila from '@/components/investasi/KartuFoila';
import { labelSektor } from '../_logika/label';
import { angkaAtauNull, type NilaiForm, type SumberIpro } from '../_logika/nilai-form';
import styles from '../../FormIpro.module.css';

// Pratinjau dari isian saat ini (termasuk yang belum disimpan), tanpa alamat publik. Angka kunci dan kartu FOILA memakai
// komponen presentasi publik (src/components/investasi/); badan detail PTSP masih pratinjau sederhana milik layar ini
// karena komponen detail publik berada di app/investasi/ipro/[slug]/_bagian (bergantung data server).
const label = (daftar: readonly { nilai: string; id: string }[], v: string) => daftar.find((d) => d.nilai === v)?.id ?? '';
const mataUang = (v: string): 'IDR' | 'USD' => (v === 'USD' ? 'USD' : 'IDR');
const finit = (v: string): number | null => { const n = angkaAtauNull(v); return n !== null && Number.isFinite(n) ? n : null; };

function GambarUtama({ gambar }: { gambar: GambarIproKelola[] }) {
  const g = gambar.find((x) => x.utama) ?? gambar[0];
  const url = g ? g.url : null;
  if (!g) return <p className={styles.tanpaCuplikan}><ImageOff size={20} aria-hidden="true" />Belum ada gambar</p>;
  if (!url) return <p className={styles.tanpaCuplikan}><ImageOff size={20} aria-hidden="true" />Pratinjau gambar belum tersedia ({g.alt})</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.gambarPratinjau} src={url} alt={g.alt} width={g.lebar} height={g.tinggi} />;
}

export default function TabPratinjau({ nilai, sumber, gambar }: { nilai: NilaiForm; sumber: SumberIpro; gambar: GambarIproKelola[] }) {
  const judul = nilai.judul.trim() || '(Judul belum diisi)';
  if (sumber === 'foila') {
    const url = validasiUrlFoila(nilai.sumber_url.trim());
    const g = gambar[0];
    const alamat = g ? g.url_mini : null;
    // Kartu hanya dirender bila tautan lolos validasi host: isian mentah tidak boleh menjadi href.
    const kartu: KartuPublik | null = url ? {
      id: 'pratinjau', sumber: 'foila', slug: 'pratinjau', judul, judul_en: null, ringkasan: nilai.ringkasan.trim() || '(Ringkasan belum diisi)',
      ringkasan_en: null, sektor: nilai.sektor, kab_kota: nilai.kab_kota || '-', nilai_investasi: angkaAtauNull(nilai.nilai_investasi),
      mata_uang: mataUang(nilai.mata_uang), nilai_teks: nilai.nilai_teks.trim() || null, irr_persen: null, tahap_kajian: null,
      sumber_url: url.toString(), urutan: 0, diterbitkan_pada: null,
      gambar: g && alamat ? { url: alamat, url_mini: alamat, alt: g.alt, lebar: g.lebar, tinggi: g.tinggi } : null,
    } : null;
    return (
      <section className={styles.pratinjau} aria-label="Pratinjau kartu FOILA">
        <p className={styles.catatan}>Pratinjau kartu. Di halaman publik seluruh kartu menjadi satu tautan ke FOILA (tab baru).</p>
        {kartu ? <KartuFoila kartu={kartu} /> : <p className={styles.catatan}>Isi tautan FOILA yang sah untuk melihat kartu.</p>}
      </section>
    );
  }
  const paragraf = nilai.deskripsi.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const angkaKunci = {
    nilai_investasi: finit(nilai.nilai_investasi), mata_uang: mataUang(nilai.mata_uang), irr_persen: finit(nilai.irr_persen),
    npv_nilai: finit(nilai.npv_nilai), payback_bulan: finit(nilai.payback_bulan), luas_ha: finit(nilai.luas_ha),
  };
  const baris: [string, string][] = ([
    ['Tahap kajian', label(TAHAP_KAJIAN, nilai.tahap_kajian)], ['Skema', label(SKEMA_IPRO, nilai.skema)],
    ['Status lahan', label(STATUS_LAHAN, nilai.status_lahan)], ['Pemilik proyek', nilai.pemilik.trim()],
  ] as [string, string][]).filter(([, v]) => v);
  return (
    <section className={styles.pratinjau} aria-label="Pratinjau halaman detail">
      <p className={styles.catatan}>Pratinjau sederhana dari isian saat ini (termasuk yang belum disimpan). Tampilan publik final dapat berbeda.</p>
      <GambarUtama gambar={gambar} />
      <h3>{judul}</h3>
      <p>{labelSektor(nilai.sektor) || 'Sektor belum dipilih'} &middot; {nilai.kab_kota || 'Kabupaten/kota belum dipilih'}{nilai.lokasi_teks.trim() ? ` · ${nilai.lokasi_teks.trim()}` : ''}</p>
      <p>{nilai.ringkasan.trim() || '(Ringkasan belum diisi)'}</p>
      <AngkaKunci data={angkaKunci} />
      {baris.length > 0 && <dl className={styles.angkaPratinjau}>{baris.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {paragraf.length ? paragraf.map((p, i) => <p key={i}>{p}</p>) : <p className={styles.catatan}>(Deskripsi belum diisi)</p>}
      {nilai.perizinan.trim() && <p><strong>Perizinan:</strong> {nilai.perizinan.trim()}</p>}
      {(nilai.kontak_instansi || nilai.kontak_email || nilai.kontak_telepon) && (
        <p><strong>Kontak:</strong> {[nilai.kontak_instansi, nilai.kontak_email, nilai.kontak_telepon].map((x) => x.trim()).filter(Boolean).join(' · ')}</p>
      )}
    </section>
  );
}
