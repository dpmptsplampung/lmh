'use client';

// Rekap harian Front Office (Tahap D, K9): per FO per hari WIB, daftar penanganan beserta ringkasan per hasil/topik
// dan ekspor Excel berpaginasi penuh. Admin dan Front Office melihat semua FO dan dapat memfilter satu FO (keputusan CEO
// 2026-10-14: keterbukaan data antar FO; kolom Front Office = siapa yang melayani).
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
