import Tabel from '@/components/ui/Tabel';
import type { DetailIproPublik } from '@/lib/data/publik-server';
import { formatLuas, labelLahan, labelSkema } from '@/components/investasi/label';

type Baris = { label: string; nilai: string };

/** Fakta proyek dalam tabel; baris tanpa nilai tidak ditampilkan, tanpa satu pun fakta tabel tidak dirender. */
export default function TabelFakta({ ipro }: { ipro: DetailIproPublik }) {
  const baris: Baris[] = [
    ipro.pemilik ? { label: 'Pemilik/pemrakarsa', nilai: ipro.pemilik } : null,
    { label: 'Kabupaten/Kota', nilai: ipro.kab_kota },
    ipro.lokasi_teks ? { label: 'Lokasi', nilai: ipro.lokasi_teks } : null,
    formatLuas(ipro.luas_ha) ? { label: 'Luas lahan', nilai: formatLuas(ipro.luas_ha) as string } : null,
    labelSkema(ipro.skema) ? { label: 'Skema kerja sama', nilai: labelSkema(ipro.skema) as string } : null,
    labelLahan(ipro.status_lahan) ? { label: 'Status lahan', nilai: labelLahan(ipro.status_lahan) as string } : null,
    ipro.perizinan ? { label: 'Perizinan', nilai: ipro.perizinan } : null,
  ].filter((b): b is Baris => b !== null);
  return (
    <Tabel
      caption="Fakta proyek"
      kolom={[{ kunci: 'label', judul: 'Informasi', judulBaris: true }, { kunci: 'nilai', judul: 'Keterangan' }]}
      baris={baris}
      kunciBaris="label"
    />
  );
}
