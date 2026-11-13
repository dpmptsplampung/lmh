// Kartu daftar FAQ (refaktor G8, tugas 8.2): keadaan memuat / galat / kosong / tanpa hasil dan butir FAQ berpaginasi.
// Hanya tampilan. Berbentuk daftar kartu (judul, cuplikan jawaban, saklar status, lencana proses bot), bukan tabel,
// sehingga `Tabel` tidak dipakai; paginasi memakai `Pagination` bersama.
import { Edit2, HelpCircle, RefreshCw, Search, Trash2 } from 'lucide-react';
import Pagination from '@/components/Pagination';
import Galat from '@/components/ui/Galat';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Tombol from '@/components/ui/Tombol';
import type { FAQ } from '@/components/admin/faq/types';
import { formatTanggal } from '@/lib/utils';
import { UKURAN_HALAMAN } from '../_logika/saringFaq';
import styles from '../faq.module.css';

export interface DaftarFaqProps {
  memuat: boolean;
  muatGagal: boolean;
  onMuatUlang: () => void;
  /** Jumlah FAQ sebelum disaring. */
  jumlahSemua: number;
  /** FAQ lolos saring (semua halaman). */
  jumlahTampil: number;
  halamanIni: readonly FAQ[];
  halaman: number;
  onHalaman: (halaman: number) => void;
  adaFilter: boolean;
  onResetFilter: () => void;
  isFrontOffice: boolean;
  isPetugas: boolean;
  namaLayanan: ReadonlyMap<string, string>;
  menungguIds: ReadonlySet<string>;
  memprosesIds: ReadonlySet<string>;
  togglingId: string | null;
  onUbah: (faq: FAQ) => void;
  onHapus: (faq: FAQ) => void;
  onAlihAktif: (faq: FAQ) => void;
  onProses: (faqId: string) => void;
}

export default function DaftarFaq(p: DaftarFaqProps) {
  return (
    <div className={styles.kartu}>
      {p.memuat ? (
        <div className={styles.memuat} role="status"><Skeleton bentuk="baris" jumlah={5} label="Memuat daftar FAQ…" /></div>
      ) : p.muatGagal ? (
        <Galat
          judul="Daftar FAQ belum dapat dimuat"
          pesan="Daftar FAQ gagal dimuat. Periksa koneksi lalu coba lagi."
          onRetry={p.onMuatUlang}
          labelTombol="Coba lagi"
        />
      ) : p.jumlahSemua === 0 ? (
        <StatusKosong ikon={HelpCircle} judul={p.isFrontOffice ? 'Belum ada FAQ umum.' : 'Belum ada FAQ. Tambahkan pertanyaan pertama.'} />
      ) : p.jumlahTampil === 0 ? (
        <div className={styles.kosong}>
          <StatusKosong ikon={Search} judul="Tidak ada FAQ yang cocok dengan pencarian atau filter." />
          {p.adaFilter && (
            <Tombol varian="sekunder" ukuran="kecil" onClick={p.onResetFilter}>
              Hapus pencarian dan filter
            </Tombol>
          )}
        </div>
      ) : (
        <>
          <ul className={styles.daftar} aria-label="Daftar FAQ">
            {p.halamanIni.map((faq) => {
              const menunggu = p.menungguIds.has(faq.id);
              const memproses = p.memprosesIds.has(faq.id);
              return (
                <li key={faq.id} className={styles.butir}>
                  <div className={styles.butirAtas}>
                    <div className={styles.butirTeks}>
                      <h3 className={styles.pertanyaan}>{faq.pertanyaan}</h3>
                      <p className={styles.jawaban}>{faq.jawaban}</p>
                      {faq.dasar_hukum && <p className={styles.dasarHukum}>Dasar hukum: {faq.dasar_hukum}</p>}
                    </div>
                    <div className={styles.aksi}>
                      <Tombol
                        varian="sekunder"
                        ukuran="kecil"
                        ikon={Edit2}
                        aria-label={`Ubah FAQ: ${faq.pertanyaan}`}
                        onClick={() => p.onUbah(faq)}
                      >
                        Ubah
                      </Tombol>
                      {!p.isPetugas && (
                        <Tombol
                          varian="bahaya"
                          ukuran="kecil"
                          ikon={Trash2}
                          aria-label={`Hapus FAQ: ${faq.pertanyaan}`}
                          onClick={() => p.onHapus(faq)}
                        >
                          Hapus
                        </Tombol>
                      )}
                    </div>
                  </div>
                  <div className={styles.meta}>
                    <span className={styles.cakupan}>
                      {faq.layanan_id === null ? 'Semua layanan' : (p.namaLayanan.get(faq.layanan_id) ?? 'Layanan')}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={faq.aktif}
                      aria-label={`Status FAQ: ${faq.pertanyaan}`}
                      className={`badge ${styles.saklar} ${faq.aktif ? 'badge--published' : 'badge--nonaktif'}`}
                      onClick={() => p.onAlihAktif(faq)}
                      disabled={p.togglingId === faq.id}
                      title={faq.aktif ? 'Klik untuk menonaktifkan' : 'Klik untuk mengaktifkan'}
                    >
                      {faq.aktif ? 'Aktif' : 'Nonaktif'}
                    </button>
                    {menunggu && (
                      <>
                        <span className="badge badge--pending">
                          {memproses ? 'Sedang diproses bot…' : 'Menunggu diproses bot'}
                        </span>
                        <Tombol
                          varian="hantu"
                          ukuran="kecil"
                          ikon={RefreshCw}
                          aria-label={`Coba proses lagi FAQ: ${faq.pertanyaan}`}
                          onClick={() => p.onProses(faq.id)}
                          disabled={memproses}
                          memuat={memproses}
                        >
                          Coba lagi
                        </Tombol>
                      </>
                    )}
                    {faq.updated_at && <span>Diubah {formatTanggal(faq.updated_at)}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination page={p.halaman} pageSize={UKURAN_HALAMAN} total={p.jumlahTampil} onPageChange={p.onHalaman} />
        </>
      )}
    </div>
  );
}
