'use client';

// Halaman antrean admin (WP-22, A3, B4; dipecah di refaktor G5): hanya merakit. Muat + Realtime = _hook/useAntrean,
// tanggal/status/halaman di URL = useFilterAntrian, aksi tiket (RPC atomik) = useAksiAntrean, modal = useModalAntrian
// (satu union), rekap absen = useRekapAbsensi; tampilan di _bagian/, turunan murni di _logika/, query di lib/data/antrean.ts.
// Aturan kepemilikan tiket (Mulai/Selesai, Ambil alih, Alihkan, Kembalikan ke FO) dijelaskan di header useAksiAntrean.
import { Suspense, useState } from 'react';
import { AlertCircle, Clock, TrendingUp, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import IsiHalaman from '@/components/layout/IsiHalaman';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import PemilihTanggal from '@/components/ui/PemilihTanggal';
import CalendarBanner from '@/components/admin/CalendarBanner';
import RoleNote from '@/components/admin/RoleNote';
import PemberitahuanAmbilAlih from '@/components/admin/PemberitahuanAmbilAlih';
import WalkinWizard from '@/components/WalkinWizard';
import { useToast } from '@/components/Toast';
import { jendelaTanggalFo } from '@/lib/fo/akses-antrean';
import { todayWIB } from '@/lib/time';
import { formatWaktu } from '@/lib/utils';
import { judulHalaman, namaLayananProfil, panelBerlaku, tanggalPanjang } from './_logika/turunan';
import { useFilterAntrian } from './_hook/useFilterAntrian';
import { UKURAN_HALAMAN_ANTREAN, useAntrean } from './_hook/useAntrean';
import { useModalAntrian } from './_hook/useModalAntrian';
import { useAksiAntrean } from './_hook/useAksiAntrean';
import { useRekapAbsensi } from './_hook/useRekapAbsensi';
import CatatanPembaruan from './_bagian/CatatanPembaruan';
import DaftarAntrean from './_bagian/DaftarAntrean';
import ModalAntrian from './_bagian/ModalAntrian';
import PanelAntrean from './_bagian/PanelAntrean';
import RekapAbsensi from './_bagian/RekapAbsensi';
import type { AksiTiket } from './_bagian/SelAksi';
import styles from './antrian.module.css';

// A13: tanggal, saringan status, dan halaman ada di URL. useSearchParams menuntut Suspense (guide Next.js: use-search-params).
export default function AntrianPage() {
  return (
    <Suspense fallback={<AntrianMemuat />}>
      <AntrianIsi />
    </Suspense>
  );
}

function AntrianMemuat() {
  return (
    <>
      <PageHeader title="Antrean" description="Memuat antrean…" />
      <IsiHalaman>
        <Skeleton bentuk="kartu" jumlah={2} label="Memuat antrean…" />
      </IsiHalaman>
    </>
  );
}

function AntrianIsi() {
  const { toast } = useToast();
  const { tanggal, filterStatus, halaman, pesanTanggal, ubahTanggal, gantiStatus, gantiHalaman } = useFilterAntrian();
  const {
    antrian, antrianPanel, currentUser, unassigned, loading, menyegarkan, galatMuat, galatSegar, terakhir,
    totalCount, totalHarian, aksesFo, serverStats, catatanEskalasi, statusSurvei, muat, muatSenyap,
  } = useAntrean({ tanggal, filterStatus, halaman });
  const modal = useModalAntrian([antrian, antrianPanel]);
  const { sedangProses, sedangPanggil, pengumuman, panggil, mulai, selesaikan } = useAksiAntrean({
    toast, muatSenyap, buka: modal.buka, bukaQrTiket: modal.bukaQrTiket,
  });
  const rekap = useRekapAbsensi({ tanggal, currentUser });
  const aksi: AksiTiket = { sedangProses, sedangPanggil, panggil, mulai, selesaikan, buka: modal.buka };
  // Panel Sekarang: Layanan yang dipilih Admin/FO (null = Layanan pertama yang punya tiket menunggu).
  const [panelLayananId, setPanelLayananId] = useState<string | null>(null);

  const layananNamaHeader = namaLayananProfil(currentUser);
  // FO non-Koordinator hanya boleh membuka [hari ini-7, hari ini+1] (server menegakkan; di sini mencegah galat).
  const jendelaFo = jendelaTanggalFo(currentUser);
  // Panel Sekarang (A1): hanya untuk hari ini dan saat tab bukan "Selesai" (data panel terpisah dari halaman tabel).
  const tampilPanel = !unassigned && !galatMuat && !loading && panelBerlaku(tanggal, filterStatus, todayWIB());

  return (
    <>
      <PageHeader
        title={judulHalaman(currentUser, layananNamaHeader)}
        description="Urutan kedatangan harian: walk-in dan reservasi (setelah scan)"
        meta={
          <>
            {tanggalPanjang(tanggal)}
            {terakhir && <> · Data terakhir {formatWaktu(terakhir)} WIB</>}
          </>
        }
      >
        <div className={styles.aksiKepala}>
          <WalkinWizard
            fixedLayananId={currentUser?.role === 'petugas' ? currentUser.layanan_id : null}
            onSuccess={muatSenyap}
            triggerLabel="+ Walk-in"
          />
          <PemilihTanggal
            nilai={tanggal}
            onUbah={(nilai) => ubahTanggal(nilai, jendelaFo)}
            label="Tanggal antrean"
            min={jendelaFo?.min}
            max={jendelaFo?.max}
            aria-describedby={pesanTanggal ? 'pesan-tanggal-antrian' : undefined}
          />
        </div>
      </PageHeader>

      <IsiHalaman>
        <CalendarBanner />
        {pesanTanggal && (
          <CatatanKeadaan jenis="galat" judul="Tanggal di luar batas">
            <span id="pesan-tanggal-antrian">{pesanTanggal}</span>
          </CatatanKeadaan>
        )}
        <PemberitahuanAmbilAlih petugasId={currentUser?.id} />
        {currentUser?.role === 'petugas' && layananNamaHeader && (
          <RoleNote>Anda melayani antrean {layananNamaHeader}. Pengunjung layanan lain diatur Front Office.</RoleNote>
        )}
        {unassigned ? (
          <Kartu>
            <StatusKosong ikon={AlertCircle} judul="Belum Ditugaskan" isi="Akun Anda belum ditugaskan ke layanan. Hubungi admin." />
          </Kartu>
        ) : (
          <>
            {tampilPanel && (
              <PanelAntrean
                baris={antrianPanel}
                pengguna={currentUser}
                layananId={panelLayananId}
                onLayananChange={setPanelLayananId}
                aksi={aksi}
              />
            )}

            {/* Statistik (disembunyikan saat galat muat awal: angka nol palsu lebih menyesatkan daripada kosong) */}
            {!galatMuat && (
              <div className={styles.statistik}>
                <KartuStatistik label="Total Tiket" nilai={totalHarian} ikon={Users} memuat={loading} />
                <KartuStatistik label="Selesai Dilayani" nilai={serverStats.totalSelesai} ikon={TrendingUp} memuat={loading} />
                <KartuStatistik label="Rata-rata Durasi" nilai={`${serverStats.rataWaktuMenit} mnt`} ikon={Clock} memuat={loading} />
              </div>
            )}

            <RekapAbsensi
              tanggal={tanggal}
              terbuka={rekap.rekapOpen}
              baris={rekap.rekapAbsensi}
              memuat={rekap.rekapLoading}
              onAlihkan={rekap.alihkan}
              onUnduh={rekap.unduhCsv}
            />

            {galatSegar && !galatMuat && (
              <CatatanPembaruan terakhir={terakhir} menyegarkan={menyegarkan} onMuatUlang={muatSenyap} />
            )}

            <DaftarAntrean
              baris={antrian}
              pengguna={currentUser}
              aksesFo={aksesFo}
              catatanEskalasi={catatanEskalasi}
              statusSurvei={statusSurvei}
              aksi={aksi}
              tanggal={tanggal}
              filterStatus={filterStatus}
              onGantiStatus={gantiStatus}
              halaman={halaman}
              ukuranHalaman={UKURAN_HALAMAN_ANTREAN}
              total={totalCount}
              onGantiHalaman={gantiHalaman}
              memuat={loading}
              menyegarkan={menyegarkan}
              galatMuat={galatMuat}
              onMuatUlang={muat}
            />
          </>
        )}
      </IsiHalaman>

      <p role="status" aria-live="polite" className="sr-only">{pengumuman}</p>

      <ModalAntrian
        utama={modal.utama}
        qr={modal.qr}
        pengguna={currentUser}
        tutup={modal.tutup}
        bukaQrTiket={modal.bukaQrTiket}
        muatSenyap={muatSenyap}
      />
    </>
  );
}
