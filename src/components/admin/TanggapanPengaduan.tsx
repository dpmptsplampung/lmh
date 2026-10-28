'use client';

import { useRef, useState } from 'react';
import { Loader2, Paperclip, Send, X } from 'lucide-react';
import { unggahKeR2 } from '@/lib/storage/unggah';

export interface TanggapanRow {
  id: string;
  isi: string;
  status_baru: string | null;
  created_at: string;
}

interface Props {
  pengaduanId: string;
  /** Email pelapor tersedia dan pelapor tidak anonim -> kotak "kirim ke email" aktif. */
  bisaEmail: boolean;
  tanggapan: TanggapanRow[];
  statusSaatIni: string;
  onTerkirim: () => void;
  onGalat: (pesan: string) => void;
}

const BATAS = 5 * 1024 * 1024;
const MIME_OK = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EKS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

// Form tanggapan untuk pelapor + daftar tanggapan sebelumnya. Peringatan: tanggapan dan lampiran bisa dilihat siapa pun yang
// memegang nomor laporan (pengaduan dari Pesan Perilaku), jadi jangan mencantumkan data pribadi.
export default function TanggapanPengaduan({ pengaduanId, bisaEmail, tanggapan, statusSaatIni, onTerkirim, onGalat }: Props) {
  const [terbuka, setTerbuka] = useState(false);
  const [isi, setIsi] = useState('');
  const [selesai, setSelesai] = useState(false);
  const [email, setEmail] = useState(bisaEmail);
  const [berkas, setBerkas] = useState<File[]>([]);
  const [kirim, setKirim] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pilih = (daftar: FileList | null) => {
    if (!daftar) return;
    const baru = [...berkas];
    for (const f of Array.from(daftar)) {
      if (!MIME_OK.includes(f.type)) { onGalat('Lampiran harus JPG, PNG, WEBP, atau PDF'); continue; }
      if (f.size > BATAS) { onGalat('Ukuran lampiran maksimal 5 MB'); continue; }
      if (baru.length >= 3) { onGalat('Maksimal 3 lampiran'); break; }
      baru.push(f);
    }
    setBerkas(baru);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isi.trim() || kirim) return;
    setKirim(true);
    try {
      const lampiran: Array<{ kunci: string; nama: string; mime: string; ukuran: number }> = [];
      for (const f of berkas) {
        const { kunci } = await unggahKeR2('pengaduan-bukti', `${pengaduanId}/${crypto.randomUUID()}.${EKS[f.type]}`, f);
        lampiran.push({ kunci, nama: f.name.slice(0, 200), mime: f.type, ukuran: f.size });
      }
      const res = await fetch(`/api/admin/pengaduan/${pengaduanId}/tanggapan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isi: isi.trim(), status: selesai ? 'selesai' : null, kirim_email: bisaEmail && email, lampiran }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Gagal menyimpan tanggapan');
      setIsi(''); setBerkas([]); setSelesai(false); setTerbuka(false);
      onTerkirim();
    } catch (err) {
      onGalat(err instanceof Error ? err.message : 'Gagal menyimpan tanggapan');
    } finally {
      setKirim(false);
    }
  };

  const tutup = statusSaatIni === 'selesai' || statusSaatIni === 'ditolak';

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      {tanggapan.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
          {tanggapan.map((t) => (
            <li key={t.id} style={{ background: 'var(--color-neutral-50, #f9fafb)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{t.isi}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
                {new Date(t.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB{t.status_baru ? ` · status: ${t.status_baru}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!terbuka ? (
        <div>
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => setTerbuka(true)}>
            <Send size={14} aria-hidden="true" /> {tutup ? 'Tambah tanggapan' : 'Tanggapi pelapor'}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <label htmlFor={`tgp-${pengaduanId}`} style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Tanggapan untuk pelapor</label>
          <textarea
            id={`tgp-${pengaduanId}`}
            className="input"
            rows={4}
            maxLength={2000}
            value={isi}
            onChange={(e) => setIsi(e.target.value)}
            placeholder="Tulis tanggapan…"
          />
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            Tanggapan dan lampiran dapat dilihat siapa pun yang memegang nomor laporan. Jangan cantumkan data pribadi.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input ref={inputRef} type="file" hidden multiple accept={MIME_OK.join(',')} onChange={(e) => { pilih(e.target.files); e.target.value = ''; }} />
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => inputRef.current?.click()} disabled={berkas.length >= 3}>
              <Paperclip size={14} aria-hidden="true" /> Lampiran ({berkas.length}/3)
            </button>
            {berkas.map((f, i) => (
              <span key={`${f.name}-${i}`} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {f.name.slice(0, 24)}
                <button type="button" aria-label={`Hapus ${f.name}`} onClick={() => setBerkas(berkas.filter((_, j) => j !== i))} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--text-sm)', opacity: bisaEmail ? 1 : 0.6 }}>
            <input type="checkbox" checked={bisaEmail && email} disabled={!bisaEmail} onChange={(e) => setEmail(e.target.checked)} />
            Kirim juga ke email pelapor {bisaEmail ? '' : '(tidak tersedia: anonim atau tanpa email)'}
          </label>
          {!tutup && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--text-sm)' }}>
              <input type="checkbox" checked={selesai} onChange={(e) => setSelesai(e.target.checked)} />
              Selesaikan sekarang (status menjadi Selesai)
            </label>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="submit" className="btn btn--sm btn--primary" disabled={!isi.trim() || kirim}>
              {kirim ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />} Kirim tanggapan
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setTerbuka(false)} disabled={kirim}>Batal</button>
          </div>
        </form>
      )}
    </div>
  );
}
