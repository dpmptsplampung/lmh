// Halaman lama: Rekap Front Office kini dilebur ke Rekap terpadu (Fase 3, spec §6.3). Redirect server-side agar
// tautan/bookmark lama tetap bekerja; dibuka langsung pada Data Pelayanan unit Front Office.
import { redirect } from 'next/navigation';

export default function RekapFoRedirect() {
  redirect('/admin/rekap?bagian=data&unit=fo');
}
