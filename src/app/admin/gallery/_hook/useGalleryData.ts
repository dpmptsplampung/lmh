'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { pesanMutasi } from '@/lib/supabase/mutate';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';
import { useToast } from '@/components/Toast';
import { patchDokumen } from './mutasi-dokumen';
import { KOLOM_DOKUMEN_GALERI, type GalleryDoc } from '../_logika/tipe';
export function useGalleryData() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<GalleryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Detail modal
  const [viewingDoc, simpanViewingDoc] = useState<GalleryDoc | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingSignedUrl, setLoadingSignedUrl] = useState(false);
  const permintaanPratinjau = useRef(0);
  const sedangMemindah = useRef(false);

  const setViewingDoc = (doc: GalleryDoc | null) => {
    permintaanPratinjau.current++;
    simpanViewingDoc(doc);
    setSignedUrl(null);
    setLoadingSignedUrl(false);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('investment_documents')
        .select(KOLOM_DOKUMEN_GALERI)
        .order('urutan_tampil', { ascending: true });
      if (error) throw error;
      const baris = (data ?? []) as GalleryDoc[];
      setDocs(baris.toSorted((a, b) => a.urutan_tampil - b.urutan_tampil || a.id.localeCompare(b.id)));
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
    if (currentStatus !== 'aktif' && currentStatus !== 'nonaktif') return;
    const newStatus = currentStatus === 'aktif' ? 'nonaktif' : 'aktif';
    try {
      await patchDokumen(id, { aksi: 'status', status_lama: currentStatus, status: newStatus });
      setDocs(prev => prev.map(d => d.id === id ? { ...d, status: newStatus } : d));
      toast(`Status berhasil diubah menjadi ${newStatus}.`, 'success');
    } catch (e) {
      toast(`Gagal mengubah status dokumen. ${pesanMutasi(e)}`, 'error');
      if (perluMuatUlang(e)) await loadData();
    }
  };

  const [hapusDok, setHapusDok] = useState<{ id: string; judul: string } | null>(null);
  const [menghapusDok, setMenghapusDok] = useState(false);

  const handleDelete = async (id: string) => {
    setMenghapusDok(true);
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
    } finally {
      setMenghapusDok(false);
      setHapusDok(null);
    }
  };

  const pindahkanDokumen = async (doc: GalleryDoc, arah: -1 | 1) => {
    if (sedangMemindah.current) return;
    const posisi = docs.findIndex(d => d.id === doc.id);
    const tetangga = docs[posisi + arah];
    if (posisi < 0 || !tetangga) return;
    sedangMemindah.current = true;
    try {
      await patchDokumen(doc.id, { aksi: 'urutan', tetangga_id: tetangga.id,
        urutan_lama: docs[posisi].urutan_tampil, urutan_tetangga: tetangga.urutan_tampil });
      await loadData();
    } catch (e) {
      toast(`Gagal mengubah urutan dokumen. ${pesanMutasi(e)}`, 'error');
      if (perluMuatUlang(e)) await loadData();
    } finally {
      sedangMemindah.current = false;
    }
  };

  const handleMoveUp = (doc: GalleryDoc) => pindahkanDokumen(doc, -1);
  const handleMoveDown = (doc: GalleryDoc) => pindahkanDokumen(doc, 1);

  const handleViewDoc = async (doc: GalleryDoc) => {
    setViewingDoc(doc);
    const idPermintaan = permintaanPratinjau.current;
    setLoadingSignedUrl(true);
    try {
      const res = await fetch('/api/investment-docs/signed-url?file_path=' + encodeURIComponent(doc.file_path));
      if (!res.ok) throw new Error('Failed to fetch signed URL');
      const data = await res.json();
      if (idPermintaan === permintaanPratinjau.current) setSignedUrl(data.signedUrl);
    } catch {
      if (idPermintaan === permintaanPratinjau.current) toast('Gagal memuat pratinjau PDF.', 'error');
    } finally {
      if (idPermintaan === permintaanPratinjau.current) setLoadingSignedUrl(false);
    }
  };


  return { docs, loading, loadError, loadData, handleToggleStatus, hapusDok, setHapusDok, menghapusDok, handleDelete, handleMoveUp, handleMoveDown, handleViewDoc, viewingDoc, setViewingDoc, signedUrl, setSignedUrl, loadingSignedUrl };
}
