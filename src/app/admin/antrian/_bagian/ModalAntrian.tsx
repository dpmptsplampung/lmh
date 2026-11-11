'use client';

// Tujuh modal halaman antrean dari SATU state union (useModalAntrian): ambil alih, alihkan, kembalikan ke FO, selesai
// eskalasi, koreksi, wizard pendataan, dan QR Pesan Perilaku. Hanya tampilan dari props.
//
// Kontrak yang dijaga (lihat useModalAntrian):
// - `utama` memuat dialog tiket; `qr` adalah lapis sendiri yang boleh tampil DI ATAS dialog sumbernya.
// - Dialog tiket memanggil `await onSuccess(); onClose()`: onSuccess membuka QR, onClose menutup sumber; QR tetap terbuka.
// - `tutup(jenis)` hanya menutup modal sejenis. Koreksi dan wizard selalu terpasang (dikendalikan isOpen), dialog lain
//   dipasang hanya saat terbuka dan diberi `key` id tiket agar isiannya mulai bersih untuk tiket lain.
import AlihkanTiketModal from '@/components/admin/AlihkanTiketModal';
import AmbilAlihTiketModal from '@/components/admin/AmbilAlihTiketModal';
import KembalikanKeFoModal from '@/components/admin/KembalikanKeFoModal';
import KoreksiPelayananModal from '@/components/admin/KoreksiPelayananModal';
import PelayananWizardModal from '@/components/admin/PelayananWizardModal';
import SelesaiEskalasiModal from '@/components/admin/SelesaiEskalasiModal';
import SurveiQrDialog from '@/components/admin/SurveiQrDialog';
import type { ProfilPetugasAntrean, TiketBaris } from '@/lib/data/antrean';
import { bolehAmbilAlihTiket } from '@/lib/pelayanan';
import type { JenisModalAntrian, ModalAntrian as StateModalAntrian } from '../_hook/useModalAntrian';
import { namaLayananDari, namaPelayanDari } from '../_logika/turunan';

export interface ModalAntrianProps {
  /** Dialog tiket yang terbuka (null = tidak ada). */
  utama: StateModalAntrian;
  /** Lapis QR Pesan Perilaku (null = tidak tampil). */
  qr: StateModalAntrian;
  pengguna: ProfilPetugasAntrean | null;
  tutup: (jenis: JenisModalAntrian) => void;
  /** Buka QR kunjungan tiket ini setelah diselesaikan (spekulatif; dialog QR menutup sendiri bila belum ada token). */
  bukaQrTiket: (tiketId: string | null) => void;
  muatSenyap: () => Promise<void>;
}

export default function ModalAntrian({ utama, qr, pengguna, tutup, bukaQrTiket, muatSenyap }: ModalAntrianProps) {
  const tiketUtama = (jenis: JenisModalAntrian): TiketBaris | null => (utama?.jenis === jenis ? utama.tiket : null);
  const tiketAmbilAlih = tiketUtama('ambilAlih');
  const tiketAlihkan = tiketUtama('alihkan');
  const tiketKembalikan = tiketUtama('kembalikanKeFo');
  const tiketSelesaiEskalasi = tiketUtama('selesaiEskalasi');
  const tiketKoreksi = tiketUtama('koreksi');
  const tiketWizard = tiketUtama('wizard');
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

      {tiketSelesaiEskalasi && (
        <SelesaiEskalasiModal
          key={tiketSelesaiEskalasi.id}
          tiket={{
            id: tiketSelesaiEskalasi.id,
            nomor_display: tiketSelesaiEskalasi.nomor_display,
            layanan_id: tiketSelesaiEskalasi.layanan_id,
          }}
          onClose={() => tutup('selesaiEskalasi')}
          onSuccess={async () => {
            // Dipanggil juga setelah galat "tampilan basi"; dialog QR menutup sendiri bila tidak ada token.
            bukaQrTiket(tiketSelesaiEskalasi.id);
            await muatSenyap();
          }}
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
