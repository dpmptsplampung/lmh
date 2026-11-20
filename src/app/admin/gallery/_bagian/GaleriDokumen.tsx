'use client';
import Field from '@/components/ui/Field';

import Tombol from '@/components/ui/Tombol';
import DialogKonfirmasi from '@/components/ui/DialogKonfirmasi';
import Tabel from '@/components/ui/Tabel';
import Dialog from '@/components/ui/Dialog';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Lencana from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Galat from '@/components/ui/Galat';

import tampilan from '../page.dasbor.module.css';

import Image from 'next/image';
import { FileText, Eye, EyeOff, Trash2, RefreshCw, Save, Plus, Edit2, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useGalleryData } from '../_hook/useGalleryData';
import { useGalleryForm } from '../_hook/useGalleryForm';

export default function GaleriDokumen() {
  const data = useGalleryData();
  const { docs, loading, loadError, loadData, handleToggleStatus, hapusDok, setHapusDok, menghapusDok, handleDelete, handleMoveUp, handleMoveDown, handleViewDoc, viewingDoc, setViewingDoc, signedUrl, setSignedUrl, loadingSignedUrl } = data;
  const { showForm, setShowForm, editingId, form, setForm, saving, formError, uploadingFile, pdfFile, handlePdfSelect, handleOpenForm, handleSave, kemajuan, handleLanjutkan } = useGalleryForm(docs, loadData);
  const aktifCount = docs.filter(d => d.status === 'aktif').length;
  const nonaktifCount = docs.filter(d => d.status === 'nonaktif').length;

  return (
    <>
      <DialogKonfirmasi
        terbuka={!!hapusDok}
        judul={hapusDok ? `Hapus dokumen "${hapusDok.judul}"?` : ''}
        deskripsi="Tindakan ini tidak dapat dibatalkan."
        labelSetuju="Ya, hapus"
        berbahaya
        memuat={menghapusDok}
        onSetuju={() => { if (hapusDok) void handleDelete(hapusDok.id); }}
        onBatal={() => { if (!menghapusDok) setHapusDok(null); }}
      />
      <PageHeader
        title="Investment Gallery"
        description="Kelola dokumen galeri investasi — upload metadata, atur urutan tampil">
        <div className={tampilan.baris1}>
          <Tombol varian="hantu" ukuran="kecil" type="button" onClick={loadData}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Muat ulang
          </Tombol>
          <Tombol varian="utama" ukuran="kecil" type="button" disabled={uploadingFile} onClick={() => handleOpenForm()}>
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
          <Tabel caption="Daftar dokumen galeri" kartuDiHp baris={docs} kunciBaris="id" kosong={<StatusKosong ikon={FileText} judul="Belum ada dokumen. Klik &quot;Tambah Dokumen&quot; untuk menambahkan." />} kolom={[
{ kunci: 'kolom1', judul: "Dokumen", judulBaris: true, peran: 'utama', render: (doc) => (<><div className={tampilan.baris11}>
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
{ kunci: 'kolom4', judul: "Halaman", angka: true, render: (doc) => (<div className={tampilan.sel18}>{doc.status === 'diproses' ? 'Diproses' : `${doc.jumlah_halaman} hal`}</div>) },
{ kunci: 'kolom5', judul: "Urutan", render: (doc, idx) => (<div className={tampilan.urutan}>
                        <Tombol
                          varian="hantu" ukuran="kecil" className={tampilan.area10}
                          title="Pindah ke atas" aria-label={`Pindah ke atas: ${doc.judul}`}
                          disabled={idx === 0}
                          onClick={() => handleMoveUp(doc)}>
                          <ChevronUp size={14} />
                        </Tombol>
                        <span className={tampilan.sel19}>{doc.urutan_tampil}</span>
                        <Tombol
                          varian="hantu" ukuran="kecil" className={tampilan.area10}
                          title="Pindah ke bawah" aria-label={`Pindah ke bawah: ${doc.judul}`}
                          disabled={idx === docs.length - 1}
                          onClick={() => handleMoveDown(doc)}>
                          <ChevronDown size={14} />
                        </Tombol>
                      </div>) },
{ kunci: 'kolom6', judul: "Status", render: (doc) => (<><Lencana nada={doc.status === 'aktif' ? 'sukses' : 'netral'}>
                        {doc.status === 'aktif' ? '✓ Aktif' : doc.status === 'nonaktif' ? 'Nonaktif' : doc.status === 'gagal' ? 'Gagal' : `Diproses ${doc.halaman_selesai}/${doc.jumlah_halaman}`}
                        {doc.galat && <span>{doc.galat}</span>}
                      </Lencana></>) },
{ kunci: 'kolom7', judul: "Aksi", peran: 'aksi', render: (doc) => (<><div className={tampilan.baris20}>
                        <Tombol varian="hantu" ukuran="kecil" type="button" title="Detail" onClick={() => handleViewDoc(doc)}>
                          <Eye size={14} />
                        </Tombol>
                        {['aktif', 'nonaktif'].includes(doc.status) && <Tombol varian="hantu" ukuran="kecil" type="button" title="Edit" onClick={() => handleOpenForm(doc)}>
                          <Edit2 size={14} />
                        </Tombol>}
                        {['aktif', 'nonaktif'].includes(doc.status) && <Tombol
                          varian="hantu" ukuran="kecil" type="button"
                          title={doc.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                          onClick={() => handleToggleStatus(doc.id, doc.status)}>
                          {doc.status === 'aktif' ? <EyeOff size={14} /> : <Eye size={14} />}
                        </Tombol>}
                        {['diproses', 'gagal'].includes(doc.status) && <Tombol ukuran="kecil" disabled={uploadingFile} onClick={() => void handleLanjutkan(doc)}>Lanjutkan pemrosesan</Tombol>}
                        <Tombol
                          varian="hantu" ukuran="kecil" className={["", tampilan.area21].filter(Boolean).join('')}
                          title="Hapus"

                          onClick={() => setHapusDok({ id: doc.id, judul: doc.judul })}>
                          <Trash2 size={14} />
                        </Tombol>
                      </div></>) }
]} />
        )}
        </Kartu>
      </div>

      {kemajuan && <div role="status" aria-live="polite">
        Memproses halaman {kemajuan.selesai} dari {kemajuan.total}
        <progress aria-label="Kemajuan pemrosesan PDF" value={kemajuan.selesai} max={kemajuan.total} />
      </div>}
      {/* Add/Edit Modal */}
      {showForm && (
        <Dialog terbuka judul={editingId ? 'Edit Dokumen' : 'Tambah Dokumen Baru'} onTutup={() => setShowForm(false)}>
            <form onSubmit={handleSave} className={tampilan.baris26}>
              <Field label="Judul Proyek / Dokumen" wajib>
                <input id="gallery-judul" className="form-input" value={form.judul} onChange={e => setForm(f => ({ ...f, judul: e.target.value }))} required />
              </Field>
              <div className={tampilan.kisi27}>
                <Field label="Kategori">
                  <input id="gallery-kategori" className="form-input" placeholder="mis. Manufaktur & Industri" value={form.kategori} onChange={e => setForm(f => ({ ...f, kategori: e.target.value }))} />
                </Field>
                <Field label="Nilai Investasi">
                  <input id="gallery-nilai" className="form-input" placeholder="mis. Rp 2,4 Triliun" value={form.nilai_investasi} onChange={e => setForm(f => ({ ...f, nilai_investasi: e.target.value }))} />
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
                  className={["form-input", tampilan.berkas].join(' ')}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handlePdfSelect(file);
                  }}
                  disabled={uploadingFile || !!editingId}
                />
                <span className="form-hint">Maksimal 50 MB dan 50 halaman. Kemajuan tersimpan dan dapat dilanjutkan.</span>
                {uploadingFile && (
                  <div className={tampilan.baris28}>
                    <Loader2 size={16} className="animate-spin" />
                    Mengunggah dan memproses PDF...
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
