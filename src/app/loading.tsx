export default function Loading() {
  return (
    <div
      style={{
        minHeight: '40vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-8)',
      }}
      aria-busy="true"
      aria-live="polite"
    >
      <div
        className="skeleton"
        style={{ width: '100%', maxWidth: '480px', height: '120px' }}
      />
    </div>
  );
}
