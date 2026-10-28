'use client';

// Editor Pendataan Khusus per Layanan (Admin, Fase 4 spec §7). Isian yang pernah diisi: label/urutan/wajib/opsi boleh
// diubah, tidak bisa dihapus (Sembunyikan), jenis tidak pernah dapat diubah. DB adalah penegak akhir (trigger).
import { useCallback, useEffect, useId, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import FormDialog from '@/components/admin/FormDialog';
import { AdminFetchError, adminFetch } from '@/components/admin/adminFetch';
import { BATAS_KHUSUS, JENIS_KHUSUS, LABEL_JENIS, jenisButuhOpsi, type FieldKhusus, type JenisKhusus } from '@/lib/pendataan-khusus/jenis';
import styles from './KelolaLayanan.module.css';

interface Props {
  layananId: string;
}

type Dialog = { jenis: 'baru' } | { jenis: 'ubah'; isian: FieldKhusus } | { jenis: 'hapus'; isian: FieldKhusus };

export default function PendataanKhususEditor({ layananId }: Props) {
  const { toast } = useToast();
  const dasar = `/api/admin/layanan/${layananId}/pendataan-khusus`;
  const [isian, setIsian] = useState<FieldKhusus[]>([]);
  const [formTetap, setFormTetap] = useState(false);
  const [memuat, setMemuat] = useState(true);
  const [galatMuat, setGalatMuat] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [galatDialog, setGalatDialog] = useState<string | null>(null);
  const [mengirim, setMengirim] = useState(false);
  // Isian dialog tambah/ubah.
  const [label, setLabel] = useState('');
  const [jenis, setJenis] = useState<JenisKhusus>('teks_singkat');
  const [wajib, setWajib] = useState(false);
  const [opsiTeks, setOpsiTeks] = useState('');
  const idDasar = useId();

  const muat = useCallback(async () => {
    try {
      const j = await adminFetch<{ form_tetap: boolean; isian: FieldKhusus[] }>(dasar);
      setIsian(j.isian ?? []);
      setFormTetap(j.form_tetap === true);
      setGalatMuat('');
    } catch (e) {
      setGalatMuat(e instanceof Error ? e.message : 'Gagal memuat Pendataan Khusus');
    } finally {
      setMemuat(false);
    }
  }, [dasar]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    muat();
  }, [muat]);

  const tutup = () => { setDialog(null); setGalatDialog(null); };
  const bukaBaru = () => {
    setLabel(''); setJenis('teks_singkat'); setWajib(false); setOpsiTeks(''); setGalatDialog(null);
    setDialog({ jenis: 'baru' });
  };
  const bukaUbah = (f: FieldKhusus) => {
    setLabel(f.label); setJenis(f.jenis); setWajib(f.wajib); setOpsiTeks(f.opsi.join('\n')); setGalatDialog(null);
    setDialog({ jenis: 'ubah', isian: f });
  };

  const opsiDariTeks = () => opsiTeks.split('\n').map((s) => s.trim()).filter(Boolean);

  const jalankan = async (fn: () => Promise<unknown>, pesanSukses: string) => {
    setMengirim(true);
    setGalatDialog(null);
    try {
      await fn();
      toast(pesanSukses, 'success');
      tutup();
      await muat();
    } catch (e) {
      const pesan = e instanceof AdminFetchError || e instanceof Error ? e.message : 'Gagal menyimpan';
      setGalatDialog(pesan);
    } finally {
      setMengirim(false);
    }
  };

  const simpan = async () => {
    if (!dialog || dialog.jenis === 'hapus') return;
    const opsi = jenisButuhOpsi(jenis) ? opsiDariTeks() : [];
    if (dialog.jenis === 'baru') {
      await jalankan(() => adminFetch(dasar, 'POST', { label, jenis, wajib, opsi }), 'Isian ditambahkan.');
    } else {
      const f = dialog.isian;
      const badan: Record<string, unknown> = {};
      if (label.trim() !== f.label) badan.label = label;
      if (wajib !== f.wajib) badan.wajib = wajib;
      if (jenisButuhOpsi(f.jenis) && JSON.stringify(opsi) !== JSON.stringify(f.opsi)) badan.opsi = opsi;
      if (Object.keys(badan).length === 0) { tutup(); return; }
      await jalankan(() => adminFetch(`${dasar}/${f.id}`, 'PATCH', badan), 'Isian diperbarui.');
    }
  };

  const ubahTersembunyi = async (f: FieldKhusus) => {
    try {
      await adminFetch(`${dasar}/${f.id}`, 'PATCH', { tersembunyi: !f.tersembunyi });
      toast(f.tersembunyi ? 'Isian ditampilkan lagi.' : 'Isian disembunyikan dari formulir baru.', 'success');
      await muat();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengubah isian', 'error');
    }
  };

  const geser = async (indeks: number, arah: -1 | 1) => {
    const baru = [...isian];
    const tujuan = indeks + arah;
    if (tujuan < 0 || tujuan >= baru.length) return;
    [baru[indeks], baru[tujuan]] = [baru[tujuan], baru[indeks]];
    try {
      await adminFetch(dasar, 'PUT', { urutan: baru.map((f) => f.id) });
      await muat();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengubah urutan', 'error');
    }
  };

  if (memuat) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="status" aria-label="Memuat">
        <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} />
      </div>
    );
  }
  if (galatMuat) {
    return <div role="alert" className="form-error" style={{ padding: 'var(--space-6)' }}>{galatMuat}</div>;
  }
  if (formTetap) {
    return (
      <p role="note" style={{ padding: 'var(--space-4)' }}>
        Layanan ini memakai formulir tetap (OSS / Non OSS), jadi Pendataan Khusus tidak berlaku. Isian formulir tetap
        hanya dapat diubah lewat perubahan sistem.
      </p>
    );
  }

  const idLabel = `${idDasar}-label`;
  const idJenis = `${idDasar}-jenis`;
  const idOpsi = `${idDasar}-opsi`;
  const idWajib = `${idDasar}-wajib`;
  const sedangUbah = dialog?.jenis === 'ubah' ? dialog.isian : null;

  return (
    <>
      <p className={styles.sectionHint}>
        Isian tambahan yang ditanyakan petugas saat menyelesaikan pelayanan Layanan ini (tiket maupun live chat).
        Identitas pengunjung (nama, nomor HP, email, asal instansi, kategori, keperluan), topik, dan catatan sudah dicatat
        sebagai Pendataan Umum, jadi jangan menanyakannya lagi di sini. Tidak ada unggah berkas.
      </p>
      <div className={styles.toolbar}>
        <button type="button" className="btn btn--primary" onClick={bukaBaru} disabled={isian.length >= BATAS_KHUSUS.isianPerLayanan}>
          <Plus size={16} aria-hidden="true" /> Tambah isian
        </button>
      </div>
      {isian.length === 0 ? (
        <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          Belum ada isian. Petugas hanya mengisi topik dan catatan.
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <caption className={styles.srOnly}>Daftar isian Pendataan Khusus</caption>
            <thead>
              <tr><th scope="col">Urutan</th><th scope="col">Label</th><th scope="col">Jenis</th><th scope="col">Wajib</th><th scope="col">Status</th><th scope="col">Aksi</th></tr>
            </thead>
            <tbody>
              {isian.map((f, i) => (
                <tr key={f.id} className={f.tersembunyi ? styles.mutedRow : undefined}>
                  <td>
                    <div className={styles.rowActions}>
                      <button type="button" className="btn btn--ghost btn--sm" aria-label={`Naik ${f.label}`} disabled={i === 0} onClick={() => geser(i, -1)}>
                        <ArrowUp size={14} aria-hidden="true" />
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" aria-label={`Turun ${f.label}`} disabled={i === isian.length - 1} onClick={() => geser(i, 1)}>
                        <ArrowDown size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{f.label}</td>
                  <td>{LABEL_JENIS[f.jenis]}{jenisButuhOpsi(f.jenis) ? ` (${f.opsi.length} pilihan)` : ''}</td>
                  <td>{f.wajib ? 'Ya' : 'Tidak'}</td>
                  <td>{[f.tersembunyi ? 'Disembunyikan' : 'Tampil', f.pernah_diisi ? 'Sudah dipakai' : null].filter(Boolean).join(' · ')}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button type="button" className="btn btn--secondary btn--sm" aria-label={`Ubah ${f.label}`} onClick={() => bukaUbah(f)}>
                        <Pencil size={14} aria-hidden="true" /> Ubah
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" aria-label={`${f.tersembunyi ? 'Tampilkan' : 'Sembunyikan'} ${f.label}`} onClick={() => ubahTersembunyi(f)}>
                        {f.tersembunyi ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                        {f.tersembunyi ? ' Tampilkan' : ' Sembunyikan'}
                      </button>
                      {!f.pernah_diisi && (
                        <button type="button" className="btn btn--ghost btn--sm" aria-label={`Hapus ${f.label}`} onClick={() => { setGalatDialog(null); setDialog({ jenis: 'hapus', isian: f }); }}>
                          <Trash2 size={14} aria-hidden="true" /> Hapus
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && dialog.jenis !== 'hapus' && (
        <FormDialog
          judul={dialog.jenis === 'baru' ? 'Tambah isian' : `Ubah isian: ${dialog.isian.label}`}
          labelKirim="Simpan"
          mengirim={mengirim}
          galat={galatDialog}
          onClose={tutup}
          onSubmit={simpan}
        >
          {() => (
            <>
              <div className="form-group">
                <label htmlFor={idLabel} className="form-label form-label--required">Label isian</label>
                <input id={idLabel} className="form-input" value={label} maxLength={BATAS_KHUSUS.labelMaks} required aria-required="true"
                  disabled={mengirim} onChange={(e) => setLabel(e.target.value)} data-autofocus="" />
              </div>
              <div className="form-group">
                <label htmlFor={idJenis} className="form-label form-label--required">Jenis isian</label>
                <select id={idJenis} className="form-select" value={jenis} disabled={mengirim || sedangUbah !== null}
                  aria-describedby={sedangUbah ? `${idJenis}-bantuan` : undefined}
                  onChange={(e) => setJenis(e.target.value as JenisKhusus)}>
                  {JENIS_KHUSUS.map((j) => <option key={j} value={j}>{LABEL_JENIS[j]}</option>)}
                </select>
                {sedangUbah && (
                  <small id={`${idJenis}-bantuan`} style={{ color: 'var(--text-tertiary)' }}>
                    Jenis tidak dapat diubah setelah isian dibuat{sedangUbah.pernah_diisi ? '; isian ini pernah diisi sehingga hanya bisa disembunyikan' : '. Hapus lalu buat ulang bila belum pernah diisi'}.
                  </small>
                )}
              </div>
              {jenisButuhOpsi(jenis) && (
                <div className="form-group">
                  <label htmlFor={idOpsi} className="form-label form-label--required">Pilihan (satu per baris)</label>
                  <textarea id={idOpsi} className="form-textarea" rows={5} value={opsiTeks} disabled={mengirim}
                    aria-describedby={`${idOpsi}-bantuan`} onChange={(e) => setOpsiTeks(e.target.value)} />
                  <small id={`${idOpsi}-bantuan`} style={{ color: 'var(--text-tertiary)' }}>
                    {BATAS_KHUSUS.opsiMin}-{BATAS_KHUSUS.opsiMaks} pilihan, maksimal {BATAS_KHUSUS.opsiPanjang} karakter per pilihan. Jawaban lama tetap tersimpan apa adanya.
                  </small>
                </div>
              )}
              <label htmlFor={idWajib} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <input id={idWajib} type="checkbox" checked={wajib} disabled={mengirim} onChange={(e) => setWajib(e.target.checked)} />
                Wajib diisi
              </label>
            </>
          )}
        </FormDialog>
      )}

      {dialog?.jenis === 'hapus' && (
        <FormDialog
          judul={`Hapus isian ${dialog.isian.label}?`}
          deskripsi="Isian ini belum pernah diisi, jadi dapat dihapus. Isian yang sudah pernah diisi hanya bisa disembunyikan."
          labelKirim="Ya, hapus"
          mengirim={mengirim}
          galat={galatDialog}
          onClose={tutup}
          onSubmit={() => jalankan(() => adminFetch(`${dasar}/${dialog.isian.id}`, 'DELETE'), 'Isian dihapus.')}
          maxWidth={460}
        >
          {() => null}
        </FormDialog>
      )}
    </>
  );
}
