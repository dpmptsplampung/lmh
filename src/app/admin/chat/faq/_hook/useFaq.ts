'use client';

// Daftar FAQ, filter, dialog, dan aksi halaman Kelola FAQ (refaktor G8, tugas 8.2). Hook tanpa JSX: kueri lewat lib/data/faq.ts,
// akses dari useAksesFaq, logika murni di ../_logika/. Setelah simpan/hapus/alih status FAQ sukses, cache FAQ publik dibuang
// (tag `publik-faq`); gagal membuangnya tidak menggagalkan aksi (cache kedaluwarsa sendiri dalam 60 detik).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { UMUM_KEY, type FAQ, type IsianFaq } from '@/components/admin/faq/types';
import {
  buangCacheFaqPublik,
  hapusFaq,
  muatDaftarFaq,
  prosesEmbedFaq,
  prosesEmbedMassal,
  tambahFaq,
  ubahFaq,
  ubahStatusFaq,
} from '@/lib/data/faq';
import {
  PESAN_PROSES_GAGAL,
  PESAN_PROSES_GAGAL_SESUDAH_SIMPAN,
  dasarDariIsian,
  himpunanDengan,
  himpunanTanpa,
  ringkasanProsesMassal,
  teksFaqBerubah,
} from '../_logika/aksiFaq';
import { adaFilterAktif, kunciAwalTambah, potongHalaman, saringFaq, type FilterStatus } from '../_logika/saringFaq';
import type { AksesFaqHook } from './useAksesFaq';

type Toast = (pesan: string, jenis?: 'success' | 'error' | 'warning' | 'info') => void;

const ACK_KEY = 'lmh_faq_tanggung_jawab';
const bacaAck = () => {
  try { return sessionStorage.getItem(ACK_KEY) === '1'; } catch { return false; }
};

export type DialogFaq =
  | { jenis: 'tambah'; pertanyaanAwal?: string }
  | { jenis: 'ubah'; faq: FAQ }
  | { jenis: 'hapus'; faq: FAQ }
  | null;

export interface OpsiFaq {
  akses: AksesFaqHook;
  toast: Toast;
}

export function useFaq({ akses, toast }: OpsiFaq) {
  const { siapMuat, lingkup, isPetugas, opsiLayanan, isAdmin } = akses;

  /** Fire-and-forget. Route revalidasi hanya menerima Admin, jadi Petugas/Front Office melewatinya. */
  const segarkanCachePublik = () => {
    if (isAdmin) void buangCacheFaqPublik();
  };
  const [faqList, setFaqList] = useState<FAQ[]>([]);
  const [menungguIds, setMenungguIds] = useState<Set<string>>(new Set()); // FAQ yang belum diproses bot
  const [loading, setLoading] = useState(true);
  const [muatGagal, setMuatGagal] = useState(false);
  const [muatUlangKe, setMuatUlangKe] = useState(0);

  const [cari, setCariState] = useState('');
  const [filterStatus, setFilterStatusState] = useState<FilterStatus>('semua');
  const [filterCakupan, setFilterCakupanState] = useState(''); // '' = semua cakupan
  const [halaman, setHalaman] = useState(0);

  const [dialog, setDialog] = useState<DialogFaq>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [memprosesIds, setMemprosesIds] = useState<Set<string>>(new Set());
  const [prosesMassal, setProsesMassal] = useState(false);
  // Petugas wajib mencentang pernyataan tanggung jawab sekali per sesi sebelum menyimpan FAQ.
  const [acked, setAcked] = useState(bacaAck);

  // Prefill dari Log AI Chat (?prefill_pertanyaan=...): buka dialog Tambah begitu halaman siap dipakai.
  const prefillDipakai = useRef(false);
  useEffect(() => {
    if (!siapMuat || prefillDipakai.current || typeof window === 'undefined') return;
    prefillDipakai.current = true;
    const prefill = new URLSearchParams(window.location.search).get('prefill_pertanyaan');
    if (prefill) void Promise.resolve().then(() => setDialog({ jenis: 'tambah', pertanyaanAwal: prefill }));
  }, [siapMuat]);

  // Muat daftar FAQ sesuai lingkup peran (diulang saat muatUlangKe naik).
  useEffect(() => {
    if (!siapMuat) return;
    let batal = false;
    muatDaftarFaq(createClient(), lingkup).then((h) => {
      if (batal) return;
      if (h.error) {
        setFaqList([]);
        setMuatGagal(true);
      } else {
        setFaqList(h.data.faq);
        setMenungguIds(new Set(h.data.menungguIds));
        setMuatGagal(false);
      }
      setLoading(false);
    });
    return () => {
      batal = true;
    };
  }, [siapMuat, lingkup, muatUlangKe]);

  const muatUlangDaftar = () => setMuatUlangKe((n) => n + 1);
  const muatUlangDenganSpinner = () => {
    setLoading(true);
    muatUlangDaftar();
  };

  // Pemrosesan bot (embedding) satu FAQ. Gagal tidak membatalkan simpan: lencana "Menunggu diproses bot" tampil.
  const prosesFaq = async (id: string, sesudahSimpan: boolean) => {
    setMemprosesIds((prev) => himpunanDengan(prev, id));
    const h = await prosesEmbedFaq(id, sesudahSimpan ? PESAN_PROSES_GAGAL_SESUDAH_SIMPAN : PESAN_PROSES_GAGAL);
    if (h.error) toast(h.error.pesan, 'error');
    else if (h.data === 'diproses' && !sesudahSimpan) toast('FAQ diproses. Bot sudah bisa memakainya.', 'success');
    setMemprosesIds((prev) => himpunanTanpa(prev, id));
    muatUlangDaftar();
  };

  // Cadangan Admin: proses semua FAQ yang menunggu (maks 50 per tekan).
  const prosesSemua = async () => {
    if (!isAdmin || prosesMassal) return;
    setProsesMassal(true);
    const h = await prosesEmbedMassal();
    if (h.error) {
      toast(h.error.pesan, 'error');
    } else {
      const { pesan, jenis } = ringkasanProsesMassal(h.data);
      toast(pesan, jenis);
    }
    setProsesMassal(false);
    muatUlangDaftar();
  };

  // Aktif/Nonaktif per FAQ lewat lencana status (RLS menegakkan akses).
  const alihAktif = async (faq: FAQ) => {
    if (togglingId) return;
    setTogglingId(faq.id);
    const baru = !faq.aktif;
    const h = await ubahStatusFaq(createClient(), faq.id, baru);
    if (h.error) {
      toast(h.error.pesan, 'error');
      if (h.error.perluMuatUlang) muatUlangDaftar();
    } else {
      setFaqList((prev) => prev.map((f) => (f.id === faq.id ? { ...f, aktif: baru } : f)));
      toast(baru ? 'FAQ diaktifkan.' : 'FAQ dinonaktifkan.', 'success');
      segarkanCachePublik();
    }
    setTogglingId(null);
  };

  // Simpan dari dialog (tambah dan ubah). Mengembalikan pesan galat agar dialog tetap terbuka dengan isiannya.
  const simpan = async (isian: IsianFaq): Promise<string | null> => {
    if (isPetugas && !acked) {
      try { sessionStorage.setItem(ACK_KEY, '1'); } catch { /* sesi privat: tanya lagi berikutnya */ }
      setAcked(true);
    }
    const sb = createClient();
    const dasar = dasarDariIsian(isian);
    let id: string | null;
    let perluProses: boolean;
    if (dialog?.jenis === 'ubah') {
      const faq = dialog.faq;
      const teksBerubah = teksFaqBerubah(faq, dasar);
      const h = await ubahFaq(sb, { ...dasar, id: faq.id, hapusEmbedding: teksBerubah });
      // Isian dialog sengaja dipertahankan agar pengguna tidak kehilangan tulisannya.
      if (h.error) {
        if (h.error.perluMuatUlang) muatUlangDaftar();
        return h.error.pesan;
      }
      id = faq.id;
      perluProses = teksBerubah;
    } else {
      // UMUM_KEY = FAQ umum (kolom layanan_id NULL).
      const h = await tambahFaq(sb, { ...dasar, layananId: isian.kunci === UMUM_KEY ? null : isian.kunci });
      if (h.error) {
        if (h.error.perluMuatUlang) muatUlangDaftar();
        return h.error.pesan;
      }
      id = h.data.id;
      perluProses = true;
    }
    toast(dialog?.jenis === 'ubah' ? 'Perubahan disimpan.' : 'Pertanyaan ditambahkan.', 'success');
    setDialog(null);
    muatUlangDaftar();
    segarkanCachePublik();
    if (id && perluProses) void prosesFaq(id, true);
    return null;
  };

  const hapus = async (faq: FAQ): Promise<string | null> => {
    const h = await hapusFaq(createClient(), faq.id);
    if (h.error) {
      if (h.error.perluMuatUlang) muatUlangDaftar();
      return h.error.pesan;
    }
    toast('FAQ dihapus.', 'success');
    setDialog(null);
    muatUlangDaftar();
    segarkanCachePublik();
    return null;
  };

  const filter = useMemo(() => ({ cari, status: filterStatus, cakupan: filterCakupan }), [cari, filterStatus, filterCakupan]);
  const tampil = useMemo(() => saringFaq(faqList, filter), [faqList, filter]);
  const potong = potongHalaman(tampil, halaman);

  return {
    faqList,
    menungguIds,
    loading,
    muatGagal,
    muatUlangDenganSpinner,
    // filter
    cari,
    filterStatus,
    filterCakupan,
    setCari: (nilai: string) => { setCariState(nilai); setHalaman(0); },
    setFilterStatus: (nilai: FilterStatus) => { setFilterStatusState(nilai); setHalaman(0); },
    setFilterCakupan: (nilai: string) => { setFilterCakupanState(nilai); setHalaman(0); },
    resetFilter: () => {
      setCariState('');
      setFilterStatusState('semua');
      setFilterCakupanState('');
      setHalaman(0);
    },
    adaFilter: adaFilterAktif(filter),
    tampil,
    halamanAman: potong.halaman,
    halamanIni: potong.isi,
    setHalaman,
    // dialog
    dialog,
    bukaTambah: () => setDialog({ jenis: 'tambah' }),
    bukaUbah: (faq: FAQ) => setDialog({ jenis: 'ubah', faq }),
    bukaHapus: (faq: FAQ) => setDialog({ jenis: 'hapus', faq }),
    tutupDialog: () => setDialog(null),
    kunciAwalTambah: kunciAwalTambah(filterCakupan, opsiLayanan),
    perluPernyataan: isPetugas && !acked,
    // aksi
    togglingId,
    memprosesIds,
    prosesMassal,
    prosesFaq,
    prosesSemua,
    alihAktif,
    simpan,
    hapus,
  };
}
