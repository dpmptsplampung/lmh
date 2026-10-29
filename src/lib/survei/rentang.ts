// Preset rentang tanggal untuk filter "Hasil Survei". Murni: hari ini diberikan pemanggil (todayWIB()), semua perhitungan pada
// kalender WIB sebagai string 'YYYY-MM-DD' (tidak memakai zona perangkat).
export type Preset = 'bulan' | 'kuartal' | 'tahun' | 'tujuh' | 'tigapuluh' | 'kustom';

export const LABEL_PRESET: Record<Exclude<Preset, 'kustom'>, string> = {
  tujuh: '7 hari terakhir',
  tigapuluh: '30 hari terakhir',
  bulan: 'Bulan ini',
  kuartal: 'Kuartal ini',
  tahun: 'Tahun ini',
};

function geser(hariIni: string, hari: number): string {
  const [y, m, d] = hariIni.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + hari, 12)).toISOString().slice(0, 10);
}

export function rentangPreset(preset: Exclude<Preset, 'kustom'>, hariIni: string): { dari: string; sampai: string } {
  const [y, m] = hariIni.split('-').map(Number);
  const dua = (n: number) => String(n).padStart(2, '0');
  switch (preset) {
    case 'tujuh':
      return { dari: geser(hariIni, -6), sampai: hariIni };
    case 'tigapuluh':
      return { dari: geser(hariIni, -29), sampai: hariIni };
    case 'bulan':
      return { dari: `${y}-${dua(m)}-01`, sampai: hariIni };
    case 'kuartal':
      return { dari: `${y}-${dua(Math.floor((m - 1) / 3) * 3 + 1)}-01`, sampai: hariIni };
    case 'tahun':
      return { dari: `${y}-01-01`, sampai: hariIni };
  }
}

/** Preset yang cocok persis dengan rentang, atau 'kustom'. */
export function kenaliPreset(dari: string, sampai: string, hariIni: string): Preset {
  for (const p of Object.keys(LABEL_PRESET) as Exclude<Preset, 'kustom'>[]) {
    const r = rentangPreset(p, hariIni);
    if (r.dari === dari && r.sampai === sampai) return p;
  }
  return 'kustom';
}

export function labelRentang(dari: string, sampai: string): string {
  const fmt = (t: string) => {
    const [y, m, d] = t.split('-');
    return `${d}/${m}/${y}`;
  };
  return dari === sampai ? fmt(dari) : `${fmt(dari)} s.d. ${fmt(sampai)}`;
}
