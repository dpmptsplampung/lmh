'use client';

// Pemberitahuan untuk pemegang lama bahwa pendataannya diambil alih Koordinator (Fase 3, spec §6.2; migrasi
// 202610290001). Sumber: tabel ambil_alih_pendataan (RLS: pemegang lama/baru/admin) baris milik saya yang belum
// dilihat. "Mengerti" = RPC ambil_alih_tandai_dilihat. Push web juga diantrekan DB (queue_notifikasi).
// Sebelum migrasi diterapkan tabel belum ada: komponen tidak menampilkan apa pun.
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { mutasiWajibBaris } from '@/lib/supabase/mutate';
import { useToast } from '@/components/Toast';

interface Baris {
  id: string;
  peran_tahap: string;
  alasan: string;
  created_at: string;
  tiket: { nomor_display: string } | { nomor_display: string }[] | null;
  baru: { nama: string } | { nama: string }[] | null;
}

const satu = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default function PemberitahuanAmbilAlih({ petugasId }: { petugasId: string | null | undefined }) {
  const { toast } = useToast();
  const [baris, setBaris] = useState<Baris[]>([]);

  const muat = useCallback(async () => {
    if (!petugasId) return;
    try {
      const { data, error } = await createClient()
        .from('ambil_alih_pendataan')
        .select('id, peran_tahap, alasan, created_at, tiket:tiket_id(nomor_display), baru:pemegang_baru(nama)')
        .eq('pemegang_lama', petugasId)
        .is('dilihat_at', null)
        .order('created_at', { ascending: false })
        .limit(5);
      setBaris(error ? [] : ((data ?? []) as unknown as Baris[]));
    } catch {
      setBaris([]);
    }
  }, [petugasId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    muat();
  }, [muat]);

  const tandai = async (id: string) => {
    try {
      await mutasiWajibBaris(createClient().rpc('ambil_alih_tandai_dilihat', { p_id: id }));
      setBaris((b) => b.filter((x) => x.id !== id));
    } catch {
      toast('Gagal menandai pemberitahuan', 'error');
    }
  };

  if (baris.length === 0) return null;
  return (
    <section aria-label="Pemberitahuan ambil alih" style={{ marginBottom: 'var(--space-4)', display: 'grid', gap: 'var(--space-2)' }}>
      {baris.map((b) => {
        const nomor = satu(b.tiket)?.nomor_display;
        const oleh = satu(b.baru)?.nama ?? 'Koordinator';
        return (
          <div key={b.id} role="status" className="alert alert--warning" style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap',
            padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md, 8px)',
            background: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-200, #fde68a)',
          }}>
            <span style={{ fontSize: 'var(--text-sm)' }}>
              {b.peran_tahap === 'fo'
                ? <>Penanganan Front Office yang Anda pegang diambil alih oleh <strong>{oleh}</strong>.</>
                : <>Pendataan tiket <strong>{nomor ?? '-'}</strong> diambil alih oleh <strong>{oleh}</strong>. Anda masih dapat menyunting drafnya; penyelesaian oleh Koordinator.</>}
              {' '}Alasan: {b.alasan}
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => tandai(b.id)}>Mengerti</button>
          </div>
        );
      })}
    </section>
  );
}
