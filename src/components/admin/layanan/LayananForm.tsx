'use client';

import { useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';

export type StatusTampilan = 'aktif' | 'coming_soon' | 'nonaktif';

export interface LayananRow {
  id: string;
  nama: string;
  tipe: string;
  aktif: boolean;
  penyerta: boolean;
  status_tampilan: StatusTampilan;
  tampil_di_layar: boolean;
  punya_antrean: boolean;
  punya_chat: boolean;
  chatbot_aktif: boolean;
  nomor_loket: string | null;
  prefiks_antrean: string | null;
}

export const STATUS_LABEL: Record<StatusTampilan, string> = {
  aktif: 'Tampil',
  coming_soon: 'Segera hadir',
  nonaktif: 'Disembunyikan',
};

/** Form ubah layanan (Admin). Hanya mengirim field yang berubah; ganti nama butuh konfirmasi. */
export default function LayananForm({
  layanan, saving, error, onSubmit, onCancel,
}: {
  layanan: LayananRow;
  saving: boolean;
  error: string;
  onSubmit: (patch: Record<string, string | boolean | null>) => void;
  onCancel: () => void;
}) {
  const [nama, setNama] = useState(layanan.nama);
  const [loket, setLoket] = useState(layanan.nomor_loket ?? '');
  const [prefiks, setPrefiks] = useState(layanan.prefiks_antrean ?? '');
  const [status, setStatus] = useState<StatusTampilan>(layanan.status_tampilan);
  const [layar, setLayar] = useState(layanan.tampil_di_layar);
  const [antrean, setAntrean] = useState(layanan.punya_antrean);
  const [chat, setChat] = useState(layanan.punya_chat);
  const [localError, setLocalError] = useState('');
  const [konfirmasiNama, setKonfirmasiNama] = useState(false);

  const kirim = () => {
    const patch: Record<string, string | boolean | null> = {};
    if (nama.trim() !== layanan.nama) patch.nama = nama.trim();
    if ((loket.trim() || null) !== layanan.nomor_loket) patch.nomor_loket = loket.trim() || null;
    if ((prefiks.trim().toUpperCase() || null) !== layanan.prefiks_antrean) patch.prefiks = prefiks.trim().toUpperCase() || null;
    if (status !== layanan.status_tampilan) patch.status_tampilan = status;
    if (layar !== layanan.tampil_di_layar) patch.tampil_di_layar = layar;
    if (antrean !== layanan.punya_antrean) patch.punya_antrean = antrean;
    if (chat !== layanan.punya_chat) patch.punya_chat = chat;
    if (Object.keys(patch).length === 0) {
      setLocalError('Tidak ada perubahan.');
      return;
    }
    onSubmit(patch);
  };

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (nama.trim().length < 2) {
      setLocalError('Nama layanan minimal 2 karakter.');
      return;
    }
    if (prefiks && !/^[A-Za-z]{1,3}$/.test(prefiks.trim())) {
      setLocalError('Prefiks 1-3 huruf.');
      return;
    }
    if (nama.trim() !== layanan.nama && !konfirmasiNama) {
      setKonfirmasiNama(true);
      return;
    }
    kirim();
  };

  const msg = localError || error;
  return (
    <form onSubmit={handle} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {msg && <p className="form-error" role="alert">{msg}</p>}
      <div className="form-group">
        <label className="form-label form-label--required" htmlFor="lyNama">Nama layanan</label>
        <input id="lyNama" className="form-input" value={nama} maxLength={100}
          onChange={(e) => { setNama(e.target.value); setKonfirmasiNama(false); }} />
      </div>
      {konfirmasiNama && (
        <div role="alertdialog" aria-label="Konfirmasi ganti nama"
          style={{ border: '1px solid var(--color-warning-500, #f59e0b)', borderRadius: 'var(--radius-md, 8px)', padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)' }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0 }}>
            Beberapa fitur mencocokkan layanan berdasarkan <strong>nama</strong>. Mengganti nama dari
            {' '}<strong>{layanan.nama}</strong> menjadi <strong>{nama.trim()}</strong> bisa memutus pencocokan tersebut. Lanjutkan?
          </p>
        </div>
      )}
      <div className="form-group">
        <label className="form-label" htmlFor="lyLoket">Nomor loket</label>
        <input id="lyLoket" className="form-input" value={loket} maxLength={20} onChange={(e) => setLoket(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="lyPrefiks">Prefiks antrean</label>
        <input id="lyPrefiks" className="form-input" value={prefiks} maxLength={3} onChange={(e) => setPrefiks(e.target.value.toUpperCase())} />
        <p className="form-hint">1-3 huruf, unik. Hanya memengaruhi nomor antrean BARU.</p>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="lyStatus">Di halaman utama / daftar layanan</label>
        <select id="lyStatus" className="form-input" value={status} onChange={(e) => setStatus(e.target.value as StatusTampilan)}>
          <option value="aktif">Tampil</option>
          <option value="coming_soon">Segera hadir</option>
          <option value="nonaktif">Disembunyikan</option>
        </select>
        <p className="form-hint">Tidak memengaruhi penerbitan tiket atau check-in.</p>
      </div>
      <label style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input type="checkbox" checked={layar} onChange={(e) => setLayar(e.target.checked)} /> Tampil di layar TV
      </label>
      <label style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input type="checkbox" checked={antrean} onChange={(e) => setAntrean(e.target.checked)} /> Punya antrean
      </label>
      <label style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input type="checkbox" checked={chat} onChange={(e) => setChat(e.target.checked)} /> Punya chat
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Batal</button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-pulse" /> : null}
          {konfirmasiNama ? 'Ya, ganti nama' : 'Simpan'}
        </button>
      </div>
    </form>
  );
}
