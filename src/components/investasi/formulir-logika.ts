export type KanalMinat = 'ipro' | 'dokumen';

export type Isian = {
  nama: string;
  email: string;
  no_hp: string;
  instansi: string;
  pesan: string;
  setuju: boolean;
  /** Honeypot: pengguna manusia tidak pernah mengisinya. */
  situs_web: string;
};
export type KunciGalat = 'nama' | 'email' | 'no_hp' | 'instansi' | 'pesan' | 'setuju';
export type GalatIsian = Partial<Record<KunciGalat, string>>;

export const ISIAN_KOSONG: Isian = { nama: '', email: '', no_hp: '', instansi: '', pesan: '', setuju: false, situs_web: '' };
export const BATAS = { nama: 200, instansi: 200, pesan: 2000, pesanMin: 10 } as const;

const POLA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POLA_HP = /^\+?[0-9]{8,20}$/;

/** Pemeriksaan sisi klien; cermin batas server (`skema-minat.ts`) agar pesan galat langsung terlihat di bidangnya. */
export function periksaIsian(isian: Isian, kanal: KanalMinat): GalatIsian {
  const galat: GalatIsian = {};
  const nama = isian.nama.trim();
  if (!nama) galat.nama = 'Nama wajib diisi.';
  else if (nama.length > BATAS.nama) galat.nama = `Nama paling banyak ${BATAS.nama} karakter.`;
  const email = isian.email.trim();
  if (!email) galat.email = 'Email wajib diisi.';
  else if (email.length > 254 || !POLA_EMAIL.test(email)) galat.email = 'Tulis alamat email yang benar, mis. nama@contoh.id.';
  const hp = isian.no_hp.trim();
  if (kanal === 'ipro' && hp && !POLA_HP.test(hp.replace(/[\s.()-]/g, ''))) galat.no_hp = 'Nomor HP 8 sampai 20 angka, boleh diawali +.';
  if (isian.instansi.trim().length > BATAS.instansi) galat.instansi = `Instansi paling banyak ${BATAS.instansi} karakter.`;
  const pesan = isian.pesan.trim();
  if (kanal === 'ipro' && pesan.length < BATAS.pesanMin) galat.pesan = `Pesan minimal ${BATAS.pesanMin} karakter.`;
  else if (pesan.length > BATAS.pesan) galat.pesan = `Pesan paling banyak ${BATAS.pesan} karakter.`;
  if (!isian.setuju) galat.setuju = 'Centang persetujuan untuk melanjutkan.';
  return galat;
}

/** Badan permintaan tanpa `operasi_id` (dipakai juga sebagai sidik untuk memutuskan apakah retry boleh memakai id lama). */
export function susunBadan(isian: Isian, kanal: KanalMinat, refId: string): Record<string, unknown> {
  const opsional = (nilai: string) => (nilai.trim() ? nilai.trim() : undefined);
  const dasar = {
    nama: isian.nama.trim(),
    email: isian.email.trim(),
    instansi: opsional(isian.instansi),
    pesan: opsional(isian.pesan),
    setuju_pdp: true,
    situs_web: isian.situs_web,
  };
  return kanal === 'ipro'
    ? { ipro_id: refId, ...dasar, no_hp: opsional(isian.no_hp) }
    : { doc_id: refId, ...dasar };
}
