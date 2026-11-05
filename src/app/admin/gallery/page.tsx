'use client';

import Field from '@/components/ui/Field';

import Tombol from '@/components/ui/Tombol';
import Tabel from '@/components/ui/Tabel';
import Dialog from '@/components/ui/Dialog';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Lencana from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Galat from '@/components/ui/Galat';

import tampilan from './page.dasbor.module.css';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { FileText, Eye, EyeOff, Trash2, RefreshCw, Save, Plus, Edit2, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';
import { useToast } from '@/components/Toast';

interface GalleryDoc {
  id: string;
  judul: string;
  kategori: string | null;
  urutan_tampil: number;
  file_path: string;
  jumlah_halaman: number;
  status: 'aktif' | 'nonaktif';
  deskripsi: string | null;
  nilai_investasi: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

interface GalleryForm {
  judul: string;
  kategori: string;
  urutan_tampil: number;
  jumlah_halaman: number;
  deskripsi: string;
  nilai_investasi: string;
  image_url: string;
  file_path: string;
  status: 'aktif' | 'nonaktif';
}

const emptyForm: GalleryForm = {
  judul: '',
  kategori: '',
  urutan_tampil: 1,
  jumlah_halaman: 0,
  deskripsi: '',
  nilai_investasi: '',
  image_url: '',
  file_path: '',
  status: 'aktif',
};

export default function AdminGalleryPage() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<GalleryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Form modal state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GalleryForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  // Detail modal
  const [viewingDoc, setViewingDoc] = useState<GalleryDoc | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingSignedUrl, setLoadingSignedUrl] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('investment_documents')
        .select('*')
        .order('urutan_tampil', { ascending: true });
      if (error) throw error;
      setDocs((data || []) as GalleryDoc[]);
      setLoadError('');
    } catch {
      setLoadError('Gagal memuat data galeri. Silakan coba lagi.');
      toast('Gagal memuat data galeri. Silakan coba lagi.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'aktif' ? 'nonaktif' : 'aktif';
    try {
      const supabase = createClient();
      // .select('id') + mutasiWajibBaris: RLS yang menolak UPDATE = 0 baris tanpa error (sukses palsu).
      await mutasiWajibBaris(
        supabase
          .from('investment_documents')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select('id'),
      );
      setDocs(prev => prev.map(d => d.id === id ? { ...d, status: newStatus as 'aktif' | 'nonaktif' } : d));
      toast(`Status berhasil diubah menjadi ${newStatus}.`, 'success');
    } catch (e) {
      toast(`Gagal mengubah status dokumen. ${pesanMutasi(e)}`, 'error');
      if (perluMuatUlang(e)) await loadData();
    }
  };

  const handleDelete = async (id: string, judul: string) => {
    if (!confirm(`Hapus dokumen "${judul}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      const res = await fetch(`/api/investment-docs/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : 'delete failed');
      }
      setDocs(prev => prev.filter(d => d.id !== id));
      toast('Dokumen berhasil dihapus.', 'success');
    } catch {
      toast('Gagal menghapus dokumen.', 'error');
    }
  };

  const handlePdfSelect = (file: File) => {
    if (file.type !== 'application/pdf') {
      toast('File harus berupa PDF.', 'warning');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast('Ukuran file maksimal 50MB.', 'warning');
      return;
    }
    setPdfFile(file);
    setForm(prev => ({ ...prev, file_path: file.name }));
  };

  // Tukar urutan_tampil dua dokumen = DUA UPDATE terpisah (klien tak punya transaksi). Bila langkah 2
  // gagal setelah langkah 1 berhasil, langkah 1 dibatalkan (best-effort) supaya tidak ada dua dokumen
  // berurutan sama. Daftar dimuat ulang dari server bila ada langkah yang sempat berhasil atau ditolak,
  // agar layar tidak basi (gangguan jaringan murni di langkah 1 tidak mengubah apa pun -> cukup toast).
  const tukarUrutan = async (doc: GalleryDoc, tetangga: GalleryDoc) => {
    const urutanDoc = doc.urutan_tampil;
    const urutanTetangga = tetangga.urutan_tampil;
    let langkah1Berhasil = false;
    let pembatalanGagal = false;
    try {
      const supabase = createClient();
      const setUrutan = (id: string, urutan: number) =>
        mutasiWajibBaris(
          supabase
            .from('investment_documents')
            .update({ urutan_tampil: urutan, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select('id'),
        );

      await setUrutan(tetangga.id, urutanDoc); // langkah 1
      langkah1Berhasil = true;
      try {
        await setUrutan(doc.id, urutanTetangga); // langkah 2
      } catch (e2) {
        try {
          await setUrutan(tetangga.id, urutanTetangga); // batalkan langkah 1
        } catch {
          pembatalanGagal = true;
        }
        throw e2;
      }

      setDocs(prev => prev.map(d => {
        if (d.id === tetangga.id) return { ...d, urutan_tampil: urutanDoc };
        if (d.id === doc.id) return { ...d, urutan_tampil: urutanTetangga };
        return d;
      }));
    } catch (e) {
      toast(
        pembatalanGagal
          ? `Gagal mengubah urutan dokumen dan pembatalan juga gagal, urutan mungkin tidak konsisten — periksa daftar. ${pesanMutasi(e)}`
          : `Gagal mengubah urutan dokumen. ${pesanMutasi(e)}`,
        'error',
      );
      if (langkah1Berhasil || perluMuatUlang(e)) await loadData();
    }
  };

  const handleMoveUp = async (doc: GalleryDoc) => {
    const sorted = [...docs].sort((a, b) => a.urutan_tampil - b.urutan_tampil);
    const index = sorted.findIndex(d => d.id === doc.id);
    if (index <= 0) return;

    await tukarUrutan(doc, sorted[index - 1]);
  };

  const handleMoveDown = async (doc: GalleryDoc) => {
    const sorted = [...docs].sort((a, b) => a.urutan_tampil - b.urutan_tampil);
    const index = sorted.findIndex(d => d.id === doc.id);
    if (index < 0 || index >= sorted.length - 1) return;

    await tukarUrutan(doc, sorted[index + 1]);
  };

  const handleViewDoc = async (doc: GalleryDoc) => {
    setViewingDoc(doc);
    setSignedUrl(null);
    setLoadingSignedUrl(true);
    try {
      const res = await fetch('/api/investment-docs/signed-url?file_path=' + encodeURIComponent(doc.file_path));
      if (!res.ok) throw new Error('Failed to fetch signed URL');
      const data = await res.json();
      setSignedUrl(data.signedUrl);
    } catch {
      toast('Gagal memuat pratinjau PDF.', 'error');
    } finally {
      setLoadingSignedUrl(false);
    }
  };

  const handleOpenForm = (doc?: GalleryDoc) => {
    if (doc) {
      setEditingId(doc.id);
      setForm({
        judul: doc.judul,
        kategori: doc.kategori ?? '',
        urutan_tampil: doc.urutan_tampil,
        jumlah_halaman: doc.jumlah_halaman,
        deskripsi: doc.deskripsi ?? '',
        nilai_investasi: doc.nilai_investasi ?? '',
        image_url: doc.image_url ?? '',
        file_path: doc.file_path,
        status: doc.status,
      });
      setPdfFile(null);
    } else {
      setEditingId(null);
      setForm({ ...emptyForm, urutan_tampil: docs.length + 1 });
      setPdfFile(null);
    }
    setFormError('');
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.judul.trim()) {
      setFormError('Judul wajib diisi.');
      return;
    }
    if (!editingId && !pdfFile) {
      setFormError('File PDF wajib diunggah.');
      return;
    }
    setSaving(true);
    setUploadingFile(true);
    setFormError('');
    try {
      if (!editingId) {
        // Create via PDF pipeline API (raw PDF + PNG pages + DB row)
        const body = new FormData();
        body.append('pdf', pdfFile as File);
        body.append('judul', form.judul.trim());
        if (form.kategori.trim()) body.append('kategori', form.kategori.trim());
        if (form.deskripsi.trim()) body.append('deskripsi', form.deskripsi.trim());
        if (form.nilai_investasi.trim()) body.append('nilai_investasi', form.nilai_investasi.trim());
        if (form.image_url.trim()) body.append('image_url', form.image_url.trim());
        body.append('urutan_tampil', String(form.urutan_tampil));

        const res = await fetch('/api/investment-docs/upload', {
          method: 'POST',
          body,
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(errBody.error || 'Gagal mengunggah dokumen via pipeline.');
        }
      } else {
        // Metadata-only update (no PDF re-upload on edit for this gate)
        const supabase = createClient();
        const payload = {
          judul: form.judul.trim(),
          kategori: form.kategori.trim() || null,
          urutan_tampil: form.urutan_tampil,
          deskripsi: form.deskripsi.trim() || null,
          nilai_investasi: form.nilai_investasi.trim() || null,
          image_url: form.image_url.trim() || null,
          status: form.status,
          updated_at: new Date().toISOString(),
        };
        await mutasiWajibBaris(
          supabase
            .from('investment_documents')
            .update(payload)
            .eq('id', editingId)
            .select('id'),
        );
      }
      setShowForm(false);
      setPdfFile(null);
      toast('Dokumen berhasil disimpan.', 'success');
      loadData();
    } catch (err) {
      // MutasiError.message = pesan Indonesia siap tampil; jalur upload (fetch) melempar Error biasa.
      const message = err instanceof Error ? err.message : 'Gagal menyimpan dokumen.';
      setFormError(message);
      toast(message, 'error');
      // Modal sengaja dibiarkan terbuka (isian tidak hilang); daftar di belakangnya dimuat ulang bila basi.
      if (perluMuatUlang(err)) void loadData();
    } finally {
      setSaving(false);
      setUploadingFile(false);
    }
  };

  const aktifCount = docs.filter(d => d.status === 'aktif').length;
  const nonaktifCount = docs.filter(d => d.status === 'nonaktif').length;

  return (
    <>
      <PageHeader
        title="Investment Gallery"
        description="Kelola dokumen galeri investasi — upload metadata, atur urutan tampil">
        <div className={tampilan.baris1}>
          <Tombol varian="hantu" ukuran="kecil" type="button" onClick={loadData}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </Tombol>
          <Tombol varian="utama" ukuran="kecil" type="button" onClick={() => handleOpenForm()}>
            <Plus size={16} />
            Tambah Dokumen
          </Tombol>
        </div>
      </PageHeader>

      <div className={tampilan.area2}>
        {!loadError && <div className={tampilan.statistik}>
          <KartuStatistik label="Dokumen Aktif" nilai={aktifCount} ikon={FileText} memuat={loading} />
          <KartuStatistik label="Nonaktif" nilai={nonaktifCount} ikon={EyeOff} memuat={loading} />
        </div>}

        {/* Table */}
        <Kartu judul="Daftar galeri" padding="tanpa">
        {loading ? <Skeleton bentuk="baris" jumlah={5} label="Memuat galeri" /> : loadError ? (
          <Galat pesan={loadError} onRetry={() => { void loadData(); }} />
        ) : (
          <Tabel caption="Daftar dokumen galeri" baris={docs} kunciBaris="id" kosong={<StatusKosong ikon={FileText} judul="Belum ada dokumen. Klik &quot;Tambah Dokumen&quot; untuk menambahkan." />} kolom={[
{ kunci: 'kolom0', judul: "Atur urutan", render: (doc, idx) => (<><div className={tampilan.baris9}>
                        <Tombol
                          varian="hantu" ukuran="kecil" className={["", tampilan.area10].filter(Boolean).join('')}
                          title="Pindah ke atas"
                          disabled={idx === 0}
                          onClick={() => handleMoveUp(doc)}>
                          <ChevronUp size={14} />
                        </Tombol>
                        <Tombol
                          varian="hantu" ukuran="kecil" className={["", tampilan.area10].filter(Boolean).join('')}
                          title="Pindah ke bawah"
                          disabled={idx === docs.length - 1}
                          onClick={() => handleMoveDown(doc)}>
                          <ChevronDown size={14} />
                        </Tombol>
                      </div></>) },
{ kunci: 'kolom1', judul: "Dokumen", judulBaris: true, render: (doc) => (<><div className={tampilan.baris11}>
                        {doc.image_url ? (
                          <Image
                            src={doc.image_url}
                            alt={doc.judul}
                            width={40}
                            height={48}
                            className={tampilan.area12}
                            unoptimized
                          />
                        ) : (
                          <div className={tampilan.baris13}>
                            <FileText size={20} className={tampilan.area14}  />
                          </div>
                        )}
                        <div>
                          <span className={tampilan.teks15} >{doc.judul}</span>
                          {doc.deskripsi && (
                            <p className={tampilan.teks16} >{doc.deskripsi}</p>
                          )}
                        </div>
                      </div></>) },
{ kunci: 'kolom2', judul: "Kategori", render: (doc) => (<>{doc.kategori && <Lencana nada="netral">{doc.kategori}</Lencana>}</>) },
{ kunci: 'kolom3', judul: "Nilai Investasi", render: (doc) => (<div className={tampilan.sel17}>{doc.nilai_investasi ?? '—'}</div>) },
{ kunci: 'kolom4', judul: "Halaman", angka: true, render: (doc) => (<div className={tampilan.sel18}>{doc.jumlah_halaman}hal</div>) },
{ kunci: 'kolom5', judul: "Urutan", angka: true, render: (doc) => (<div className={tampilan.sel19}>{doc.urutan_tampil}</div>) },
{ kunci: 'kolom6', judul: "Status", render: (doc) => (<><Lencana nada={doc.status === 'aktif' ? 'sukses' : 'netral'}>
                        {doc.status === 'aktif' ? '✓ Aktif' : 'Nonaktif'}
                      </Lencana></>) },
{ kunci: 'kolom7', judul: "Aksi", render: (doc) => (<><div className={tampilan.baris20}>
                        <Tombol varian="hantu" ukuran="kecil" type="button" title="Detail" onClick={() => handleViewDoc(doc)}>
                          <Eye size={14} />
                        </Tombol>
                        <Tombol varian="hantu" ukuran="kecil" type="button" title="Edit" onClick={() => handleOpenForm(doc)}>
                          <Edit2 size={14} />
                        </Tombol>
                        <Tombol
                          varian="hantu" ukuran="kecil" type="button"
                          title={doc.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                          onClick={() => handleToggleStatus(doc.id, doc.status)}>
                          {doc.status === 'aktif' ? <EyeOff size={14} /> : <Eye size={14} />}
                        </Tombol>
                        <Tombol
                          varian="hantu" ukuran="kecil" className={["", tampilan.area21].filter(Boolean).join('')}
                          title="Hapus"

                          onClick={() => handleDelete(doc.id, doc.judul)}>
                          <Trash2 size={14} />
                        </Tombol>
                      </div></>) }
]} />
        )}
        </Kartu>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <Dialog terbuka judul={editingId ? 'Edit Dokumen' : 'Tambah Dokumen Baru'} onTutup={() => setShowForm(false)}>
            <form onSubmit={handleSave} className={tampilan.baris26}>
              <Field label="Judul Proyek / Dokumen" wajib>
                <input id="gallery-judul" className="form-input" value={form.judul} onChange={e => setForm(f => ({ ...f, judul: e.target.value }))} required />
              </Field>
              <div className={tampilan.kisi27}>
                <Field label="Kategori">
                  <input id="gallery-kategori" className="form-input" placeholder="e.g. Manufaktur & Industri" value={form.kategori} onChange={e => setForm(f => ({ ...f, kategori: e.target.value }))} />
                </Field>
                <Field label="Nilai Investasi">
                  <input id="gallery-nilai" className="form-input" placeholder="e.g. Rp 2.4 Triliun" value={form.nilai_investasi} onChange={e => setForm(f => ({ ...f, nilai_investasi: e.target.value }))} />
                </Field>
              </div>
              <Field label="Deskripsi Singkat">
                <textarea id="gallery-deskripsi" className="form-input" rows={3} value={form.deskripsi} onChange={e => setForm(f => ({ ...f, deskripsi: e.target.value }))} />
              </Field>
              <Field label="URL Gambar Thumbnail">
                <input id="gallery-thumb" className="form-input" type="url" placeholder="https://..." value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} />
              </Field>
              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="gallery-pdf">File PDF</label>
                <input
                  id="gallery-pdf"
                  type="file"
                  accept="application/pdf"
                  className="form-input"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handlePdfSelect(file);
                  }}
                  disabled={uploadingFile || !!editingId}
                />
                <span className="form-hint">Maksimal 50MB, format PDF — diproses via pipeline (PNG per halaman)</span>
                {uploadingFile && (
                  <div className={tampilan.baris28}>
                    <Loader2 size={16} className="animate-spin" />
                    Memproses PDF via pipeline...
                  </div>
                )}
                {pdfFile && !uploadingFile && (
                  <div className={tampilan.baris29}>
                    <FileText size={16} />
                    {pdfFile.name}
                  </div>
                )}
                {editingId && form.file_path && (
                  <span className="form-hint">File saat ini: {form.file_path.split('/').pop()} (ganti PDF belum didukung di form edit)</span>
                )}
              </div>
              <div className={tampilan.kisi30}>
                <Field label="Jumlah Halaman">
                  <input id="gallery-halaman" className="form-input" type="number" min={0} value={form.jumlah_halaman} onChange={e => setForm(f => ({ ...f, jumlah_halaman: Number(e.target.value) }))} />
                </Field>
                <Field label="Urutan Tampil">
                  <input id="gallery-urutan" className="form-input" type="number" min={1} value={form.urutan_tampil} onChange={e => setForm(f => ({ ...f, urutan_tampil: Number(e.target.value) }))} />
                </Field>
                <Field label="Status">
                  <select id="gallery-status" className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as 'aktif' | 'nonaktif' }))}>
                    <option value="aktif">Aktif</option>
                    <option value="nonaktif">Nonaktif</option>
                  </select>
                </Field>
              </div>
              {formError && <p className="form-error">{formError}</p>}
              <div className={tampilan.baris31}>
                <Tombol type="button" varian="hantu" onClick={() => setShowForm(false)}>Batal</Tombol>
                <Tombol type="submit" varian="utama" disabled={saving}>
                  <Save size={16} />
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </Tombol>
              </div>
            </form>
        </Dialog>
      )}

      {/* Detail View Modal */}
      {viewingDoc && (
        <Dialog terbuka judul="Detail Dokumen" onTutup={() => { setViewingDoc(null); setSignedUrl(null); }}>

            <div className={tampilan.area40}>
              {viewingDoc.jumlah_halaman} halaman · Urutan #{viewingDoc.urutan_tampil} · {viewingDoc.status}
            </div>
            <div className="form-group">
              <span className="form-label">Pratinjau PDF</span>
              {loadingSignedUrl ? (
                <Skeleton bentuk="kartu" label="Memuat pratinjau PDF" />
              ) : signedUrl ? (
                <>
                  <div role="presentation" onContextMenu={(e) => e.preventDefault()}>
                    <iframe
                      src={signedUrl}
                      className={["pdf-preview-frame", tampilan.area43].filter(Boolean).join(' ')}

                      title="PDF Preview"
                    />
                  </div>
                </>
              ) : (
                <p className={tampilan.teks44} >PDF tidak tersedia untuk pratinjau.</p>
              )}
            </div>
        </Dialog>
      )}
    </>
  );
}
