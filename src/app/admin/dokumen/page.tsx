'use client';

// WP-27 / BOT-01..10: Admin page for managing RAG regulatory documents.
// Staff paste plain text; system chunks and embeds for bot retrieval (BOT-07).
// Embedding is triggered via /api/admin/dokumen/embed route.

import { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, Trash2, RefreshCw, BookOpen, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

interface DokumenRow {
  id: string;
  judul: string;
  nomor: string | null;
  jenis: string;
  status: 'berlaku' | 'dicabut';
  sumber_url: string | null;
  created_at: string;
  layanan?: { nama: string } | null;
  _potongan_count?: number;
}

interface LayananOption { id: string; nama: string }

export default function AdminDokumenPage() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<DokumenRow[]>([]);
  const [layananList, setLayananList] = useState<LayananOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [embedding, setEmbedding] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    judul: '', nomor: '', jenis: 'peraturan', status: 'berlaku',
    sumber_url: '', teks_utama: '', layanan_id: '',
  });

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('dokumen_peraturan')
        .select('*, layanan:layanan_id(nama)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setDocs((data ?? []) as DokumenRow[]);
      const { data: ld } = await supabase.from('layanan').select('id, nama').order('nama');
      setLayananList(ld ?? []);
    } catch {
      toast('Gagal memuat dokumen', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const handleSimpan = async () => {
    if (!form.judul.trim() || !form.teks_utama.trim()) {
      toast('Judul dan teks wajib diisi', 'error');
      return;
    }
    try {
      const supabase = createClient();
      const { error } = await supabase.from('dokumen_peraturan').insert({
        judul: form.judul.trim(),
        nomor: form.nomor.trim() || null,
        jenis: form.jenis,
        status: form.status,
        sumber_url: form.sumber_url.trim() || null,
        teks_utama: form.teks_utama.trim(),
        layanan_id: form.layanan_id || null,
      });
      if (error) throw error;
      toast('Dokumen disimpan', 'success');
      setShowForm(false);
      setForm({ judul: '', nomor: '', jenis: 'peraturan', status: 'berlaku', sumber_url: '', teks_utama: '', layanan_id: '' });
      await loadDocs();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Gagal menyimpan', 'error');
    }
  };

  const handleEmbed = async (docId: string) => {
    setEmbedding(docId);
    try {
      const res = await fetch('/api/admin/dokumen/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dokumen_id: docId }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      toast(`Embedding selesai: ${json.potongan} potongan`, 'success');
      await loadDocs();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Gagal embedding', 'error');
    } finally {
      setEmbedding(null);
    }
  };

  const handleCabut = async (docId: string) => {
    if (!confirm('Tandai dokumen ini sebagai dicabut? Bot tidak akan mengutipnya lagi.')) return;
    const supabase = createClient();
    await supabase.from('dokumen_peraturan').update({ status: 'dicabut' }).eq('id', docId);
    toast('Dokumen ditandai dicabut', 'success');
    await loadDocs();
  };

  const jenisLabel: Record<string, string> = {
    peraturan: 'Peraturan',
    sop: 'SOP',
    maklumat: 'Maklumat',
    standar_pelayanan: 'Standar Pelayanan',
  };

  const berlakuCount = docs.filter(d => d.status === 'berlaku').length;
  const dicabutCount = docs.filter(d => d.status === 'dicabut').length;

  return (
    <>
      <PageHeader title='Dokumen Peraturan' description='Kelola dokumen sumber untuk bot RAG (BOT-01..10)'>
        <button className='btn btn--ghost btn--sm' onClick={loadDocs}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button className='btn btn--primary btn--sm' onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> {showForm ? 'Tutup' : 'Tambah Dokumen'}
        </button>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {/* Stats */}
        <div className='grid-stats' style={{ marginBottom: 'var(--space-8)' }}>
          <div className='stat-card'>
            <div className='stat-card__icon' style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
              <CheckCircle2 size={22} />
            </div>
            <span className='stat-card__value'>{berlakuCount}</span>
            <span className='stat-card__label'>Dokumen Berlaku</span>
          </div>
          <div className='stat-card'>
            <div className='stat-card__icon' style={{ background: 'var(--color-neutral-100)', color: 'var(--color-neutral-500)' }}>
              <AlertCircle size={22} />
            </div>
            <span className='stat-card__value'>{dicabutCount}</span>
            <span className='stat-card__label'>Dicabut</span>
          </div>
          <div className='stat-card'>
            <div className='stat-card__icon' style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
              <BookOpen size={22} />
            </div>
            <span className='stat-card__value'>{docs.length}</span>
            <span className='stat-card__label'>Total Dokumen</span>
          </div>
        </div>

        {/* Add form */}
        {showForm && (
          <div className='table-wrapper' style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--space-4)' }}>Tambah Dokumen Baru</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <div className='form-group'>
                <label className='form-label form-label--required'>Judul</label>
                <input className='form-input' value={form.judul} onChange={e => setForm(f => ({ ...f, judul: e.target.value }))} placeholder='Judul dokumen' />
              </div>
              <div className='form-group'>
                <label className='form-label'>Nomor</label>
                <input className='form-input' value={form.nomor} onChange={e => setForm(f => ({ ...f, nomor: e.target.value }))} placeholder='Nomor peraturan' />
              </div>
              <div className='form-group'>
                <label className='form-label'>Jenis</label>
                <select className='form-input' value={form.jenis} onChange={e => setForm(f => ({ ...f, jenis: e.target.value }))}>
                  <option value='peraturan'>Peraturan</option>
                  <option value='sop'>SOP</option>
                  <option value='maklumat'>Maklumat</option>
                  <option value='standar_pelayanan'>Standar Pelayanan</option>
                </select>
              </div>
              <div className='form-group'>
                <label className='form-label'>Status</label>
                <select className='form-input' value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value='berlaku'>Berlaku</option>
                  <option value='dicabut'>Dicabut</option>
                </select>
              </div>
              <div className='form-group'>
                <label className='form-label'>Layanan Terkait</label>
                <select className='form-input' value={form.layanan_id} onChange={e => setForm(f => ({ ...f, layanan_id: e.target.value }))}>
                  <option value=''>— Umum —</option>
                  {layananList.map(l => (
                    <option key={l.id} value={l.id}>{l.nama}</option>
                  ))}
                </select>
              </div>
              <div className='form-group'>
                <label className='form-label'>URL Sumber</label>
                <input className='form-input' type='url' value={form.sumber_url} onChange={e => setForm(f => ({ ...f, sumber_url: e.target.value }))} placeholder='https://...' />
              </div>
            </div>
            <div className='form-group' style={{ marginTop: 'var(--space-4)' }}>
              <label className='form-label form-label--required'>Teks Utama</label>
              <textarea
                className='form-input'
                rows={10}
                value={form.teks_utama}
                onChange={e => setForm(f => ({ ...f, teks_utama: e.target.value }))}
                placeholder='Paste teks lengkap peraturan / SOP di sini. Sistem akan otomatis memotong dan mengembedding untuk bot RAG.'
                style={{ fontFamily: 'monospace', fontSize: 'var(--text-sm)' }}
              />
              <span className='form-hint'>Teks ini akan di-chunk dan di-embed ke vektor database (BOT-07). Gunakan format plain text.</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
              <button className='btn btn--ghost' onClick={() => setShowForm(false)}>Batal</button>
              <button className='btn btn--primary' onClick={handleSimpan}>
                <FileText size={16} /> Simpan Dokumen
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 'var(--space-8)' }}>Memuat data...</p>
        ) : (
          <div className='table-wrapper'>
            <table className='table'>
              <thead>
                <tr>
                  <th>Dokumen</th>
                  <th>Jenis</th>
                  <th>Layanan</th>
                  <th>Status</th>
                  <th>Dibuat</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {docs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-8)' }}>
                      Belum ada dokumen. Klik &quot;Tambah Dokumen&quot; untuk menambahkan.
                    </td>
                  </tr>
                ) : docs.map(doc => (
                  <tr key={doc.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                        <FileText size={18} style={{ color: 'var(--color-primary-500)', flexShrink: 0, marginTop: 2 }} />
                        <div>
                          <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{doc.judul}</span>
                          {doc.nomor && (
                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>{doc.nomor}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className='badge badge--draft'>{jenisLabel[doc.jenis] ?? doc.jenis}</span>
                    </td>
                    <td style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                      {doc.layanan?.nama ?? <span style={{ color: 'var(--text-tertiary)' }}>Umum</span>}
                    </td>
                    <td>
                      {doc.status === 'berlaku' ? (
                        <span className='badge badge--aktif'>
                          <CheckCircle2 size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                          Berlaku
                        </span>
                      ) : (
                        <span className='badge badge--nonaktif'>
                          <AlertCircle size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                          Dicabut
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      <Clock size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                      {new Date(doc.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                          className='btn btn--ghost btn--sm'
                          title='Embed ke vektor DB'
                          disabled={embedding === doc.id}
                          onClick={() => handleEmbed(doc.id)}
                        >
                          {embedding === doc.id
                            ? <RefreshCw size={14} className='animate-spin' />
                            : <BookOpen size={14} />}
                        </button>
                        {doc.status === 'berlaku' && (
                          <button
                            className='btn btn--ghost btn--sm'
                            title='Cabut dokumen'
                            style={{ color: 'var(--color-warning-600)' }}
                            onClick={() => handleCabut(doc.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
