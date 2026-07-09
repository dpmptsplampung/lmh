'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Store,
  Search,
  User,
  Phone,
  ArrowLeft,
  Building2,
  MapPin,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { KATEGORI_UMKM, type KategoriUMKM } from '@/lib/constants';
import { cn, waLink } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import styles from './umkm.module.css';

interface UMKMListing {
  id: string;
  nama_umkm: string;
  kategori_kebutuhan: string;
  deskripsi: string | null;
  kontak_nama: string | null;
  kontak_hp: string | null;
  foto_produk: string[] | null;
  status: string;
  created_at: string;
  image: string | null;
}

const bankLampungBranches = [
  { nama: 'Kantor Cabang Utama Bandar Lampung', alamat: 'Jl. Wolter Monginsidi No.182, Bandar Lampung' },
  { nama: 'Kantor Cabang Metro', alamat: 'Jl. Jend. Sudirman No. 12, Metro' },
  { nama: 'Kantor Cabang Kalianda', alamat: 'Jl. Raden Intan No. 55, Kalianda' },
  { nama: 'Kantor Cabang Kotabumi', alamat: 'Jl. Jend. Sudirman No. 240, Kotabumi' },
];

export default function UMKMPage() {
  const [activeTab, setActiveTab] = useState<'matchmaking' | 'pembiayaan'>('matchmaking');
  const [search, setSearch] = useState('');
  const [activeKategori, setActiveKategori] = useState<string>('semua');
  const [listings, setListings] = useState<UMKMListing[]>([]);

  useEffect(() => {
    async function fetchListings() {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('listing_umkm')
          .select('id, nama_umkm, kategori_kebutuhan, deskripsi, kontak_nama, kontak_hp, foto_produk, status, created_at')
          .eq('status', 'published')
          .order('created_at', { ascending: false });

        if (data && data.length > 0) {
          setListings(data.map((l) => {
            const row = l as Record<string, unknown>;
            return {
              id: row.id as string,
              nama_umkm: row.nama_umkm as string,
              kategori_kebutuhan: row.kategori_kebutuhan as string,
              deskripsi: (row.deskripsi as string) ?? null,
              kontak_nama: (row.kontak_nama as string) ?? null,
              kontak_hp: (row.kontak_hp as string) ?? null,
              foto_produk: (row.foto_produk as string[]) ?? null,
              status: row.status as string,
              created_at: row.created_at as string,
              image: (row.foto_produk && Array.isArray(row.foto_produk) && row.foto_produk.length > 0) ? row.foto_produk[0] : null,
            };
          }));
        } else {
          setListings([]);
        }
      } catch (e) {
        console.error('Error fetching UMKM listings:', e);
        setListings([]);
      }
    }
    fetchListings();
  }, []);

  const filtered = listings.filter((l) => {
    const matchSearch = l.nama_umkm.toLowerCase().includes(search.toLowerCase()) ||
      (l.deskripsi && l.deskripsi.toLowerCase().includes(search.toLowerCase()));
    const matchKategori = activeKategori === 'semua' || l.kategori_kebutuhan === activeKategori;
    return matchSearch && matchKategori;
  });

  return (
    <div className={styles.umkmPage}>
      {/* Navbar */}
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

      {/* Header */}
      <div className={styles.umkmHeader}>
        <h1 className={styles.umkmHeaderTitle}>
          <Store size={36} style={{ display: 'inline', marginRight: '12px', verticalAlign: 'middle' }} />
          Matchmaking UMKM & Pembiayaan
        </h1>
        <p className={styles.umkmHeaderDesc}>
          Platform penghubung kebutuhan UMKM Lampung — temukan kemitraan bisnis dan dapatkan akses pembiayaan modal usaha terbaik.
        </p>
      </div>

      {/* Body */}
      <div className={styles.umkmBody}>

        {/* Tab Navigation */}
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
          /* TAB 1: MATCHMAKING KEMITRAAN */
          <>
            {/* Search */}
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
                />
              </div>
            </div>

            {/* Category Pills */}
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

            {/* Listing Grid */}
            {listings.length === 0 ? (
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
                        <span className={styles.listingCategory}>
                          {kategoriLabel}
                        </span>
                        <h3 className={styles.listingName}>{listing.nama_umkm}</h3>
                        {listing.deskripsi && (
                          <p className={styles.listingDesc}>{listing.deskripsi}</p>
                        )}
                        <div className={styles.listingFooter}>
                          <span className={styles.listingContact}>
                            <User size={14} />
                            {listing.kontak_nama || '—'}
                          </span>
                          {listing.kontak_hp && (
                            <a
                              href={waLink(listing.kontak_hp)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.contactBtn}
                            >
                              <Phone size={14} />
                              Hubungi
                            </a>
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
          /* TAB 2: PEMBIAYAAN UMKM */
          <div className={styles.pembiayaanSection}>
            <div className={styles.pembiayaanGrid}>

              {/* Syarat & Overview */}
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

              {/* Bank Callout Panel */}
              <div className={styles.bankCallout}>
                <div className={styles.bankCalloutTitle}>
                  <Building2 size={24} />
                  <span>Akses Modal Bank Lampung</span>
                </div>

                <p className={styles.bankCalloutDesc}>
                  Konsultasikan kebutuhan permodalan usaha Anda secara instan dan dapatkan panduan langsung dari perwakilan Bank Lampung melalui chat interaktif kami.
                </p>

                {/* Hubungi Bank Lampung (Livechat Integration) */}
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

            {/* Nearest Branch Section */}
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
    </div>
  );
}
