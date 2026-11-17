'use client';

// Satu jalur "Selesai" untuk SEMUA tiket tanpa formulir tetap (G5; menggeneralisasi SelesaiEskalasiModal). Layanan
// berformulir tetap (OSS / Non OSS) tetap lewat PelayananWizardModal -> layanan_selesai(form).
//   - Layanan DENGAN isian Pendataan Khusus aktif: isian dimuat dari draf (autosave yang sama dengan wizard Mulai), wajib
//     divalidasi, lalu `layanan_selesai_khusus`; topik/catatan TIDAK diminta (server mengisi topik "Lainnya" dan catatan baku).
//   - Layanan TANPA isian aktif: tiket hasil eskalasi FO wajib topik + catatan (kontrak FO-ESKALASI §3.2); tiket lama cukup
//     konfirmasi (topik/catatan muncul bila server menolaknya dengan TOPIK_WAJIB).
//   - Email pengunjung: kosong = pakai yang sudah tercatat (server menolak EMAIL_WAJIB bila belum ada).
// RPC definisi belum ada (migrasi 202611160002 belum diterapkan) = jalur lama (layanan_selesai, topik + catatan untuk eskalasi).
// Hanya pemilik tiket yang dapat menyelesaikan (ditegakkan DB: BUKAN_PEMILIK). Pemanggil memasang dengan `key={tiket.id}`.
import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { pesanMutasi } from '@/lib/supabase/mutate';
import { kodeGalatDariError, MAX_CATATAN_LAYANAN, PESAN_GALAT_ANTREAN } from '@/lib/pelayanan';
import { selesaikanTiketKhusus } from '@/lib/data/pendataan-khusus';
import { susunJawabanMentah, validasiJawabanKhusus } from '@/lib/pendataan-khusus/jawaban';
import { pesanGalatLangkah } from '@/lib/pendataan-khusus/galat';
import { PESAN_EMAIL_WAJIB, POLA_EMAIL_NYATA } from '@/lib/types/pelayanan';
import FormDialog from './FormDialog';
import PendataanKhususFields from './PendataanKhususFields';
import TopikCatatanFields, { useTopikLayanan } from './TopikCatatanFields';
import IndikatorDraf from './mulai-layanan/IndikatorDraf';
import { useDrafKhusus } from './mulai-layanan/useDrafKhusus';
import { useDefinisiKhusus } from './mulai-layanan/useDataLangkah';
import styles from './FormAntrean.module.css';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface TiketSelesaiLayanan {
  id: string;
  nomor_display: string;
  layanan_id: string;
  /** Tiket hasil eskalasi Front Office (punya tahap asal): topik + catatan wajib bila Layanan tanpa isian Khusus. */
  hasilEskalasi: boolean;
}

interface Props {
  tiket: TiketSelesaiLayanan | null;
  onClose: () => void;
  /** Dipanggil setelah berhasil (dan setelah galat yang menandakan tampilan basi) agar daftar dimuat ulang. */
  onSuccess?: () => void | Promise<void>;
}

/** UUID isian yang disebut galat final (DETAIL KHUSUS_WAJIB/KHUSUS_TIDAK_VALID), bila ada. */
function idIsianDariGalat(e: unknown): string | null {
  if (typeof e !== 'object' || e === null) return null;
  const { message, details } = e as { message?: unknown; details?: unknown };
  const teks = `${typeof message === 'string' ? message : ''} ${typeof details === 'string' ? details : ''}`;
  return teks.match(UUID)?.[0].toLowerCase() ?? null;
}

export default function SelesaiLayananModal({ tiket, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const idDasar = useId();
  const definisi = useDefinisiKhusus(tiket?.layanan_id ?? null, tiket !== null);
  const adaIsian = definisi.tersedia && definisi.fields.length > 0;
  const draf = useDrafKhusus({
    tiketId: tiket?.id ?? '',
    fields: definisi.fields,
    aktif: tiket !== null && adaIsian,
    bolehUbah: true,
    onBasi: () => { void onSuccess?.(); definisi.muatUlang(); },
  });
  // Server menolak tanpa topik (TOPIK_WAJIB) untuk tiket lama: kolom topik + catatan dimunculkan.
  const [paksaTopik, setPaksaTopik] = useState(false);
  const tampilTopik = !adaIsian && !definisi.memuat && ((tiket?.hasilEskalasi ?? false) || paksaTopik);
  const { topik, memuat: memuatTopik, galat: galatMuatTopik } = useTopikLayanan(tiket?.layanan_id ?? null, tiket !== null && tampilTopik);
  const [galatKhusus, setGalatKhusus] = useState<Record<string, string>>({});
  const [topikId, setTopikId] = useState('');
  const [catatan, setCatatan] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [galatTopik, setGalatTopik] = useState<string | null>(null);
  const [galatCatatan, setGalatCatatan] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [galatEmail, setGalatEmail] = useState<string | null>(null);

  const siapIsian = !definisi.memuat && (!adaIsian || (!draf.memuat && !draf.galatMuat));
  // Isian Layanan baru ada setelah definisi dimuat (sesudah fokus awal dialog): pindahkan fokus ke isian pertama, sekali.
  const badanRef = useRef<HTMLDivElement>(null);
  const sudahFokus = useRef(false);
  const siapFokus = siapIsian && !(tampilTopik && (memuatTopik || (topik.length === 0 && !galatMuatTopik)));
  useEffect(() => {
    if (!siapFokus || sudahFokus.current || !badanRef.current) return;
    sudahFokus.current = true;
    const aktif = document.activeElement;
    if (aktif && badanRef.current.contains(aktif)) return;
    badanRef.current.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')?.focus();
  }, [siapFokus]);

  if (!tiket) return null;

  const kirim = async () => {
    const catatanBersih = catatan.trim();
    const gTopik = tampilTopik && !topikId ? PESAN_GALAT_ANTREAN.TOPIK_WAJIB : null;
    const gCatatan = !tampilTopik ? null
      : catatanBersih.length === 0 ? PESAN_GALAT_ANTREAN.CATATAN_WAJIB
      : catatanBersih.length > MAX_CATATAN_LAYANAN ? PESAN_GALAT_ANTREAN.CATATAN_TERLALU_PANJANG : null;
    setGalatTopik(gTopik);
    setGalatCatatan(gCatatan);
    const hasilKhusus = adaIsian
      ? validasiJawabanKhusus(definisi.fields, susunJawabanMentah(definisi.fields, draf.nilai))
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
      // Simpan draf terakhir lebih dulu (menunggu simpan yang sedang berjalan): tidak ada simpan terlambat sesudah selesai.
      if (adaIsian) await draf.simpanSekarang();
      // Jawaban final = isian layar (penggantian penuh); isian kosong dikirim null agar draf lama tidak ikut terpakai.
      const khusus = adaIsian
        ? { ...Object.fromEntries(definisi.fields.map((f) => [f.id, null])), ...hasilKhusus.payload }
        : null;
      const hasil = await selesaikanTiketKhusus(createClient(), {
        tiketId: tiket.id,
        topikId: tampilTopik ? topikId : null,
        catatan: tampilTopik ? catatanBersih : null,
        khusus,
        identitas: emailBersih !== '' ? { email: emailBersih } : null,
      }, !definisi.tersedia);
      if (hasil.error) {
        tanganiGalat(hasil.error.asli);
        return;
      }
      toast(`Tiket ${tiket.nomor_display} selesai dilayani`, 'success');
      if (hasil.data.peringatan) toast(hasil.data.peringatan, 'info');
      await onSuccess?.();
      onClose();
    } catch (err) {
      setGalat(`Gagal menyelesaikan tiket. ${pesanMutasi(err)}`);
    } finally {
      setMengirim(false);
    }
  };

  const tanganiGalat = (err: unknown) => {
    const kode = kodeGalatDariError(err);
    const langkah = pesanGalatLangkah(err, '');
    if (kode === 'EMAIL_WAJIB') setGalatEmail(PESAN_GALAT_ANTREAN.EMAIL_WAJIB);
    else if (kode === 'TOPIK_WAJIB' || kode === 'TOPIK_TIDAK_VALID') {
      setPaksaTopik(true);
      setGalatTopik(PESAN_GALAT_ANTREAN[kode]);
    } else if (kode === 'CATATAN_WAJIB' || kode === 'CATATAN_TERLALU_PANJANG') {
      setPaksaTopik(true);
      setGalatCatatan(PESAN_GALAT_ANTREAN[kode]);
    } else if (langkah.pesan) {
      // Isian Layanan berubah/tak valid: muat ulang definisi, isian yang sudah diketik tetap di layar.
      const idIsian = idIsianDariGalat(err);
      const f = idIsian ? definisi.fields.find((x) => x.id.toLowerCase() === idIsian) : undefined;
      if (f) setGalatKhusus({ [f.id]: `${f.label} wajib diisi.` });
      if (langkah.muatUlang) definisi.muatUlang();
      setGalat(langkah.pesan);
    } else {
      setGalat(kode ? PESAN_GALAT_ANTREAN[kode] : `Gagal menyelesaikan tiket. ${pesanMutasi(err)}`);
    }
    // Status/pemilik tiket berubah di tempat lain: segarkan daftar di belakang dialog.
    if (kode === 'INVALID_STATUS' || kode === 'NOT_FOUND' || kode === 'BUKAN_PEMILIK' || langkah.muatUlang) void onSuccess?.();
  };

  return (
    <FormDialog
      judul={<><CheckCircle2 size={18} aria-hidden="true" /> Selesaikan tiket {tiket.nomor_display}</>}
      deskripsi={adaIsian
        ? 'Lengkapi isian Pendataan Khusus Layanan ini (terisi dari draf yang tersimpan), lalu selesaikan tiket.'
        : tiket.hasilEskalasi
          ? 'Tiket ini berasal dari eskalasi Front Office. Pilih topik penanganan dan tulis catatan hasil layanan sebelum menyelesaikan.'
          : 'Tiket akan ditandai selesai dilayani. Email pengunjung dapat diisi bila belum tercatat.'}
      labelKirim="Selesaikan"
      mengirim={mengirim}
      kirimNonaktif={!siapIsian || Boolean(definisi.galat) || (tampilTopik && memuatTopik)}
      galat={galat ?? (definisi.galat ? `${definisi.galat} Tutup dialog lalu buka lagi.` : null) ?? draf.galatMuat}
      onClose={onClose}
      onSubmit={kirim}
    >
      {() => (
        <div ref={badanRef}>
        {definisi.memuat && <p className={styles.info}>Memuat isian Layanan…</p>}
        {tampilTopik && (
          <TopikCatatanFields
            idDasar={idDasar}
            topik={topik}
            memuatTopik={memuatTopik}
            galatMuat={galatMuatTopik}
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
        )}
        {adaIsian && siapIsian && (
          <>
            <IndikatorDraf status={draf.status} terakhir={draf.simpanTerakhir} galat={draf.galatSimpan} bolehUbah />
            <PendataanKhususFields
              idDasar={idDasar}
              fields={definisi.fields}
              nilai={draf.nilai}
              onNilai={(id, v) => {
                draf.ubah(id, v);
                setGalatKhusus((g) => { const { [id]: _hapus, ...sisa } = g; void _hapus; return sisa; });
                setGalat(null);
              }}
              galat={galatKhusus}
              disabled={mengirim}
            />
          </>
        )}
        {siapIsian && (
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
            <p id={`${idDasar}-email-info`} className={styles.info}>
              Pengunjung wajib punya email. Isi bila belum tercatat oleh Front Office atau bila ingin memperbaruinya;
              kosongkan bila email sudah ada.
            </p>
            {galatEmail && (
              <p id={`${idDasar}-email-galat`} role="alert" className={styles.galat}>{galatEmail}</p>
            )}
          </div>
        )}
        </div>
      )}
    </FormDialog>
  );
}
