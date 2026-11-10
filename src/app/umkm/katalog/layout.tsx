import KerangkaKatalog from '@/components/umkm-katalog/KerangkaKatalog';

// Kepala dan kaki bersama untuk daftar dan profil Katalog UMKM.
export default function KatalogLayout({ children }: { children: React.ReactNode }) {
  return <KerangkaKatalog>{children}</KerangkaKatalog>;
}
