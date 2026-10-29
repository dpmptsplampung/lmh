import { redirect } from 'next/navigation';

// Halaman SKM lama kini bagian dari menu Pesan Perilaku.
export default function SkmAdminLama() {
  redirect('/admin/pesan-perilaku');
}
