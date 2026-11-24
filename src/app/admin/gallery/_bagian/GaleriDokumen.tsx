'use client';
import Field from '@/components/ui/Field';

import Tombol from '@/components/ui/Tombol';
import DialogKonfirmasi from '@/components/ui/DialogKonfirmasi';
import Tabel from '@/components/ui/Tabel';
import Dialog from '@/components/ui/Dialog';
import Kartu from '@/components/ui/Kartu';
import Lencana from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Galat from '@/components/ui/Galat';
import IsiHalaman from '@/components/layout/IsiHalaman';
import { KATEGORI_DOKUMEN } from '@/lib/investasi/dokumen';

import tampilan from '../page.dasbor.module.css';

import Image from 'next/image';
import { FileText, Eye, EyeOff, Trash2, RefreshCw, Save, Plus, Edit2, ChevronUp, ChevronDown, Loader2, Upload } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useGalleryData } from '../_hook/useGalleryData';
import { useGalleryForm } from '../_hook/useGalleryForm';

export default function GaleriDokumen() {
  const data = useGalleryData();
  const { docs, loading, loadError, loadData, handleToggleStatus, hapusDok, setHapusDok, menghapusDok, handleDelete, handleMoveUp, handleMoveDown, handleViewDoc, viewingDoc, setViewingDoc, signedUrl, setSignedUrl, loadingSignedUrl } = data;
  const { showForm, setShowForm, editingId, form, setForm, saving, formError, uploadingFile, pdfFile, handlePdfSelect, handleOpenForm, handleSave, kemajuan, handleLanjutkan } = useGalleryForm(docs, loadData);
  const aktifCount = docs.filter(d => d.status === 'aktif').length;
  const nonaktifCount = docs.filter(d => d.status === 'nonaktif').length;
  const prosesCount = docs.filter(d => d.status === 'diproses' || d.status === 'gagal').length;
  // Nilai kategori lama (di luar pilihan tetap) tetap terbaca di form edit sampai staf memilih kategori baru.
  const kategoriLama = editingId ? docs.find(d => d.id === editingId)?.kategori ?? null : null;
  const kategoriLamaTampil = kategoriLama && !(KATEGORI_DOKUMEN as readonly string[]).includes(kategoriLama) ? kategoriLama : null;

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
        description="Kelola dokumen yang tampil di Investment Gallery: unggah PDF, ubah keterangan, dan atur urutan tampil.">
        <div className={tampilan.baris1}>
          <Tombol varian="hantu" ukuran="kecil" type="button" ikon={RefreshCw} memuat={loading} onClick={loadData}>Muat ulang</Tombol>
          <Tombol varian="utama" ukuran="kecil" type="button" ikon={Plus} disabled={uploadingFile} onClick={() => handleOpenForm()}>Tambah Dokumen</Tombol>
        </div>
      </PageHeader>

      <IsiHalaman>
        {/* Ringkasan satu baris (menggantikan dua kartu statistik besar untuk angka kecil). */}
        {!loadError && !loading && (
          <p className={tampilan.ringkasan} aria-label="Ringkasan dokumen">
            <Lencana nada="sukses">{aktifCount} aktif</Lencana>
            <Lencana nada="netral">{nonaktifCount} nonaktif</Lencana>
            {prosesCount > 0 && <Lencana nada="peringatan">{prosesCount} perlu diproses</Lencana>}
          </p>
        )}

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
                          <p className={tampilan.teks16}>{doc.status === 'diproses' ? 'Diproses' : `${doc.jumlah_halaman} halaman`}</p>
                        </div>
                      </div></>) },
{ kunci: 'kolom2', judul: "Kategori", render: (doc) => (<>{doc.kategori && <Lencana nada="netral">{doc.kategori}</Lencana>}</>) },
{ kunci: 'kolom3', judul: "Nilai", render: (doc) => (doc.nilai_investasi ? <div className={tampilan.sel17}>{doc.nilai_investasi}</div> : <span className={tampilan.kosong}>—</span>) },
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
                        <Tombol varian="hantu" ukuran="kecil" type="button" title="Detail" aria-label={`Detail dokumen ${doc.judul}`} onClick={() => handleViewDoc(doc)}>
                          <Eye size={14} aria-hidden="true" />
                        </Tombol>
                        {['aktif', 'nonaktif'].includes(doc.status) && <Tombol varian="hantu" ukuran="kecil" type="button" title="Edit" aria-label={`Edit dokumen ${doc.judul}`} onClick={() => handleOpenForm(doc)}>
                          <Edit2 size={14} aria-hidden="true" />
                        </Tombol>}
                        {['aktif', 'nonaktif'].includes(doc.status) && <Tombol
                          varian="hantu" ukuran="kecil" type="button"
                          title={doc.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                          aria-label={`${doc.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'} dokumen ${doc.judul}`}
                          onClick={() => handleToggleStatus(doc.id, doc.status)}>
                          {doc.status === 'aktif' ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                        </Tombol>}
                        {['diproses', 'gagal'].includes(doc.status) && <Tombol ukuran="kecil" disabled={uploadingFile} onClick={() => void handleLanjutkan(doc)}>Lanjutkan pemrosesan</Tombol>}
                        <Tombol
                          varian="hantu" ukuran="kecil" className={["", tampilan.area21].filter(Boolean).join('')}
                          title="Hapus"
                          aria-label={`Hapus dokumen ${doc.judul}`}

                          onClick={() => setHapusDok({ id: doc.id, judul: doc.judul })}>
                          <Trash2 size={14} aria-hidden="true" />
                        </Tombol>
                      </div></>) }
]} />
        )}
        </Kartu>
      </IsiHalaman>

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
                <Field label="Kategori" bantuan={kategoriLamaTampil ? `Kategori lama: "${kategoriLamaTampil}". Memilih kategori mengganti nilai ini.` : 'Dokumen berkategori Peta Potensi tampil sebagai sorotan.'}>
                  <select id="gallery-kategori" className="form-input" value={form.kategori} onChange={e => setForm(f => ({ ...f, kategori: e.target.value }))}>
                    {!form.kategori && <option value="">Pilih kategori</option>}
                    {KATEGORI_DOKUMEN.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </Field>
                <Field label="Nilai Investasi">
                  <input id="gallery-nilai" className="form-input" placeholder="mis. Rp 2,4 Triliun" value={form.nilai_investasi} onChange={e => setForm(f => ({ ...f, nilai_investasi: e.target.value }))} />
                </Field>
              </div>
              <Field label="Deskripsi Singkat">
                <textarea id="gallery-deskripsi" className="form-input" rows={3} value={form.deskripsi} onChange={e => setForm(f => ({ ...f, deskripsi: e.target.value }))} />
              </Field>
              <Field label="Gambar kecil di daftar admin (URL, opsional)" bantuan="Sampul di halaman publik diambil otomatis dari halaman pertama dokumen.">
                <input id="gallery-thumb" className="form-input" type="url" placeholder="https://..." value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} />
              </Field>
              {editingId ? (
                <div className="form-group">
                  <span className="form-label">Berkas dokumen</span>
                  <span className="form-hint">
                    File saat ini: {form.file_path.split('/').pop()}. PDF tidak dapat diganti di form edit.
                  </span>
                </div>
              ) : (
                <div className="form-group">
                  <span className="form-label form-label--required" id="gallery-pdf-judul">Berkas dokumen</span>
                  {/* Kontrol berkas bawaan peramban berbahasa Inggris: input asli tetap ada (terfokus lewat papan ketik), tampilannya diganti tombol berbahasa Indonesia. */}
                  <div className={tampilan.berkasBaris}>
                    <input
                      id="gallery-pdf"
                      type="file"
                      accept="application/pdf"
                      className={tampilan.berkasInput}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handlePdfSelect(file);
                      }}
                      disabled={uploadingFile}
                    />
                    <label htmlFor="gallery-pdf" className={tampilan.berkasTombol} data-nonaktif={uploadingFile}>
                      <Upload size={16} aria-hidden="true" />
                      {pdfFile ? 'Ganti file PDF' : 'Pilih file PDF'}
                    </label>
                    <span className={tampilan.berkasNama}>{pdfFile ? pdfFile.name : 'Belum ada file dipilih'}</span>
                  </div>
                  <span className="form-hint">Maksimal 50 MB dan 50 halaman. Kemajuan tersimpan dan dapat dilanjutkan.</span>
                  {uploadingFile && (
                    <div className={tampilan.baris28}>
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                      Mengunggah dan memproses PDF...
                    </div>
                  )}
                </div>
              )}
              <div className={tampilan.kisi30}>
                <Field label="Urutan Tampil">
                  <input id="gallery-urutan" className="form-input" type="number" min={1} value={form.urutan_tampil} onChange={e => setForm(f => ({ ...f, urutan_tampil: Number(e.target.value) }))} />
                </Field>
                {/* Status hanya bisa disimpan untuk dokumen yang sudah terbit; dokumen baru selalu diproses dulu lalu aktif otomatis. */}
                {editingId && (form.status === 'aktif' || form.status === 'nonaktif') && (
                  <Field label="Status">
                    <select id="gallery-status" className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as 'aktif' | 'nonaktif' }))}>
                      <option value="aktif">Aktif</option>
                      <option value="nonaktif">Nonaktif</option>
                    </select>
                  </Field>
                )}
              </div>
              <p className="form-hint">
                {editingId
                  ? `Jumlah halaman: ${form.jumlah_halaman} (dihitung otomatis dari PDF).`
                  : 'Jumlah halaman dihitung otomatis dari PDF. Dokumen diproses halaman demi halaman lalu aktif otomatis.'}
              </p>
              {formError && <p className="form-error">{formError}</p>}
              <div className={tampilan.baris31}>
                <Tombol type="button" varian="hantu" onClick={() => setShowForm(false)}>Batal</Tombol>
                <Tombol type="submit" varian="utama" ikon={Save} memuat={saving}>Simpan</Tombol>
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
