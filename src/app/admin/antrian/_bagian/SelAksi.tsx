'use client';

// Sel Aksi / Durasi pada tabel antrean: tombol yang tampil menurut status tiket, peran, dan kepemilikan. Hanya tampilan
// dari props; semua tindakan lewat penangan di `aksi` (hook useAksiAntrean dan useModalAntrian).
// Keputusan CEO 7.5: tidak ada "Lengkapi Data" sebelum Mulai Layanan; draf pendataan hanya ditulis pemilik tiket yang
// sedang dilayani (wizard terbuka otomatis setelah Mulai).
import {
  ArrowRightLeft,
  BellRing,
  CheckCircle2,
  FileEdit,
  FileText,
  Pencil,
  Play,
  QrCode,
  Undo2,
  UserCog,
  Volume2,
} from 'lucide-react';
import Tombol from '@/components/ui/Tombol';
import SurveiStatusBadge from '@/components/admin/SurveiStatusBadge';
import { bolehKoordinatorAmbilAlihTiket } from '@/lib/akses-data/lingkup';
import type { ProfilPetugasAntrean, TiketBaris } from '@/lib/data/antrean';
import {
  bolehAlihkanTiket,
  bolehAmbilAlihTiket,
  bolehKembalikanTiket,
  bolehMulaiTiket,
  bolehSelesaikanTiket,
} from '@/lib/pelayanan';
import type { StatusSurvei } from '@/lib/survei/staf';
import type { JenisModalAntrian } from '../_hook/useModalAntrian';
import { bolehLihatSemuaLayanan, durasiTeks, namaPelayanDari, punyaPendataan } from '../_logika/turunan';
import styles from '../antrian.module.css';

/** Penangan dan keadaan aksi tiket yang dibutuhkan sel aksi (dirakit halaman dari useAksiAntrean + useModalAntrian). */
export interface AksiTiket {
  sedangProses: ReadonlySet<string>;
  sedangPanggil: ReadonlySet<string>;
  /** true bila panggilan tersiar ke layar TV. */
  panggil: (tiketId: string, nomorDisplay: string) => Promise<boolean>;
  mulai: (tiket: TiketBaris) => Promise<void>;
  selesaikan: (tiket: TiketBaris) => Promise<void>;
  buka: (jenis: JenisModalAntrian, tiket: TiketBaris) => void;
}

export interface SelAksiProps {
  tiket: TiketBaris;
  pengguna: ProfilPetugasAntrean | null;
  aksi: AksiTiket;
  /** Status Pesan Perilaku kunjungan tiket (hanya berarti untuk tiket selesai); undefined = belum diketahui. */
  statusSurvei?: StatusSurvei;
}

export default function SelAksi({ tiket: a, pengguna, aksi, statusSurvei }: SelAksiProps) {
  const durasi = durasiTeks(a, new Date());
  const pelayanNama = namaPelayanDari(a);
  const milikSaya = bolehSelesaikanTiket(pengguna, a);
  const sibuk = aksi.sedangProses.has(a.id);
  const memanggil = aksi.sedangPanggil.has(a.id);
  const tombolAlihkan = bolehAlihkanTiket(pengguna, a) && (
    <Tombol
      varian="sekunder"
      ukuran="kecil"
      ikon={ArrowRightLeft}
      onClick={() => aksi.buka('alihkan', a)}
      disabled={sibuk}
      aria-label={`Alihkan tiket ${a.nomor_display} ke layanan lain`}
      title="Pindahkan tiket ini ke layanan lain (Admin; wajib alasan, tercatat di audit)"
    >
      Alihkan
    </Tombol>
  );

  if (a.status === 'menunggu') {
    return (
      <div className={styles.aksi}>
        {/* QUE-17: panggil ulang — emit nomor_dipanggil event */}
        <Tombol
          varian="hantu"
          ukuran="kecil"
          ikon={memanggil ? BellRing : Volume2}
          onClick={() => aksi.panggil(a.id, a.nomor_display)}
          disabled={memanggil}
          title="Panggil ke layar antrean. Bisa diklik lagi untuk memanggil ulang."
        >
          {memanggil ? 'Terpanggil' : 'Panggil'}
        </Tombol>
        {bolehMulaiTiket(pengguna, a) && (
          <Tombol varian="utama" ukuran="kecil" ikon={Play} onClick={() => aksi.mulai(a)} disabled={sibuk} memuat={sibuk}>
            {sibuk ? 'Memproses…' : 'Mulai Layanan'}
          </Tombol>
        )}
        {tombolAlihkan}
      </div>
    );
  }

  if (a.status === 'dilayani') {
    if (milikSaya) {
      return (
        <div className={styles.aksi}>
          {punyaPendataan(a) && (
            <Tombol varian="utama" ukuran="kecil" ikon={FileEdit} onClick={() => aksi.buka('wizard', a)} disabled={sibuk}>
              Form Pendataan
            </Tombol>
          )}
          <Tombol varian="sekunder" ukuran="kecil" ikon={CheckCircle2} onClick={() => aksi.selesaikan(a)} disabled={sibuk} memuat={sibuk}>
            {sibuk ? 'Memproses…' : 'Selesai'}
          </Tombol>
          {bolehKembalikanTiket(pengguna, a) && (
            <Tombol
              varian="hantu"
              ukuran="kecil"
              ikon={Undo2}
              onClick={() => aksi.buka('kembalikanKeFo', a)}
              disabled={sibuk}
              aria-label={`Kembalikan tiket ${a.nomor_display} ke Front Office`}
              title="Kembalikan pengunjung ke kotak masuk Front Office (wajib catatan)"
            >
              Kembalikan ke FO
            </Tombol>
          )}
          {tombolAlihkan}
        </div>
      );
    }
    return (
      <div className={styles.aksiKolom}>
        <small className={styles.catatanAksi}>
          Hanya {pelayanNama ?? 'petugas yang memulai'} yang dapat menyelesaikan tiket ini.
        </small>
        <div className={styles.aksi}>
          {punyaPendataan(a) && (
            <Tombol varian="hantu" ukuran="kecil" ikon={FileText} onClick={() => aksi.buka('wizard', a)}>
              Lihat Data
            </Tombol>
          )}
          {(bolehAmbilAlihTiket(pengguna, a) || bolehKoordinatorAmbilAlihTiket(pengguna, a)) && (
            <Tombol
              varian="sekunder"
              ukuran="kecil"
              ikon={UserCog}
              onClick={() => aksi.buka('ambilAlih', a)}
              disabled={sibuk}
              title={bolehAmbilAlihTiket(pengguna, a)
                ? 'Darurat: jadikan Anda penanggung jawab tiket ini (wajib alasan, tercatat di audit)'
                : 'Koordinator: ambil alih pendataan ini (wajib alasan, tercatat di audit; petugas semula diberi tahu)'}
            >
              Ambil alih
            </Tombol>
          )}
          {tombolAlihkan}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.aksiKolom}>
      <span className={styles.durasi}>{durasi}</span>
      {punyaPendataan(a) && (
        <Tombol varian="hantu" ukuran="kecil" ikon={FileText} onClick={() => aksi.buka('wizard', a)}>
          Lihat Data
        </Tombol>
      )}
      {a.status === 'selesai' && statusSurvei && (
        <div className={styles.surveiBaris}>
          <small className={styles.surveiLabel}>Pesan Perilaku</small>
          <SurveiStatusBadge status={statusSurvei} />
          {statusSurvei === 'belum_diisi' && (
            <Tombol
              varian="sekunder"
              ukuran="kecil"
              ikon={QrCode}
              onClick={() => aksi.buka('surveiQr', a)}
              aria-label={`Tampilkan QR Pesan Perilaku tiket ${a.nomor_display}`}
            >
              Tampilkan QR
            </Tombol>
          )}
        </div>
      )}
      {a.status === 'selesai' && punyaPendataan(a) && (
        bolehLihatSemuaLayanan(pengguna) ? (
          <Tombol
            varian="sekunder"
            ukuran="kecil"
            ikon={Pencil}
            onClick={() => aksi.buka('koreksi', a)}
            title="Koreksi data yang sudah dikunci (wajib alasan, tercatat di riwayat)"
          >
            Koreksi Data
          </Tombol>
        ) : pengguna?.role === 'petugas' && (
          <small className={styles.catatanAksi}>
            Data sudah dikunci. Hubungi Front Office atau Admin untuk koreksi.
          </small>
        )
      )}
    </div>
  );
}
