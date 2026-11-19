'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/components/Toast';
import type { GambarIpro } from '@/lib/data/investasi';
import { periksaBerkasGambar, rencanaUrutan } from '../_logika/gambar';
import { hapusGambarApi, ubahGambarApi, unggahGambarIpro, type IsianGambar } from './apiIpro';

// Operasi gambar proyek. Setiap operasi diakhiri `segarkan` agar daftar mengikuti keadaan server.
export function useGambarIpro(proyekId: string | null, gambar: GambarIpro[], segarkan: () => Promise<void>, tangani: (e: unknown) => void) {
  const { toast } = useToast();
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');

  const jalankan = useCallback(async (kerja: () => Promise<unknown>, sukses: string) => {
    setSibuk(true); setGalat('');
    try { await kerja(); toast(sukses, 'success'); await segarkan(); return true; }
    catch (e) { tangani(e); setGalat(e instanceof Error ? e.message : 'Operasi gambar gagal.'); await segarkan().catch(() => undefined); return false; }
    finally { setSibuk(false); }
  }, [segarkan, tangani, toast]);

  const tambah = useCallback(async (berkas: File, isian: IsianGambar) => {
    if (!proyekId) return false;
    const masalah = periksaBerkasGambar(berkas);
    if (masalah) { setGalat(masalah); return false; }
    return jalankan(() => unggahGambarIpro(proyekId, berkas, isian), 'Gambar ditambahkan.');
  }, [proyekId, jalankan]);

  const ubah = useCallback((id: string, isian: Partial<IsianGambar>) =>
    proyekId ? jalankan(() => ubahGambarApi(proyekId, id, isian), 'Gambar diperbarui.') : Promise.resolve(false), [proyekId, jalankan]);

  const jadikanUtama = useCallback((id: string) =>
    proyekId ? jalankan(() => ubahGambarApi(proyekId, id, { utama: true }), 'Gambar utama diganti.') : Promise.resolve(false), [proyekId, jalankan]);

  const geser = useCallback((id: string, arah: -1 | 1) => {
    if (!proyekId) return Promise.resolve(false);
    const dari = gambar.findIndex((g) => g.id === id);
    const rencana = rencanaUrutan(gambar, dari, dari + arah);
    if (!rencana.length) return Promise.resolve(false);
    return jalankan(async () => { for (const r of rencana) await ubahGambarApi(proyekId, r.id, { urutan: r.urutan }); }, 'Urutan gambar diperbarui.');
  }, [proyekId, gambar, jalankan]);

  const hapus = useCallback((id: string) =>
    proyekId ? jalankan(() => hapusGambarApi(proyekId, id), 'Gambar dihapus.') : Promise.resolve(false), [proyekId, jalankan]);

  return { sibuk, galat, tambah, ubah, jadikanUtama, geser, hapus };
}
