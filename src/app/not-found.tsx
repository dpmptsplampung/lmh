import Link from 'next/link';

export default function NotFound() {
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
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', fontWeight: 700 }}>
        404
      </p>
      <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800 }}>Halaman Tidak Ditemukan</h1>
      <p style={{ color: 'var(--text-secondary)', maxWidth: '28rem', lineHeight: 1.6 }}>
        Halaman yang Anda cari tidak tersedia atau telah dipindahkan. Silakan kembali ke
        beranda.
      </p>
      <Link href="/" className="btn btn--primary">
        Kembali ke Beranda
      </Link>
    </div>
  );
}
