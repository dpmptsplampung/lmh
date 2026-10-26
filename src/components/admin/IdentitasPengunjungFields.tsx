'use client';

// Identitas pengunjung chat (Pendataan Umum, Fase 4 K7): diprapengisi dari kunjungan chat (disalin dari profil Google
// pengunjung); petugas boleh melengkapi/mengoreksi saat menyelesaikan chat. Semua opsional; kosong = tidak diubah.
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  KATEGORI_PENGUNJUNG, KOLOM_IDENTITAS, LABEL_IDENTITAS, type IdentitasForm, type KolomIdentitas,
} from '@/lib/pendataan-khusus/identitas';

const KOSONG: IdentitasForm = { nama: '', kontak_hp: '', email: '', asal_instansi: '', kategori: '', keperluan: '' };

/** Identitas kunjungan chat (RLS boleh_kunjungan: pemilik tahap). Gagal/tidak ada = isian kosong. */
export function useIdentitasKunjungan(sesiId: string, aktif = true) {
  const [awal, setAwal] = useState<IdentitasForm>(KOSONG);
  const [memuat, setMemuat] = useState(aktif);
  useEffect(() => {
    if (!aktif) return;
    let batal = false;
    (async () => {
      try {
        const { data } = await createClient()
          .from('kunjungan')
          .select('nama, kontak_hp, email, asal_instansi, kategori, keperluan')
          .eq('chat_sesi_id', sesiId)
          .maybeSingle();
        if (batal || !data) return;
        const r = data as Record<string, unknown>;
        setAwal(Object.fromEntries(KOLOM_IDENTITAS.map((k) => [k, typeof r[k] === 'string' ? (r[k] as string) : ''])) as IdentitasForm);
      } catch {
        /* isian dibiarkan kosong */
      } finally {
        if (!batal) setMemuat(false);
      }
    })();
    return () => { batal = true; };
  }, [sesiId, aktif]);
  return { awal, memuat };
}

interface Props {
  idDasar: string;
  nilai: IdentitasForm;
  onNilai: (k: KolomIdentitas, v: string) => void;
  galat: Partial<Record<KolomIdentitas, string>>;
  disabled?: boolean;
}

const GAYA_GALAT: React.CSSProperties = { color: 'var(--color-danger-600)', fontSize: 12, margin: '4px 0 0' };

export default function IdentitasPengunjungFields({ idDasar, nilai, onNilai, galat, disabled }: Props) {
  return (
    <fieldset style={{ border: '1px solid var(--border-default)', borderRadius: 8, padding: 'var(--space-3) var(--space-4)', margin: 0 }}>
      <legend style={{ fontWeight: 600, padding: '0 var(--space-2)' }}>Identitas pengunjung</legend>
      <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        Terisi dari profil pengunjung. Lengkapi atau koreksi bila perlu; kolom yang dikosongkan tidak mengubah data.
      </p>
      {KOLOM_IDENTITAS.map((k) => {
        const id = `${idDasar}-identitas-${k}`;
        const pesan = galat[k];
        const aria = { 'aria-invalid': pesan ? true : undefined, 'aria-describedby': pesan ? `${id}-galat` : undefined } as const;
        return (
          <div className="form-group" key={k}>
            <label htmlFor={id} className="form-label">{LABEL_IDENTITAS[k]} (Opsional)</label>
            {k === 'kategori' ? (
              <select id={id} className="form-select" value={nilai[k]} disabled={disabled} {...aria} onChange={(e) => onNilai(k, e.target.value)}>
                <option value="">-- Pilih --</option>
                {/* Nilai lama di luar daftar tetap terlihat (bukan kosong) dan tidak dianggap berubah. */}
                {nilai[k] && !(KATEGORI_PENGUNJUNG as readonly string[]).includes(nilai[k]) && (
                  <option value={nilai[k]}>{nilai[k]} (nilai lama, di luar daftar)</option>
                )}
                {KATEGORI_PENGUNJUNG.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : k === 'keperluan' ? (
              <textarea id={id} className="form-textarea" rows={2} maxLength={500} value={nilai[k]} disabled={disabled} {...aria} onChange={(e) => onNilai(k, e.target.value)} />
            ) : (
              <input
                id={id}
                className="form-input"
                type={k === 'email' ? 'email' : k === 'kontak_hp' ? 'tel' : 'text'}
                value={nilai[k]}
                disabled={disabled}
                {...aria}
                onChange={(e) => onNilai(k, e.target.value)}
              />
            )}
            {pesan && <p id={`${id}-galat`} role="alert" style={GAYA_GALAT}>{pesan}</p>}
          </div>
        );
      })}
    </fieldset>
  );
}
