import { redirect } from 'next/navigation';
import { BERANDA_PETUGAS } from '@/lib/rute-peran';

// Pintu masuk area petugas: tidak ada dasbor terpisah, langsung ke Antrean.
export default function PetugasIndexPage() {
  redirect(BERANDA_PETUGAS);
}
