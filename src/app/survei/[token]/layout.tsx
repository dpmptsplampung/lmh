import type { Metadata } from 'next';

// page.tsx adalah Client Component dan tidak boleh mengekspor `metadata`; judul tab ada di layout server ini
// (guide Next 16: metadata dari layout.js/page.js server). Templat judul root menambahkan nama aplikasi.
// Tautan berisi kode undangan pribadi: jangan diindeks mesin pencari.
export const metadata: Metadata = {
  title: 'Pesan Perilaku',
  robots: { index: false, follow: false },
};

export default function SurveiLayout({ children }: { children: React.ReactNode }) {
  return children;
}
