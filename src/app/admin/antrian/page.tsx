'use client';

// Halaman antrean admin (WP-22, A3, B4; dipecah di refaktor G5): hanya merakit. Muat + Realtime = _hook/useAntrean,
// tanggal/status/Layanan/halaman di URL = useFilterAntrian (+ pilihan Layanan Admin/FO = useSaringanLayanan), aksi tiket =
// useAksiAntrean (aturan kepemilikan tiket di headernya), modal = useModalAntrian, rekap absen = useRekapAbsensi.
import { Suspense, useState } from 'react';
import { AlertCircle, Clock, TrendingUp, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import IsiHalaman from '@/components/layout/IsiHalaman';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import PemilihTanggal from '@/components/ui/PemilihTanggal';
import CalendarBanner from '@/components/admin/CalendarBanner';
import RoleNote from '@/components/admin/RoleNote';
import PemberitahuanAmbilAlih from '@/components/admin/PemberitahuanAmbilAlih';
import WalkinWizard from '@/components/WalkinWizard';
import { useToast } from '@/components/Toast';
import { todayWIB } from '@/lib/time';
import { formatWaktu } from '@/lib/utils';
import { bolehLihatSemuaLayanan, judulHalaman, namaLayananProfil, panelBerlaku, tanggalPanjang } from './_logika/turunan';
import { useFilterAntrian } from './_hook/useFilterAntrian';
import { UKURAN_HALAMAN_ANTREAN, useAntrean } from './_hook/useAntrean';
import { useModalAntrian } from './_hook/useModalAntrian';
import { useAksiAntrean } from './_hook/useAksiAntrean';
import { useSaringanLayanan } from './_hook/useSaringanLayanan';
import { useIsianKhususLayanan } from './_hook/useIsianKhususLayanan';
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
  const { tanggal, filterStatus, layanan, halaman, ubahTanggal, gantiStatus, gantiLayanan, gantiHalaman } =
    useFilterAntrian();
  const {
    antrian, antrianPanel, currentUser, unassigned, loading, menyegarkan, galatMuat, galatSegar, terakhir,
    totalCount, totalHarian, aksesFo, serverStats, catatanEskalasi, statusSurvei, muat, muatSenyap,
  } = useAntrean({ tanggal, filterStatus, layananId: layanan, halaman });
  const saringanLayanan = useSaringanLayanan(currentUser, layanan, gantiLayanan);
  const modal = useModalAntrian([antrian, antrianPanel]);
  const { sedangProses, sedangPanggil, pengumuman, panggil, mulai, selesaikan } = useAksiAntrean({ toast, muatSenyap, buka: modal.buka });
  const layananBerisian = useIsianKhususLayanan([antrian, antrianPanel], currentUser);
  const rekap = useRekapAbsensi({ tanggal, currentUser });
  const aksi: AksiTiket = { sedangProses, sedangPanggil, panggil, mulai, selesaikan, buka: modal.buka, layananBerisian };
  const [panelLayananId, setPanelLayananId] = useState<string | null>(null);

  const layananNamaHeader = namaLayananProfil(currentUser);
  // Panel Sekarang (A1): hanya hari ini dan bukan tab "Selesai".
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
          {bolehLihatSemuaLayanan(currentUser) && <WalkinWizard onSuccess={muatSenyap} triggerLabel="+ Walk-in" />}
          <PemilihTanggal
            nilai={tanggal}
            onUbah={ubahTanggal}
            label="Tanggal antrean"
          />
        </div>
      </PageHeader>

      <IsiHalaman>
        <CalendarBanner />
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
              saringanLayanan={saringanLayanan}
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
        buka={modal.buka}
        bukaQrTiket={modal.bukaQrTiket}
        muatSenyap={muatSenyap}
      />
    </>
  );
}
