'use client';

import { useState, useEffect, useRef, useCallback, useId } from 'react';
import {
  Save,
  CheckCircle2,
  FileText,
  Building2,
  User,
  Phone,
  Mail,
  Lock,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import KerangkaModal from '@/components/ui/KerangkaModal';
import Tombol from '@/components/ui/Tombol';
import Lencana from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';
import styles from './PelayananWizardModal.module.css';
import { useTopikLayanan } from '@/components/admin/TopikCatatanFields';
import {
  SKALA_USAHA_OPTIONS,
  TIPE_PELAKU_USAHA_OPTIONS,
  TIPE_PELAKU_USAHA_LABELS,
  STATUS_PENANAMAN_MODAL_OPTIONS,
  STATUS_PENANAMAN_MODAL_LABELS,
  TINDAK_LANJUT_OSS_OPTIONS,
  OPD_TEKNIS_OPTIONS,
  TINDAK_LANJUT_PERIZINAN_OPTIONS,
  NILAI_BELUM_ADA,
  NILAI_TIDAK_BERLAKU,
  NILAI_CATATAN_KOSONG,
  ossPelayananFinalSchema,
  perizinanPelayananFinalSchema,
  PelayananInitialData,
  FormPelayananType,
} from '@/lib/types/pelayanan';

interface PelayananWizardModalProps {
  isOpen: boolean;
  tiketId: string | null;
  onClose: () => void;
  onSuccess?: () => void;
  /** Server menolak karena kepemilikan/status tiket berubah (403/409): daftar antrean sebaiknya dimuat ulang. */
  onDataBasi?: () => void | Promise<void>;
}

// Langkah wizard tempat sebuah field berada (untuk memindahkan ke langkah yang galat saat validasi).
const LANGKAH_FIELD: Record<string, 1 | 2 | 3> = {
  nama_pemohon: 1,
  alamat_pemohon: 1,
  no_hp: 1,
  email: 1,
  keperluan_awal: 1,
  nama_usaha: 2,
  tipe_pelaku_usaha: 2,
  status_penanaman_modal: 2,
  lokasi_usaha: 2,
  skala_usaha: 2,
  sektor_usaha_kbli: 2,
  nama_perusahaan: 2,
  opd_teknis: 2,
  uraian_permohonan: 2,
  uraian_solusi: 3,
  tindak_lanjut: 3,
  catatan_internal: 3,
  catatan_petugas: 3,
};


// Kepemilikan tiket (migrasi 202610140002): hanya pemilik tiket yang sedang 'dilayani' (initialData.boleh_ubah)
// yang boleh menyimpan draf dan menyelesaikan. Selain itu wizard BACA-SAJA (tanpa autosave, tanpa tombol simpan).
// Tiket HASIL ESKALASI Front Office: Pendataan lengkap (keputusan CEO 2026-10-15, migrasi 202610140015) + PILIHAN TOPIK
// di langkah selesai (Fase 4, spec §7 Q46; menggantikan "tanpa topik" 2026-10-15). Catatan penanganan tetap tidak ditanyakan:
// DB menurunkan catatan tahap layanan dari Pendataan. Topik wajib di UI bila Layanan punya topik aktif (DB tetap opsional,
// kontrak 202610140015); data lama tanpa topik tampil "(tidak tercatat)" di rekap.
// Aksesibilitas (audit T8): setiap field berlabel terhubung, dialog role=dialog aria-modal, Escape menutup (dengan
// konfirmasi bila ada perubahan belum tersimpan), focus trap, fokus kembali ke pemicu, galat role=alert.
export default function PelayananWizardModal({
  isOpen,
  tiketId,
  onClose,
  onSuccess,
  onDataBasi,
}: PelayananWizardModalProps) {
  const { toast } = useToast();
  const uid = useId();
  const id = (nama: string) => `${uid}-${nama}`;
  const tombolLanjutRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(true);
  const [initialData, setInitialData] = useState<PelayananInitialData | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [savingDraft, setSavingDraft] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  // Ada isian yang belum tersimpan sebagai draf (autosave tertunda / gagal) -> Escape meminta konfirmasi.
  const [adaPerubahan, setAdaPerubahan] = useState(false);
  const [konfirmasiTutup, setKonfirmasiTutup] = useState(false);
  // Menutup dialog sedang menunggu hasil simpan draf (C3-10): kunci tombol tutup agar tidak ganda.
  const [menutup, setMenutup] = useState(false);
  // Autosave latar gagal (jaringan / server): tampilkan di status agar isian yang belum tersimpan tidak hilang diam-diam.
  const [gagalSimpan, setGagalSimpan] = useState(false);

  // Form State — Prapopulasi / Umum
  const [namaPemohon, setNamaPemohon] = useState('');
  const [alamatPemohon, setAlamatPemohon] = useState('');
  const [noHp, setNoHp] = useState('');
  const [email, setEmail] = useState('');
  const [keperluanAwal, setKeperluanAwal] = useState('');

  // Form State — Helpdesk OSS (Dengan 3 field opsional baru)
  const [namaUsaha, setNamaUsaha] = useState('');
  const [tipePelakuUsaha, setTipePelakuUsaha] = useState<string>('');
  const [statusPenanamanModal, setStatusPenanamanModal] = useState<string>('');
  const [lokasiUsaha, setLokasiUsaha] = useState('');
  const [skalaUsaha, setSkalaUsaha] = useState<string>('');
  const [sektorUsahaKbli, setSektorUsahaKbli] = useState('');
  const [tindakLanjutOss, setTindakLanjutOss] = useState<string>('');
  const [uraianSolusi, setUraianSolusi] = useState('');
  const [catatanInternal, setCatatanInternal] = useState('');

  // Form State — Perizinan DPMPTSP
  const [namaPerusahaan, setNamaPerusahaan] = useState('');
  const [opdTeknis, setOpdTeknis] = useState<string>('');
  const [uraianPermohonan, setUraianPermohonan] = useState('');
  const [tindakLanjutPerizinan, setTindakLanjutPerizinan] = useState<string>('');
  const [catatanPetugas, setCatatanPetugas] = useState('');
  const [lokasiUsahaPerizinan, setLokasiUsahaPerizinan] = useState('');

  // Server menolak tulis (bukan pemilik / status berubah) setelah wizard dibuka -> kunci formulir.
  const [ditolakServer, setDitolakServer] = useState(false);

  // Topik penanganan (langkah 3). Daftar kosong / gagal dimuat = pilihan topik tidak ditampilkan dan tidak wajib.
  const [topikId, setTopikId] = useState('');
  const { topik: daftarTopik } = useTopikLayanan(initialData?.layanan_id ?? null, isOpen && !!initialData);

  const isLocked = initialData?.is_locked ?? false;
  const bacaSaja = isLocked || ditolakServer || !(initialData?.boleh_ubah ?? false);
  const bukanPemilik = !isLocked && !!initialData && initialData.status_tiket === 'dilayani' && !initialData.boleh_ubah;
  // Fase 3: pemegang lama setelah diambil alih Koordinator boleh menyunting draf, tetapi tidak menyelesaikan.
  const hanyaSuntingDraf = !bacaSaja && initialData?.boleh_selesaikan === false;
  const formType: FormPelayananType | null = initialData?.form_type ?? null;
  const autosaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Versi isian: naik tiap perubahan; `tersimpanVersiRef` = versi terakhir yang sudah diterima server.
  // "Belum tersimpan" = keduanya berbeda (bukan sekadar ada simpan yang selesai: ketikan susulan tidak boleh terhapus).
  const versiRef = useRef(0);
  const tersimpanVersiRef = useRef(0);
  // PATCH diserialkan (satu per satu) agar respons yang datang terlambat tidak menimpa draf yang lebih baru.
  const antrianSimpanRef = useRef<Promise<unknown>>(Promise.resolve());
  // Selalu menunjuk simpanDraf dari render terbaru: timer debounce memegang ref ini, bukan closure lama (C3-09).
  const simpanTerbaruRef = useRef<(opsi?: { senyap?: boolean }) => Promise<boolean>>(async () => true);
  const menutupRef = useRef(false);
  // Generasi pembukaan: naik tiap isOpen/tiketId berubah. Hasil simpan dari generasi lama (tiket A yang sudah ditutup)
  // tidak boleh mengubah ref/status milik tiket B (R3): modal ini tetap terpasang di induk tanpa `key`.
  const generasiRef = useRef(0);

  const batalkanTimerSimpan = useCallback(() => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
  }, []);

  // Bersihkan autosave tertunda saat komponen unmount agar tidak ada PATCH
  // liar terpicu setelah modal ditutup / komponen dibongkar.
  useEffect(() => batalkanTimerSimpan, [batalkanTimerSimpan]);

  useEffect(() => {
    generasiRef.current += 1;
    versiRef.current = 0;
    tersimpanVersiRef.current = 0;
  }, [isOpen, tiketId]);

  // Komponen tetap terpasang saat isOpen=false (return null): timer juga harus berhenti di sini (F-01).
  useEffect(() => {
    if (!isOpen) batalkanTimerSimpan();
  }, [isOpen, batalkanTimerSimpan]);

  // 1. Fetch data saat modal dibuka
  const loadData = useCallback(
    async (idTiket: string, isCurrent: () => boolean) => {
      try {
        setLoading(true);
        setValidationErrors({});
        setDitolakServer(false);
        setAdaPerubahan(false);
        setGagalSimpan(false);
        setSavingDraft(false);
        setKonfirmasiTutup(false);
        versiRef.current = 0;
        tersimpanVersiRef.current = 0;
        const res = await fetch(`/api/admin/pelayanan/${idTiket}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Gagal memuat data pelayanan');
        }
        const data: PelayananInitialData = await res.json();
        if (!isCurrent()) return;

        setInitialData(data);

        // Prapopulasi data identitas
        setNamaPemohon(data.nama_pemohon || '');
        setAlamatPemohon(data.alamat_pemohon || '');
        setNoHp(data.no_hp || '');
        setEmail(data.email || '');
        setKeperluanAwal(data.keperluan_awal || '');

        // Reset semua field form-type-specific terlebih dahulu agar tidak ada
        // sisa data dari tiket sebelumnya (stale state) saat pengunjung baru
        // belum memiliki data OSS / Perizinan.
        setNamaUsaha('');
        setTipePelakuUsaha('');
        setStatusPenanamanModal('');
        setLokasiUsaha('');
        setSkalaUsaha('');
        setSektorUsahaKbli('');
        setTindakLanjutOss('');
        setUraianSolusi('');
        setCatatanInternal('');
        setNamaPerusahaan('');
        setOpdTeknis('');
        setUraianPermohonan('');
        setTindakLanjutPerizinan('');
        setCatatanPetugas('');
        setLokasiUsahaPerizinan('');

        // Prapopulasi form OSS (hanya jika data sudah ada)
        if (data.form_type === 'oss' && data.data_oss) {
          setNamaUsaha(data.data_oss.nama_usaha || '');
          setTipePelakuUsaha(data.data_oss.tipe_pelaku_usaha || '');
          setStatusPenanamanModal(data.data_oss.status_penanaman_modal || '');
          setLokasiUsaha(data.data_oss.lokasi_usaha || '');
          setSkalaUsaha(data.data_oss.skala_usaha || '');
          setSektorUsahaKbli(data.data_oss.sektor_usaha_kbli || '');
          setTindakLanjutOss(data.data_oss.tindak_lanjut || '');
          setUraianSolusi(data.data_oss.uraian_solusi || '');
          setCatatanInternal(data.data_oss.catatan_internal || '');
        }

        // Prapopulasi form Perizinan (hanya jika data sudah ada)
        if (data.form_type === 'perizinan' && data.data_perizinan) {
          setNamaPerusahaan(data.data_perizinan.nama_perusahaan || '');
          setOpdTeknis(data.data_perizinan.opd_teknis || '');
          setUraianPermohonan(data.data_perizinan.uraian_permohonan || '');
          setTindakLanjutPerizinan(data.data_perizinan.tindak_lanjut || '');
          setCatatanPetugas(data.data_perizinan.catatan_petugas || '');
          setLokasiUsahaPerizinan(data.data_perizinan.lokasi_usaha || '');
        }

        setStep(1);
      } catch (e) {
        if (!isCurrent()) return;
        // Jangan auto-close pada error: tampilkan pesan agar user tahu kenapa
        // wizard gagal load, dan bisa menutup sendiri atau retry.
        toast(e instanceof Error ? e.message : 'Gagal memuat data', 'error');
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    },
    [toast]
  );

  useEffect(() => {
    let active = true;
    if (isOpen && tiketId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadData(tiketId, () => active);
    }
    return () => {
      active = false;
    };
  }, [isOpen, tiketId, loadData]);

  // Penolakan kepemilikan/status dari server (403 BUKAN_PEMILIK/FORBIDDEN, 409 SUDAH_DIAMBIL/INVALID_STATUS,
  // 401 SESI_TIDAK_SAH): tampilkan pesan, kunci formulir, minta daftar dimuat ulang. true = sudah ditangani.
  const tanganiPenolakan = useCallback(
    (status: number, pesan: unknown): boolean => {
      if (status !== 401 && status !== 403 && status !== 409) return false;
      toast(typeof pesan === 'string' && pesan ? pesan : 'Perubahan ditolak server. Muat ulang daftar antrean.', 'error');
      if (status !== 401) {
        setDitolakServer(true);
        void onDataBasi?.();
      }
      return true;
    },
    [toast, onDataBasi],
  );

  // 2. Simpan draf. Mengembalikan true bila tidak ada yang perlu disimpan atau server menerima; false bila gagal/ditolak.
  // `senyap`: autosave latar (galat ditandai di status, tanpa toast tiap detik); aksi eksplisit (Simpan/Tutup) memberi toast.
  const simpanDraf = useCallback(async (opsi?: { senyap?: boolean }): Promise<boolean> => {
    if (!tiketId || bacaSaja || !formType) return true;
    const senyap = opsi?.senyap ?? false;
    const versiKirim = versiRef.current;
    const generasi = generasiRef.current;
    const basi = () => generasi !== generasiRef.current;
    const payload =
        formType === 'oss'
          ? {
              nama_pemohon: namaPemohon,
              alamat_pemohon: alamatPemohon,
              no_hp: noHp,
              email: email,
              keperluan_awal: keperluanAwal,
              nama_usaha: namaUsaha,
              tipe_pelaku_usaha: tipePelakuUsaha || null,
              status_penanaman_modal: statusPenanamanModal || null,
              lokasi_usaha: lokasiUsaha || null,
              skala_usaha: skalaUsaha || null,
              sektor_usaha_kbli: sektorUsahaKbli,
              tindak_lanjut: tindakLanjutOss,
              uraian_solusi: uraianSolusi,
              catatan_internal: catatanInternal,
            }
          : {
              nama_pemohon: namaPemohon,
              alamat_pemohon: alamatPemohon,
              no_hp: noHp,
              email: email,
              keperluan_awal: keperluanAwal,
              nama_perusahaan: namaPerusahaan,
              opd_teknis: opdTeknis,
              uraian_permohonan: uraianPermohonan,
              tindak_lanjut: tindakLanjutPerizinan,
              catatan_petugas: catatanPetugas,
              lokasi_usaha: lokasiUsahaPerizinan || null,
            };

    const kerja = async (): Promise<boolean> => {
      // Tiket sudah ditutup/diganti sejak simpan ini diantre: draf lama sengaja dilepas, jangan kirim.
      if (basi()) return true;
      try {
        setSavingDraft(true);
        const res = await fetch(`/api/admin/pelayanan/${tiketId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        // Respons milik generasi lama: jangan mengakui/menolak apa pun atas nama tiket yang sedang terbuka.
        if (basi()) return true;
        if (res.ok) {
          const d = new Date();
          setLastSavedTime(
            d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' })
          );
          tersimpanVersiRef.current = Math.max(tersimpanVersiRef.current, versiKirim);
          setGagalSimpan(false);
          // Masih ada ketikan sesudah payload ini dikirim -> tetap "belum tersimpan".
          if (versiRef.current === versiKirim) setAdaPerubahan(false);
          return true;
        }
        const err = await res.json().catch(() => ({}));
        const pesan = (err as { error?: unknown }).error;
        if (tanganiPenolakan(res.status, pesan)) return false;
        setGagalSimpan(true);
        if (!senyap) toast('Draf belum tersimpan: server gagal memprosesnya. Coba lagi.', 'error');
        return false;
      } catch {
        if (basi()) return true;
        setGagalSimpan(true);
        if (!senyap) toast('Draf belum tersimpan: koneksi terputus. Isian masih ada di layar, coba lagi.', 'error');
        return false;
      } finally {
        if (!basi()) setSavingDraft(false);
      }
    };
    const hasil = antrianSimpanRef.current.then(kerja);
    antrianSimpanRef.current = hasil;
    return hasil;
  }, [
    toast,
    tiketId,
    bacaSaja,
    tanganiPenolakan,
    formType,
    namaPemohon,
    alamatPemohon,
    noHp,
    email,
    keperluanAwal,
    namaUsaha,
    tipePelakuUsaha,
    statusPenanamanModal,
    lokasiUsaha,
    skalaUsaha,
    sektorUsahaKbli,
    tindakLanjutOss,
    uraianSolusi,
    catatanInternal,
    namaPerusahaan,
    opdTeknis,
    uraianPermohonan,
    tindakLanjutPerizinan,
    catatanPetugas,
    lokasiUsahaPerizinan,
  ]);

  useEffect(() => {
    simpanTerbaruRef.current = simpanDraf;
  });

  // Jadwalkan simpan 1 dtk lagi. Timer memanggil simpanDraf dari render TERBARU (lewat ref), sehingga nilai yang
  // baru saja diketik (state belum dirender saat onChange memanggil ini) ikut payload.
  const jadwalkanSimpan = useCallback(() => {
    batalkanTimerSimpan();
    autosaveTimeoutRef.current = setTimeout(() => {
      autosaveTimeoutRef.current = null;
      void simpanTerbaruRef.current({ senyap: true });
    }, 1000);
  }, [batalkanTimerSimpan]);

  const triggerAutosave = useCallback(() => {
    if (bacaSaja || loading) return;
    versiRef.current += 1;
    setAdaPerubahan(true);
    // Sedang menutup: tutupDenganSimpan yang menyimpan versi terbaru, jangan jadwalkan timer lagi (R2).
    if (!menutupRef.current) jadwalkanSimpan();
  }, [bacaSaja, loading, jadwalkanSimpan]);

  // Semua jalur tutup memakai ini: timer tertunda dibatalkan dulu supaya tidak ada PATCH basi sesudah dialog tutup.
  const tutupTanpaSimpan = () => {
    batalkanTimerSimpan();
    onClose();
  };

  // Escape: tutup langsung bila tak ada yang hilang; bila ada perubahan belum tersimpan, minta konfirmasi dulu.
  const perubahanBelumTersimpan = !bacaSaja && adaPerubahan;
  const tanganiEscape = () => {
    if (finalizing || menutupRef.current) return;
    if (konfirmasiTutup) {
      setKonfirmasiTutup(false);
      return;
    }
    if (perubahanBelumTersimpan) {
      setKonfirmasiTutup(true);
      return;
    }
    tutupTanpaSimpan();
  };

  // Saat konfirmasi tutup muncul, fokus ke pilihan aman ("Lanjut mengisi").
  useEffect(() => {
    if (konfirmasiTutup) tombolLanjutRef.current?.focus();
  }, [konfirmasiTutup]);

  // 3. Finalize / Selesaikan Pelayanan
  const handleFinalize = async () => {
    if (!tiketId || !formType || bacaSaja || hanyaSuntingDraf || finalizing) return;
    setValidationErrors({});
    const errors: Record<string, string> = {};

    // Validasi Client-Side: SEMUA field wajib (skema Zod yang sama dengan server; keputusan CEO G.5).
    const isiMentah =
      formType === 'oss'
        ? {
            nama_pemohon: namaPemohon,
            alamat_pemohon: alamatPemohon,
            no_hp: noHp,
            email,
            keperluan_awal: keperluanAwal,
            nama_usaha: namaUsaha,
            tipe_pelaku_usaha: tipePelakuUsaha,
            status_penanaman_modal: statusPenanamanModal,
            lokasi_usaha: lokasiUsaha,
            skala_usaha: skalaUsaha,
            sektor_usaha_kbli: sektorUsahaKbli,
            tindak_lanjut: tindakLanjutOss,
            uraian_solusi: uraianSolusi,
            catatan_internal: catatanInternal,
          }
        : {
            nama_pemohon: namaPemohon,
            alamat_pemohon: alamatPemohon,
            no_hp: noHp,
            email,
            keperluan_awal: keperluanAwal,
            nama_perusahaan: namaPerusahaan,
            lokasi_usaha: lokasiUsahaPerizinan,
            opd_teknis: opdTeknis,
            uraian_permohonan: uraianPermohonan,
            tindak_lanjut: tindakLanjutPerizinan,
            catatan_petugas: catatanPetugas,
          };
    const hasilForm = (formType === 'oss' ? ossPelayananFinalSchema : perizinanPelayananFinalSchema).safeParse(isiMentah);
    if (!hasilForm.success) {
      for (const isu of hasilForm.error.issues) {
        const kunci = String(isu.path[0] ?? '');
        if (kunci && !errors[kunci]) errors[kunci] = isu.message;
      }
    }
    if (daftarTopik.length > 0 && !topikId) errors.topik_id = 'Topik penanganan wajib dipilih.';
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      // Pindah ke langkah pertama yang berisi galat agar pesannya terlihat.
      const langkah = Math.min(...Object.keys(errors).map((k) => LANGKAH_FIELD[k] ?? 3)) as 1 | 2 | 3;
      setStep(langkah);
      toast('Lengkapi seluruh field wajib bertanda bintang (*)', 'error');
      return;
    }

    try {
      setFinalizing(true);
      // Draf tertunda tak lagi dibutuhkan (POST membawa seluruh isian) dan tidak boleh mendarat sesudah data dikunci:
      // batalkan timer dan tunggu PATCH yang sudah terbang selesai sebelum POST.
      batalkanTimerSimpan();
      await antrianSimpanRef.current;
      // Lolos validasi di atas: hasilForm.success true (semua field terisi, sudah di-trim).
      const isiForm = hasilForm.success ? hasilForm.data : isiMentah;
      // Topik dikirim bila dipilih (Fase 4). Catatan penanganan TIDAK dikirim: DB menurunkannya dari Pendataan
      // (migrasi 202610140015: tindak lanjut + uraian solusi / catatan petugas).

      const res = await fetch(`/api/admin/pelayanan/${tiketId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(topikId ? { ...isiForm, topik_id: topikId } : isiForm),
      });

      const result = await res.json();
      if (!res.ok) {
        if (versiRef.current !== tersimpanVersiRef.current) jadwalkanSimpan();
        if (tanganiPenolakan(res.status, result.error)) return;
        throw new Error(result.error || 'Gagal menyelesaikan pelayanan');
      }

      toast('Pelayanan selesai & data berhasil dikunci', 'success');
      onSuccess?.();
      tutupTanpaSimpan();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menyelesaikan pelayanan', 'error');
      // Selesai gagal: isian yang belum sempat tersimpan dijadwalkan lagi.
      if (versiRef.current !== tersimpanVersiRef.current) jadwalkanSimpan();
    } finally {
      setFinalizing(false);
    }
  };

  if (!isOpen) return null;

  // Galat field: pesan role=alert, dirujuk aria-describedby pada field-nya.
  const galat = (kunci: string) =>
    validationErrors[kunci] ? (
      <p id={id(`${kunci}-galat`)} role="alert" className={cn('form-error', styles.galatField)}>
        {validationErrors[kunci]}
      </p>
    ) : null;
  const atributGalat = (kunci: string) =>
    validationErrors[kunci]
      ? ({ 'aria-invalid': true, 'aria-describedby': id(`${kunci}-galat`) } as const)
      : ({} as const);

  // Pendataan: SEMUA field wajib (keputusan CEO G.5). Field yang memang tidak ada diisi eksplisit lewat "isian cepat"
  // (Belum ada / Tidak berlaku; "-" untuk catatan) atau opsi "Tidak berlaku" pada pilihan, bukan dikosongkan.
  type IsianCepat = { label: string; nilai: string };
  const CEPAT_TIDAK_BERLAKU: IsianCepat[] = [{ label: NILAI_TIDAK_BERLAKU, nilai: NILAI_TIDAK_BERLAKU }];
  const CEPAT_USAHA: IsianCepat[] = [
    { label: NILAI_BELUM_ADA, nilai: NILAI_BELUM_ADA },
    { label: NILAI_TIDAK_BERLAKU, nilai: NILAI_TIDAK_BERLAKU },
  ];
  const CEPAT_CATATAN: IsianCepat[] = [{ label: 'Tidak ada catatan', nilai: NILAI_CATATAN_KOSONG }];

  const tombolCepat = (slug: string, cepat: IsianCepat[] | undefined, set: (v: string) => void) =>
    !bacaSaja && cepat && cepat.length > 0 ? (
      <div className={styles.cepat}>
        {cepat.map((c) => (
          <Tombol
            key={c.label}
            varian="hantu"
            ukuran="kecil"
            className={styles.cepatTombol}
            disabled={menutup}
            aria-describedby={id(`${slug}-label`)}
            onClick={() => {
              set(c.nilai);
              triggerAutosave();
            }}
          >
            {c.label}
          </Tombol>
        ))}
      </div>
    ) : null;

  const medanTeks = (o: {
    kunci: string;
    slug: string;
    label: string;
    nilai: string;
    set: (v: string) => void;
    tipe?: 'text' | 'email' | 'tel';
    placeholder?: string;
    rows?: number;
    daftar?: string;
    ikon?: React.ReactNode;
    cepat?: IsianCepat[];
  }) => (
    <div className="form-group">
      <label id={id(`${o.slug}-label`)} htmlFor={id(o.slug)} className="form-label form-label--required">
        {o.ikon}
        {o.label}
      </label>
      {o.rows ? (
        <textarea
          id={id(o.slug)}
          className="form-textarea"
          rows={o.rows}
          value={o.nilai}
          disabled={bacaSaja || menutup}
          aria-required="true"
          {...atributGalat(o.kunci)}
          onChange={(e) => {
            o.set(e.target.value);
            triggerAutosave();
          }}
          placeholder={o.placeholder}
        />
      ) : (
        <input
          id={id(o.slug)}
          type={o.tipe ?? 'text'}
          list={o.daftar}
          className="form-input"
          value={o.nilai}
          disabled={bacaSaja || menutup}
          aria-required="true"
          {...atributGalat(o.kunci)}
          onChange={(e) => {
            o.set(e.target.value);
            triggerAutosave();
          }}
          placeholder={o.placeholder}
        />
      )}
      {tombolCepat(o.slug, o.cepat, o.set)}
      {galat(o.kunci)}
    </div>
  );

  const medanPilihan = (o: {
    kunci: string;
    slug: string;
    label: string;
    nilai: string;
    set: (v: string) => void;
    opsi: readonly string[];
    labels?: Record<string, string>;
  }) => (
    <div className="form-group">
      <label id={id(`${o.slug}-label`)} htmlFor={id(o.slug)} className="form-label form-label--required">
        {o.label}
      </label>
      <select
        id={id(o.slug)}
        className="form-select"
        value={o.nilai}
        disabled={bacaSaja || menutup}
        aria-required="true"
        {...atributGalat(o.kunci)}
        onChange={(e) => {
          o.set(e.target.value);
          triggerAutosave();
        }}
      >
        <option value="">-- Pilih {o.label} --</option>
        {o.opsi.map((opt) => (
          <option key={opt} value={opt}>
            {o.labels?.[opt] ?? opt}
          </option>
        ))}
      </select>
      {galat(o.kunci)}
    </div>
  );

  // C3-10: tutup menunggu hasil simpan. Gagal/ditolak = dialog tetap terbuka (isian utuh, ditandai belum tersimpan);
  // jalan keluar tetap ada lewat Esc -> "Tutup tanpa menyimpan".
  const tutupDenganSimpan = async () => {
    if (menutupRef.current) return;
    menutupRef.current = true;
    setMenutup(true);
    const generasi = generasiRef.current;
    try {
      // R2: ketikan yang masuk selama PATCH terbang menaikkan versi lagi -> simpan ulang sampai versi tersimpan
      // sama dengan versi terkini, baru menutup. Batas putaran mencegah loop tak berujung.
      for (let putaran = 0; ; putaran++) {
        batalkanTimerSimpan();
        await antrianSimpanRef.current; // PATCH yang sudah terbang selesai dulu
        if (generasi !== generasiRef.current) return; // induk sudah menutup/mengganti tiket: jangan menutup yang baru
        if (bacaSaja || versiRef.current === tersimpanVersiRef.current) break;
        if (putaran >= 5) {
          setAdaPerubahan(true);
          return;
        }
        const versiDikirim = versiRef.current;
        const berhasil = await simpanTerbaruRef.current();
        if (generasi !== generasiRef.current) return;
        if (!berhasil) {
          setAdaPerubahan(true);
          return;
        }
        // Berhasil dan tak ada ketikan baru sejak dikirim: selesai (juga bila simpanDraf tak punya apa pun untuk dikirim).
        if (versiRef.current === versiDikirim) break;
      }
      onClose();
    } finally {
      menutupRef.current = false;
      setMenutup(false);
    }
  };

  return (
    <KerangkaModal
      terbuka={isOpen}
      varian="dialog"
      lebarMaks={760}
      penuhDiHp
      judul={`Pendataan Pelayanan — ${initialData?.layanan_nama || 'Loket'}`}
      labelTutup="Tutup"
      onTutup={() => void tutupDenganSimpan()}
      onEscape={tanganiEscape}
      dikunci={menutup}
      escapeDikunci={menutup || finalizing}
      lencanaJudul={
        isLocked ? (
          <Lencana nada="sukses" ikon={Lock}>Terkunci (Selesai)</Lencana>
        ) : bacaSaja ? (
          <Lencana nada="netral" ikon={Lock}>Baca saja</Lencana>
        ) : (
          <Lencana nada="info">Sedang Dilayani</Lencana>
        )
      }
      tambahanKepala={
        <>
            <p className={styles.meta}>
              Nomor Tiket: <strong className={styles.nomorTiket}>{initialData?.nomor_display}</strong>
              {lastSavedTime && !bacaSaja && ` · Draft tersimpan ${lastSavedTime}`}
              {savingDraft && ' · Menyimpan draft…'}
              {gagalSimpan && !savingDraft && !bacaSaja && ' · Draf BELUM tersimpan. Tekan Simpan untuk mencoba lagi'}
            </p>
            {!loading && initialData && hanyaSuntingDraf && (
              <p role="status" className={styles.peringatan}>
                Pendataan ini diambil alih {initialData.dilayani_oleh_nama ?? 'Koordinator'}. Anda masih dapat menyunting
                draf; penyelesaian dilakukan oleh Koordinator.
              </p>
            )}
            {!loading && initialData && bacaSaja && !isLocked && (
              <p role="status" className={styles.peringatan}>
                {bukanPemilik || ditolakServer
                  ? `Tiket ini sedang dilayani ${initialData.dilayani_oleh_nama ?? 'petugas lain'}. Hanya petugas yang memulai yang dapat mengubah dan menyelesaikan data ini.`
                  : 'Formulir hanya dapat diisi setelah layanan dimulai, oleh petugas yang memulainya.'}
              </p>
            )}
        </>
      }
      bawahKepala={
        <div role="group" aria-label="Langkah formulir pendataan" className={styles.langkah}>
          {[
            { s: 1, label: '1. Profil Pemohon', icon: User },
            { s: 2, label: '2. Data Usaha & Lokasi', icon: Building2 },
            { s: 3, label: '3. Tindakan & Solusi', icon: FileText },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = step === item.s;
            return (
              <button
                key={item.s}
                type="button"
                onClick={() => setStep(item.s as 1 | 2 | 3)}
                aria-current={isActive ? 'step' : undefined}
                className={cn(styles.langkahTombol, isActive && styles.langkahAktif)}
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>
      }
      atasKaki={
        konfirmasiTutup && (
          <div
            role="alertdialog"
            aria-labelledby={id('konfirmasi-judul')}
            aria-describedby={id('konfirmasi-desk')}
            className={styles.konfirmasi}
          >
            <p id={id('konfirmasi-judul')} className={styles.konfirmasiJudul}>Tutup formulir?</p>
            <p id={id('konfirmasi-desk')} className={styles.konfirmasiDesk}>
              Ada isian yang belum tersimpan.
            </p>
            <div className={styles.konfirmasiAksi}>
              <Tombol ref={tombolLanjutRef} varian="utama" ukuran="kecil" onClick={() => setKonfirmasiTutup(false)}>
                Lanjut mengisi
              </Tombol>
              <Tombol varian="sekunder" ukuran="kecil" disabled={menutup} onClick={() => void tutupDenganSimpan()}>
                {menutup ? 'Menyimpan…' : 'Simpan draf & tutup'}
              </Tombol>
              <Tombol varian="hantu" ukuran="kecil" disabled={menutup} onClick={tutupTanpaSimpan}>
                Tutup tanpa menyimpan
              </Tombol>
            </div>
          </div>
        )
      }
      kaki={
        <div className={styles.kaki}>
          <div>
            {step > 1 ? (
              <Tombol varian="hantu" ukuran="kecil" ikon={ChevronLeft} onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}>
                Sebelumnya
              </Tombol>
            ) : (
              <Tombol varian="hantu" ukuran="kecil" disabled={menutup} onClick={() => void tutupDenganSimpan()}>
                {bacaSaja ? 'Tutup' : 'Tutup (Draf tersimpan)'}
              </Tombol>
            )}
          </div>

          <div className={styles.kakiKanan}>
            {!bacaSaja && (
              <Tombol
                varian="sekunder"
                ukuran="kecil"
                ikon={Save}
                disabled={savingDraft}
                onClick={() => void simpanDraf()}
                title="Simpan data tanpa menyelesaikan antrean. Anda bisa lanjut mengisi nanti."
              >
                {savingDraft ? 'Menyimpan…' : 'Simpan'}
              </Tombol>
            )}

            {step < 3 ? (
              <Tombol varian="utama" ukuran="kecil" onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}>
                <span className={styles.berikut}>Selanjutnya <ChevronRight size={16} aria-hidden="true" /></span>
              </Tombol>
            ) : (
              !bacaSaja && !hanyaSuntingDraf && (
                <Tombol
                  varian="utama"
                  ukuran="kecil"
                  ikon={CheckCircle2}
                  disabled={finalizing}
                  memuat={finalizing}
                  onClick={handleFinalize}
                  title="Kunci data & selesaikan antrean. Tidak dapat diubah kembali."
                >
                  {finalizing ? 'Menyelesaikan…' : 'Selesaikan Antrean'}
                </Tombol>
              )
            )}
          </div>
        </div>
      }
    >
      {loading ? (
        <Skeleton bentuk="baris" jumlah={5} label="Memuat formulir pendataan…" />
      ) : (
        <form onSubmit={(e) => e.preventDefault()}>
          {!bacaSaja && (
            <p className={styles.petunjuk}>
              Semua isian wajib diisi sebelum layanan diselesaikan. Bila memang tidak ada, pakai tombol isian cepat
              di bawah kolom (&quot;Tidak berlaku&quot; / &quot;Belum ada&quot;; untuk catatan &quot;-&quot;) atau
              pilih opsi &quot;Tidak berlaku&quot; pada daftar pilihan.
            </p>
          )}

          {/* STEP 1: PROFIL PEMOHON */}
          {step === 1 && (
            <div className={styles.kolom}>
              {medanTeks({
                kunci: 'nama_pemohon', slug: 'nama-pemohon', label: 'Nama Pemohon',
                nilai: namaPemohon, set: setNamaPemohon, placeholder: 'Nama lengkap pemohon',
              })}
              {medanTeks({
                kunci: 'alamat_pemohon', slug: 'alamat-pemohon', label: 'Asal Instansi / Alamat Domisili',
                nilai: alamatPemohon, set: setAlamatPemohon, cepat: CEPAT_TIDAK_BERLAKU,
                placeholder: 'Kabupaten/Kota atau alamat domisili pemohon',
              })}
              <div className={styles.dua}>
                {medanTeks({
                  kunci: 'no_hp', slug: 'no-hp', label: 'Nomor Handphone / WhatsApp', tipe: 'tel',
                  ikon: <Phone size={14} aria-hidden="true" className={styles.ikonInline} />,
                  nilai: noHp, set: setNoHp, cepat: CEPAT_TIDAK_BERLAKU, placeholder: '081234567890',
                })}
                {medanTeks({
                  kunci: 'email', slug: 'email', label: 'Alamat Email', tipe: 'email',
                  ikon: <Mail size={14} aria-hidden="true" className={styles.ikonInline} />,
                  nilai: email, set: setEmail, placeholder: 'nama@email.com (wajib, email yang valid)',
                })}
              </div>
              {medanTeks({
                kunci: 'keperluan_awal', slug: 'keperluan-awal', label: 'Keperluan Awal', rows: 2,
                nilai: keperluanAwal, set: setKeperluanAwal, cepat: CEPAT_TIDAK_BERLAKU,
                placeholder: 'Catatan keperluan saat pendaftaran awal',
              })}
            </div>
          )}

          {/* STEP 2: DATA PELAYANAN TEKNIS */}
          {step === 2 && formType === 'oss' && (
            <div className={styles.kolom}>
              {medanTeks({
                kunci: 'nama_usaha', slug: 'nama-usaha', label: 'Nama Usaha / Merk Usaha',
                nilai: namaUsaha, set: setNamaUsaha, cepat: CEPAT_USAHA,
                placeholder: 'Nama PT / CV / Toko / Usaha Perorangan',
              })}
              <div className={styles.dua}>
                {medanPilihan({
                  kunci: 'tipe_pelaku_usaha', slug: 'tipe-pelaku', label: 'Tipe Pelaku Usaha',
                  nilai: tipePelakuUsaha, set: setTipePelakuUsaha,
                  opsi: TIPE_PELAKU_USAHA_OPTIONS, labels: TIPE_PELAKU_USAHA_LABELS,
                })}
                {medanPilihan({
                  kunci: 'status_penanaman_modal', slug: 'status-modal', label: 'Status Penanaman Modal',
                  nilai: statusPenanamanModal, set: setStatusPenanamanModal,
                  opsi: STATUS_PENANAMAN_MODAL_OPTIONS, labels: STATUS_PENANAMAN_MODAL_LABELS,
                })}
              </div>
              {medanTeks({
                kunci: 'lokasi_usaha', slug: 'lokasi-usaha', label: 'Lokasi Usaha',
                nilai: lokasiUsaha, set: setLokasiUsaha, cepat: CEPAT_USAHA,
                placeholder: 'Kabupaten/Kota atau wilayah lokasi kegiatan usaha (mis. Bandar Lampung)',
              })}
              <div className={styles.dua}>
                {medanPilihan({
                  kunci: 'skala_usaha', slug: 'skala-usaha', label: 'Skala Usaha',
                  nilai: skalaUsaha, set: setSkalaUsaha, opsi: SKALA_USAHA_OPTIONS,
                })}
                {medanTeks({
                  kunci: 'sektor_usaha_kbli', slug: 'kbli', label: 'KBLI / Sektor Usaha',
                  nilai: sektorUsahaKbli, set: setSektorUsahaKbli, cepat: CEPAT_USAHA,
                  placeholder: 'Contoh: 47111 - Perdagangan Eceran',
                })}
              </div>
            </div>
          )}

          {step === 2 && formType === 'perizinan' && (
            <div className={styles.kolom}>
              {medanTeks({
                kunci: 'nama_perusahaan', slug: 'nama-perusahaan', label: 'Nama Perusahaan / Pemohon',
                nilai: namaPerusahaan, set: setNamaPerusahaan, cepat: CEPAT_USAHA,
                placeholder: 'Nama PT / CV / Koperasi / Perorangan Pemohon',
              })}
              {medanTeks({
                kunci: 'opd_teknis', slug: 'opd-teknis', label: 'OPD Teknis Terkait', daftar: 'list-opd-teknis',
                nilai: opdTeknis, set: setOpdTeknis, cepat: CEPAT_TIDAK_BERLAKU,
                placeholder: 'Pilih atau ketik nama OPD Teknis (mis. Dinas ESDM, DLH, dll)',
              })}
              <datalist id="list-opd-teknis">
                {OPD_TEKNIS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
              {medanTeks({
                kunci: 'uraian_permohonan', slug: 'uraian-permohonan', label: 'Uraian Permohonan / Izin', rows: 3,
                nilai: uraianPermohonan, set: setUraianPermohonan,
                placeholder: 'Uraian permohonan izin/non-perizinan atau dokumen yang diajukan...',
              })}
              {medanTeks({
                kunci: 'lokasi_usaha', slug: 'lokasi-usaha-perizinan', label: 'Lokasi Usaha',
                nilai: lokasiUsahaPerizinan, set: setLokasiUsahaPerizinan, cepat: CEPAT_USAHA,
                placeholder: 'Kabupaten/Kota atau wilayah lokasi kegiatan usaha (mis. Bandar Lampung)',
              })}
            </div>
          )}

          {/* STEP 3: TINDAKAN & SOLUSI */}
          {step === 3 && !bacaSaja && daftarTopik.length > 0 && (
            <div className={cn('form-group', styles.topik)}>
              <label htmlFor={id('topik')} className="form-label form-label--required">Topik penanganan</label>
              <select
                id={id('topik')}
                className="form-select"
                value={topikId}
                aria-required="true"
                {...atributGalat('topik_id')}
                onChange={(e) => { setTopikId(e.target.value); setValidationErrors((v) => { const { topik_id: _t, ...sisa } = v; void _t; return sisa; }); }}
              >
                <option value="">-- Pilih topik --</option>
                {daftarTopik.map((t) => <option key={t.id} value={t.id}>{t.nama}</option>)}
              </select>
              {galat('topik_id')}
            </div>
          )}
          {step === 3 && formType === 'oss' && (
            <div className={styles.kolom}>
              {medanTeks({
                kunci: 'tindak_lanjut', slug: 'tindak-lanjut-oss', label: 'Tindakan / Tindak Lanjut',
                daftar: 'list-tindakan-oss', nilai: tindakLanjutOss, set: setTindakLanjutOss,
                placeholder: 'Pilih atau ketik tindakan yang diambil...',
              })}
              <datalist id="list-tindakan-oss">
                {TINDAK_LANJUT_OSS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
              {medanTeks({
                kunci: 'uraian_solusi', slug: 'uraian-solusi', label: 'Uraian Solusi / Konsultasi', rows: 4,
                nilai: uraianSolusi, set: setUraianSolusi,
                placeholder: 'Tuliskan kendala dan langkah solusi / konsultasi yang diberikan di loket...',
              })}
              {medanTeks({
                kunci: 'catatan_internal', slug: 'catatan-internal', label: 'Catatan Tambahan Internal', rows: 2,
                nilai: catatanInternal, set: setCatatanInternal, cepat: CEPAT_CATATAN,
                placeholder: 'Catatan tambahan untuk internal (isi "-" bila tidak ada)',
              })}
            </div>
          )}

          {step === 3 && formType === 'perizinan' && (
            <div className={styles.kolom}>
              {medanTeks({
                kunci: 'tindak_lanjut', slug: 'tindak-lanjut-perizinan', label: 'Tindak Lanjut',
                daftar: 'list-tindakan-perizinan', nilai: tindakLanjutPerizinan, set: setTindakLanjutPerizinan,
                placeholder: 'Pilih atau ketik tindak lanjut layanan...',
              })}
              <datalist id="list-tindakan-perizinan">
                {TINDAK_LANJUT_PERIZINAN_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
              {medanTeks({
                kunci: 'catatan_petugas', slug: 'catatan-petugas', label: 'Catatan Petugas', rows: 4,
                nilai: catatanPetugas, set: setCatatanPetugas, cepat: CEPAT_CATATAN,
                placeholder: 'Catatan persyaratan atau tindak lanjut tambahan (isi "-" bila tidak ada)...',
              })}
            </div>
          )}

        </form>
      )}
    </KerangkaModal>
  );
}
