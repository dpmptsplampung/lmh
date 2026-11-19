import KotakMasuk from '@/components/admin/investasi/KotakMasuk';

// Hanya untuk petugas yang layanannya bermodul investasi (proxy.ts menolak yang lain).
export default function PetugasKotakMasukInvestasiPage() {
  return <KotakMasuk hrefDasbor="/petugas" />;
}
