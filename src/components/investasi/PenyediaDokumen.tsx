'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { DokumenBuka } from './dokumen-logika';
import FormulirMinat from './FormulirMinat';
import PenampilDokumen from './PenampilDokumen';

type AksiDokumen = {
  /** Buka penampil dokumen (hanya lihat). */
  buka: (d: DokumenBuka) => void;
  /** Buka formulir minat investasi untuk dokumen ini. */
  minat: (d: DokumenBuka) => void;
};

const KonteksDokumen = createContext<AksiDokumen | null>(null);

export function useAksiDokumen(): AksiDokumen {
  const aksi = useContext(KonteksDokumen);
  if (!aksi) throw new Error('KartuDokumen harus berada di dalam PenyediaDokumen.');
  return aksi;
}

/**
 * Satu penampil dan satu formulir minat untuk semua kartu dokumen pada halaman (sorotan Peta Potensi, kisi dokumen).
 * Server Component boleh menjadi `children`: hanya state buka/tutup yang hidup di klien.
 */
export default function PenyediaDokumen({ kontakEmail, children }: { kontakEmail: string; children: ReactNode }) {
  const [dibuka, setDibuka] = useState<DokumenBuka | null>(null);
  const [diminati, setDiminati] = useState<DokumenBuka | null>(null);
  const aksi = useMemo<AksiDokumen>(() => ({ buka: setDibuka, minat: setDiminati }), []);
  return (
    <KonteksDokumen value={aksi}>
      {children}
      {dibuka && (
        <PenampilDokumen
          dokumenId={dibuka.id}
          judul={dibuka.judul}
          jumlahHalaman={dibuka.jumlah_halaman}
          kategori={dibuka.kategori}
          kontakEmail={kontakEmail}
          onMinat={() => { setDiminati(dibuka); }}
          onTutup={() => setDibuka(null)}
        />
      )}
      {/* Formulir minat tanpa login: persetujuan PDP, operasi_id, dan honeypot dibawa FormulirMinat. */}
      <FormulirMinat
        terbuka={diminati !== null}
        onTutup={() => setDiminati(null)}
        kanal="dokumen"
        refId={diminati?.id ?? ''}
        konteks={diminati?.judul ?? ''}
      />
    </KonteksDokumen>
  );
}
