import { redirect } from 'next/navigation';

// Survei SKM lama dihentikan. Penilaian layanan kini lewat Pesan Perilaku (/survei/<token> dari QR/tautan setelah layanan).
export default function SkmLama() {
  redirect('/');
}
