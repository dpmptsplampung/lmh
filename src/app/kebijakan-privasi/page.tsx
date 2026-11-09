import Link from 'next/link';
import type { Metadata } from 'next';
import { APP_NAME } from '@/lib/constants';

/** Selaras dengan versi persetujuan reservasi dan chat. */
const POLICY_VERSION = '1.0';

export const metadata: Metadata = {
  title: 'Kebijakan Privasi',
  description: `Kebijakan privasi ${APP_NAME}, DPMPTSP Provinsi Lampung`,
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
          padding: 'clamp(16px, 5vw, 32px)',
          overflowWrap: 'anywhere',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
          <Link href="/" style={{ color: 'var(--color-primary-600)', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
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
            5. Pencatatan Perilaku Penggunaan (Investment Gallery &amp; Peta Potensi)
          </h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Untuk meningkatkan layanan investasi, kami mencatat <strong>aktivitas penggunaan</strong>
            Anda pada fitur Investment Gallery dan Peta Potensi, misalnya dokumen yang Anda buka,
            sektor yang Anda lihat, dan halaman yang Anda kunjungi. Pencatatan ini digunakan
            <strong> semata untuk memahami minat calon investor</strong> dan menindaklanjuti
            penawaran yang relevan, serta diungkapkan sebagai dasar pemrosesan yang sah.
            Aktivitas login untuk fitur ini tercatat dalam <code>consent_log</code> saat Anda
            memberikan persetujuan. Anda dapat keberatan atas pencatatan ini dengan menghubungi
            kami melalui kontak di bawah.
          </p>
        </section>

        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-3)' }}>
            6. Katalog dan formulir UMKM
          </h2>
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            <p>
              Profil di katalog berasal dari data kurasi petugas, satudata, dan tamu yang datang ke loket.
              Petugas memeriksa setiap profil sebelum tampil. Petugas memeriksa agar nomor telepon, email,
              alamat rinci, atau nama pemilik usaha tidak tampil di halaman publik. LMH tidak membagikan
              nomor UMKM kepada pengunjung atau Front Office. Nomor hanya dapat dibuka ke akun perusahaan
              dengan izin pemilik usaha, seperti dijelaskan pada bagian permintaan nomor di bawah.
            </p>
            <p>
              Formulir Hubungi lewat petugas meminta nama, perusahaan, nomor kontak, dan pesan. Profil atau kata
              kunci yang sedang Anda lihat ikut terkirim. Petugas memakai data ini untuk membalas Anda. Formulir
              Laporkan meminta alasan dan catatan bila perlu, supaya petugas dapat menindaklanjuti masalah pada
              profil atau foto. Pengiriman formulir memakai sesi anonim untuk menahan kiriman berlebihan.
            </p>
            <p>
              Data kedua formulir kami simpan paling lama 180 hari sejak selesai ditangani, atau sejak aktivitas
              terakhir bila belum ditangani. Foto yang belum terbit kami simpan paling lama 30 hari sejak
              pengajuannya dibatalkan, atau 90 hari bila tidak ada aktivitas.
            </p>
            <p>
              Petugas membalas dari WhatsApp pribadi di ponselnya sendiri. Percakapan dan nomor kontak yang
              tersimpan di ponsel itu berada di luar LMH, dan LMH tidak dapat menghapusnya. Petugas yang
              berhenti bertugas diminta menghapus percakapan kerja, tetapi LMH tidak dapat membuktikan
              penghapusan itu.
            </p>
            <p>
              Nomor UMKM yang disimpan untuk meminta izin hanya dapat dibaca petugas yang sedang menangani tugas
              itu, dan setiap pembacaan dicatat.
            </p>
            <p>
              Tahap B, permintaan nomor oleh perusahaan. Perusahaan yang meminta nomor UMKM wajib masuk dengan
              akun pribadi dan mengisi nama perusahaan dan jabatan. Nama, email, dan HP diambil dari profil akun.
              Nomor UMKM hanya dibuka bila pemiliknya sudah memberi izin dan petugas menyetujui permintaan. Nomor
              hanya tampil di akun pemohon itu, tidak dikirim lewat WhatsApp, email, atau notifikasi. Pemilik UMKM
              dapat mencabut izin kapan saja dengan menghubungi petugas UMKM, lewat formulir di LMH, atau dari halaman Usaha saya. Sesudah
              dicabut, nomor tidak lagi tampil di akun perusahaan, tetapi
              perusahaan yang sudah mencatatnya mungkin masih menyimpannya. Petugas memakai WhatsApp pribadinya
              untuk menanyakan izin kepada UMKM dan memberi tahu pemohon. Riwayat chat di ponsel petugas berada di
              luar sistem LMH. Nama perusahaan dan jabatan disimpan selama akun Anda ada. Catatan permintaan
              dan Kebutuhan disimpan sampai 730 hari sesudah ditutup, sesudah izin dicabut, atau sesudah akun
              dihapus. Sesudah itu teks Kebutuhan, kontak yang dicatat petugas, serta nama dan jabatan perusahaan
              yang tidak terhubung ke akun dihapus.
            </p>
            <p>
              Tahap C, pemilik usaha. Pemilik usaha yang mendaftarkan atau mengklaim profil memakai akun
              pribadi. Pendaftar profil baru dapat memperbaiki profil dan fotonya selama pemeriksaan. Pengklaim
              profil yang sudah ada mendapat hak mengubah sesudah petugas memastikan penanggung jawab usaha.
              Untuk memastikan penanggung jawab usaha, petugas pemeriksa melihat nama, HP, dan email akun serta
              alasan klaim, dan dapat menghubungi Anda. Pemilik melihat nama perusahaan penerima nomor dan
              tanggalnya, tanpa data pribadi pemohon.
              Perubahan profil diperiksa petugas sebelum tampil.
            </p>
            <p>
              LMH dapat mencatat statistik katalog: tampilan profil, jumlah pencarian tanpa hasil tanpa
              menyimpan kata yang dicari, klik membuka formulir, dan tanda suka. Pencatatan ini tidak memakai
              cookie iklan. Untuk pengunjung yang belum login, LMH memakai cookie statistik acak yang berlaku
              24 jam agar kunjungan yang sama tidak terhitung dua kali. Bila Anda login, penanda harian
              dibuat dari ID akun dengan kunci rahasia. Penanda ini tidak menampilkan ID akun, tetapi
              LMH masih dapat mengaitkannya dengan akun selama 7 hari. Penanda harian kami simpan 7 hari,
              angka harian 95 hari, ringkasan pencarian tanpa hasil 24 bulan, dan jumlah total selama profil
              ada. Tanda suka dan tanggal pertama Anda menyukai tersimpan sampai akun dihapus.
              Membatalkan suka menonaktifkan tanda itu dan mengeluarkannya dari jumlah suka.
            </p>
          </div>
        </section>

        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-3)' }}>
            7. Hak Subjek Data
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
            8. Cara Kontak
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
            9. Versi Kebijakan
          </h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Versi kebijakan privasi yang dirujuk oleh formulir persetujuan di aplikasi adalah{' '}
            <strong>{POLICY_VERSION}</strong>. Perubahan material akan diumumkan dengan
            menaikkan nomor versi dan memperbarui teks persetujuan pada layanan yang terkait.
          </p>
        </section>
      </article>
    </div>
  );
}
