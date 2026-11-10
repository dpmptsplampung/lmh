'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Dialog from '@/components/ui/Dialog';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import { PemilikError, hasilBelumPasti, kirimPemilik, pemilikRequest } from './api';
import type { MutasiKlaim, StatusPemilik } from '@/lib/umkm-katalog/types-g5';
import styles from './pemilik.module.css';
import gaya from './KlaimUsaha.module.css';

// Tombol hanya tampil bila tahap C aktif (route tahap menjawab berhasil). Galat apa pun berarti belum aktif.
function useTahapC() {
  const [aktif, setAktif] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void pemilikRequest<{ aktif: boolean }>('/tahap', { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setAktif(data?.aktif === true); })
      .catch(() => { if (!controller.signal.aborted) setAktif(false); });
    return () => controller.abort();
  }, []);
  return aktif;
}

// Tombol kecil di profil katalog. Klaim tidak memberi hak apa pun sampai petugas memastikan penanggung jawab.
export default function KlaimUsaha({ profilId, profilNama }: { profilId: string; profilNama: string }) {
  const tahapC = useTahapC();
  return tahapC ? <TombolKlaim profilId={profilId} profilNama={profilNama} /> : null;
}

function TombolKlaim({ profilId, profilNama }: { profilId: string; profilNama: string }) {
  const [terbuka, setTerbuka] = useState(false);
  const [alasan, setAlasan] = useState('');
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<PemilikError | null>(null);
  const [selesai, setSelesai] = useState<StatusPemilik | null>(null);
  const operasi = useRef<string | null>(null);
  const tutup = () => { if (!busy) { setTerbuka(false); setGalat(null); } };
  const kirim = async () => {
    const teks = alasan.trim();
    if (!teks) { setGalat(new PemilikError('INPUT_TIDAK_VALID', 400)); return; }
    setBusy(true); setGalat(null);
    operasi.current ??= crypto.randomUUID();
    try {
      const hasil = await kirimPemilik<MutasiKlaim>('/klaim',
        { profil_id: profilId, alasan: teks, operasi_id: operasi.current });
      operasi.current = null; setAlasan(''); setSelesai(hasil.status);
    } catch (e) {
      if (!hasilBelumPasti(e)) operasi.current = null;
      setGalat(e instanceof PemilikError ? e : new PemilikError('GAGAL_INTERNAL', 500));
    } finally { setBusy(false); }
  };
  const terhubung = selesai === 'disetujui';
  return <>
    <p className={gaya.baris}>
      <span>Pemilik usaha ini?</span>
      <Tombol varian="hantu" ukuran="kecil" className={gaya.tombol} onClick={() => setTerbuka(true)}>Ini usaha saya</Tombol>
    </p>
    <Dialog terbuka={terbuka} onTutup={tutup} dikunci={busy}
      judul={!selesai ? 'Ini usaha saya' : terhubung ? 'Usaha terhubung' : 'Klaim diterima'}
      deskripsi={selesai ? undefined : `Jelaskan singkat mengapa Anda penanggung jawab ${profilNama}. `
        + 'Petugas memeriksa klaim sebelum Anda dapat mengubah profil.'}
      kaki={selesai ? <Tombol href="/me/usaha">Lihat Usaha saya</Tombol> : <div className={styles.aksi}>
        <Tombol varian="hantu" onClick={tutup} disabled={busy}>Batal</Tombol>
        <Tombol memuat={busy} onClick={() => void kirim()}>Kirim klaim</Tombol>
      </div>}>
      {selesai ? <p>{terhubung ? 'Profil ini sudah terhubung ke akun Anda'
        : 'Petugas akan memeriksa klaim Anda. Status dapat dilihat di halaman Usaha saya.'}</p> : <>
        <Field label="Alasan singkat" bantuan="Maksimal 240 karakter. Jangan menulis nomor telepon atau email.">
          <textarea value={alasan} maxLength={240} rows={3}
            onChange={(e) => { operasi.current = null; setAlasan(e.target.value); }} />
        </Field>
        {galat && <p role="alert" className={styles.galat}>
          {galat.code === 'INPUT_TIDAK_VALID'
            ? (alasan.trim() ? 'Alasan tidak boleh memuat nomor telepon atau email. Hapus lalu kirim lagi.'
              : 'Alasan wajib diisi.')
            : galat.message}
          {galat.status === 401 && <>{' '}<Link href={`/login?next=${encodeURIComponent(`/umkm/katalog/${profilId}`)}`}>
            Masuk</Link></>}
        </p>}
      </>}
    </Dialog>
  </>;
}
