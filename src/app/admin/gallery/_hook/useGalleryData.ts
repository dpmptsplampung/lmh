'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';
import { useToast } from '@/components/Toast';
import { nowServer } from '@/lib/time';
import { KOLOM_DOKUMEN_GALERI, type GalleryDoc } from '../_logika/tipe';
export function useGalleryData() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<GalleryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

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
        .select(KOLOM_DOKUMEN_GALERI)
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
          .update({ status: newStatus, updated_at: nowServer().toISOString() })
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
            .update({ urutan_tampil: urutan, updated_at: nowServer().toISOString() })
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
    const sorted = docs.toSorted((a, b) => a.urutan_tampil - b.urutan_tampil);
    const index = sorted.findIndex(d => d.id === doc.id);
    if (index <= 0) return;

    await tukarUrutan(doc, sorted[index - 1]);
  };

  const handleMoveDown = async (doc: GalleryDoc) => {
    const sorted = docs.toSorted((a, b) => a.urutan_tampil - b.urutan_tampil);
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


  return { docs, loading, loadError, loadData, handleToggleStatus, hapusDok, setHapusDok, menghapusDok, handleDelete, handleMoveUp, handleMoveDown, handleViewDoc, viewingDoc, setViewingDoc, signedUrl, setSignedUrl, loadingSignedUrl };
}
