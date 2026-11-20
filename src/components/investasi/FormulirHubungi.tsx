'use client';

import FormulirMinat from './FormulirMinat';

/** Formulir "Hubungi petugas" untuk satu proyek IPRO PTSP (tanpa login; sesi anonim dibuat otomatis saat kirim). */
export default function FormulirHubungi({ terbuka, onTutup, ipro }: {
  terbuka: boolean;
  onTutup: () => void;
  ipro: { id: string; judul: string };
}) {
  return <FormulirMinat terbuka={terbuka} onTutup={onTutup} kanal="ipro" refId={ipro.id} konteks={ipro.judul} />;
}
