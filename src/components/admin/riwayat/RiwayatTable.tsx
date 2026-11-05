import Tabel from '@/components/ui/Tabel';
import Lencana from '@/components/ui/Lencana';
import { formatTanggalWaktu } from '@/lib/utils';
import tampilan from './RiwayatTable.dasbor.module.css';
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

export default function RiwayatTable({ items }: { items: RiwayatItem[] }) {
  return <Tabel caption="Daftar riwayat perubahan (WIB)" baris={items} kunciBaris="id" kolom={[
    { kunci: 'waktu', judul: 'Waktu', render: (r) => formatTanggalWaktu(r.created_at) },
    { kunci: 'pelaku', judul: 'Pelaku', judulBaris: true,
      render: (r) => r.pelaku?.nama ?? (r.actor_role ? `Sistem (${r.actor_role})` : 'Sistem') },
    { kunci: 'entitas', judul: 'Jenis' },
    { kunci: 'aksi', judul: 'Aksi', render: (r) => <Lencana>{r.aksi}</Lencana> },
    { kunci: 'perubahan', judul: 'Perubahan', render: (r) => {
      const baris = ringkasPerubahan(r.nilai_lama, r.nilai_baru);
      return baris.length === 0 ? '—' : <ul className={tampilan.daftar}>{baris.map((b) => <li key={b}>{b}</li>)}</ul>;
    } },
  ]} />;
}
