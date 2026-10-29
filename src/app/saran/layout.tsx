import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kotak Saran',
  description: 'Sampaikan saran dan masukan untuk pelayanan DPMPTSP Provinsi Lampung, tanpa login.',
};

export default function SaranLayout({ children }: { children: React.ReactNode }) {
  return children;
}
