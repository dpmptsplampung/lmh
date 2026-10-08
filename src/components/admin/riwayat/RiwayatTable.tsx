export interface RiwayatItem {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  aksi: string;
  entitas: string;
  entitas_id: string | null;
  detail: unknown;
  nilai_lama: Record<string, unknown> | null;
  nilai_baru: Record<string, unknown> | null;
  created_at: string;
  pelaku: { nama: string; username: string | null } | null;
}

const MAX = 80;
const fmt = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const t = s ?? 'kosong';
  return t.length > MAX ? `${t.slice(0, MAX)}…` : t;
};

/** Ringkas lama→baru per kolom yang berubah. Nilai rahasia sudah disamarkan server. */
export function ringkasPerubahan(lama: RiwayatItem['nilai_lama'], baru: RiwayatItem['nilai_baru']): string[] {
  const kunci = Array.from(new Set([...Object.keys(lama ?? {}), ...Object.keys(baru ?? {})]));
  return kunci.map((k) => {
    const a = lama && k in lama ? fmt(lama[k]) : null;
    const b = baru && k in baru ? fmt(baru[k]) : null;
    return `${k}: ${a ?? '—'} → ${b ?? '—'}`;
  });
}

const waktu = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });

export default function RiwayatTable({ items }: { items: RiwayatItem[] }) {
  return (
    <table className="table">
      <thead>
        <tr><th>Waktu</th><th>Pelaku</th><th>Jenis</th><th>Aksi</th><th>Perubahan</th></tr>
      </thead>
      <tbody>
        {items.map((r) => {
          const baris = ringkasPerubahan(r.nilai_lama, r.nilai_baru);
          return (
            <tr key={r.id}>
              <td>{waktu(r.created_at)}</td>
              <td>{r.pelaku?.nama ?? (r.actor_role ? `Sistem (${r.actor_role})` : 'Sistem')}</td>
              <td>{r.entitas}</td>
              <td>{r.aksi}</td>
              <td>
                {baris.length === 0
                  ? <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                  : <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>{baris.map((b) => <li key={b}>{b}</li>)}</ul>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
