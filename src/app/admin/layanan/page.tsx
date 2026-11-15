'use client';

import Tombol from '@/components/ui/Tombol';
import Kartu from '@/components/ui/Kartu';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import Lencana from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Galat from '@/components/ui/Galat';
import { formatTanggal } from '@/lib/utils';

import tampilan from './page.dasbor.module.css';

import { useCallback, useEffect, useState } from 'react';
import { Archive, Building2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import IsiHalaman from '@/components/layout/IsiHalaman';
import { useToast } from '@/components/Toast';
import RoleNote from '@/components/admin/RoleNote';
import { AkunDialog } from '@/components/admin/AkunForm';
import FormDialog from '@/components/admin/FormDialog';
import { AdminFetchError, adminFetch } from '@/components/admin/adminFetch';
import LayananForm, { FORM_PENDATAAN_LABEL, STATUS_LABEL, type HasilForm, type LayananRow } from '@/components/admin/layanan/LayananForm';
import { BarisTambah, SelTeksInline } from '@/components/admin/SuntingInline';
import { TAG_PUBLIK_KLIEN, segarkanPublik } from '@/lib/data/klien/segarkanPublik';
import { buangCacheReferensi } from '@/lib/data/klien/useReferensi';
import { KUNCI_REFERENSI } from '@/lib/data/referensi';
import type { InstansiRow, LayananTautan } from '@/lib/layanan/schemas';
import styles from '@/components/admin/layanan/KelolaLayanan.module.css';

const ya = (v: boolean) => (v ? 'Ya' : 'Tidak');
const NAMA_INSTANSI_MIN = 2;
const NAMA_INSTANSI_MAKS = 150;
const SINGKATAN_MAKS = 30;
const PESAN_SUDAH_DIPAKAI = 'Layanan ini sudah pernah dipakai, jadi hanya bisa diarsipkan.';

const tanggalArsip = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : formatTanggal(iso);
};

// Dialog yang sedang terbuka: form (baru / ubah), konfirmasi arsip, atau konfirmasi hapus permanen.
type Aksi = { jenis: 'arsip' | 'hapus'; row: LayananRow };

// Panggil SETELAH penulisan ke server selesai (rencana 4.5). Galat pembuangan cache diabaikan (lihat segarkanPublik).
// Etalase publik (beranda + daftar layanan) ber-cache di server; kartu etalase juga memuat nama instansi dan website
// terkait, jadi perubahan instansi/tautan memakai tag yang sama.
const etalaseBerubah = () => {
  void segarkanPublik([TAG_PUBLIK_KLIEN.layanan, TAG_PUBLIK_KLIEN.beranda]);
};
// Layanan sendiri berubah (tambah/ubah/arsip/pulihkan/hapus): selain etalase, daftar layanan ringkas yang di-cache di
// klien (halaman topik/dokumen) ikut basi.
const layananBerubah = () => {
  etalaseBerubah();
  buangCacheReferensi(KUNCI_REFERENSI.layananRingkas);
};

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
  const [pengumuman, setPengumuman] = useState('');

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
      layananBerubah();
      toast(row ? 'Layanan diperbarui.' : 'Layanan ditambahkan.', 'success');
      tutup();
      await load();
    } catch (e) {
      const pesan = e instanceof Error ? e.message : 'Gagal menyimpan';
      if (layananTersimpan) {
        layananBerubah(); // layanan sudah tersimpan walau website terkait gagal: cache tetap harus dibuang
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
      etalaseBerubah(); // /chat dan beranda membaca chatbot_aktif dari cache publik
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
      layananBerubah();
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

  const validasiInstansiNama = (v: string) =>
    v.length < NAMA_INSTANSI_MIN || v.length > NAMA_INSTANSI_MAKS
      ? `Nama instansi ${NAMA_INSTANSI_MIN} sampai ${NAMA_INSTANSI_MAKS} karakter.`
      : null;
  const validasiSingkatan = (v: string) => (v.length > SINGKATAN_MAKS ? `Singkatan maksimal ${SINGKATAN_MAKS} karakter.` : null);

  const ubahInstansi = async (i: InstansiRow, bidang: 'nama' | 'singkatan', baru: string): Promise<string | null> => {
    try {
      await adminFetch(`/api/admin/instansi/${i.id}`, 'PATCH', { [bidang]: bidang === 'singkatan' ? baru || null : baru });
      etalaseBerubah();
      setPengumuman(`Instansi ${bidang === 'nama' ? baru : i.nama} diperbarui.`);
      await load();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Gagal menyimpan instansi';
    }
  };

  const tambahInstansi = async (nilai: Record<string, string>): Promise<string | null> => {
    const nama = (nilai.nama ?? '').trim();
    const singkatan = (nilai.singkatan ?? '').trim();
    const galat = validasiInstansiNama(nama) ?? validasiSingkatan(singkatan);
    if (galat) return galat;
    try {
      await adminFetch('/api/admin/instansi', 'POST', { nama, singkatan: singkatan || null });
      etalaseBerubah();
      setPengumuman(`Instansi ${nama} ditambahkan.`);
      await load();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Gagal menyimpan instansi';
    }
  };

  const aktifkanLagi = async (row: LayananRow) => {
    try {
      await adminFetch(`/api/admin/layanan/${row.id}/arsip`, 'POST', { arsip: false });
      layananBerubah();
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

  const kolomLayanan: KolomTabel<LayananRow>[] = [
    { kunci: 'nama', judul: 'Layanan', judulBaris: true },
    { kunci: 'instansi', judul: 'Instansi', render: (r) => namaInstansi(r.instansi_id) },
    { kunci: 'loket', judul: 'Loket', angka: true, render: (r) => r.nomor_loket ?? '—' },
    { kunci: 'prefiks', judul: 'Prefiks', render: (r) => r.prefiks_antrean ?? '—' },
    { kunci: 'tampilan', judul: 'Halaman utama', render: (r) => <Lencana nada={r.status_tampilan === 'aktif' ? 'sukses' : 'netral'}>{STATUS_LABEL[r.status_tampilan] ?? r.status_tampilan}</Lencana> },
    { kunci: 'homepage', judul: 'Homepage', render: (r) => ya(r.tampil_di_homepage ?? true) },
    { kunci: 'layar', judul: 'Layar TV', render: (r) => ya(r.tampil_di_layar) },
    { kunci: 'antrean', judul: 'Antrean', render: (r) => ya(r.punya_antrean) },
    { kunci: 'pendataan', judul: 'Pendataan', render: (r) => r.form_pendataan ? FORM_PENDATAAN_LABEL[r.form_pendataan] : '—' },
    { kunci: 'chat', judul: 'Chat', render: (r) => ya(r.punya_chat) },
    { kunci: 'bot', judul: 'Bot', render: (r) => bisaUbah ? (
      <label className={styles.saklarBaris}>
        <input type="checkbox" role="switch" aria-label={`Bot ${r.nama}`}
          checked={r.chatbot_aktif} onChange={() => ubahBot(r)} />
        {r.chatbot_aktif ? 'Hidup' : 'Mati'}
      </label>
    ) : (r.chatbot_aktif ? 'Hidup' : 'Mati') },
  ];
  if (bisaUbah) kolomLayanan.push({ kunci: 'aksi', judul: 'Aksi', render: (r) => (
    <div className={styles.rowActions}>
      <Tombol varian="sekunder" ukuran="kecil" aria-label={`Ubah ${r.nama}`} onClick={() => bukaUbah(r)}>Ubah</Tombol>
      {!r.form_pendataan && <Tombol href={`/admin/layanan/${r.id}/pendataan`} varian="hantu" ukuran="kecil"
        aria-label={`Pendataan Khusus ${r.nama}`}>Pendataan Khusus</Tombol>}
      <Tombol varian="hantu" ukuran="kecil" ikon={Archive} aria-label={`Arsipkan ${r.nama}`}
        onClick={() => setAksi({ jenis: 'arsip', row: r })}>Arsipkan</Tombol>
    </div>
  ) });

  const kolomArsip: KolomTabel<LayananRow>[] = [
    { kunci: 'nama', judul: 'Layanan', judulBaris: true, peran: 'utama', render: (r) => <span className={tampilan.namaArsip}>{r.nama}</span> },
    { kunci: 'instansi', judul: 'Instansi', render: (r) => namaInstansi(r.instansi_id) },
    { kunci: 'diarsipkan', judul: 'Diarsipkan pada', render: (r) => tanggalArsip(r.diarsipkan_at) },
  ];
  if (bisaUbah) kolomArsip.push({ kunci: 'aksi', judul: 'Aksi', peran: 'aksi', render: (r) => (
    <div className={styles.rowActions}>
      <Tombol type="button" varian="sekunder" ukuran="kecil"
        aria-label={`Aktifkan lagi ${r.nama}`} onClick={() => aktifkanLagi(r)}>
        <RotateCcw size={14} aria-hidden="true" /> Aktifkan lagi
      </Tombol>
      <Tombol type="button" varian="hantu" ukuran="kecil"
        aria-label={`Hapus permanen ${r.nama}`} onClick={() => setAksi({ jenis: 'hapus', row: r })}>
        <Trash2 size={14} aria-hidden="true" /> Hapus permanen
      </Tombol>
    </div>
  ) });

  // Kolom ketiga kosong sengaja ada: baris tambah (BarisTambah, kolom={3}) menaruh tombol "Tambah" di kolom terakhir.
  const kolomInstansi: KolomTabel<InstansiRow>[] = [
    { kunci: 'nama', judul: 'Nama', judulBaris: true, render: (i) => (
      <SelTeksInline nilai={i.nama} label={`nama instansi ${i.nama}`} maxLength={NAMA_INSTANSI_MAKS}
        validasi={validasiInstansiNama} onSimpan={(baru) => ubahInstansi(i, 'nama', baru)} />
    ) },
    { kunci: 'singkatan', judul: 'Singkatan', render: (i) => (
      <SelTeksInline nilai={i.singkatan ?? ''} label={`singkatan instansi ${i.nama}`} maxLength={SINGKATAN_MAKS}
        teksKosong="Tambah singkatan" validasi={validasiSingkatan}
        onSimpan={(baru) => ubahInstansi(i, 'singkatan', baru)} />
    ) },
    { kunci: 'aksi', judul: <span className="sr-only">Aksi</span>, lebar: '140px', render: () => null },
  ];

  return (
    <>
      <PageHeader meta="Tanggal ditampilkan dalam WIB" title="Kelola Layanan" description="Tambah layanan, atur konten, website terkait, Instansi, loket, antrean, Formulir Pendataan, chat, dan bot" />
      <IsiHalaman>
        {/* Satu anak blok: jarak antarbagian di halaman ini diatur margin RoleNote, toolbar, dan bagian (bukan gap grid). */}
        <div>
          {!loading && !loadError && (
            <RoleNote>
              {bisaUbah
                ? 'Admin: Anda dapat mengubah layanan. Setiap perubahan tercatat di Riwayat Perubahan.'
                : 'Front Office: halaman ini hanya untuk dilihat. Perubahan layanan dilakukan oleh Admin.'}
            </RoleNote>
          )}
          {!loading && !loadError && bisaUbah && (
            <div className={styles.toolbar}>
              <Tombol href="#instansi" varian="sekunder">
                <Building2 size={16} aria-hidden="true" /> Kelola Instansi
              </Tombol>
              <Tombol type="button" varian="utama" onClick={bukaBaru}>
                <Plus size={16} aria-hidden="true" /> Tambah layanan
              </Tombol>
            </div>
          )}
          <Kartu judul="Layanan aktif" padding="tanpa">
            {loading ? (
              <Skeleton bentuk="baris" jumlah={5} label="Memuat layanan" />
            ) : loadError ? (
              <Galat pesan={loadError} onRetry={() => { setLoading(true); void load(); }} />
            ) : (
              <Tabel caption="Daftar layanan aktif" kolom={kolomLayanan} baris={aktif} kunciBaris="id"
                kosong={<StatusKosong ikon={Building2} judul="Belum ada layanan aktif."
                  isi={bisaUbah ? 'Pilih "Tambah layanan" untuk membuat yang pertama.' : undefined} />} />
            )}
          </Kartu>

          {!loading && !loadError && bisaUbah && (
            <Kartu id="instansi" judul="Instansi" className={styles.bagian}>

              <p className={styles.sectionHint}>
                Instansi adalah pemilik layanan, misalnya dinas atau lembaga. Klik nama atau singkatan untuk mengubahnya;
                layanan memilih instansinya di formulir layanan.
              </p>
              <Tabel caption="Daftar instansi" kolom={kolomInstansi} baris={instansi} kunciBaris="id"
                akhir={
                  <BarisTambah
                    kolom={3}
                    ariaTombol="Tambah instansi"
                    bidang={[
                      { kunci: 'nama', label: 'Nama instansi baru', placeholder: '+ Tambah instansi', maxLength: NAMA_INSTANSI_MAKS },
                      { kunci: 'singkatan', label: 'Singkatan instansi baru', placeholder: 'Singkatan (opsional)', maxLength: SINGKATAN_MAKS },
                    ]}
                    onTambah={tambahInstansi}
                  />
                } />
            </Kartu>
          )}

          {!loading && !loadError && arsip.length > 0 && (
            <Kartu judul="Diarsipkan" className={styles.bagian}>

              <p className={styles.sectionHint}>
                Layanan yang diarsipkan tidak tampil di publik dan tidak menerbitkan tiket atau reservasi baru. Riwayatnya tetap tersimpan.
              </p>
              <Tabel caption="Daftar layanan yang diarsipkan" kolom={kolomArsip} baris={arsip} kunciBaris="id"
                kelasBaris={() => styles.mutedRow} kartuDiHp />
            </Kartu>
          )}
        </div>
      </IsiHalaman>

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
          maxWidth={460}>
          {() => null}
        </FormDialog>
      )}

      <p role="status" aria-live="polite" className="sr-only">{pengumuman}</p>
    </>
  );
}
