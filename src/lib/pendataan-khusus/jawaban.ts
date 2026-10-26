// Validasi jawaban Pendataan Khusus di sisi klien/route (semantik sama dengan pendataan_khusus_validasi di DB,
// migrasi 202610300001; DB tetap penegak akhir) dan pemformatan nilai untuk tabel/Excel rekap.
import { formatTanggalId } from '@/lib/rekap/format';
import { BATAS_KHUSUS, type FieldKhusus, type JenisKhusus, type NilaiKhusus } from './jenis';

export interface HasilValidasiKhusus {
  /** id isian -> pesan galat. */
  galat: Record<string, string>;
  /** id isian -> nilai ternormalkan; hanya isian terlihat yang terisi. */
  payload: Record<string, NilaiKhusus>;
}

const kosong = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function tanggalSah(s: string): boolean {
  if (!TANGGAL.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function validasiJawabanKhusus(fields: FieldKhusus[], mentah: Record<string, unknown>): HasilValidasiKhusus {
  const galat: Record<string, string> = {};
  const payload: Record<string, NilaiKhusus> = {};
  for (const f of fields) {
    if (f.tersembunyi) continue;
    const v = mentah[f.id];
    if (kosong(v)) {
      if (f.wajib) galat[f.id] = `${f.label} wajib diisi.`;
      continue;
    }
    switch (f.jenis) {
      case 'teks_singkat':
      case 'teks_panjang': {
        const maks = f.jenis === 'teks_singkat' ? BATAS_KHUSUS.teksSingkat : BATAS_KHUSUS.teksPanjang;
        if (typeof v !== 'string') galat[f.id] = `${f.label} harus berupa teks.`;
        else if (v.trim().length > maks) galat[f.id] = `${f.label} maksimal ${maks} karakter.`;
        else payload[f.id] = v.trim();
        break;
      }
      case 'angka':
        if (typeof v !== 'number' || !Number.isFinite(v)) galat[f.id] = `${f.label} harus berupa angka.`;
        else if (Math.abs(v) > BATAS_KHUSUS.angkaMaks) galat[f.id] = `${f.label} di luar batas angka.`;
        else payload[f.id] = v;
        break;
      case 'tanggal':
        if (typeof v !== 'string' || !tanggalSah(v.trim())) galat[f.id] = `${f.label} harus tanggal yang sah.`;
        else payload[f.id] = v.trim();
        break;
      case 'pilihan_tunggal':
        if (typeof v !== 'string' || !f.opsi.includes(v.trim())) galat[f.id] = `${f.label}: pilih salah satu dari daftar.`;
        else payload[f.id] = v.trim();
        break;
      case 'pilihan_ganda':
        if (
          !Array.isArray(v) ||
          v.some((x) => typeof x !== 'string' || !f.opsi.includes(x)) ||
          new Set(v).size !== v.length
        ) {
          galat[f.id] = `${f.label}: pilih dari daftar tanpa pilihan ganda berulang.`;
        } else payload[f.id] = v as string[];
        break;
      case 'ya_tidak':
        if (typeof v !== 'boolean') galat[f.id] = `${f.label}: pilih Ya atau Tidak.`;
        else payload[f.id] = v;
        break;
    }
  }
  return { galat, payload };
}

/** Nilai sel tabel/Excel rekap (K9). `null` bila tidak ada jawaban. */
export function formatNilaiKhusus(f: { jenis: JenisKhusus | string }, nilai: unknown): string | number | null {
  if (nilai === undefined || nilai === null) return null;
  switch (f.jenis) {
    case 'ya_tidak':
      return nilai === true ? 'Ya' : nilai === false ? 'Tidak' : null;
    case 'pilihan_ganda':
      return Array.isArray(nilai) ? nilai.map(String).join('; ') : String(nilai);
    case 'angka':
      return typeof nilai === 'number' ? nilai : Number.isFinite(Number(nilai)) ? Number(nilai) : String(nilai);
    case 'tanggal':
      return typeof nilai === 'string' && TANGGAL.test(nilai) ? formatTanggalId(nilai) : String(nilai);
    default:
      return String(nilai);
  }
}

/** Isian formulir mentah per id isian: teks untuk semua jenis (angka juga teks; ya/tidak = 'ya' | 'tidak'), array untuk pilihan ganda. */
export type NilaiForm = Record<string, string | string[]>;

/** Mengubah isian formulir (string) menjadi jawaban bertipe untuk `validasiJawabanKhusus` dan RPC. */
export function susunJawabanMentah(fields: FieldKhusus[], form: NilaiForm): Record<string, unknown> {
  const hasil: Record<string, unknown> = {};
  for (const f of fields) {
    const v = form[f.id];
    if (v === undefined) continue;
    if (f.jenis === 'angka') {
      if (typeof v === 'string' && v.trim() !== '') hasil[f.id] = Number(v.replace(',', '.'));
    } else if (f.jenis === 'ya_tidak') {
      if (v === 'ya') hasil[f.id] = true;
      else if (v === 'tidak') hasil[f.id] = false;
    } else {
      hasil[f.id] = v;
    }
  }
  return hasil;
}
