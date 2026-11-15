'use client';

import Field from '@/components/ui/Field';

import Tombol from '@/components/ui/Tombol';
import DialogKonfirmasi from '@/components/ui/DialogKonfirmasi';
import Tabel from '@/components/ui/Tabel';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import Lencana from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Galat from '@/components/ui/Galat';

import tampilan from './page.dasbor.module.css';

// WP-27 / BOT-01..10: Admin page for managing RAG regulatory documents.
// Staff paste plain text; system chunks and embeds for bot retrieval (BOT-07).
// Embedding is triggered via /api/admin/dokumen/embed route.

import { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, Trash2, RefreshCw, BookOpen, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { formatTanggal } from '@/lib/utils';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { KUNCI_REFERENSI, muatLayananRingkas, type LayananRingkas } from '@/lib/data/referensi';
import { useReferensi } from '@/lib/data/klien/useReferensi';
import { mutasiInsert, mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { useToast } from '@/components/Toast';

interface DokumenRow {
  id: string;
  judul: string;
  nomor: string | null;
  jenis: string;
  status: 'berlaku' | 'dicabut';
  sumber_url: string | null;
  created_at: string;
  layanan?: { nama: string } | null;
  _potongan_count?: number;
}

const LAYANAN_KOSONG: LayananRingkas[] = [];

export default function AdminDokumenPage() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<DokumenRow[]>([]);
  // Pilihan Layanan di formulir = referensi bersama (cache memori). Gagal memuat = pilihan kosong (seperti sebelumnya).
  const layananList = useReferensi(KUNCI_REFERENSI.layananRingkas, () => muatLayananRingkas(createClient())).data ?? LAYANAN_KOSONG;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [embedding, setEmbedding] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    judul: '', nomor: '', jenis: 'peraturan', status: 'berlaku',
    sumber_url: '', teks_utama: '', layanan_id: '',
  });

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('dokumen_peraturan')
        // Kolom daftar saja (= DokumenRow): `teks_utama` besar (seluruh isi peraturan) tidak dibaca daftar.
        .select('id, judul, nomor, jenis, status, sumber_url, created_at, layanan:layanan_id(nama)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      // Relasi many-to-one: layanan berupa objek di runtime; tipe hasil select menebaknya sebagai array.
      setDocs((data ?? []) as unknown as DokumenRow[]);
      setLoadError('');
    } catch {
      setLoadError('Gagal memuat dokumen');
      toast('Gagal memuat dokumen', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDocs();
  }, [loadDocs]);

  const handleSimpan = async () => {
    if (!form.judul.trim() || !form.teks_utama.trim()) {
      toast('Judul dan teks wajib diisi', 'error');
      return;
    }
    try {
      const supabase = createClient();
      await mutasiInsert(
        supabase.from('dokumen_peraturan').insert({
          judul: form.judul.trim(),
          nomor: form.nomor.trim() || null,
          jenis: form.jenis,
          status: form.status,
          sumber_url: form.sumber_url.trim() || null,
          teks_utama: form.teks_utama.trim(),
          layanan_id: form.layanan_id || null,
        }),
      );
      toast('Dokumen disimpan', 'success');
      setShowForm(false);
      setForm({ judul: '', nomor: '', jenis: 'peraturan', status: 'berlaku', sumber_url: '', teks_utama: '', layanan_id: '' });
      await loadDocs();
    } catch (e: unknown) {
      toast(pesanMutasi(e, 'Gagal menyimpan'), 'error');
    }
  };

  const handleEmbed = async (docId: string) => {
    setEmbedding(docId);
    try {
      const res = await fetch('/api/admin/dokumen/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dokumen_id: docId }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      toast(`Embedding selesai: ${json.potongan} potongan`, 'success');
      await loadDocs();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Gagal embedding', 'error');
    } finally {
      setEmbedding(null);
    }
  };

  const [cabutId, setCabutId] = useState<{ id: string } | null>(null);
  const [mencabut, setMencabut] = useState(false);

  const handleCabut = async (docId: string) => {
    setMencabut(true);
    const supabase = createClient();
    try {
      // Audit T2c: tanpa pemeriksaan, jaringan putus / RLS menolak (0 baris) tetap berujung toast sukses
      // dan bot RAG terus mengutip dokumen yang dikira sudah dicabut.
      await mutasiWajibBaris(
        supabase.from('dokumen_peraturan').update({ status: 'dicabut' }).eq('id', docId).select('id'),
      );
      toast('Dokumen ditandai dicabut', 'success');
    } catch (e) {
      toast(pesanMutasi(e, 'Gagal mencabut dokumen'), 'error');
    }
    // Dimuat ulang di jalur sukses DAN gagal agar tampilan selalu sama dengan keadaan server.
    await loadDocs();
    setMencabut(false);
    setCabutId(null);
  };

  const jenisLabel: Record<string, string> = {
    peraturan: 'Peraturan',
    sop: 'SOP',
    maklumat: 'Maklumat',
    standar_pelayanan: 'Standar Pelayanan',
  };

  const berlakuCount = docs.filter(d => d.status === 'berlaku').length;
  const dicabutCount = docs.filter(d => d.status === 'dicabut').length;

  return (
    <>
      <DialogKonfirmasi
        terbuka={!!cabutId}
        judul="Tandai dokumen ini sebagai dicabut?"
        deskripsi="Bot tidak akan mengutipnya lagi."
        labelSetuju="Ya, cabut"
        berbahaya
        memuat={mencabut}
        onSetuju={() => { if (cabutId) void handleCabut(cabutId.id); }}
        onBatal={() => { if (!mencabut) setCabutId(null); }}
      />
      <PageHeader meta="Tanggal ditampilkan dalam WIB" title='Dokumen Peraturan' description='Kelola dokumen sumber untuk bot RAG (BOT-01..10)'>
        <Tombol varian="hantu" ukuran="kecil" type="button" onClick={loadDocs}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </Tombol>
        <Tombol varian="utama" ukuran="kecil" type="button" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> {showForm ? 'Tutup' : 'Tambah Dokumen'}
        </Tombol>
      </PageHeader>

      <div className={tampilan.area1}>
        {!loadError && <div className={tampilan.statistik}>
          <KartuStatistik label="Dokumen Berlaku" nilai={berlakuCount} ikon={CheckCircle2} memuat={loading} />
          <KartuStatistik label="Dicabut" nilai={dicabutCount} ikon={AlertCircle} memuat={loading} />
          <KartuStatistik label="Total Dokumen" nilai={docs.length} ikon={BookOpen} memuat={loading} />
        </div>}

        {/* Add form */}
        {showForm && (
          <Kartu judul="Tambah Dokumen Baru" className={tampilan.formDokumen}>
            <div className={tampilan.kisi7}>
              <Field label="Judul" wajib>
                <input id='dok-judul' className='form-input' value={form.judul} onChange={e => setForm(f => ({ ...f, judul: e.target.value }))} placeholder='Judul dokumen' />
              </Field>
              <Field label="Nomor">
                <input id='dok-nomor' className='form-input' value={form.nomor} onChange={e => setForm(f => ({ ...f, nomor: e.target.value }))} placeholder='Nomor peraturan' />
              </Field>
              <Field label="Jenis">
                <select id='dok-jenis' className='form-input' value={form.jenis} onChange={e => setForm(f => ({ ...f, jenis: e.target.value }))}>
                  <option value='peraturan'>Peraturan</option>
                  <option value='sop'>SOP</option>
                  <option value='maklumat'>Maklumat</option>
                  <option value='standar_pelayanan'>Standar Pelayanan</option>
                </select>
              </Field>
              <Field label="Status">
                <select id='dok-status' className='form-input' value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value='berlaku'>Berlaku</option>
                  <option value='dicabut'>Dicabut</option>
                </select>
              </Field>
              <Field label="Layanan Terkait">
                <select id='dok-layanan' className='form-input' value={form.layanan_id} onChange={e => setForm(f => ({ ...f, layanan_id: e.target.value }))}>
                  <option value=''>— Umum —</option>
                  {layananList.map(l => (
                    <option key={l.id} value={l.id}>{l.nama}</option>
                  ))}
                </select>
              </Field>
              <Field label="URL Sumber">
                <input id='dok-sumber' className='form-input' type='url' value={form.sumber_url} onChange={e => setForm(f => ({ ...f, sumber_url: e.target.value }))} placeholder='https://...' />
              </Field>
            </div>
            <div className={["form-group", tampilan.area8].filter(Boolean).join(' ')}>
              <label className='form-label form-label--required' htmlFor='dok-teks'>Teks Utama</label>
              <textarea
                id='dok-teks'
                className={["form-input", tampilan.area9].filter(Boolean).join(' ')}
                rows={10}
                value={form.teks_utama}
                onChange={e => setForm(f => ({ ...f, teks_utama: e.target.value }))}
                placeholder='Paste teks lengkap peraturan / SOP di sini. Sistem akan otomatis memotong dan mengembedding untuk bot RAG.'

              />
              <span className='form-hint'>Teks ini akan di-chunk dan di-embed ke vektor database (BOT-07). Gunakan format plain text.</span>
            </div>
            <div className={tampilan.baris10}>
              <Tombol varian="hantu" type="button" onClick={() => setShowForm(false)}>Batal</Tombol>
              <Tombol varian="utama" type="button" onClick={handleSimpan}>
                <FileText size={16} /> Simpan Dokumen
              </Tombol>
            </div>
          </Kartu>
        )}

        {/* Table */}
        <Kartu judul="Daftar dokumen" padding="tanpa">
        {loading ? <Skeleton bentuk="baris" jumlah={5} label="Memuat dokumen" /> : loadError ? (
          <Galat pesan={loadError} onRetry={() => { void loadDocs(); }} />
        ) : (
          <Tabel caption="Daftar dokumen peraturan" baris={docs} kunciBaris="id" kosong={<StatusKosong ikon={FileText} judul="Belum ada dokumen. Klik &quot;Tambah Dokumen&quot; untuk menambahkan." />} kolom={[
{ kunci: 'kolom0', judul: "Dokumen", judulBaris: true, render: (doc) => (<><div className={tampilan.baris13}>
                        <FileText size={18} className={tampilan.area14}  />
                        <div>
                          <span className={tampilan.teks15} >{doc.judul}</span>
                          {doc.nomor && (
                            <p className={tampilan.teks16} >{doc.nomor}</p>
                          )}
                        </div>
                      </div></>) },
{ kunci: 'kolom1', judul: "Jenis", render: (doc) => (<><Lencana nada="netral">{jenisLabel[doc.jenis] ?? doc.jenis}</Lencana></>) },
{ kunci: 'kolom2', judul: "Layanan", render: (doc) => (<div className={tampilan.sel17}>{doc.layanan?.nama ?? <span className={tampilan.teks18} >Umum</span>}</div>) },
{ kunci: 'kolom3', judul: "Status", render: (doc) => (<>{doc.status === 'berlaku' ? (
                        <Lencana nada="sukses">
                          <CheckCircle2 size={12} className={tampilan.area19}  />
                          Berlaku
                        </Lencana>
                      ) : (
                        <Lencana nada="netral">
                          <AlertCircle size={12} className={tampilan.area19}  />
                          Dicabut
                        </Lencana>
                      )}</>) },
{ kunci: 'kolom4', judul: "Dibuat", render: (doc) => (<div className={tampilan.sel20}><Clock size={12} className={tampilan.area19}  />{formatTanggal(doc.created_at, { month: 'short' })}</div>) },
{ kunci: 'kolom5', judul: "Aksi", render: (doc) => (<><div className={tampilan.baris21}>
                        <Tombol
                          varian="hantu" ukuran="kecil" type="button"
                          title='Embed ke vektor DB'
                          disabled={embedding === doc.id}
                          onClick={() => handleEmbed(doc.id)}>
                          {embedding === doc.id
                            ? <RefreshCw size={14} className='animate-spin' />
                            : <BookOpen size={14} />}
                        </Tombol>
                        {doc.status === 'berlaku' && (
                          <Tombol
                            varian="hantu" ukuran="kecil" className={["", tampilan.area22].filter(Boolean).join('')}
                            title='Cabut dokumen'

                            onClick={() => setCabutId({ id: doc.id })}>
                            <Trash2 size={14} />
                          </Tombol>
                        )}
                      </div></>) }
]} />
        )}
        </Kartu>
      </div>
    </>
  );
}
