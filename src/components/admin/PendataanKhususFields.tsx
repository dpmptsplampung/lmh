'use client';

// Isian Pendataan Khusus untuk petugas (Fase 4): hook pemuat definisi + komponen penampil. Dipakai dialog selesai tiket
// dan dialog selesai live chat. Setiap isian berlabel terhubung, penanda wajib, galat role=alert (aria-describedby).
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { objekBelumAda } from '@/lib/akses-data/galat';
import { petaFieldKhusus, type FieldKhusus } from '@/lib/pendataan-khusus/jenis';
import type { NilaiForm } from '@/lib/pendataan-khusus/jawaban';

const KOLOM = 'id, layanan_id, label, jenis, wajib, opsi, urut, tersembunyi, pernah_diisi';

/**
 * Isian Pendataan Khusus yang TERLIHAT (tidak tersembunyi) milik satu Layanan, urut `urut`.
 * `tersedia` = false bila migrasi belum diterapkan (tabel tidak ada) atau pemuatan gagal: pemanggil memakai alur lama.
 * `layananId` null = hanya memeriksa ketersediaan fitur (mis. chat diselesaikan Front Office).
 */
export function useFieldKhusus(layananId: string | null, aktif = true) {
  const [fields, setFields] = useState<FieldKhusus[]>([]);
  const [memuat, setMemuat] = useState(aktif);
  const [tersedia, setTersedia] = useState(false);
  // Naik tiap `muatUlang()`: isian dimuat ulang (mis. Admin mengubah isian saat dialog terbuka).
  const [versi, setVersi] = useState(0);

  useEffect(() => {
    if (!aktif) return;
    let batal = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setMemuat(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    (async () => {
      try {
        const supabase = createClient();
        const kueri = layananId
          ? supabase.from('pendataan_khusus_field').select(KOLOM).eq('layanan_id', layananId).eq('tersembunyi', false).order('urut').order('created_at')
          : supabase.from('pendataan_khusus_field').select('id').limit(1);
        const { data, error } = await kueri;
        if (batal) return;
        if (error) {
          // Migrasi belum diterapkan atau gagal muat: fitur disembunyikan, alur lama tetap.
          setTersedia(false);
          setFields([]);
          if (!objekBelumAda(error)) console.error('[useFieldKhusus] gagal memuat isian Pendataan Khusus');
          return;
        }
        setTersedia(true);
        setFields(layananId ? ((data ?? []) as Record<string, unknown>[]).map(petaFieldKhusus) : []);
      } catch {
        if (!batal) { setTersedia(false); setFields([]); }
      } finally {
        if (!batal) setMemuat(false);
      }
    })();
    return () => { batal = true; };
  }, [layananId, aktif, versi]);

  return { fields, memuat, tersedia, muatUlang: () => setVersi((v) => v + 1) };
}

interface Props {
  idDasar: string;
  fields: FieldKhusus[];
  nilai: NilaiForm;
  onNilai: (id: string, v: string | string[]) => void;
  /** id isian -> pesan galat. */
  galat: Record<string, string>;
  disabled?: boolean;
}

// Kelompok (fieldset) tidak bisa memakai aria-required: kewajiban dinyatakan lewat teks legenda; yang opsional diberi
// "(Opsional)" seperti input lain.
const teksWajib = (wajib: boolean) => (wajib ? ' (wajib)' : ' (Opsional)');

const GAYA_GALAT: React.CSSProperties = { color: 'var(--color-danger-600)', fontSize: 12, margin: '4px 0 0' };

export default function PendataanKhususFields({ idDasar, fields, nilai, onNilai, galat, disabled }: Props) {
  const tampil = fields.filter((f) => !f.tersembunyi);
  if (tampil.length === 0) return null;
  return (
    <>
      {tampil.map((f) => {
        const idIsian = `${idDasar}-khusus-${f.id}`;
        const idGalat = `${idIsian}-galat`;
        const pesan = galat[f.id];
        const aria = {
          'aria-required': f.wajib || undefined,
          'aria-invalid': pesan ? true : undefined,
          'aria-describedby': pesan ? idGalat : undefined,
        } as const;
        const ariaGrup = { 'aria-describedby': pesan ? idGalat : undefined } as const;
        const v = nilai[f.id];
        const teks = typeof v === 'string' ? v : '';
        let kontrol: React.ReactNode;
        if (f.jenis === 'pilihan_ganda') {
          const dipilih = Array.isArray(v) ? v : [];
          kontrol = (
            <fieldset id={idIsian} style={{ border: 0, padding: 0, margin: 0 }} {...ariaGrup}>
              <legend className={`form-label${f.wajib ? ' form-label--required' : ''}`}>{f.label}{teksWajib(f.wajib)}</legend>
              {f.opsi.map((o) => (
                <label key={o} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={dipilih.includes(o)}
                    disabled={disabled}
                    onChange={(e) => onNilai(f.id, e.target.checked ? [...dipilih, o] : dipilih.filter((x) => x !== o))}
                  />
                  {o}
                </label>
              ))}
            </fieldset>
          );
        } else if (f.jenis === 'ya_tidak') {
          kontrol = (
            <fieldset id={idIsian} style={{ border: 0, padding: 0, margin: 0 }} {...ariaGrup}>
              <legend className={`form-label${f.wajib ? ' form-label--required' : ''}`}>{f.label}{teksWajib(f.wajib)}</legend>
              {(['ya', 'tidak'] as const).map((p) => (
                <label key={p} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginRight: 16 }}>
                  <input type="radio" name={idIsian} value={p} checked={teks === p} disabled={disabled} onChange={() => onNilai(f.id, p)} />
                  {p === 'ya' ? 'Ya' : 'Tidak'}
                </label>
              ))}
            </fieldset>
          );
        } else {
          let input: React.ReactNode;
          if (f.jenis === 'teks_panjang') {
            input = <textarea id={idIsian} className="form-textarea" rows={3} value={teks} maxLength={2000} disabled={disabled} {...aria} onChange={(e) => onNilai(f.id, e.target.value)} />;
          } else if (f.jenis === 'pilihan_tunggal') {
            input = (
              <select id={idIsian} className="form-select" value={teks} disabled={disabled} {...aria} onChange={(e) => onNilai(f.id, e.target.value)}>
                <option value="">-- Pilih --</option>
                {f.opsi.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            );
          } else {
            const tipe = f.jenis === 'angka' ? 'number' : f.jenis === 'tanggal' ? 'date' : 'text';
            input = (
              <input
                id={idIsian}
                className="form-input"
                type={tipe}
                step={f.jenis === 'angka' ? 'any' : undefined}
                value={teks}
                maxLength={f.jenis === 'teks_singkat' ? 200 : undefined}
                disabled={disabled}
                {...aria}
                onChange={(e) => onNilai(f.id, e.target.value)}
              />
            );
          }
          kontrol = (
            <>
              <label htmlFor={idIsian} className={`form-label${f.wajib ? ' form-label--required' : ''}`}>
                {f.label}{f.wajib ? '' : ' (Opsional)'}
              </label>
              {input}
            </>
          );
        }
        return (
          <div className="form-group" key={f.id}>
            {kontrol}
            {pesan && <p id={idGalat} role="alert" style={GAYA_GALAT}>{pesan}</p>}
          </div>
        );
      })}
    </>
  );
}
