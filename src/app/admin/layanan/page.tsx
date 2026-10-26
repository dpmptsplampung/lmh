'use client';

import { useCallback, useEffect, useState } from 'react';
import { Archive, Building2, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useToast } from '@/components/Toast';
import RoleNote from '@/components/admin/RoleNote';
import { AkunDialog } from '@/components/admin/AkunForm';
import FormDialog from '@/components/admin/FormDialog';
import { AdminFetchError, adminFetch } from '@/components/admin/adminFetch';
import LayananForm, {
  FORM_PENDATAAN_LABEL, STATUS_LABEL, type HasilForm, type LayananRow,
} from '@/components/admin/layanan/LayananForm';
import InstansiDialog from '@/components/admin/layanan/InstansiDialog';
import type { InstansiRow, LayananTautan } from '@/lib/layanan/schemas';
import styles from '@/components/admin/layanan/KelolaLayanan.module.css';

const ya = (v: boolean) => (v ? 'Ya' : 'Tidak');
const PESAN_SUDAH_DIPAKAI = 'Layanan ini sudah pernah dipakai, jadi hanya bisa diarsipkan.';

const tanggalArsip = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
};

// Dialog yang sedang terbuka: form (baru / ubah), konfirmasi arsip, atau konfirmasi hapus permanen.
type Aksi = { jenis: 'arsip' | 'hapus'; row: LayananRow };

export default function KelolaLayananPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<LayananRow[]>([]);
  const [instansi, setInstansi] = useState<InstansiRow[]>([]);
  const [bisaUbah, setBisaUbah] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [edit, setEdit] = useState<LayananRow | null>(null);
  const [buat, setBuat] = useState(false);
  // Naik tiap kali form dibuka agar state form (isian, galat) selalu segar; TIDAK berubah saat daftar dimuat ulang.
  const [kunciForm, setKunciForm] = useState(0);
  // Website terkait yang gagal tersimpan setelah layanan tersimpan; mengisi ulang form agar pengguna tidak mengetik ulang.
  const [tautanTertunda, setTautanTertunda] = useState<LayananTautan[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [aksi, setAksi] = useState<Aksi | null>(null);
  const [aksiBusy, setAksiBusy] = useState(false);
  const [aksiError, setAksiError] = useState('');
  const [instansiBuka, setInstansiBuka] = useState(false);

  const load = useCallback(async (): Promise<LayananRow[]> => {
    try {
      const json = await adminFetch<{ layanan: LayananRow[]; instansi?: InstansiRow[]; bisa_ubah: boolean }>('/api/admin/layanan');
      const daftar = json.layanan ?? [];
      setRows(daftar);
      setInstansi(json.instansi ?? []);
      setBisaUbah(json.bisa_ubah === true);
      setLoadError('');
      return daftar;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Gagal memuat layanan');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const tutup = useCallback(() => { setEdit(null); setBuat(false); setDialogError(''); setTautanTertunda(undefined); }, []);
  const bukaBaru = () => { setDialogError(''); setTautanTertunda(undefined); setKunciForm((k) => k + 1); setBuat(true); };
  const bukaUbah = (row: LayananRow) => { setDialogError(''); setTautanTertunda(undefined); setKunciForm((k) => k + 1); setEdit(row); };

  const simpanTautan = (id: string, tautan: HasilForm['tautan']) =>
    adminFetch(`/api/admin/layanan/${id}/tautan`, 'PUT', { tautan });

  const simpan = async (row: LayananRow | null, { patch, tautan }: HasilForm) => {
    setBusy(true);
    setDialogError('');
    // Urutan: simpan layanan dulu (PATCH/POST), baru website terkait. Bila langkah kedua gagal, layanan sudah tersimpan:
    // dialog tetap terbuka dalam mode ubah pada layanan itu agar pengguna bisa mengulang hanya bagian yang gagal.
    let id = row?.id ?? '';
    let layananTersimpan = false;
    try {
      if (row) {
        if (Object.keys(patch).length > 0) await adminFetch(`/api/admin/layanan/${row.id}`, 'PATCH', patch);
      } else {
        const dibuat = await adminFetch<{ id: string }>('/api/admin/layanan', 'POST', patch);
        id = dibuat.id;
      }
      layananTersimpan = true;
      if (tautan !== undefined) await simpanTautan(id, tautan);
      toast(row ? 'Layanan diperbarui.' : 'Layanan ditambahkan.', 'success');
      tutup();
      await load();
    } catch (e) {
      const pesan = e instanceof Error ? e.message : 'Gagal menyimpan';
      if (layananTersimpan) {
        const daftar = await load();
        const terbaru = daftar.find((r) => r.id === id);
        if (terbaru) {
          // Pasang ulang form dari baris yang dimuat ulang: slug/prefiks hasil otomatis server terisi, sehingga percobaan
          // ulang hanya mengirim website terkait (bukan slug kosong atau prefiks null yang menimpa nilai otomatis).
          setTautanTertunda(tautan);
          setKunciForm((k) => k + 1);
          setBuat(false);
          setEdit(terbaru);
        }
        setDialogError(`Layanan sudah tersimpan, tetapi website terkait belum: ${pesan}`);
      } else {
        setDialogError(pesan);
      }
    } finally {
      setBusy(false);
    }
  };

  const ubahBot = async (row: LayananRow) => {
    try {
      await adminFetch(`/api/admin/layanan/${row.id}/bot`, 'PATCH', { aktif: !row.chatbot_aktif });
      toast(`Bot ${row.nama} ${row.chatbot_aktif ? 'dimatikan' : 'dihidupkan'}.`, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengubah bot', 'error');
    }
  };

  const tutupAksi = useCallback(() => { setAksi(null); setAksiError(''); }, []);

  const jalankanAksi = async () => {
    if (!aksi) return;
    setAksiBusy(true);
    setAksiError('');
    try {
      if (aksi.jenis === 'arsip') {
        await adminFetch(`/api/admin/layanan/${aksi.row.id}/arsip`, 'POST', { arsip: true });
        toast(`${aksi.row.nama} diarsipkan.`, 'success');
      } else {
        await adminFetch(`/api/admin/layanan/${aksi.row.id}`, 'DELETE');
        toast(`${aksi.row.nama} dihapus permanen.`, 'success');
      }
      tutupAksi();
      await load();
    } catch (e) {
      setAksiError(e instanceof AdminFetchError && e.kode === 'SUDAH_DIPAKAI'
        ? PESAN_SUDAH_DIPAKAI
        : e instanceof Error ? e.message : 'Gagal memproses permintaan');
    } finally {
      setAksiBusy(false);
    }
  };

  const aktifkanLagi = async (row: LayananRow) => {
    try {
      await adminFetch(`/api/admin/layanan/${row.id}/arsip`, 'POST', { arsip: false });
      toast(`${row.nama} diaktifkan lagi.`, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengaktifkan layanan', 'error');
    }
  };

  const namaInstansi = (id: string | null | undefined) => {
    const i = id ? instansi.find((x) => x.id === id) : null;
    return i ? (i.singkatan ?? i.nama) : '—';
  };

  // Arsip = aktif === false (sama dengan gerbang DB); diarsipkan_at hanya informasi tanggal (bisa kosong pada data lama).
  const aktif = rows.filter((r) => r.aktif !== false);
  const arsip = rows.filter((r) => r.aktif === false);

  return (
    <>
      <PageHeader title="Kelola Layanan" description="Tambah layanan, atur konten, website terkait, Instansi, loket, antrean, Formulir Pendataan, chat, dan bot" />
      <div style={{ padding: 'clamp(var(--space-4), 4vw, var(--space-8))' }}>
        {!loading && !loadError && (
          <RoleNote>
            {bisaUbah
              ? 'Admin: Anda dapat mengubah layanan. Setiap perubahan tercatat di Riwayat Perubahan.'
              : 'Front Office: halaman ini hanya untuk dilihat. Perubahan layanan dilakukan oleh Admin.'}
          </RoleNote>
        )}
        {!loading && !loadError && bisaUbah && (
          <div className={styles.toolbar}>
            <button type="button" className="btn btn--secondary" onClick={() => setInstansiBuka(true)}>
              <Building2 size={16} aria-hidden="true" /> Kelola Instansi
            </button>
            <button type="button" className="btn btn--primary" onClick={bukaBaru}>
              <Plus size={16} aria-hidden="true" /> Tambah layanan
            </button>
          </div>
        )}
        <div className="table-wrapper">
          {loading ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="status" aria-label="Memuat">
              <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} />
            </div>
          ) : loadError ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="alert" className="form-error">{loadError}</div>
          ) : aktif.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              {bisaUbah ? 'Belum ada layanan aktif. Pilih "Tambah layanan" untuk membuat yang pertama.' : 'Belum ada layanan aktif.'}
            </div>
          ) : (
            <table className="table">
              <caption className={styles.srOnly}>Daftar layanan aktif</caption>
              <thead>
                <tr>
                  <th>Layanan</th><th>Instansi</th><th>Loket</th><th>Prefiks</th><th>Halaman utama</th>
                  <th>Layar TV</th><th>Antrean</th><th>Pendataan</th><th>Chat</th><th>Bot</th>
                  {bisaUbah && <th>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {aktif.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.nama}</td>
                    <td>{namaInstansi(r.instansi_id)}</td>
                    <td>{r.nomor_loket ?? '—'}</td>
                    <td>{r.prefiks_antrean ?? '—'}</td>
                    <td>{STATUS_LABEL[r.status_tampilan] ?? r.status_tampilan}</td>
                    <td>{ya(r.tampil_di_layar)}</td>
                    <td>{ya(r.punya_antrean)}</td>
                    <td>{r.form_pendataan ? FORM_PENDATAAN_LABEL[r.form_pendataan] : '—'}</td>
                    <td>{ya(r.punya_chat)}</td>
                    <td>
                      {bisaUbah ? (
                        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                          <input type="checkbox" role="switch" aria-label={`Bot ${r.nama}`}
                            checked={r.chatbot_aktif} onChange={() => ubahBot(r)} />
                          {r.chatbot_aktif ? 'Hidup' : 'Mati'}
                        </label>
                      ) : (r.chatbot_aktif ? 'Hidup' : 'Mati')}
                    </td>
                    {bisaUbah && (
                      <td>
                        <div className={styles.rowActions}>
                          <button type="button" className="btn btn--secondary btn--sm"
                            aria-label={`Ubah ${r.nama}`} onClick={() => bukaUbah(r)}>Ubah</button>
                          <button type="button" className="btn btn--ghost btn--sm"
                            aria-label={`Arsipkan ${r.nama}`} onClick={() => setAksi({ jenis: 'arsip', row: r })}>
                            <Archive size={14} aria-hidden="true" /> Arsipkan
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && !loadError && arsip.length > 0 && (
          <section aria-labelledby="judulArsip">
            <h2 id="judulArsip" className={styles.sectionTitle}>Diarsipkan</h2>
            <p className={styles.sectionHint}>
              Layanan yang diarsipkan tidak tampil di publik dan tidak menerbitkan tiket atau reservasi baru. Riwayatnya tetap tersimpan.
            </p>
            <div className="table-wrapper">
              <table className="table">
                <caption className={styles.srOnly}>Daftar layanan yang diarsipkan</caption>
                <thead>
                  <tr>
                    <th>Layanan</th><th>Instansi</th><th>Diarsipkan pada</th>
                    {bisaUbah && <th>Aksi</th>}
                  </tr>
                </thead>
                <tbody>
                  {arsip.map((r) => (
                    <tr key={r.id} className={styles.mutedRow}>
                      <td style={{ fontWeight: 600 }}>{r.nama}</td>
                      <td>{namaInstansi(r.instansi_id)}</td>
                      <td>{tanggalArsip(r.diarsipkan_at)}</td>
                      {bisaUbah && (
                        <td>
                          <div className={styles.rowActions}>
                            <button type="button" className="btn btn--secondary btn--sm"
                              aria-label={`Aktifkan lagi ${r.nama}`} onClick={() => aktifkanLagi(r)}>
                              <RotateCcw size={14} aria-hidden="true" /> Aktifkan lagi
                            </button>
                            <button type="button" className="btn btn--ghost btn--sm"
                              aria-label={`Hapus permanen ${r.nama}`} onClick={() => setAksi({ jenis: 'hapus', row: r })}>
                              <Trash2 size={14} aria-hidden="true" /> Hapus permanen
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {(edit || buat) && (
        <AkunDialog title={edit ? `Ubah layanan: ${edit.nama}` : 'Tambah layanan'} onClose={tutup}>
          <LayananForm key={kunciForm} layanan={edit} instansi={instansi} saving={busy} error={dialogError} tautanAwal={tautanTertunda}
            onSubmit={(hasil) => simpan(edit, hasil)} onCancel={tutup} />
        </AkunDialog>
      )}

      {aksi && (
        <FormDialog
          judul={aksi.jenis === 'arsip' ? `Arsipkan ${aksi.row.nama}?` : `Hapus permanen ${aksi.row.nama}?`}
          deskripsi={aksi.jenis === 'arsip'
            ? 'Layanan tidak lagi tampil di publik dan tidak menerbitkan tiket atau reservasi baru. Data lama tetap tersimpan, dan Anda bisa mengaktifkannya lagi kapan saja.'
            : 'Layanan ini dihapus selamanya dan tidak bisa dikembalikan. Layanan yang sudah pernah dipakai tidak bisa dihapus, hanya diarsipkan.'}
          labelKirim={aksi.jenis === 'arsip' ? 'Ya, arsipkan' : 'Ya, hapus permanen'}
          mengirim={aksiBusy}
          galat={aksiError || null}
          onClose={tutupAksi}
          onSubmit={jalankanAksi}
          maxWidth={460}
        >
          {() => null}
        </FormDialog>
      )}

      <InstansiDialog open={instansiBuka} onClose={() => setInstansiBuka(false)} instansi={instansi} onSaved={async () => { await load(); }} />
    </>
  );
}
