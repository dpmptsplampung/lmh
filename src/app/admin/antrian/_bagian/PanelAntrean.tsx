'use client';

// Panel Sekarang (A1) di atas tabel antrean: merakit tiket "sedang saya layani" dan "berikutnya" dari daftar panel
// (turunan murni di _logika/turunan.ts) dan meneruskan aksinya ke penangan halaman. Hanya tampilan dari props;
// Layanan yang dipilih Admin/FO disimpan halaman (null = Layanan pertama yang punya tiket menunggu).
import type { ProfilPetugasAntrean, TiketBaris } from '@/lib/data/antrean';
import PanelSekarang, { type TiketPanel } from '../PanelSekarang';
import { bolehLihatSemuaLayanan, turunkanPanel } from '../_logika/turunan';
import type { AksiTiket } from './SelAksi';

export interface PanelAntreanProps {
  /** Tiket panel (hari ini, terpisah dari halaman tabel). */
  baris: TiketBaris[];
  pengguna: ProfilPetugasAntrean | null;
  layananId: string | null;
  onLayananChange: (id: string) => void;
  aksi: Pick<AksiTiket, 'sedangProses' | 'sedangPanggil' | 'panggil' | 'mulai' | 'selesaikan'>;
}

export default function PanelAntrean({ baris, pengguna, layananId, onLayananChange, aksi }: PanelAntreanProps) {
  const panel = turunkanPanel(baris, pengguna, layananId);
  const barisDari = (t: TiketPanel) => baris.find((a) => a.id === t.id);
  return (
    <PanelSekarang
      sedangDilayani={panel.sedangDilayani}
      berikutnya={panel.berikutnya}
      layananOpsi={bolehLihatSemuaLayanan(pengguna) ? panel.opsiLayanan : []}
      layananId={panel.layananAktif}
      onLayananChange={onLayananChange}
      sedangPanggil={(id) => aksi.sedangPanggil.has(id)}
      sedangProses={(id) => aksi.sedangProses.has(id)}
      onPanggil={(t) => aksi.panggil(t.id, t.nomor_display)}
      onMulai={(t) => {
        const a = barisDari(t);
        return a ? aksi.mulai(a) : undefined;
      }}
      onSelesai={(t) => {
        const a = barisDari(t);
        return a ? aksi.selesaikan(a) : undefined;
      }}
      tanpaTiketSaya={pengguna?.role === 'front_office'}
    />
  );
}
