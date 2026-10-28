// Lencana status Pesan Perilaku (survei terpadu) pada daftar staf: Belum diisi / Sudah diisi / Kedaluwarsa / —.
// Konteks "Pesan Perilaku" diberikan oleh judul kolom atau teks di sebelahnya (ruling R13).
import { LABEL_STATUS_SURVEI, type StatusSurvei } from '@/lib/survei/staf';

const KELAS: Record<StatusSurvei, string> = {
  belum_diisi: 'badge--pending',
  sudah_diisi: 'badge--selesai',
  kedaluwarsa: 'badge--draft',
  tidak_ada: 'badge--draft',
};

export default function SurveiStatusBadge({ status }: { status: StatusSurvei }) {
  const label = LABEL_STATUS_SURVEI[status];
  const title = status === 'tidak_ada' ? 'Belum ada undangan Pesan Perilaku' : `Pesan Perilaku: ${label}`;
  return (
    <span className={`badge ${KELAS[status]}`} title={title}>
      {label}
    </span>
  );
}
