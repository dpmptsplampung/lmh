-- ============================================================
-- Migration 017: Tambah kolom ke investment_documents
-- untuk mendukung tampilan publik Investment Gallery
-- ============================================================

ALTER TABLE investment_documents
  ADD COLUMN IF NOT EXISTS deskripsi TEXT,
  ADD COLUMN IF NOT EXISTS nilai_investasi TEXT,   -- e.g. 'Rp 2.4 Triliun'
  ADD COLUMN IF NOT EXISTS image_url TEXT;          -- URL thumbnail/preview gambar

COMMENT ON COLUMN investment_documents.deskripsi IS 'Deskripsi singkat proyek investasi';
COMMENT ON COLUMN investment_documents.nilai_investasi IS 'Nilai investasi dalam format teks, e.g. Rp 2.4 Triliun';
COMMENT ON COLUMN investment_documents.image_url IS 'URL gambar thumbnail untuk tampilan galeri publik';

-- Seed demo data agar gallery tidak kosong
INSERT INTO investment_documents (judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url) VALUES
  ('Kawasan Industri Way Kanan (KIWK)', 'Manufaktur & Industri', 1, 'demo/kiwk.pdf', 24, 'aktif',
   'Pengembangan kawasan industri manufaktur terintegrasi seluas 500 Hektar untuk menampung industri hilir komoditas perkebunan.',
   'Rp 2.4 Triliun',
   'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&q=80&w=800'),

  ('Bakauheni Harbour City (BHC)', 'Pariwisata & Jasa', 2, 'demo/bhc.pdf', 18, 'aktif',
   'Pengembangan kawasan pariwisata terpadu skala internasional di gerbang pulau Sumatera (Pelabuhan Bakauheni).',
   'Rp 4.2 Triliun',
   'https://images.unsplash.com/photo-1559589689-577aabd1ce4c?auto=format&fit=crop&q=80&w=800'),

  ('PLTSa Bakung Bandar Lampung', 'Infrastruktur & Energi', 3, 'demo/pltsa.pdf', 32, 'aktif',
   'Proyek pengelolaan sampah perkotaan menjadi energi listrik ramah lingkungan berkapasitas 15 MW.',
   'Rp 650 Miliar',
   'https://images.unsplash.com/photo-1532601224476-15c79f2f7a51?auto=format&fit=crop&q=80&w=800'),

  ('Kawasan Terpadu Pariwisata Teluk Kiluan', 'Pariwisata & Jasa', 4, 'demo/kiluan.pdf', 20, 'aktif',
   'Pengembangan resort dan fasilitas ekowisata pengamatan lumba-lumba berstandar internasional.',
   'Rp 850 Miliar',
   'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&q=80&w=800'),

  ('Agroindustri Nanas Terpadu Lampung Tengah', 'Pertanian & Pangan', 5, 'demo/nanas.pdf', 28, 'aktif',
   'Pembangunan pabrik pengolahan nanas kaleng dan konsentrat untuk pasar ekspor Timur Tengah.',
   'Rp 1.2 Triliun',
   'https://images.unsplash.com/photo-1550828520-4cb496926fc9?auto=format&fit=crop&q=80&w=800'),

  ('Revitalisasi Tambak Udang Dipasena', 'Perikanan & Kelautan', 6, 'demo/dipasena.pdf', 40, 'aktif',
   'Modernisasi infrastruktur pertambakan dan penerapan teknologi smart aquaculture di Tulang Bawang.',
   'Rp 3.5 Triliun',
   'https://images.unsplash.com/photo-1615462575791-76495ff246a4?auto=format&fit=crop&q=80&w=800'),

  ('KEK Industri Karet Tulang Bawang', 'Manufaktur & Industri', 7, 'demo/karet.pdf', 45, 'aktif',
   'Kawasan Ekonomi Khusus yang difokuskan pada hilirisasi produk karet spesifikasi tinggi dan ban.',
   'Rp 5.1 Triliun',
   'https://images.unsplash.com/photo-1605374828131-0cfd80cbcd7b?auto=format&fit=crop&q=80&w=800'),

  ('Ekspansi PLTP Ulubelu Unit 5 & 6', 'Infrastruktur & Energi', 8, 'demo/pltp.pdf', 36, 'aktif',
   'Pembangunan pembangkit listrik tenaga panas bumi tambahan untuk mendukung ketahanan energi hijau.',
   'Rp 2.8 Triliun',
   'https://images.unsplash.com/photo-1466611653911-95081537e5b7?auto=format&fit=crop&q=80&w=800'),

  ('Pengembangan Terminal Petikemas Panjang', 'Infrastruktur & Logistik', 9, 'demo/panjang.pdf', 22, 'aktif',
   'Peningkatan kapasitas terminal petikemas pelabuhan internasional Panjang menjadi 1 juta TEUs.',
   'Rp 1.9 Triliun',
   'https://images.unsplash.com/photo-1586528116311-ad8ed745eb33?auto=format&fit=crop&q=80&w=800')

ON CONFLICT DO NOTHING;
