// Halaman lama: walk-in kini menjadi tab "Walk-in" di Registrasi Pengunjung. Redirect server-side (tautan/bookmark lama
// tetap bekerja); query string yang ada ikut diteruskan.
import { redirect } from 'next/navigation';
import { urlRegistrasi } from '@/lib/fo/registrasi-url';

export default async function FoDaftarRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(urlRegistrasi('walkin', await searchParams));
}
