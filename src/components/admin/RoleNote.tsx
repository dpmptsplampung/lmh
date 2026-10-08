// Keterangan singkat per role di atas halaman admin (RBAC Tahap 1).
export default function RoleNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="note"
      style={{
        fontSize: 'var(--text-sm)',
        color: 'var(--text-secondary)',
        background: 'var(--color-primary-50, #eff6ff)',
        border: '1px solid var(--color-primary-100, #dbeafe)',
        borderRadius: 'var(--radius-md, 8px)',
        padding: 'var(--space-2) var(--space-3)',
        margin: '0 0 var(--space-4)',
      }}
    >
      {children}
    </p>
  );
}
