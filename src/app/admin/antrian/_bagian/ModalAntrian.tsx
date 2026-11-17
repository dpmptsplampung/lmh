'use client';

// Modal halaman antrean dari SATU state union (useModalAntrian): ambil alih, alihkan, kembalikan ke FO, selesai layanan,
// koreksi, wizard pendataan formulir, Lihat Data Khusus baca-saja (G5b), wizard Mulai Layanan dua langkah (G5), dan QR Pesan Perilaku. Hanya tampilan dari props.
//
// Kontrak yang dijaga (lihat useModalAntrian):
// - `utama` memuat dialog tiket; `qr` adalah lapis sendiri yang boleh tampil DI ATAS dialog sumbernya.
// - Dialog tiket memanggil `await onSuccess(); onClose()`: onSuccess membuka QR, onClose menutup sumber; QR tetap terbuka.
// - `tutup(jenis)` hanya menutup modal sejenis. Koreksi dan wizard selalu terpasang (dikendalikan isOpen), dialog lain
//   dipasang hanya saat terbuka dan diberi `key` id tiket agar isiannya mulai bersih untuk tiket lain.
import AlihkanTiketModal from '@/components/admin/AlihkanTiketModal';
import AmbilAlihTiketModal from '@/components/admin/AmbilAlihTiketModal';
import KembalikanKeFoModal from '@/components/admin/KembalikanKeFoModal';
import LihatDataKhususModal from '@/components/admin/lihat-data/LihatDataKhususModal';
import KoreksiPelayananModal from '@/components/admin/KoreksiPelayananModal';
import PelayananWizardModal from '@/components/admin/PelayananWizardModal';
import MulaiLayananWizard from '@/components/admin/mulai-layanan/MulaiLayananWizard';
import SelesaiLayananModal from '@/components/admin/SelesaiLayananModal';
import SurveiQrDialog from '@/components/admin/SurveiQrDialog';
import type { ProfilPetugasAntrean, TiketBaris } from '@/lib/data/antrean';
import { bolehAmbilAlihTiket, bolehSelesaikanTiket, tiketHasilEskalasi } from '@/lib/pelayanan';
import type { JenisModalAntrian, ModalAntrian as StateModalAntrian } from '../_hook/useModalAntrian';
import { namaLayananDari, namaPelayanDari, punyaPendataan } from '../_logika/turunan';

export interface ModalAntrianProps {
  /** Dialog tiket yang terbuka (null = tidak ada). */
  utama: StateModalAntrian;
  /** Lapis QR Pesan Perilaku (null = tidak tampil). */
  qr: StateModalAntrian;
  pengguna: ProfilPetugasAntrean | null;
  tutup: (jenis: JenisModalAntrian) => void;
  /** Membuka dialog tiket (mengganti yang terbuka): wizard Mulai Layanan beralih ke wizard formulir tetap lewat ini. */
  buka: (jenis: JenisModalAntrian, tiket: TiketBaris) => void;
  /** Buka QR kunjungan tiket ini setelah diselesaikan (spekulatif; dialog QR menutup sendiri bila belum ada token). */
  bukaQrTiket: (tiketId: string | null) => void;
  muatSenyap: () => Promise<void>;
}

export default function ModalAntrian({ utama, qr, pengguna, tutup, buka, bukaQrTiket, muatSenyap }: ModalAntrianProps) {
  const tiketUtama = (jenis: JenisModalAntrian): TiketBaris | null => (utama?.jenis === jenis ? utama.tiket : null);
  const tiketAmbilAlih = tiketUtama('ambilAlih');
  const tiketAlihkan = tiketUtama('alihkan');
  const tiketKembalikan = tiketUtama('kembalikanKeFo');
  const tiketSelesaiLayanan = tiketUtama('selesaiLayanan');
  const tiketMulai = tiketUtama('mulaiLayanan');
  const tiketIsi = tiketUtama('isiPendataan');
  const tiketWizardMulai = tiketMulai ?? tiketIsi;
  const tiketKoreksi = tiketUtama('koreksi');
  const tiketWizard = tiketUtama('wizard');
  const tiketLihatKhusus = tiketUtama('lihatKhusus');
  const tiketQr = qr?.jenis === 'surveiQr' ? qr.tiket : null;

  return (
    <>
      {tiketAmbilAlih && (
        <AmbilAlihTiketModal
          key={tiketAmbilAlih.id}
          tiket={{
            id: tiketAmbilAlih.id,
            nomor_display: tiketAmbilAlih.nomor_display,
            pemilik_nama: namaPelayanDari(tiketAmbilAlih),
          }}
          mode={bolehAmbilAlihTiket(pengguna, tiketAmbilAlih) ? 'admin' : 'koordinator_tiket'}
          onClose={() => tutup('ambilAlih')}
          onSuccess={muatSenyap}
        />
      )}

      {tiketAlihkan && (
        <AlihkanTiketModal
          key={tiketAlihkan.id}
          tiket={{
            id: tiketAlihkan.id,
            nomor_display: tiketAlihkan.nomor_display,
            layanan_id: tiketAlihkan.layanan_id,
            layanan_nama: namaLayananDari(tiketAlihkan),
          }}
          onClose={() => tutup('alihkan')}
          onSuccess={muatSenyap}
        />
      )}

      {tiketKembalikan && (
        <KembalikanKeFoModal
          key={tiketKembalikan.id}
          tiket={{ id: tiketKembalikan.id, nomor_display: tiketKembalikan.nomor_display, layanan_id: tiketKembalikan.layanan_id }}
          onClose={() => tutup('kembalikanKeFo')}
          onSuccess={muatSenyap}
        />
      )}

      {tiketSelesaiLayanan && (
        <SelesaiLayananModal
          key={tiketSelesaiLayanan.id}
          tiket={{
            id: tiketSelesaiLayanan.id,
            nomor_display: tiketSelesaiLayanan.nomor_display,
            layanan_id: tiketSelesaiLayanan.layanan_id,
            hasilEskalasi: tiketHasilEskalasi(tiketSelesaiLayanan),
          }}
          onClose={() => tutup('selesaiLayanan')}
          onSuccess={async () => {
            // Dipanggil juga setelah galat "tampilan basi"; dialog QR menutup sendiri bila tidak ada token.
            bukaQrTiket(tiketSelesaiLayanan.id);
            await muatSenyap();
          }}
        />
      )}

      {tiketWizardMulai && (
        <MulaiLayananWizard
          key={`${tiketWizardMulai.id}:${tiketMulai ? 'mulai' : 'isi'}`}
          tiket={{
            id: tiketWizardMulai.id,
            nomor_display: tiketWizardMulai.nomor_display,
            layanan_id: tiketWizardMulai.layanan_id,
            berFormulir: punyaPendataan(tiketWizardMulai),
          }}
          langkahAwal={tiketMulai ? 1 : 2}
          // Tepat setelah Mulai, baris di state modal masih berstatus menunggu: pemilik baru = pengguna ini (server menegakkan).
          bolehUbah={Boolean(tiketMulai) || bolehSelesaikanTiket(pengguna, tiketWizardMulai)}
          onClose={() => tutup(tiketMulai ? 'mulaiLayanan' : 'isiPendataan')}
          onLanjutForm={() => buka('wizard', tiketWizardMulai)}
          onDataBasi={muatSenyap}
        />
      )}

      {tiketLihatKhusus && (
        <LihatDataKhususModal
          key={tiketLihatKhusus.id}
          tiket={{ id: tiketLihatKhusus.id, nomor_display: tiketLihatKhusus.nomor_display }}
          onClose={() => tutup('lihatKhusus')}
        />
      )}

      <KoreksiPelayananModal
        isOpen={Boolean(tiketKoreksi)}
        tiketId={tiketKoreksi?.id ?? null}
        onClose={() => tutup('koreksi')}
        onSuccess={muatSenyap}
      />

      <PelayananWizardModal
        isOpen={Boolean(tiketWizard)}
        tiketId={tiketWizard?.id ?? null}
        onClose={() => tutup('wizard')}
        onSuccess={async () => {
          bukaQrTiket(tiketWizard?.id ?? null);
          await muatSenyap();
        }}
        onDataBasi={muatSenyap}
      />

      {tiketQr && <SurveiQrDialog key={tiketQr.kunjungan_id} kunjunganId={tiketQr.kunjungan_id} onTutup={() => tutup('surveiQr')} />}
    </>
  );
}
