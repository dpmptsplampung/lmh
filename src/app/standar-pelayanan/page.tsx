import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { FileText } from 'lucide-react';

export const dynamic = 'force-dynamic';

// CMP-09: halaman publik Standar Pelayanan & Maklumat Pelayanan per layanan (UU 25/2009).

type Standar = {
  layanan_id: string;
  persyaratan: string | null;
  prosedur: string | null;
  jangka_waktu: string | null;
  biaya: string | null;
  produk_layanan: string | null;
  penanganan_pengaduan: string | null;
  maklumat: string | null;
};

type Layanan = { id: string; nama: string };

function Seksi({ judul, isi }: { judul: string; isi: string | null }) {
  if (!isi) return null;
  return (
    <section style={{ marginBottom: 'var(--space-3)' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 'var(--text-base)' }}>{judul}</h3>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--color-neutral-600)' }}>{isi}</p>
    </section>
  );
}

export default async function StandarPelayananPage() {
  const supabase = await createClient();
  const { data: layanan } = await supabase
    .from('layanan')
    .select('id, nama')
    .eq('aktif', true)
    .order('nama');
  const { data: standar } = await supabase
    .from('standar_pelayanan')
    .select('layanan_id, persyaratan, prosedur, jangka_waktu, biaya, produk_layanan, penanganan_pengaduan, maklumat')
    .eq('aktif', true);

  const standarMap = new Map<string, Standar>(
    ((standar ?? []) as Standar[]).map((s) => [s.layanan_id, s]),
  );
  const layananList = (layanan ?? []) as Layanan[];

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <FileText size={28} style={{ color: 'var(--color-primary-500)' }} />
        <div>
          <h1 style={{ margin: 0 }}>Standar Pelayanan &amp; Maklumat Pelayanan</h1>
          <p style={{ margin: 0, color: 'var(--color-neutral-500)' }}>
            Sesuai UU No. 25 Tahun 2009 tentang Pelayanan Publik — persyaratan, prosedur, jangka waktu, biaya, produk layanan, dan penanganan pengaduan.
          </p>
        </div>
      </div>

      {layananList.map((l) => {
        const s = standarMap.get(l.id);
        return (
          <article key={l.id} className="card" style={{ marginBottom: 'var(--space-4)' }}>
            <h2 style={{ marginTop: 0 }}>{l.nama}</h2>
            {s ? (
              <>
                <Seksi judul="Persyaratan" isi={s.persyaratan} />
                <Seksi judul="Prosedur" isi={s.prosedur} />
                <Seksi judul="Jangka Waktu Penyelesaian" isi={s.jangka_waktu} />
                <Seksi judul="Biaya / Tarif" isi={s.biaya} />
                <Seksi judul="Produk Layanan" isi={s.produk_layanan} />
                <Seksi judul="Penanganan Pengaduan" isi={s.penanganan_pengaduan} />
                {s.maklumat && (
                  <section style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--color-neutral-50, #f9fafb)', borderRadius: 8 }}>
                    <h3 style={{ margin: '0 0 4px' }}>Maklumat Pelayanan</h3>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{s.maklumat}</p>
                  </section>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--color-neutral-500)', margin: 0 }}>
                Standar pelayanan untuk layanan ini sedang disusun.
              </p>
            )}
          </article>
        );
      })}

      <p style={{ textAlign: 'center', color: 'var(--color-neutral-500)' }}>
        Ada pengaduan terkait layanan? <Link href="/pengaduan">Sampaikan lewat Kanal Pengaduan</Link>.
      </p>
    </main>
  );
}
