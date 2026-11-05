'use client';

import Field from '@/components/ui/Field';

import Tombol from '@/components/ui/Tombol';
import Tabel from '@/components/ui/Tabel';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import Dialog from '@/components/ui/Dialog';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Galat from '@/components/ui/Galat';

import tampilan from './page.dasbor.module.css';

import { useState, useEffect, useCallback } from 'react';
import FotoUmkm from '@/components/umkm/FotoUmkm';
import { unggahKeR2 } from '@/lib/storage/unggah';
import { validasiUrlFoto } from '@/lib/umkm/foto-url';
import { Store, Search, Eye, CheckCircle2, XCircle, Clock, RefreshCw, Plus, Edit2, Trash2, Loader2, X, Save, Mail, Link2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { KATEGORI_UMKM, type KategoriUMKM } from '@/lib/constants';
import { cn, waLink, formatTanggal, formatTanggalWaktu } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { mutasiInsert, mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';
import { useToast } from '@/components/Toast';

interface UMKMListing {
  id: string;
  nama_umkm: string;
  kategori_kebutuhan: KategoriUMKM;
  sisi: 'kebutuhan' | 'penawaran';
  deskripsi: string | null;
  foto_produk: string[] | null;
  kontak_nama: string;
  kontak_hp: string | null;
  kontak_email: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface UmkmListingOwner {
  id: string;
  listing_id: string;
  email: string;
  created_at: string;
}

/** Harus sama dengan POLICY_VERSION di kebijakan-privasi/page.tsx dan CONSENT_VERSION di checkin/chat. */
const POLICY_VERSION = '1.0';
const TUJUAN_CONSENT_KONTAK_PUBLIK = 'umkm_contact_public';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_review: '● Pending',
  published: '✓ Published',
  nonaktif: 'Nonaktif',
  expired: 'Expired',
};

interface FormData {
  nama_umkm: string;
  kategori_kebutuhan: KategoriUMKM | '';
  sisi: 'kebutuhan' | 'penawaran';
  deskripsi: string;
  kontak_nama: string;
  kontak_hp: string;
  kontak_email: string;
  foto_produk: string[];
}

const emptyForm: FormData = {
  nama_umkm: '',
  kategori_kebutuhan: '',
  sisi: 'kebutuhan',
  deskripsi: '',
  kontak_nama: '',
  kontak_hp: '',
  kontak_email: '',
  foto_produk: [],
};

export default function AdminUMKMPage() {
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState<string>('semua');
  const [search, setSearch] = useState('');
  const [umkmList, setUmkmList] = useState<UMKMListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [tautanFoto, setTautanFoto] = useState('');

  const [viewingId, setViewingId] = useState<string | null>(null);

  const [owners, setOwners] = useState<UmkmListingOwner[]>([]);
  const [ownerEmailInput, setOwnerEmailInput] = useState('');
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [sendingLinkId, setSendingLinkId] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('listing_umkm')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUmkmList((data || []) as UMKMListing[]);

      const { data: ownerData, error: ownerError } = await supabase
        .from('umkm_listing_owner')
        .select('id, listing_id, email, created_at');

      if (ownerError) throw ownerError;
      setOwners((ownerData || []) as UmkmListingOwner[]);
      setLoadError('');
    } catch {
      setLoadError('Gagal memuat data UMKM. Silakan coba lagi.');
      toast('Gagal memuat data UMKM. Silakan coba lagi.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      const supabase = createClient();
      // .select('id') + mutasiWajibBaris: RLS yang menolak UPDATE = 0 baris tanpa error (sukses palsu).
      await mutasiWajibBaris(
        supabase
          .from('listing_umkm')
          .update({
            status: newStatus,
            updated_at: new Date().toISOString(),
            ...(newStatus === 'published' ? { snapshot_approved: null } : {}),
          })
          .eq('id', id)
          .select('id'),
      );

      setUmkmList(prev => prev.map(l => l.id === id ? { ...l, status: newStatus } : l));
      toast(`Status UMKM berhasil diperbarui menjadi ${STATUS_LABELS[newStatus] || newStatus}`, 'success');
    } catch (e) {
      toast(`Gagal memperbarui status. ${pesanMutasi(e)}`, 'error');
      if (perluMuatUlang(e)) await loadData();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus listing UMKM ini? Tindakan ini tidak bisa dibatalkan.')) return;

    try {
      const supabase = createClient();
      // 0 baris terhapus (RLS menolak diam-diam / listing sudah tak ada) = gagal, bukan sukses.
      await mutasiWajibBaris(
        supabase
          .from('listing_umkm')
          .delete()
          .eq('id', id)
          .select('id'),
      );

      setUmkmList(prev => prev.filter(l => l.id !== id));
      toast('Listing UMKM berhasil dihapus.', 'success');
    } catch (e) {
      toast(`Gagal menghapus listing. ${pesanMutasi(e)}`, 'error');
      if (perluMuatUlang(e)) await loadData();
    }
  };

  const handleOpenCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setConsentChecked(false);
    setShowForm(true);
  };

  const handleOpenEdit = (item: UMKMListing) => {
    setEditingId(item.id);
    setForm({
      nama_umkm: item.nama_umkm,
      kategori_kebutuhan: item.kategori_kebutuhan,
      sisi: item.sisi === 'penawaran' ? 'penawaran' : 'kebutuhan',
      deskripsi: item.deskripsi || '',
      kontak_nama: item.kontak_nama,
      kontak_hp: item.kontak_hp || '',
      kontak_email: item.kontak_email || '',
      foto_produk: item.foto_produk || [],
    });
    setFormError('');
    setConsentChecked(false);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormError('');
  };

  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const currentCount = form.foto_produk.length;
    if (currentCount + files.length > 8) {
      toast('Maksimal 8 foto', 'warning');
      return;
    }

    const validFiles: File[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        toast('File harus berupa gambar', 'warning');
        continue;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast('Ukuran foto maksimal 2MB', 'warning');
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;
    if (currentCount + validFiles.length > 8) {
      toast('Maksimal 8 foto', 'warning');
      return;
    }

    setUploadingPhotos(true);
    try {
      const newUrls: string[] = [];

      for (const file of validFiles) {
        const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        const hasil = await unggahKeR2('umkm-photos', `${crypto.randomUUID()}.${ext}`, file);
        if (!hasil.url) throw new Error('URL foto tidak tersedia');
        newUrls.push(hasil.url);
      }

      setForm(prev => ({
        ...prev,
        foto_produk: [...prev.foto_produk, ...newUrls],
      }));
      toast(`${newUrls.length} foto berhasil diunggah.`, 'success');
    } catch {
      toast('Gagal mengunggah foto. Silakan coba lagi.', 'error');
    } finally {
      setUploadingPhotos(false);
    }
  };

  const handleTambahTautanFoto = () => {
    const hasil = validasiUrlFoto(tautanFoto);
    if (!hasil.ok) {
      toast(hasil.alasan, 'warning');
      return;
    }
    if (form.foto_produk.includes(hasil.url)) {
      toast('Tautan itu sudah ada', 'warning');
      return;
    }
    if (form.foto_produk.length >= 8) {
      toast('Maksimal 8 foto', 'warning');
      return;
    }
    setForm(prev => ({ ...prev, foto_produk: [...prev.foto_produk, hasil.url] }));
    setTautanFoto('');
  };

  const handleRemovePhoto = (index: number) => {
    setForm(prev => ({
      ...prev,
      foto_produk: prev.foto_produk.filter((_, i) => i !== index),
    }));
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!form.nama_umkm.trim()) {
      setFormError('Nama UMKM wajib diisi');
      return;
    }
    if (!form.kategori_kebutuhan) {
      setFormError('Pilih kategori kebutuhan');
      return;
    }
    if (!form.kontak_nama.trim()) {
      setFormError('Nama kontak wajib diisi');
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();

      const payload = {
        nama_umkm: form.nama_umkm.trim(),
        kategori_kebutuhan: form.kategori_kebutuhan,
        sisi: form.sisi,
        deskripsi: form.deskripsi.trim() || null,
        foto_produk: form.foto_produk,
        kontak_nama: form.kontak_nama.trim(),
        kontak_hp: form.kontak_hp.trim() || null,
        kontak_email: form.kontak_email.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        await mutasiWajibBaris(
          supabase
            .from('listing_umkm')
            .update(payload)
            .eq('id', editingId)
            .select('id'),
        );

        setUmkmList(prev => prev.map(l => l.id === editingId ? { ...l, ...payload } as UMKMListing : l));
        toast('UMKM berhasil diperbarui.', 'success');
      } else {
        const { data: inserted, error } = await supabase
          .from('listing_umkm')
          .insert({
            ...payload,
            status: 'draft',
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (error) throw error;

        if (inserted?.id) {
          const { error: consentError } = await supabase
            .from('consent_log')
            .insert({
              subjek_ref: inserted.id,
              tujuan: TUJUAN_CONSENT_KONTAK_PUBLIK,
              disetujui: true,
              versi_kebijakan: POLICY_VERSION,
            });
          if (consentError) {
            toast('Listing tersimpan, tetapi pencatatan persetujuan gagal. Catat ulang persetujuan pemilik.', 'warning');
          }
        }

        toast('UMKM berhasil ditambahkan.', 'success');
        await loadData();
      }

      setShowForm(false);
      setEditingId(null);
    } catch (e) {
      // MutasiError (edit) membawa pesan spesifik; galat insert (dilempar mentah) memakai teks lama.
      const pesan = `Gagal menyimpan data. ${pesanMutasi(e, 'Pastikan Anda memiliki akses admin.')}`;
      setFormError(pesan);
      toast(pesan, 'error');
      // Modal dibiarkan terbuka (isian tidak hilang); daftar di belakangnya dimuat ulang bila basi.
      if (perluMuatUlang(e)) void loadData();
    } finally {
      setSaving(false);
    }
  };

  const ownersFor = (listingId: string) => owners.filter(o => o.listing_id === listingId);

  const handleAddOwner = async (listingId: string) => {
    const email = ownerEmailInput.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_REGEX.test(email)) {
      toast('Format email tidak valid.', 'warning');
      return;
    }

    setOwnerSaving(true);
    try {
      const supabase = createClient();
      // mutasiInsert (BUKAN mutasiWajibBaris): ignoreDuplicates = ON CONFLICT DO NOTHING, jadi pemilik yang
      // sudah tertaut menghasilkan 0 baris TANPA error — itu sah (tujuan "tertaut" sudah tercapai). Penolakan
      // RLS pada INSERT tetap error 42501 -> mutasiInsert melempar, jadi tidak ada sukses palsu.
      await mutasiInsert(
        supabase
          .from('umkm_listing_owner')
          .upsert(
            { listing_id: listingId, email },
            { onConflict: 'listing_id,email', ignoreDuplicates: true },
          ),
      );

      setOwnerEmailInput('');
      toast(`Pemilik ${email} berhasil ditautkan.`, 'success');
      await loadData();
    } catch (e) {
      toast(`Gagal menautkan pemilik. ${pesanMutasi(e)}`, 'error');
    } finally {
      setOwnerSaving(false);
    }
  };

  const handleRemoveOwner = async (ownerId: string) => {
    if (!confirm('Hapus tautan pemilik ini? Pemilik tidak akan bisa mengedit listing lagi.')) return;

    try {
      const supabase = createClient();
      // 0 baris = pemilik MASIH bisa mengedit listing (RLS menolak diam-diam) -> wajib dianggap gagal.
      await mutasiWajibBaris(
        supabase
          .from('umkm_listing_owner')
          .delete()
          .eq('id', ownerId)
          .select('id'),
      );

      setOwners(prev => prev.filter(o => o.id !== ownerId));
      toast('Tautan pemilik berhasil dihapus.', 'success');
    } catch (e) {
      toast(`Gagal menghapus tautan pemilik. ${pesanMutasi(e)}`, 'error');
      if (perluMuatUlang(e)) await loadData();
    }
  };

  const handleSendEditLink = async (listing: UMKMListing) => {
    const listingOwners = ownersFor(listing.id);
    if (listingOwners.length === 0) {
      toast('Listing ini belum memiliki pemilik tertaut. Tautkan email pemilik terlebih dahulu.', 'warning');
      return;
    }

    setSendingLinkId(listing.id);
    try {
      const results = await Promise.all(
        listingOwners.map(async (owner) => {
          const res = await fetch('/api/umkm/request-edit-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ listing_id: listing.id, email: owner.email }),
          });
          return res.ok;
        }),
      );

      if (results.every(Boolean)) {
        toast(`Link edit berhasil dikirim ke ${listingOwners.length} pemilik.`, 'success');
      } else if (results.some(Boolean)) {
        toast('Sebagian link edit berhasil dikirim, sebagian gagal. Coba lagi untuk yang gagal.', 'warning');
      } else {
        toast('Gagal mengirim link edit. Layanan email mungkin belum dikonfigurasi.', 'error');
      }
    } catch {
      toast('Gagal mengirim link edit. Silakan coba lagi.', 'error');
    } finally {
      setSendingLinkId(null);
    }
  };

  const filtered = umkmList.filter((l) => {
    const matchSearch = l.nama_umkm.toLowerCase().includes(search.toLowerCase()) ||
      (l.deskripsi && l.deskripsi.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = filterStatus === 'semua' || l.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const pendingCount = umkmList.filter(l => l.status === 'pending_review').length;
  const viewedItem = viewingId ? umkmList.find(l => l.id === viewingId) : null;

  const statusNada = (status: string): NadaLencana =>
    status === 'published' ? 'sukses' : status === 'pending_review' ? 'peringatan' : 'netral';

  const statusBadgeLabel = (status: string) =>
    STATUS_LABELS[status] || status;

  return (
    <>
      <PageHeader
        title="Kelola UMKM"
        meta="Waktu ditampilkan dalam WIB"
        description="Review dan kelola listing Matchmaking UMKM">
        <div className={tampilan.baris1}>
          <Tombol varian="hantu" ukuran="kecil" type="button" onClick={loadData}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </Tombol>
          <Tombol varian="utama" ukuran="kecil" type="button" onClick={handleOpenCreate}>
            <Plus size={16} />
            Tambah UMKM
          </Tombol>
        </div>
      </PageHeader>

      <div className={tampilan.area2}>
        {!loadError && <div className={tampilan.statistik}>
          <KartuStatistik label="Total UMKM" nilai={umkmList.length} ikon={Store} memuat={loading} />
          <KartuStatistik label="Menunggu review" nilai={pendingCount} ikon={Clock} memuat={loading} />
          <KartuStatistik label="Published" nilai={umkmList.filter((l) => l.status === 'published').length} ikon={CheckCircle2} memuat={loading} />
        </div>}
        {!loading && !loadError && pendingCount > 0 && (
          <div className={tampilan.baris3}>
            <Clock size={18} className={tampilan.area4}  />
            <span><strong>{pendingCount}</strong> listing menunggu review Anda</span>
          </div>
        )}

        <div className={tampilan.baris5}>
          <div className={tampilan.area6}>
            <Search size={18} className={tampilan.area7}  />
            <input
              type="text"
              className={["form-input", tampilan.area8].filter(Boolean).join(' ')}
              placeholder="Cari nama UMKM..."
              aria-label="Cari listing"
              value={search}
              onChange={(e) => setSearch(e.target.value)}

            />
          </div>

          <div className={tampilan.baris9}>
            {['semua', 'pending_review', 'published', 'draft', 'nonaktif'].map((s) => (
              <Tombol
                key={s}
                varian={filterStatus === s ? 'utama' : 'sekunder'} ukuran="kecil" className={cn('', filterStatus === s ? '' : '')}
                aria-pressed={filterStatus === s}
                onClick={() => setFilterStatus(s)}>
                {s === 'semua' ? 'Semua' :
                  s === 'pending_review' ? `Pending (${pendingCount})` :
                    s.charAt(0).toUpperCase() + s.slice(1)}
              </Tombol>
            ))}
          </div>
        </div>

        <Kartu judul="Daftar UMKM" padding="tanpa">
        {loading ? <Skeleton bentuk="baris" jumlah={5} label="Memuat UMKM" /> : loadError ? (
          <Galat pesan={loadError} onRetry={() => { void loadData(); }} />
        ) : filtered.length === 0 ? (
          <StatusKosong ikon={Store} judul="Belum ada listing UMKM. Klik &quot;Tambah UMKM&quot; untuk menambahkan." />
        ) : (
          <Tabel caption="Daftar UMKM" baris={filtered} kunciBaris="id" kolom={[
{ kunci: 'kolom0', judul: "UMKM", judulBaris: true, render: (l) => (<><div>
                        <div className={tampilan.area12} >{l.nama_umkm}</div>
                        <div className={tampilan.area13}>
                          {l.deskripsi}
                        </div>
                      </div></>) },
{ kunci: 'kolom1', judul: "Kategori", render: (l) => (<><Lencana nada="netral">
                        {KATEGORI_UMKM[l.kategori_kebutuhan] || l.kategori_kebutuhan}
                      </Lencana></>) },
{ kunci: 'kolom2', judul: "Kontak", render: (l) => (<div className={tampilan.sel14}>{l.kontak_nama}</div>) },
{ kunci: 'kolom3', judul: "Pemilik (email)", render: (l) => (<div className={tampilan.sel15}>{ownersFor(l.id).length === 0 ? (
                        <span className={tampilan.teks16} >Belum ada</span>
                      ) : (
                        <div className={tampilan.baris17}>
                          {ownersFor(l.id).map(o => (
                            <span key={o.id} className={tampilan.teks18} >{o.email}</span>
                          ))}
                        </div>
                      )}</div>) },
{ kunci: 'kolom4', judul: "Tanggal", render: (l) => (<div className={tampilan.sel19}>{formatTanggal(l.created_at, { month: 'short' })}</div>) },
{ kunci: 'kolom5', judul: "Status", render: (l) => (<><Lencana nada={statusNada(l.status)}>
                        {statusBadgeLabel(l.status)}
                      </Lencana></>) },
{ kunci: 'kolom6', judul: "Aksi", render: (l) => (<><div className={tampilan.baris1}>
                        <Tombol
                          varian="hantu" ukuran="kecil" type="button"
                          title="Lihat"
                          onClick={() => { setOwnerEmailInput(''); setViewingId(l.id); }}>
                          <Eye size={14} />
                        </Tombol>
                        <Tombol
                          varian="hantu" ukuran="kecil" type="button"
                          title="Edit"
                          onClick={() => handleOpenEdit(l)}>
                          <Edit2 size={14} />
                        </Tombol>
                        {l.status === 'pending_review' && (
                          <>
                            <Tombol
                              varian="utama" ukuran="kecil" type="button"
                              title="Approve"
                              onClick={() => handleUpdateStatus(l.id, 'published')}>
                              <CheckCircle2 size={14} />
                            </Tombol>
                            <Tombol
                              varian="hantu" ukuran="kecil" className={["", tampilan.area20].filter(Boolean).join('')}
                              title="Tolak"

                              onClick={() => handleUpdateStatus(l.id, 'nonaktif')}>
                              <XCircle size={14} />
                            </Tombol>
                          </>
                        )}
                        {l.status === 'draft' && (
                          <Tombol
                            varian="utama" ukuran="kecil" type="button"
                            title="Publish"
                            onClick={() => handleUpdateStatus(l.id, 'published')}>
                            <CheckCircle2 size={14} /> Publish
                          </Tombol>
                        )}
                        {ownersFor(l.id).length > 0 && (
                          <Tombol
                            varian="hantu" ukuran="kecil" type="button"
                            title="Kirim Link Edit"
                            onClick={() => handleSendEditLink(l)}
                            disabled={sendingLinkId === l.id}>
                            {sendingLinkId === l.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Mail size={14} />}
                          </Tombol>
                        )}
                        <Tombol
                          varian="hantu" ukuran="kecil" className={["", tampilan.area20].filter(Boolean).join('')}
                          title="Hapus"

                          onClick={() => handleDelete(l.id)}>
                          <Trash2 size={14} />
                        </Tombol>
                      </div></>) }
]} />
        )}
        </Kartu>
      </div>

      {showForm && (
        <Dialog terbuka tutupDenganLatar judul={editingId ? 'Edit UMKM' : 'Tambah UMKM'} onTutup={handleCloseForm}>
            <form onSubmit={handleSubmitForm} className={tampilan.baris23}>
              <Field label="Nama UMKM" wajib>
                <input
                  id="admin-umkm-nama"
                  className="form-input"
                  value={form.nama_umkm}
                  onChange={e => setForm(f => ({ ...f, nama_umkm: e.target.value }))}
                  placeholder="Masukkan nama UMKM"
                  required
                />
              </Field>

              <Field label="Kategori Kebutuhan" wajib>
                <select
                  id="admin-umkm-kategori"
                  className="form-input"
                  value={form.kategori_kebutuhan}
                  onChange={e => setForm(f => ({ ...f, kategori_kebutuhan: e.target.value as KategoriUMKM }))}
                  required>
                  <option value="">Pilih kategori...</option>
                  {Object.entries(KATEGORI_UMKM).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Sisi" wajib>
                <select
                  id="admin-umkm-sisi"
                  className="form-input"
                  value={form.sisi}
                  onChange={e => setForm(f => ({ ...f, sisi: e.target.value as 'kebutuhan' | 'penawaran' }))}
                  required>
                  <option value="kebutuhan">Kebutuhan</option>
                  <option value="penawaran">Penawaran</option>
                </select>
              </Field>

              <Field label="Deskripsi">
                <textarea
                  id="admin-umkm-deskripsi"
                  className="form-input"
                  rows={6}
                  value={form.deskripsi}
                  onChange={e => setForm(f => ({ ...f, deskripsi: e.target.value }))}
                  placeholder="Deskripsi kebutuhan UMKM..."
                />
              </Field>

                <Field label="Nama Kontak" wajib>
                  <input
                    id="admin-umkm-kontak"
                    className="form-input"
                    value={form.kontak_nama}
                    onChange={e => setForm(f => ({ ...f, kontak_nama: e.target.value }))}
                    placeholder="Nama orang yang bisa dihubungi"
                    required
                  />
                </Field>

              <div className={tampilan.kisi24}>
                <Field label="No. HP / WhatsApp">
                  <input
                    id="admin-umkm-hp"
                    className="form-input"
                    value={form.kontak_hp}
                    onChange={e => setForm(f => ({ ...f, kontak_hp: e.target.value }))}
                    placeholder="08xxxxxxxxxx"
                  />
                </Field>
                <Field label="Email">
                  <input
                    id="admin-umkm-email"
                    className="form-input"
                    type="email"
                    value={form.kontak_email}
                    onChange={e => setForm(f => ({ ...f, kontak_email: e.target.value }))}
                    placeholder="email@contoh.com"
                  />
                </Field>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="admin-umkm-foto">Foto Produk</label>
                <input
                  id="admin-umkm-foto"
                  type="file"
                  accept="image/*"
                  multiple
                  className="form-input"
                  onChange={e => handlePhotoUpload(e.target.files)}
                  disabled={uploadingPhotos}
                />
                <span className="form-hint">Maksimal 8 foto, masing-masing maks 2MB</span>

                <div className={tampilan.baris25}>
                  <input
                    type="url"
                    className="form-input"
                    placeholder="…atau tempel tautan foto https://…"
                    value={tautanFoto}
                    onChange={e => setTautanFoto(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleTambahTautanFoto(); } }}
                    aria-label="Tautan foto"
                  />
                  <Tombol type="button" varian="sekunder" ukuran="kecil" onClick={handleTambahTautanFoto}>Tambah tautan</Tombol>
                </div>

                {uploadingPhotos && (
                  <div className={tampilan.baris26}>
                    <Loader2 size={16} className="animate-spin" />
                    Mengunggah foto...
                  </div>
                )}

                {form.foto_produk.length > 0 && (
                  <div className={tampilan.baris27}>
                    {form.foto_produk.map((url, index) => (
                      <div key={index} className={tampilan.area28}>
                        <FotoUmkm
                          src={url}
                          alt={`Foto ${index + 1}`}
                          width={80}
                          height={80}
                          className={tampilan.area29}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemovePhoto(index)}
                          className={tampilan.baris30}
                          aria-label="Hapus foto">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!editingId && (
                <div className="form-group">
                  <label
                    htmlFor="admin-umkm-consent"
                    className={tampilan.baris31}>
                    <input
                      id="admin-umkm-consent"
                      type="checkbox"
                      checked={consentChecked}
                      onChange={e => setConsentChecked(e.target.checked)}
                      className={tampilan.area32}
                    />
                    <span>
                      Pemilik listing menyetujui nama &amp; kontaknya ditampilkan kepada publik di halaman Matchmaking UMKM.
                    </span>
                  </label>
                </div>
              )}

              {formError && <p className="form-error">{formError}</p>}

              <div className={tampilan.baris33}>
                <Tombol type="button" varian="hantu" onClick={handleCloseForm}>
                  <X size={16} />
                  Batal
                </Tombol>
                <Tombol type="submit" varian="utama" disabled={saving || (!editingId && !consentChecked)}>
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </Tombol>
              </div>
            </form>
        </Dialog>
      )}

      {viewedItem && (
        <Dialog terbuka tutupDenganLatar judul={viewedItem.nama_umkm} onTutup={() => setViewingId(null)}>
            <div className={tampilan.baris34}>
              <div>
                <h3 className={tampilan.judul35}>
                  {viewedItem.nama_umkm}
                </h3>
                <div className={tampilan.baris9}>
                  <Lencana nada="netral">
                    {KATEGORI_UMKM[viewedItem.kategori_kebutuhan] || viewedItem.kategori_kebutuhan}
                  </Lencana>
                  <Lencana nada={statusNada(viewedItem.status)}>
                    {statusBadgeLabel(viewedItem.status)}
                  </Lencana>
                </div>
              </div>

            </div>

            {viewedItem.deskripsi && (
              <p className={tampilan.teks36}>
                {viewedItem.deskripsi}
              </p>
            )}

            {viewedItem.foto_produk && viewedItem.foto_produk.length > 0 && (
              <div className={tampilan.area37}>
                <div className={tampilan.area38} >Foto Produk</div>
                <div className={tampilan.kisi39}>
                  {viewedItem.foto_produk.map((url, index) => (
                    <FotoUmkm
                      key={index}
                      src={url}
                      alt={`Foto produk ${index + 1}`}
                      width={200}
                      height={200}
                      className={tampilan.area40}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className={tampilan.area41}>
              <div className={tampilan.area42} >Informasi Kontak</div>
              <div className={tampilan.baris43}>
                <div><strong>Nama:</strong> {viewedItem.kontak_nama}</div>
                {viewedItem.kontak_hp && (
                  <div>
                    <strong>HP:</strong>{' '}
                    <a href={waLink(viewedItem.kontak_hp)} target="_blank" rel="noopener noreferrer" className={tampilan.area44}>
                      {viewedItem.kontak_hp} (WhatsApp)
                    </a>
                  </div>
                )}
                {viewedItem.kontak_email && (
                  <div>
                    <strong>Email:</strong>{' '}
                    <a href={`mailto:${viewedItem.kontak_email}`} className={tampilan.area44}>
                      {viewedItem.kontak_email}
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div className={tampilan.area41}>
              <div className={tampilan.area42} >Pemilik Listing</div>
              {ownersFor(viewedItem.id).length === 0 ? (
                <p className={tampilan.teks45}>
                  Belum ada pemilik tertaut. Tautkan email agar pemilik bisa mengedit listing dan menerima inquiry.
                </p>
              ) : (
                <div className={tampilan.baris46}>
                  {ownersFor(viewedItem.id).map(o => (
                    <div key={o.id} className={tampilan.baris47}>
                      <span>{o.email}</span>
                      <Tombol
                        varian="hantu" ukuran="kecil" className={["", tampilan.area20].filter(Boolean).join('')}
                        title="Hapus tautan pemilik"

                        onClick={() => handleRemoveOwner(o.id)}>
                        <Trash2 size={14} />
                      </Tombol>
                    </div>
                  ))}
                </div>
              )}
              <div className={tampilan.baris1}>
                <input
                  className="form-input"
                  type="email"
                  placeholder="email-pemilik@contoh.com"
                  value={ownerEmailInput}
                  onChange={e => setOwnerEmailInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddOwner(viewedItem.id); } }}
                  aria-label="Email pemilik"
                />
                <Tombol
                  varian="utama" ukuran="kecil" type="button"
                  onClick={() => handleAddOwner(viewedItem.id)}
                  disabled={ownerSaving || !ownerEmailInput.trim()}>
                  {ownerSaving ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                  Tautkan
                </Tombol>
              </div>
              {ownersFor(viewedItem.id).length > 0 && (
                <Tombol
                  varian="sekunder" ukuran="kecil" className={["", tampilan.area48].filter(Boolean).join('')}

                  onClick={() => handleSendEditLink(viewedItem)}
                  disabled={sendingLinkId === viewedItem.id}>
                  {sendingLinkId === viewedItem.id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Mail size={14} />}
                  Kirim Link Edit ke Pemilik
                </Tombol>
              )}
            </div>

            <div className={tampilan.area41}>
              <div className={tampilan.area42} >Metadata</div>
              <div className={tampilan.baris43}>
                <div><strong>Dibuat:</strong> {formatTanggalWaktu(viewedItem.created_at)}</div>
                <div><strong>Diperbarui:</strong> {formatTanggalWaktu(viewedItem.updated_at)}</div>
              </div>
            </div>
        </Dialog>
      )}
    </>
  );
}
