'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        minHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-8)',
        textAlign: 'center',
        gap: 'var(--space-4)',
      }}
    >
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800 }}>Terjadi Kesalahan</h1>
      <p style={{ color: 'var(--text-secondary)', maxWidth: '28rem', lineHeight: 1.6 }}>
        Maaf, ada masalah saat memuat halaman ini.
        {error?.digest ? ` (kode: ${error.digest})` : ''}
      </p>
      <button type="button" className="btn btn--primary" onClick={() => reset()}>
        Coba Lagi
      </button>
    </div>
  );
}
