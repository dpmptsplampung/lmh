'use client';

// Dialog aksi staf atas sesi chat (Tahap C, kontrak docs/analysis/FO-CHAT-KONTRAK-RPC.md §2):
//  - ChatAmbilAlihDialog : Admin merebut chat yang dipegang staf lain, alasan 5-500 karakter wajib (chat_ambil).
//  - ChatTeruskanDialog  : FO meneruskan ke layanan (punya_chat), topik FO + catatan <=200 wajib (chat_teruskan).
//  - ChatSelesaiDialog   : pemilik tahap menutup chat; topik + catatan wajib (FO <=200, layanan <=1000) (chat_selesai).
//                          Fase 4: bila migrasi Pendataan Khusus terpasang, juga identitas pengunjung (Pendataan Umum) dan,
//                          untuk tahap layanan, Pendataan Khusus Layanan itu (chat_selesai_khusus).
// Semua lewat `kirimAksiChat` (route /api/chat/sesi -> RPC). Kerangka dialog + isian memakai ulang FoDialog,
// FoTopikCatatan, TopikCatatanFields (fokus awal, Escape, focus trap, label terhubung, galat role=alert).
// Hasil dikirim ke pemanggil lewat `onBerhasil`; galat sistem (sesi tidak sah / tampilan basi) lewat `onGalat`.
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Loader2, UserCog } from 'lucide-react';
import {
  GalatAksiChat,
  MAKS_ALASAN_AMBIL_ALIH_CHAT,
  MIN_ALASAN_AMBIL_ALIH_CHAT,
  kirimAksiChat,
  validasiAlasanAmbilAlih,
  validasiTopikCatatanChat,
  type HasilChatAmbil,
  type HasilChatSelesai,
  type HasilChatTeruskan,
  type PeranTahapChat,
} from '@/lib/chat-staf';
import type { TopikFo } from '@/lib/fo-penanganan';
import { susunJawabanMentah, validasiJawabanKhusus, type NilaiForm } from '@/lib/pendataan-khusus/jawaban';
import { identitasBerubah, validasiIdentitasBerubah, type IdentitasForm, type KolomIdentitas } from '@/lib/pendataan-khusus/identitas';
import FoDialog from './FoDialog';
import FoTopikCatatan from './FoTopikCatatan';
import IdentitasPengunjungFields, { useIdentitasKunjungan } from './IdentitasPengunjungFields';
import PendataanKhususFields, { useFieldKhusus } from './PendataanKhususFields';
import TopikCatatanFields, { useTopikLayanan } from './TopikCatatanFields';
import styles from './fo.module.css';

const PESAN_MIGRASI_SEBAGIAN =
  'Pendataan Khusus belum aktif sepenuhnya di server (migrasi belum lengkap), sehingga chat belum dapat diselesaikan dengan isian ini. Hubungi Admin.';
const PESAN_ISIAN_BERUBAH =
  'Isian Pendataan Khusus Layanan ini berubah. Formulir dimuat ulang; periksa isian lalu kirim lagi.';

export interface LayananChatOpsi {
  id: string;
  nama: string;
}

type Galat = GalatAksiChat | Error;

/** Pesan tampil untuk galat apa pun dari `kirimAksiChat`. */
function pesanDari(e: unknown, fallback: string): string {
  return e instanceof GalatAksiChat ? e.pesan : fallback;
}

// ---------------------------------------------------------------------------
// Ambil alih (Admin) — chat_ambil dengan p_alasan
// ---------------------------------------------------------------------------

interface AmbilAlihProps {
  sesiId: string;
  namaPengunjung: string;
  /** Nama pemegang saat ini bila diketahui. */
  pemegang: string | null;
  onClose: () => void;
  onBerhasil: (hasil: HasilChatAmbil) => void;
  onGalat?: (e: Galat) => void;
}

export function ChatAmbilAlihDialog({ sesiId, namaPengunjung, pemegang, onClose, onBerhasil, onGalat }: AmbilAlihProps) {
  const [alasan, setAlasan] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [galatAlasan, setGalatAlasan] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const kunciRef = useRef(false);
  const idDasar = useId();
  const idAlasan = `${idDasar}-alasan`;
  const idBantuan = `${idDasar}-bantuan`;
  const idGalatAlasan = `${idDasar}-galat-alasan`;

  const kirim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kunciRef.current) return;
    setGalat(null);
    const salah = validasiAlasanAmbilAlih(alasan);
    setGalatAlasan(salah);
    if (salah) return;
    kunciRef.current = true;
    setMengirim(true);
    try {
      const hasil = await kirimAksiChat<HasilChatAmbil>({ sesi_id: sesiId, aksi: 'takeover', alasan: alasan.trim() });
      onBerhasil(hasil);
    } catch (err) {
      if (err instanceof GalatAksiChat && err.kode === 'ALASAN_WAJIB') setGalatAlasan(err.pesan);
      else setGalat(pesanDari(err, 'Gagal mengambil alih chat.'));
      onGalat?.(err as Galat);
    } finally {
      kunciRef.current = false;
      setMengirim(false);
    }
  };

  return (
    <FoDialog
      judul={`Ambil alih chat ${namaPengunjung}`}
      deskripsi={
        <>
          Chat ini sedang dipegang {pemegang ? <strong>{pemegang}</strong> : 'staf lain'}. Setelah diambil alih, Anda
          menjadi penanggung jawab dan hanya Anda yang dapat membalas atau menyelesaikannya. Tindakan ini tercatat di
          riwayat audit beserta alasannya.
        </>
      }
      onClose={onClose}
      dikunci={mengirim}
      onSubmit={kirim}
      footer={
        <>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={mengirim}>Batal</button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={mengirim} aria-busy={mengirim}>
            {mengirim ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <UserCog size={14} aria-hidden="true" />}
            {mengirim ? 'Mengambil alih…' : 'Ambil alih chat'}
          </button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={idAlasan} className="form-label form-label--required">Alasan ambil alih</label>
        <textarea
          id={idAlasan}
          className="form-textarea"
          rows={3}
          value={alasan}
          maxLength={MAKS_ALASAN_AMBIL_ALIH_CHAT}
          disabled={mengirim}
          required
          aria-required="true"
          aria-invalid={galatAlasan ? true : undefined}
          aria-describedby={galatAlasan ? `${idBantuan} ${idGalatAlasan}` : idBantuan}
          data-autofocus=""
          placeholder="Mis. petugas sedang cuti / tidak membalas"
          onChange={(e) => { setAlasan(e.target.value); setGalatAlasan(null); }}
        />
        <span id={idBantuan} className={styles.bantuan}>
          Wajib, {MIN_ALASAN_AMBIL_ALIH_CHAT}-{MAKS_ALASAN_AMBIL_ALIH_CHAT} karakter. {alasan.length}/{MAKS_ALASAN_AMBIL_ALIH_CHAT}
        </span>
        {galatAlasan && <p id={idGalatAlasan} role="alert" className={styles.galat}>{galatAlasan}</p>}
      </div>
      {galat && <p role="alert" className={styles.galat}>{galat}</p>}
    </FoDialog>
  );
}

// ---------------------------------------------------------------------------
// Teruskan ke layanan (FO) — chat_teruskan
// ---------------------------------------------------------------------------

interface TeruskanProps {
  sesiId: string;
  namaPengunjung: string;
  /** Layanan aktif dengan punya_chat = true. */
  layanan: LayananChatOpsi[];
  /** Layanan sesi saat ini (pra-pilih bila valid). */
  layananSaranId: string | null;
  topikFo: TopikFo[];
  onClose: () => void;
  onBerhasil: (hasil: HasilChatTeruskan) => void;
  onGalat?: (e: Galat) => void;
}

export function ChatTeruskanDialog({
  sesiId, namaPengunjung, layanan, layananSaranId, topikFo, onClose, onBerhasil, onGalat,
}: TeruskanProps) {
  const saranValid = layananSaranId !== null && layanan.some((l) => l.id === layananSaranId);
  const [layananId, setLayananId] = useState(saranValid ? (layananSaranId as string) : '');
  const [topikId, setTopikId] = useState('');
  const [catatan, setCatatan] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [galatLayanan, setGalatLayanan] = useState<string | null>(null);
  const [galatTopik, setGalatTopik] = useState<string | null>(null);
  const [galatCatatan, setGalatCatatan] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const kunciRef = useRef(false);
  const idDasar = useId();
  const idLayanan = `${idDasar}-layanan`;
  const idGalatLayanan = `${idDasar}-galat-layanan`;

  const kirim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kunciRef.current) return;
    setGalat(null);
    setGalatLayanan(null);
    setGalatTopik(null);
    setGalatCatatan(null);
    if (!layananId) {
      setGalatLayanan('Pilih layanan tujuan.');
      return;
    }
    const salah = validasiTopikCatatanChat(topikId, catatan, 'fo');
    if (salah) {
      if (!topikId) setGalatTopik(salah);
      else setGalatCatatan(salah);
      return;
    }
    kunciRef.current = true;
    setMengirim(true);
    try {
      const hasil = await kirimAksiChat<HasilChatTeruskan>({
        sesi_id: sesiId, aksi: 'teruskan', layanan_id: layananId, topik_id: topikId, catatan: catatan.trim(),
      });
      onBerhasil(hasil);
    } catch (err) {
      const kode = err instanceof GalatAksiChat ? err.kode : null;
      const pesan = pesanDari(err, 'Gagal meneruskan chat.');
      if (kode === 'LAYANAN_TIDAK_VALID') setGalatLayanan(pesan);
      else if (kode === 'TOPIK_WAJIB' || kode === 'TOPIK_TIDAK_VALID') setGalatTopik(pesan);
      else if (kode === 'CATATAN_WAJIB' || kode === 'CATATAN_TERLALU_PANJANG') setGalatCatatan(pesan);
      else setGalat(pesan);
      onGalat?.(err as Galat);
    } finally {
      kunciRef.current = false;
      setMengirim(false);
    }
  };

  return (
    <FoDialog
      judul={`Teruskan chat ${namaPengunjung}`}
      deskripsi="Chat diteruskan ke petugas layanan tujuan. Percakapan tetap berjalan; petugas layanan mengambilnya dari daftar chat."
      onClose={onClose}
      dikunci={mengirim}
      onSubmit={kirim}
      footer={
        <>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={mengirim}>Batal</button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={mengirim || layanan.length === 0} aria-busy={mengirim}>
            {mengirim ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />}
            {mengirim ? 'Meneruskan…' : 'Teruskan chat'}
          </button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={idLayanan} className="form-label form-label--required">Layanan tujuan</label>
        <select
          id={idLayanan}
          className="form-select"
          value={layananId}
          disabled={mengirim}
          required
          aria-required="true"
          aria-invalid={galatLayanan ? true : undefined}
          aria-describedby={galatLayanan ? idGalatLayanan : undefined}
          data-autofocus=""
          onChange={(e) => { setLayananId(e.target.value); setGalatLayanan(null); }}
        >
          <option value="">Pilih layanan…</option>
          {layanan.map((l) => <option key={l.id} value={l.id}>{l.nama}</option>)}
        </select>
        {layanan.length === 0 && (
          <span className={styles.galat}>Tidak ada layanan aktif yang melayani chat.</span>
        )}
        {galatLayanan && <p id={idGalatLayanan} role="alert" className={styles.galat}>{galatLayanan}</p>}
      </div>

      <FoTopikCatatan
        topik={topikFo}
        topikId={topikId}
        catatan={catatan}
        onTopikChange={(id) => { setTopikId(id); setGalatTopik(null); }}
        onCatatanChange={(t) => { setCatatan(t); setGalatCatatan(null); }}
        disabled={mengirim}
        galatTopik={galatTopik}
        galatCatatan={galatCatatan}
      />
      {galat && <p role="alert" className={styles.galat}>{galat}</p>}
    </FoDialog>
  );
}

// ---------------------------------------------------------------------------
// Selesai — chat_selesai (topik + catatan wajib)
// ---------------------------------------------------------------------------

interface SelesaiProps {
  sesiId: string;
  namaPengunjung: string;
  /** Peran tahap yang berjalan: 'fo' (topik FO, catatan <=200) atau 'layanan' (topik layanan, catatan <=1000). */
  peran: PeranTahapChat;
  /** Layanan tahap (wajib untuk peran 'layanan': sumber daftar topik). */
  layananId: string | null;
  topikFo: TopikFo[];
  onClose: () => void;
  onBerhasil: (hasil: HasilChatSelesai) => void;
  onGalat?: (e: Galat) => void;
}

export function ChatSelesaiDialog({
  sesiId, namaPengunjung, peran, layananId, topikFo, onClose, onBerhasil, onGalat,
}: SelesaiProps) {
  const idDasar = useId();
  const topikLayanan = useTopikLayanan(layananId, peran === 'layanan');
  // Fase 4: `tersedia` = migrasi Pendataan Khusus terpasang. Tahap FO tidak punya Layanan (hanya identitas).
  const khusus = useFieldKhusus(peran === 'layanan' ? layananId : null, true);
  const identitasAwal = useIdentitasKunjungan(sesiId, khusus.tersedia);
  // Hanya EDIT petugas yang disimpan; tampilan = profil terbaca + edit (edit sebelum profil termuat tidak membekukan kolom lain).
  const [editIdentitas, setEditIdentitas] = useState<Partial<IdentitasForm>>({});
  const [galatIdentitas, setGalatIdentitas] = useState<Partial<Record<KolomIdentitas, string>>>({});
  const [nilaiKhusus, setNilaiKhusus] = useState<NilaiForm>({});
  const [galatKhusus, setGalatKhusus] = useState<Record<string, string>>({});
  const [topikId, setTopikId] = useState('');
  const [catatan, setCatatan] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [galatTopik, setGalatTopik] = useState<string | null>(null);
  const [galatCatatan, setGalatCatatan] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const kunciRef = useRef(false);
  const identitasTampil: IdentitasForm = { ...identitasAwal.awal, ...editIdentitas };

  // Peran layanan memakai TopikCatatanFields (tanpa data-autofocus): fokus awal ke pilihan topik setelah focus trap dialog.
  useEffect(() => {
    if (peran === 'layanan') document.getElementById(`${idDasar}-topik`)?.focus();
  }, [peran, idDasar]);

  const kirim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kunciRef.current) return;
    setGalat(null);
    const salah = validasiTopikCatatanChat(topikId, catatan, peran);
    setGalatTopik(!topikId ? salah : null);
    setGalatCatatan(topikId ? salah : null);
    // Pendataan Umum (identitas) dan Pendataan Khusus hanya bila migrasi terpasang (khusus.tersedia).
    const ubahIdentitas = khusus.tersedia ? identitasBerubah(identitasAwal.awal, identitasTampil) : {};
    // Validasi HANYA kolom yang diubah: profil lama yang tidak valid dan tidak disentuh tidak boleh memblokir.
    const gIdentitas = khusus.tersedia ? validasiIdentitasBerubah(identitasAwal.awal, identitasTampil) : {};
    setGalatIdentitas(gIdentitas);
    const adaKhusus = khusus.tersedia && peran === 'layanan' && khusus.fields.length > 0;
    const hasilKhusus = adaKhusus
      ? validasiJawabanKhusus(khusus.fields, susunJawabanMentah(khusus.fields, nilaiKhusus))
      : { galat: {}, payload: {} };
    setGalatKhusus(hasilKhusus.galat);
    if (salah || Object.keys(gIdentitas).length > 0 || Object.keys(hasilKhusus.galat).length > 0) return;
    kunciRef.current = true;
    setMengirim(true);
    try {
      const dasar = { sesi_id: sesiId, aksi: 'selesaikan' as const, topik_id: topikId, catatan: catatan.trim() };
      let hasil: HasilChatSelesai;
      try {
        hasil = await kirimAksiChat<HasilChatSelesai>({
          ...dasar,
          ...(adaKhusus ? { khusus: hasilKhusus.payload } : {}),
          ...(Object.keys(ubahIdentitas).length > 0 ? { identitas: ubahIdentitas } : {}),
        });
      } catch (err) {
        // Deploy sebagian (0001 tanpa 0002): chat_selesai_khusus belum ada.
        if (!(err instanceof GalatAksiChat) || err.kodeMentah !== 'MIGRASI_BELUM_DITERAPKAN') throw err;
        const perlu = khusus.fields.some((f) => f.wajib) || Object.keys(hasilKhusus.payload).length > 0
          || Object.keys(ubahIdentitas).length > 0;
        if (perlu) {
          setGalat(PESAN_MIGRASI_SEBAGIAN);
          return;
        }
        hasil = await kirimAksiChat<HasilChatSelesai>(dasar);
      }
      onBerhasil(hasil);
    } catch (err) {
      const kode = err instanceof GalatAksiChat ? err.kode : null;
      const mentah = err instanceof GalatAksiChat ? err.kodeMentah : null;
      const pesan = pesanDari(err, 'Gagal menyelesaikan chat.');
      if (mentah === 'KHUSUS_TIDAK_VALID' || mentah === 'KHUSUS_WAJIB') {
        // Isian Layanan berubah (Admin) saat dialog terbuka: muat ulang isian; nilai yang diketik dipertahankan.
        khusus.muatUlang();
        setGalat(PESAN_ISIAN_BERUBAH);
      } else if (kode === 'TOPIK_WAJIB' || kode === 'TOPIK_TIDAK_VALID') setGalatTopik(pesan);
      else if (kode === 'CATATAN_WAJIB' || kode === 'CATATAN_TERLALU_PANJANG') setGalatCatatan(pesan);
      else setGalat(pesan);
      onGalat?.(err as Galat);
    } finally {
      kunciRef.current = false;
      setMengirim(false);
    }
  };

  return (
    <FoDialog
      judul={`Selesaikan chat ${namaPengunjung}`}
      deskripsi="Pilih topik, tulis catatan, dan lengkapi pendataan sebelum menutup chat. Pengunjung akan menerima pesan penutup."
      onClose={onClose}
      dikunci={mengirim}
      onSubmit={kirim}
      footer={
        <>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={mengirim}>Batal</button>
          <button
            type="submit"
            className="btn btn--primary btn--sm"
            disabled={mengirim || (peran === 'layanan' && topikLayanan.memuat) || khusus.memuat || (khusus.tersedia && identitasAwal.memuat)}
            aria-busy={mengirim}
          >
            {mengirim ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
            {mengirim ? 'Menyimpan…' : 'Selesaikan chat'}
          </button>
        </>
      }
    >
      {peran === 'fo' ? (
        <FoTopikCatatan
          topik={topikFo}
          topikId={topikId}
          catatan={catatan}
          onTopikChange={(id) => { setTopikId(id); setGalatTopik(null); }}
          onCatatanChange={(t) => { setCatatan(t); setGalatCatatan(null); }}
          disabled={mengirim}
          galatTopik={galatTopik}
          galatCatatan={galatCatatan}
          fokusAwal
        />
      ) : (
        <TopikCatatanFields
          idDasar={idDasar}
          topik={topikLayanan.topik}
          memuatTopik={topikLayanan.memuat}
          galatMuat={topikLayanan.galat}
          topikId={topikId}
          onTopikId={(v) => { setTopikId(v); setGalatTopik(null); }}
          topikWajib
          catatan={catatan}
          onCatatan={(v) => { setCatatan(v); setGalatCatatan(null); }}
          catatanWajib
          rows={4}
          placeholderCatatan="Ringkas apa yang ditanyakan / hasil layanan"
          galatTopik={galatTopik}
          galatCatatan={galatCatatan}
          disabled={mengirim}
        />
      )}
      {khusus.tersedia && (
        <>
          <IdentitasPengunjungFields
            idDasar={idDasar}
            nilai={identitasTampil}
            onNilai={(k, v) => {
              setEditIdentitas((e) => ({ ...e, [k]: v }));
              setGalatIdentitas((g) => ({ ...g, [k]: undefined }));
            }}
            galat={galatIdentitas}
            disabled={mengirim}
          />
          {peran === 'layanan' && (
            <PendataanKhususFields
              idDasar={idDasar}
              fields={khusus.fields}
              nilai={nilaiKhusus}
              onNilai={(id, v) => {
                setNilaiKhusus((n) => ({ ...n, [id]: v }));
                setGalatKhusus((g) => { const { [id]: _hapus, ...sisa } = g; void _hapus; return sisa; });
              }}
              galat={galatKhusus}
              disabled={mengirim}
            />
          )}
        </>
      )}
      {galat && <p role="alert" className={styles.galat}>{galat}</p>}
    </FoDialog>
  );
}
