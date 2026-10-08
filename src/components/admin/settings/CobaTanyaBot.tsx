'use client';

import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import styles from './settings.module.css';

interface BotResult {
  ok: boolean;
  jawaban?: string | null;
  reason?: string | null;
  penyedia?: string | null;
  skor_faq?: number | null;
  latensi_ms?: number;
  eskalasi?: boolean;
  chatbot_aktif?: boolean;
  sumber?: unknown[];
  sumber_dokumen?: Array<{ id: string; judul?: string; nomor_pasal?: string | null }>;
  error?: string;
}

// Panel uji bot per layanan (Admin & Petugas). Tidak menyimpan pesan/log (server: bot/coba).
export default function CobaTanyaBot({ layananId, layananNama }: { layananId: string; layananNama?: string }) {
  const [pertanyaan, setPertanyaan] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasil, setHasil] = useState<BotResult | null>(null);
  const [galat, setGalat] = useState('');

  const kirim = async () => {
    const q = pertanyaan.trim();
    if (q.length < 3) { setGalat('Tulis pertanyaan minimal 3 karakter.'); return; }
    if (!layananId) { setGalat('Pilih layanan terlebih dahulu.'); return; }
    setLoading(true); setGalat(''); setHasil(null);
    try {
      const res = await fetch('/api/admin/settings/bot/coba', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pertanyaan: q, layanan_id: layananId }),
      });
      const data = (await res.json().catch(() => null)) as BotResult | null;
      if (!res.ok) {
        setGalat(
          res.status === 429 ? 'Terlalu sering mencoba (batas 30 kali per jam). Coba lagi nanti.'
            : res.status === 403 ? 'Anda hanya boleh menguji bot untuk layanan Anda sendiri.'
            : data?.error || 'Gagal menguji bot.',
        );
      } else if (data) setHasil(data);
    } catch {
      setGalat('Tidak dapat menghubungi server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={`${styles.card} ${styles.botBox}`} aria-labelledby="coba-bot-judul">
      <h2 id="coba-bot-judul" className={styles.cardTitle}>Coba tanya bot{layananNama ? ` — ${layananNama}` : ''}</h2>
      <p className={styles.hint}>
        Mencoba jawaban bot seperti yang dilihat pengunjung. Tidak ada pesan, sesi, atau log yang disimpan dan tidak ada eskalasi ke petugas.
      </p>
      <div role="group" aria-label="Uji bot" style={{ marginTop: 'var(--space-3)' }}>
        <label className="form-label" htmlFor="cobaPertanyaan">Teks uji untuk bot</label>
        <textarea
          id="cobaPertanyaan"
          className="form-textarea"
          rows={3}
          maxLength={2000}
          value={pertanyaan}
          onChange={(e) => setPertanyaan(e.target.value)}
          placeholder="Contoh: Apa syarat membuat NIB?"
        />
        <div className={styles.row} style={{ marginTop: 'var(--space-2)' }}>
          <button type="button" onClick={kirim} className="btn btn--primary btn--sm" disabled={loading || !layananId} aria-busy={loading}>
            {loading ? <><Loader2 size={14} className="animate-pulse" /> Menguji...</> : <><Send size={14} /> Kirim</>}
          </button>
        </div>
      </div>

      <div aria-live="polite">
        {galat && <p className={styles.errText} role="alert">{galat}</p>}
        {hasil && (
          <div className={`${styles.result} ${hasil.ok ? styles.resultOk : styles.resultFail}`} data-testid="hasil-coba-bot">
            {hasil.chatbot_aktif === false && (
              <p className={styles.hint}>Catatan: bot layanan ini sedang NONAKTIF untuk pengunjung; ini hanya uji.</p>
            )}
            <p className={styles.quote}>{hasil.jawaban || (hasil.ok ? '(tidak ada jawaban)' : 'Bot gagal menjawab.')}</p>
            <p className={styles.hint}>
              {hasil.penyedia ? `Penyedia: ${hasil.penyedia} · ` : ''}
              {typeof hasil.skor_faq === 'number' ? `Skor FAQ: ${hasil.skor_faq.toFixed(2)} · ` : ''}
              {typeof hasil.latensi_ms === 'number' ? `${hasil.latensi_ms} ms · ` : ''}
              {hasil.reason ? `Alasan: ${hasil.reason}` : ''}
              {hasil.eskalasi ? ' · akan dieskalasi ke petugas' : ''}
            </p>
            {Array.isArray(hasil.sumber_dokumen) && hasil.sumber_dokumen.length > 0 && (
              <p className={styles.hint}>
                Dokumen dipakai: {hasil.sumber_dokumen.map((d) => `${d.judul ?? d.id}${d.nomor_pasal ? ` (${d.nomor_pasal})` : ''}`).join('; ')}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
