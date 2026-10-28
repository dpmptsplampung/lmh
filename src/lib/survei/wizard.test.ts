// @vitest-environment node
// Uji logika wizard Pesan Perilaku (Task 7): fungsi murni tanpa DOM. Aturan inti (common.md): ketukan jawaban terakhir
// langsung lanjut tanpa delay, jawaban terakhir SKM langsung mengirim, auto-lanjut hanya untuk ketukan/klik (bukan keyboard).
import { describe, expect, it } from 'vitest';
import { LANGKAH, type Jawaban, type KunciSkm, type KunciSpak } from './pertanyaan';
import {
  bangunPayload,
  buatState,
  jawab,
  langkahLengkap,
  maju,
  mundur,
  semuaLengkap,
} from './wizard';

const OTO = { otomatis: true } as const;
const MANUAL = { otomatis: false } as const;

/** Jawaban lengkap (SPAK 4, SKM 3) untuk kunci yang diminta. */
function isi(...kunci: (KunciSpak | KunciSkm)[]): Jawaban {
  return Object.fromEntries(kunci.map((k) => [k, k.startsWith('p') ? 4 : 3]));
}
const LENGKAP: Jawaban = isi(...LANGKAH.flatMap((l) => [...l.kunci]));

describe('buatState', () => {
  it('default: langkah 0 tanpa jawaban', () => {
    expect(buatState()).toEqual({ indeks: 0, jawaban: {} });
  });

  it('menyalin jawaban (tidak berbagi referensi) dan membatasi indeks ke 0..4', () => {
    const sumber: Jawaban = { p1: 3 };
    const s = buatState(sumber, 2);
    sumber.p1 = 6;
    expect(s.jawaban.p1).toBe(3);
    expect(buatState({}, -3).indeks).toBe(0);
    expect(buatState({}, 99).indeks).toBe(LANGKAH.length - 1);
    expect(buatState({}, 1.7).indeks).toBe(0);
    expect(buatState({}, Number.NaN).indeks).toBe(0);
  });
});

describe('jawab: ketukan (otomatis) menentukan aksi berikutnya', () => {
  it('menjawab soal TERAKHIR yang belum terjawab di langkah 1 -> lanjut (state belum maju)', () => {
    const awal = buatState(isi('p1', 'p2'));
    const { state, hasil } = jawab(awal, 'p3', 5, OTO);
    expect(hasil).toEqual({ aksi: 'lanjut' });
    expect(state.indeks).toBe(0);
    expect(state.jawaban.p3).toBe(5);
  });

  it('menjawab soal pertama langkah SKM 1 -> gulir ke u2', () => {
    const awal = buatState(isi('p1', 'p2', 'p3', 'p4', 'p5'), 2);
    const { state, hasil } = jawab(awal, 'u1', 4, OTO);
    expect(hasil).toEqual({ aksi: 'gulir', kunci: 'u2' });
    expect(state.jawaban.u1).toBe(4);
  });

  it('gulir ke kunci belum terjawab PERTAMA SETELAH kunci ini, melompati yang sudah terjawab', () => {
    const awal = buatState(isi('u2'), 2);
    const { hasil } = jawab(awal, 'u1', 4, OTO);
    expect(hasil).toEqual({ aksi: 'gulir', kunci: 'u3' });
  });

  it('bila tak ada yang kosong setelahnya, gulir ke yang pertama belum terjawab di langkah itu', () => {
    // u3 dan u4 sudah terjawab, u1 kosong: menjawab u2 -> sisa kosong hanya u1.
    const awal = buatState(isi('u3', 'u4'), 2);
    const { hasil } = jawab(awal, 'u2', 2, OTO);
    expect(hasil).toEqual({ aksi: 'gulir', kunci: 'u1' });
  });

  it('menjawab dengan otomatis:false -> selalu tetap, walau langkah menjadi lengkap; jawaban tetap tersimpan', () => {
    const awal = buatState(isi('p1', 'p2'));
    const { state, hasil } = jawab(awal, 'p3', 6, MANUAL);
    expect(hasil).toEqual({ aksi: 'tetap' });
    expect(state.jawaban.p3).toBe(6);
    expect(langkahLengkap(state)).toBe(true);
    expect(state.indeks).toBe(0);
  });

  it('otomatis:false pada langkah belum lengkap juga tetap (tanpa gulir)', () => {
    const { hasil } = jawab(buatState(), 'p1', 2, MANUAL);
    expect(hasil).toEqual({ aksi: 'tetap' });
  });

  it('langkah TERAKHIR lengkap dengan otomatis:true -> kirim', () => {
    const awal = buatState({ ...isi('p1', 'p2', 'p3', 'p4', 'p5', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'), u9: 3, u10: 3 }, 4);
    const { state, hasil } = jawab(awal, 'u11', 1, OTO);
    expect(hasil).toEqual({ aksi: 'kirim' });
    expect(state.indeks).toBe(4);
    expect(semuaLengkap(state)).toBe(true);
  });

  it('langkah terakhir lengkap dengan otomatis:false -> tetap (tidak mengirim dari keyboard)', () => {
    const awal = buatState({ ...LENGKAP, u11: undefined }, 4);
    const { hasil } = jawab(awal, 'u11', 3, MANUAL);
    expect(hasil).toEqual({ aksi: 'tetap' });
  });

  it('mengetuk jawaban yang SAMA pada langkah yang sudah lengkap tetap lanjut (setelah Back ke langkah terjawab, tidak ada pemicu sebelum ada ketukan)', () => {
    const lengkap = buatState(LENGKAP, 1);
    // Back/maju tidak memicu apa pun: hanya fungsi mundur/maju yang dipanggil, state berubah murni.
    expect(mundur(lengkap).indeks).toBe(0);
    // Ketukan pada nilai yang sama = jawaban yang sama, langkah lengkap -> lanjut.
    const { state, hasil } = jawab(buatState(LENGKAP, 1), 'p4', LENGKAP.p4!, OTO);
    expect(hasil).toEqual({ aksi: 'lanjut' });
    expect(state.jawaban).toEqual(LENGKAP);
  });

  it('mengubah jawaban pada langkah lengkap tetap lanjut dengan nilai baru', () => {
    const { state, hasil } = jawab(buatState(LENGKAP, 0), 'p2', 1, OTO);
    expect(hasil).toEqual({ aksi: 'lanjut' });
    expect(state.jawaban.p2).toBe(1);
  });

  it('tidak memutasi state masukan', () => {
    const awal = buatState(isi('p1'));
    const salinan = JSON.parse(JSON.stringify(awal));
    jawab(awal, 'p2', 3, OTO);
    expect(awal).toEqual(salinan);
  });
});

describe('jawab: penolakan', () => {
  const awal = buatState(isi('p1'));

  it.each([0, 7, 3.5, -1, Number.NaN, Number.POSITIVE_INFINITY])('SPAK menolak nilai %s: state tak berubah dan hasil tetap', (nilai) => {
    const { state, hasil } = jawab(awal, 'p2', nilai, OTO);
    expect(hasil).toEqual({ aksi: 'tetap' });
    expect(state).toEqual(awal);
    expect(state.jawaban.p2).toBeUndefined();
  });

  it.each([0, 5, 3.5, 6])('SKM menolak nilai %s (rentang 1-4)', (nilai) => {
    const s = buatState({}, 2);
    const { state, hasil } = jawab(s, 'u1', nilai, OTO);
    expect(hasil).toEqual({ aksi: 'tetap' });
    expect(state).toEqual(s);
  });

  it('SPAK menerima 6 dan SKM menerima 4 (batas atas sah)', () => {
    expect(jawab(awal, 'p2', 6, OTO).state.jawaban.p2).toBe(6);
    expect(jawab(buatState({}, 2), 'u1', 4, OTO).state.jawaban.u1).toBe(4);
  });

  it('nilai yang ditolak tidak menimpa jawaban sah sebelumnya', () => {
    const s = buatState(isi('p1'));
    expect(jawab(s, 'p1', 9, OTO).state.jawaban.p1).toBe(4);
  });

  it('kunci di luar langkah aktif atau tidak dikenal ditolak (tetap, state tak berubah)', () => {
    const s = buatState({}, 0);
    expect(jawab(s, 'p4', 3, OTO)).toEqual({ state: s, hasil: { aksi: 'tetap' } });
    expect(jawab(s, 'u1', 3, OTO)).toEqual({ state: s, hasil: { aksi: 'tetap' } });
    expect(jawab(s, 'p9' as KunciSpak, 3, OTO)).toEqual({ state: s, hasil: { aksi: 'tetap' } });
  });
});

describe('langkahLengkap / semuaLengkap', () => {
  it('lengkap hanya bila setiap kunci langkah aktif terisi nilai sah', () => {
    expect(langkahLengkap(buatState(isi('p1', 'p2'), 0))).toBe(false);
    expect(langkahLengkap(buatState(isi('p1', 'p2', 'p3'), 0))).toBe(true);
    expect(langkahLengkap(buatState({ ...isi('p1', 'p2'), p3: 0 }, 0))).toBe(false);
    expect(langkahLengkap(buatState({ ...isi('p1', 'p2'), p3: 3.5 }, 0))).toBe(false);
  });

  it('semuaLengkap membutuhkan seluruh 16 kunci, bukan hanya langkah aktif', () => {
    expect(semuaLengkap(buatState(LENGKAP, 4))).toBe(true);
    const { p3: _p3, ...tanpaP3 } = LENGKAP;
    void _p3;
    expect(semuaLengkap(buatState(tanpaP3, 4))).toBe(false);
    expect(langkahLengkap(buatState(tanpaP3, 4))).toBe(true);
  });
});

describe('maju / mundur', () => {
  it('maju tidak melewati langkah yang belum lengkap (mengembalikan state yang sama)', () => {
    const s = buatState(isi('p1', 'p2'));
    expect(maju(s)).toBe(s);
    expect(maju(s).indeks).toBe(0);
  });

  it('maju pada langkah lengkap menambah indeks dan menjaga jawaban', () => {
    const s = buatState(isi('p1', 'p2', 'p3'));
    const berikut = maju(s);
    expect(berikut.indeks).toBe(1);
    expect(berikut.jawaban).toEqual(s.jawaban);
  });

  it('maju tidak melewati langkah terakhir', () => {
    const s = buatState(LENGKAP, LANGKAH.length - 1);
    expect(maju(s).indeks).toBe(LANGKAH.length - 1);
  });

  it('mundur mengurangi indeks tanpa menghapus jawaban dan berhenti di langkah 0', () => {
    const s = buatState(LENGKAP, 2);
    expect(mundur(s).indeks).toBe(1);
    expect(mundur(s).jawaban).toEqual(LENGKAP);
    expect(mundur(buatState(LENGKAP, 0)).indeks).toBe(0);
  });

  it('mundur boleh dari langkah yang belum lengkap (Back selalu tersedia)', () => {
    expect(mundur(buatState({}, 3)).indeks).toBe(2);
  });

  it('alur penuh lima langkah: jawab otomatis -> maju sampai kirim', () => {
    let s = buatState();
    const aksi: string[] = [];
    for (const langkah of LANGKAH) {
      for (const kunci of langkah.kunci) {
        const nilai = kunci.startsWith('p') ? 6 : 4;
        const r = jawab(s, kunci, nilai, OTO);
        s = r.state;
        if (r.hasil.aksi === 'lanjut') {
          aksi.push('lanjut');
          s = maju(s);
        } else if (r.hasil.aksi === 'kirim') {
          aksi.push('kirim');
        }
      }
    }
    expect(aksi).toEqual(['lanjut', 'lanjut', 'lanjut', 'lanjut', 'kirim']);
    expect(s.indeks).toBe(4);
    expect(bangunPayload(s.jawaban)).not.toBeNull();
  });
});

describe('bangunPayload', () => {
  it('null bila satu kunci pun kosong', () => {
    for (const kunci of Object.keys(LENGKAP) as (KunciSpak | KunciSkm)[]) {
      const { [kunci]: _hilang, ...sisa } = LENGKAP;
      void _hilang;
      expect(bangunPayload(sisa), kunci).toBeNull();
    }
  });

  it('null bila ada nilai di luar rentang atau bukan bilangan bulat', () => {
    expect(bangunPayload({ ...LENGKAP, p1: 7 })).toBeNull();
    expect(bangunPayload({ ...LENGKAP, u5: 5 })).toBeNull();
    expect(bangunPayload({ ...LENGKAP, u11: 0 })).toBeNull();
    expect(bangunPayload({ ...LENGKAP, p3: 2.5 })).toBeNull();
    expect(bangunPayload({ ...LENGKAP, p3: Number.NaN })).toBeNull();
  });

  it('memetakan 5 kunci SPAK dan 11 kunci SKM bila lengkap, urut, dengan nilai persis', () => {
    const jawaban: Jawaban = {};
    (['p1', 'p2', 'p3', 'p4', 'p5'] as const).forEach((k, i) => { jawaban[k] = i + 1; });
    (['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9', 'u10', 'u11'] as const).forEach((k, i) => { jawaban[k] = (i % 4) + 1; });
    const payload = bangunPayload(jawaban);
    expect(payload).not.toBeNull();
    expect(Object.keys(payload!.spak)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(Object.keys(payload!.skm)).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9', 'u10', 'u11']);
    expect(payload!.spak).toEqual({ p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 });
    expect(payload!.skm).toEqual({ u1: 1, u2: 2, u3: 3, u4: 4, u5: 1, u6: 2, u7: 3, u8: 4, u9: 1, u10: 2, u11: 3 });
  });

  it('kunci asing pada jawaban tidak ikut ke payload', () => {
    const payload = bangunPayload({ ...LENGKAP, x: 3 } as Jawaban);
    expect(payload).not.toBeNull();
    expect(Object.keys(payload!.spak)).toHaveLength(5);
    expect(Object.keys(payload!.skm)).toHaveLength(11);
  });
});
