'use client';

import { useEffect, useRef, type FormEvent } from 'react';
import Link from 'next/link';
import { CircleCheck, ShieldCheck } from 'lucide-react';
import KerangkaModal from '@/components/ui/KerangkaModal';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import { BATAS, type KanalMinat } from './formulir-logika';
import { kalimatPersetujuan, NASKAH_PDP } from './teks-pdp';
import { useFormulirMinat } from './useFormulirMinat';
import styles from './investasi.module.css';

const TEKS: Record<KanalMinat, { judul: string; kirim: string; sukses: string; konteks: string; pesan: string }> = {
  ipro: {
    judul: 'Hubungi petugas',
    kirim: 'Kirim pesan',
    sukses: 'Pesan terkirim. Petugas akan menghubungi Anda melalui email.',
    konteks: 'Pesan untuk proyek',
    pesan: 'Pesan',
  },
  dokumen: {
    judul: 'Ajukan Minat Investasi',
    kirim: 'Kirim Permintaan',
    sukses: 'Permintaan Anda tercatat. Petugas akan menghubungi Anda melalui email.',
    konteks: 'Untuk dokumen',
    pesan: 'Pesan (opsional)',
  },
};

type Props = {
  terbuka: boolean;
  onTutup: () => void;
  kanal: KanalMinat;
  /** `ipro_id` (kanal ipro) atau `doc_id` (kanal dokumen). */
  refId: string;
  /** Judul proyek/dokumen yang ditampilkan sebagai konteks. */
  konteks: string;
};

function IsiFormulir({ onTutup, kanal, refId, konteks }: Omit<Props, 'terbuka'>) {
  const { isian, ubah, galatIsian, galatUmum, sedang, berhasil, gagalKe, kirim } = useFormulirMinat(kanal, refId);
  const teks = TEKS[kanal];
  const rujukanGalat = useRef<HTMLDivElement>(null);
  const rujukanForm = useRef<HTMLDivElement>(null);
  useEffect(() => { if (galatUmum) rujukanGalat.current?.focus(); }, [galatUmum]);
  useEffect(() => {
    if (gagalKe > 0) rujukanForm.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [gagalKe]);

  const kaki = berhasil ? (
    <Tombol onClick={onTutup}>Selesai</Tombol>
  ) : (
    <>
      <Tombol varian="hantu" onClick={onTutup} disabled={sedang}>Batal</Tombol>
      <Tombol type="submit" memuat={sedang}>{teks.kirim}</Tombol>
    </>
  );

  return (
    <KerangkaModal
      varian="dialog"
      terbuka
      onTutup={onTutup}
      dikunci={sedang}
      judul={teks.judul}
      kaki={kaki}
      onKirim={berhasil ? undefined : (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); void kirim(); }}
    >
      {berhasil ? (
        <div role="status" className={styles.formBerhasil}>
          <CircleCheck size={22} aria-hidden="true" />
          <p>{teks.sukses}</p>
        </div>
      ) : (
        <div ref={rujukanForm} className={styles.formBadan}>
          <p className={styles.formKonteks}>{teks.konteks}: <strong>{konteks}</strong></p>
          {galatUmum && <div ref={rujukanGalat} role="alert" tabIndex={-1} className={styles.formGalat}>{galatUmum}</div>}
          <fieldset disabled={sedang} className={styles.formKelompok}>
            <legend className="sr-only">Isian pesan</legend>
            <Field label="Nama" wajib galat={galatIsian.nama}>
              <input autoComplete="name" value={isian.nama} maxLength={BATAS.nama} onChange={e => ubah('nama', e.target.value)} />
            </Field>
            <Field label="Email" wajib galat={galatIsian.email}>
              <input type="email" inputMode="email" autoComplete="email" value={isian.email} maxLength={254} onChange={e => ubah('email', e.target.value)} />
            </Field>
            {kanal === 'ipro' && (
              <Field label="Nomor HP (opsional)" galat={galatIsian.no_hp}>
                <input type="tel" inputMode="tel" autoComplete="tel" value={isian.no_hp} maxLength={30} onChange={e => ubah('no_hp', e.target.value)} />
              </Field>
            )}
            <Field label="Instansi atau perusahaan (opsional)" galat={galatIsian.instansi}>
              <input autoComplete="organization" value={isian.instansi} maxLength={BATAS.instansi} onChange={e => ubah('instansi', e.target.value)} />
            </Field>
            <Field
              label={teks.pesan}
              wajib={kanal === 'ipro'}
              galat={galatIsian.pesan}
              bantuan={`${isian.pesan.length} dari ${BATAS.pesan} karakter`}
            >
              <textarea rows={4} value={isian.pesan} maxLength={BATAS.pesan} onChange={e => ubah('pesan', e.target.value)} />
            </Field>
            <div className={styles.honeypot} aria-hidden="true">
              <label>
                Situs web (biarkan kosong)
                <input type="text" name="situs_web" tabIndex={-1} autoComplete="off" value={isian.situs_web} onChange={e => ubah('situs_web', e.target.value)} />
              </label>
            </div>
            <div className={styles.setuju}>
              <label className={styles.setujuBaris}>
                <input
                  type="checkbox"
                  checked={isian.setuju}
                  onChange={e => ubah('setuju', e.target.checked)}
                  aria-invalid={galatIsian.setuju ? true : undefined}
                  aria-describedby={galatIsian.setuju ? 'minat-setuju-galat minat-pdp' : 'minat-pdp'}
                />
                <span>{kalimatPersetujuan(kanal)}</span>
              </label>
              <p id="minat-pdp" className={styles.setujuCatatan}>
                <ShieldCheck size={16} aria-hidden="true" />
                <span>
                  {NASKAH_PDP.retensi}{' '}
                  <Link href={NASKAH_PDP.hrefTautan} target="_blank" rel="noopener noreferrer">{NASKAH_PDP.teksTautan}</Link>.
                </span>
              </p>
              {galatIsian.setuju && <p id="minat-setuju-galat" className={styles.setujuGalat} role="alert">{galatIsian.setuju}</p>}
            </div>
          </fieldset>
        </div>
      )}
    </KerangkaModal>
  );
}

/** Formulir minat dalam dialog. Isinya hanya dipasang saat terbuka sehingga `operasi_id` dan isian mulai baru tiap pembukaan. */
export default function FormulirMinat({ terbuka, ...sisa }: Props) {
  return terbuka ? <IsiFormulir {...sisa} /> : null;
}
