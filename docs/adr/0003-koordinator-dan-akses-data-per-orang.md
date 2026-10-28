# Koordinator sebagai penanda akun, dan akses data per orang

Pada 2026-10-14 diputuskan semua Front Office saling bisa melihat dan mengunduh data FO lain (`202610140013_fo_keterbukaan_data.sql`), dan sesama Petugas Layanan dalam satu Layanan juga saling melihat. Pemilik membalik keputusan itu: petugas tanpa penanda hanya melihat dan mengunduh data yang ia tangani sendiri, sedangkan penanda **Koordinator** pada akun memberi akses ke semua data unitnya (FO + Koordinator: semua Layanan) serta hak mengambil alih pendataan yang sedang berjalan. Koordinator sengaja **bukan role keempat**: role tetap `admin`, `front_office`, `petugas`, supaya navigasi, Auth Hook, dan aturan operasional antrean yang bergantung pada role tidak bercabang; penanda hanya memperluas lingkup *data*, bukan lingkup operasional.

## Consequences

Front Office harus punya representasi unit sendiri (saat ini akun FO wajib tanpa `layanan_id`). Semua permukaan rekap, ekspor, RLS, dan API yang sekarang menyaring per Layanan perlu menyaring per orang kecuali untuk Koordinator dan admin.
