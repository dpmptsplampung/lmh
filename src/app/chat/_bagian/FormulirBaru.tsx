'use client';

// Formulir "Mulai Konsultasi Online" (percakapan baru) atau ajakan masuk Google bila belum login (A-03). Hanya tampilan dari
// props: pemilik state dan pemanggil data adalah ChatKlien.
import Link from 'next/link';
import Field from '@/components/ui/Field';
import Galat from '@/components/ui/Galat';
import Tombol from '@/components/ui/Tombol';
import IkonGoogle from '@/components/chat/IkonGoogle';
import type { LayananChat } from '@/lib/data/chat-pengunjung';
import styles from '../chat.module.css';
import { CONSENT_TEXT } from './teks';

export interface FormulirBaruProps {
  // Pengunjung
  memeriksa: boolean;
  masuk: boolean;
  nama: string;
  onNama: (nama: string) => void;
  /** Parameter ?layanan= mentah; menambah kalimat "dengan layanan yang sama" pada ajakan masuk. */
  layananUrlMentah: string | null;
  onMasukGoogle: () => void;
  // Layanan
  layanan: readonly LayananChat[];
  layananId: string;
  onPilihLayanan: (id: string) => void;
  memuatLayanan: boolean;
  galatLayanan: boolean;
  onCobaLagiLayanan: () => void;
  /** Layanan yang sudah punya percakapan (label "percakapan sudah ada"). */
  layananBerpercakapan: readonly string[];
  adaPercakapanTerpilih: boolean;
  // Persetujuan PDP
  consentGiven: boolean;
  onConsent: (dicentang: boolean) => void;
  galatConsent: string | null;
  onCobaLagiConsent: () => void;
  // Kirim
  memulai: boolean;
  daring: boolean;
  onMulai: () => void;
}

export default function FormulirBaru(p: FormulirBaruProps) {
  if (!p.memeriksa && !p.masuk) {
    /* A-03: chat wajib login Google. Ajakan masuk paling atas; kolom yang tak bisa dipakai tidak ditampilkan. */
    return (
      <section aria-labelledby="chatAjakanMasuk" className={styles.ajakan}>
        <h3 id="chatAjakanMasuk" className={styles.ajakanJudul}>Masuk untuk memakai live chat</h3>
        <p className={styles.ajakanTeks}>
          Live chat hanya untuk pengunjung yang masuk dengan akun Google, supaya percakapan Anda tersimpan dan dapat dilanjutkan.
          Setelah masuk, Anda kembali ke halaman ini{p.layananUrlMentah ? ' dengan layanan yang sama' : ''}.
        </p>
        <Tombol onClick={p.onMasukGoogle}>
          <IkonGoogle className={styles.ikonGoogle} />
          Masuk dengan Google
        </Tombol>
      </section>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); p.onMulai(); }} className={styles.formSetup}>
      <Field label="Nama Anda" wajib>
        <input
          type="text"
          placeholder={p.memeriksa ? "Memuat data profil..." : "Masukkan nama lengkap..."}
          value={p.nama}
          onChange={(e) => p.onNama(e.target.value)}
          required
          readOnly={p.masuk}
          className={p.masuk ? styles.inputTerkunci : undefined}
        />
      </Field>

      <div>
        <Field label="Layanan yang Ditanyakan" wajib>
          <select
            value={p.layananId}
            onChange={(e) => p.onPilihLayanan(e.target.value)}
            disabled={p.memuatLayanan || p.galatLayanan}
            required
          >
            <option value="">{p.galatLayanan ? '— Layanan belum dapat dimuat —' : '— Pilih layanan tujuan —'}</option>
            {p.layanan.map((layanan) => (
              <option
                key={layanan.id}
                value={layanan.id}
                disabled={layanan.status_tampilan === 'coming_soon'}
              >
                {layanan.nama}
                {layanan.status_tampilan === 'coming_soon' ? ' (Segera hadir)' : ''}
                {p.layananBerpercakapan.includes(layanan.id) ? ' (percakapan sudah ada)' : ''}
              </option>
            ))}
          </select>
        </Field>
        {p.galatLayanan && (
          <Galat
            judul="Daftar layanan belum dapat dimuat"
            pesan="Anda belum dapat memilih layanan tujuan chat. Tekan Coba lagi untuk memuat ulang daftar layanan."
            onRetry={p.onCobaLagiLayanan}
            memuat={p.memuatLayanan}
          />
        )}
      </div>

      {/* A-10: percakapan yang sudah ada tidak meminta persetujuan lagi (sudah tercatat saat percakapan pertama). */}
      {p.adaPercakapanTerpilih ? (
        <p role="status" className={styles.catatanStatus}>
          Anda sudah punya percakapan dengan layanan ini. Persetujuan Anda sudah tercatat; percakapan akan dibuka.
        </p>
      ) : (
        // I8: PDP consent checkbox — required
        <div className={styles.consent}>
          <input
            id="chatConsent"
            type="checkbox"
            className={styles.consentKotak}
            checked={p.consentGiven}
            onChange={(e) => p.onConsent(e.target.checked)}
            required
          />
          <label htmlFor="chatConsent" className={styles.consentTeks}>
            {CONSENT_TEXT}{' '}
            <Link href="/kebijakan-privasi" className={styles.consentTautan}>
              Baca kebijakan
            </Link>
          </label>
        </div>
      )}

      {p.galatConsent && (
        <Galat judul="Persetujuan belum tercatat" pesan={p.galatConsent} onRetry={p.onCobaLagiConsent} memuat={p.memulai} />
      )}

      <Tombol
        type="submit"
        className={styles.kirimSetup}
        memuat={p.memulai}
        disabled={p.memulai || p.memuatLayanan || p.galatLayanan || !p.masuk || !(p.adaPercakapanTerpilih || p.consentGiven) || !p.daring}
      >
        {p.memulai ? 'Memulai Sesi...' : p.adaPercakapanTerpilih ? 'Buka percakapan' : 'Mulai Sesi Chat'}
      </Tombol>
    </form>
  );
}
