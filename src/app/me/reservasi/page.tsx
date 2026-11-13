'use client';

// Halaman reservasi pengunjung (UI-2; dipecah di refaktor G9): hanya merakit. Alur + profil + kirim = _hook/useReservasi
// (menyusun _hook/useKetersediaan dan _hook/useDaftarReservasi), aturan validasi murni = _logika/validasiReservasi,
// tampilan = _bagian/, query = lib/data/reservasi.ts. Reservasi = baris `kunjungan` (RPC reservasi_buat), bukan `visit`.
import PageHeader from '@/components/layout/PageHeader';
import Kartu from '@/components/ui/Kartu';
import Skeleton from '@/components/ui/Skeleton';
import { useReservasi } from './_hook/useReservasi';
import DaftarReservasi from './_bagian/DaftarReservasi';
import FormReservasi from './_bagian/FormReservasi';
import ReservasiBerhasil from './_bagian/ReservasiBerhasil';
import styles from './reservasi.module.css';

export default function ReservasiPage() {
  const r = useReservasi();
  const { ketersediaan, daftar } = r;

  if (r.loadingInit) {
    return (
      <div className={styles.halaman}>
        <PageHeader title="Rencanakan Kedatangan" description="Memuat formulir reservasi." />
        <Skeleton bentuk="kartu" jumlah={2} label="Memuat formulir reservasi" />
      </div>
    );
  }

  return (
    <div className={styles.halaman}>
      <PageHeader
        title="Rencanakan Kedatangan"
        description="Booking kunjungan Anda ke kantor DPMPTSP. Setelah selesai, Anda akan mendapatkan QR code yang dipindai petugas Front Office saat Anda tiba."
        kembali={{ href: '/me', label: 'Kembali ke Beranda saya' }}
      />

      <div className={styles.kolom}>
        <Kartu className={styles.formCard} judul={r.success ? 'Reservasi Berhasil' : 'Data kunjungan'}>
          {r.success ? (
            <ReservasiBerhasil qrToken={r.success.qr_token} onBuatLagi={r.mulaiLagi} />
          ) : (
            <FormReservasi
              form={r.form}
              onUbah={r.ubahForm}
              onPilihTujuan={r.pilihTujuan}
              layanan={{
                daftar: ketersediaan.layanan,
                galat: ketersediaan.layananGalat,
                memuat: ketersediaan.layananMemuat,
                onMuat: () => void ketersediaan.muatLayanan(),
              }}
              estimasi={ketersediaan.estimasi}
              minDate={r.minDate}
              maxDate={r.maxDate}
              error={r.error}
              consentGagal={r.consentGagal}
              consentGiven={r.consentGiven}
              onConsent={r.setConsentGiven}
              loading={r.loading}
              onKirim={(e) => void r.kirim(e)}
            />
          )}
        </Kartu>

        <DaftarReservasi
          daftar={daftar.daftar}
          gagal={daftar.daftarGagal}
          layanan={ketersediaan.layanan}
          infoBatal={daftar.infoBatal}
          galatBatal={daftar.galatBatal}
          konfirmasiBatal={daftar.konfirmasiBatal}
          membatalkan={daftar.membatalkan}
          onMuatUlang={daftar.muatUlang}
          onMintaBatal={daftar.mintaBatal}
          onBatalkan={(id) => void daftar.batalkan(id)}
          onTutupKonfirmasi={daftar.tutupKonfirmasi}
        />
      </div>
    </div>
  );
}
