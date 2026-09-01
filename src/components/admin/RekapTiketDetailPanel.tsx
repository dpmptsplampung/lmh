'use client';

import { useEffect } from 'react';
import { X, FileText, User, Clock, Briefcase } from 'lucide-react';
import type { RekapTicketRow } from '@/lib/rekap/excel';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit } from '@/lib/rekap/format';

interface Props {
  tiket: RekapTicketRow | null;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', marginTop: 2 }}>
        {value || '—'}
      </div>
    </div>
  );
}

export default function RekapTiketDetailPanel({ tiket, onClose }: Props) {
  useEffect(() => {
    if (!tiket) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tiket, onClose]);

  if (!tiket) return null;

  const durasi = hitungDurasiMenit(tiket.waktu_mulai_layan, tiket.waktu_selesai);
  const o = tiket.pelayanan_oss;
  const p = tiket.pelayanan_perizinAN;

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Detail tiket ${tiket.nomor_display}`}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 1000,
        }}
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 'min(440px, 92vw)',
            background: '#ffffff',
            boxShadow: '-4px 0 20px rgba(15, 23, 42, 0.12)',
            overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <header style={{
            padding: 'var(--space-5)',
            background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
            borderBottom: '1px solid var(--border-default)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            position: 'sticky', top: 0, zIndex: 1,
          }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                Detail Tiket
              </div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-primary-700)' }}>
                {tiket.nomor_display}
              </div>
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Tutup">
              <X size={18} />
            </button>
          </header>

          <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <section>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <User size={14} /> Identitas Pengunjung
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <Field label="Nama" value={tiket.kunjungan?.nama} />
                <Field label="Asal" value={tiket.kunjungan?.asal} />
                <Field label="Tanggal" value={formatTanggalId(tiket.tanggal)} />
                <Field label="QR Token" value={tiket.kunjungan?.qr_token} />
              </div>
            </section>

            <section>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={14} /> Tiket
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <Field label="Waktu Terbit" value={formatWaktuId(tiket.waktu_terbit)} />
                <Field label="Waktu Mulai" value={formatWaktuId(tiket.waktu_mulai_layan)} />
                <Field label="Waktu Selesai" value={formatWaktuId(tiket.waktu_selesai)} />
                <Field label="Durasi" value={durasi != null ? `${durasi} menit` : null} />
              </div>
            </section>

            <section>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Briefcase size={14} /> Petugas
              </h3>
              <Field label="Nama Petugas" value={tiket.petugas?.nama} />
            </section>

            {tiket.form_type === 'oss' && o && (
              <section>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileText size={14} /> Pendataan OSS
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <Field label="Nama Pemohon" value={o.nama_pemohon} />
                  <Field label="Nama Usaha" value={o.nama_usaha} />
                  <Field label="Tipe Pelaku" value={o.tipe_pelaku_usaha} />
                  <Field label="Status PM" value={o.status_penanaman_modal} />
                  <Field label="Lokasi" value={o.lokasi_usaha} />
                  <Field label="Skala" value={o.skala_usaha} />
                  <Field label="Sektor KBLI" value={o.sektor_usaha_kbli} />
                  <Field label="Tindak Lanjut" value={o.tindak_lanjut} />
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Uraian Solusi" value={o.uraian_solusi} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Catatan Internal" value={o.catatan_internal} />
                  </div>
                </div>
              </section>
            )}

            {tiket.form_type === 'perizinAN' && p && (
              <section>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileText size={14} /> Pendataan PerizinAN
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <Field label="Nama Pemohon" value={p.nama_pemohon} />
                  <Field label="Nama Perusahaan" value={p.nama_perusahaan} />
                  <Field label="OPD Teknis" value={p.opd_teknis} />
                  <Field label="Tindak Lanjut" value={p.tindak_lanjut} />
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Uraian Permohonan" value={p.uraian_permohonan} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Catatan Petugas" value={p.catatan_petugas} />
                  </div>
                </div>
              </section>
            )}

            {!tiket.form_type && (
              <section>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', textAlign: 'center', padding: 'var(--space-4)' }}>
                  Tiket ini tidak memiliki data pendataan.
                </p>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
