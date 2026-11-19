'use client';

// Panel samping detail satu pesan minat. Seluruh PII (email, HP, pesan lengkap) hanya tampil di sini.
import { useState } from 'react';
import { Mail } from 'lucide-react';
import PanelSamping from '@/components/ui/PanelSamping';
import Tombol from '@/components/ui/Tombol';
import Lencana from '@/components/ui/Lencana';
import Field from '@/components/ui/Field';
import Skeleton from '@/components/ui/Skeleton';
import Galat from '@/components/ui/Galat';
import { capWaktuWIB } from '@/lib/time';
import type { MinatDetail } from '@/lib/data/investasi';
import { useDetailMinat, type HasilUbahStatus } from './_hook/useDetailMinat';
import {
  LABEL_JENIS, LABEL_STATUS, OPSI_STATUS, adalahStatusMinat, judulKonteks, labelStatus, nadaStatus, tautanBalas, tautanEmail,
  type StatusMinat,
} from './KotakMasukLogika';
import styles from './KotakMasuk.module.css';

const wib = (iso: string) => capWaktuWIB(new Date(iso));

function Butir({ label, lebar, children }: { label: string; lebar?: boolean; children: React.ReactNode }) {
  return (
    <div className={lebar ? `${styles.butirDetail} ${styles.butirLebar}` : styles.butirDetail}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function FormStatus({ detail, menyimpan, galat, konflik, berhasil, onSimpan, onMuatUlang }: {
  detail: MinatDetail; menyimpan: boolean; galat: string; konflik: boolean; berhasil: string;
  onSimpan: (status: StatusMinat) => void; onMuatUlang: () => void;
}) {
  // Dipasang ulang (key di pemanggil) tiap status/versi berubah, jadi pilihan awal selalu = status tersimpan.
  const [pilihan, setPilihan] = useState<StatusMinat>(adalahStatusMinat(detail.status) ? detail.status : 'baru');
  return (
    <div className={styles.formStatus}>
      <div className={styles.barisStatus}>
        <Field label="Status penanganan">
          <select value={pilihan} onChange={(e) => setPilihan(e.target.value as StatusMinat)} disabled={menyimpan}>
            {OPSI_STATUS.map((s) => <option key={s} value={s}>{LABEL_STATUS[s]}</option>)}
          </select>
        </Field>
        <Tombol memuat={menyimpan} disabled={pilihan === detail.status && !menyimpan} onClick={() => onSimpan(pilihan)}>
          Simpan status
        </Tombol>
      </div>
      {galat && (
        <div role="alert">
          <p className={styles.pesanGalat}>{galat}</p>
          {konflik && <Tombol varian="sekunder" ukuran="kecil" onClick={onMuatUlang}>Muat ulang pesan</Tombol>}
        </div>
      )}
      {berhasil && <p role="status" className={styles.pesanSukses}>{berhasil}</p>}
    </div>
  );
}

export interface KotakMasukPanelProps {
  id: string | null;
  onTutup: () => void;
  saatStatusBerubah: (id: string, hasil: HasilUbahStatus) => void;
  /** Dipanggil setelah detail dimuat ulang (mis. selepas konflik) agar daftar ikut disegarkan. */
  saatMuatUlang: () => void;
}

export default function KotakMasukPanel({ id, onTutup, saatStatusBerubah, saatMuatUlang }: KotakMasukPanelProps) {
  const { detail, memuat, galatMuat, menyimpan, galatSimpan, konflik, berhasil, simpanStatus, muatUlang } =
    useDetailMinat(id, saatStatusBerubah);
  const konteks = detail ? judulKonteks(detail) : null;
  const email = detail ? tautanEmail(detail.email) : null;
  const balas = detail ? tautanBalas(detail.email, konteks) : null;

  const muatUlangSemua = () => { void muatUlang(); saatMuatUlang(); };

  return (
    <PanelSamping
      terbuka={id !== null}
      onTutup={onTutup}
      judul={detail ? `Pesan dari ${detail.nama}` : 'Detail pesan'}
      deskripsi="Pesan minat investasi dari pengunjung."
      lencanaJudul={detail ? <Lencana nada={nadaStatus(detail.status)}>{labelStatus(detail.status)}</Lencana> : undefined}
      dikunci={menyimpan}
      tutupDenganLatar
      lebar="lebar"
      kaki={
        <div className={styles.kaki}>
          {balas && (
            <Tombol varian="sekunder" ikon={Mail} href={balas} eksternal>
              Balas lewat email
            </Tombol>
          )}
          <Tombol varian="hantu" onClick={onTutup} disabled={menyimpan}>Tutup</Tombol>
        </div>
      }
    >
      {memuat && !detail ? (
        <Skeleton bentuk="baris" jumlah={6} label="Memuat detail pesan" />
      ) : galatMuat ? (
        <Galat pesan={galatMuat} onRetry={() => { void muatUlang(); }} />
      ) : detail ? (
        <div className={styles.detail}>
          <dl className={styles.daftarDetail}>
            <Butir label="Jenis">{LABEL_JENIS[detail.kanal]}</Butir>
            <Butir label={detail.kanal === 'ipro' ? 'Proyek IPRO' : 'Dokumen'}>
              {konteks ?? <span className={styles.konteksKosong}>Telah dihapus atau tidak lagi tersedia</span>}
            </Butir>
            <Butir label="Nama">{detail.nama}</Butir>
            <Butir label="Instansi">{detail.instansi ?? '—'}</Butir>
            <Butir label="Email">
              {email ? <a className={styles.tautan} href={email}>{detail.email}</a> : detail.email}
            </Butir>
            <Butir label="Nomor HP">{detail.no_hp ?? '—'}</Butir>
            <Butir label="Masuk pada">{wib(detail.created_at)}</Butir>
            <Butir label="Aktivitas terakhir">{wib(detail.aktivitas_pada)}</Butir>
            <Butir label="Penangan">{detail.petugas_id ? 'Sudah ditangani petugas' : 'Belum ada penangan'}</Butir>
            <Butir label="Pesan" lebar>
              {detail.catatan
                ? <span className={styles.pesan}>{detail.catatan}</span>
                : <span className={styles.konteksKosong}>Pengirim tidak menulis pesan.</span>}
            </Butir>
            {detail.minat && <Butir label="Minat (isian lama)" lebar>{detail.minat}</Butir>}
          </dl>
          <FormStatus
            key={`${detail.id}:${detail.versi}`}
            detail={detail}
            menyimpan={menyimpan}
            galat={galatSimpan}
            konflik={konflik}
            berhasil={berhasil}
            onSimpan={(s) => { void simpanStatus(s); }}
            onMuatUlang={muatUlangSemua}
          />
        </div>
      ) : null}
    </PanelSamping>
  );
}
