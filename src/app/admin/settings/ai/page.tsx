'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Save, Rocket, History, RotateCcw, Info } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useToast } from '@/components/Toast';
import LlmEntryCard from '@/components/admin/settings/LlmEntryCard';
import type {
  HasilUjiRingkas, LlmEntry, LlmState, UjiDetail,
} from '@/components/admin/settings/llm-types';
import bs from '@/components/admin/settings/settings.module.css';
import styles from './ai.module.css';

const API = '/api/admin/settings/llm';
const ENC_HINT =
  'SETTINGS_ENCRYPTION_KEY belum diatur di server, sehingga API key belum bisa disimpan dari layar ini. ' +
  'Buat kunci 32 byte (contoh perintah: openssl rand -base64 32), isi sebagai environment variable SETTINGS_ENCRYPTION_KEY di Vercel, lalu deploy ulang. ' +
  'Sementara itu, penyedia dari environment lama tetap berjalan.';

type Load = 'loading' | 'ready' | 'error' | 'forbidden';

async function call(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}
const post = (path: string, body: unknown) =>
  call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID') : '-');

export default function PengaturanAiPage() {
  const { toast } = useToast();
  const [load, setLoad] = useState<Load>('loading');
  const [state, setState] = useState<LlmState | null>(null);
  const [entries, setEntries] = useState<LlmEntry[]>([]);
  const [draftVersi, setDraftVersi] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [hasilUji, setHasilUji] = useState<Record<string, HasilUjiRingkas>>({});
  const [ujiDetail, setUjiDetail] = useState<Record<string, UjiDetail>>({});
  const [ujiBusy, setUjiBusy] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [encPesan, setEncPesan] = useState('');
  const [presetId, setPresetId] = useState('');
  const [tanpaUji, setTanpaUji] = useState(false);
  const [alasanAktif, setAlasanAktif] = useState('');
  const [aktifBusy, setAktifBusy] = useState(false);
  const [rollbackVersi, setRollbackVersi] = useState<number | null>(null);
  const [alasanRollback, setAlasanRollback] = useState('');
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [aksiErr, setAksiErr] = useState('');

  const hydrate = useCallback((d: LlmState) => {
    const src = d.draf ?? d.aktif;
    setState(d);
    setEntries(src ? src.entries.map((e) => ({ ...e })) : []);
    setDraftVersi(d.draf?.versi ?? null);
    setHasilUji(d.draf?.hasil_uji ?? {});
    setDirty(false);
    setFieldErr({});
    setPresetId((p) => p || d.preset?.[0]?.id || '');
  }, []);

  const muat = useCallback(async () => {
    try {
      const r = await call(API);
      if (r.status === 401 || r.status === 403) { setLoad('forbidden'); return; }
      if (!r.ok || !r.data) { setLoad('error'); return; }
      hydrate(r.data as LlmState);
      setLoad('ready');
    } catch {
      setLoad('error');
    }
  }, [hydrate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    muat();
  }, [muat]);

  const enkripsiSiap = state?.enkripsi_siap ?? false;
  const tampilEnk = !!encPesan || (state !== null && !enkripsiSiap);

  const edit = (id: string, patch: Partial<LlmEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setDirty(true);
  };
  const pindah = (i: number, dir: -1 | 1) => {
    setEntries((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  };
  const hapus = (id: string) => { setEntries((prev) => prev.filter((e) => e.id !== id)); setDirty(true); };

  const tambah = () => {
    const pr = state?.preset.find((x) => x.id === presetId);
    if (!pr) return;
    let label = pr.label.slice(0, 55);
    for (let n = 2; entries.some((e) => e.label === label); n++) label = `${pr.label.slice(0, 50)} ${n}`;
    setEntries((prev) => [...prev, {
      id: crypto.randomUUID(), label, tipe: pr.tipe, base_url: pr.tipe === 'gemini' ? '' : pr.base_url,
      model: pr.model_contoh, rahasia_id: null, aktif: true, kuota_harian: null,
    }]);
    setDirty(true);
  };

  const simpanKunci = async (e: LlmEntry, kunci: string): Promise<string | null> => {
    try {
      const r = await post(`${API}/rahasia`, { nama: e.label, kunci });
      if (r.status === 503) { setEncPesan(r.data?.error || ENC_HINT); return r.data?.error || 'Penyimpanan kunci belum diaktifkan di server.'; }
      if (r.status === 429) return 'Terlalu sering menyimpan kunci (batas 30 per jam).';
      if (!r.ok) return r.data?.error || 'Gagal menyimpan kunci.';
      edit(e.id, { rahasia_id: r.data.rahasia_id, punya_kunci: true, kunci_tersamar: r.data.kunci_tersamar });
      toast('Kunci tersimpan. Klik Simpan draf untuk memakainya.', 'success');
      return null;
    } catch {
      return 'Tidak dapat menghubungi server.';
    }
  };

  // Menyimpan draf; mengembalikan nomor versi draf atau null bila gagal.
  const simpanDraf = async (): Promise<number | null> => {
    const salah: Record<string, string> = {};
    for (const e of entries) {
      if (!e.label.trim()) salah[e.id] = 'Nama penyedia wajib diisi.';
      else if (!e.model.trim()) salah[e.id] = 'Model wajib diisi.';
      else if (e.tipe === 'openai_compat' && !/^https:\/\//i.test(e.base_url.trim())) salah[e.id] = 'Base URL wajib diawali https://';
    }
    setFieldErr(salah);
    if (Object.keys(salah).length > 0) { toast('Periksa isian yang ditandai.', 'error'); return null; }
    setSaving(true);
    try {
      const body = entries.map((e) => ({
        id: e.id, label: e.label.trim(), tipe: e.tipe,
        ...(e.tipe === 'openai_compat' ? { base_url: e.base_url.trim() } : {}),
        model: e.model.trim(), rahasia_id: e.rahasia_id, aktif: e.aktif, kuota_harian: e.kuota_harian,
        ...(e.suhu !== undefined ? { suhu: e.suhu } : {}),
        ...(e.batas_waktu_ms !== undefined ? { batas_waktu_ms: e.batas_waktu_ms } : {}),
      }));
      const r = await call(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: body }) });
      if (!r.ok) {
        const det = Array.isArray(r.data?.details) ? (r.data.details as Array<{ id?: string; error?: string }>) : [];
        const m: Record<string, string> = {};
        for (const d of det) if (d.id && d.error) m[d.id] = d.error;
        setFieldErr(m);
        toast(r.data?.error || 'Gagal menyimpan draf.', 'error');
        return null;
      }
      const versi = r.data.versi as number;
      setDraftVersi(versi);
      setDirty(false);
      setUjiDetail({});
      // Muat ulang hasil uji yang dipertahankan server (hanya entri tak berubah).
      const fresh = await call(API);
      if (fresh.ok && fresh.data) {
        const d = fresh.data as LlmState;
        setState(d);
        setHasilUji(d.draf?.hasil_uji ?? {});
      }
      toast(`Draf v${versi} tersimpan.`, 'success');
      return versi;
    } catch {
      toast('Tidak dapat menghubungi server.', 'error');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const uji = async (e: LlmEntry) => {
    if (ujiBusy) return;
    setUjiBusy(e.id);
    try {
      if (dirty || draftVersi === null) {
        if ((await simpanDraf()) === null) return;
      }
      const r = await post(`${API}/test`, { entry_id: e.id, sumber: 'draf' });
      if (!r.ok || !r.data) {
        const pesan = r.status === 429 ? 'Terlalu sering menguji (batas 20 per jam).'
          : r.status === 409 ? 'Kunci tidak dapat dibaca; isi ulang API key lalu simpan draf.'
          : r.data?.error || 'Uji gagal dijalankan.';
        setUjiDetail((p) => ({ ...p, [e.id]: { ok: false, http_status: null, latensi_ms: null, cuplikan: null, error: pesan, curl: '' } }));
        return;
      }
      const d = r.data as UjiDetail;
      setUjiDetail((p) => ({ ...p, [e.id]: d }));
      setHasilUji((p) => ({ ...p, [e.id]: { ok: d.ok, http_status: d.http_status, latensi_ms: d.latensi_ms, at: new Date().toISOString() } }));
    } catch {
      setUjiDetail((p) => ({ ...p, [e.id]: { ok: false, http_status: null, latensi_ms: null, cuplikan: null, error: 'Tidak dapat menghubungi server.', curl: '' } }));
    } finally {
      setUjiBusy(null);
    }
  };

  const salin = async (teks: string) => {
    try { await navigator.clipboard.writeText(teks); toast('Perintah curl disalin.', 'success'); }
    catch { toast('Gagal menyalin; blok teks secara manual.', 'error'); }
  };

  const aktifEntries = entries.filter((e) => e.aktif);
  const semuaLulus = aktifEntries.length > 0 && aktifEntries.every((e) => hasilUji[e.id]?.ok);
  const bisaAktifkan = draftVersi !== null && !dirty && aktifEntries.length > 0;
  const alasanOk = alasanAktif.trim().length >= 5;
  const tombolAktifOk = bisaAktifkan && !aktifBusy && (semuaLulus || (tanpaUji && alasanOk));

  const aktifkan = async () => {
    if (!tombolAktifOk || draftVersi === null) return;
    setAktifBusy(true); setAksiErr('');
    try {
      const r = await post(`${API}/versi`, {
        aksi: 'aktifkan', versi: draftVersi,
        ...(semuaLulus ? {} : { tanpa_uji: true, alasan: alasanAktif.trim() }),
        ...(semuaLulus && alasanOk ? { alasan: alasanAktif.trim() } : {}),
      });
      if (!r.ok) {
        setAksiErr(r.data?.kode === 'BELUM_DIUJI' ? 'Masih ada penyedia aktif yang belum lulus uji.' : r.data?.error || 'Gagal mengaktifkan.');
        return;
      }
      toast(`Versi ${r.data.versi_aktif ?? draftVersi} diaktifkan. Berlaku paling lambat sekitar 1 menit.`, 'success');
      setTanpaUji(false); setAlasanAktif('');
      await muat();
    } catch {
      setAksiErr('Tidak dapat menghubungi server.');
    } finally {
      setAktifBusy(false);
    }
  };

  const rollback = async () => {
    if (rollbackVersi === null || alasanRollback.trim().length < 5 || rollbackBusy) return;
    setRollbackBusy(true); setAksiErr('');
    try {
      const r = await post(`${API}/versi`, { aksi: 'rollback', versi: rollbackVersi, alasan: alasanRollback.trim() });
      if (!r.ok) { setAksiErr(r.data?.error || 'Gagal rollback.'); return; }
      toast(`Rollback ke v${rollbackVersi} berhasil (versi baru v${r.data.versi_aktif ?? '?'}).`, 'success');
      setRollbackVersi(null); setAlasanRollback('');
      await muat();
    } catch {
      setAksiErr('Tidak dapat menghubungi server.');
    } finally {
      setRollbackBusy(false);
    }
  };

  const statusAktif = state?.aktif ? `AKTIF v${state.aktif.versi}` : 'Memakai pengaturan environment lama';

  return (
    <>
      <PageHeader
        title="Pengaturan AI"
        description="Atur penyedia model chat (Gemini, gateway, API kustom), uji, lalu aktifkan. Hanya Admin."
      />
      <div className={styles.page}>
        {load === 'loading' && <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }} role="status" aria-label="Memuat pengaturan"><div className="spinner" /></div>}

        {load === 'forbidden' && (
          <div className={`${bs.banner} ${bs.bannerErr}`} role="alert">Halaman ini hanya untuk Admin.</div>
        )}

        {load === 'error' && (
          <div className={`${bs.banner} ${bs.bannerErr}`} role="alert">
            Gagal memuat pengaturan AI.{' '}
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setLoad('loading'); muat(); }}>Coba lagi</button>
          </div>
        )}

        {load === 'ready' && state && (
          <>
            {tampilEnk && (
              <div className={`${bs.banner} ${bs.bannerWarn}`} role="alert" data-testid="peringatan-enkripsi">
                <AlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                <span>{ENC_HINT}</span>
              </div>
            )}
            <div className={bs.banner} role="note">
              <Info size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span>
                Embedding FAQ dan Dokumen Peraturan tetap memakai GEMINI_API_KEY di server; mengganti model chat di sini tidak mengubah embedding.
                Base URL kustom hanya boleh https. Perubahan yang diaktifkan berlaku paling lambat sekitar 1 menit.
              </span>
            </div>

            <div className={bs.cardHead}>
              <h2 className={bs.cardTitle}>Rantai penyedia chat (urutan = prioritas)</h2>
              <span className={`badge ${state.aktif ? 'badge--selesai' : 'badge--draft'}`}>
                {statusAktif}{draftVersi !== null ? ` · Draf v${draftVersi}${dirty ? ' (ada perubahan belum disimpan)' : ''}` : dirty ? ' · belum disimpan' : ''}
              </span>
            </div>

            {entries.length === 0 ? (
              <div className={bs.card}>
                <div className={bs.empty}>
                  <p>Belum ada penyedia dalam draf.</p>
                  {state.sumber_aktif === 'env' && state.env_cadangan && (
                    <p className={bs.hint}>
                      Saat ini bot memakai environment: {state.env_cadangan.gemini_sdk ? 'Gemini' : ''}
                      {state.env_cadangan.penyedia.length > 0 ? ` ${state.env_cadangan.penyedia.map((p) => `${p.nama}/${p.model}`).join(', ')}` : ''}.
                      Tambahkan penyedia di bawah untuk mengatur dari layar.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <ol className={bs.list} aria-label="Daftar penyedia" style={{ padding: 0 }}>
                {entries.map((e, i) => (
                  <LlmEntryCard
                    key={e.id}
                    entry={e} index={i} total={entries.length}
                    hasilUji={hasilUji[e.id]} uji={ujiDetail[e.id]} ujiBusy={ujiBusy === e.id}
                    enkripsiSiap={enkripsiSiap && !encPesan} error={fieldErr[e.id]}
                    onChange={(patch) => edit(e.id, patch)}
                    onMove={(dir) => pindah(i, dir)}
                    onRemove={() => hapus(e.id)}
                    onSaveKey={(k) => simpanKunci(e, k)}
                    onUji={() => uji(e)}
                    onSalin={salin}
                  />
                ))}
              </ol>
            )}

            <div className={bs.row} style={{ marginBottom: 'var(--space-6)' }}>
              <label className="form-label" htmlFor="presetBaru" style={{ margin: 0 }}>Tambah penyedia</label>
              <select id="presetBaru" className="form-select" style={{ maxWidth: 320 }} value={presetId} onChange={(ev) => setPresetId(ev.target.value)}>
                {state.preset.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <button type="button" className="btn btn--secondary btn--sm" onClick={tambah} disabled={!presetId}><Plus size={14} /> Tambah</button>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => { void simpanDraf(); }} disabled={saving || entries.length === 0 || (!dirty && draftVersi !== null)} aria-busy={saving}>
                {saving ? <Loader2 size={14} className="animate-pulse" /> : <Save size={14} />} Simpan draf
              </button>
            </div>

            <section className={bs.card} aria-labelledby="aktifkan-judul">
              <h2 id="aktifkan-judul" className={bs.cardTitle}><Rocket size={16} aria-hidden="true" /> Aktifkan draf</h2>
              {!bisaAktifkan ? (
                <p className={bs.hint}>
                  {entries.length === 0 || aktifEntries.length === 0
                    ? 'Tambahkan minimal satu penyedia aktif.'
                    : 'Simpan draf terlebih dahulu sebelum menguji dan mengaktifkan.'}
                </p>
              ) : semuaLulus ? (
                <p className={bs.hint}>Semua penyedia aktif lulus uji. Siap diaktifkan (v{draftVersi}).</p>
              ) : (
                <div>
                  <p className={bs.hint}>Uji tiap penyedia aktif sampai lulus, atau aktifkan tanpa uji dengan alasan tercatat.</p>
                  <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', cursor: 'pointer', margin: 'var(--space-2) 0' }}>
                    <input type="checkbox" checked={tanpaUji} onChange={(ev) => setTanpaUji(ev.target.checked)} />
                    Aktifkan tanpa uji (berisiko)
                  </label>
                  {tanpaUji && (
                    <div className="form-group">
                      <label className="form-label" htmlFor="alasanAktif">Alasan (minimal 5 karakter)</label>
                      <textarea id="alasanAktif" className="form-textarea" rows={2} value={alasanAktif} onChange={(ev) => setAlasanAktif(ev.target.value)} />
                    </div>
                  )}
                </div>
              )}
              <div className={bs.row} style={{ marginTop: 'var(--space-3)' }}>
                <button type="button" className="btn btn--accent btn--sm" onClick={aktifkan} disabled={!tombolAktifOk} aria-busy={aktifBusy}>
                  {aktifBusy ? <Loader2 size={14} className="animate-pulse" /> : <Rocket size={14} />} Aktifkan{draftVersi !== null ? ` v${draftVersi}` : ''}
                </button>
              </div>
              {aksiErr && <p className={bs.errText} role="alert">{aksiErr}</p>}
            </section>

            <section className={bs.card} aria-labelledby="riwayat-judul">
              <h2 id="riwayat-judul" className={bs.cardTitle}><History size={16} aria-hidden="true" /> Riwayat versi</h2>
              {state.riwayat.length === 0 ? (
                <p className={bs.hint}>Belum ada riwayat versi.</p>
              ) : (
                <ul className={bs.list}>
                  {state.riwayat.map((v) => (
                    <li key={v.versi} className={bs.listItem}>
                      <span>
                        <strong>v{v.versi}</strong> · {v.status.toUpperCase()} · {fmt(v.diaktifkan_at ?? v.dibuat_at)}
                        {v.alasan ? <span className={bs.hint}> — {v.alasan}</span> : null}
                      </span>
                      {v.status === 'arsip' && (
                        <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setRollbackVersi(v.versi); setAlasanRollback(''); }}>
                          <RotateCcw size={14} /> Rollback ke v{v.versi}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {rollbackVersi !== null && (
                <div className={`${bs.banner} ${bs.bannerWarn}`} role="group" aria-label="Konfirmasi rollback" style={{ marginTop: 'var(--space-3)', flexDirection: 'column' }}>
                  <strong>Kembalikan ke v{rollbackVersi}? Versi ini akan disalin menjadi versi baru yang langsung aktif.</strong>
                  <label className="form-label" htmlFor="alasanRollback">Alasan rollback (minimal 5 karakter)</label>
                  <textarea id="alasanRollback" className="form-textarea" rows={2} value={alasanRollback} onChange={(ev) => setAlasanRollback(ev.target.value)} />
                  <div className={bs.row}>
                    <button type="button" className="btn btn--danger btn--sm" onClick={rollback} disabled={alasanRollback.trim().length < 5 || rollbackBusy} aria-busy={rollbackBusy}>
                      Ya, rollback
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRollbackVersi(null)}>Batal</button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
