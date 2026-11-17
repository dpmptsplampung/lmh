import TugasUmkm from '@/components/admin/umkm-tugas/TugasUmkm';

// Hanya untuk petugas yang layanannya bermodul UMKM (proxy.ts menolak yang lain).
export default function PetugasTugasUmkmPage() {
  return <TugasUmkm />;
}
