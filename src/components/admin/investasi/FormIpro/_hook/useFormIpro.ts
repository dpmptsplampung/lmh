'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { daftarDokumenAktif, type DokumenRingkas, type GambarIproKelola, type IproAdmin } from '@/lib/data/investasi';
import { useToast } from '@/components/Toast';
import { bangunPayload, nilaiDariProyek, nilaiKosong, type KunciForm, type NilaiForm, type SumberIpro } from '../_logika/nilai-form';
import { tabPertamaBergalat, validasiForm, type GalatForm } from '../_logika/validasi';
import { kekuranganTerbitKlien } from '../_logika/syarat';
import { pesanGalat } from '../_logika/label';
import { GalatIpro, buatIproApi, hapusIproApi, muatIproApi, statusIproApi, ubahIproApi } from './apiIpro';

export type AksiKonfirmasi = 'terbit' | 'arsip' | 'kembali_draf' | 'hapus';
export type TahapMuat = 'memuat' | 'siap' | 'tidakAda' | 'galat';
export interface ArgumenFormIpro { hrefDaftar: string; id?: string; sumberBaru?: SumberIpro }

const PESAN_SUKSES: Record<AksiKonfirmasi, string> = {
  terbit: 'IPRO diterbitkan.', arsip: 'IPRO diarsipkan.', kembali_draf: 'IPRO dikembalikan ke draf.', hapus: 'Draf IPRO dihapus.',
};

// State dan aksi layar FormIpro: muat, isian, simpan, dan perpindahan status. Tanpa JSX.
export function useFormIpro({ hrefDaftar, id, sumberBaru = 'ptsp' }: ArgumenFormIpro) {
  const router = useRouter();
  const { toast } = useToast();
  const sb = useMemo(() => createClient(), []);
  const hidup = useRef(true);
  const [tahap, setTahap] = useState<TahapMuat>(id ? 'memuat' : 'siap');
  const [proyek, setProyek] = useState<IproAdmin | null>(null);
  const [gambar, setGambar] = useState<GambarIproKelola[]>([]);
  const [dokumen, setDokumen] = useState<DokumenRingkas[]>([]);
  const [nilai, setNilai] = useState<NilaiForm>(nilaiKosong);
  const [awal, setAwal] = useState(() => JSON.stringify(nilaiKosong()));
  const [galatField, setGalatField] = useState<GalatForm>({});
  const [tab, setTab] = useState('informasi');
  const [sedang, setSedang] = useState<null | 'simpan' | 'status'>(null);
  const [pesan, setPesan] = useState('');
  const [kekurangan, setKekurangan] = useState<string[]>([]);
  const [konflik, setKonflik] = useState(false);
  const [konfirmasi, setKonfirmasi] = useState<AksiKonfirmasi | null>(null);
  const sumber: SumberIpro = proyek?.sumber ?? sumberBaru;

  useEffect(() => { hidup.current = true; return () => { hidup.current = false; }; }, []);

  const ambil = useCallback(async (jagaIsian: boolean) => {
    if (!id) return;
    try {
      const [hasil, dok] = await Promise.all([muatIproApi(id), daftarDokumenAktif(sb, 200)]);
      if (!hidup.current) return;
      const { gambar: daftarGambar, ...baris } = hasil;
      setGambar(daftarGambar);
      if (!jagaIsian) {
        const n = nilaiDariProyek(baris);
        setProyek(baris); setDokumen(dok.data ?? []); setNilai(n); setAwal(JSON.stringify(n));
      }
      setTahap('siap');
    } catch (e) {
      if (hidup.current) setTahap(e instanceof GalatIpro && e.status === 404 ? 'tidakAda' : 'galat');
    }
  }, [id, sb]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- pemuatan awal: setState hanya setelah await
  useEffect(() => { void ambil(false); }, [ambil]);

  const muatUlang = useCallback(() => {
    setTahap('memuat'); setKonflik(false); setPesan(''); setKekurangan([]); setGalatField({});
    void ambil(false);
  }, [ambil]);
  // Versi tetap milik snapshot isian; adopsi versi server baru hanya bersama isian dan baseline-nya.
  const segarkan = useCallback(() => ambil(true), [ambil]);

  const ubah = useCallback((kunci: KunciForm, v: string) => {
    setNilai((n) => ({ ...n, [kunci]: v }));
    setGalatField((g) => (g[kunci] ? { ...g, [kunci]: undefined } : g));
  }, []);

  const tangani = useCallback((e: unknown) => {
    const kode = e instanceof GalatIpro ? e.kode : 'GAGAL_INTERNAL';
    if (kode === 'KONFLIK_VERSI') setKonflik(true);
    if (e instanceof GalatIpro && kode === 'SYARAT_TERBIT') setKekurangan(e.kekurangan);
    setPesan(pesanGalat(kode, e instanceof GalatIpro ? e.message : undefined));
  }, []);

  const simpan = useCallback(async () => {
    setPesan(''); setKekurangan([]);
    const g = validasiForm(nilai, sumber);
    setGalatField(g);
    if (Object.keys(g).length) {
      const tujuan = tabPertamaBergalat(g);
      if (tujuan && sumber === 'ptsp') setTab(tujuan);
      setPesan('Periksa isian yang bertanda galat.');
      return;
    }
    setSedang('simpan');
    try {
      const payload = bangunPayload(nilai, sumber);
      if (!proyek) {
        const baru = await buatIproApi({ sumber, ...payload });
        toast('Draf IPRO dibuat. Lanjutkan dengan mengunggah gambar.', 'success');
        router.replace(`${hrefDaftar}/${baru.id}`);
        return;
      }
      const hasil = await ubahIproApi(proyek.id, payload, proyek.versi);
      if (!hidup.current) return;
      const n = nilaiDariProyek(hasil);
      setProyek(hasil); setNilai(n); setAwal(JSON.stringify(n));
      toast('Perubahan disimpan.', 'success');
    } catch (e) { if (hidup.current) tangani(e); }
    finally { if (hidup.current) setSedang(null); }
  }, [nilai, sumber, proyek, hrefDaftar, router, toast, tangani]);

  const jalankanKonfirmasi = useCallback(async () => {
    const aksi = konfirmasi;
    if (!aksi || !proyek) return;
    setSedang('status'); setPesan(''); setKekurangan([]);
    try {
      if (aksi === 'hapus') {
        await hapusIproApi(proyek.id);
        toast(PESAN_SUKSES.hapus, 'success');
        router.push(hrefDaftar);
        return;
      }
      const hasil = await statusIproApi(proyek.id, aksi, proyek.versi);
      if (!hidup.current) return;
      setProyek((p) => (p ? { ...p, status: hasil.status, versi: hasil.versi } : p)); setKonfirmasi(null);
      toast(PESAN_SUKSES[aksi], 'success');
      await ambil(true);
    } catch (e) { if (hidup.current) { setKonfirmasi(null); tangani(e); } }
    finally { if (hidup.current) setSedang(null); }
  }, [konfirmasi, proyek, hrefDaftar, router, toast, tangani, ambil]);

  const kotor = JSON.stringify(nilai) !== awal;
  const kurangKlien = useMemo(() => kekuranganTerbitKlien(nilai, sumber, gambar), [nilai, sumber, gambar]);

  return {
    tahap, proyek, gambar, dokumen, nilai, galatField, tab, setTab, sedang, pesan, setPesan, kekurangan, konflik, konfirmasi, setKonfirmasi,
    sumber, kotor, kurangKlien, ubah, simpan, jalankanKonfirmasi, muatUlang, segarkan, tangani,
  };
}
