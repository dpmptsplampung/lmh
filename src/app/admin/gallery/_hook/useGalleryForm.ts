'use client';
import { useState } from 'react';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';
import { useToast } from '@/components/Toast';
import { kategoriDokumen } from '@/lib/investasi/dokumen';
import { patchDokumen } from './mutasi-dokumen';
import { emptyForm, type GalleryDoc, type GalleryForm } from '../_logika/tipe';
import { jsonPost, prosesDokumen } from '../_logika/unggah';
export function useGalleryForm(docs: GalleryDoc[], loadData: () => Promise<void>) {
  const { toast } = useToast();
  // Form modal state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dokumenAwal, setDokumenAwal] = useState<GalleryDoc | null>(null);
  const [form, setForm] = useState<GalleryForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);

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

  const [kemajuan, setKemajuan] = useState<{ id: string; selesai: number; total: number } | null>(null);
  const lanjutkan = async (doc: Pick<GalleryDoc, 'id' | 'halaman_selesai' | 'jumlah_halaman'>) => {
    setUploadingFile(true);
    setKemajuan({ id: doc.id, selesai: doc.halaman_selesai, total: doc.jumlah_halaman });
    try {
      await prosesDokumen(doc, (selesai, total) => setKemajuan({ id: doc.id, selesai, total }));
    } finally { setUploadingFile(false); setKemajuan(null); await loadData(); }
  };
  const handleLanjutkan = async (doc: GalleryDoc) => {
    try { await lanjutkan(doc); toast('Pemrosesan dokumen selesai.', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Pemrosesan terhenti. Silakan lanjutkan.', 'error'); }
  };
  const handleOpenForm = (doc?: GalleryDoc) => {
    if (doc) {
      setEditingId(doc.id);
      setDokumenAwal(doc);
      setForm({
        judul: doc.judul,
        kategori: kategoriDokumen(doc.kategori),
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
      setDokumenAwal(null);
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
        const file = pdfFile as File;
        const presign = await jsonPost('/api/storage/presign', { area: 'investment-docs', mime: file.type, ukuran: file.size });
        const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: presign.headers, body: file });
        if (!put.ok) throw new Error('Gagal mengunggah PDF. Coba lagi.');
        const konfirmasi = await jsonPost('/api/storage/konfirmasi', { area: 'investment-docs', path: presign.kunci.slice('investment-docs/'.length) });
        const doc = await jsonPost('/api/investment-docs', {
          kunci: konfirmasi.kunci, judul: form.judul.trim(), kategori: form.kategori.trim() || undefined,
          deskripsi: form.deskripsi.trim() || undefined, nilai_investasi: form.nilai_investasi.trim() || undefined,
          image_url: form.image_url.trim() || undefined, urutan_tampil: form.urutan_tampil,
        });
        // Baris sudah tersimpan: tutup form agar retry tidak membuat dokumen kedua.
        setShowForm(false); setPdfFile(null);
        await loadData();
        await lanjutkan({ id: doc.id, halaman_selesai: 0, jumlah_halaman: doc.jumlah_halaman });
      } else {
        const statusAwal = dokumenAwal?.status;
        const urutanAwal = dokumenAwal?.urutan_tampil;
        const ubahStatus = (statusAwal === 'aktif' || statusAwal === 'nonaktif') &&
          (form.status === 'aktif' || form.status === 'nonaktif') && statusAwal !== form.status;
        await patchDokumen(editingId, {
          aksi: 'metadata',
          judul: form.judul.trim(),
          kategori: form.kategori.trim() || null,
          ...(urutanAwal !== undefined && urutanAwal !== form.urutan_tampil
            ? { urutan_tampil: form.urutan_tampil, urutan_lama: urutanAwal } : {}),
          deskripsi: form.deskripsi.trim() || null,
          nilai_investasi: form.nilai_investasi.trim() || null,
          image_url: form.image_url.trim() || null,
          ...(ubahStatus ? { status: form.status, status_lama: statusAwal } : {}),
        });
      }
      setShowForm(false);
      setPdfFile(null);
      toast('Dokumen berhasil disimpan.', 'success');
      loadData();
    } catch (err) {
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


  return { showForm, setShowForm, editingId, form, setForm, saving, formError, uploadingFile, pdfFile, handlePdfSelect, handleOpenForm, handleSave, kemajuan, handleLanjutkan };
}
