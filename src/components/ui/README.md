# Komponen UI "Dasbor"

Kontrak: `.tim/desain-baru/SISTEM-DESAIN.md` §3.2 dan §3.3. Semua komponen memakai token tema (`var(--...)`), tanpa warna tertulis langsung, tanpa dependensi baru. Ikon berupa referensi komponen (mis. `ikon={Users}` dari lucide-react), bukan elemen. Impor langsung per berkas: `import Kartu from '@/components/ui/Kartu'`.

| Komponen | Catatan pakai |
|---|---|
| `Kartu` | `judul?` (h2 + region bernama), `aksi?`, `padding: 'normal'｜'rapat'｜'tanpa'`, `as?` |
| `KartuStatistik` | `label`, `nilai`, `ikon?`, `tren?: {persen, arah, arahBaik?}`, `pembanding?`, `href?`, `memuat?`. Waktu tunggu: `arahBaik: 'turun'` |
| `Lencana` | `nada`, `ikon?`, `titik?`; makna selalu dalam teks |
| `Tombol` | `varian`, `ukuran`, `ikon?`, `memuat?`, `href?` (tautan). `memuat` = aria-busy + aria-disabled (fokus tidak hilang), teks dan lebar tetap |
| `Tabel<T>` | `kolom`, `baris`, `kunciBaris`, `caption` (wajib), `kosong?`, `memuat?`, `padat?`, `kartuDiHp?` (A14). Kolom: `angka`, `judulBaris`, `peran: 'utama'｜'aksi'`, `sembunyiDiHp` |
| `Dialog`, `PanelSamping` | `terbuka`, `onTutup`, `judul`, `deskripsi?`, `kaki?`, `dikunci?`, `tutupDenganLatar?`; fokus lewat `useDialogFokus`; tanpa portal |
| `Field` | `label`, `bantuan?`, `galat?`, `wajib?`; anak = satu input/select/textarea (atau fungsi) |
| `Tab` + `PanelTab` | `<Tab id label tab aktif onGanti />` dan `<PanelTab idTab={id} kunci aktif>` |
| `MenuTitikTiga` | `item[]` (`onPilih` atau `href`), `label?` untuk nama tombol |
| `StatusKosong` | kosong yang memang kosong |
| `CatatanKeadaan` | `jenis`: `kosong｜libur｜tanpa-layanan｜menunggu-migrasi｜lingkup｜info｜galat` (A15); pakai ini, bukan StatusKosong, untuk kosong karena libur/migrasi/lingkup |
| `Galat` | membungkus `ErrorRetry`; pakai hanya saat galat benar-benar terjadi |
| `Skeleton` | `bentuk`, `jumlah?`, `label?` |
| `grafik/PanelGrafik` | kartu grafik + menu (Lihat sebagai tabel, Unduh CSV, Buka laporan). Beri `tabel` untuk grafik berseri |
| `grafik/GrafikGaris｜GrafikBatang｜GrafikDonat` | `data`, `label` (wajib), seri/kunci; warna dari `--chart-*` |
| `grafik/Meteran｜Sparkline` | SVG murni; Meteran `role="meter"` |
| `grafik/RingkasanSegmen｜TabelRingkas｜DaftarRingkas` | widget berbentuk Kartu |
| `grafik/BilahStatus` | deretan status hari ini |

Tes grafik di jsdom: `grafik/stubUkuran.ts` (`stubUkuranGrafik`, `stubGerakDikurangi`).

## Pemilih tanggal (`PemilihTanggal`, `PemilihRentang`)

Pengganti `<input type="date">` yang bisa digayakan. Tanpa dependensi tanggal; hitungan kalender murni di `kalender/tanggal.ts`. Nilai selalu string `"YYYY-MM-DD"` (kalender WIB, sama dengan nilai `<input type="date">`). "Hari ini" dari `todayWIB()`. Minggu dimulai Senin; teks Indonesia.

```tsx
import PemilihTanggal from '@/components/ui/PemilihTanggal';
<PemilihTanggal nilai={tanggal} onUbah={setTanggal} label="Tanggal" min? max? disabled? id? />

import PemilihRentang from '@/components/ui/PemilihRentang';
<PemilihRentang dari={dari} sampai={sampai} onUbah={({ dari, sampai }) => ...} label="Rentang tanggal" min? max? pilihanCepat? />
```

| Prop | Tipe | Catatan |
|---|---|---|
| `nilai` (Tanggal) | `string` | `""` atau format salah = belum dipilih ("Pilih tanggal"), kisi dibuka di bulan ini |
| `dari`, `sampai` (Rentang) | `string` | tanggal termasuk; terbalik dinormalkan untuk tampilan; kosong/salah = "Pilih rentang tanggal" |
| `onUbah` | Tanggal: `(nilai: string) => void`; Rentang: `(r: { dari: string; sampai: string }) => void` | Tanggal: dipanggil saat hari dipilih dan berbeda dari nilai. Rentang: hanya setelah Terapkan atau pilihan cepat; `dari <= sampai` |
| `label` | `string` | nama bidang; nama tombol jadi `"{label}: 4 November 2026"` atau `"{label}: 6 Oktober sampai 4 November 2026"`, juga nama dialog |
| `min`, `max` | `string?` | batas termasuk; hari di luar batas `aria-disabled` + dicoret, papan ketik dijepit ke batas |
| `pilihanCepat` (Rentang) | `PilihanCepat[]?` | bawaan: Hari ini, 7 hari terakhir, 30 hari terakhir, Bulan ini, Bulan lalu (WIB; 7/30 hari termasuk hari ini; Bulan ini = tanggal 1 sampai hari ini). `[]` = sembunyikan. Bentuk: `{ kunci, label, hitung(hariIni) => { dari, sampai } }`; hasil dijepit ke min/max, nonaktif bila seluruhnya di luar |
| `disabled`, `id`, `className`, `aria-describedby` | | `id` dipasang pada tombol pemicu supaya `<label htmlFor>` atau `Field` bisa menunjuknya |

Perilaku: chip (ikon kalender + teks, 40px, 44px di pointer kasar) membuka popover `role="dialog"` (tidak modal). Fokus masuk ke hari aktif, Esc menutup dan mengembalikan fokus ke chip (Esc tidak menembus ke `Dialog` pembungkus), klik di luar menutup, Tab dijebak. Di layar <= 640px popover jadi lembar bawah dengan latar redup. Kisi berpola ARIA grid: panah geser hari, Home/End awal/akhir pekan, PageUp/PageDown ganti bulan, Shift+PageUp/PageDown ganti tahun, Enter/Spasi memilih. Rentang: klik pertama = awal, kedua = akhir (ditukar bila terbalik), pratinjau saat hover atau fokus, nilai induk tidak berubah sebelum Terapkan. Hormati `prefers-reduced-motion`.

Catatan pakai:
- Popover posisi `absolute` di bawah chip (tanpa portal, seperti `MenuTitikTiga`). Jangan taruh chip di dalam leluhur ber-`overflow: hidden/auto` yang lebih sempit dari popover (±300px). Di HP popover `fixed`, jadi aman.
- Tanggal "hari ini" untuk logika halaman: tetap `todayWIB()`; util tanggal siap pakai di `kalender/tanggal.ts` (`tambahHari`, `awalBulan`, `formatPendek`, `formatRentangPendek`, dll.).
- Contoh mengganti rentang: `<PemilihRentang dari={dari} sampai={sampai} onUbah={(r) => { setDari(r.dari); setSampai(r.sampai); }} label="Rentang tanggal" />`.
