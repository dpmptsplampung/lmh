'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import {
  Store,
  Search,
  User,
  ArrowLeft,
  Building2,
  MapPin,
  MessageSquare,
  ShieldCheck,
  Mail,
  X,
  Loader2,
  CheckCircle2,
  Send,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { KATEGORI_UMKM, type KategoriUMKM } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import styles from './umkm.module.css';

interface UMKMListing {
  id: string;
  nama_umkm: string;
  kategori_kebutuhan: string;
  deskripsi: string | null;
  kontak_nama: string | null;
  foto_produk: string[] | null;
  status: string;
  sisi: string;
  created_at: string;
  image: string | null;
}

interface UMKMMatch {
  kebutuhan_id: string;
  kebutuhan_nama: string;
  kategori: string;
  kebutuhan_deskripsi: string | null;
  penawaran_id: string;
  penawaran_nama: string;
  penawaran_deskripsi: string | null;
}

type SisiTab = 'kebutuhan' | 'penawaran' | 'match';

const bankLampungBranches = [
  { nama: 'Kantor Cabang Utama Bandar Lampung', alamat: 'Jl. Wolter Monginsidi No.182, Bandar Lampung' },
  { nama: 'Kantor Cabang Metro', alamat: 'Jl. Jend. Sudirman No. 12, Metro' },
  { nama: 'Kantor Cabang Kalianda', alamat: 'Jl. Raden Intan No. 55, Kalianda' },
  { nama: 'Kantor Cabang Kotabumi', alamat: 'Jl. Jend. Sudirman No. 240, Kotabumi' },
];

function LoginNotice() {
  const searchParams = useSearchParams();
  const showLoginNotice = searchParams?.get('edit_login_required') === '1';
  if (!showLoginNotice) return null;
  return (
    <div className={styles.loginNotice}>
      <Mail size={18} />
      <span>
        Anda perlu membuka link edit yang dikirim ke email pemilik listing untuk masuk.
        Minta link edit baru di bawah jika diperlukan.
      </span>
    </div>
  );
}

export default function UMKMPage() {
  const [activeTab, setActiveTab] = useState<'matchmaking' | 'pembiayaan'>('matchmaking');
  const [sisiTab, setSisiTab] = useState<SisiTab>('kebutuhan');
  const [search, setSearch] = useState('');
  const [activeKategori, setActiveKategori] = useState<string>('semua');
  const [listings, setListings] = useState<UMKMListing[]>([]);
  const [matches, setMatches] = useState<UMKMMatch[]>([]);
  const [loading, setLoading] = useState(true);

  const [editModalListing, setEditModalListing] = useState<UMKMListing | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editSending, setEditSending] = useState(false);
  const [editSent, setEditSent] = useState(false);

  const [inquiryModalListing, setInquiryModalListing] = useState<UMKMListing | null>(null);
  const [inquiryForm, setInquiryForm] = useState({ from_nama: '', from_email: '', pesan: '' });
  const [inquirySending, setInquirySending] = useState(false);
  const [inquiryResult, setInquiryResult] = useState<
    { kind: 'success'; message: string } | { kind: 'error'; message: string } | null
  >(null);

  useEffect(() => {
    async function fetchListings() {
      setLoading(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('listing_umkm')
          .select('id, nama_umkm, kategori_kebutuhan, deskripsi, kontak_nama, foto_produk, status, sisi, created_at')
          .eq('status', 'published')
          .order('created_at', { ascending: false });

        if (data && data.length > 0) {
          setListings(data.map((l) => {
            const row = l as Record<string, unknown>;
            const foto = row.foto_produk as string[] | null;
            return {
              id: row.id as string,
              nama_umkm: row.nama_umkm as string,
              kategori_kebutuhan: row.kategori_kebutuhan as string,
              deskripsi: (row.deskripsi as string) ?? null,
              kontak_nama: (row.kontak_nama as string) ?? null,
              foto_produk: foto ?? null,
              status: row.status as string,
              sisi: (row.sisi as string) ?? 'kebutuhan',
              created_at: row.created_at as string,
              image: (foto && Array.isArray(foto) && foto.length > 0) ? foto[0] : null,
            };
          }));
        } else {
          setListings([]);
        }
      } catch (e) {
        console.error('Error fetching UMKM listings:', e);
        setListings([]);
      } finally {
        setLoading(false);
      }
    }
    fetchListings();
  }, []);

  useEffect(() => {
    async function fetchMatches() {
      if (sisiTab !== 'match') return;
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('v_umkm_match')
          .select('kebutuhan_id, kebutuhan_nama, kategori, kebutuhan_deskripsi, penawaran_id, penawaran_nama, penawaran_deskripsi')
          .order('kategori', { ascending: true });

        if (data && data.length > 0) {
          setMatches(data.map((m) => {
            const row = m as Record<string, unknown>;
            return {
              kebutuhan_id: row.kebutuhan_id as string,
              kebutuhan_nama: row.kebutuhan_nama as string,
              kategori: row.kategori as string,
              kebutuhan_deskripsi: (row.kebutuhan_deskripsi as string) ?? null,
              penawaran_id: row.penawaran_id as string,
              penawaran_nama: row.penawaran_nama as string,
              penawaran_deskripsi: (row.penawaran_deskripsi as string) ?? null,
            };
          }));
        } else {
          setMatches([]);
        }
      } catch (e) {
        console.error('Error fetching UMKM matches:', e);
        setMatches([]);
      }
    }
    fetchMatches();
  }, [sisiTab]);

  const filtered = listings.filter((l) => {
    if (sisiTab !== 'kebutuhan' && sisiTab !== 'penawaran') return false;
    if (l.sisi !== sisiTab) return false;
    const matchSearch = l.nama_umkm.toLowerCase().includes(search.toLowerCase()) ||
      (l.deskripsi && l.deskripsi.toLowerCase().includes(search.toLowerCase()));
    const matchKategori = activeKategori === 'semua' || l.kategori_kebutuhan === activeKategori;
    return matchSearch && matchKategori;
  });

  const filteredMatches = matches.filter((m) => {
    const matchKategori = activeKategori === 'semua' || m.kategori === activeKategori;
    const matchSearch = !search ||
      m.kebutuhan_nama.toLowerCase().includes(search.toLowerCase()) ||
      m.penawaran_nama.toLowerCase().includes(search.toLowerCase());
    return matchKategori && matchSearch;
  });

  const openEditModal = (listing: UMKMListing) => {
    setEditModalListing(listing);
    setEditEmail('');
    setEditSent(false);
  };

  const closeEditModal = () => {
    setEditModalListing(null);
    setEditEmail('');
    setEditSent(false);
  };

  const submitEditRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalListing) return;
    setEditSending(true);
    setEditSent(false);
    try {
      await fetch('/api/umkm/request-edit-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: editModalListing.id, email: editEmail }),
      });
      setEditSent(true);
    } catch {
      setEditSent(true);
    } finally {
      setEditSending(false);
    }
  };

  const openInquiryModal = (listing: UMKMListing) => {
    setInquiryModalListing(listing);
    setInquiryForm({ from_nama: '', from_email: '', pesan: '' });
    setInquiryResult(null);
  };

  const closeInquiryModal = () => {
    setInquiryModalListing(null);
    setInquiryForm({ from_nama: '', from_email: '', pesan: '' });
    setInquiryResult(null);
  };

  const submitInquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inquiryModalListing) return;
    setInquirySending(true);
    setInquiryResult(null);
    try {
      const res = await fetch('/api/umkm/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: inquiryModalListing.id,
          from_email: inquiryForm.from_email,
          from_nama: inquiryForm.from_nama || undefined,
          pesan: inquiryForm.pesan,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setInquiryResult({ kind: 'success', message: json.message ?? 'Pesan terkirim.' });
      } else {
        setInquiryResult({
          kind: 'error',
          message: json?.error ?? 'Gagal mengirim pesan. Coba lagi.',
        });
      }
    } catch {
      setInquiryResult({
        kind: 'error',
        message: 'Gagal mengirim pesan. Periksa koneksi Anda.',
      });
    } finally {
      setInquirySending(false);
    }
  };

  return (
    <div className={styles.umkmPage}>
      <nav style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-3) var(--space-6)',
        background: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-default)',
      }}>
        <Link href="/" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          textDecoration: 'none',
          color: 'var(--text-primary)',
          fontWeight: 600,
          fontSize: 'var(--text-sm)',
        }}>
          <Image
            src="/logo.png"
            alt="Lampung Maju Hub Logo"
            width={100}
            height={40}
            style={{ objectFit: 'contain' }}
            priority
          />
        </Link>
        <Link href="/" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
          textDecoration: 'none',
        }}>
          <ArrowLeft size={16} />
          Beranda
        </Link>
      </nav>

      <div className={styles.umkmHeader}>
        <h1 className={styles.umkmHeaderTitle}>
          <Store size={36} style={{ display: 'inline', marginRight: '12px', verticalAlign: 'middle' }} />
          Matchmaking UMKM & Pembiayaan
        </h1>
        <p className={styles.umkmHeaderDesc}>
          Platform penghubung kebutuhan UMKM Lampung — temukan kemitraan bisnis dan dapatkan akses pembiayaan modal usaha terbaik.
        </p>
      </div>

      <div className={styles.umkmBody}>

        <Suspense fallback={null}>
          <LoginNotice />
        </Suspense>

        <div className={styles.tabContainer}>
          <button
            type="button"
            className={cn(styles.tabButton, activeTab === 'matchmaking' && styles.tabButtonActive)}
            onClick={() => setActiveTab('matchmaking')}
          >
            Matchmaking Kemitraan
          </button>
          <button
            type="button"
            className={cn(styles.tabButton, activeTab === 'pembiayaan' && styles.tabButtonActive)}
            onClick={() => setActiveTab('pembiayaan')}
          >
            Pembiayaan UMKM
          </button>
        </div>

        {activeTab === 'matchmaking' ? (
          <>
            <div className={styles.sisiToggle}>
              <button
                type="button"
                className={cn(styles.sisiToggleBtn, sisiTab === 'kebutuhan' && styles.sisiToggleBtnActive)}
                onClick={() => setSisiTab('kebutuhan')}
                aria-pressed={sisiTab === 'kebutuhan'}
              >
                <Search size={16} />
                Kebutuhan
              </button>
              <button
                type="button"
                className={cn(styles.sisiToggleBtn, sisiTab === 'penawaran' && styles.sisiToggleBtnActive)}
                onClick={() => setSisiTab('penawaran')}
                aria-pressed={sisiTab === 'penawaran'}
              >
                <Store size={16} />
                Penawaran
              </button>
              <button
                type="button"
                className={cn(styles.sisiToggleBtn, sisiTab === 'match' && styles.sisiToggleBtnActive)}
                onClick={() => setSisiTab('match')}
                aria-pressed={sisiTab === 'match'}
              >
                <Sparkles size={16} />
                Cocok (Match)
              </button>
            </div>

            {sisiTab !== 'match' && (
              <p className={styles.contactNote}>
                <ShieldCheck size={14} />
                Kontak pemilik ditampilkan setelah permintaan Anda disetujui.
              </p>
            )}

            {sisiTab === 'match' ? (
              <>
                <div className={styles.umkmFilters}>
                  <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
                    <Search size={18} style={{
                      position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)',
                      color: 'var(--text-tertiary)'
                    }} />
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Cari kebutuhan atau penawaran..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{ paddingLeft: '42px' }}
                      aria-label="Cari kebutuhan atau penawaran UMKM"
                    />
                  </div>
                </div>

                <div className={styles.categoryPills} style={{ marginBottom: 'var(--space-8)' }}>
                  <button
                    className={cn(styles.categoryPill, activeKategori === 'semua' && styles.categoryPillActive)}
                    onClick={() => setActiveKategori('semua')}
                  >
                    Semua
                  </button>
                  {Object.entries(KATEGORI_UMKM).map(([key, label]) => (
                    <button
                      key={key}
                      className={cn(styles.categoryPill, activeKategori === key && styles.categoryPillActive)}
                      onClick={() => setActiveKategori(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {loading ? (
                  <div className="empty-state">
                    <Loader2 size={48} className={styles.spinner} />
                    <h3 className="empty-state__title">Memuat pencocokan…</h3>
                  </div>
                ) : filteredMatches.length === 0 ? (
                  <div className="empty-state">
                    <Sparkles size={48} className="empty-state__icon" />
                    <h3 className="empty-state__title">Belum Ada Pasangan Match</h3>
                    <p>Belum ada pasangan kebutuhan + penawaran dalam kategori yang sama.</p>
                  </div>
                ) : (
                  <div className={styles.matchGrid}>
                    {filteredMatches.map((m) => {
                      const kategoriLabel = KATEGORI_UMKM[m.kategori as KategoriUMKM] || m.kategori;
                      return (
                        <div key={`${m.kebutuhan_id}-${m.penawaran_id}`} className={styles.matchCard}>
                          <span className={styles.matchCategory}>{kategoriLabel}</span>
                          <div className={styles.matchPair}>
                            <div className={styles.matchSide}>
                              <span className={styles.matchSideLabel}>
                                <Search size={12} /> Kebutuhan
                              </span>
                              <h4 className={styles.matchSideName}>{m.kebutuhan_nama}</h4>
                              {m.kebutuhan_deskripsi && (
                                <p className={styles.matchSideDesc}>{m.kebutuhan_deskripsi}</p>
                              )}
                            </div>
                            <ArrowRight size={20} className={styles.matchArrow} />
                            <div className={styles.matchSide}>
                              <span className={styles.matchSideLabel}>
                                <Store size={12} /> Penawaran
                              </span>
                              <h4 className={styles.matchSideName}>{m.penawaran_nama}</h4>
                              {m.penawaran_deskripsi && (
                                <p className={styles.matchSideDesc}>{m.penawaran_deskripsi}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={styles.umkmFilters}>
                  <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
                    <Search size={18} style={{
                      position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)',
                      color: 'var(--text-tertiary)'
                    }} />
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Cari UMKM atau kebutuhan..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{ paddingLeft: '42px' }}
                      aria-label="Cari UMKM atau kebutuhan"
                    />
                  </div>
                </div>

                <div className={styles.categoryPills} style={{ marginBottom: 'var(--space-8)' }}>
                  <button
                    className={cn(styles.categoryPill, activeKategori === 'semua' && styles.categoryPillActive)}
                    onClick={() => setActiveKategori('semua')}
                  >
                    Semua
                  </button>
                  {Object.entries(KATEGORI_UMKM).map(([key, label]) => (
                    <button
                      key={key}
                      className={cn(styles.categoryPill, activeKategori === key && styles.categoryPillActive)}
                      onClick={() => setActiveKategori(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {loading ? (
                  <div className="empty-state">
                    <Loader2 size={48} className={styles.spinner} />
                    <h3 className="empty-state__title">Memuat listing…</h3>
                  </div>
                ) : listings.length === 0 ? (
                  <div className="empty-state">
                    <Store size={48} className="empty-state__icon" />
                    <h3 className="empty-state__title">Belum ada listing UMKM tersedia</h3>
                    <p>Listing UMKM akan muncul di sini setelah diverifikasi oleh admin.</p>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="empty-state">
                    <Store size={48} className="empty-state__icon" />
                    <h3 className="empty-state__title">Belum Ada Listing</h3>
                    <p>Tidak ada UMKM yang sesuai dengan filter Anda.</p>
                  </div>
                ) : (
                  <div className={styles.listingGrid}>
                    {filtered.map((listing) => {
                      const kategoriLabel = KATEGORI_UMKM[listing.kategori_kebutuhan as KategoriUMKM] || listing.kategori_kebutuhan;
                      return (
                        <div key={listing.id} className={styles.listingCard}>
                          <div className={styles.listingImage}>
                            {listing.image ? (
                              <Image
                                src={listing.image}
                                alt={listing.nama_umkm}
                                fill
                                style={{ objectFit: 'cover' }}
                                unoptimized
                              />
                            ) : (
                              <Store size={40} />
                            )}
                          </div>
                          <div className={styles.listingBody}>
                            <div className={styles.listingTagRow}>
                              <span className={styles.listingCategory}>
                                {kategoriLabel}
                              </span>
                              <span className={cn(
                                styles.sisiBadge,
                                listing.sisi === 'penawaran' ? styles.sisiBadgePenawaran : styles.sisiBadgeKebutuhan,
                              )}>
                                {listing.sisi === 'penawaran' ? 'Penawaran' : 'Kebutuhan'}
                              </span>
                            </div>
                            <h3 className={styles.listingName}>{listing.nama_umkm}</h3>
                            {listing.deskripsi && (
                              <p className={styles.listingDesc}>{listing.deskripsi}</p>
                            )}
                            <div className={styles.listingFooter}>
                              <span className={styles.listingContact}>
                                <User size={14} />
                                {listing.kontak_nama || '—'}
                              </span>
                              <div className={styles.listingActions}>
                                <button
                                  type="button"
                                  className={styles.inquiryBtn}
                                  onClick={() => openInquiryModal(listing)}
                                  aria-label={`Kirim pesan ke pemilik ${listing.nama_umkm}`}
                                >
                                  <Send size={14} />
                                  Kirim Pesan
                                </button>
                                <button
                                  type="button"
                                  className={styles.editLinkBtn}
                                  onClick={() => openEditModal(listing)}
                                  aria-label={`Minta link edit untuk ${listing.nama_umkm}`}
                                >
                                  <Mail size={14} />
                                  Minta link edit
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <div className={styles.pembiayaanSection}>
            <div className={styles.pembiayaanGrid}>

              <div className={styles.pembiayaanCard}>
                <h2 className={styles.cardTitle}>
                  <ShieldCheck size={20} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'middle', color: 'var(--color-primary-600)' }} />
                  Overview & Syarat Pembiayaan
                </h2>

                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 'var(--space-5)' }}>
                  Pemerintah Provinsi Lampung bekerjasama dengan <strong>Bank Lampung</strong> menyediakan fasilitas permodalan Kredit Usaha Rakyat (KUR) dengan suku bunga bersubsidi untuk mendorong daya saing dan percepatan usaha UMKM lokal.
                </p>

                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>Syarat Dokumen Pengajuan:</h3>

                <ul className={styles.requirementList}>
                  <li>Memiliki usaha produktif dan layak yang telah berjalan minimal selama 6 (enam) bulan aktif.</li>
                  <li>Fotokopi KTP Elektronik Pemohon (Suami dan Istri jika sudah menikah).</li>
                  <li>Fotokopi Kartu Keluarga (KK) dan Surat Nikah/Cerai.</li>
                  <li>Surat Keterangan Usaha (SKU) dari Kelurahan/Kepala Desa setempat atau memiliki Nomor Induk Berusaha (NIB).</li>
                  <li>Fotokopi NPWP Aktif (khusus untuk plafon kredit di atas Rp 50 Juta).</li>
                  <li>Tidak sedang menikmati fasilitas kredit produktif (modal kerja/investasi) dari perbankan atau lembaga keuangan lain.</li>
                </ul>
              </div>

              <div className={styles.bankCallout}>
                <div className={styles.bankCalloutTitle}>
                  <Building2 size={24} />
                  <span>Akses Modal Bank Lampung</span>
                </div>

                <p className={styles.bankCalloutDesc}>
                  Konsultasikan kebutuhan permodalan usaha Anda secara instan dan dapatkan panduan langsung dari perwakilan Bank Lampung melalui chat interaktif kami.
                </p>

                <Link
                  href="/chat?layanan=Bank+Lampung"
                  className="btn btn--accent btn--lg"
                  style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}
                >
                  <MessageSquare size={18} />
                  Hubungi Bank Lampung (Live Chat)
                </Link>
              </div>
            </div>

            <div className={styles.branchSection}>
              <h2 className={styles.cardTitle} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <MapPin size={20} style={{ color: 'var(--color-primary-600)' }} />
                Kantor Cabang Terdekat Bank Lampung
              </h2>

              <div className={styles.branchGrid}>
                {bankLampungBranches.map((branch, i) => (
                  <div key={i} className={styles.branchCard}>
                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                      <div style={{ padding: '6px', borderRadius: '8px', background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
                        <Building2 size={16} />
                      </div>
                      <div>
                        <h4 className={styles.branchName}>{branch.nama}</h4>
                        <p className={styles.branchAddress}>{branch.alamat}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

      </div>

      {editModalListing && (
        <div
          className={styles.editModalOverlay}
          onClick={closeEditModal}
          role="dialog"
          aria-modal="true"
          aria-label="Minta link edit UMKM"
        >
          <div className={styles.editModal} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.editModalClose}
              onClick={closeEditModal}
              aria-label="Tutup"
            >
              <X size={18} />
            </button>

            {!editSent ? (
              <>
                <h3 className={styles.editModalTitle}>
                  <Mail size={20} />
                  Minta Link Edit
                </h3>
                <p className={styles.editModalListing}>
                  Untuk listing: <strong>{editModalListing.nama_umkm}</strong>
                </p>
                <p className={styles.editModalDesc}>
                  Masukkan email yang terdaftar sebagai pemilik listing. Jika email
                  terdaftar, kami akan mengirimkan link edit ke email tersebut.
                </p>
                <form className={styles.editModalForm} onSubmit={submitEditRequest}>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="email@pemilik-umkm.id"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    required
                    disabled={editSending}
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={editSending || !editEmail}
                  >
                    {editSending ? (
                      <>
                        <Loader2 size={16} className={styles.spinner} />
                        Mengirim…
                      </>
                    ) : (
                      'Kirim Link Edit'
                    )}
                  </button>
                </form>
              </>
            ) : (
              <div className={styles.editModalSuccess}>
                <CheckCircle2 size={32} />
                <h3>Permintaan Diterima</h3>
                <p>
                  Jika email Anda terdaftar sebagai pemilik, link edit telah dikirim
                  ke email tersebut. Periksa kotak masuk (dan folder spam) Anda.
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={closeEditModal}
                >
                  Tutup
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {inquiryModalListing && (
        <div
          className={styles.editModalOverlay}
          onClick={closeInquiryModal}
          role="dialog"
          aria-modal="true"
          aria-label="Kirim pesan ke pemilik listing UMKM"
        >
          <div className={styles.editModal} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.editModalClose}
              onClick={closeInquiryModal}
              aria-label="Tutup"
            >
              <X size={18} />
            </button>

            {!inquiryResult || inquiryResult.kind === 'error' ? (
              <>
                <h3 className={styles.editModalTitle}>
                  <Send size={20} />
                  Kirim Pesan
                </h3>
                <p className={styles.editModalListing}>
                  Untuk listing: <strong>{inquiryModalListing.nama_umkm}</strong>
                </p>
                <p className={styles.editModalDesc}>
                  Pesan Anda akan diteruskan ke pemilik listing. Kontak pemilik
                  akan dibagikan setelah permintaan Anda disetujui.
                </p>
                {inquiryResult?.kind === 'error' && (
                  <p className={styles.inquiryError}>{inquiryResult.message}</p>
                )}
                <form className={styles.editModalForm} onSubmit={submitInquiry}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Nama Anda (opsional)"
                    value={inquiryForm.from_nama}
                    onChange={(e) => setInquiryForm({ ...inquiryForm, from_nama: e.target.value })}
                    maxLength={200}
                    disabled={inquirySending}
                  />
                  <input
                    type="email"
                    className="form-input"
                    placeholder="Email Anda *"
                    value={inquiryForm.from_email}
                    onChange={(e) => setInquiryForm({ ...inquiryForm, from_email: e.target.value })}
                    required
                    disabled={inquirySending}
                  />
                  <textarea
                    className="form-input"
                    placeholder="Tulis pesan Anda… *"
                    value={inquiryForm.pesan}
                    onChange={(e) => setInquiryForm({ ...inquiryForm, pesan: e.target.value })}
                    required
                    maxLength={2000}
                    rows={4}
                    disabled={inquirySending}
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={inquirySending || !inquiryForm.from_email || !inquiryForm.pesan}
                  >
                    {inquirySending ? (
                      <>
                        <Loader2 size={16} className={styles.spinner} />
                        Mengirim…
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        Kirim Pesan
                      </>
                    )}
                  </button>
                </form>
              </>
            ) : (
              <div className={styles.editModalSuccess}>
                <CheckCircle2 size={32} />
                <h3>Pesan Terkirim</h3>
                <p>{inquiryResult.message}</p>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={closeInquiryModal}
                >
                  Tutup
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
