// Pengukur durasi langkah server untuk header `Server-Timing` (mis. `auth;dur=12, lingkup;dur=30`).
export interface Pengukur {
  ukur<T>(nama: string, kerja: () => Promise<T>): Promise<T>;
  header(): string;
}

export function buatPengukur(): Pengukur {
  const catatan: { nama: string; dur: number }[] = [];
  return {
    async ukur<T>(nama: string, kerja: () => Promise<T>): Promise<T> {
      const aman = nama.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const mulai = performance.now();
      try {
        return await kerja();
      } finally {
        catatan.push({ nama: aman, dur: Math.round((performance.now() - mulai) * 10) / 10 });
      }
    },
    header() {
      return catatan.map((c) => `${c.nama};dur=${c.dur}`).join(', ');
    },
  };
}
