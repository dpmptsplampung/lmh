import { Building2, Mail, Phone } from 'lucide-react';
import type { DetailIproPublik } from '@/lib/data/publik-server';
import styles from '../detail.module.css';

/** Kontak lembaga (bukan pribadi). Calon investor diarahkan ke tombol "Hubungi petugas". Tanpa data kontak, tidak merender apa-apa. */
export default function KontakIpro({ ipro }: { ipro: DetailIproPublik }) {
  const { kontak_instansi: instansi, kontak_email: email, kontak_telepon: telepon } = ipro;
  if (!instansi && !email && !telepon) return null;
  return (
    <section className={styles.kontak} aria-labelledby="judul-kontak">
      <h2 id="judul-kontak" className={styles.blokJudul}>Kontak lembaga</h2>
      <ul className={styles.kontakDaftar}>
        {instansi && <li><Building2 size={16} aria-hidden="true" /> <span>{instansi}</span></li>}
        {email && <li><Mail size={16} aria-hidden="true" /> <a href={`mailto:${email}`}>{email}</a></li>}
        {telepon && <li><Phone size={16} aria-hidden="true" /> <a href={`tel:${telepon.replace(/[\s-]/g, '')}`}>{telepon}</a></li>}
      </ul>
      <p className={styles.kontakCatatan}>Untuk pertanyaan tentang proyek ini, gunakan tombol &quot;Hubungi petugas&quot;.</p>
    </section>
  );
}
