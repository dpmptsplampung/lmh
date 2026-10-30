'use client';

// Editor Pendataan Khusus per Layanan (Admin, Fase 4 spec §7). Isian yang pernah diisi: label/urutan/wajib/opsi boleh
// diubah, tidak bisa dihapus (Sembunyikan), jenis tidak pernah dapat diubah. DB adalah penegak akhir (trigger).
// Penyuntingan langsung di tabel (docs/superpowers/plans/2026-10-30-tabel-dan-edit-inline.md): label diklik lalu diketik, Wajib = saklar di baris,
// isian baru lewat baris terakhir, jenis dan pilihan lewat baris rincian yang mengembang. Hanya konfirmasi hapus yang dialog.
import { Fragment, useCallback, useEffect, useId, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Eye, EyeOff, Loader2, Trash2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import FormDialog from '@/components/admin/FormDialog';
import { BarisTambah, SelTeksInline } from '@/components/admin/SuntingInline';
import { AdminFetchError, adminFetch } from '@/components/admin/adminFetch';
import { BATAS_KHUSUS, JENIS_KHUSUS, LABEL_JENIS, jenisButuhOpsi, type FieldKhusus, type JenisKhusus } from '@/lib/pendataan-khusus/jenis';
import styles from './KelolaLayanan.module.css';

interface Props {
  layananId: string;
}

const KOLOM = 6;
const pesanGalat = (e: unknown, cadangan: string) => (e instanceof AdminFetchError || e instanceof Error ? e.message : cadangan);
const barisOpsi = (teks: string) => teks.split('\n').map((s) => s.trim()).filter(Boolean);

export default function PendataanKhususEditor({ layananId }: Props) {
  const { toast } = useToast();
  const dasar = `/api/admin/layanan/${layananId}/pendataan-khusus`;
  const [isian, setIsian] = useState<FieldKhusus[]>([]);
  const [formTetap, setFormTetap] = useState(false);
  const [memuat, setMemuat] = useState(true);
  const [galatMuat, setGalatMuat] = useState('');
  const [hapus, setHapus] = useState<FieldKhusus | null>(null);
  const [galatHapus, setGalatHapus] = useState<string | null>(null);
  const [menghapus, setMenghapus] = useState(false);
  const [terbuka, setTerbuka] = useState<ReadonlySet<string>>(new Set());
  const [drafOpsi, setDrafOpsi] = useState<Record<string, string>>({});
  const [galatOpsi, setGalatOpsi] = useState<Record<string, string | null>>({});
  const [sibuk, setSibuk] = useState<ReadonlySet<string>>(new Set());
  const [pengumuman, setPengumuman] = useState('');
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

  const tandaiSibuk = (id: string, nyala: boolean) =>
    setSibuk((s) => {
      const n = new Set(s);
      if (nyala) n.add(id);
      else n.delete(id);
      return n;
    });

  /** PATCH satu isian lalu muat ulang; kembalikan pesan galat atau null. */
  const ubah = async (f: FieldKhusus, badan: Record<string, unknown>): Promise<string | null> => {
    try {
      await adminFetch(`${dasar}/${f.id}`, 'PATCH', badan);
      await muat();
      return null;
    } catch (e) {
      return pesanGalat(e, 'Gagal menyimpan');
    }
  };

  const ubahLabel = async (f: FieldKhusus, baru: string) => {
    const g = await ubah(f, { label: baru });
    if (!g) toast('Isian diperbarui.', 'success');
    return g;
  };

  const ubahWajib = async (f: FieldKhusus) => {
    if (sibuk.has(f.id)) return;
    tandaiSibuk(f.id, true);
    const g = await ubah(f, { wajib: !f.wajib });
    tandaiSibuk(f.id, false);
    if (g) toast(g, 'error');
    else setPengumuman(`${f.label}: ${f.wajib ? 'tidak wajib' : 'wajib'} diisi.`);
  };

  const ubahTersembunyi = async (f: FieldKhusus) => {
    const g = await ubah(f, { tersembunyi: !f.tersembunyi });
    if (g) toast(g, 'error');
    else toast(f.tersembunyi ? 'Isian ditampilkan lagi.' : 'Isian disembunyikan dari formulir baru.', 'success');
  };

  const bukaTutup = (f: FieldKhusus) => {
    const buka = !terbuka.has(f.id);
    setTerbuka((s) => {
      const n = new Set(s);
      if (buka) n.add(f.id);
      else n.delete(f.id);
      return n;
    });
    if (buka) {
      setDrafOpsi((d) => ({ ...d, [f.id]: f.opsi.join('\n') }));
      setGalatOpsi((g) => ({ ...g, [f.id]: null }));
    }
  };

  const simpanOpsi = async (f: FieldKhusus) => {
    const opsi = barisOpsi(drafOpsi[f.id] ?? '');
    if (JSON.stringify(opsi) === JSON.stringify(f.opsi)) {
      setGalatOpsi((g) => ({ ...g, [f.id]: null }));
      return;
    }
    tandaiSibuk(f.id, true);
    const g = await ubah(f, { opsi });
    tandaiSibuk(f.id, false);
    setGalatOpsi((x) => ({ ...x, [f.id]: g }));
    if (!g) {
      setPengumuman(`Pilihan ${f.label} disimpan.`);
      toast('Isian diperbarui.', 'success');
    }
  };

  const tambah = async (nilai: Record<string, string>): Promise<string | null> => {
    const label = (nilai.label ?? '').trim();
    if (label.length < BATAS_KHUSUS.labelMin || label.length > BATAS_KHUSUS.labelMaks) {
      return `Label isian harus ${BATAS_KHUSUS.labelMin}-${BATAS_KHUSUS.labelMaks} karakter.`;
    }
    const jenis = (nilai.jenis ?? 'teks_singkat') as JenisKhusus;
    const opsi = jenisButuhOpsi(jenis) ? barisOpsi(nilai.opsi ?? '') : [];
    try {
      await adminFetch(dasar, 'POST', { label, jenis, wajib: nilai.wajib === 'true', opsi });
      toast('Isian ditambahkan.', 'success');
      await muat();
      return null;
    } catch (e) {
      return pesanGalat(e, 'Gagal menyimpan');
    }
  };

  const geser = async (indeks: number, arah: -1 | 1) => {
    const baru = [...isian];
    const tujuan = indeks + arah;
    if (tujuan < 0 || tujuan >= baru.length) return;
    const nama = baru[indeks].label;
    [baru[indeks], baru[tujuan]] = [baru[tujuan], baru[indeks]];
    try {
      await adminFetch(dasar, 'PUT', { urutan: baru.map((f) => f.id) });
      await muat();
      setPengumuman(`${nama} dipindah ke posisi ${tujuan + 1} dari ${baru.length}.`);
    } catch (e) {
      toast(pesanGalat(e, 'Gagal mengubah urutan'), 'error');
    }
  };

  const jalankanHapus = async () => {
    if (!hapus) return;
    setMenghapus(true);
    setGalatHapus(null);
    try {
      await adminFetch(`${dasar}/${hapus.id}`, 'DELETE');
      toast('Isian dihapus.', 'success');
      setHapus(null);
      await muat();
    } catch (e) {
      setGalatHapus(pesanGalat(e, 'Gagal menghapus'));
    } finally {
      setMenghapus(false);
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

  return (
    <>
      <p className={styles.sectionHint}>
        Isian tambahan yang ditanyakan petugas saat menyelesaikan pelayanan Layanan ini (tiket maupun live chat).
        Identitas pengunjung (nama, nomor HP, email, asal instansi, kategori, keperluan), topik, dan catatan sudah dicatat
        sebagai Pendataan Umum, jadi jangan menanyakannya lagi di sini. Tidak ada unggah berkas.
      </p>
      <div className="table-wrapper">
        <table className="table">
          <caption className="sr-only">Daftar isian Pendataan Khusus</caption>
          <thead>
            <tr>
              <th scope="col">Isian</th><th scope="col">Jenis</th><th scope="col">Wajib</th>
              <th scope="col">Urutan</th><th scope="col">Status</th><th scope="col">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {isian.length === 0 && (
              <tr>
                <td colSpan={KOLOM} className="kosong-sel">
                  Belum ada isian. Petugas hanya mengisi topik dan catatan.
                </td>
              </tr>
            )}
            {isian.map((f, i) => {
              const sedang = sibuk.has(f.id);
              const buka = terbuka.has(f.id);
              const idRincian = `${idDasar}-rincian-${f.id}`;
              return (
                <Fragment key={f.id}>
                  <tr className={f.tersembunyi ? styles.mutedRow : undefined}>
                    <td className={`kol-utama ${styles.kolLabel}`}>
                      <SelTeksInline
                        nilai={f.label}
                        label={`label isian ${f.label}`}
                        maxLength={BATAS_KHUSUS.labelMaks}
                        validasi={(baru) =>
                          baru.length < BATAS_KHUSUS.labelMin ? `Label isian harus ${BATAS_KHUSUS.labelMin}-${BATAS_KHUSUS.labelMaks} karakter.` : null}
                        onSimpan={(baru) => ubahLabel(f, baru)}
                      />
                    </td>
                    <td>{LABEL_JENIS[f.jenis]}{jenisButuhOpsi(f.jenis) ? ` (${f.opsi.length} pilihan)` : ''}</td>
                    <td>
                      <label className={styles.saklarBaris}>
                        <input
                          type="checkbox"
                          role="switch"
                          className="saklar"
                          aria-label={`Wajib: ${f.label}`}
                          checked={f.wajib}
                          disabled={sedang}
                          aria-busy={sedang || undefined}
                          onChange={() => void ubahWajib(f)}
                        />
                        <span>{f.wajib ? 'Ya' : 'Tidak'}</span>
                      </label>
                    </td>
                    <td>
                      <div className={styles.geser}>
                        <button type="button" className="btn btn--ghost btn--sm" aria-label={`Naik ${f.label}`} disabled={i === 0} onClick={() => void geser(i, -1)}>
                          <ArrowUp size={14} aria-hidden="true" />
                        </button>
                        <button type="button" className="btn btn--ghost btn--sm" aria-label={`Turun ${f.label}`} disabled={i === isian.length - 1} onClick={() => void geser(i, 1)}>
                          <ArrowDown size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                    <td>
                      {f.tersembunyi ? 'Disembunyikan' : 'Tampil'}
                      {f.pernah_diisi && <span className="sub">Sudah dipakai</span>}
                    </td>
                    <td className="kol-aksi">
                      <div className="aksi-baris">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          aria-label={`Rincian ${f.label}`}
                          aria-expanded={buka}
                          aria-controls={buka ? idRincian : undefined}
                          onClick={() => bukaTutup(f)}
                        >
                          {buka ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />} Rincian
                        </button>
                        <button type="button" className="btn btn--ghost btn--sm" aria-label={`${f.tersembunyi ? 'Tampilkan' : 'Sembunyikan'} ${f.label}`} onClick={() => void ubahTersembunyi(f)}>
                          {f.tersembunyi ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                          {f.tersembunyi ? ' Tampilkan' : ' Sembunyikan'}
                        </button>
                        {!f.pernah_diisi && (
                          <button type="button" className="btn btn--ghost btn--sm" aria-label={`Hapus ${f.label}`} onClick={() => { setGalatHapus(null); setHapus(f); }}>
                            <Trash2 size={14} aria-hidden="true" /> Hapus
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {buka && (
                    <tr id={idRincian} className={styles.rincian}>
                      <td colSpan={KOLOM}>
                        <div className={styles.rincianIsi}>
                          <div className={styles.rincianKolom}>
                            <label htmlFor={`${idRincian}-jenis`} className="form-label">Jenis isian</label>
                            <select id={`${idRincian}-jenis`} className="form-select" value={f.jenis} disabled aria-describedby={`${idRincian}-jenis-bantuan`}>
                              {JENIS_KHUSUS.map((j) => <option key={j} value={j}>{LABEL_JENIS[j]}</option>)}
                            </select>
                            <small id={`${idRincian}-jenis-bantuan`} className={styles.bantuan}>
                              Jenis tidak dapat diubah setelah isian dibuat{f.pernah_diisi ? '; isian ini pernah diisi sehingga hanya bisa disembunyikan' : '. Hapus lalu buat ulang bila belum pernah diisi'}.
                            </small>
                          </div>
                          {jenisButuhOpsi(f.jenis) && (
                            <div className={styles.rincianKolom}>
                              <label htmlFor={`${idRincian}-opsi`} className="form-label">Pilihan (satu per baris)</label>
                              <textarea
                                id={`${idRincian}-opsi`}
                                className="form-textarea"
                                rows={5}
                                value={drafOpsi[f.id] ?? ''}
                                readOnly={sedang}
                                aria-describedby={`${idRincian}-opsi-bantuan${galatOpsi[f.id] ? ` ${idRincian}-opsi-galat` : ''}`}
                                aria-invalid={galatOpsi[f.id] ? true : undefined}
                                onChange={(e) => setDrafOpsi((d) => ({ ...d, [f.id]: e.target.value }))}
                              />
                              <small id={`${idRincian}-opsi-bantuan`} className={styles.bantuan}>
                                {BATAS_KHUSUS.opsiMin}-{BATAS_KHUSUS.opsiMaks} pilihan, maksimal {BATAS_KHUSUS.opsiPanjang} karakter per pilihan. Jawaban lama tetap tersimpan apa adanya.
                              </small>
                              {galatOpsi[f.id] && <p id={`${idRincian}-opsi-galat`} role="alert" className={styles.galat}>{galatOpsi[f.id]}</p>}
                              <div>
                                <button type="button" className="btn btn--secondary btn--sm" disabled={sedang} aria-busy={sedang || undefined} onClick={() => void simpanOpsi(f)}>
                                  Simpan pilihan
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <BarisTambah
              kolom={KOLOM}
              ariaTombol="Tambah isian"
              nonaktif={isian.length >= BATAS_KHUSUS.isianPerLayanan}
              ketNonaktif={`Batas ${BATAS_KHUSUS.isianPerLayanan} isian per Layanan tercapai.`}
              bidang={[
                { kunci: 'label', label: 'Label isian baru', placeholder: '+ Tambah isian', maxLength: BATAS_KHUSUS.labelMaks },
                { kunci: 'jenis', label: 'Jenis isian baru', jenis: 'pilih', awal: 'teks_singkat', opsi: JENIS_KHUSUS.map((j) => ({ nilai: j, label: LABEL_JENIS[j] })) },
                { kunci: 'wajib', label: 'Wajib diisi', jenis: 'kotak' },
                {
                  kunci: 'opsi', label: 'Pilihan isian baru (satu per baris)', jenis: 'area',
                  bantuan: `${BATAS_KHUSUS.opsiMin}-${BATAS_KHUSUS.opsiMaks} pilihan, maksimal ${BATAS_KHUSUS.opsiPanjang} karakter per pilihan.`,
                  tampilJika: (n) => jenisButuhOpsi(n.jenis ?? ''),
                },
              ]}
              onTambah={tambah}
            />
          </tbody>
        </table>
      </div>
      <p role="status" aria-live="polite" className="sr-only">{pengumuman}</p>

      {hapus && (
        <FormDialog
          judul={`Hapus isian ${hapus.label}?`}
          deskripsi="Isian ini belum pernah diisi, jadi dapat dihapus. Isian yang sudah pernah diisi hanya bisa disembunyikan."
          labelKirim="Ya, hapus"
          mengirim={menghapus}
          galat={galatHapus}
          onClose={() => { setHapus(null); setGalatHapus(null); }}
          onSubmit={jalankanHapus}
          maxWidth={460}
        >
          {() => null}
        </FormDialog>
      )}
    </>
  );
}
