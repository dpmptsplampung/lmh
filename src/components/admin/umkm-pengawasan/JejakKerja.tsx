'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import Galat from '@/components/ui/Galat';
import type { DaftarJejakPengawasan } from '@/lib/umkm-katalog/types';
import { formatTanggalWaktu } from '@/lib/utils';
import { PengawasanError, pengawasanRequest } from './api';
import { AKSI_PERMINTAAN, LABEL_PERMINTAAN, type RujukanPermintaan } from './permintaan-types';
import styles from './pengawasan.module.css';

const ACTIONS: Record<string, string> = {
  simpan: 'Data profil disimpan', ambil: 'Tugas diambil', putusan: 'Keputusan profil',
  visibilitas: 'Visibilitas diperbarui', izin: 'Izin diperbarui', akses_kontak: 'Kontak dibaca petugas',
  atur_pemeriksa: 'Pemeriksa diperbarui', selesai: 'Tugas selesai',
  darurat_sembunyikan: 'Profil disembunyikan', darurat_catat_pencabutan: 'Pencabutan izin dicatat',
  selesai_mendesak: 'Pemeriksaan mendesak selesai',
};

export default function JejakKerja({ refresh, onTahan }: {
  refresh: number; onTahan: (permintaan: RujukanPermintaan) => void;
}) {
  const [data, setData] = useState<DaftarJejakPengawasan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async (cursor?: string) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(''); setData(null);
    try {
      const result = await pengawasanRequest<DaftarJejakPengawasan>(
        `/jejak${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal: controller.signal },
      );
      if (!controller.signal.aborted) setData(result);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof PengawasanError ? e.message : 'Jejak belum dapat dimuat.');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pemuatan jejak setelah halaman atau tindakan berubah
    void load();
    return () => request.current?.abort();
  }, [load, refresh]);
  return <Kartu judul="Jejak kerja" aksi={<Tombol varian="hantu" onClick={() => void load()}>Muat ulang jejak</Tombol>}>
    {loading && <p role="status">Memuat jejak kerja...</p>}
    {error && <Galat pesan={error} onRetry={() => void load()} />}
    {data && (data.items.length === 0 ? <p>Belum ada jejak kerja</p> : <ol className={styles.daftar}>
      {data.items.map((row) => {
        const item = row;
        const permintaan = item.permintaan_id ? item : null;
        const bisaTahan = permintaan && permintaan.permintaan_versi != null && permintaan.permintaan_status != null
          && ['diajukan', 'menunggu_izin', 'nomor_dibuka'].includes(permintaan.permintaan_status);
        return <li key={item.id} className={styles.jejak}>
        <strong>{(permintaan ? AKSI_PERMINTAAN[item.aksi] : ACTIONS[item.aksi]) ?? 'Tindakan tercatat'}</strong>
        <p>{item.profil_nama}{permintaan?.permintaan_kode ? `. Permintaan ${permintaan.permintaan_kode}` : ''}</p>
        {permintaan?.permintaan_status && <p>Status permintaan sekarang: {LABEL_PERMINTAAN[permintaan.permintaan_status]}</p>}
        <p className={styles.meta}>{item.aktor_nama} · {item.peran === 'front_office' ? 'Front Office'
          : item.peran === 'admin' ? 'Admin' : 'Petugas'} · <time dateTime={item.dibuat_pada}>
          {formatTanggalWaktu(item.dibuat_pada)} WIB</time></p>
        {(item.status_lama || item.status_baru) && <p>Status: {item.status_lama ?? 'belum ada'} →
          {' '}{item.status_baru ?? 'tidak berubah'}</p>}
        {item.alasan && <p>Alasan: {item.alasan}</p>}
        {bisaTahan && <div><Tombol varian="bahaya" ukuran="kecil" aria-label={`Tahan permintaan ${permintaan.permintaan_kode ?? ''}`.trim()}
          onClick={() => onTahan({
          id: permintaan.permintaan_id!, versi: permintaan.permintaan_versi!, status: permintaan.permintaan_status!,
          kode: permintaan.permintaan_kode ?? null,
        })}>Tahan permintaan</Tombol></div>}
      </li>; })}
    </ol>)}
    {data?.next_cursor && <Tombol varian="sekunder" onClick={() => void load(data.next_cursor!)}>
      Jejak berikutnya
    </Tombol>}
  </Kartu>;
}
