'use client';

// Menyelesaikan tiket HASIL ESKALASI Front Office pada layanan TANPA form pendataan tetap (mis. BPJS, Bank Lampung).
// Pendataan Umum: topik (milik layanan tiket) + catatan 1-1000 wajib (RPC layanan_selesai, kontrak FO-ESKALASI §3.2).
// Fase 4: bila Admin menyusun Pendataan Khusus untuk Layanan itu, isiannya ditampilkan di sini dan dikirim bersama
// lewat RPC layanan_selesai_khusus (migrasi 202610300002). Tanpa isian / migrasi belum diterapkan = alur lama.
// Layanan dengan formulir tetap (OSS / Non OSS) mengisi topik di PelayananWizardModal.
// Hanya pemilik tiket yang dapat menyelesaikan (ditegakkan DB: BUKAN_PEMILIK).
import { useId, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { kodeGalatDariError, MAX_CATATAN_LAYANAN, PESAN_GALAT_ANTREAN } from '@/lib/pelayanan';
import { susunJawabanMentah, validasiJawabanKhusus, type NilaiForm } from '@/lib/pendataan-khusus/jawaban';
import { kodeGalatKhusus, PESAN_GALAT_KHUSUS } from '@/lib/pendataan-khusus/galat';
import { objekBelumAda } from '@/lib/akses-data/galat';
import { PESAN_EMAIL_WAJIB, POLA_EMAIL_NYATA } from '@/lib/types/pelayanan';
import FormDialog from './FormDialog';
import PendataanKhususFields, { useFieldKhusus } from './PendataanKhususFields';
import TopikCatatanFields, { useTopikLayanan } from './TopikCatatanFields';

const PESAN_MIGRASI_SEBAGIAN =
  'Pendataan Khusus belum aktif sepenuhnya di server (migrasi belum lengkap), sehingga tiket belum dapat diselesaikan dengan isian ini. Hubungi Admin.';
const PESAN_MIGRASI_EMAIL =
  'Pengisian email pengunjung belum aktif di server (migrasi belum diterapkan), sehingga tiket belum dapat diselesaikan dengan email. Hubungi Admin.';
const PESAN_ISIAN_BERUBAH =
  'Isian Pendataan Khusus Layanan ini berubah. Formulir dimuat ulang; periksa isian lalu kirim lagi.';

export interface TiketSelesaiEskalasi {
  id: string;
  nomor_display: string;
  layanan_id: string;
}

interface Props {
  tiket: TiketSelesaiEskalasi | null;
  onClose: () => void;
  /** Dipanggil setelah berhasil (dan setelah galat yang menandakan tampilan basi) agar daftar dimuat ulang. */
  onSuccess?: () => void | Promise<void>;
}

// Formulir bersih per tiket: pemanggil memasang komponen dengan `key={tiket.id}`.
export default function SelesaiEskalasiModal({ tiket, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const idDasar = useId();
  const { topik, memuat, galat: galatMuat } = useTopikLayanan(tiket?.layanan_id ?? null, tiket !== null);
  const khusus = useFieldKhusus(tiket?.layanan_id ?? null, tiket !== null);
  const [nilaiKhusus, setNilaiKhusus] = useState<NilaiForm>({});
  const [galatKhusus, setGalatKhusus] = useState<Record<string, string>>({});
  const [topikId, setTopikId] = useState('');
  const [catatan, setCatatan] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [galatTopik, setGalatTopik] = useState<string | null>(null);
  const [galatCatatan, setGalatCatatan] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [galatEmail, setGalatEmail] = useState<string | null>(null);

  if (!tiket) return null;

  const kirim = async () => {
    const catatanBersih = catatan.trim();
    const gTopik = topikId ? null : PESAN_GALAT_ANTREAN.TOPIK_WAJIB;
    const gCatatan = catatanBersih.length === 0
      ? PESAN_GALAT_ANTREAN.CATATAN_WAJIB
      : catatanBersih.length > MAX_CATATAN_LAYANAN ? PESAN_GALAT_ANTREAN.CATATAN_TERLALU_PANJANG : null;
    setGalatTopik(gTopik);
    setGalatCatatan(gCatatan);
    const adaKhusus = khusus.tersedia && khusus.fields.length > 0;
    const hasilKhusus = adaKhusus
      ? validasiJawabanKhusus(khusus.fields, susunJawabanMentah(khusus.fields, nilaiKhusus))
      : { galat: {}, payload: {} };
    setGalatKhusus(hasilKhusus.galat);
    // Email pengunjung: kosong = pakai email yang sudah tercatat (server menolak EMAIL_WAJIB bila belum ada); terisi = harus valid.
    const emailBersih = email.trim();
    const gEmail = emailBersih !== '' && !POLA_EMAIL_NYATA.test(emailBersih) ? PESAN_EMAIL_WAJIB : null;
    setGalatEmail(gEmail);
    if (gTopik || gCatatan || gEmail || Object.keys(hasilKhusus.galat).length > 0) return;

    setGalat(null);
    setMengirim(true);
    try {
      const supabase = createClient();
      const pakaiLama = () =>
        supabase.rpc('layanan_selesai', { p_tiket_id: tiket.id, p_topik_id: topikId, p_catatan: catatanBersih });
      let hasil: { peringatan?: string }[];
      // Email diketik atau ada isian Khusus -> RPC layanan_selesai_khusus (membawa identitas); selain itu alur lama.
      const pakaiKhusus = adaKhusus || emailBersih !== '';
      try {
        hasil = await mutasiWajibBaris<{ peringatan?: string }>(
          pakaiKhusus
            ? supabase.rpc('layanan_selesai_khusus', {
                p_tiket_id: tiket.id, p_topik_id: topikId, p_catatan: catatanBersih, p_khusus: hasilKhusus.payload,
                ...(emailBersih !== '' ? { p_identitas: { email: emailBersih } } : {}),
              })
            : pakaiLama(),
        );
      } catch (e) {
        // Deploy sebagian: fungsi layanan_selesai_khusus (atau parameter p_identitas) belum ada.
        const asal = (e as { asal?: unknown }).asal ?? e;
        if (!pakaiKhusus || !objekBelumAda(asal)) throw e;
        const perluKhusus = khusus.fields.some((f) => f.wajib) || Object.keys(hasilKhusus.payload).length > 0;
        if (perluKhusus) {
          setGalat(PESAN_MIGRASI_SEBAGIAN);
          return;
        }
        if (emailBersih !== '') {
          setGalat(PESAN_MIGRASI_EMAIL);
          return;
        }
        hasil = await mutasiWajibBaris<{ peringatan?: string }>(pakaiLama());
      }
      toast(`Tiket ${tiket.nomor_display} selesai dilayani`, 'success');
      if (hasil[0]?.peringatan) toast(hasil[0].peringatan, 'info');
      await onSuccess?.();
      onClose();
    } catch (err) {
      const kode = kodeGalatDariError(err);
      const kodeKhusus = kodeGalatKhusus(err);
      if (kodeKhusus === 'KHUSUS_TIDAK_VALID' || kodeKhusus === 'KHUSUS_WAJIB') {
        // Isian Layanan berubah (Admin) saat dialog terbuka: muat ulang isian, nilai yang sudah diketik dipertahankan.
        khusus.muatUlang();
        setGalat(PESAN_ISIAN_BERUBAH);
      } else if (kodeKhusus) setGalat(PESAN_GALAT_KHUSUS[kodeKhusus]);
      else if (kode === 'EMAIL_WAJIB') setGalatEmail(PESAN_GALAT_ANTREAN.EMAIL_WAJIB);
      else if (kode === 'TOPIK_WAJIB' || kode === 'TOPIK_TIDAK_VALID') setGalatTopik(PESAN_GALAT_ANTREAN[kode]);
      else if (kode === 'CATATAN_WAJIB' || kode === 'CATATAN_TERLALU_PANJANG') setGalatCatatan(PESAN_GALAT_ANTREAN[kode]);
      else setGalat(kode ? PESAN_GALAT_ANTREAN[kode] : `Gagal menyelesaikan tiket. ${pesanMutasi(err)}`);
      // Status/pemilik tiket berubah di tempat lain: segarkan daftar di belakang dialog.
      if (kode === 'INVALID_STATUS' || kode === 'NOT_FOUND' || kode === 'BUKAN_PEMILIK') await onSuccess?.();
    } finally {
      setMengirim(false);
    }
  };

  return (
    <FormDialog
      judul={<><CheckCircle2 size={18} aria-hidden="true" /> Selesaikan tiket {tiket.nomor_display}</>}
      deskripsi="Tiket ini berasal dari eskalasi Front Office. Pilih topik penanganan, tulis catatan hasil layanan, dan lengkapi isian Layanan (bila ada) sebelum menyelesaikan."
      labelKirim="Selesaikan"
      mengirim={mengirim}
      kirimNonaktif={memuat || khusus.memuat}
      galat={galat}
      onClose={onClose}
      onSubmit={kirim}
    >
      {() => (
        <>
        <TopikCatatanFields
          idDasar={idDasar}
          topik={topik}
          memuatTopik={memuat}
          galatMuat={galatMuat}
          topikId={topikId}
          onTopikId={(v) => { setTopikId(v); setGalatTopik(null); setGalat(null); }}
          topikWajib
          catatan={catatan}
          onCatatan={(v) => { setCatatan(v); setGalatCatatan(null); setGalat(null); }}
          catatanWajib
          rows={4}
          placeholderCatatan="Ringkas apa yang dilakukan / hasil layanan"
          galatTopik={galatTopik}
          galatCatatan={galatCatatan}
          disabled={mengirim}
        />
        <div className="form-group">
          <label htmlFor={`${idDasar}-email`} className="form-label">Email pengunjung</label>
          <input
            id={`${idDasar}-email`}
            className="form-input"
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={254}
            value={email}
            disabled={mengirim}
            placeholder="nama@email.com"
            aria-invalid={galatEmail ? true : undefined}
            aria-describedby={`${idDasar}-email-info${galatEmail ? ` ${idDasar}-email-galat` : ''}`}
            onChange={(e) => { setEmail(e.target.value); setGalatEmail(null); setGalat(null); }}
          />
          <p id={`${idDasar}-email-info`} style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
            Pengunjung yang dieskalasi wajib punya email. Isi bila belum tercatat oleh Front Office atau bila ingin
            memperbaruinya; kosongkan bila email sudah ada.
          </p>
          {galatEmail && (
            <p id={`${idDasar}-email-galat`} role="alert" style={{ color: 'var(--color-danger-600)', fontSize: 12, margin: '4px 0 0' }}>{galatEmail}</p>
          )}
        </div>
        {khusus.tersedia && (
          <PendataanKhususFields
            idDasar={idDasar}
            fields={khusus.fields}
            nilai={nilaiKhusus}
            onNilai={(id, v) => {
              setNilaiKhusus((n) => ({ ...n, [id]: v }));
              setGalatKhusus((g) => { const { [id]: _hapus, ...sisa } = g; void _hapus; return sisa; });
              setGalat(null);
            }}
            galat={galatKhusus}
            disabled={mengirim}
          />
        )}
        </>
      )}
    </FormDialog>
  );
}
