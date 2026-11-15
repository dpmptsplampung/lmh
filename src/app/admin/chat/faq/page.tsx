'use client';

// Kelola FAQ admin (dipecah di refaktor G8): halaman ini hanya merakit. Peran, layanan, dan Pengaturan bot =
// _hook/useAksesFaq; daftar, filter, dialog, dan aksi = _hook/useFaq; tampilan di _bagian/; aturan akses dan penyaringan murni
// di _logika/; kueri dan pemanggil route di lib/data/faq.ts. Cakupan per peran selaras RLS (lib/faq-scope.ts).
import PageHeader from '@/components/layout/PageHeader';
import IsiHalaman from '@/components/layout/IsiHalaman';
import { useToast } from '@/components/Toast';
import Galat from '@/components/ui/Galat';
import Skeleton from '@/components/ui/Skeleton';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import RoleNote from '@/components/admin/RoleNote';
import FaqFormDialog from '@/components/admin/faq/FaqFormDialog';
import HapusFaqDialog from '@/components/admin/faq/HapusFaqDialog';
import { useAksesFaq } from './_hook/useAksesFaq';
import { useFaq } from './_hook/useFaq';
import DaftarFaq from './_bagian/DaftarFaq';
import FilterFaq from './_bagian/FilterFaq';
import PanelBotFaq from './_bagian/PanelBotFaq';
import styles from './faq.module.css';

export default function AdminFAQPage() {
  const { toast } = useToast();
  const akses = useAksesFaq({ toast });
  const faq = useFaq({ akses, toast });
  const { dialog } = faq;

  return (
    <>
      <PageHeader title="Kelola FAQ" />

      <IsiHalaman>
        <p className={styles.pembuka}>
          Saat pengunjung bertanya di Live Chat, bot mencari FAQ yang paling mirip dan menjawab dengan isinya.
          Tulis pertanyaan sebagaimana pengunjung biasa menanyakannya.
        </p>

        {akses.roleError ? (
          <Galat
            judul="Hak akses Anda belum dapat dimuat"
            pesan="Peran akun Anda gagal dibaca sehingga halaman FAQ belum bisa dipakai. Ini bukan berarti Anda tidak punya akses."
            onRetry={akses.muatUlangRole}
            memuat={akses.roleMemuat}
            labelTombol="Muat ulang"
          />
        ) : akses.layananGagalBlokir ? (
          <Galat
            judul="Daftar layanan belum dapat dimuat"
            pesan="Layanan yang dapat dikelola FAQ-nya belum bisa ditampilkan. Periksa koneksi lalu muat ulang."
            onRetry={akses.muatUlangLayanan}
            memuat={akses.layananMemuat}
            labelTombol="Muat ulang"
          />
        ) : akses.tanpaAkses ? (
          <div data-testid="faq-tanpa-akses"><CatatanKeadaan jenis="lingkup">Tidak ada layanan yang dapat Anda kelola FAQ-nya. Hubungi Admin bila peran atau layanan Anda belum terdaftar.</CatatanKeadaan></div>
        ) : akses.role === null ? (
          <div className={styles.kartu} role="status"><Skeleton bentuk="baris" jumlah={5} label="Memuat halaman FAQ…" /></div>
        ) : (
          <>
            {akses.isPetugas && (
              <RoleNote>Anda dapat menonaktifkan FAQ yang keliru. Penghapusan permanen hanya oleh Admin.</RoleNote>
            )}
            {akses.isFrontOffice && (
              <RoleNote>
                Anda mengelola FAQ umum yang berlaku untuk semua layanan. FAQ khusus tiap layanan dikelola Admin dan petugas layanan.
              </RoleNote>
            )}

            {akses.tampilPanelBot && (
              <PanelBotFaq
                isAdmin={akses.isAdmin}
                opsiBot={akses.opsiBot}
                botLayananId={akses.botLayananId}
                botLayanan={akses.botLayanan}
                onPilihBot={akses.setBotPilih}
                sedangAlihBot={akses.togglingBot}
                onAlihBot={akses.ubahBot}
                jumlahMenunggu={faq.menungguIds.size}
                daftarMemuat={faq.loading}
                prosesMassal={faq.prosesMassal}
                onProsesSemua={faq.prosesSemua}
              />
            )}

            <FilterFaq
              cari={faq.cari}
              onCari={faq.setCari}
              opsiLayanan={akses.opsiLayanan}
              cakupan={faq.filterCakupan}
              onCakupan={faq.setFilterCakupan}
              status={faq.filterStatus}
              onStatus={faq.setFilterStatus}
              onTambah={faq.bukaTambah}
            />

            <DaftarFaq
              memuat={faq.loading}
              muatGagal={faq.muatGagal}
              onMuatUlang={faq.muatUlangDenganSpinner}
              jumlahSemua={faq.faqList.length}
              jumlahTampil={faq.tampil.length}
              halamanIni={faq.halamanIni}
              halaman={faq.halamanAman}
              onHalaman={faq.setHalaman}
              adaFilter={faq.adaFilter}
              onResetFilter={faq.resetFilter}
              isFrontOffice={akses.isFrontOffice}
              isPetugas={akses.isPetugas}
              namaLayanan={akses.namaLayanan}
              menungguIds={faq.menungguIds}
              memprosesIds={faq.memprosesIds}
              togglingId={faq.togglingId}
              onUbah={faq.bukaUbah}
              onHapus={faq.bukaHapus}
              onAlihAktif={faq.alihAktif}
              onProses={(id) => faq.prosesFaq(id, false)}
            />
            {!faq.loading && !faq.muatGagal && faq.faqList.length > 0 && (
              <p className={styles.ringkasan} aria-live="polite">
                {faq.tampil.length === faq.faqList.length
                  ? `${faq.faqList.length} FAQ`
                  : `${faq.tampil.length} dari ${faq.faqList.length} FAQ`}
              </p>
            )}
          </>
        )}
      </IsiHalaman>

      {dialog && dialog.jenis !== 'hapus' && (
        <FaqFormDialog
          key={dialog.jenis === 'ubah' ? dialog.faq.id : 'tambah'}
          faq={dialog.jenis === 'ubah' ? dialog.faq : null}
          opsi={akses.opsiLayanan}
          kunciAwal={faq.kunciAwalTambah}
          pertanyaanAwal={dialog.jenis === 'tambah' ? dialog.pertanyaanAwal : undefined}
          urutanAwal={faq.faqList.length + 1}
          perluPernyataan={faq.perluPernyataan}
          onClose={faq.tutupDialog}
          onSimpan={faq.simpan}
        />
      )}
      {dialog?.jenis === 'hapus' && (
        <HapusFaqDialog
          faq={dialog.faq}
          onClose={faq.tutupDialog}
          onHapus={() => faq.hapus(dialog.faq)}
        />
      )}
    </>
  );
}
