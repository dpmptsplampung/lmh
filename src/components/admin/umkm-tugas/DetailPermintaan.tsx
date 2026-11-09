'use client';

import { useEffect, useRef, useState } from 'react';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import Field from '@/components/ui/Field';
import Lencana from '@/components/ui/Lencana';
import { templatPemberitahuanPemohon } from '@/lib/umkm-katalog/templat-whatsapp';
import { formatTanggalWaktu, waLink } from '@/lib/utils';
import { asalTautan } from './asal-tautan';
import { hasilBelumPasti, kirimTugas, TugasError } from './api';
import NomorTugas from './NomorTugas';
import {
  LABEL_STATUS_PERMINTAAN, type DetailPermintaan, type HasilPembukaan, type MutasiPermintaan,
} from './permintaan-types';
import styles from './umkm-tugas.module.css';

const LABEL_HASIL: Record<HasilPembukaan, string> = {
  belum_diketahui: 'Belum diketahui', kerja_sama: 'Kerja sama', tidak_berlanjut: 'Tidak berlanjut',
};

// Teks minta izin: ALUR-DAN-PERAN bagian 8. Tanpa nomor UMKM.
export function teksMintaIzin(d: DetailPermintaan) {
  return `Halo ${d.profil_nama}, saya ${d.pemeriksa_nama}, petugas UMKM DPMPTSP Provinsi Lampung. `
    + `${d.perusahaan.nama} ingin membeli ${d.kebutuhan.teks}. `
    + 'Bolehkah nomor Anda kami tampilkan untuk perusahaan yang sudah kami periksa? '
    + `Izin dapat dicabut kapan saja. Kode: ${d.kode}.`;
}

type Props = {
  detail: DetailPermintaan; onBack: () => void; onRefresh: () => void;
  onChanged: (pesan: string, tutup: boolean) => Promise<void>;
};

export default function DetailPermintaanLayar({ detail, onBack, onRefresh, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TugasError | null>(null);
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState('');
  const [origin, setOrigin] = useState('');
  const [catatGagal, setCatatGagal] = useState(false);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const mounted = useRef(true);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    mounted.current = true; titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- asal tautan dibaca setelah komponen ada di peramban
    setOrigin(asalTautan());
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (reject) reasonRef.current?.focus(); }, [reject]);

  // Satu pintu semua pemanggilan: kunci operasi stabil selama hasilnya belum pasti.
  const kirim = async (path: string, body: Record<string, unknown>, versi: number | null,
    berhasil: (hasil: MutasiPermintaan) => Promise<void> | void) => {
    if (busy) return;
    setBusy(true); setError(null);
    const signature = JSON.stringify([path, versi, body]);
    if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    try {
      const payload = versi === null ? body : { ...body, expected_version: versi, operasi_id: operation.current.id };
      const hasil = await kirimTugas<MutasiPermintaan>(path, payload);
      operation.current = null;
      if (mounted.current) await berhasil(hasil);
    } catch (e) {
      if (!hasilBelumPasti(e)) operation.current = null;
      if (mounted.current) setError(e instanceof TugasError ? e : new TugasError('GAGAL_INTERNAL', 500));
    } finally { if (mounted.current) setBusy(false); }
  };
  const dasar = `/permintaan/${detail.id}`;
  const keputusan = (aksi: 'ambil' | 'setujui' | 'tolak' | 'lepas-tahan', ekstra: Record<string, unknown> = {}) =>
    kirim(`${dasar}/${aksi}`, ekstra, detail.versi, async (hasil) => {
      const selesai = aksi === 'tolak' || (aksi === 'setujui' && hasil.status === 'nomor_dibuka');
      const pesan = aksi === 'tolak' ? 'Permintaan ditolak.'
        : aksi === 'lepas-tahan' ? 'Tahan dilepas.'
          : aksi === 'ambil' ? 'Permintaan diambil.'
            : hasil.status === 'nomor_dibuka' ? 'Nomor dibuka di akun pemohon. Kirim pemberitahuan WhatsApp.'
              : 'Menunggu izin UMKM. Ikuti langkah di bawah.';
      await onChanged(pesan, aksi === 'tolak' ? selesai : false);
    });
  const catatIzin = () => kirim(`/${detail.profil_id}/izin`, { status: 'diberikan' }, detail.profil_versi,
    async () => { await onChanged('Izin UMKM dicatat. Tekan Setujui lagi.', false); });
  const catatHasil = (hasil: Exclude<HasilPembukaan, 'belum_diketahui'>) => kirim(`${dasar}/hasil`, { hasil }, null,
    async () => { await onChanged('Hasil dicatat.', false); });

  // Hanya mencatat usaha pemberitahuan. Gagal dicatat tidak berarti pesan gagal terkirim, dan sebaliknya.
  const catatPemberitahuan = async () => {
    try { await kirimTugas(`${dasar}/pemberitahuan`, {}); if (mounted.current) setCatatGagal(false); }
    catch { if (mounted.current) setCatatGagal(true); }
  };

  const teksPemberitahuan = () => templatPemberitahuanPemohon({
    namaPemohon: detail.pemohon.nama, namaPetugas: detail.pemeriksa_nama, kodePermintaan: detail.kode,
    namaUmkm: detail.profil_nama, tautanMasuk: `${origin}/me/umkm`,
  });
  const salin = async (teks: string, label: string) => {
    try { await navigator.clipboard.writeText(teks); if (mounted.current) setCopied(`${label} disalin.`); }
    catch { if (mounted.current) setCopied('Belum dapat menyalin. Pilih teks dan salin manual.'); }
  };

  const aktif = detail.status === 'diajukan' || detail.status === 'menunggu_izin';
  const tahan = detail.mendesak;
  const pegang = detail.dipegang_saya;
  const menunggu = detail.status === 'menunggu_izin';
  const bantuan = detail.bantuan;

  const langkahIzin = pegang && menunggu && <section className={styles.bagian} aria-label="Langkah izin UMKM">
    <h3>Menunggu izin UMKM</h3>
    <p>UMKM belum memberi izin. Ikuti empat langkah ini.</p>
    <ol className={styles.langkah}>
      <li><strong>Lihat nomor.</strong> Pembukaan nomor tercatat atas nama Anda.
        <NomorTugas key={detail.profil_id} id={detail.profil_id} /></li>
      <li><strong>Tanya UMKM lewat WhatsApp pribadi Anda.</strong>
        <p className={styles.template}>{teksMintaIzin(detail)}</p>
        <Tombol varian="sekunder" onClick={() => void salin(teksMintaIzin(detail), 'Teks minta izin')}>
          Salin teks minta izin</Tombol></li>
      <li><strong>Catat izin</strong> setelah UMKM setuju.
        <div className={styles.aksi}>
          <Tombol varian="sekunder" memuat={busy} onClick={() => void catatIzin()}>Catat izin diberikan</Tombol>
          {detail.izin_ada && <Lencana nada="sukses">Izin tercatat</Lencana>}
        </div></li>
      <li><strong>Tekan Setujui lagi</strong> pada bagian keputusan di bawah.</li>
    </ol>
    <p role="status">{copied}</p>
  </section>;

  const bagianKeputusan = pegang && aktif && <section className={styles.bagian} aria-label="Keputusan permintaan">
    <h3>Keputusan</h3>
    {tahan ? <>
      <p className={styles.peringatan} role="status">
        Permintaan ini ditahan dan mendesak. Setujui tersedia setelah tahan dilepas.</p>
      <div className={styles.aksi}>
        <Tombol varian="bahaya" disabled={busy} onClick={() => setReject(true)}>Tolak</Tombol>
      </div>
    </> : <div className={styles.aksi}>
      <Tombol memuat={busy} onClick={() => void keputusan('setujui')}>{menunggu ? 'Setujui lagi' : 'Setujui'}</Tombol>
      <Tombol varian="bahaya" disabled={busy} onClick={() => setReject(true)}>Tolak</Tombol>
    </div>}
    {reject && <form className={styles.keputusan} onSubmit={(e) => {
      e.preventDefault(); if (reason.trim()) void keputusan('tolak', { alasan: reason.trim() });
    }}>
      <Field label="Alasan tolak" wajib bantuan="Singkat, tanpa nomor atau informasi kontak.">
        <textarea ref={reasonRef} value={reason} required maxLength={240}
          onChange={(e) => { operation.current = null; setReason(e.target.value); }} />
      </Field>
      <div className={styles.aksi}>
        <Tombol type="submit" varian="bahaya" memuat={busy}>Kirim penolakan</Tombol>
        <Tombol varian="hantu" disabled={busy}
          onClick={() => { operation.current = null; setReject(false); setReason(''); }}>Batal menolak</Tombol>
      </div>
    </form>}
  </section>;

  // Lepas tahan berlaku di status apa pun, termasuk nomor dibuka atau sudah dibatalkan.
  const bagianTahan = pegang && tahan && <section className={styles.bagian} aria-label="Permintaan ditahan">
    {!aktif && <p className={styles.peringatan} role="status">
      Permintaan ini ditahan dan mendesak. Lepas tahan bila sudah boleh dilanjutkan.</p>}
    <div className={styles.aksi}>
      <Tombol memuat={busy} onClick={() => void keputusan('lepas-tahan')}>Lepas tahan</Tombol>
    </div>
  </section>;

  const bagianNomor = detail.status === 'nomor_dibuka' && <section className={styles.bagian}
    aria-label="Sesudah nomor dibuka">
    <h3>Nomor sudah dibuka</h3>
    {detail.pembukaan && <p>Dibuka {detail.pembukaan.petugas_nama} pada{' '}
      {formatTanggalWaktu(detail.pembukaan.dibuat_pada)} WIB.
      Hasil: {LABEL_HASIL[detail.pembukaan.hasil]}.</p>}
    {detail.pemohon.hp && pegang && <>
      <p className={styles.meta}>Tombol membuka WhatsApp Anda untuk memberi tahu pemohon.
        Pesan tidak memuat nomor UMKM.</p>
      <div className={styles.aksi}>
        <Tombol href={waLink(detail.pemohon.hp, teksPemberitahuan())} eksternal target="_blank"
          rel="noopener noreferrer" varian="sekunder"
          onClick={() => { void catatPemberitahuan(); }}>
          Kirim pemberitahuan WhatsApp</Tombol>
      </div>
      {catatGagal && <div role="status" className={styles.peringatan}>
        <p>Pemberitahuan belum tercatat.</p>
        <Tombol varian="sekunder" onClick={() => void catatPemberitahuan()}>Catat lagi</Tombol>
      </div>}</>}
    {!detail.pemohon.hp && <p className={styles.meta}>Pemohon tidak punya HP tercatat. Beri tahu lewat cara lain.</p>}
    {pegang && <div className={styles.aksi} role="group" aria-label="Hasil kerja sama">
      <span>Hasil:</span>
      {(['kerja_sama', 'tidak_berlanjut'] as const).map((h) => <Tombol key={h} varian="sekunder" disabled={busy}
        aria-pressed={detail.pembukaan?.hasil === h} onClick={() => void catatHasil(h)}>{LABEL_HASIL[h]}</Tombol>)}
    </div>}
  </section>;

  return <Kartu><div className={styles.form}>
    <div className={styles.aksi}>
      <Tombol varian="hantu" onClick={onBack}>Kembali ke daftar</Tombol>
      <Lencana>{LABEL_STATUS_PERMINTAAN[detail.status]}</Lencana>
      {tahan && <Lencana nada="peringatan">Mendesak</Lencana>}
    </div>
    <h2 ref={titleRef} tabIndex={-1}>Permintaan {detail.kode}</h2>
    <p className={styles.meta}>Masuk {formatTanggalWaktu(detail.dibuat_pada)} WIB. UMKM: {detail.profil_nama}.</p>
    <div className={styles.aksi}>
      <p>{detail.petugas_nama ? `sedang dipegang ${detail.petugas_nama}` : 'Belum dipegang petugas'}</p>
      {!pegang && (aktif || detail.status === 'nomor_dibuka' || tahan) && <Tombol varian="sekunder" memuat={busy}
        onClick={() => void keputusan('ambil')}>{detail.petugas_id ? 'Ambil alih' : 'Ambil tugas'}</Tombol>}
    </div>
    {error && <div role="alert"><p>{error.message}</p>
      <Tombol varian="sekunder" onClick={onRefresh}>Muat ulang tugas</Tombol></div>}
    {!detail.tertaut && aktif && <p className={styles.peringatan}>
      Pemohon belum menautkan akun. Setujui baru bisa setelah pemohon memasukkan kode tautan.</p>}
    {bantuan && detail.tertaut && <section className={styles.bagian} aria-label="Pembanding bantuan">
      <h3>Cocokkan pemohon</h3>
      <p>Dicatat petugas: {bantuan.nama}, {bantuan.kontak}</p>
      <p>Akun yang menautkan: {detail.pemohon.nama}, {detail.pemohon.hp ?? 'HP tidak ada'},{' '}
        {detail.pemohon.email ?? 'email tidak ada'}</p>
      <p className={styles.peringatan}>Pastikan keduanya orang yang sama sebelum menekan Setujui.</p>
    </section>}
    <dl className={styles.rincian}>
      <dt>Kebutuhan</dt><dd>{detail.kebutuhan.teks}</dd>
      <dt>Kategori</dt><dd>{detail.kebutuhan.kategori}{detail.kebutuhan.kabupaten_kota
        ? `, ${detail.kebutuhan.kabupaten_kota}` : ''}</dd>
      <dt>Perusahaan</dt><dd>{detail.perusahaan.nama}, {detail.perusahaan.jabatan}</dd>
      <dt>Pemeriksaan</dt><dd>{detail.perusahaan.diperiksa ? 'Perusahaan sudah diperiksa'
        : 'Perusahaan belum diperiksa. Setuju pertama menandainya.'}</dd>
      <dt>Pemohon</dt><dd>{detail.pemohon.nama}</dd>
      <dt>HP pemohon</dt><dd>{detail.pemohon.hp ?? 'Tidak ada'}</dd>
      <dt>Email pemohon</dt><dd>{detail.pemohon.email ?? 'Tidak ada'}</dd>
      <dt>Izin UMKM</dt><dd>{detail.izin_ada ? 'Ada' : 'Belum ada'}</dd>
      {detail.alasan_tolak && <><dt>Alasan tolak</dt><dd>{detail.alasan_tolak}</dd></>}
    </dl>
    {langkahIzin}
    {bagianTahan}
    {bagianKeputusan}
    {bagianNomor}
  </div></Kartu>;
}
