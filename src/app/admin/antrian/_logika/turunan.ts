// Turunan murni halaman antrean admin (rencana refaktor 2026-11-11 tugas 5.2, SPEC bagian 7): label, pemilihan Layanan,
// Panel Sekarang (berikutnya/sedang dilayani), dan penyaringan/pengelompokan dari data yang sudah dimuat.
// Tanpa I/O dan tanpa React: hanya fungsi dari data ke data (uji sebagai fungsi murni di turunan.test.ts).
import type {
  KunjunganEmbed,
  LayananEmbed,
  ProfilPetugasAntrean,
  TiketBaris,
} from '@/lib/data/antrean';
import { bolehMulaiTiket, bolehSelesaikanTiket, formPendataanLayanan } from '@/lib/pelayanan';
import { formatTanggal } from '@/lib/utils';
import type { NadaLencana } from '@/components/ui/Lencana';
import type { OpsiLayananPanel, TiketPanel } from '../PanelSekarang';
import type { FilterStatus } from '../antrianUrl';

// ── Embed tiket (relasi PostgREST bisa berupa objek atau larik) ───────────────────────────────────────────────

export function kunjunganDari(a: TiketBaris): KunjunganEmbed | null {
  if (!a.kunjungan) return null;
  return Array.isArray(a.kunjungan) ? a.kunjungan[0] ?? null : a.kunjungan;
}

export function namaPelayanDari(a: TiketBaris): string | null {
  if (!a.pelayan) return null;
  return (Array.isArray(a.pelayan) ? a.pelayan[0]?.nama : a.pelayan.nama) ?? null;
}

function layananDari(a: TiketBaris): LayananEmbed | null | undefined {
  return Array.isArray(a.layanan) ? a.layanan[0] : a.layanan;
}

export function namaLayananDari(a: TiketBaris): string {
  if (!a.layanan) return '—';
  if (Array.isArray(a.layanan)) return a.layanan[0]?.nama ?? '—';
  return (a.layanan as { nama: string }).nama ?? '—';
}

/** Layanan wajib Formulir Pendataan: kolom DB layanan.form_pendataan (fallback nama bila kolom tak ter-select). */
export function punyaPendataan(a: TiketBaris): boolean {
  return formPendataanLayanan(layananDari(a)) !== null;
}

// ── Profil dan kepala halaman ─────────────────────────────────────────────────────────────────────────────────

export function namaLayananProfil(user: ProfilPetugasAntrean | null): string | null | undefined {
  const l = user?.layanan;
  if (!l) return null;
  if (Array.isArray(l)) return l[0]?.nama;
  return (l as { nama: string }).nama;
}

export function judulHalaman(user: ProfilPetugasAntrean | null, namaLayanan: string | null | undefined): string {
  return user?.role === 'petugas' && namaLayanan ? `Antrean ${namaLayanan}` : 'Antrean Semua Layanan';
}

/** Admin dan Front Office melihat semua Layanan (kolom Layanan, pilihan Layanan di panel, Koreksi Data). */
export function bolehLihatSemuaLayanan(user: ProfilPetugasAntrean | null): boolean {
  return user?.role === 'admin' || user?.role === 'front_office';
}

// ── Label ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const NADA_STATUS: Record<string, NadaLencana> = {
  menunggu: 'peringatan',
  dilayani: 'info',
  selesai: 'sukses',
  tidak_terlayani: 'bahaya',
  no_show: 'netral',
  batal: 'netral',
  dikembalikan: 'peringatan',
  dialihkan: 'info',
};

export function labelStatus(status: string): string {
  switch (status) {
    case 'menunggu': return 'Menunggu';
    case 'dilayani': return 'Dilayani';
    case 'selesai': return 'Selesai';
    case 'tidak_terlayani': return 'Tidak terlayani (petugas tidak hadir)';
    case 'no_show': return 'Tidak datang (warga)';
    case 'batal': return 'Batal';
    case 'dikembalikan': return 'Dikembalikan ke FO';
    case 'dialihkan': return 'Dialihkan';
    default: return status;
  }
}

export const labelAsal = (asal: string): string => (asal === 'reservasi' ? 'Reservasi' : 'Walk-in');

/** "2026-11-04" -> "4 November 2026" (kalender WIB; jam 12 siang menghindari geseran hari). */
export const tanggalPanjang = (t: string): string => formatTanggal(`${t}T12:00:00+07:00`);

/** Durasi tiket selesai ("25 menit"): dari mulai layan, jatuh ke waktu masuk kunjungan lalu waktu terbit. '—' bila belum selesai. */
export function durasiTeks(a: TiketBaris): string {
  if (!a.waktu_selesai) return '—';
  const waktuMasuk = kunjunganDari(a)?.waktu_masuk ?? a.waktu_terbit;
  const mulai = a.waktu_mulai_layan
    ? new Date(a.waktu_mulai_layan).getTime()
    : new Date(waktuMasuk || new Date().toISOString()).getTime();
  const menit = Math.round((new Date(a.waktu_selesai).getTime() - mulai) / 60000);
  return `${menit} menit`;
}

// ── Id untuk kueri lanjutan ───────────────────────────────────────────────────────────────────────────────────

/** Id tahap FO asal tiket hasil eskalasi (unik) untuk catatan eskalasi. */
export function idTahapAsal(baris: readonly TiketBaris[]): string[] {
  return Array.from(new Set(baris.map((b) => b.penanganan_asal_id).filter((v): v is string => !!v)));
}

/** Kunjungan dari tiket selesai (status Pesan Perilaku hanya berlaku untuk kunjungan yang sudah selesai). */
export function idKunjunganSelesai(baris: readonly TiketBaris[]): string[] {
  return baris.filter((b) => b.status === 'selesai' && b.kunjungan_id).map((b) => b.kunjungan_id);
}

// ── Panel Sekarang ────────────────────────────────────────────────────────────────────────────────────────────

/** Panel Sekarang (A1): hanya untuk hari ini dan saat tab bukan "Selesai" (datanya terpisah dari halaman tabel). */
export function panelBerlaku(tanggal: string, filter: FilterStatus, hariIni: string): boolean {
  return tanggal === hariIni && filter !== 'selesai';
}

export interface PanelTurunan {
  /** Layanan yang punya tiket menunggu, urut nama. */
  opsiLayanan: OpsiLayananPanel[];
  /** Layanan yang dipakai: pilihan Admin/FO bila masih punya tiket menunggu, selain itu pilihan pertama; null bila tak ada. */
  layananAktif: string | null;
  /** Tiket yang sedang saya layani (pemilik); null bila tidak ada. */
  sedangDilayani: TiketPanel | null;
  /** Tiket menunggu bernomor terkecil di Layanan aktif; null bila tidak ada. */
  berikutnya: TiketPanel | null;
}

export function turunkanPanel(
  barisPanel: readonly TiketBaris[],
  user: ProfilPetugasAntrean | null,
  pilihanLayananId: string | null,
): PanelTurunan {
  const peta = new Map<string, string>();
  for (const a of barisPanel) if (a.status === 'menunggu') peta.set(a.layanan_id, namaLayananDari(a));
  const opsiLayanan = Array.from(peta, ([id, nama]) => ({ id, nama })).sort((x, y) => x.nama.localeCompare(y.nama, 'id'));
  const layananAktif = opsiLayanan.some((o) => o.id === pilihanLayananId)
    ? pilihanLayananId
    : (opsiLayanan[0]?.id ?? null);

  const keTiketPanel = (a: TiketBaris, waktu: string | null): TiketPanel => ({
    id: a.id,
    nomor_display: a.nomor_display,
    layananNama: namaLayananDari(a),
    namaPengunjung: kunjunganDari(a)?.nama ?? '—',
    waktu,
    bolehMulai: bolehMulaiTiket(user, a),
    bolehSelesai: bolehSelesaikanTiket(user, a),
  });
  const barisSaya = barisPanel.find((a) => bolehSelesaikanTiket(user, a));
  const barisBerikutnya = barisPanel
    .filter((a) => a.status === 'menunggu' && a.layanan_id === layananAktif)
    .sort((x, y) => x.nomor - y.nomor)[0];
  return {
    opsiLayanan,
    layananAktif,
    sedangDilayani: barisSaya ? keTiketPanel(barisSaya, barisSaya.waktu_mulai_layan) : null,
    berikutnya: barisBerikutnya
      ? keTiketPanel(barisBerikutnya, kunjunganDari(barisBerikutnya)?.waktu_masuk ?? barisBerikutnya.waktu_terbit)
      : null,
  };
}
