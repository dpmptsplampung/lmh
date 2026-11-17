// Draf Pendataan Khusus (G5): konversi murni antara isian formulir (string, seperti PendataanKhususFields) dan objek
// jawaban yang disimpan RPC `pendataan_khusus_draf_simpan`. Kunci jawaban selalu UUID isian; nilai langsung bertipe JSON
// (string / number / boolean / string[]). Draf boleh belum lengkap, jadi nilai kosong atau tidak terbaca dibuang dan
// simpan adalah PENGGANTIAN SELURUH objek (bukan patch). Tanpa React dan tanpa I/O.
import { BATAS_KHUSUS, type FieldKhusus, type NilaiKhusus } from './jenis';
import type { NilaiForm } from './jawaban';

export type JawabanDraf = Record<string, NilaiKhusus>;

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/** Isian formulir -> objek draf. Hanya isian yang terlihat dan hanya nilai terbaca; yang kosong dibuang. */
export function drafDariForm(fields: readonly FieldKhusus[], form: NilaiForm): JawabanDraf {
  const hasil: JawabanDraf = {};
  for (const f of fields) {
    if (f.tersembunyi) continue;
    const v = form[f.id];
    if (v === undefined) continue;
    switch (f.jenis) {
      case 'teks_singkat':
      case 'teks_panjang': {
        const teks = typeof v === 'string' ? v.trim() : '';
        if (teks) hasil[f.id] = teks;
        break;
      }
      case 'angka': {
        if (typeof v !== 'string' || v.trim() === '') break;
        const angka = Number(v.replace(',', '.'));
        if (Number.isFinite(angka) && Math.abs(angka) <= BATAS_KHUSUS.angkaMaks) hasil[f.id] = angka;
        break;
      }
      case 'tanggal':
        if (typeof v === 'string' && TANGGAL.test(v.trim())) hasil[f.id] = v.trim();
        break;
      case 'pilihan_tunggal':
        if (typeof v === 'string' && f.opsi.includes(v.trim())) hasil[f.id] = v.trim();
        break;
      case 'pilihan_ganda': {
        const pilih = Array.isArray(v) ? [...new Set(v.filter((x) => f.opsi.includes(x)))] : [];
        if (pilih.length > 0) hasil[f.id] = pilih;
        break;
      }
      case 'ya_tidak':
        if (v === 'ya') hasil[f.id] = true;
        else if (v === 'tidak') hasil[f.id] = false;
        break;
    }
  }
  return hasil;
}

/** Objek draf (dari server) -> isian formulir. Kunci asing (isian sudah disembunyikan/dihapus) dan tipe salah dilewati. */
export function formDariDraf(fields: readonly FieldKhusus[], jawaban: Record<string, unknown> | null | undefined): NilaiForm {
  const form: NilaiForm = {};
  if (!jawaban) return form;
  for (const f of fields) {
    if (f.tersembunyi) continue;
    const v = jawaban[f.id];
    if (typeof v === 'string') form[f.id] = f.jenis === 'pilihan_ganda' ? [] : v;
    else if (typeof v === 'number' && Number.isFinite(v)) form[f.id] = String(v);
    else if (typeof v === 'boolean') form[f.id] = v ? 'ya' : 'tidak';
    else if (Array.isArray(v) && f.jenis === 'pilihan_ganda') {
      form[f.id] = v.filter((x): x is string => typeof x === 'string');
    }
  }
  return form;
}

/** Kunci stabil sebuah draf (urutan kunci tidak berpengaruh) untuk mendeteksi "belum tersimpan". */
export function kunciDraf(jawaban: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(jawaban).sort().map((k) => [k, jawaban[k]]),
  );
}

/** Jumlah isian wajib yang masih kosong pada draf (untuk ringkasan "n isian wajib belum diisi"). */
export function jumlahWajibKosong(fields: readonly FieldKhusus[], jawaban: Record<string, unknown>): number {
  return fields.filter((f) => !f.tersembunyi && f.wajib && jawaban[f.id] === undefined).length;
}
