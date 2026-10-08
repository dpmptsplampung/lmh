'use client';

// Koreksi data pelayanan yang sudah terkunci (Admin + Front Office).
// PUT /api/admin/pelayanan/[tiketId] { perubahan, alasan } — kontrak: docs/RBAC_TAHAP1_KONTRAK.md §1.
import { useEffect, useState } from 'react';
import { X, Loader2, Lock } from 'lucide-react';
import { useToast } from '@/components/Toast';
import {
  SKALA_USAHA_OPTIONS,
  TIPE_PELAKU_USAHA_OPTIONS,
  TIPE_PELAKU_USAHA_LABELS,
  STATUS_PENANAMAN_MODAL_OPTIONS,
  STATUS_PENANAMAN_MODAL_LABELS,
  TINDAK_LANJUT_OSS_OPTIONS,
  OPD_TEKNIS_OPTIONS,
  TINDAK_LANJUT_PERIZINAN_OPTIONS,
  PelayananInitialData,
  FormPelayananType,
} from '@/lib/types/pelayanan';

interface Field {
  key: string;
  label: string;
  kind?: 'text' | 'textarea' | 'select';
  options?: readonly string[];
  labels?: Record<string, string>;
}

const COMMON: Field[] = [
  { key: 'nama_pemohon', label: 'Nama Pemohon' },
  { key: 'alamat_pemohon', label: 'Alamat / Instansi Pemohon' },
  { key: 'no_hp', label: 'No. HP' },
  { key: 'email', label: 'Email' },
  { key: 'keperluan_awal', label: 'Keperluan Awal', kind: 'textarea' },
];

const FIELDS: Record<FormPelayananType, Field[]> = {
  oss: [
    ...COMMON,
    { key: 'nama_usaha', label: 'Nama Usaha' },
    { key: 'tipe_pelaku_usaha', label: 'Tipe Pelaku Usaha', kind: 'select', options: TIPE_PELAKU_USAHA_OPTIONS, labels: TIPE_PELAKU_USAHA_LABELS },
    { key: 'status_penanaman_modal', label: 'Status Penanaman Modal', kind: 'select', options: STATUS_PENANAMAN_MODAL_OPTIONS, labels: STATUS_PENANAMAN_MODAL_LABELS },
    { key: 'lokasi_usaha', label: 'Lokasi Usaha' },
    { key: 'skala_usaha', label: 'Skala Usaha', kind: 'select', options: SKALA_USAHA_OPTIONS },
    { key: 'sektor_usaha_kbli', label: 'Sektor Usaha / KBLI' },
    { key: 'tindak_lanjut', label: 'Tindak Lanjut', kind: 'select', options: TINDAK_LANJUT_OSS_OPTIONS },
    { key: 'uraian_solusi', label: 'Uraian Solusi / Konsultasi', kind: 'textarea' },
    { key: 'catatan_internal', label: 'Catatan Internal', kind: 'textarea' },
  ],
  perizinan: [
    ...COMMON,
    { key: 'nama_perusahaan', label: 'Nama Perusahaan' },
    { key: 'lokasi_usaha', label: 'Lokasi Usaha' },
    { key: 'opd_teknis', label: 'OPD Teknis', kind: 'select', options: OPD_TEKNIS_OPTIONS },
    { key: 'uraian_permohonan', label: 'Uraian Permohonan', kind: 'textarea' },
    { key: 'tindak_lanjut', label: 'Tindak Lanjut', kind: 'select', options: TINDAK_LANJUT_PERIZINAN_OPTIONS },
    { key: 'catatan_petugas', label: 'Catatan Petugas', kind: 'textarea' },
  ],
};

const MIN_ALASAN = 5;

interface Props {
  isOpen: boolean;
  tiketId: string | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function KoreksiPelayananModal({ isOpen, tiketId, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<PelayananInitialData | null>(null);
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [alasan, setAlasan] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !tiketId) return;
    let active = true;
    (async () => {
      setLoading(true);
      setLoadError(null);
      setError(null);
      setAlasan('');
      try {
        const res = await fetch(`/api/admin/pelayanan/${tiketId}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Gagal memuat data pelayanan');
        if (!active) return;
        const d = body as PelayananInitialData;
        const row = ((d.form_type === 'oss' ? d.data_oss : d.data_perizinan) ?? {}) as Record<string, unknown>;
        const init: Record<string, string> = {};
        for (const f of FIELDS[d.form_type]) init[f.key] = typeof row[f.key] === 'string' ? (row[f.key] as string) : '';
        setData(d);
        setOriginal(init);
        setValues(init);
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : 'Gagal memuat data pelayanan');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isOpen, tiketId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const fields = data ? FIELDS[data.form_type] : [];
  const perubahan: Record<string, string | null> = {};
  for (const f of fields) {
    const now = (values[f.key] ?? '').trim();
    if (now !== (original[f.key] ?? '').trim()) perubahan[f.key] = now === '' ? null : now;
  }
  const jumlahUbah = Object.keys(perubahan).length;
  const alasanOk = alasan.trim().length >= MIN_ALASAN;

  const submit = async () => {
    if (!tiketId || !data) return;
    setError(null);
    if (jumlahUbah === 0) return setError('Belum ada data yang diubah.');
    if (!alasanOk) return setError(`Alasan koreksi wajib diisi (minimal ${MIN_ALASAN} huruf).`);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/pelayanan/${tiketId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perubahan, alasan: alasan.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'Anda tidak berwenang mengoreksi data terkunci. Hubungi Front Office atau Admin.'
            : res.status === 401
              ? 'Sesi berakhir. Silakan masuk kembali.'
              : body.error || 'Gagal menyimpan koreksi.',
        );
        return;
      }
      toast('Koreksi tersimpan dan tercatat di riwayat', 'success');
      onSuccess?.();
      onClose();
    } catch {
      setError('Gagal menghubungi server. Periksa koneksi lalu coba lagi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kp-title"
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          background: '#ffffff', borderRadius: 'var(--radius-2xl, 16px)', width: '100%', maxWidth: '720px',
          maxHeight: 'calc(100dvh - 2rem)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border-default, #e2e8f0)',
        }}
      >
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-default, #e2e8f0)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 id="kp-title" style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Lock size={16} /> Koreksi Data{data ? ` — ${data.nomor_display}` : ''}
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Data sudah dikunci. Setiap koreksi wajib beralasan dan tercatat di riwayat (nilai lama dan baru).
            </p>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Tutup">
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-6)', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
              <Loader2 size={24} className="animate-spin" style={{ display: 'block', margin: '0 auto 8px' }} />
              Memuat data…
            </p>
          ) : loadError ? (
            <p role="alert" style={{ color: 'var(--color-danger-700, #b91c1c)' }}>{loadError}</p>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {fields.map((f) => {
                const id = `kp-${f.key}`;
                const cur = values[f.key] ?? '';
                const set = (v: string) => setValues((s) => ({ ...s, [f.key]: v }));
                const changed = f.key in perubahan;
                return (
                  <div className="form-group" key={f.key}>
                    <label className="form-label" htmlFor={id}>
                      {f.label}{changed && <em style={{ marginLeft: 6, fontWeight: 400, color: 'var(--color-primary-700)' }}>(diubah)</em>}
                    </label>
                    {f.kind === 'select' ? (
                      <select id={id} className="form-input" value={cur} onChange={(e) => set(e.target.value)}>
                        <option value="">—</option>
                        {cur && !f.options?.includes(cur) && <option value={cur}>{cur}</option>}
                        {f.options?.map((o) => (
                          <option key={o} value={o}>{f.labels?.[o] ?? o}</option>
                        ))}
                      </select>
                    ) : f.kind === 'textarea' ? (
                      <textarea id={id} className="form-input" rows={3} value={cur} onChange={(e) => set(e.target.value)} />
                    ) : (
                      <input id={id} type="text" className="form-input" value={cur} onChange={(e) => set(e.target.value)} />
                    )}
                  </div>
                );
              })}

              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="kp-alasan">Alasan Koreksi</label>
                <textarea
                  id="kp-alasan"
                  className="form-input"
                  rows={2}
                  value={alasan}
                  onChange={(e) => setAlasan(e.target.value)}
                  placeholder="Mis. salah ketik nama usaha (min. 5 huruf)"
                  aria-required="true"
                />
              </div>

              {error && <p role="alert" style={{ color: 'var(--color-danger-700, #b91c1c)', margin: 0 }}>{error}</p>}
            </form>
          )}
        </div>

        {!loading && !loadError && (
          <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border-default, #e2e8f0)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {jumlahUbah > 0 ? `${jumlahUbah} kolom diubah` : 'Belum ada perubahan'}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>Batal</button>
              <button type="button" className="btn btn--primary btn--sm" disabled={saving} onClick={() => void submit()}>
                {saving ? 'Menyimpan…' : 'Simpan Koreksi'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
