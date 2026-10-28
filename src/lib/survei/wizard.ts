// Logika wizard "Pesan Perilaku" (survei terpadu Fase A) sebagai fungsi MURNI: tanpa React, DOM, atau penyimpanan, sehingga
// aturan ketukan/lanjut/kirim bisa diuji tanpa render. Komponen (Task 9) hanya memanggil fungsi ini dan menjalankan
// `AksiSetelahJawab`-nya (gulir, maju, kirim).
//
// Aturan inti (spec keputusan 7): ketukan jawaban terakhir langsung lanjut TANPA delay; jawaban terakhir SKM langsung
// mengirim; Next/Back tetap ada; auto-lanjut hanya untuk ketukan/klik (`otomatis: true`), bukan keyboard.
import {
  LANGKAH,
  PERTANYAAN_SPAK,
  RENTANG,
  UNSUR_SKM,
  type Jawaban,
  type KunciSkm,
  type KunciSpak,
} from './pertanyaan';

export interface StateWizard {
  /** Indeks langkah aktif (0..LANGKAH.length - 1). */
  indeks: number;
  jawaban: Jawaban;
}

export type AksiSetelahJawab =
  | { aksi: 'tetap' }
  | { aksi: 'gulir'; kunci: KunciSpak | KunciSkm }
  | { aksi: 'lanjut' }
  | { aksi: 'kirim' };

const KUNCI_SPAK: readonly KunciSpak[] = PERTANYAAN_SPAK.map((p) => p.kunci);
const KUNCI_SKM: readonly KunciSkm[] = UNSUR_SKM.map((u) => u.kunci);
const SEMUA_KUNCI: readonly string[] = [...KUNCI_SPAK, ...KUNCI_SKM];
const LANGKAH_TERAKHIR = LANGKAH.length - 1;

/**
 * Nilai sah untuk sebuah kunci: kunci dikenal, nilai bilangan BULAT dalam rentang survei kunci itu (SPAK 1-6, SKM 1-4).
 * Menolak NaN, Infinity, desimal, string, dan null. Dipakai juga oleh `muatDraf` agar draf rusak tidak lolos.
 */
export function nilaiSah(kunci: string, nilai: unknown): nilai is number {
  if (!SEMUA_KUNCI.includes(kunci)) return false;
  if (typeof nilai !== 'number' || !Number.isInteger(nilai)) return false;
  const rentang = kunci.startsWith('p') ? RENTANG.spak : RENTANG.skm;
  return nilai >= rentang.min && nilai <= rentang.max;
}

export function buatState(jawaban: Jawaban = {}, indeks = 0): StateWizard {
  const aman = Number.isInteger(indeks) ? Math.min(Math.max(indeks, 0), LANGKAH_TERAKHIR) : 0;
  return { indeks: aman, jawaban: { ...jawaban } };
}

function belumTerjawab(jawaban: Jawaban, kunci: KunciSpak | KunciSkm): boolean {
  return !nilaiSah(kunci, jawaban[kunci]);
}

export function langkahLengkap(state: StateWizard): boolean {
  return LANGKAH[state.indeks].kunci.every((k) => !belumTerjawab(state.jawaban, k));
}

export function semuaLengkap(state: StateWizard): boolean {
  return LANGKAH.every((l) => l.kunci.every((k) => !belumTerjawab(state.jawaban, k)));
}

/**
 * Mencatat satu jawaban dan menentukan apa yang harus dilakukan pemanggil berikutnya.
 *
 * - Nilai di luar rentang (atau bukan bilangan bulat), kunci yang bukan bagian langkah aktif, atau kunci tak dikenal:
 *   ditolak, state tidak berubah (objek yang sama), hasil `tetap`.
 * - `otomatis: false` (keyboard, atau ketukan yang tidak boleh memicu): jawaban tersimpan, hasil selalu `tetap`.
 * - Langkah lengkap sesudah jawaban ini: `kirim` bila langkah terakhir, selain itu `lanjut`. State BELUM maju: pemanggil
 *   memanggil `maju`. Mengetuk jawaban yang sama pada langkah yang sudah lengkap tetap `lanjut` (itu ketukan baru);
 *   Back ke langkah terjawab sendiri tidak memicu apa pun.
 *   `kirim` tidak memeriksa langkah-langkah sebelumnya: pemanggil memakai `bangunPayload` (null bila ada yang kosong).
 * - Langkah belum lengkap: `gulir` ke kunci belum terjawab pertama setelah kunci ini, atau yang pertama belum terjawab.
 */
export function jawab(
  state: StateWizard,
  kunci: KunciSpak | KunciSkm,
  nilai: number,
  opsi: { otomatis: boolean },
): { state: StateWizard; hasil: AksiSetelahJawab } {
  const kunciLangkah = LANGKAH[state.indeks].kunci;
  if (!kunciLangkah.includes(kunci) || !nilaiSah(kunci, nilai)) {
    return { state, hasil: { aksi: 'tetap' } };
  }

  const berikut: StateWizard = { indeks: state.indeks, jawaban: { ...state.jawaban, [kunci]: nilai } };
  if (!opsi.otomatis) return { state: berikut, hasil: { aksi: 'tetap' } };

  if (langkahLengkap(berikut)) {
    return { state: berikut, hasil: { aksi: state.indeks === LANGKAH_TERAKHIR ? 'kirim' : 'lanjut' } };
  }

  const kosong = (k: KunciSpak | KunciSkm) => belumTerjawab(berikut.jawaban, k);
  const sasaran = kunciLangkah.slice(kunciLangkah.indexOf(kunci) + 1).find(kosong) ?? kunciLangkah.find(kosong);
  return { state: berikut, hasil: sasaran ? { aksi: 'gulir', kunci: sasaran } : { aksi: 'tetap' } };
}

/** Maju satu langkah. Tidak melewati langkah terakhir dan tidak maju bila langkah aktif belum lengkap (state yang sama). */
export function maju(state: StateWizard): StateWizard {
  if (state.indeks >= LANGKAH_TERAKHIR || !langkahLengkap(state)) return state;
  return { indeks: state.indeks + 1, jawaban: state.jawaban };
}

/** Mundur satu langkah (selalu boleh, jawaban dipertahankan); berhenti di langkah pertama. */
export function mundur(state: StateWizard): StateWizard {
  if (state.indeks <= 0) return state;
  return { indeks: state.indeks - 1, jawaban: state.jawaban };
}

/**
 * Payload untuk `POST /api/survei/kirim`: persis 5 kunci SPAK dan 11 kunci SKM, berurutan. `null` bila ada kunci yang kosong
 * atau bernilai tidak sah. Kunci lain pada `jawaban` tidak ikut terkirim.
 */
export function bangunPayload(
  jawaban: Jawaban,
): { spak: Record<KunciSpak, number>; skm: Record<KunciSkm, number> } | null {
  const spak: Partial<Record<KunciSpak, number>> = {};
  for (const kunci of KUNCI_SPAK) {
    const nilai = jawaban[kunci];
    if (!nilaiSah(kunci, nilai)) return null;
    spak[kunci] = nilai;
  }
  const skm: Partial<Record<KunciSkm, number>> = {};
  for (const kunci of KUNCI_SKM) {
    const nilai = jawaban[kunci];
    if (!nilaiSah(kunci, nilai)) return null;
    skm[kunci] = nilai;
  }
  return { spak: spak as Record<KunciSpak, number>, skm: skm as Record<KunciSkm, number> };
}
