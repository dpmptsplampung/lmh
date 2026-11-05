'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  HelpCircle,
  Edit2,
  Trash2,
  Plus,
  Search,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Pagination from '@/components/Pagination';
import { createClient } from '@/lib/supabase/client';
import { mutasiInsert, mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';
import { layananFaqBolehDikelola } from '@/lib/faq-scope';
import { formatTanggal } from '@/lib/utils';
import { useToast } from '@/components/Toast';
import Galat from '@/components/ui/Galat';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Tombol from '@/components/ui/Tombol';
import RoleNote from '@/components/admin/RoleNote';
import CobaTanyaBot from '@/components/admin/settings/CobaTanyaBot';
import FaqFormDialog from '@/components/admin/faq/FaqFormDialog';
import HapusFaqDialog from '@/components/admin/faq/HapusFaqDialog';
import { UMUM_KEY, type FAQ, type IsianFaq } from '@/components/admin/faq/types';
import styles from './faq.module.css';

const ACK_KEY = 'lmh_faq_tanggung_jawab';
const readAck = () => {
  try { return sessionStorage.getItem(ACK_KEY) === '1'; } catch { return false; }
};

const UKURAN_HALAMAN = 20;
const UKURAN_MUAT = 500;
const BATAS_MUAT = 10_000;

// Daftar dan pencarian klien memerlukan semua baris; tolak hasil parsial di atas batas keamanan.
async function muatBertahap<T>(kueri: (dari: number, sampai: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const semua: T[] = [];
  for (let dari = 0; dari <= BATAS_MUAT; dari += UKURAN_MUAT) {
    const { data, error } = await kueri(dari, dari + UKURAN_MUAT - 1);
    if (error) throw error;
    const baris = (data ?? []) as T[];
    semua.push(...baris);
    if (semua.length > BATAS_MUAT) throw new Error('Daftar FAQ melampaui batas pemuatan.');
    if (baris.length < UKURAN_MUAT) return semua;
  }
  throw new Error('Daftar FAQ melampaui batas pemuatan.');
}
const KOLOM_FAQ = 'id, layanan_id, pertanyaan, jawaban, dasar_hukum, aktif, urutan, updated_at';
const PESAN_PROSES_GAGAL = 'Bot belum bisa memproses FAQ ini. Coba lagi beberapa saat lagi.';
const PESAN_PROSES_GAGAL_SESUDAH_SIMPAN = 'FAQ tersimpan, tetapi belum bisa diproses bot. Coba lagi dari daftar.';

interface Layanan {
  id: string;
  nama: string;
  chatbot_aktif: boolean;
}

type FilterStatus = 'semua' | 'aktif' | 'nonaktif';
const FILTER_STATUS: Array<{ nilai: FilterStatus; label: string }> = [
  { nilai: 'semua', label: 'Semua' },
  { nilai: 'aktif', label: 'Aktif' },
  { nilai: 'nonaktif', label: 'Nonaktif' },
];

type Dialog = { jenis: 'tambah'; pertanyaanAwal?: string } | { jenis: 'ubah'; faq: FAQ } | { jenis: 'hapus'; faq: FAQ } | null;

export default function AdminFAQPage() {
  const { toast } = useToast();
  const [layananList, setLayananList] = useState<Layanan[]>([]);
  const [layananSelesai, setLayananSelesai] = useState(false); // daftar layanan sudah dimuat (sukses/gagal)
  const [layananError, setLayananError] = useState(false);
  const [layananMuatKe, setLayananMuatKe] = useState(0);
  const [layananMemuat, setLayananMemuat] = useState(false);
  const [role, setRole] = useState<string | null>(null); // null = belum dimuat (atau gagal dimuat: lihat roleError)
  const [roleError, setRoleError] = useState(false); // gagal membaca peran (jaringan/galat DB) != memang tanpa akses
  const [roleMuatKe, setRoleMuatKe] = useState(0);
  const [roleMemuat, setRoleMemuat] = useState(false);
  const [layananPetugasId, setLayananPetugasId] = useState<string | null>(null);
  const isAdmin = role === 'admin';
  const isPetugas = role === 'petugas';
  const isFrontOffice = role === 'front_office';

  const [faqList, setFaqList] = useState<FAQ[]>([]);
  const [menungguIds, setMenungguIds] = useState<Set<string>>(new Set()); // FAQ yang belum diproses bot
  const [loading, setLoading] = useState(true);
  const [muatGagal, setMuatGagal] = useState(false);
  const [muatUlangKe, setMuatUlangKe] = useState(0);

  const [cari, setCari] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('semua');
  const [filterCakupan, setFilterCakupan] = useState(''); // '' = semua cakupan
  const [halaman, setHalaman] = useState(0);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [memprosesIds, setMemprosesIds] = useState<Set<string>>(new Set());
  const [prosesMassal, setProsesMassal] = useState(false);
  const [togglingBot, setTogglingBot] = useState(false);
  const [botPilih, setBotPilih] = useState(''); // layanan yang diatur di panel Pengaturan bot ('' = belum memilih)

  // Cakupan yang BOLEH dikelola peran ini (selaras RLS; lihat lib/faq-scope.ts).
  const opsiLayanan = useMemo(
    () => (role === null ? [] : layananFaqBolehDikelola(role, layananPetugasId, layananList)),
    [role, layananPetugasId, layananList],
  );
  // Admin dan petugas (berlayanan) butuh daftar layanan; Front Office hanya mengelola FAQ umum sehingga gagal
  // memuat layanan tidak boleh memblokirnya.
  const butuhDaftarLayanan = isAdmin || (isPetugas && !!layananPetugasId);
  const layananGagalBlokir = layananError && butuhDaftarLayanan;
  const tanpaAkses = role !== null && layananSelesai && !layananGagalBlokir && opsiLayanan.length === 0;
  const siapMuat = role !== null && layananSelesai && !layananGagalBlokir && opsiLayanan.length > 0;
  const namaLayanan = useMemo(() => new Map(layananList.map((l) => [l.id, l.nama])), [layananList]);

  // Petugas wajib mencentang pernyataan tanggung jawab sekali per sesi sebelum menyimpan FAQ.
  const [acked, setAcked] = useState(readAck);

  // Pengaturan bot: Admin memilih layanan; petugas hanya layanannya.
  const opsiBot = useMemo(() => opsiLayanan.filter((o) => o.id !== null), [opsiLayanan]);
  const botLayananId = opsiBot.some((o) => o.id === botPilih) ? botPilih : (opsiBot[0]?.id ?? null);
  const botLayanan = botLayananId ? layananList.find((l) => l.id === botLayananId) : undefined;
  const tampilPanelBot = (isAdmin || isPetugas) && opsiBot.length > 0;

  // Prefill dari Log AI Chat (?prefill_pertanyaan=...): buka dialog Tambah begitu halaman siap dipakai.
  const prefillDipakai = useRef(false);
  useEffect(() => {
    if (!siapMuat || prefillDipakai.current || typeof window === 'undefined') return;
    prefillDipakai.current = true;
    const prefill = new URLSearchParams(window.location.search).get('prefill_pertanyaan');
    if (prefill) void Promise.resolve().then(() => setDialog({ jenis: 'tambah', pertanyaanAwal: prefill }));
  }, [siapMuat]);

  // Muat layanan (diulang saat layananMuatKe naik). Kegagalan tidak memblokir Front Office (hanya butuh FAQ umum);
  // untuk admin/petugas ditampilkan ErrorRetry (lihat layananGagalBlokir), bukan toast saja.
  useEffect(() => {
    let batal = false;
    async function loadLayanan() {
      try {
        const supabase = createClient();
        const { data, error: fetchErr } = await supabase
          .from('layanan')
          .select('id, nama, chatbot_aktif')
          .order('nama');
        if (fetchErr) throw fetchErr;
        if (!batal) {
          setLayananList(data || []);
          setLayananError(false);
        }
      } catch {
        if (!batal) {
          setLayananList([]);
          setLayananError(true);
        }
      } finally {
        if (!batal) {
          setLayananSelesai(true);
          setLayananMemuat(false);
        }
      }
    }
    loadLayanan();
    return () => {
      batal = true;
    };
  }, [layananMuatKe]);

  const handleMuatUlangLayanan = () => {
    if (layananMemuat) return;
    setLayananMemuat(true);
    setLayananMuatKe((n) => n + 1);
  };

  // RBAC Tahap 0: bot hidup/mati = Admin saja (tabel `layanan` hanya boleh ditulis Admin).
  // Role (+ layanan_id untuk petugas) dibaca dari tabel petugas; selama belum terbukti, semua jalur tulis ditolak.
  // Galat baca (jaringan/DB) dibedakan dari "memang tanpa akses": galat -> roleError (ErrorRetry), baris tak ada -> 'unknown'.
  useEffect(() => {
    let batal = false;
    async function loadRole() {
      try {
        const supabase = createClient();
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        // Tanpa sesi = tidak ada akses; galat lain (mis. jaringan) = gagal memuat, bukan tanpa akses.
        if (userErr && userErr.name !== 'AuthSessionMissingError') throw userErr;
        if (!user) {
          if (!batal) setRole('unknown');
          return;
        }
        const { data: p, error: pErr } = await supabase
          .from('petugas').select('role, layanan_id').eq('auth_user_id', user.id).maybeSingle();
        if (pErr) throw pErr;
        if (!batal) {
          setLayananPetugasId(p?.layanan_id ?? null);
          setRole(p?.role ?? 'unknown');
          setRoleError(false);
        }
      } catch {
        if (!batal) {
          setRoleError(true);
          toast('Gagal memuat hak akses Anda', 'error');
        }
      } finally {
        if (!batal) setRoleMemuat(false);
      }
    }
    loadRole();
    return () => {
      batal = true;
    };
  }, [roleMuatKe, toast]);

  const handleMuatUlangRole = () => {
    if (roleMemuat) return;
    setRoleMemuat(true);
    setRoleMuatKe((n) => n + 1);
  };

  // Muat daftar FAQ sesuai lingkup peran (admin: semua; petugas: layanannya; Front Office: FAQ umum, IS NULL
  // bukan eq karena `= NULL` tidak pernah cocok di SQL), terbaru diubah di atas. FAQ yang belum diproses bot
  // dimuat lewat kueri kedua yang ringan (hanya id) agar kolom vektor tidak ikut terbaca.
  useEffect(() => {
    if (!siapMuat) return;
    let batal = false;
    async function loadFAQs() {
      try {
        const supabase = createClient();
        const lingkupPetugas = isPetugas && layananPetugasId ? layananPetugasId : null;
        const [faq, menunggu] = await Promise.all([
          muatBertahap<FAQ>((dari, sampai) => {
            const dasar = supabase.from('faq_knowledge_base').select(KOLOM_FAQ);
            return (lingkupPetugas ? dasar.eq('layanan_id', lingkupPetugas) : isFrontOffice ? dasar.is('layanan_id', null) : dasar)
              .order('updated_at', { ascending: false }).order('id', { ascending: true }).range(dari, sampai);
          }),
          muatBertahap<{ id: string }>((dari, sampai) => {
            const dasar = supabase.from('faq_knowledge_base').select('id');
            return (lingkupPetugas ? dasar.eq('layanan_id', lingkupPetugas) : isFrontOffice ? dasar.is('layanan_id', null) : dasar)
              .or('embedding.is.null,perlu_embed_ulang.eq.true').order('id', { ascending: true }).range(dari, sampai);
          }).catch(() => []), // Kegagalan kueri kedua hanya menyembunyikan lencana; daftar tetap benar.
        ]);
        if (batal) return;
        setFaqList(faq);
        setMenungguIds(new Set(menunggu.map((r) => r.id)));
        setMuatGagal(false);
      } catch {
        if (!batal) {
          setFaqList([]);
          setMuatGagal(true);
        }
      } finally {
        if (!batal) setLoading(false);
      }
    }
    loadFAQs();
    return () => {
      batal = true;
    };
  }, [siapMuat, isPetugas, isFrontOffice, layananPetugasId, muatUlangKe]);

  const muatUlangDaftar = () => setMuatUlangKe((n) => n + 1);
  const handleMuatUlangDaftar = () => {
    setLoading(true);
    muatUlangDaftar();
  };

  // Pemrosesan bot (embedding) satu FAQ lewat route khusus: server memeriksa hak akses dan hanya memproses FAQ ini.
  // Kegagalan tidak membatalkan penyimpanan: FAQ tetap tersimpan dan lencana "Menunggu diproses bot" tampil.
  const prosesFaq = async (id: string, sesudahSimpan: boolean) => {
    setMemprosesIds((prev) => new Set(prev).add(id));
    const gagal = sesudahSimpan ? PESAN_PROSES_GAGAL_SESUDAH_SIMPAN : PESAN_PROSES_GAGAL;
    try {
      const res = await fetch('/api/admin/faq/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faqId: id }),
      });
      if (res.ok) {
        if (!sesudahSimpan) toast('FAQ diproses. Bot sudah bisa memakainya.', 'success');
      } else if (res.status === 409) {
        // Sudah diproses (mis. oleh Admin lebih dulu): tidak ada yang perlu dilaporkan.
      } else {
        const data = await res.json().catch(() => null);
        toast(res.status === 429 && data?.error ? data.error : gagal, 'error');
      }
    } catch {
      toast(gagal, 'error');
    } finally {
      setMemprosesIds((prev) => {
        const baru = new Set(prev);
        baru.delete(id);
        return baru;
      });
      muatUlangDaftar();
    }
  };

  // Cadangan Admin: proses semua FAQ yang menunggu (maks 50 per tekan).
  const handleProsesSekarang = async () => {
    if (!isAdmin || prosesMassal) return;
    setProsesMassal(true);
    try {
      const res = await fetch('/api/admin/faq/embed', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast(data?.error || 'Gagal memproses FAQ. Coba lagi beberapa saat lagi.', 'error');
        return;
      }
      const gagal = data?.failed ?? 0;
      toast(
        `${data?.embedded ?? 0} FAQ diproses.` +
          (gagal ? ` ${gagal} belum berhasil, coba lagi.` : '') +
          (data?.remaining ? ` ${data.remaining} masih menunggu.` : ''),
        gagal ? 'error' : 'success',
      );
    } catch {
      toast('Gagal memproses FAQ. Coba lagi beberapa saat lagi.', 'error');
    } finally {
      setProsesMassal(false);
      muatUlangDaftar();
    }
  };

  // Bot hidup/mati per layanan (Admin saja; dijaga di handler, bukan hanya di UI).
  const handleToggleBot = async (id: string, currentVal: boolean) => {
    if (!isAdmin || togglingBot) return;
    setTogglingBot(true);
    const supabase = createClient();
    try {
      const newVal = !currentVal;
      // RLS yang menolak update = 0 baris tanpa error -> mutasiWajibBaris melempar, tak ada sukses palsu.
      await mutasiWajibBaris(
        supabase.from('layanan').update({ chatbot_aktif: newVal }).eq('id', id).select('id'),
      );
      setLayananList((prev) => prev.map((l) => (l.id === id ? { ...l, chatbot_aktif: newVal } : l)));
      toast(newVal ? 'Bot layanan ini diaktifkan.' : 'Bot layanan ini dinonaktifkan.', 'success');
    } catch (e) {
      toast(`Gagal memperbarui status bot. ${pesanMutasi(e)}`, 'error');
    } finally {
      setTogglingBot(false);
    }
  };

  // Aktif/Nonaktif per FAQ lewat lencana status. Aturan akses sama dengan menyimpan FAQ (RLS menegakkannya).
  const handleToggleAktif = async (faq: FAQ) => {
    if (togglingId) return;
    setTogglingId(faq.id);
    const supabase = createClient();
    const baru = !faq.aktif;
    try {
      await mutasiWajibBaris(
        supabase.from('faq_knowledge_base').update({ aktif: baru, updated_at: new Date().toISOString() }).eq('id', faq.id).select('id'),
      );
      setFaqList((prev) => prev.map((f) => (f.id === faq.id ? { ...f, aktif: baru } : f)));
      toast(baru ? 'FAQ diaktifkan.' : 'FAQ dinonaktifkan.', 'success');
    } catch (err) {
      toast(pesanMutasi(err, 'Gagal mengubah status FAQ.'), 'error');
      if (perluMuatUlang(err)) muatUlangDaftar();
    } finally {
      setTogglingId(null);
    }
  };

  // Simpan dari dialog (tambah dan ubah). Mengembalikan pesan galat agar dialog tetap terbuka dengan isiannya.
  const simpanFaq = async (isian: IsianFaq): Promise<string | null> => {
    if (isPetugas && !acked) {
      try { sessionStorage.setItem(ACK_KEY, '1'); } catch { /* sesi privat: tanya lagi berikutnya */ }
      setAcked(true);
    }
    const supabase = createClient();
    const pertanyaan = isian.pertanyaan.trim();
    const jawaban = isian.jawaban.trim();
    const dasarHukum = isian.dasarHukum.trim() || null;
    try {
      let id: string | null;
      let perluProses: boolean;
      if (dialog?.jenis === 'ubah') {
        const faq = dialog.faq;
        const teksBerubah = pertanyaan !== faq.pertanyaan || jawaban !== faq.jawaban;
        // .select('id') + mutasiWajibBaris: RLS yang menolak update = 0 baris tanpa error.
        await mutasiWajibBaris(
          supabase
            .from('faq_knowledge_base')
            .update({
              pertanyaan,
              jawaban,
              dasar_hukum: dasarHukum,
              urutan: isian.urutan,
              // Teks berubah -> hasil pemrosesan lama tidak berlaku; kosongkan agar diproses ulang.
              ...(teksBerubah ? { embedding: null } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', faq.id)
            .select('id'),
        );
        id = faq.id;
        perluProses = teksBerubah;
      } else {
        // UMUM_KEY = FAQ umum (kolom layanan_id NULL).
        const baris = await mutasiInsert<{ id: string }>(
          supabase
            .from('faq_knowledge_base')
            .insert({
              layanan_id: isian.kunci === UMUM_KEY ? null : isian.kunci,
              pertanyaan,
              jawaban,
              dasar_hukum: dasarHukum,
              urutan: isian.urutan,
              aktif: true,
            })
            .select('id'),
        );
        id = baris[0]?.id ?? null;
        perluProses = true;
      }
      toast(dialog?.jenis === 'ubah' ? 'Perubahan disimpan.' : 'Pertanyaan ditambahkan.', 'success');
      setDialog(null);
      muatUlangDaftar();
      if (id && perluProses) void prosesFaq(id, true);
      return null;
    } catch (err) {
      // Isian dialog sengaja dipertahankan agar pengguna tidak kehilangan tulisannya.
      if (perluMuatUlang(err)) muatUlangDaftar();
      return pesanMutasi(err, 'Gagal menyimpan FAQ.');
    }
  };

  const hapusFaq = async (faq: FAQ): Promise<string | null> => {
    const supabase = createClient();
    try {
      // 0 baris terhapus (RLS menolak diam-diam / FAQ sudah tidak ada) = gagal, bukan sukses.
      await mutasiWajibBaris(supabase.from('faq_knowledge_base').delete().eq('id', faq.id).select('id'));
      toast('FAQ dihapus.', 'success');
      setDialog(null);
      muatUlangDaftar();
      return null;
    } catch (err) {
      if (perluMuatUlang(err)) muatUlangDaftar();
      return pesanMutasi(err, 'Gagal menghapus FAQ.');
    }
  };

  // Daftar tampil: pencarian + status + cakupan, di sisi klien (lingkup sudah dibatasi saat memuat).
  const tampil = useMemo(() => {
    const kata = cari.trim().toLowerCase();
    return faqList.filter((f) => {
      if (filterStatus === 'aktif' && !f.aktif) return false;
      if (filterStatus === 'nonaktif' && f.aktif) return false;
      if (filterCakupan === UMUM_KEY && f.layanan_id !== null) return false;
      if (filterCakupan && filterCakupan !== UMUM_KEY && f.layanan_id !== filterCakupan) return false;
      if (kata && !`${f.pertanyaan} ${f.jawaban}`.toLowerCase().includes(kata)) return false;
      return true;
    });
  }, [faqList, cari, filterStatus, filterCakupan]);
  const halamanAman = Math.min(halaman, Math.max(0, Math.ceil(tampil.length / UKURAN_HALAMAN) - 1));
  const halamanIni = tampil.slice(halamanAman * UKURAN_HALAMAN, (halamanAman + 1) * UKURAN_HALAMAN);
  const adaFilter = cari.trim() !== '' || filterStatus !== 'semua' || filterCakupan !== '';
  const resetFilter = () => {
    setCari('');
    setFilterStatus('semua');
    setFilterCakupan('');
    setHalaman(0);
  };

  const kunciAwalTambah = filterCakupan && opsiLayanan.some((o) => (o.id ?? UMUM_KEY) === filterCakupan)
    ? filterCakupan
    : opsiLayanan[0] ? (opsiLayanan[0].id ?? UMUM_KEY) : '';

  return (
    <>
      <PageHeader title="Kelola FAQ" />

      <div className={styles.faqPage}>
        <p className={styles.pembuka}>
          Saat pengunjung bertanya di Live Chat, bot mencari FAQ yang paling mirip dan menjawab dengan isinya.
          Tulis pertanyaan sebagaimana pengunjung biasa menanyakannya.
        </p>

        {roleError ? (
          <Galat
            judul="Hak akses Anda belum dapat dimuat"
            pesan="Peran akun Anda gagal dibaca sehingga halaman FAQ belum bisa dipakai. Ini bukan berarti Anda tidak punya akses."
            onRetry={handleMuatUlangRole}
            memuat={roleMemuat}
            labelTombol="Muat ulang"
          />
        ) : layananGagalBlokir ? (
          <Galat
            judul="Daftar layanan belum dapat dimuat"
            pesan="Layanan yang dapat dikelola FAQ-nya belum bisa ditampilkan. Periksa koneksi lalu muat ulang."
            onRetry={handleMuatUlangLayanan}
            memuat={layananMemuat}
            labelTombol="Muat ulang"
          />
        ) : tanpaAkses ? (
          <div data-testid="faq-tanpa-akses"><CatatanKeadaan jenis="lingkup">Tidak ada layanan yang dapat Anda kelola FAQ-nya. Hubungi Admin bila peran atau layanan Anda belum terdaftar.</CatatanKeadaan></div>
        ) : role === null ? (
          <div className={styles.kartu} role="status"><Skeleton bentuk="baris" jumlah={5} label="Memuat halaman FAQ…" /></div>
        ) : (
          <>
            {isPetugas && (
              <RoleNote>Anda dapat menonaktifkan FAQ yang keliru. Penghapusan permanen hanya oleh Admin.</RoleNote>
            )}
            {isFrontOffice && (
              <RoleNote>
                Anda mengelola FAQ umum yang berlaku untuk semua layanan. FAQ khusus tiap layanan dikelola Admin dan petugas layanan.
              </RoleNote>
            )}

            {tampilPanelBot && (
              <details className={`${styles.kartu} ${styles.panelBot}`}>
                <summary>Pengaturan bot</summary>
                <div className={styles.panelBotIsi}>
                  {isAdmin && opsiBot.length > 1 && (
                    <div className={`form-group ${styles.pilihLayananBot}`}>
                      <label className="form-label" htmlFor="botLayanan">Layanan</label>
                      <select
                        id="botLayanan"
                        className="form-select"
                        value={botLayananId ?? ''}
                        onChange={(e) => setBotPilih(e.target.value)}
                      >
                        {opsiBot.map((o) => (
                          <option key={o.id} value={o.id ?? ''}>{o.nama}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {botLayanan && (
                    <div className={styles.barisBot}>
                      <span className={styles.labelBot}>Bot {botLayanan.nama}</span>
                      {isAdmin ? (
                        <button
                          type="button"
                          className={`btn btn--sm ${botLayanan.chatbot_aktif ? 'btn--primary' : 'btn--secondary'}`}
                          onClick={() => handleToggleBot(botLayanan.id, botLayanan.chatbot_aktif)}
                          disabled={togglingBot}
                          aria-busy={togglingBot}
                          aria-label={`Bot ${botLayanan.nama}: ${botLayanan.chatbot_aktif ? 'Aktif' : 'Nonaktif'}. Klik untuk mengubah.`}
                        >
                          {botLayanan.chatbot_aktif ? 'Aktif' : 'Nonaktif'}
                        </button>
                      ) : (
                        <span
                          className={`badge ${botLayanan.chatbot_aktif ? 'badge--selesai' : 'badge--nonaktif'}`}
                          data-testid="bot-status"
                        >
                          {botLayanan.chatbot_aktif ? 'Aktif' : 'Nonaktif'}
                        </span>
                      )}
                    </div>
                  )}
                  {!isAdmin && (
                    <p role="note" className={styles.keteranganBot}>
                      Pengaturan bot dikelola Admin. Untuk menangani satu percakapan gunakan tombol Ambil alih di Live Chat.
                    </p>
                  )}
                  <p className={styles.keteranganBot}>
                    Bot Aktif: pesan pengunjung di layanan ini dijawab bot. Bot Nonaktif: chat langsung diteruskan ke petugas loket.
                  </p>
                  {isAdmin && (
                    <div className={styles.barisBot}>
                      <span className={styles.labelBot}>
                        {menungguIds.size > 0
                          ? `${menungguIds.size} FAQ menunggu diproses bot.`
                          : 'Semua FAQ sudah diproses bot.'}
                      </span>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={handleProsesSekarang}
                        disabled={prosesMassal || loading}
                        aria-busy={prosesMassal}
                      >
                        {prosesMassal ? (
                          <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Memproses…</>
                        ) : (
                          <><Sparkles size={14} aria-hidden="true" /> Proses sekarang</>
                        )}
                      </button>
                    </div>
                  )}
                  {botLayanan && <CobaTanyaBot layananId={botLayanan.id} layananNama={botLayanan.nama} />}
                </div>
              </details>
            )}

            <div className={styles.alat}>
              <div className={`form-group ${styles.alatCari}`}>
                <label className="form-label" htmlFor="cariFaq">Cari FAQ</label>
                <div className={styles.cariWadah}>
                  <Search
                    size={16}
                    aria-hidden="true"
                    className={styles.cariIkon}
                  />
                  <input
                    id="cariFaq"
                    type="search"
                    className={`form-input ${styles.cariInput}`}
                    placeholder="Ketik kata dari pertanyaan atau jawaban"
                    value={cari}
                    onChange={(e) => { setCari(e.target.value); setHalaman(0); }}
                  />
                </div>
              </div>
              {opsiLayanan.length > 1 && (
                <div className={`form-group ${styles.alatCakupan}`}>
                  <label className="form-label" htmlFor="cakupanFaq">Untuk</label>
                  <select
                    id="cakupanFaq"
                    className="form-select"
                    value={filterCakupan}
                    onChange={(e) => { setFilterCakupan(e.target.value); setHalaman(0); }}
                  >
                    <option value="">Semua FAQ</option>
                    {opsiLayanan.map((o) => (
                      <option key={o.id ?? UMUM_KEY} value={o.id ?? UMUM_KEY}>
                        {o.id === null ? 'FAQ umum (semua layanan)' : o.nama}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group">
                <span className="form-label" id="statusFaqLabel">Status</span>
                <div className={styles.kelompokStatus} role="group" aria-labelledby="statusFaqLabel">
                  {FILTER_STATUS.map((s) => (
                    <button
                      key={s.nilai}
                      type="button"
                      className={`btn btn--sm ${filterStatus === s.nilai ? 'btn--primary' : 'btn--secondary'}`}
                      aria-pressed={filterStatus === s.nilai}
                      onClick={() => { setFilterStatus(s.nilai); setHalaman(0); }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className={`btn btn--primary ${styles.alatTambah}`}
                onClick={() => setDialog({ jenis: 'tambah' })}
              >
                <Plus size={16} aria-hidden="true" /> Tambah pertanyaan
              </button>
            </div>

            <div className={styles.kartu}>
              {loading ? (
                <div className={styles.memuat} role="status"><Skeleton bentuk="baris" jumlah={5} label="Memuat daftar FAQ…" /></div>
              ) : muatGagal ? (
                <Galat
                  judul="Daftar FAQ belum dapat dimuat"
                  pesan="Daftar FAQ gagal dimuat. Periksa koneksi lalu coba lagi."
                  onRetry={handleMuatUlangDaftar}
                  labelTombol="Coba lagi"
                />
              ) : faqList.length === 0 ? (
                <StatusKosong ikon={HelpCircle} judul={isFrontOffice ? 'Belum ada FAQ umum.' : 'Belum ada FAQ. Tambahkan pertanyaan pertama.'} />
              ) : tampil.length === 0 ? (
                <div className={styles.kosong}>
                  <StatusKosong ikon={Search} judul="Tidak ada FAQ yang cocok dengan pencarian atau filter." />
                  {adaFilter && (
                    <button type="button" className="btn btn--secondary btn--sm" onClick={resetFilter}>
                      Hapus pencarian dan filter
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <ul className={styles.daftar} aria-label="Daftar FAQ">
                    {halamanIni.map((faq) => {
                      const menunggu = menungguIds.has(faq.id);
                      const memproses = memprosesIds.has(faq.id);
                      return (
                        <li key={faq.id} className={styles.butir}>
                          <div className={styles.butirAtas}>
                            <div className={styles.butirTeks}>
                              <h3 className={styles.pertanyaan}>{faq.pertanyaan}</h3>
                              <p className={styles.jawaban}>{faq.jawaban}</p>
                              {faq.dasar_hukum && <p className={styles.dasarHukum}>Dasar hukum: {faq.dasar_hukum}</p>}
                            </div>
                            <div className={styles.aksi}>
                              <button
                                type="button"
                                aria-label={`Ubah FAQ: ${faq.pertanyaan}`}
                                className="btn btn--secondary btn--sm"
                                onClick={() => setDialog({ jenis: 'ubah', faq })}
                              >
                                <Edit2 size={14} aria-hidden="true" /> Ubah
                              </button>
                              {!isPetugas && (
                                <Tombol
                                  varian="bahaya"
                                  ukuran="kecil"
                                  ikon={Trash2}
                                  aria-label={`Hapus FAQ: ${faq.pertanyaan}`}
                                  onClick={() => setDialog({ jenis: 'hapus', faq })}
                                >
                                  Hapus
                                </Tombol>
                              )}
                            </div>
                          </div>
                          <div className={styles.meta}>
                            <span className={styles.cakupan}>
                              {faq.layanan_id === null ? 'Semua layanan' : (namaLayanan.get(faq.layanan_id) ?? 'Layanan')}
                            </span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={faq.aktif}
                              aria-label={`Status FAQ: ${faq.pertanyaan}`}
                              className={`badge ${styles.saklar} ${faq.aktif ? 'badge--published' : 'badge--nonaktif'}`}
                              onClick={() => handleToggleAktif(faq)}
                              disabled={togglingId === faq.id}
                              title={faq.aktif ? 'Klik untuk menonaktifkan' : 'Klik untuk mengaktifkan'}
                            >
                              {faq.aktif ? 'Aktif' : 'Nonaktif'}
                            </button>
                            {menunggu && (
                              <>
                                <span className="badge badge--pending">
                                  {memproses ? 'Sedang diproses bot…' : 'Menunggu diproses bot'}
                                </span>
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  aria-label={`Coba proses lagi FAQ: ${faq.pertanyaan}`}
                                  onClick={() => prosesFaq(faq.id, false)}
                                  disabled={memproses}
                                  aria-busy={memproses}
                                >
                                  <RefreshCw size={12} aria-hidden="true" /> Coba lagi
                                </button>
                              </>
                            )}
                            {faq.updated_at && <span>Diubah {formatTanggal(faq.updated_at)}</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <Pagination
                    page={halamanAman}
                    pageSize={UKURAN_HALAMAN}
                    total={tampil.length}
                    onPageChange={setHalaman}
                  />
                </>
              )}
            </div>
            {!loading && !muatGagal && faqList.length > 0 && (
              <p className={styles.ringkasan} aria-live="polite">
                {tampil.length === faqList.length
                  ? `${faqList.length} FAQ`
                  : `${tampil.length} dari ${faqList.length} FAQ`}
              </p>
            )}
          </>
        )}
      </div>

      {dialog && dialog.jenis !== 'hapus' && (
        <FaqFormDialog
          key={dialog.jenis === 'ubah' ? dialog.faq.id : 'tambah'}
          faq={dialog.jenis === 'ubah' ? dialog.faq : null}
          opsi={opsiLayanan}
          kunciAwal={kunciAwalTambah}
          pertanyaanAwal={dialog.jenis === 'tambah' ? dialog.pertanyaanAwal : undefined}
          urutanAwal={faqList.length + 1}
          perluPernyataan={isPetugas && !acked}
          onClose={() => setDialog(null)}
          onSimpan={simpanFaq}
        />
      )}
      {dialog?.jenis === 'hapus' && (
        <HapusFaqDialog
          faq={dialog.faq}
          onClose={() => setDialog(null)}
          onHapus={() => hapusFaq(dialog.faq)}
        />
      )}
    </>
  );
}
