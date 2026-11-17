// Halaman lama: Buku Tamu kini menjadi tab "Buku Tamu" di Registrasi Pengunjung. Redirect server-side (tautan/bookmark
// lama tetap bekerja); query string yang ada ikut diteruskan.
import { redirect } from 'next/navigation';
import { urlRegistrasi } from '@/lib/fo/registrasi-url';

export default async function BukuTamuRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(urlRegistrasi('bukutamu', await searchParams));
}
