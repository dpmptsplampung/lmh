// Seed FAQ knowledge base per layanan, lalu biarkan pipeline embed mengisi embedding.
// Aman zero-hallucination: jawaban bersifat umum & stabil (tidak menyebut angka/biaya
// yang mudah berubah). Set perlu_embed_ulang=true agar diproses embed (3072-dim).
import { readFileSync } from 'node:fs';
readFileSync('.env.local', 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
});
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const L = {
  BALMON: '2af4d908-7374-40f3-b6c6-de8fa5e88358',
  BANK_LAMPUNG: '20e1282d-a951-49a9-8aed-b413b1140aca',
  BPJS: '0ad0b7d4-07db-4d7e-9efe-23dfcb26c175',
  OSS: '8d1025b2-5fe8-4117-8882-d5e5eeedc734',
  JASA_INDUSTRI: '7114ddc1-5aae-493b-b1e5-125cc6256e88',
  PERIZINAN: '6052844e-eded-4c3d-a4e0-89384b5c9755',
  HALAL: '1098d6cb-c9aa-4dff-8e3d-b2f821ec2503',
  PERIKANAN: 'e588d321-ad23-405c-ad3d-6bbd6aa9084c',
};

// { layanan, pertanyaan, jawaban, urutan }
const FAQS = [
  // ---- Helpdesk OSS ----
  { layanan: L.OSS, urutan: 1, pertanyaan: 'Bagaimana cara membuat akun OSS?', jawaban: 'Akun OSS dibuat secara online melalui portal resmi OSS RBA (oss.go.id). Langkah umumnya: (1) buka oss.go.id dan pilih "Daftar", (2) pilih jenis pelaku usaha (perorangan atau badan usaha), (3) isi data sesuai identitas (NIK untuk perorangan, atau data akta/penanggung jawab untuk badan usaha), (4) verifikasi melalui email yang didaftarkan, lalu (5) login dan lengkapi profil. Jika Anda kesulitan saat pendaftaran, petugas Helpdesk OSS kami siap membantu.' },
  { layanan: L.OSS, urutan: 2, pertanyaan: 'Apa itu NIB dan bagaimana cara mendapatkannya?', jawaban: 'NIB (Nomor Induk Berusaha) adalah identitas pelaku usaha yang diterbitkan melalui sistem OSS RBA dan berlaku sebagai perizinan dasar berusaha. Cara mendapatkannya: (1) login ke akun OSS Anda di oss.go.id, (2) lengkapi data usaha (bidang usaha/KBLI, lokasi, modal, dsb.), (3) ajukan permohonan perizinan berusaha, lalu (4) NIB terbit secara elektronik dan dapat diunduh. Prosesnya sepenuhnya online. Untuk pendampingan, silakan datang ke Helpdesk OSS kami.' },
  { layanan: L.OSS, urutan: 3, pertanyaan: 'Apakah pengurusan NIB melalui OSS berbayar?', jawaban: 'Penerbitan NIB melalui sistem OSS RBA pada dasarnya tidak dipungut biaya (gratis) karena dilakukan mandiri secara elektronik oleh pelaku usaha. Namun, tergantung sektor/bidang usaha, bisa saja ada perizinan lanjutan atau kewajiban lain yang memiliki ketentuan tersendiri. Untuk kepastian sesuai bidang usaha Anda, silakan konsultasikan dengan petugas kami.' },
  { layanan: L.OSS, urutan: 4, pertanyaan: 'Saya lupa password akun OSS, bagaimana cara mengatasinya?', jawaban: 'Jika lupa password akun OSS: (1) buka halaman login oss.go.id, (2) pilih "Lupa Password", (3) masukkan email yang terdaftar, lalu (4) ikuti tautan reset yang dikirim ke email Anda untuk membuat password baru. Pastikan Anda masih memiliki akses ke email terdaftar. Bila email sudah tidak aktif atau ada kendala lain, petugas Helpdesk OSS dapat membantu proses pemulihannya.' },

  // ---- Sertifikasi Halal ----
  { layanan: L.HALAL, urutan: 1, pertanyaan: 'Bagaimana cara mengajukan sertifikat Halal?', jawaban: 'Sertifikasi Halal diajukan secara online melalui platform PTSP Halal (bpjph.halal.go.id). Untuk UMK mikro/kecil terdapat skema Self Declare yang prosesnya lebih sederhana. Tahapan umumnya: (1) buat akun di portal BPJPH, (2) lengkapi data pelaku usaha dan produk, (3) unggah dokumen persyaratan yang diminta, lalu (4) ikuti proses sesuai skema yang dipilih hingga sertifikat terbit. Petugas kami siap mendampingi proses pengajuannya.' },
  { layanan: L.HALAL, urutan: 2, pertanyaan: 'Apakah sertifikasi Halal untuk UMK gratis?', jawaban: 'Untuk UMK mikro dan kecil, tersedia program sertifikasi Halal gratis melalui skema Self Declare (program Sehati) sesuai kuota dan ketentuan pemerintah yang berlaku. Ketersediaan kuota dapat berubah dari waktu ke waktu. Untuk mengecek apakah usaha Anda memenuhi kriteria dan apakah kuota gratis sedang tersedia, silakan konsultasikan dengan petugas kami.' },
  { layanan: L.HALAL, urutan: 3, pertanyaan: 'Apa saja dokumen yang diperlukan untuk sertifikasi Halal Self Declare?', jawaban: 'Untuk skema Self Declare bagi UMK, umumnya diperlukan: (1) identitas pemilik usaha (KTP), (2) data usaha dan produk yang akan disertifikasi, (3) daftar bahan yang digunakan, serta (4) pernyataan kesanggupan memenuhi kriteria halal. Dokumen detail dapat bervariasi sesuai jenis produk. Petugas kami dapat membantu memastikan kelengkapan sebelum pengajuan.' },
  { layanan: L.HALAL, urutan: 4, pertanyaan: 'Berapa lama masa berlaku sertifikat Halal?', jawaban: 'Sertifikat Halal yang diterbitkan BPJPH berlaku sesuai ketentuan peraturan yang berlaku, dan pelaku usaha wajib menjaga konsistensi kehalalan produk selama masa berlaku tersebut. Bila ada perubahan bahan atau proses produksi, perubahan itu wajib dilaporkan. Untuk ketentuan masa berlaku dan kewajiban pembaruan terkini, silakan konsultasikan dengan petugas kami.' },

  // ---- BPJS Kesehatan ----
  { layanan: L.BPJS, urutan: 1, pertanyaan: 'Bagaimana cara mendaftar BPJS Kesehatan?', jawaban: 'Pendaftaran BPJS Kesehatan dapat dilakukan secara online melalui aplikasi Mobile JKN atau situs resmi BPJS Kesehatan, maupun secara offline di kantor cabang BPJS terdekat. Siapkan dokumen seperti Kartu Keluarga (KK), KTP, dan alamat email/nomor HP aktif. Setelah terdaftar Anda akan mendapatkan nomor kartu JKN. Petugas kami dapat membantu menjelaskan jalur pendaftaran yang sesuai dengan kondisi Anda (pekerja, mandiri, atau peserta bantuan).' },
  { layanan: L.BPJS, urutan: 2, pertanyaan: 'Apa perbedaan peserta BPJS PBI dan mandiri?', jawaban: 'Peserta PBI (Penerima Bantuan Iuran) adalah peserta yang iurannya dibayarkan oleh pemerintah bagi masyarakat yang memenuhi kriteria tertentu. Peserta mandiri (PBPU) membayar iuran sendiri setiap bulan sesuai kelas perawatan yang dipilih. Perbedaan utamanya pada siapa yang membayar iuran dan besaran manfaat ruang perawatan. Untuk mengetahui kategori yang tepat bagi Anda, silakan konsultasikan dengan petugas kami.' },
  { layanan: L.BPJS, urutan: 3, pertanyaan: 'Bagaimana cara mengubah data peserta BPJS (alamat, kelas, dsb.)?', jawaban: 'Perubahan data peserta BPJS Kesehatan (seperti alamat, fasilitas kesehatan tingkat pertama, atau kelas perawatan) dapat dilakukan melalui aplikasi Mobile JKN, situs resmi BPJS Kesehatan, atau kantor cabang BPJS. Beberapa perubahan memerlukan dokumen pendukung. Untuk jenis perubahan tertentu ada ketentuan waktu berlaku. Petugas kami dapat membantu memandu langkah yang sesuai dengan kebutuhan Anda.' },
  { layanan: L.BPJS, urutan: 4, pertanyaan: 'Bagaimana cara membayar iuran BPJS Kesehatan?', jawaban: 'Iuran BPJS Kesehatan dapat dibayarkan melalui berbagai kanal resmi, antara lain: aplikasi Mobile JKN, mobile/internet banking bank yang bekerja sama, ATM, gerai retail yang ditunjuk, dan kanal pembayaran resmi lainnya. Untuk peserta mandiri, pembayaran dilakukan setiap bulan sebelum tanggal jatuh tempo. Petugas kami dapat membantu menjelaskan kanal pembayaran yang paling mudah bagi Anda.' },

  // ---- Bank Lampung ----
  { layanan: L.BANK_LAMPUNG, urutan: 1, pertanyaan: 'Bagaimana cara membuka rekening di Bank Lampung?', jawaban: 'Pembukaan rekening Bank Lampung umumnya dilakukan di kantor cabang Bank Lampung terdekat dengan membawa identitas diri (KTP) dan dokumen pendukung sesuai jenis rekening yang dipilih. Petugas akan membantu mengisi formulir dan menjelaskan produk tabungan yang tersedia. Untuk persyaratan spesifik per produk, silakan konsultasikan dengan petugas kami atau kunjungi kantor cabang terdekat.' },
  { layanan: L.BANK_LAMPUNG, urutan: 2, pertanyaan: 'Apakah Bank Lampung menyediakan pembiayaan untuk UMKM?', jawaban: 'Ya. Bank Lampung menyediakan produk pembiayaan/kredit yang ditujukan untuk mendukung pelaku UMKM, sesuai dengan ketentuan dan kriteria yang berlaku. Jenis, syarat, dan skema pembiayaan dapat berbeda per produk. Untuk mengetahui produk pembiayaan yang paling sesuai dengan usaha Anda, silakan konsultasikan dengan petugas kami.' },
  { layanan: L.BANK_LAMPUNG, urutan: 3, pertanyaan: 'Bagaimana cara mengajukan KUR di Bank Lampung?', jawaban: 'Kredit Usaha Rakyat (KUR) adalah program pembiayaan bagi pelaku usaha mikro, kecil, dan menengah yang layak tetapi belum memiliki agunan yang cukup. Pengajuan KUR di Bank Lampung dilakukan dengan menyiapkan dokumen identitas, dokumen usaha, dan mengisi formulir permohonan di kantor cabang. Kelayakan akan dinilai oleh bank. Untuk syarat dan ketentuan terkini, silakan konsultasikan dengan petugas kami.' },

  // ---- Layanan Perizinan DPMPTSP ----
  { layanan: L.PERIZINAN, urutan: 1, pertanyaan: 'Jenis perizinan apa saja yang bisa diurus di DPMPTSP?', jawaban: 'DPMPTSP Provinsi Lampung melayani berbagai perizinan dan non-perizinan sesuai kewenangan provinsi, antara lain yang berkaitan dengan penanaman modal, perizinan berusaha berbasis risiko, dan layanan terkait lainnya. Kewenangan antara tingkat kabupaten/kota, provinsi, dan pusat berbeda-beda. Untuk memastikan perizinan Anda menjadi kewenangan kami, silakan sampaikan jenis usaha/kegiatan Anda kepada petugas.' },
  { layanan: L.PERIZINAN, urutan: 2, pertanyaan: 'Bagaimana alur mengajukan perizinan di DPMPTSP?', jawaban: 'Secara umum alurnya: (1) siapkan dokumen persyaratan sesuai jenis perizinan, (2) ajukan permohonan (sebagian besar dapat melalui sistem OSS atau kanal yang ditentukan), (3) petugas memverifikasi kelengkapan dan keabsahan berkas, (4) bila perlu ada tahapan teknis/lapangan sesuai jenis izin, lalu (5) izin diterbitkan bila semua ketentuan terpenuhi. Untuk alur detail sesuai jenis perizinan Anda, silakan konsultasikan dengan petugas kami.' },
  { layanan: L.PERIZINAN, urutan: 3, pertanyaan: 'Apa saja dokumen umum yang perlu disiapkan untuk perizinan?', jawaban: 'Dokumen yang umum diperlukan antara lain: identitas pemohon (KTP), NPWP (bila ada), data/legalitas usaha, serta dokumen teknis yang spesifik sesuai jenis perizinan (mis. dokumen lokasi, rencana usaha, dsb.). Setiap jenis izin memiliki daftar persyaratan yang berbeda. Untuk daftar persyaratan yang tepat sesuai perizinan Anda, silakan konsultasikan dengan petugas kami terlebih dahulu.' },
  { layanan: L.PERIZINAN, urutan: 4, pertanyaan: 'Bagaimana cara mengecek status permohonan perizinan saya?', jawaban: 'Anda dapat mengecek status permohonan melalui kanal yang sama dengan saat Anda mengajukan (mis. akun OSS untuk perizinan berusaha), atau dengan menghubungi/mendatangi loket layanan kami dengan membawa bukti/nomor permohonan. Petugas akan membantu melacak posisi berkas Anda dan menjelaskan tahapan berikutnya.' },

  // ---- Layanan Jasa Industri ----
  { layanan: L.JASA_INDUSTRI, urutan: 1, pertanyaan: 'Layanan apa saja yang tersedia di Layanan Jasa Industri?', jawaban: 'Layanan Jasa Industri melayani kebutuhan sertifikasi dan pengujian produk industri, antara lain terkait sertifikasi SNI, pengujian mutu produk, dan kalibrasi peralatan, sesuai lingkup layanan yang tersedia. Untuk memastikan layanan yang Anda butuhkan tersedia dan syaratnya apa, silakan sampaikan jenis produk/kebutuhan Anda kepada petugas kami.' },
  { layanan: L.JASA_INDUSTRI, urutan: 2, pertanyaan: 'Bagaimana cara mengajukan sertifikasi SNI untuk produk saya?', jawaban: 'Sertifikasi SNI umumnya diajukan dengan: (1) menyiapkan dokumen legalitas usaha dan data produk, (2) mengajukan permohonan ke lembaga sertifikasi yang berwenang, (3) mengikuti proses audit/uji produk sesuai standar yang relevan, lalu (4) sertifikat diterbitkan bila produk memenuhi standar. Petugas kami dapat membantu menjelaskan alur dan memandu persiapannya.' },
  { layanan: L.JASA_INDUSTRI, urutan: 3, pertanyaan: 'Apakah tersedia layanan pengujian/kalibrasi alat industri?', jawaban: 'Ya, tersedia layanan pengujian dan/atau kalibrasi untuk peralatan industri tertentu sesuai kemampuan laboratorium yang tersedia. Jenis alat dan parameter yang dapat diuji/dikalibrasi berbeda-beda. Untuk memastikan alat Anda dapat dilayani dan jadwalnya, silakan konsultasikan dengan petugas kami.' },

  // ---- Sertifikasi Mutu Perikanan ----
  { layanan: L.PERIKANAN, urutan: 1, pertanyaan: 'Apa itu Sertifikasi Kelayakan Pengolahan (SKP) hasil perikanan?', jawaban: 'Sertifikasi Kelayakan Pengolahan (SKP) adalah sertifikasi yang menunjukkan bahwa unit pengolahan hasil perikanan telah memenuhi persyaratan kelayakan mutu dan keamanan pangan. SKP penting bagi pelaku usaha pengolahan perikanan, termasuk untuk kebutuhan pemasaran dan ekspor. Petugas kami dapat menjelaskan apakah usaha Anda wajib/memerlukan SKP.' },
  { layanan: L.PERIKANAN, urutan: 2, pertanyaan: 'Bagaimana cara mengajukan sertifikasi mutu hasil perikanan?', jawaban: 'Pengajuan sertifikasi mutu/kelayakan hasil perikanan umumnya meliputi: (1) menyiapkan dokumen legalitas usaha dan data unit pengolahan, (2) mengajukan permohonan ke instansi berwenang, (3) mengikuti penilaian/inspeksi kesesuaian terhadap persyaratan mutu dan keamanan, lalu (4) sertifikat diterbitkan bila memenuhi syarat. Petugas kami siap memandu persiapan dokumen dan prosesnya.' },
  { layanan: L.PERIKANAN, urutan: 3, pertanyaan: 'Dokumen apa saja yang diperlukan untuk sertifikasi hasil perikanan?', jawaban: 'Dokumen yang umum diperlukan antara lain: identitas pemilik usaha, legalitas usaha, serta dokumen yang menggambarkan proses pengolahan dan penerapan higiene/sanitasi di unit Anda. Persyaratan rinci bergantung pada jenis sertifikasi dan skala usaha. Untuk daftar persyaratan yang tepat, silakan konsultasikan dengan petugas kami.' },

  // ---- BALMON ----
  { layanan: L.BALMON, urutan: 1, pertanyaan: 'Apa itu BALMON dan layanan apa yang disediakan?', jawaban: 'BALMON (Balai Monitor Spektrum Frekuensi Radio) menyelenggarakan layanan terkait spektrum frekuensi radio, antara lain perizinan penggunaan frekuensi radio dan sertifikasi perangkat telekomunikasi, sesuai kewenangannya. Untuk memastikan layanan yang Anda butuhkan, silakan sampaikan jenis keperluan Anda (izin frekuensi atau sertifikasi alat) kepada petugas kami.' },
  { layanan: L.BALMON, urutan: 2, pertanyaan: 'Bagaimana cara mengurus izin penggunaan frekuensi radio?', jawaban: 'Perizinan penggunaan frekuensi radio diajukan sesuai ketentuan peraturan di bidang spektrum frekuensi. Secara umum Anda perlu menyiapkan identitas/legalitas pemohon dan spesifikasi teknis perangkat serta kebutuhan frekuensinya, lalu mengajukan permohonan ke unit yang berwenang. Petugas kami dapat membantu menjelaskan alur dan persyaratan sesuai jenis penggunaan Anda.' },
  { layanan: L.BALMON, urutan: 3, pertanyaan: 'Bagaimana cara sertifikasi alat telekomunikasi?', jawaban: 'Sertifikasi alat telekomunikasi bertujuan memastikan perangkat memenuhi persyaratan teknis sebelum digunakan/dipasarkan. Prosesnya umumnya meliputi pengajuan permohonan, pengujian perangkat di laboratorium yang ditunjuk, dan penerbitan sertifikat bila lulus. Petugas kami dapat membantu menjelaskan alur pengujian dan dokumen yang perlu disiapkan.' },
];

async function main() {
  console.log(`Menyisipkan ${FAQS.length} FAQ...`);
  const rows = FAQS.map((f) => ({
    layanan_id: f.layanan,
    pertanyaan: f.pertanyaan,
    jawaban: f.jawaban,
    aktif: true,
    urutan: f.urutan,
    perlu_embed_ulang: true, // trigger pipeline embed (3072-dim)
  }));
  const { data, error } = await sb.from('faq_knowledge_base').insert(rows).select('id, pertanyaan');
  if (error) { console.error('INSERT ERROR:', error.message); process.exit(1); }
  console.log(`✓ ${data.length} FAQ tersisip.`);
  const { count } = await sb.from('faq_knowledge_base').select('*', { count: 'exact', head: true }).is('embedding', null);
  console.log(`Menunggu embed: ${count} baris (embedding IS NULL).`);
}
main();
