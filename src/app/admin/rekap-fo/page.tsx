'use client';

// Rekap harian Front Office (Tahap D, K9): per FO per hari WIB, daftar penanganan beserta ringkasan per hasil/topik
// dan ekspor Excel berpaginasi penuh. Front Office hanya melihat miliknya; Admin melihat semua dan dapat memfilter FO.
// Hak akses ditegakkan di api/admin/rekap/penanganan (peran 'fo'); halaman ini hanya menampilkan.
import PageHeader from '@/components/layout/PageHeader';
import RekapPenangananTable from '@/components/admin/RekapPenangananTable';

export default function RekapFoPage() {
  return (
    <>
      <PageHeader
        title="Rekap Front Office"
        description="Penanganan harian Front Office: saluran, topik, hasil, catatan, dan durasi"
      />
      <div style={{ padding: 'var(--space-8)' }}>
        <RekapPenangananTable peran="fo" />
      </div>
    </>
  );
}
