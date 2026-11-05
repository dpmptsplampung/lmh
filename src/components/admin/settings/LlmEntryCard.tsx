'use client';

import Lencana from '@/components/ui/Lencana';
import Field from '@/components/ui/Field';

import Tombol from '@/components/ui/Tombol';

import tampilan from './LlmEntryCard.dasbor.module.css';

import { useState } from 'react';
import { ArrowUp, ArrowDown, Trash2, Loader2, FlaskConical, Copy, KeyRound } from 'lucide-react';
import type { HasilUjiRingkas, LlmEntry, UjiDetail } from './llm-types';
import styles from './settings.module.css';

interface Props {
  entry: LlmEntry;
  index: number;
  total: number;
  hasilUji?: HasilUjiRingkas;
  uji?: UjiDetail;
  ujiBusy: boolean;
  enkripsiSiap: boolean;
  error?: string;
  onChange: (patch: Partial<LlmEntry>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  // Mengembalikan pesan galat, atau null bila kunci tersimpan.
  onSaveKey: (kunci: string) => Promise<string | null>;
  onUji: () => void;
  onSalin: (teks: string) => void;
}

export default function LlmEntryCard(p: Props) {
  const { entry: e } = p;
  const [kunci, setKunci] = useState(''); // nilai mentah hanya hidup di input ini; dikosongkan setelah simpan
  const [savingKey, setSavingKey] = useState(false);
  const [keyErr, setKeyErr] = useState('');
  const idp = `llm-${e.id}`;

  const simpanKunci = async () => {
    if (!kunci.trim()) return;
    setSavingKey(true); setKeyErr('');
    const err = await p.onSaveKey(kunci.trim());
    setSavingKey(false);
    if (err) setKeyErr(err); else setKunci('');
  };

  const status = p.hasilUji ? (p.hasilUji.ok ? 'Lulus uji' : 'Gagal uji') : 'Belum diuji';

  return (
    <li className={[styles.card, tampilan.area1].filter(Boolean).join(' ')} aria-label={`Penyedia ${p.index + 1}: ${e.label}`}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>#{p.index + 1} {e.label || '(tanpa nama)'}</h3>
        <div className={styles.row}>
          <Lencana nada={p.hasilUji ? (p.hasilUji.ok ? 'sukses' : 'bahaya') : 'netral'}>{status}</Lencana>
          <Tombol type="button" varian="hantu" ukuran="kecil" onClick={() => p.onMove(-1)} disabled={p.index === 0} aria-label={`Naikkan prioritas ${e.label}`}><ArrowUp size={14} /></Tombol>
          <Tombol type="button" varian="hantu" ukuran="kecil" onClick={() => p.onMove(1)} disabled={p.index === p.total - 1} aria-label={`Turunkan prioritas ${e.label}`}><ArrowDown size={14} /></Tombol>
          <Tombol type="button" varian="hantu" ukuran="kecil" onClick={p.onRemove} aria-label={`Hapus penyedia ${e.label}`}><Trash2 size={14} /></Tombol>
        </div>
      </div>

      <div className={styles.fields}>
        <Field label="Nama penyedia">
          <input id={`${idp}-label`} className="form-input" value={e.label} maxLength={60} onChange={(ev) => p.onChange({ label: ev.target.value })} />
        </Field>
        <Field label="Jenis API">
          <select id={`${idp}-tipe`} className="form-select" value={e.tipe} onChange={(ev) => p.onChange({ tipe: ev.target.value as LlmEntry['tipe'] })}>
            <option value="gemini">Gemini (resmi)</option>
            <option value="openai_compat">Kompatibel OpenAI (gateway)</option>
          </select>
        </Field>
        <Field label="Model">
          <input id={`${idp}-model`} className="form-input" value={e.model} onChange={(ev) => p.onChange({ model: ev.target.value })} />
        </Field>
        <Field label="Kuota harian (kosong = tanpa batas)">
          <input
            id={`${idp}-kuota`} type="number" min={1} className="form-input"
            value={e.kuota_harian ?? ''}
            onChange={(ev) => p.onChange({ kuota_harian: ev.target.value === '' ? null : Math.max(1, parseInt(ev.target.value, 10) || 1) })}
          />
        </Field>
      </div>

      {e.tipe === 'openai_compat' && (
        <div className={["form-group", tampilan.area2].filter(Boolean).join(' ')}>
          <label className="form-label" htmlFor={`${idp}-url`}>Base URL (hanya https)</label>
          <input
            id={`${idp}-url`} type="url" inputMode="url" className="form-input" placeholder="https://api.contoh.com/v1"
            value={e.base_url} onChange={(ev) => p.onChange({ base_url: ev.target.value })}
            aria-invalid={!!p.error} aria-describedby={p.error ? `${idp}-err` : undefined}
          />
          <p className={styles.hint}>Wajib https, port 443, domain publik. Alamat lokal/internal ditolak server.</p>
        </div>
      )}
      {e.tipe === 'gemini' && <p className={styles.hint}>Jenis Gemini selalu memakai alamat resmi Google (base URL diabaikan).</p>}
      {p.error && <p id={`${idp}-err`} className={styles.errText} role="alert">{p.error}</p>}

      <div className={["form-group", tampilan.area2].filter(Boolean).join(' ')}>
        <label className="form-label" htmlFor={`${idp}-key`}>API key (hanya-tulis)</label>
        <p className={styles.hint} data-testid={`kunci-${e.id}`}>
          {e.punya_kunci || e.rahasia_id
            ? <>Kunci tersimpan: <span className={styles.keyMask}>{e.kunci_tersamar ?? '••••'}</span>. Kunci tidak pernah ditampilkan lagi; isi kolom di bawah untuk menggantinya.</>
            : 'Belum ada kunci.'}
        </p>
        <div className={styles.row}>
          <input
            id={`${idp}-key`} type="password" autoComplete="new-password" spellCheck={false}
            className={["form-input", tampilan.area3].filter(Boolean).join(' ')}
            placeholder="Tempel API key baru" value={kunci} disabled={!p.enkripsiSiap}
            onChange={(ev) => setKunci(ev.target.value)}
          />
          <Tombol type="button" varian="sekunder" ukuran="kecil" onClick={simpanKunci} disabled={!p.enkripsiSiap || !kunci.trim() || savingKey} aria-busy={savingKey}>
            {savingKey ? <Loader2 size={14} className="animate-pulse" /> : <KeyRound size={14} />} Simpan kunci
          </Tombol>
        </div>
        {!p.enkripsiSiap && <p className={styles.hint}>Penyimpanan kunci dinonaktifkan sampai SETTINGS_ENCRYPTION_KEY diatur (lihat peringatan di atas).</p>}
        {keyErr && <p className={styles.errText} role="alert">{keyErr}</p>}
      </div>

      <div className={[styles.row, tampilan.area2].filter(Boolean).join(' ')}>
        <label className={tampilan.baris4}>
          <input type="checkbox" checked={e.aktif} onChange={(ev) => p.onChange({ aktif: ev.target.checked })} />
          Aktif dalam rantai
        </label>
        <Tombol type="button" varian="sekunder" ukuran="kecil" onClick={p.onUji} disabled={p.ujiBusy} aria-busy={p.ujiBusy}>
          {p.ujiBusy ? <><Loader2 size={14} className="animate-pulse" /> Menguji...</> : <><FlaskConical size={14} /> Uji {e.label}</>}
        </Tombol>
      </div>

      <div aria-live="polite">
        {p.uji && (
          <div className={`${styles.result} ${p.uji.ok ? styles.resultOk : styles.resultFail}`} data-testid={`uji-${e.id}`}>
            <strong>{p.uji.ok ? 'Berhasil' : 'Gagal'}</strong>
            {' · '}HTTP {p.uji.http_status ?? '-'}{' · '}{p.uji.latensi_ms ?? '-'} ms
            {p.uji.cuplikan && <p className={styles.quote}>Balasan contoh: {p.uji.cuplikan}</p>}
            {p.uji.error && <p className={styles.errText}>{p.uji.error}</p>}
            {p.uji.curl && (
              <>
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- area gulir harus bisa difokus papan ketik agar isinya terbaca */}
                <pre className={styles.pre} tabIndex={0} aria-label="Perintah curl setara (kunci tersamar)">{p.uji.curl}</pre>
                <Tombol type="button" varian="hantu" ukuran="kecil" onClick={() => p.onSalin(p.uji!.curl)}><Copy size={14} /> Salin curl</Tombol>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
