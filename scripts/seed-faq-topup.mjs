// Top-up FAQ live chat hingga minimal 10 FAQ relevan per layanan.
// Setiap jawaban menyebutkan dasar regulasi agar dapat diaudit dan tidak
// bergantung pada klaim operasional yang mudah berubah.
import { readFileSync } from 'node:fs';

readFileSync('.env.local', 'utf8').split(/\r?\n/).forEach((line) => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
});

const [{ createClient }, { GoogleGenerativeAI }] = await Promise.all([
  import('@supabase/supabase-js'),
  import('@google/generative-ai'),
]);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!url || !serviceKey || !geminiApiKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, dan GEMINI_API_KEY wajib tersedia.',
  );
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

const LAYANAN = {
  BALMON: '2af4d908-7374-40f3-b6c6-de8fa5e88358',
  BANK_LAMPUNG: '20e1282d-a951-49a9-8aed-b413b1140aca',
  BPJS: '0ad0b7d4-07db-4d7e-9efe-23dfcb26c175',
  OSS: '8d1025b2-5fe8-4117-8882-d5e5eeedc734',
  JASA_INDUSTRI: '7114ddc1-5aae-493b-b1e5-125cc6256e88',
  PERIZINAN: '6052844e-eded-4c3d-a4e0-89384b5c9755',
  HALAL: '1098d6cb-c9aa-4dff-8e3d-b2f821ec2503',
  PERIKANAN: 'e588d321-ad23-405c-ad3d-6bbd6aa9084c',
};

const TARGET_PER_LAYANAN = 10;
const MISPLACED_NIB_QUESTION = 'Apa saja syarat membuat NIB?';

// { layanan, pertanyaan, jawaban }
const FAQS = [
  // ---- Helpdesk OSS (PP 28/2025; PP 5/2021 sudah dicabut) ----
  { layanan: LAYANAN.OSS, pertanyaan: 'Apakah NIB saja sudah cukup untuk menjalankan semua jenis usaha?', jawaban: 'Belum tentu. Berdasarkan Peraturan Pemerintah Nomor 28 Tahun 2025, dokumen perizinan ditentukan oleh tingkat risiko kegiatan usaha. Usaha berisiko rendah menggunakan NIB; risiko menengah memerlukan NIB dan Sertifikat Standar; sedangkan risiko tinggi memerlukan NIB dan Izin. Untuk risiko menengah tinggi, Sertifikat Standar harus telah terverifikasi sebelum kegiatan operasional atau komersial dijalankan. Periksa tingkat risiko berdasarkan KBLI dan skala usaha pada Sistem OSS.' },
  { layanan: LAYANAN.OSS, pertanyaan: 'Apa perbedaan Sertifikat Standar yang belum dan sudah terverifikasi?', jawaban: 'Berdasarkan Peraturan Pemerintah Nomor 28 Tahun 2025, pada usaha risiko menengah tinggi Sistem OSS terlebih dahulu menerbitkan Sertifikat Standar dengan keterangan belum terverifikasi setelah pelaku usaha menyatakan kesanggupan memenuhi standar. Dokumen tersebut menjadi dasar tahap persiapan, tetapi kegiatan operasional atau komersial baru dapat dijalankan setelah standar dipenuhi, diverifikasi oleh instansi berwenang, dan status Sertifikat Standar dinyatakan telah terverifikasi.' },
  { layanan: LAYANAN.OSS, pertanyaan: 'Apa saja persyaratan dasar yang mungkin harus dipenuhi melalui OSS?', jawaban: 'Menurut Peraturan Pemerintah Nomor 28 Tahun 2025, persyaratan dasar dapat meliputi Kesesuaian Kegiatan Pemanfaatan Ruang atau KKPR, Persetujuan Lingkungan, serta Persetujuan Bangunan Gedung dan Sertifikat Laik Fungsi. Kebutuhannya bergantung pada lokasi, jenis kegiatan, dampak lingkungan, dan penggunaan bangunan. Karena itu, tidak setiap kegiatan usaha otomatis memerlukan seluruh dokumen tersebut.' },
  { layanan: LAYANAN.OSS, pertanyaan: 'Apa itu PB UMKU dan kapan harus diurus?', jawaban: 'Peraturan Pemerintah Nomor 28 Tahun 2025 mengatur PB UMKU sebagai Perizinan Berusaha untuk Menunjang Kegiatan Usaha. Dokumen ini diperlukan apabila pada tahap operasional atau komersial usaha membutuhkan persetujuan tambahan, misalnya terkait peredaran produk, kelayakan operasi, atau standardisasi produk atau jasa. Jenis dan persyaratannya berbeda menurut sektor dan kegiatan usaha. Jika dipersyaratkan, permohonannya diajukan melalui Sistem OSS kepada instansi yang berwenang.' },
  { layanan: LAYANAN.OSS, pertanyaan: 'Apakah izin di OSS perlu diperbarui saat usaha berkembang atau berubah?', jawaban: 'Ya. Peraturan Pemerintah Nomor 28 Tahun 2025 mengatur bahwa data dan perizinan perlu disesuaikan apabila pengembangan usaha menambah kapasitas produksi atau jasa, lokasi usaha, maupun kegiatan usaha. Perubahan dan perluasan Perizinan Berusaha atau PB UMKU diproses melalui Sistem OSS. Pastikan KBLI, lokasi, kapasitas, dan data kegiatan tetap sesuai dengan kondisi usaha sebelum menjalankan perubahan tersebut.' },
  // Kandidat cadangan; guard target hanya mengambilnya jika salah satu FAQ di atas sudah ada.
  { layanan: LAYANAN.OSS, pertanyaan: 'Mengapa pelaku usaha tetap dapat diperiksa setelah izin OSS terbit?', jawaban: 'Terbitnya dokumen OSS tidak menghapus kewajiban mematuhi standar usaha dan ketentuan perizinan. Berdasarkan Peraturan Pemerintah Nomor 28 Tahun 2025, pemerintah melakukan pengawasan berbasis risiko terhadap persyaratan dasar, Perizinan Berusaha, PB UMKU, dan kewajiban penanaman modal. Pengawasan dapat dilakukan melalui pemeriksaan laporan dan atau inspeksi lapangan. Karena itu, pelaku usaha harus menjaga kesesuaian kegiatan, memenuhi standar, dan menyampaikan laporan yang diwajibkan.' },

  // ---- Layanan Perizinan DPMPTSP (PP 6/2021; PP 28/2025) ----
  { layanan: LAYANAN.PERIZINAN, pertanyaan: 'Apakah semua perizinan usaha di Lampung menjadi kewenangan DPMPTSP Provinsi Lampung?', jawaban: 'Tidak. Peraturan Pemerintah Nomor 6 Tahun 2021 membagi kewenangan perizinan antara Pemerintah Pusat, pemerintah provinsi, dan pemerintah kabupaten atau kota sesuai jenis kegiatan, lokasi, sektor, dan peraturan yang berlaku. Kepala DPMPTSP provinsi melaksanakan kewenangan yang didelegasikan gubernur, sedangkan kewenangan kabupaten atau kota dilaksanakan melalui DPMPTSP kabupaten atau kota. Sistem OSS meneruskan permohonan kepada instansi berwenang berdasarkan data usaha yang dimasukkan.' },
  { layanan: LAYANAN.PERIZINAN, pertanyaan: 'Apakah pelayanan perizinan berusaha di DPMPTSP dipungut biaya?', jawaban: 'Berdasarkan Pasal 14 Peraturan Pemerintah Nomor 6 Tahun 2021, pelayanan perizinan berusaha oleh DPMPTSP pada dasarnya tidak dipungut biaya. Namun, perizinan tertentu dapat dikenai retribusi daerah jika memiliki dasar hukum. PNBP atau pungutan resmi sektoral juga dapat berlaku untuk proses tertentu. Jangan melakukan pembayaran tanpa kode billing, tanda bukti, atau dasar pungutan resmi.' },
  { layanan: LAYANAN.PERIZINAN, pertanyaan: 'Saya kesulitan mengoperasikan OSS. Apakah DPMPTSP dapat membantu?', jawaban: 'Ya. Pasal 11 dan Pasal 12 Peraturan Pemerintah Nomor 6 Tahun 2021 mengatur pelayanan berbantuan. Pengajuan OSS pada dasarnya dilakukan mandiri menggunakan fasilitas sendiri atau fasilitas DPMPTSP. Jika pelaku usaha belum dapat menggunakannya, DPMPTSP dapat memberikan pelayanan berbantuan secara interaktif. Bantuan juga dapat diberikan ketika layanan OSS belum tersedia atau mengalami gangguan teknis, dengan koordinasi bersama Lembaga OSS.' },
  { layanan: LAYANAN.PERIZINAN, pertanyaan: 'Konsultasi apa yang dapat diminta kepada DPMPTSP?', jawaban: 'Pasal 20 Peraturan Pemerintah Nomor 6 Tahun 2021 mengatur konsultasi mengenai jenis layanan perizinan berusaha, aspek hukum perizinan, dan pendampingan teknis. Konsultasi dapat diberikan secara langsung maupun daring. Jika pertanyaan memerlukan penilaian teknis sektoral, DPMPTSP berkoordinasi dengan perangkat daerah teknis yang berwenang. Hasil konsultasi bukan pengganti persetujuan atau dokumen izin yang dipersyaratkan.' },
  { layanan: LAYANAN.PERIZINAN, pertanyaan: 'Bagaimana menyampaikan pengaduan atas pelayanan perizinan?', jawaban: 'Berdasarkan Pasal 15 dan Pasal 16 Peraturan Pemerintah Nomor 6 Tahun 2021, pengaduan dapat disampaikan melalui sarana resmi DPMPTSP dan dikelola secara cepat, tepat, transparan, adil, tidak diskriminatif, serta tanpa biaya. Sertakan identitas, uraian masalah, nomor permohonan jika ada, dan bukti pendukung agar pengaduan dapat ditelaah serta ditindaklanjuti.' },
  { layanan: LAYANAN.PERIZINAN, pertanyaan: 'Apa kewajiban penanam modal setelah usahanya memperoleh perizinan?', jawaban: 'Pasal 15 dan Pasal 16 Undang-Undang Nomor 25 Tahun 2007 mewajibkan penanam modal menerapkan tata kelola perusahaan yang baik, melaksanakan tanggung jawab sosial perusahaan, menyampaikan laporan kegiatan penanaman modal sesuai ketentuan, menghormati budaya masyarakat sekitar, dan menaati peraturan. Penanam modal juga bertanggung jawab menjaga lingkungan serta keselamatan, kesehatan, kenyamanan, dan kesejahteraan pekerja. Izin yang terbit bukan akhir kewajiban kepatuhan.' },

  // ---- Sertifikasi Halal (PP 42/2024; PP 39/2021 sudah dicabut) ----
  { layanan: LAYANAN.HALAL, pertanyaan: 'Apakah produk dari bahan tidak halal tetap harus memiliki sertifikat halal?', jawaban: 'Pasal 2 Peraturan Pemerintah Nomor 42 Tahun 2024 mengecualikan produk yang berasal dari bahan yang diharamkan dari kewajiban memiliki sertifikat halal. Namun, produk tersebut wajib diberi keterangan tidak halal. Pengecualian sertifikasi bukan berarti produk dapat dipasarkan tanpa informasi yang jelas kepada konsumen.' },
  { layanan: LAYANAN.HALAL, pertanyaan: 'Produk dan jasa apa saja yang termasuk cakupan kewajiban sertifikasi halal?', jawaban: 'Menurut Peraturan Pemerintah Nomor 42 Tahun 2024, cakupan kewajiban sertifikasi halal meliputi barang dan jasa. Barang mencakup makanan, minuman, obat, kosmetik, produk kimiawi, produk biologi, produk rekayasa genetik, serta barang gunaan tertentu. Jasa mencakup penyembelihan, pengolahan, penyimpanan, pengemasan, pendistribusian, penjualan, dan penyajian. Penerapannya mengikuti batasan dan penahapan yang diatur untuk setiap kelompok produk.' },
  { layanan: LAYANAN.HALAL, pertanyaan: 'Kapan batas penahapan sertifikasi halal makanan dan minuman untuk usaha mikro dan kecil?', jawaban: 'Berdasarkan Pasal 159 dan Pasal 160 Peraturan Pemerintah Nomor 42 Tahun 2024, penahapan kewajiban sertifikasi halal bagi pelaku usaha mikro dan kecil untuk produk makanan, minuman, hasil sembelihan, dan jasa penyembelihan berlangsung sampai 17 Oktober 2026. Pelaku usaha sebaiknya mengajukan sebelum masa penahapan berakhir agar tersedia waktu untuk pemeriksaan atau verifikasi sesuai skema yang digunakan.' },
  { layanan: LAYANAN.HALAL, pertanyaan: 'Apakah tempat dan alat produksi halal harus dipisahkan dari produksi tidak halal?', jawaban: 'Ya. Peraturan Pemerintah Nomor 42 Tahun 2024 mewajibkan lokasi, tempat, dan alat Proses Produk Halal pada prinsipnya dipisahkan dari proses produk tidak halal. Pemisahan meliputi penyembelihan, pengolahan, penyimpanan, pengemasan, pendistribusian, penjualan, dan penyajian. Tempat dan alat juga harus dijaga kebersihan dan higienitasnya serta bebas dari najis dan bahan tidak halal.' },
  { layanan: LAYANAN.HALAL, pertanyaan: 'Apakah pelaku usaha wajib memiliki Penyelia Halal dan apa tugasnya?', jawaban: 'Peraturan Pemerintah Nomor 42 Tahun 2024 mewajibkan pelaku usaha yang mengajukan sertifikat halal memiliki Penyelia Halal. Penyelia bertugas mengawasi Proses Produk Halal, menentukan tindakan perbaikan dan pencegahan, mengoordinasikan proses tersebut, dan mendampingi Auditor Halal saat pemeriksaan. Penyelia Halal harus memenuhi persyaratan agama serta kompetensi yang ditetapkan dalam peraturan.' },
  { layanan: LAYANAN.HALAL, pertanyaan: 'Apa yang harus dilakukan jika bahan atau proses berubah setelah sertifikat halal terbit?', jawaban: 'Berdasarkan Pasal 51 Peraturan Pemerintah Nomor 42 Tahun 2024, pelaku usaha wajib memperbarui sertifikat halal jika terdapat perubahan komposisi bahan dan atau Proses Produk Halal serta melaporkan perubahan tersebut kepada BPJPH. Selama sertifikat berlaku, pelaku usaha juga wajib mencantumkan Label Halal, menjaga kehalalan produk, dan mempertahankan pemisahan proses halal dari proses tidak halal.' },

  // ---- BPJS Kesehatan (Perpres 82/2018 sebagaimana diubah Perpres 59/2024) ----
  { layanan: LAYANAN.BPJS, pertanyaan: 'Apakah setiap penduduk Indonesia wajib menjadi peserta JKN?', jawaban: 'Ya. Pasal 6 Peraturan Presiden Nomor 82 Tahun 2018 tentang Jaminan Kesehatan, sebagaimana terakhir diubah dengan Peraturan Presiden Nomor 59 Tahun 2024, mewajibkan setiap penduduk Indonesia ikut serta dalam program Jaminan Kesehatan. Keikutsertaan dilakukan dengan mendaftar sendiri atau didaftarkan kepada BPJS Kesehatan sesuai kategori kepesertaannya.' },
  { layanan: LAYANAN.BPJS, pertanyaan: 'Apakah peserta pekerja penerima upah yang terkena PHK masih memperoleh manfaat JKN?', jawaban: 'Pasal 27 Peraturan Presiden Nomor 82 Tahun 2018 sebagaimana terakhir diubah dengan Peraturan Presiden Nomor 59 Tahun 2024 mengatur bahwa peserta Pekerja Penerima Upah yang mengalami PHK tetap memperoleh manfaat Jaminan Kesehatan paling lama enam bulan sejak PHK tanpa membayar iuran, sepanjang PHK dibuktikan dengan dokumen yang ditentukan. Jika sudah bekerja kembali, peserta wajib melanjutkan kepesertaan melalui pemberi kerja atau mendaftar sendiri.' },
  { layanan: LAYANAN.BPJS, pertanyaan: 'Apakah bayi baru lahir dari peserta memperoleh manfaat JKN?', jawaban: 'Peraturan Presiden Nomor 82 Tahun 2018 sebagaimana terakhir diubah dengan Peraturan Presiden Nomor 59 Tahun 2024 mengatur manfaat medis Jaminan Kesehatan bagi bayi baru lahir dari peserta paling lama 28 hari sejak dilahirkan. Agar perlindungan berlanjut setelah masa tersebut, orang tua perlu segera memenuhi administrasi pendaftaran bayi melalui kanal resmi BPJS Kesehatan.' },
  { layanan: LAYANAN.BPJS, pertanyaan: 'Pelayanan kesehatan apa saja yang dijamin oleh JKN?', jawaban: 'Pasal 46 dan Pasal 47 Peraturan Presiden Nomor 82 Tahun 2018 sebagaimana terakhir diubah dengan Peraturan Presiden Nomor 59 Tahun 2024 mengatur manfaat promotif, preventif, kuratif, dan rehabilitatif sesuai kebutuhan medis. Jaminan mencakup pelayanan tingkat pertama dan rujukan tingkat lanjutan, seperti pemeriksaan, konsultasi, tindakan medis sesuai indikasi, obat, pemeriksaan penunjang, rehabilitasi medis, pelayanan darah, dan rawat inap sesuai tata cara JKN.' },
  { layanan: LAYANAN.BPJS, pertanyaan: 'Pelayanan apa saja yang tidak dijamin oleh BPJS Kesehatan?', jawaban: 'Pasal 52 Peraturan Presiden Nomor 82 Tahun 2018 sebagaimana terakhir diubah dengan Peraturan Presiden Nomor 59 Tahun 2024 mengecualikan sejumlah layanan, antara lain pelayanan yang tidak sesuai ketentuan, pelayanan pada fasilitas yang tidak bekerja sama kecuali keadaan darurat, pelayanan di luar negeri, pelayanan untuk tujuan estetik, penanganan infertilitas, ortodonsi, serta pengobatan yang masih bersifat percobaan. Layanan yang ditanggung program jaminan lain juga tidak ditanggung kembali oleh JKN.' },
  { layanan: LAYANAN.BPJS, pertanyaan: 'Apa akibatnya jika peserta menunggak iuran dan bagaimana mengaktifkan kembali kepesertaan?', jawaban: 'Pasal 42 Peraturan Presiden Nomor 82 Tahun 2018 sebagaimana terakhir diubah dengan Peraturan Presiden Nomor 59 Tahun 2024 mengatur bahwa penjaminan dihentikan sementara mulai tanggal 1 bulan berikutnya jika iuran belum dibayar sampai akhir bulan berjalan. Status dapat aktif kembali setelah ketentuan pembayaran tunggakan dan iuran berjalan dipenuhi. Jika peserta mendapat rawat inap tingkat lanjutan dalam 45 hari setelah aktif kembali, dapat timbul denda pelayanan sesuai ketentuan; denda ini bukan denda otomatis atas setiap keterlambatan.' },

  // ---- Layanan Jasa Industri (UU 20/2014) ----
  { layanan: LAYANAN.JASA_INDUSTRI, pertanyaan: 'Apakah SNI hanya berlaku untuk barang?', jawaban: 'Tidak. Pasal 4 Undang-Undang Nomor 20 Tahun 2014 tentang Standardisasi dan Penilaian Kesesuaian mengatur bahwa standardisasi dan penilaian kesesuaian berlaku terhadap barang, jasa, sistem, proses, atau personal. Karena itu, kebutuhan standar tidak terbatas pada produk berbentuk barang; lingkup yang tepat harus diperiksa pada SNI dan ketentuan sektoral yang terkait.' },
  { layanan: LAYANAN.JASA_INDUSTRI, pertanyaan: 'Apakah penerapan SNI selalu wajib?', jawaban: 'Tidak. Pasal 20 Undang-Undang Nomor 20 Tahun 2014 menyatakan penerapan SNI dapat dilaksanakan secara sukarela atau diberlakukan secara wajib. SNI dapat diwajibkan melalui peraturan menteri atau kepala lembaga untuk kepentingan keselamatan, keamanan, kesehatan, atau pelestarian fungsi lingkungan hidup. Karena itu, periksa aturan sektoral produk atau jasa Anda; jangan menganggap semua SNI otomatis wajib.' },
  { layanan: LAYANAN.JASA_INDUSTRI, pertanyaan: 'Bagaimana memastikan lembaga sertifikasi atau penilaian kesesuaian berwenang?', jawaban: 'Menurut Pasal 36 sampai Pasal 39 Undang-Undang Nomor 20 Tahun 2014, kegiatan penilaian kesesuaian dilakukan oleh Lembaga Penilaian Kesesuaian yang diakreditasi Komite Akreditasi Nasional. Periksa bukan hanya keberadaan logo KAN, tetapi juga status akreditasi dan ruang lingkupnya. Lembaga yang tidak terakreditasi, akreditasinya dibekukan atau dicabut, atau bekerja di luar ruang lingkup akreditasi dilarang menerbitkan sertifikat berlogo KAN.' },
  { layanan: LAYANAN.JASA_INDUSTRI, pertanyaan: 'Apakah hasil penilaian kesesuaian dari lembaga luar negeri dapat diterima?', jawaban: 'Dapat, tetapi tidak otomatis. Pasal 36 dan Pasal 40 Undang-Undang Nomor 20 Tahun 2014 mensyaratkan antara lain adanya perjanjian saling pengakuan antara KAN dan lembaga akreditasi internasional serta asas timbal balik, atau pengakuan melalui organisasi internasional yang diikuti Indonesia. Konfirmasikan keberlakuan pengakuan dan ruang lingkupnya sebelum memakai hasil penilaian luar negeri.' },
  { layanan: LAYANAN.JASA_INDUSTRI, pertanyaan: 'Apakah usaha mikro dan kecil mendapat fasilitasi biaya sertifikasi?', jawaban: 'Pasal 53 Undang-Undang Nomor 20 Tahun 2014 mengatur pembinaan bagi pelaku usaha mikro dan kecil paling sedikit berupa fasilitas pembiayaan sertifikasi dan pemeliharaan sertifikasi, dengan sumber dari APBN. Namun, ketentuan ini bukan jaminan bahwa dana otomatis tersedia untuk setiap permohonan. Ketersediaan, sasaran, dan mekanismenya mengikuti program serta aturan pelaksanaan yang sedang berlaku.' },
  { layanan: LAYANAN.JASA_INDUSTRI, pertanyaan: 'Apa yang dapat dilakukan jika menemukan penyalahgunaan SNI atau sertifikat?', jawaban: 'Pasal 52 Undang-Undang Nomor 20 Tahun 2014 memberi ruang bagi masyarakat untuk melaporkan penyalahgunaan atau pemalsuan SNI atau sertifikat, penggunaan tanpa hak atas Tanda SNI atau Tanda Kesesuaian, dan pembubuhan tanda yang tidak sesuai sertifikat. Laporan dapat disampaikan kepada kementerian atau lembaga, pemerintah daerah, aparat penegak hukum, dan atau institusi terkait dengan menyertakan bukti pendukung.' },
  { layanan: LAYANAN.JASA_INDUSTRI, pertanyaan: 'Apakah SNI ditinjau ulang secara berkala?', jawaban: 'Ya. Pasal 28 Undang-Undang Nomor 20 Tahun 2014 mengatur bahwa kaji ulang SNI dilakukan paling sedikit satu kali dalam lima tahun setelah ditetapkan. Peninjauan diperlukan agar standar tetap sesuai dengan kepentingan nasional, kebutuhan pasar, perkembangan ilmu pengetahuan dan teknologi, serta kondisi terkini. Selalu gunakan versi dan status SNI terbaru dari kanal resmi BSN.' },

  // ---- Sertifikasi Mutu Keamanan Hasil Perikanan (PP 57/2015) ----
  { layanan: LAYANAN.PERIKANAN, pertanyaan: 'Berapa lama masa berlaku SKP dan Sertifikat Penerapan Program Manajemen Mutu Terpadu?', jawaban: 'Berdasarkan Pasal 18 dan Pasal 20 Peraturan Pemerintah Nomor 57 Tahun 2015, Sertifikat Kelayakan Pengolahan atau SKP berlaku selama dua tahun dan dapat diperpanjang untuk jangka waktu yang sama. Sertifikat Penerapan Program Manajemen Mutu Terpadu berlaku selama satu tahun dan dapat diperpanjang untuk jangka waktu yang sama. Masa berlaku keduanya berbeda sehingga perlu dipantau secara terpisah.' },
  { layanan: LAYANAN.PERIKANAN, pertanyaan: 'Standar mutu apa yang harus dipenuhi produk pengolahan ikan untuk pasar dalam negeri dan ekspor?', jawaban: 'Pasal 9 Peraturan Pemerintah Nomor 57 Tahun 2015 mengatur bahwa produk pengolahan ikan harus memenuhi kriteria keamanan hasil perikanan dan memiliki kandungan gizi yang baik. Produk yang beredar di dalam negeri harus memenuhi standar perdagangan nasional, sedangkan produk ekspor harus memenuhi standar negara tujuan atau standar internasional. Jika standar perdagangan nasional belum tersedia, digunakan persyaratan atau standar mutu produk internasional.' },
  { layanan: LAYANAN.PERIKANAN, pertanyaan: 'Apakah penerapan HACCP hanya diperiksa pada tahap pengolahan ikan?', jawaban: 'Tidak. Menurut Pasal 15 Peraturan Pemerintah Nomor 57 Tahun 2015, pengendalian mutu pada penanganan, pengolahan, pengemasan, penyimpanan, dan pendistribusian hasil perikanan paling sedikit dilakukan melalui inspeksi, verifikasi, surveilan, audit, dan pengambilan contoh. Verifikasi memeriksa penerapan hazard analysis critical control point atau HACCP untuk mencegah atau mengurangi bahaya dalam rantai persediaan makanan.' },
  { layanan: LAYANAN.PERIKANAN, pertanyaan: 'Apakah satu sertifikat kesehatan produk pengolahan ikan dapat digunakan untuk beberapa kali ekspor?', jawaban: 'Tidak. Pasal 22 Peraturan Pemerintah Nomor 57 Tahun 2015 menyatakan bahwa sertifikat kesehatan produk pengolahan ikan hanya berlaku untuk satu kali ekspor. Sertifikat tersebut diberikan kepada pelaku usaha industri pengolahan ikan yang telah memperoleh SKP dan Sertifikat Penerapan Program Manajemen Mutu Terpadu.' },
  { layanan: LAYANAN.PERIKANAN, pertanyaan: 'Apa persyaratan mutu dasar bagi produk pengolahan ikan yang diimpor ke Indonesia?', jawaban: 'Pasal 24 Peraturan Pemerintah Nomor 57 Tahun 2015 mewajibkan setiap produk pengolahan ikan yang diimpor atau masuk ke wilayah Indonesia disertai sertifikat kesehatan produk pengolahan ikan dari negara asal. Produk tersebut juga harus sesuai dengan standar keamanan konsumsi dalam negeri.' },
  { layanan: LAYANAN.PERIKANAN, pertanyaan: 'Apakah bahan baku hasil perikanan wajib dijaga dalam sistem rantai dingin?', jawaban: 'Ya. Pasal 26 Peraturan Pemerintah Nomor 57 Tahun 2015 mewajibkan penerapan sistem rantai dingin pada tahap penangkapan atau pemanenan, distribusi, pengolahan, dan pemasaran bahan baku hasil perikanan. Penjelasannya mendefinisikan rantai dingin sebagai pendinginan paling tinggi empat derajat Celsius sesuai jenis hasil perikanan, secara terus-menerus dan tidak terputus hingga konsumen, tanpa mengubah struktur dan bentuk dasarnya.' },
  { layanan: LAYANAN.PERIKANAN, pertanyaan: 'Bolehkah bahan tambahan makanan digunakan dalam pengolahan ikan?', jawaban: 'Boleh sepanjang bahan tambahan makanan tersebut diizinkan sesuai tujuan penggunaannya dan tidak melebihi batas maksimum yang diizinkan. Pasal 7 Peraturan Pemerintah Nomor 57 Tahun 2015 dan Pasal 23 Undang-Undang Nomor 31 Tahun 2004 sebagaimana diubah dengan Undang-Undang Nomor 45 Tahun 2009 melarang penggunaan bahan baku, bahan tambahan, bahan penolong, atau alat yang membahayakan kesehatan manusia maupun lingkungan.' },

  // ---- Bank Lampung (edukasi regulasi perbankan umum) ----
  { layanan: LAYANAN.BANK_LAMPUNG, pertanyaan: 'Informasi apa yang perlu dipahami sebelum menyetujui transaksi atau menggunakan layanan bank?', jawaban: 'Sebelum mengambil keputusan, mintalah informasi yang benar, jelas, jujur, mudah diakses, dan tidak menyesatkan. Pahami fitur utama, manfaat, risiko, persyaratan dan tata cara, biaya, serta hak dan kewajiban Anda. Kewajiban informasi ini didasarkan antara lain pada Pasal 29 Undang-Undang Nomor 10 Tahun 1998 tentang Perbankan, Undang-Undang Nomor 8 Tahun 1999 tentang Perlindungan Konsumen, dan POJK Nomor 22 Tahun 2023. Mintalah penjelasan sebelum menyetujui bagian yang belum dipahami.' },
  { layanan: LAYANAN.BANK_LAMPUNG, pertanyaan: 'Apakah keluhan terhadap layanan bank dapat disampaikan secara lisan atau tertulis?', jawaban: 'Ya. POJK Nomor 22 Tahun 2023 mewajibkan pelaku usaha jasa keuangan menyediakan penerimaan, penanganan, dan penyelesaian pengaduan. Pengaduan dapat disampaikan secara lisan atau tertulis dan harus diterima, dicatat, serta didokumentasikan. Konsumen berhak memperoleh nomor registrasi atau bukti tanda terima sesuai bentuk pengaduannya. Simpan seluruh bukti transaksi dan komunikasi yang berkaitan dengan keluhan.' },
  { layanan: LAYANAN.BANK_LAMPUNG, pertanyaan: 'Apakah bank harus menjelaskan tujuan penggunaan data pribadi nasabah?', jawaban: 'Pengendali data pribadi wajib memiliki dasar pemrosesan yang sah. Berdasarkan Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi, dasar tersebut dapat berupa persetujuan, pelaksanaan perjanjian, kewajiban hukum, atau dasar sah lainnya. Jika menggunakan persetujuan, informasi mengenai tujuan, jenis data, masa retensi, jangka waktu pemrosesan, dan hak subjek data harus disampaikan secara jelas; persetujuan harus tertulis atau terekam.' },
  { layanan: LAYANAN.BANK_LAMPUNG, pertanyaan: 'Apa hak nasabah jika data pribadi yang disimpan bank tidak akurat?', jawaban: 'Undang-Undang Nomor 27 Tahun 2022 memberi hak untuk melengkapi, memperbarui, atau memperbaiki data pribadi yang salah atau tidak akurat sesuai tujuan pemrosesannya. Nasabah juga dapat meminta akses dan salinan data sesuai ketentuan. Permintaan pelaksanaan hak diajukan secara tercatat kepada pihak yang mengendalikan data. Beberapa hak dapat dikecualikan untuk kepentingan tertentu yang tegas diatur undang-undang.' },
  { layanan: LAYANAN.BANK_LAMPUNG, pertanyaan: 'Apa yang wajib diberitahukan jika terjadi kebocoran data pribadi?', jawaban: 'Pasal 46 Undang-Undang Nomor 27 Tahun 2022 mewajibkan pengendali data memberikan pemberitahuan tertulis kepada subjek data dan lembaga yang ditentukan undang-undang paling lambat tiga kali dua puluh empat jam setelah kegagalan pelindungan diketahui. Pemberitahuan sekurang-kurangnya menjelaskan data yang terungkap, kapan dan bagaimana data terungkap, serta langkah penanganan dan pemulihannya. Dalam keadaan tertentu, pemberitahuan juga wajib disampaikan kepada masyarakat.' },
  { layanan: LAYANAN.BANK_LAMPUNG, pertanyaan: 'Bolehkah penawaran bank melalui telepon atau pesan pribadi dikirim tanpa persetujuan?', jawaban: 'Tidak. Pasal 39 POJK Nomor 22 Tahun 2023 melarang pelaku usaha jasa keuangan menawarkan produk atau layanan melalui sarana komunikasi pribadi tanpa persetujuan calon konsumen atau konsumen. Persetujuan menerima penawaran tidak boleh diwajibkan sebagai syarat menggunakan produk atau layanan. Jika persetujuan ditarik kembali, penawaran melalui sarana komunikasi pribadi wajib dihentikan.' },
  { layanan: LAYANAN.BANK_LAMPUNG, pertanyaan: 'Apakah semua simpanan otomatis dibayar LPS jika bank gagal?', jawaban: 'Tidak otomatis. Undang-Undang Nomor 24 Tahun 2004 tentang Lembaga Penjamin Simpanan mengatur jenis simpanan yang dijamin, tetapi LPS melakukan rekonsiliasi dan verifikasi untuk menentukan kelayakan pembayaran. Data diri dan simpanan harus tercatat dalam pembukuan bank, tingkat bunga tidak melebihi tingkat bunga penjaminan yang berlaku, dan nasabah tidak melakukan tindakan yang merugikan bank. Karena ketentuan tingkat bunga dapat berubah, periksa informasi terbaru langsung pada kanal resmi LPS.' },

  // ---- BALMON (UU 36/1999; PP 46/2021; regulasi Kominfo terkait) ----
  { layanan: LAYANAN.BALMON, pertanyaan: 'Apa saja jenis izin penggunaan spektrum frekuensi radio?', jawaban: 'Pasal 45 Peraturan Pemerintah Nomor 46 Tahun 2021 mengatur tiga bentuk izin penggunaan spektrum frekuensi radio, yaitu Izin Pita Frekuensi Radio atau IPFR, Izin Stasiun Radio atau ISR, dan Izin Kelas. Penetapan izin dilakukan berdasarkan analisis teknis. Izin Kelas melekat pada alat atau perangkat telekomunikasi yang telah memenuhi standar teknis dan digunakan sesuai persyaratan tertentu; bukan pembebasan umum dari kewajiban teknis.' },
  { layanan: LAYANAN.BALMON, pertanyaan: 'Kapan suatu pancaran radio dianggap menimbulkan gangguan yang merugikan?', jawaban: 'Berdasarkan Undang-Undang Nomor 36 Tahun 1999 tentang Telekomunikasi sebagaimana diubah dengan Undang-Undang Nomor 6 Tahun 2023 serta Permenkominfo Nomor 7 Tahun 2021, gangguan yang merugikan terjadi apabila pancaran membahayakan komunikasi radio navigasi atau frekuensi keselamatan, atau secara signifikan mengurangi, mengganggu, maupun berulang kali menyela operasional penggunaan spektrum oleh pemegang izin lain yang berhak mendapat proteksi. Penggunaan spektrum wajib sesuai peruntukannya dan tidak menimbulkan gangguan tersebut.' },
  { layanan: LAYANAN.BALMON, pertanyaan: 'Apakah penggunaan frekuensi radio dapat dimonitor meskipun tidak ada pengaduan?', jawaban: 'Ya. Permenkominfo Nomor 7 Tahun 2021 mengatur monitoring rutin maupun insidental terhadap penggunaan spektrum frekuensi radio. Kegiatannya dapat mencakup observasi penggunaan frekuensi, identifikasi pengguna, pengukuran parameter teknis, dan inspeksi stasiun radio. Berdasarkan Permenkominfo Nomor 1 Tahun 2022, Unit Pelaksana Teknis Bidang Monitor Spektrum Frekuensi Radio di daerah melaksanakan antara lain pemantauan serta deteksi lokasi sumber pancaran.' },
  { layanan: LAYANAN.BALMON, pertanyaan: 'Apa akibatnya jika pemegang IPFR menimbulkan gangguan yang merugikan?', jawaban: 'Permenkominfo Nomor 7 Tahun 2021 mengatur bahwa pemegang Izin Pita Frekuensi Radio atau IPFR yang menimbulkan gangguan merugikan dapat dikenai teguran tertulis dan penghentian sementara operasional stasiun radio sumber gangguan. Teguran memerintahkan penyesuaian teknis pancaran dan penghentian sementara. Operasional dapat dipulihkan setelah penggunaan frekuensi tidak lagi menimbulkan gangguan yang merugikan.' },
  { layanan: LAYANAN.BALMON, pertanyaan: 'Apakah izin frekuensi dapat dicabut jika stasiun tidak memancar atau melanggar parameter teknis?', jawaban: 'Ya. Pasal 63 dan Pasal 64 Peraturan Pemerintah Nomor 46 Tahun 2021 mengatur bahwa izin penggunaan spektrum dapat diakhiri sebelum masa berlakunya melalui pencabutan. Untuk ISR, alasannya antara lain tidak melakukan pemancaran sesuai izin paling sedikit selama dua belas bulan berdasarkan tiga hasil monitoring spektrum, atau melanggar parameter teknis yang ditetapkan dalam ISR.' },
  { layanan: LAYANAN.BALMON, pertanyaan: 'Apa kewajiban penting Amatir Radio saat berkomunikasi dan dalam keadaan darurat?', jawaban: 'Permenkominfo Nomor 17 Tahun 2018 mewajibkan Amatir Radio memancarkan tanda panggilan atau call sign paling sedikit setiap tiga menit agar stasiunnya dapat dikenali. Dalam marabahaya, bencana, keadaan gawat darurat, wabah penyakit, atau keadaan yang menyangkut keselamatan jiwa, harta benda, maupun keamanan negara, Amatir Radio wajib memprioritaskan berita tersebut. Memancarkan atau menerima berita maupun panggilan marabahaya yang tidak benar dilarang.' },
  { layanan: LAYANAN.BALMON, pertanyaan: 'Bolehkah KRAP digunakan untuk promosi usaha, komunikasi instansi, atau komunikasi ke luar negeri?', jawaban: 'Tidak. Pasal 57 Permenkominfo Nomor 17 Tahun 2018 melarang stasiun Komunikasi Radio Antar Penduduk atau KRAP digunakan untuk pemberitaan komersial atau memperoleh imbalan, jasa telekomunikasi, komunikasi kepentingan dinas instansi pemerintah maupun swasta, dan komunikasi ke luar negeri. KRAP juga dilarang digunakan untuk berita bersifat politik atau SARA, atau pembicaraan lain yang dapat menimbulkan gangguan keamanan dan ketertiban, berita tidak benar, serta sinyal yang menyesatkan.' },
];

function normalizeQuestion(value) {
  return value.trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
}

async function moveMisplacedNibFaq() {
  const [{ data: misplaced, error: findError }, { data: ossRows, error: orderError }] = await Promise.all([
    supabase
      .from('faq_knowledge_base')
      .select('id')
      .eq('layanan_id', LAYANAN.BALMON)
      .eq('pertanyaan', MISPLACED_NIB_QUESTION)
      .maybeSingle(),
    supabase
      .from('faq_knowledge_base')
      .select('urutan')
      .eq('layanan_id', LAYANAN.OSS)
      .order('urutan', { ascending: false })
      .limit(1),
  ]);

  if (findError) throw new Error(`Gagal memeriksa FAQ NIB salah layanan: ${findError.message}`);
  if (orderError) throw new Error(`Gagal memeriksa urutan FAQ OSS: ${orderError.message}`);
  if (!misplaced) return false;

  const nextOssOrder = (ossRows?.[0]?.urutan ?? 0) + 1;
  const { error: moveError } = await supabase
    .from('faq_knowledge_base')
    .update({
      layanan_id: LAYANAN.OSS,
      jawaban: 'Berdasarkan Peraturan Pemerintah Nomor 28 Tahun 2025 tentang Penyelenggaraan Perizinan Berusaha Berbasis Risiko, NIB diterbitkan melalui sistem OSS setelah pelaku usaha melengkapi data yang dipersyaratkan. Siapkan data identitas atau legalitas pelaku usaha, data bidang usaha sesuai KBLI, lokasi, modal, serta data kegiatan usaha. Kebutuhan data dapat berbeda menurut bentuk dan kegiatan usaha; gunakan formulir pada OSS sebagai daftar persyaratan yang berlaku untuk permohonan Anda.',
      urutan: nextOssOrder,
      perlu_embed_ulang: true,
    })
    .eq('id', misplaced.id)
    .eq('layanan_id', LAYANAN.BALMON);

  if (moveError) throw new Error(`Gagal memindahkan FAQ NIB ke OSS: ${moveError.message}`);
  console.log('✓ FAQ NIB yang salah layanan dipindahkan dan diperbarui berdasarkan PP 28/2025.');
  return true;
}

async function main() {
  const layananIds = Object.values(LAYANAN);
  const { data: existing, error: existingError } = await supabase
    .from('faq_knowledge_base')
    .select('layanan_id, pertanyaan, urutan')
    .in('layanan_id', layananIds)
    .eq('aktif', true);

  if (existingError) throw new Error(`Gagal memuat FAQ saat ini: ${existingError.message}`);

  // Hitung kondisi setelah koreksi klasifikasi NIB, tetapi jangan ubah DB sebelum
  // seluruh kandidat terbukti cukup untuk mencapai target semua layanan.
  const projectedNibOrder = Math.max(
    0,
    ...existing
      .filter((row) => row.layanan_id === LAYANAN.OSS)
      .map((row) => row.urutan),
  ) + 1;
  const projected = existing.map((row) => (
    row.layanan_id === LAYANAN.BALMON && row.pertanyaan === MISPLACED_NIB_QUESTION
      ? { ...row, layanan_id: LAYANAN.OSS, urutan: projectedNibOrder }
      : row
  ));
  const existingQuestions = new Set(
    projected.map((row) => `${row.layanan_id}:${normalizeQuestion(row.pertanyaan)}`),
  );
  const counts = new Map(layananIds.map((id) => [id, 0]));
  const nextOrder = new Map(layananIds.map((id) => [id, 1]));

  for (const row of projected) {
    counts.set(row.layanan_id, (counts.get(row.layanan_id) ?? 0) + 1);
    nextOrder.set(row.layanan_id, Math.max(nextOrder.get(row.layanan_id) ?? 1, row.urutan + 1));
  }

  const rows = [];
  for (const faq of FAQS) {
    const key = `${faq.layanan}:${normalizeQuestion(faq.pertanyaan)}`;
    if (existingQuestions.has(key)) continue;
    if ((counts.get(faq.layanan) ?? 0) >= TARGET_PER_LAYANAN) continue;

    rows.push({
      layanan_id: faq.layanan,
      pertanyaan: faq.pertanyaan,
      jawaban: faq.jawaban,
      aktif: true,
      urutan: nextOrder.get(faq.layanan) ?? 1,
      perlu_embed_ulang: true,
    });
    existingQuestions.add(key);
    counts.set(faq.layanan, (counts.get(faq.layanan) ?? 0) + 1);
    nextOrder.set(faq.layanan, (nextOrder.get(faq.layanan) ?? 1) + 1);
  }

  const incomplete = Object.entries(LAYANAN)
    .filter(([, id]) => (counts.get(id) ?? 0) < TARGET_PER_LAYANAN)
    .map(([name, id]) => `${name}: ${counts.get(id) ?? 0}/${TARGET_PER_LAYANAN}`);
  if (incomplete.length > 0) {
    throw new Error(`Kandidat FAQ belum mencukupi:\n- ${incomplete.join('\n- ')}`);
  }

  await moveMisplacedNibFaq();

  let inserted = [];
  if (rows.length > 0) {
    const { data, error: insertError } = await supabase
      .from('faq_knowledge_base')
      .insert(rows)
      .select('id, layanan_id, pertanyaan, jawaban');

    if (insertError) throw new Error(`Gagal menyisipkan FAQ: ${insertError.message}`);
    inserted = data;
    console.log(`✓ ${inserted.length} FAQ baru disisipkan dan ditandai untuk embedding.`);
  }

  const { data: pending, error: pendingError } = await supabase
    .from('faq_knowledge_base')
    .select('id, layanan_id, pertanyaan, jawaban')
    .in('layanan_id', layananIds)
    .or('embedding.is.null,perlu_embed_ulang.eq.true');
  if (pendingError) throw new Error(`Gagal memuat FAQ untuk embedding: ${pendingError.message}`);

  if (pending.length === 0) {
    console.log('✓ Semua layanan sudah memiliki minimal 10 FAQ aktif dan seluruh embedding mutakhir.');
    return;
  }

  const embedModel = new GoogleGenerativeAI(geminiApiKey)
    .getGenerativeModel({ model: 'gemini-embedding-001' });
  let embedded = 0;
  const failed = [];

  for (const row of pending) {
    try {
      let vector;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await embedModel.embedContent(`${row.pertanyaan}\n${row.jawaban}`);
          vector = result.embedding.values;
          if (vector?.length !== 3072) {
            throw new Error(`Dimensi embedding ${vector?.length ?? 0}, seharusnya 3072.`);
          }
          break;
        } catch (error) {
          if (attempt === 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }

      const { error: updateError } = await supabase
        .from('faq_knowledge_base')
        .update({
          embedding: `[${vector.join(',')}]`,
          perlu_embed_ulang: false,
          embedding_updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (updateError) throw updateError;
      embedded++;
      console.log(`  [${embedded}/${pending.length}] embed: ${row.pertanyaan}`);
    } catch (error) {
      failed.push({
        id: row.id,
        pertanyaan: row.pertanyaan,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(`✓ Embedding selesai: ${embedded}/${pending.length}.`);
  for (const [name, id] of Object.entries(LAYANAN)) {
    console.log(`  ${name}: ${counts.get(id)}/${TARGET_PER_LAYANAN}`);
  }
  if (failed.length > 0) {
    throw new Error(
      `Embedding gagal untuk ${failed.length} FAQ:\n${failed.map((row) => `- ${row.pertanyaan}: ${row.error}`).join('\n')}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
