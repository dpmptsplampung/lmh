'use client';

// Cangkang dialog formulir aksesibel untuk aksi antrean (alihkan, kembalikan ke FO, selesai eskalasi).
// role=dialog + aria-modal + judul/deskripsi terhubung, Escape menutup (kecuali saat mengirim), focus trap,
// fokus kembali ke pemicu (useDialogFokus), galat tampil di role=alert.
import { useId, useRef, type FormEvent, type ReactNode } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useDialogFokus } from './useDialogFokus';

interface Props {
  judul: ReactNode;
  deskripsi?: ReactNode;
  /** Teks tombol kirim; saat `mengirim` tampil "Memproses…". */
  labelKirim: string;
  mengirim: boolean;
  /** Tombol kirim dinonaktifkan tanpa mengirim (mis. data pilihan belum siap). */
  kirimNonaktif?: boolean;
  /** Galat tingkat formulir (hasil RPC); id dikirim ke children lewat render-prop agar bisa dirujuk aria-describedby. */
  galat: string | null;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  maxWidth?: number;
  children: (ids: { galat: string }) => ReactNode;
}

export default function FormDialog({
  judul, deskripsi, labelKirim, mengirim, kirimNonaktif, galat, onClose, onSubmit, maxWidth = 520, children,
}: Props) {
  const idDasar = useId();
  const idJudul = `${idDasar}-judul`;
  const idDesk = `${idDasar}-desk`;
  const idGalat = `${idDasar}-galat`;
  const wadah = useRef<HTMLDivElement>(null);

  useDialogFokus(true, wadah, () => {
    if (!mengirim) onClose();
  });

  const kirim = (e: FormEvent) => {
    e.preventDefault();
    if (mengirim) return;
    void onSubmit();
  };

  return (
    <div
      ref={wadah}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={idJudul}
      aria-describedby={deskripsi ? idDesk : undefined}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)', outline: 'none',
      }}
    >
      <form
        onSubmit={kirim}
        noValidate
        style={{
          // Opak: --surface-elevated adalah kaca 62% tanpa blur, sehingga isi halaman di belakang dialog tembus dan sulit dibaca.
          background: '#ffffff', borderRadius: 'var(--radius-2xl, 16px)', width: '100%',
          maxWidth, maxHeight: 'calc(100dvh - 2rem)', display: 'flex', flexDirection: 'column',
          border: '1px solid var(--border-default, #e2e8f0)', overflow: 'hidden',
        }}
      >
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-default, #e2e8f0)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
          <div>
            <h2 id={idJudul} style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              {judul}
            </h2>
            {deskripsi && (
              <p id={idDesk} style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                {deskripsi}
              </p>
            )}
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={mengirim} aria-label="Tutup">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', overflowY: 'auto' }}>
          {children({ galat: idGalat })}
          {galat && (
            <p id={idGalat} role="alert" style={{ color: 'var(--color-danger-600)', fontSize: 'var(--text-sm)', margin: 0 }}>
              {galat}
            </p>
          )}
        </div>

        <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border-default, #e2e8f0)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={mengirim}>
            Batal
          </button>
          <button
            type="submit"
            className="btn btn--primary btn--sm"
            disabled={mengirim || kirimNonaktif}
            aria-busy={mengirim}
          >
            {mengirim ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
            {mengirim ? 'Memproses…' : labelKirim}
          </button>
        </div>
      </form>
    </div>
  );
}
