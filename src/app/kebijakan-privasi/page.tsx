import Link from 'next/link';
import type { Metadata } from 'next';
import { APP_NAME } from '@/lib/constants';

/** Must match CONSENT_VERSION in checkin/chat consent flows. */
export const POLICY_VERSION = '1.0';

export const metadata: Metadata = {
  title: 'Kebijakan Privasi',
  description: `Kebijakan privasi ${APP_NAME} — DPMPTSP Provinsi Lampung`,
};

export default function KebijakanPrivasiPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--surface-secondary)',
        padding: 'var(--space-8) var(--space-4)',
      }}
    >
      <article
        style={{
          maxWidth: '720px',
          margin: '0 auto',
          background: 'var(--surface-elevated)',
          borderRadius: 'var(--radius-2xl)',
          border: '1px solid var(--border-default)',
          padding: 'var(--space-8)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
          <Link href="/" style={{ color: 'var(--color-primary-600)' }}>
            ← Beranda
          </Link>
        </p>

        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-3xl)',
            fontWeight: 800,
            marginBottom: 'var(--space-2)',
            color: 'var(--text-primary)',
          }}
        >
          Kebijakan Privasi
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-8)', fontSize: 'var(--text-sm)' }}>
          Versi kebijakan: <strong>{POLICY_VERSION}</strong> · Berlaku untuk layanan digital{' '}
          {APP_NAME}
        </p>

        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-3)' }}>
            1. Pengendali Data
          </h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Pengendali data pribadi pada layanan ini adalah{' '}
            <strong>DPMPTSP Provinsi Lampung</strong> (Dinas Penanaman Modal dan Pelayanan
            Terpadu Satu Pintu Provinsi Lampung). Kontak umum: melalui kanal resmi layanan
            digital {APP_NAME} atau saluran pengaduan/komunikasi publik DPMPTSP Provinsi
            Lampung. Informasi pejabat DPO perorangan tidak dicantumkan di sini; hubungi
            instansi melalui kontak resmi di bawah.
          </p>
        </section>

        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-3)' }}>
            2. Data yang Dikumpulkan
          </h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 'var(--space-2)' }}>
            Sesuai kebutuhan layanan, kami dapat memproses antara lain:
          </p>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 1.7, paddingLeft: '1.25rem' }}>
            <li>Identitas dan kontak (nama, email, nomor telepon) saat check-in, reservasi, atau chat</li>
            <li>Data kunjungan (tujuan layanan, jadwal, status antrean)</li>
            <li>Isi percakapan live chat dan preferensi FAQ</li>
            <li>Persetujuan privasi (versi kebijakan, waktu persetujuan)</li>
            <li>Data teknis terbatas (mis. log keamanan, status offline/online) yang diperlukan untuk operasional</li>
          </ul>
        </section>

        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-3)' }}>
            3. Tujuan Pemrosesan
          </h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Data diproses untuk menyediakan layanan check-in dan antrean, reservasi kunjungan,
            live chat dan eskalasi ke petugas, notifikasi terkait layanan, peningkatan mutu
            pelayanan publik, serta kewajiban hukum dan keamanan sistem. Data tidak dijual
            kepada pihak ketiga untuk tujuan pemasaran komersial.
          </p>
        </section>

        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-3)' }}>
            4. Retensi
          </h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Periode retensi operasional yang berlaku saat ini adalah{' '}
            <strong>730 hari</strong> (dua tahun) sejak data terakhir relevan dengan layanan,
            kecuali ada kewajiban hukum yang mengharuskan penyimpanan lebih lama. Angka ini
            bersifat <strong>provisional</strong> (sementara) hingga mendapat penandatanganan
            legal / penyesuaian kebijakan retensi resmi DPMPTSP Provinsi Lampung.
          </p>
        </section>

        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-3)' }}>
            5. Hak Subjek Data
          </h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Anda berhak meminta akses, koreksi, pembaruan, atau penghapusan data pribadi
            sepanjang diizinkan peraturan perundang-undangan yang berlaku, serta menarik
            persetujuan untuk pemrosesan yang didasarkan pada consent (dengan konsekuensi
            bahwa sebagian layanan mungkin tidak dapat dilanjutkan). Permintaan diproses
            melalui kontak di bawah sesuai prosedur internal instansi.
          </p>
        </section>

        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-3)' }}>
            6. Cara Kontak
          </h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Untuk pertanyaan privasi atau permintaan hak subjek data, hubungi{' '}
            <strong>DPMPTSP Provinsi Lampung</strong> melalui kanal resmi layanan {APP_NAME}{' '}
            (misalnya Live Chat) atau saluran pengaduan/komunikasi publik instansi. Sertakan
            identitas yang dapat diverifikasi dan uraian singkat permintaan Anda.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-3)' }}>
            7. Versi Kebijakan
          </h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Versi kebijakan privasi yang dirujuk oleh formulir persetujuan di aplikasi adalah{' '}
            <strong>{POLICY_VERSION}</strong>. Perubahan material akan diumumkan dengan
            menaikkan nomor versi dan memperbarui teks persetujuan di alur check-in dan chat.
          </p>
        </section>
      </article>
    </div>
  );
}
