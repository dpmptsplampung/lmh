'use client';

// DEPRECATED (UI-2, K3): pendaftaran walk-in kini hanya lewat Front Office di /admin/fo/registrasi?tab=walkin
// (rpc fo_mulai_kunjungan). Komponen ini tidak lagi menulis ke database (dulu: INSERT langsung ke `visit`
// dengan tiket langsung terbit); ia hanya tautan ke halaman FO dengan props lama agar pemanggil yang belum
// dimigrasi (src/app/admin/antrian) tetap terkompilasi. HAPUS file ini + test-nya setelah pemanggil terakhir
// berpindah ke tautan langsung.
import { UserPlus } from 'lucide-react';
import Tombol from '@/components/ui/Tombol';

interface WalkinWizardProps {
  /** Diabaikan (kompatibilitas): layanan tidak dipilih saat pendaftaran, FO yang mengeskalasi. */
  fixedLayananId?: string | null;
  /** Diabaikan (kompatibilitas): tidak ada pendaftaran yang selesai di komponen ini. */
  onSuccess?: () => void;
  triggerLabel?: string;
}

export default function WalkinWizard({
  triggerLabel = '+ Registrasi Kunjungan Walk-in',
}: WalkinWizardProps) {
  return (
    <Tombol href="/admin/fo/registrasi?tab=walkin" ikon={UserPlus}>
      {triggerLabel}
    </Tombol>
  );
}
