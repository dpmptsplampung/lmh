'use client';

// Konfirmasi hapus FAQ (pengganti window.confirm): dialog project dengan fokus terkunci dan galat terlihat.
import { useState } from 'react';
import FormDialog from '@/components/admin/FormDialog';
import type { FAQ } from './types';

interface Props {
  faq: FAQ;
  onClose: () => void;
  /** Mengembalikan pesan galat, atau null bila berhasil (halaman menutup dialog). */
  onHapus: () => Promise<string | null>;
}

export default function HapusFaqDialog({ faq, onClose, onHapus }: Props) {
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const hapus = async () => {
    setMengirim(true);
    setGalat(null);
    try {
      const pesan = await onHapus();
      if (pesan) setGalat(pesan);
    } finally {
      setMengirim(false);
    }
  };

  return (
    <FormDialog
      judul="Hapus FAQ ini?"
      deskripsi="FAQ yang dihapus tidak bisa dikembalikan. Bot berhenti memakainya."
      labelKirim="Hapus"
      mengirim={mengirim}
      galat={galat}
      onClose={onClose}
      onSubmit={hapus}
      maxWidth={460}
    >
      {() => (
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 600, overflowWrap: 'anywhere' }}>
          {faq.pertanyaan}
        </p>
      )}
    </FormDialog>
  );
}
