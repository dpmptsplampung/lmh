// Normalisasi pertanyaan pengunjung sebelum pencocok FAQ (Fase 1b).
// Tujuan: satu bentuk kanonik untuk "NIB?", "nib apa", "Nomor Induk Berusaha".

export const DEFAULT_SINONIM: Record<string, string[]> = {
  nib: ['nomor induk berusaha'],
  oss: ['online single submission'],
  kbli: ['klasifikasi baku lapangan usaha indonesia'],
  skm: ['survei kepuasan masyarakat'],
  ipro: ['investment promo'],
};

export function normalizeQuestion(
  raw: string,
  sinonim: Record<string, string[]> = DEFAULT_SINONIM,
): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const expanded: string[] = [];
  for (const t of tokens) {
    expanded.push(t);
    const variants = sinonim[t];
    if (variants) expanded.push(...variants);
  }
  return expanded.join(' ');
}
