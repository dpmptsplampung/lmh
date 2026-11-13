'use client';

// Formulir reservasi (tanpa query; semua data dan aksi lewat props dari useReservasi). Layanan hanya untuk tujuan loket,
// nama hanya untuk bertemu seseorang; persetujuan PDP wajib sebelum kirim.
import type { FormEvent } from 'react';
import Link from 'next/link';
import { Clock, Send, Users } from 'lucide-react';
import ErrorRetry from '@/components/ErrorRetry';
import Field from '@/components/ui/Field';
import PemilihTanggal from '@/components/ui/PemilihTanggal';
import Tombol from '@/components/ui/Tombol';
import type { EstimasiAntreanLoket, LayananReservasi } from '@/lib/data/reservasi';
import { petunjukTanggal, tampilkanEstimasi } from '../_logika/tampilanReservasi';
import type { IsianReservasi } from '../_logika/validasiReservasi';
import PilihTujuan from './PilihTujuan';
import styles from '../reservasi.module.css';

export const TEKS_PERSETUJUAN_RESERVASI = 'Saya setuju data saya diproses sesuai Kebijakan Privasi.';

export interface FormReservasiProps {
  form: IsianReservasi;
  onUbah: (perubahan: Partial<IsianReservasi>) => void;
  onPilihTujuan: (tujuan: 'loket' | 'bertemu_seseorang') => void;
  layanan: { daftar: LayananReservasi[]; galat: boolean; memuat: boolean; onMuat: () => void };
  estimasi: EstimasiAntreanLoket | null;
  minDate: string;
  maxDate: string;
  error: string;
  consentGagal: boolean;
  consentGiven: boolean;
  onConsent: (setuju: boolean) => void;
  loading: boolean;
  /** Dipanggil dari submit formulir dan dari "Coba lagi" (tanpa event). */
  onKirim: (e?: FormEvent) => void;
}

export default function FormReservasi({
  form,
  onUbah,
  onPilihTujuan,
  layanan,
  estimasi,
  minDate,
  maxDate,
  error,
  consentGagal,
  consentGiven,
  onConsent,
  loading,
  onKirim,
}: FormReservasiProps) {
  return (
    <form className={styles.formBody} onSubmit={onKirim}>
      <PilihTujuan tujuan={form.tujuan} onPilih={onPilihTujuan} />

      {/* Layanan (jika loket) */}
      {form.tujuan === 'loket' && (
        <div className={styles.grup}>
          {layanan.galat ? (
            <>
              <span className={styles.labelGrup}>Layanan Tujuan</span>
              <ErrorRetry
                judul="Daftar layanan belum dapat dimuat"
                pesan="Periksa koneksi Anda lalu coba lagi. Anda belum dapat memilih layanan tujuan."
                onRetry={layanan.onMuat}
                memuat={layanan.memuat}
              />
            </>
          ) : layanan.daftar.length === 0 ? (
            <>
              <span className={styles.labelGrup}>Layanan Tujuan</span>
              <p className={styles.bantuan}>Belum ada layanan yang dapat direservasi saat ini.</p>
            </>
          ) : (
            <Field label="Layanan Tujuan" wajib>
              <select value={form.layanan_id} onChange={(e) => onUbah({ layanan_id: e.target.value })}>
                <option value="">— Pilih layanan —</option>
                {layanan.daftar.map((l) => (
                  <option key={l.id} value={l.id} disabled={l.status_tampilan === 'coming_soon'}>
                    {l.nama}{l.status_tampilan === 'coming_soon' ? ' (Segera hadir)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {/* A-07: v_antrian_loket = antrean HARI INI; tidak relevan untuk tanggal reservasi lain. */}
          {form.layanan_id && estimasi && tampilkanEstimasi(form.tanggal_rencana, minDate) && (
            <p className={styles.estimasiInline}>
              <Clock size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>
                Antrean hari ini: ~{estimasi.estimasi_tunggu_total_menit} menit,&nbsp;
                <Users size={14} strokeWidth={1.75} className={styles.ikonSebaris} aria-hidden="true" />
                {' '}{estimasi.antre_count} antre
              </span>
            </p>
          )}
        </div>
      )}

      {/* Nama yang ditemui (jika bertemu) */}
      {form.tujuan === 'bertemu_seseorang' && (
        <Field label="Nama yang Ingin Ditemui" wajib>
          <input
            type="text"
            placeholder="Masukkan nama lengkap"
            value={form.nama_yang_ditemui}
            onChange={(e) => onUbah({ nama_yang_ditemui: e.target.value })}
          />
        </Field>
      )}

      <Field label="Tanggal Kedatangan" wajib bantuan={petunjukTanggal(form.tujuan)}>
        {(p) => (
          <PemilihTanggal
            id={p.id}
            aria-describedby={p['aria-describedby']}
            label="Tanggal Kedatangan"
            nilai={form.tanggal_rencana}
            onUbah={(tanggal) => onUbah({ tanggal_rencana: tanggal })}
            min={minDate}
            max={maxDate}
          />
        )}
      </Field>

      {/* Jam (opsional) */}
      <Field label="Perkiraan Jam Kedatangan" bantuan="Opsional — membantu petugas mempersiapkan layanan">
        <input type="time" value={form.jam_rencana} onChange={(e) => onUbah({ jam_rencana: e.target.value })} />
      </Field>

      <Field label="Keperluan">
        <textarea
          placeholder="Jelaskan secara singkat keperluan Anda (opsional)"
          value={form.keperluan}
          onChange={(e) => onUbah({ keperluan: e.target.value })}
          rows={3}
        />
      </Field>

      {consentGagal ? (
        <ErrorRetry judul="Reservasi belum dibuat" pesan="Persetujuan belum tercatat, coba lagi" onRetry={() => onKirim()} />
      ) : (
        error && (
          <p className={styles.galatForm} role="alert">
            {error}
          </p>
        )
      )}

      {/* Consent PDP — wajib sebelum submit */}
      <div className={styles.consent}>
        <input
          id="consent"
          type="checkbox"
          className={styles.consentKotak}
          checked={consentGiven}
          onChange={(e) => onConsent(e.target.checked)}
          required
        />
        <label htmlFor="consent" className={styles.consentTeks}>
          {TEKS_PERSETUJUAN_RESERVASI}{' '}
          <Link href="/kebijakan-privasi" className={styles.consentTautan}>
            Baca kebijakan
          </Link>
        </label>
      </div>

      <Tombol
        type="submit"
        ikon={Send}
        memuat={loading}
        disabled={!consentGiven || (form.tujuan === 'loket' && layanan.daftar.length === 0)}
        className={styles.kirim}
      >
        {loading ? 'Memproses...' : 'Buat Reservasi'}
      </Tombol>
    </form>
  );
}
