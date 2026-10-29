'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lightbulb, Loader2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Pagination from '@/components/Pagination';
import { createClient } from '@/lib/supabase/client';
import { toWIBDateString } from '@/lib/time';

const PAGE_SIZE = 25;

interface Saran {
  id: string;
  isi: string;
  created_at: string;
  unit: string;
  pelapor_nama: string | null;
  layanan: { nama: string } | { nama: string }[] | null;
}

function awalBulan(): string {
  const n = new Date();
  return toWIBDateString(new Date(n.getFullYear(), n.getMonth(), 1));
}

// Saran dari Pesan Perilaku. Hanya admin dan Front Office (RLS tabel saran); petugas layanan tidak membaca saran.
export default function SaranPage() {
  const [dari, setDari] = useState(awalBulan);
  const [sampai, setSampai] = useState(() => toWIBDateString(new Date()));
  const [baris, setBaris] = useState<Saran[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [galat, setGalat] = useState('');

  const muat = useCallback(async () => {
    setLoading(true);
    setGalat('');
    try {
      const supabase = createClient();
      const akhir = toWIBDateString(new Date(new Date(`${sampai}T00:00:00+07:00`).getTime() + 86_400_000));
      const { data, count, error } = await supabase
        .from('saran')
        .select('id, isi, created_at, unit, pelapor_nama, layanan:layanan_id ( nama )', { count: 'exact' })
        .gte('created_at', `${dari}T00:00:00+07:00`)
        .lt('created_at', `${akhir}T00:00:00+07:00`)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      setBaris((data ?? []) as unknown as Saran[]);
      setTotal(count ?? 0);
    } catch (e) {
      console.error('Saran:', e);
      setGalat('Gagal memuat saran.');
    } finally {
      setLoading(false);
    }
  }, [dari, sampai, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void muat();
  }, [muat]);

  return (
    <>
      <PageHeader title="Saran" description="Saran pengunjung dari Pesan Perilaku" />
      <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 'var(--text-xs)', gap: 4 }}>
            Dari
            <input type="date" className="form-input" value={dari} max={sampai} onChange={(e) => { if (e.target.value) { setDari(e.target.value); setPage(0); } }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 'var(--text-xs)', gap: 4 }}>
            Sampai
            <input type="date" className="form-input" value={sampai} min={dari} onChange={(e) => { if (e.target.value) { setSampai(e.target.value); setPage(0); } }} />
          </label>
        </div>

        {galat && <p role="alert" style={{ color: 'var(--color-danger-600, #dc2626)' }}>{galat}</p>}
        {loading ? (
          <p><Loader2 size={20} className="animate-pulse" aria-hidden="true" /> Memuat…</p>
        ) : baris.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>
            <Lightbulb size={16} aria-hidden="true" style={{ verticalAlign: 'middle' }} /> Belum ada saran pada periode ini.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {baris.map((s) => {
              const lay = Array.isArray(s.layanan) ? s.layanan[0]?.nama : s.layanan?.nama;
              return (
                <li key={s.id} style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{s.isi}</p>
                  <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {new Date(s.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })} WIB ·{' '}
                    {s.unit === 'fo' ? 'Front Office' : lay ?? 'Unit tidak diketahui'} · {s.pelapor_nama ?? 'Anonim'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {!loading && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
      </div>
    </>
  );
}
