'use client';

// Kotak Masuk Investasi (spec IPRO PTSP §7.3): satu isi untuk /admin/investasi-leads dan /petugas/investasi/kotak-masuk.
// Daftar = _hook/useDaftarMinat, panel detail = KotakMasukPanel (?id=<lead> membuka panel langsung dari tautan email).
import { Suspense, useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Inbox } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import IsiHalaman from '@/components/layout/IsiHalaman';
import Kartu from '@/components/ui/Kartu';
import Tabel from '@/components/ui/Tabel';
import Tombol from '@/components/ui/Tombol';
import Lencana from '@/components/ui/Lencana';
import Field from '@/components/ui/Field';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Galat from '@/components/ui/Galat';
import Pagination from '@/components/Pagination';
import { capWaktuWIB } from '@/lib/time';
import type { MinatRingkas } from '@/lib/data/investasi';
import { useDaftarMinat } from './_hook/useDaftarMinat';
import KotakMasukPanel from './KotakMasukPanel';
import {
  LABEL_JENIS, LABEL_STATUS, OPSI_STATUS, UKURAN_HALAMAN_KOTAK_MASUK, judulKonteks, labelStatus, nadaStatus,
  type SaringanJenis, type SaringanStatus,
} from './KotakMasukLogika';
import styles from './KotakMasuk.module.css';

export interface KotakMasukProps {
  /** Tujuan tautan "Kembali ke Dasbor": '/admin' (admin) atau '/petugas' (petugas). */
  hrefDasbor?: string;
}

function KotakMasukIsi({ hrefDasbor = '/admin' }: KotakMasukProps) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const daftar = useDaftarMinat();
  // Panel terbuka dari ?id= (tautan email) atau dari klik baris. Menutup panel menghapus ?id= dari alamat.
  const idUrl = sp.get('id');
  const [idPilihan, setIdPilihan] = useState<string | null>(null);
  const [idDitutup, setIdDitutup] = useState<string | null>(null);
  const idPanel = idPilihan ?? (idUrl && idUrl !== idDitutup ? idUrl : null);

  const buka = useCallback((id: string) => { setIdPilihan(id); }, []);
  const tutup = useCallback(() => {
    setIdPilihan(null);
    setIdDitutup(idUrl);
    if (idUrl) router.replace(pathname);
  }, [idUrl, pathname, router]);

  const { baris, total, memuat, galat, muat, perbaruiBaris } = daftar;
  const adaCari = daftar.cari.trim() !== '';

  const subjudul = galat
    ? 'Kotak masuk belum dapat dimuat.'
    : `${total} pesan${daftar.status !== 'semua' ? ` berstatus ${LABEL_STATUS[daftar.status]}` : ''}`;

  return (
    <>
      <PageHeader
        title="Kotak Masuk Investasi"
        description="Pesan minat investasi dari proyek IPRO dan Investment Gallery"
        meta={subjudul}
        kembali={{ href: hrefDasbor, label: 'Kembali ke Dasbor' }}
      />
      <IsiHalaman>
        <div className={styles.saringan} role="search" aria-label="Saring kotak masuk">
          <Field label="Jenis">
            <select value={daftar.jenis} onChange={(e) => daftar.setJenis(e.target.value as SaringanJenis)}>
              <option value="semua">Semua jenis</option>
              <option value="ipro">{LABEL_JENIS.ipro}</option>
              <option value="dokumen">{LABEL_JENIS.dokumen}</option>
            </select>
          </Field>
          <Field label="Status">
            <select value={daftar.status} onChange={(e) => daftar.setStatus(e.target.value as SaringanStatus)}>
              <option value="semua">Semua status</option>
              {OPSI_STATUS.map((s) => <option key={s} value={s}>{LABEL_STATUS[s]}</option>)}
            </select>
          </Field>
          <Field label="Cari nama, email, instansi">
            <input type="search" maxLength={200} value={daftar.cari} onChange={(e) => daftar.setCari(e.target.value)} />
          </Field>
        </div>

        <Kartu judul="Pesan masuk" padding="tanpa">
          {memuat ? <Skeleton bentuk="baris" jumlah={5} label="Memuat kotak masuk" /> : galat ? (
            <Galat pesan={galat} onRetry={() => { void muat(); }} />
          ) : (
            <>
              <Tabel<MinatRingkas>
                caption="Pesan minat investasi (waktu WIB)"
                baris={baris}
                kunciBaris="id"
                kartuDiHp
                kosong={<StatusKosong ikon={Inbox} judul={adaCari ? 'Tidak ada pesan yang cocok' : 'Belum ada pesan masuk'}
                  isi={adaCari ? 'Coba nama, email, atau instansi lain.' : undefined} />}
                kolom={[
                  { kunci: 'jenis', judul: 'Jenis', render: (r) => <Lencana nada={r.kanal === 'ipro' ? 'primer' : 'netral'}>{LABEL_JENIS[r.kanal]}</Lencana> },
                  { kunci: 'konteks', judul: 'Proyek / dokumen', render: (r) => judulKonteks(r)
                    ?? <span className={styles.konteksKosong}>Tidak tersedia</span> },
                  { kunci: 'nama', judul: 'Nama', judulBaris: true, peran: 'utama', render: (r) => (
                    <span className={styles.konteks}><span>{r.nama}</span>{r.instansi && <span className={styles.konteksKosong}>{r.instansi}</span>}</span>
                  ) },
                  { kunci: 'waktu', judul: 'Masuk', render: (r) => capWaktuWIB(new Date(r.created_at)) },
                  { kunci: 'status', judul: 'Status', render: (r) => <Lencana nada={nadaStatus(r.status)}>{labelStatus(r.status)}</Lencana> },
                  { kunci: 'aksi', judul: 'Aksi', peran: 'aksi', render: (r) => (
                    <Tombol varian="sekunder" ukuran="kecil" onClick={() => buka(r.id)} aria-label={`Buka pesan dari ${r.nama}`}>Buka</Tombol>
                  ) },
                ]}
              />
              <Pagination page={daftar.halaman} pageSize={UKURAN_HALAMAN_KOTAK_MASUK} total={total} onPageChange={daftar.setHalaman} />
            </>
          )}
        </Kartu>
      </IsiHalaman>

      <KotakMasukPanel
        id={idPanel}
        onTutup={tutup}
        saatStatusBerubah={perbaruiBaris}
        saatMuatUlang={() => { void muat(); }}
      />
    </>
  );
}

// useSearchParams menuntut Suspense (guide Next.js: use-search-params).
export default function KotakMasuk(props: KotakMasukProps) {
  return (
    <Suspense fallback={null}>
      <KotakMasukIsi {...props} />
    </Suspense>
  );
}
