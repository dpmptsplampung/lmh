'use client';

import { useState, useEffect, useRef, useCallback, useId } from 'react';
import {
  X,
  Loader2,
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
import { useDialogFokus } from '@/components/admin/useDialogFokus';
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

const GAYA_GALAT: React.CSSProperties = { color: 'var(--color-danger-600)', fontSize: 12, marginTop: 4 };

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
  const idJudul = id('judul');
  const dialogRef = useRef<HTMLDivElement>(null);
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

  // Bersihkan autosave tertunda saat komponen unmount agar tidak ada PATCH
  // liar terpicu setelah modal ditutup / komponen dibongkar.
  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
    };
  }, []);

  // 1. Fetch data saat modal dibuka
  const loadData = useCallback(
    async (idTiket: string, isCurrent: () => boolean) => {
      try {
        setLoading(true);
        setValidationErrors({});
        setDitolakServer(false);
        setAdaPerubahan(false);
        setKonfirmasiTutup(false);
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

  // 2. Autosave Function (Debounced)
  const saveDraftNow = useCallback(async () => {
    if (!tiketId || bacaSaja || !formType) return;
    try {
      setSavingDraft(true);
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

      const res = await fetch(`/api/admin/pelayanan/${tiketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const d = new Date();
        setLastSavedTime(
          d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
        setAdaPerubahan(false);
      } else {
        const err = await res.json().catch(() => ({}));
        tanganiPenolakan(res.status, (err as { error?: unknown }).error);
      }
    } catch {
      // Autosave fail silently or log
    } finally {
      setSavingDraft(false);
    }
  }, [
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

  const triggerAutosave = useCallback(() => {
    if (bacaSaja || loading) return;
    setAdaPerubahan(true);
    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = setTimeout(() => {
      saveDraftNow();
    }, 1000);
  }, [bacaSaja, loading, saveDraftNow]);

  // Escape: tutup langsung bila tak ada yang hilang; bila ada perubahan belum tersimpan, minta konfirmasi dulu.
  const perubahanBelumTersimpan = !bacaSaja && adaPerubahan;
  useDialogFokus(isOpen, dialogRef, () => {
    if (finalizing) return;
    if (konfirmasiTutup) {
      setKonfirmasiTutup(false);
      return;
    }
    if (perubahanBelumTersimpan) {
      setKonfirmasiTutup(true);
      return;
    }
    onClose();
  });

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
        if (tanganiPenolakan(res.status, result.error)) return;
        throw new Error(result.error || 'Gagal menyelesaikan pelayanan');
      }

      toast('Pelayanan selesai & data berhasil dikunci', 'success');
      onSuccess?.();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menyelesaikan pelayanan', 'error');
    } finally {
      setFinalizing(false);
    }
  };

  if (!isOpen) return null;

  // Galat field: pesan role=alert, dirujuk aria-describedby pada field-nya.
  const galat = (kunci: string) =>
    validationErrors[kunci] ? (
      <p id={id(`${kunci}-galat`)} role="alert" className="form-error" style={GAYA_GALAT}>
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
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 4 }}>
        {cepat.map((c) => (
          <button
            key={c.label}
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ fontSize: 12, padding: '2px 8px' }}
            aria-describedby={id(`${slug}-label`)}
            onClick={() => {
              set(c.nilai);
              triggerAutosave();
            }}
          >
            {c.label}
          </button>
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
          disabled={bacaSaja}
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
          disabled={bacaSaja}
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
        disabled={bacaSaja}
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

  const tutupDenganSimpan = () => {
    saveDraftNow();
    onClose();
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={idJudul}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
        outline: 'none',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 'var(--radius-2xl, 16px)',
          width: '100%',
          maxWidth: '760px',
          maxHeight: 'calc(100dvh - 2rem)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 10px 40px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.04)',
          border: '1px solid var(--border-default, #e2e8f0)',
          overflow: 'hidden',
        }}
      >
        {/* Header — bersih, aksen primary halus */}
        <div
          style={{
            padding: 'var(--space-5) var(--space-6)',
            borderBottom: '1px solid var(--border-default, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <h2
                id={idJudul}
                style={{
                  fontSize: 'var(--text-lg, 1.125rem)',
                  fontWeight: 700,
                  margin: 0,
                  color: 'var(--text-primary, #0f172a)',
                }}
              >
                Pendataan Pelayanan — {initialData?.layanan_nama || 'Loket'}
              </h2>
              {isLocked ? (
                <span className="badge badge--aktif" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Lock size={12} aria-hidden="true" /> Terkunci (Selesai)
                </span>
              ) : bacaSaja ? (
                <span className="badge badge--nonaktif" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Lock size={12} aria-hidden="true" /> Baca saja
                </span>
              ) : (
                <span className="badge badge--draft">Sedang Dilayani</span>
              )}
            </div>
            <p
              style={{
                fontSize: 'var(--text-xs, 0.75rem)',
                color: 'var(--text-tertiary, #64748b)',
                margin: '2px 0 0 0',
              }}
            >
              Nomor Tiket: <strong style={{ color: 'var(--color-primary-700, #0369a1)' }}>{initialData?.nomor_display}</strong>
              {lastSavedTime && !bacaSaja && ` · Draft tersimpan ${lastSavedTime}`}
              {savingDraft && ' · Menyimpan draft…'}
            </p>
            {!loading && initialData && hanyaSuntingDraf && (
              <p
                role="status"
                style={{ fontSize: 'var(--text-xs, 0.75rem)', color: 'var(--color-warning-600, #d97706)', margin: '4px 0 0 0' }}
              >
                Pendataan ini diambil alih {initialData.dilayani_oleh_nama ?? 'Koordinator'}. Anda masih dapat menyunting
                draf; penyelesaian dilakukan oleh Koordinator.
              </p>
            )}
            {!loading && initialData && bacaSaja && !isLocked && (
              <p
                role="status"
                style={{ fontSize: 'var(--text-xs, 0.75rem)', color: 'var(--color-warning-600, #d97706)', margin: '4px 0 0 0' }}
              >
                {bukanPemilik || ditolakServer
                  ? `Tiket ini sedang dilayani ${initialData.dilayani_oleh_nama ?? 'petugas lain'}. Hanya petugas yang memulai yang dapat mengubah dan menyelesaikan data ini.`
                  : 'Formulir hanya dapat diisi setelah layanan dimulai, oleh petugas yang memulainya.'}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={tutupDenganSimpan}
            className="btn btn--ghost btn--sm"
            style={{ borderRadius: '50%', padding: '6px' }}
            aria-label="Tutup"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Steps Navigation */}
        <div
          role="group"
          aria-label="Langkah formulir pendataan"
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-default, #e2e8f0)',
            background: '#ffffff',
          }}
        >
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
                style={{
                  flex: 1,
                  padding: 'var(--space-3) var(--space-4)',
                  fontSize: 'var(--text-sm, 0.875rem)',
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? 'var(--color-primary-700, #0369a1)' : 'var(--text-secondary, #475569)',
                  borderBottom: isActive ? '2px solid var(--color-primary-600, #0284c7)' : '2px solid transparent',
                  background: isActive ? 'var(--color-primary-50, #f0f9ff)' : 'transparent',
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={16} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Modal Body (Scrollable) */}
        <div
          style={{
            padding: 'var(--space-6)',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--text-secondary)' }}>
              <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto var(--space-3)' }} aria-hidden="true" />
              <p>Memuat formulir pendataan…</p>
            </div>
          ) : (
            <form onSubmit={(e) => e.preventDefault()}>
              {!bacaSaja && (
                <p
                  style={{
                    fontSize: 'var(--text-xs, 0.75rem)',
                    color: 'var(--text-secondary, #475569)',
                    margin: '0 0 var(--space-4) 0',
                  }}
                >
                  Semua isian wajib diisi sebelum layanan diselesaikan. Bila memang tidak ada, pakai tombol isian cepat
                  di bawah kolom (&quot;Tidak berlaku&quot; / &quot;Belum ada&quot;; untuk catatan &quot;-&quot;) atau
                  pilih opsi &quot;Tidak berlaku&quot; pada daftar pilihan.
                </p>
              )}

              {/* STEP 1: PROFIL PEMOHON */}
              {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  {medanTeks({
                    kunci: 'nama_pemohon', slug: 'nama-pemohon', label: 'Nama Pemohon',
                    nilai: namaPemohon, set: setNamaPemohon, placeholder: 'Nama lengkap pemohon',
                  })}
                  {medanTeks({
                    kunci: 'alamat_pemohon', slug: 'alamat-pemohon', label: 'Asal Instansi / Alamat Domisili',
                    nilai: alamatPemohon, set: setAlamatPemohon, cepat: CEPAT_TIDAK_BERLAKU,
                    placeholder: 'Kabupaten/Kota atau alamat domisili pemohon',
                  })}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                    {medanTeks({
                      kunci: 'no_hp', slug: 'no-hp', label: 'Nomor Handphone / WhatsApp', tipe: 'tel',
                      ikon: <Phone size={14} aria-hidden="true" style={{ display: 'inline', marginRight: 4 }} />,
                      nilai: noHp, set: setNoHp, cepat: CEPAT_TIDAK_BERLAKU, placeholder: '081234567890',
                    })}
                    {medanTeks({
                      kunci: 'email', slug: 'email', label: 'Alamat Email', tipe: 'email',
                      ikon: <Mail size={14} aria-hidden="true" style={{ display: 'inline', marginRight: 4 }} />,
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  {medanTeks({
                    kunci: 'nama_usaha', slug: 'nama-usaha', label: 'Nama Usaha / Merk Usaha',
                    nilai: namaUsaha, set: setNamaUsaha, cepat: CEPAT_USAHA,
                    placeholder: 'Nama PT / CV / Toko / Usaha Perorangan',
                  })}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
                <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
        </div>

        {/* Konfirmasi tutup (Escape dengan perubahan belum tersimpan) */}
        {konfirmasiTutup && (
          <div
            role="alertdialog"
            aria-labelledby={id('konfirmasi-judul')}
            aria-describedby={id('konfirmasi-desk')}
            style={{
              padding: 'var(--space-4) var(--space-6)',
              borderTop: '1px solid var(--color-warning-500, #f59e0b)',
              background: 'var(--color-warning-50, #fffbeb)',
            }}
          >
            <p id={id('konfirmasi-judul')} style={{ margin: 0, fontWeight: 700 }}>Tutup formulir?</p>
            <p id={id('konfirmasi-desk')} style={{ margin: '2px 0 var(--space-3)', fontSize: 'var(--text-sm)' }}>
              Ada isian yang belum tersimpan.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <button ref={tombolLanjutRef} type="button" className="btn btn--primary btn--sm" onClick={() => setKonfirmasiTutup(false)}>
                Lanjut mengisi
              </button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={tutupDenganSimpan}>
                Simpan draf &amp; tutup
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  if (autosaveTimeoutRef.current) {
                    clearTimeout(autosaveTimeoutRef.current);
                    autosaveTimeoutRef.current = null;
                  }
                  onClose();
                }}
              >
                Tutup tanpa menyimpan
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div
          style={{
            padding: 'var(--space-4) var(--space-6)',
            borderTop: '1px solid var(--border-default, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#ffffff',
            gap: 'var(--space-3)',
          }}
        >
          <div>
            {step > 1 ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
              >
                <ChevronLeft size={16} aria-hidden="true" /> Sebelumnya
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={tutupDenganSimpan}
              >
                {bacaSaja ? 'Tutup' : 'Tutup (Draf tersimpan)'}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            {!bacaSaja && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={savingDraft}
                onClick={saveDraftNow}
                title="Simpan data tanpa menyelesaikan antrian. Anda bisa lanjut mengisi nanti."
              >
                <Save size={16} aria-hidden="true" /> {savingDraft ? 'Menyimpan…' : 'Simpan'}
              </button>
            )}

            {step < 3 ? (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              >
                Selanjutnya <ChevronRight size={16} aria-hidden="true" />
              </button>
            ) : (
              !bacaSaja && !hanyaSuntingDraf && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={finalizing}
                  aria-busy={finalizing}
                  onClick={handleFinalize}
                  title="Kunci data & selesaikan antrian. Tidak dapat diubah kembali."
                  style={{
                    backgroundColor: 'var(--color-success-600, #16a34a)',
                    borderColor: 'var(--color-success-600, #16a34a)',
                  }}
                >
                  <CheckCircle2 size={16} aria-hidden="true" /> {finalizing ? 'Menyelesaikan…' : 'Selesaikan Antrian'}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
