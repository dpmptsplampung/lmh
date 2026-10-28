// Draf sesi wizard "Pesan Perilaku": jawaban sementara disimpan di sessionStorage supaya muat ulang halaman (atau tab
// yang tertidur di ponsel) tidak menghapus isian. Disimpan per undangan; dihapus setelah berhasil terkirim.
// SEMUA akses dibungkus try/catch: sessionStorage bisa melempar (mode privat, kuota penuh, akses diblokir) dan itu tidak
// boleh merusak wizard. Isi draf tidak dipercaya: `muatDraf` memvalidasi bentuk dan rentang, lalu mengembalikan null bila rusak.
import { LANGKAH, type Jawaban } from './pertanyaan';
import { buatState, nilaiSah, type StateWizard } from './wizard';

// Hanya 16 karakter pertama token yang masuk ke nama kunci: draf tidak menyalin token penuh ke penyimpanan.
const kunciPenyimpanan = (token: string): string => `lmh:survei:${token.slice(0, 16)}`;

export function simpanDraf(token: string, state: StateWizard): void {
  try {
    sessionStorage.setItem(kunciPenyimpanan(token), JSON.stringify({ indeks: state.indeks, jawaban: state.jawaban }));
  } catch {
    // Draf hanya kemudahan; gagal menyimpan tidak boleh mengganggu pengisian.
  }
}

function adalahObjek(nilai: unknown): nilai is Record<string, unknown> {
  return typeof nilai === 'object' && nilai !== null && !Array.isArray(nilai);
}

export function muatDraf(token: string): StateWizard | null {
  try {
    const mentah = sessionStorage.getItem(kunciPenyimpanan(token));
    if (mentah === null) return null;
    const data: unknown = JSON.parse(mentah);
    if (!adalahObjek(data) || !adalahObjek(data.jawaban)) return null;

    const { indeks } = data;
    if (typeof indeks !== 'number' || !Number.isInteger(indeks) || indeks < 0 || indeks >= LANGKAH.length) return null;

    const jawaban: Jawaban = {};
    for (const [kunci, nilai] of Object.entries(data.jawaban)) {
      if (!nilaiSah(kunci, nilai)) return null;
      jawaban[kunci as keyof Jawaban] = nilai;
    }
    return buatState(jawaban, indeks);
  } catch {
    return null;
  }
}

export function hapusDraf(token: string): void {
  try {
    sessionStorage.removeItem(kunciPenyimpanan(token));
  } catch {
    // Diabaikan: draf yang tertinggal hanya berlaku selama sesi tab dan divalidasi lagi saat dimuat.
  }
}
