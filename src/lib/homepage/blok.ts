// Model blok homepage: tujuh jenis blok TETAP (bukan page builder). Admin hanya menyalakan/mematikan,
// mengurutkan, dan mengubah teks. Murni (tanpa DB/React): pemuat ada di data.ts, penyunting di
// /admin/settings/landing. Aturan utama: blok yang dimatikan tidak dirender SAMA SEKALI (tidak ada teks
// cadangan); teks kosong pada blok yang menyala memakai teks bawaan.

export const JENIS_BLOK = [
  'hero',
  'jalur_cepat',
  'status_hari_ini',
  'layanan',
  'papan_kinerja',
  'ajakan',
  'footer',
] as const;
export type JenisBlok = (typeof JENIS_BLOK)[number];

export type BidangBlok = {
  kunci: string;
  label: string;
  panjang: 'pendek' | 'panjang';
  /** Bidang berisi tautan (disaring linkAman). */
  tautan?: boolean;
};

export type DefinisiBlok = {
  label: string;
  /** Penjelasan singkat di editor admin. */
  catatan?: string;
  aktifBawaan: boolean;
  urutanBawaan: number;
  bidang: BidangBlok[];
  bawaan: Record<string, string>;
};

export const PENAMPUNG_JUMLAH = '{jumlah}';

export const DEFINISI_BLOK: Record<JenisBlok, DefinisiBlok> = {
  hero: {
    label: 'Hero (bagian pembuka)',
    aktifBawaan: true,
    urutanBawaan: 10,
    bidang: [
      { kunci: 'badge_text', label: 'Teks lencana', panjang: 'pendek' },
      { kunci: 'title', label: 'Judul', panjang: 'pendek' },
      { kunci: 'title_accent', label: 'Judul (bagian berwarna)', panjang: 'pendek' },
      { kunci: 'description', label: 'Deskripsi', panjang: 'panjang' },
      { kunci: 'cta_primary_text', label: 'Tombol utama: teks', panjang: 'pendek' },
      { kunci: 'cta_primary_link', label: 'Tombol utama: tautan', panjang: 'pendek', tautan: true },
      { kunci: 'cta_secondary_text', label: 'Tombol kedua: teks', panjang: 'pendek' },
      { kunci: 'cta_secondary_link', label: 'Tombol kedua: tautan (isi "wa" untuk WhatsApp)', panjang: 'pendek', tautan: true },
    ],
    bawaan: {
      badge_text: 'DPMPTSP Provinsi Lampung',
      title: 'Pelayanan Terpadu Satu Pintu untuk',
      title_accent: 'Lampung Maju',
      description:
        'Hub digital yang menyatukan layanan perizinan, sertifikasi halal, BPJS Kesehatan, matchmaking UMKM, dan galeri investasi dalam satu platform terintegrasi.',
      cta_primary_text: 'Rencanakan Kedatangan',
      cta_primary_link: '/me/reservasi',
      cta_secondary_text: 'Chat via WhatsApp',
      cta_secondary_link: 'wa',
    },
  },
  jalur_cepat: {
    label: 'Jalur cepat',
    catatan: 'Tautan jalur cepat tetap; hanya judul dan penjelasannya yang bisa diubah.',
    aktifBawaan: true,
    urutanBawaan: 20,
    bidang: [
      { kunci: 'title', label: 'Judul', panjang: 'pendek' },
      { kunci: 'description', label: 'Penjelasan', panjang: 'panjang' },
    ],
    bawaan: {
      title: 'Jalur Cepat',
      description: 'Langsung ke hal yang paling sering Anda butuhkan.',
    },
  },
  status_hari_ini: {
    label: 'Status hari ini (antrean)',
    aktifBawaan: true,
    urutanBawaan: 30,
    bidang: [
      { kunci: 'title', label: 'Judul', panjang: 'pendek' },
      { kunci: 'description', label: 'Penjelasan', panjang: 'panjang' },
    ],
    bawaan: {
      title: 'Estimasi Antrean Sekarang',
      description:
        'Perkiraan waktu tunggu realtime. Jika belum ada data histori durasi, angka ditandai sebagai perkiraan sementara.',
    },
  },
  layanan: {
    label: 'Cari dan daftar layanan',
    catatan: `Kartu layanan terisi otomatis dari Kelola Layanan. Tulis ${PENAMPUNG_JUMLAH} pada judul untuk memunculkan jumlah layanan yang tampil.`,
    aktifBawaan: true,
    urutanBawaan: 40,
    bidang: [
      { kunci: 'label', label: 'Label kecil di atas judul', panjang: 'pendek' },
      { kunci: 'title', label: `Judul (boleh memuat ${PENAMPUNG_JUMLAH})`, panjang: 'pendek' },
      { kunci: 'description', label: 'Penjelasan', panjang: 'panjang' },
    ],
    bawaan: {
      label: 'Layanan Kami',
      title: `${PENAMPUNG_JUMLAH} Layanan dalam Satu Atap`,
      description: 'Layanan konsultatif tatap muka dan platform digital yang bisa diakses dari mana saja, kapan saja.',
    },
  },
  papan_kinerja: {
    label: 'Papan kinerja',
    catatan: 'Slot tercadang; isinya belum tersedia. Bila dinyalakan hanya menampilkan judul dan penjelasan di bawah (kosong = tidak tampil apa pun).',
    aktifBawaan: false,
    urutanBawaan: 50,
    bidang: [
      { kunci: 'title', label: 'Judul', panjang: 'pendek' },
      { kunci: 'description', label: 'Penjelasan', panjang: 'panjang' },
    ],
    bawaan: { title: '', description: '' },
  },
  ajakan: {
    label: 'Ajakan bertindak',
    aktifBawaan: true,
    urutanBawaan: 60,
    bidang: [
      { kunci: 'title', label: 'Judul', panjang: 'pendek' },
      { kunci: 'description', label: 'Deskripsi', panjang: 'panjang' },
      { kunci: 'button_text', label: 'Tombol: teks', panjang: 'pendek' },
      { kunci: 'button_link', label: 'Tombol: tautan', panjang: 'pendek', tautan: true },
    ],
    bawaan: {
      title: 'Siap Berkunjung?',
      description:
        'Reservasi kedatangan online terlebih dahulu untuk mempercepat pelayanan Anda di kantor DPMPTSP Provinsi Lampung.',
      button_text: 'Rencanakan Kedatangan',
      button_link: '/me/reservasi',
    },
  },
  footer: {
    label: 'Footer (selalu paling bawah)',
    catatan: 'Alamat, jam, dan email footer diatur di Pengaturan.',
    aktifBawaan: true,
    urutanBawaan: 70,
    bidang: [{ kunci: 'copyright', label: 'Teks hak cipta', panjang: 'pendek' }],
    bawaan: { copyright: 'DPMPTSP Provinsi Lampung. Hak cipta dilindungi.' },
  },
};

/** Baris mentah dari tabel homepage_blok. */
export type BarisBlok = {
  jenis: string;
  aktif: boolean;
  urutan: number;
  teks: Record<string, unknown> | null;
};

export type BlokTersusun = {
  jenis: JenisBlok;
  aktif: boolean;
  urutan: number;
  /** Seluruh kunci bidang terisi (kustom atau bawaan). */
  teks: Record<string, string>;
};

const adalahJenis = (v: string): v is JenisBlok => (JENIS_BLOK as readonly string[]).includes(v);

/**
 * Tautan yang boleh dirender: path internal ("/..."), atau https. "wa" hanya bila diizinkan (tombol kedua hero).
 * Selain itu -> bawaan. Mencegah javascript:/protokol-relatif dari teks suntingan.
 */
export function linkAman(nilai: string, bawaan: string, opsi: { izinkanWa?: boolean } = {}): string {
  const v = nilai.trim();
  if (opsi.izinkanWa && v === 'wa') return 'wa';
  // Spasi dan backslash ditolak: peramban menafsirkan "/\evil.com" sebagai "//evil.com" (protokol-relatif).
  if (/[\s\\]/.test(v)) return bawaan;
  if (/^\/(?!\/)/.test(v)) return v;
  if (/^https:\/\/\S+$/.test(v)) return v;
  return bawaan;
}

/**
 * Susun ketujuh blok dari baris DB (atau null = tabel belum ada). Mengembalikan SEMUA blok (termasuk yang mati)
 * berurutan; render memakai blokTampil(). Baris hilang = bawaan jenis itu. Footer selalu terakhir.
 */
export function gabungkanBlok(rows: BarisBlok[] | null | undefined): BlokTersusun[] {
  const peta = new Map<JenisBlok, BarisBlok>();
  for (const r of rows ?? []) {
    if (adalahJenis(r.jenis) && !peta.has(r.jenis)) peta.set(r.jenis, r);
  }
  const hasil = JENIS_BLOK.map((jenis): BlokTersusun => {
    const def = DEFINISI_BLOK[jenis];
    const r = peta.get(jenis);
    const mentah = r?.teks && typeof r.teks === 'object' ? r.teks : {};
    const teks: Record<string, string> = {};
    for (const b of def.bidang) {
      const nilai = mentah[b.kunci];
      let pakai = typeof nilai === 'string' && nilai.trim() !== '' ? nilai.trim() : def.bawaan[b.kunci];
      if (b.tautan) pakai = linkAman(pakai, def.bawaan[b.kunci], { izinkanWa: b.kunci === 'cta_secondary_link' });
      teks[b.kunci] = pakai;
    }
    return {
      jenis,
      aktif: r ? r.aktif === true : def.aktifBawaan,
      urutan: r && Number.isFinite(r.urutan) ? r.urutan : def.urutanBawaan,
      teks,
    };
  });
  return hasil.sort((a, b) => {
    if (a.jenis === 'footer') return 1;
    if (b.jenis === 'footer') return -1;
    return a.urutan - b.urutan || DEFINISI_BLOK[a.jenis].urutanBawaan - DEFINISI_BLOK[b.jenis].urutanBawaan;
  });
}

/** Hanya blok yang menyala; blok mati TIDAK dirender (tanpa teks cadangan). */
export const blokTampil = (blok: BlokTersusun[]): BlokTersusun[] => blok.filter((b) => b.aktif);

/** Mengganti penampung {jumlah} pada judul bagian layanan dengan jumlah kartu yang tampil. */
export const judulLayanan = (templat: string, jumlah: number): string =>
  templat.split(PENAMPUNG_JUMLAH).join(String(jumlah));
