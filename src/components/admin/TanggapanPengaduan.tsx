'use client';

import { useId, useRef, useState } from 'react';
import { Paperclip, Send, X } from 'lucide-react';
import Field from '@/components/ui/Field';
import Lencana from '@/components/ui/Lencana';
import Tombol from '@/components/ui/Tombol';
import { unggahKeR2 } from '@/lib/storage/unggah';
import { PILIHAN_STATUS, statusTertutup, type PilihanStatus } from '@/lib/pengaduan/tampilan';
import styles from './TanggapanPengaduan.module.css';

interface Props {
  pengaduanId: string;
  /** Email pelapor tersedia dan pelapor tidak anonim -> kotak "kirim ke email" aktif. */
  bisaEmail: boolean;
  statusSaatIni: string;
  /** Dipanggil setelah tersimpan. `peringatan` terisi bila status berubah tetapi riwayat gagal dicatat. */
  onTersimpan: (peringatan?: string) => void;
  onGalat: (pesan: string) => void;
}

const BATAS = 5 * 1024 * 1024;
const MIME_OK = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EKS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

// SATU formulir aksi untuk Admin/FO: tanggapan untuk pelapor + pilihan status (Tetap, Verifikasi, Diproses, Selesai, Tolak).
// Aturan isian: Tetap dan Tolak wajib bertanggapan (Tolak = alasan, dikirim ke pelapor); Verifikasi, Diproses, dan Selesai boleh tanpa teks
// (hanya status yang berubah, lewat PATCH). Tanggapan dan lampiran dapat dilihat siapa pun yang memegang nomor laporan
// (pengaduan dari Pesan Perilaku), jadi data pribadi tidak boleh dicantumkan.
export default function TanggapanPengaduan({ pengaduanId, bisaEmail, statusSaatIni, onTersimpan, onGalat }: Props) {
  const idDasar = useId();
  const tutup = statusTertutup(statusSaatIni);
  const pilihan = tutup ? PILIHAN_STATUS.filter((p) => p.nilai === 'tetap') : PILIHAN_STATUS.filter((p) => p.nilai !== statusSaatIni && (p.nilai !== 'diverifikasi' || statusSaatIni === 'baru'));
  const [status, setStatus] = useState<PilihanStatus>('tetap');
  const [isi, setIsi] = useState('');
  const [email, setEmail] = useState(bisaEmail);
  const [berkas, setBerkas] = useState<File[]>([]);
  const [kirim, setKirim] = useState(false);
  const [galatLokal, setGalatLokal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const tolak = status === 'ditolak';
  const isiBersih = isi.trim();
  const isiWajib = status === 'tetap' || tolak;
  const bisaKirim = !kirim && (!isiWajib || isiBersih.length > 0);
  const hanyaStatus = !isiBersih && (status === 'diverifikasi' || status === 'diproses' || status === 'selesai');

  const pilih = (daftar: FileList | null) => {
    if (!daftar) return;
    const baru = [...berkas];
    for (const f of Array.from(daftar)) {
      if (!MIME_OK.includes(f.type)) { setGalatLokal('Lampiran harus berformat JPG, PNG, WEBP, atau PDF.'); continue; }
      if (f.size > BATAS) { setGalatLokal('Ukuran lampiran maksimal 5 MB.'); continue; }
      if (baru.length >= 3) { setGalatLokal('Lampiran maksimal 3 berkas.'); break; }
      baru.push(f);
    }
    setBerkas(baru);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bisaKirim) return;
    setGalatLokal('');
    if (hanyaStatus && berkas.length > 0) {
      setGalatLokal('Lampiran dikirim bersama tanggapan. Tulis tanggapan atau hapus lampiran.');
      return;
    }
    setKirim(true);
    try {
      if (hanyaStatus) {
        const res = await fetch('/api/admin/pengaduan', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: pengaduanId, status }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; peringatan?: string };
        if (!res.ok) throw new Error(json.error ?? 'Gagal mengubah status pengaduan');
        reset();
        onTersimpan(typeof json.peringatan === 'string' && json.peringatan.trim() ? json.peringatan : undefined);
        return;
      }
      const lampiran: Array<{ kunci: string; nama: string; mime: string; ukuran: number }> = [];
      for (const f of berkas) {
        const { kunci } = await unggahKeR2('pengaduan-bukti', `${pengaduanId}/${crypto.randomUUID()}.${EKS[f.type]}`, f);
        lampiran.push({ kunci, nama: f.name.slice(0, 200), mime: f.type, ukuran: f.size });
      }
      const res = await fetch(`/api/admin/pengaduan/${pengaduanId}/tanggapan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isi: isiBersih, status: status === 'tetap' ? null : status, kirim_email: bisaEmail && email, lampiran }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Gagal menyimpan tanggapan');
      reset();
      onTersimpan();
    } catch (err) {
      onGalat(err instanceof Error ? err.message : 'Gagal menyimpan tanggapan');
    } finally {
      setKirim(false);
    }
  };

  const reset = () => { setIsi(''); setBerkas([]); setStatus('tetap'); setGalatLokal(''); };

  const tombol = tolak ? 'Tolak pengaduan' : hanyaStatus ? 'Simpan status' : 'Kirim tanggapan';

  return (
    <form onSubmit={submit} className={styles.form} aria-label="Tanggapi pelapor" noValidate>
      <h3 className={styles.judul}>{tutup ? 'Tambah tanggapan' : 'Tanggapi pelapor'}</h3>

      <fieldset className={styles.status} disabled={kirim}>
        <legend className={styles.legenda}>Status setelah ini</legend>
        <div className={styles.pilihan}>
          {pilihan.map((p) => (
            <label key={p.nilai} className={`${styles.pilihanItem} ${status === p.nilai ? styles.pilihanAktif : ''}`}>
              <input type="radio" name={`${idDasar}-status`} value={p.nilai} checked={status === p.nilai} onChange={() => setStatus(p.nilai)} />
              {p.label}
            </label>
          ))}
        </div>
        <p className={styles.bantuan}>{pilihan.find((p) => p.nilai === status)?.bantuan}</p>
      </fieldset>

      <Field
        label={`${tolak ? 'Alasan penolakan' : 'Tanggapan untuk pelapor'}${isiWajib ? '' : ' (boleh dikosongkan)'}`}
        wajib={isiWajib}
        bantuan={`${tolak ? 'Alasan ini dikirim ke pelapor. ' : ''}Tanggapan dan lampiran dapat dilihat siapa pun yang memegang nomor laporan. Jangan cantumkan data pribadi.`}
      >
        <textarea className="input" rows={4} maxLength={2000} value={isi} onChange={(e) => setIsi(e.target.value)} disabled={kirim} />
      </Field>

      <div className={styles.lampiran}>
        <input ref={inputRef} type="file" hidden multiple accept={MIME_OK.join(',')} onChange={(e) => { pilih(e.target.files); e.target.value = ''; }} />
        <Tombol ukuran="kecil" varian="sekunder" ikon={Paperclip} onClick={() => inputRef.current?.click()} disabled={berkas.length >= 3 || kirim}>
          Lampiran ({berkas.length}/3)
        </Tombol>
        {berkas.map((f, i) => (
          <Lencana key={`${f.name}-${i}`} nada="netral">
            {f.name.slice(0, 24)}
            <button type="button" className={styles.hapusBerkas} aria-label={`Hapus ${f.name}`} onClick={() => setBerkas(berkas.filter((_, j) => j !== i))} disabled={kirim}>
              <X size={12} aria-hidden="true" />
            </button>
          </Lencana>
        ))}
      </div>

      <label className={`${styles.centang} ${bisaEmail ? '' : styles.centangMati}`}>
        <input type="checkbox" checked={bisaEmail && email} disabled={!bisaEmail || kirim} onChange={(e) => setEmail(e.target.checked)} />
        Kirim juga ke email pelapor{bisaEmail ? '' : ' (tidak tersedia: pelapor anonim atau tanpa email)'}
      </label>

      {galatLokal && <p role="alert" className={styles.galat}>{galatLokal}</p>}

      <div>
        <Tombol type="submit" varian={tolak ? 'bahaya' : 'utama'} ukuran="kecil" ikon={Send} memuat={kirim} disabled={!bisaKirim && !kirim}>
          {tombol}
        </Tombol>
      </div>
    </form>
  );
}
