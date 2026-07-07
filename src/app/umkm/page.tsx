'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Store,
  Search,
  User,
  Phone,
  ArrowLeft,
  Building2,
} from 'lucide-react';
import { KATEGORI_UMKM, type KategoriUMKM, APP_NAME } from '@/lib/constants';
import { cn, waLink } from '@/lib/utils';
import styles from './umkm.module.css';

// Demo data
const demoListings = [
  {
    id: '1',
    nama_umkm: 'Keripik Pisang Ibu Ani',
    kategori: 'pemasaran' as KategoriUMKM,
    deskripsi: 'Mencari mitra pemasaran untuk keripik pisang khas Lampung. Produksi sudah stabil dengan kapasitas 500kg/bulan, butuh channel distribusi lebih luas ke luar Lampung.',
    kontak_nama: 'Ani Susanti',
    kontak_hp: '081234567890',
  },
  {
    id: '2',
    nama_umkm: 'CV Maju Bersama',
    kategori: 'bahan_baku' as KategoriUMKM,
    deskripsi: 'Membutuhkan supplier kopi robusta grade A dari daerah Tanggamus atau Lampung Barat. Kebutuhan 2 ton/bulan untuk kebutuhan ekspor.',
    kontak_nama: 'Budi Hartono',
    kontak_hp: '087654321000',
  },
  {
    id: '3',
    nama_umkm: 'Tapis Lampung Ethnic',
    kategori: 'modal' as KategoriUMKM,
    deskripsi: 'Butuh modal untuk mesin tenun baru dan pelatihan pengrajin. Sudah punya 5 pengrajin aktif, demand meningkat 200% dalam setahun terakhir.',
    kontak_nama: 'Rina Wati',
    kontak_hp: '082345678901',
  },
  {
    id: '4',
    nama_umkm: 'Kopi Lampung Jaya',
    kategori: 'kemitraan' as KategoriUMKM,
    deskripsi: 'Mencari investor atau mitra untuk membuka kedai kopi di area strategis Bandar Lampung. Punya brand kuat di level lokal.',
    kontak_nama: 'Dedi Kurniawan',
    kontak_hp: '089876543210',
  },
  {
    id: '5',
    nama_umkm: 'Batik Tulang Bawang',
    kategori: 'pelatihan' as KategoriUMKM,
    deskripsi: 'Membutuhkan pelatihan pewarnaan alam untuk motif batik Tulang Bawang. Ingin meningkatkan nilai jual produk ke pasar premium.',
    kontak_nama: 'Sari Mutiara',
    kontak_hp: '081112223334',
  },
  {
    id: '6',
    nama_umkm: 'UD Sumber Makmur',
    kategori: 'peralatan' as KategoriUMKM,
    deskripsi: 'Butuh mesin pengolahan lada putih kapasitas industri. Saat ini masih menggunakan metode tradisional yang lambat.',
    kontak_nama: 'Hasan Ibrahim',
    kontak_hp: '085556667778',
  },
];

export default function UMKMPage() {
  const [search, setSearch] = useState('');
  const [activeKategori, setActiveKategori] = useState<string>('semua');

  const filtered = demoListings.filter((l) => {
    const matchSearch = l.nama_umkm.toLowerCase().includes(search.toLowerCase()) ||
      l.deskripsi.toLowerCase().includes(search.toLowerCase());
    const matchKategori = activeKategori === 'semua' || l.kategori === activeKategori;
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
          <Building2 size={20} style={{ color: 'var(--color-primary-600)' }} />
          {APP_NAME}
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
          Matchmaking UMKM
        </h1>
        <p className={styles.umkmHeaderDesc}>
          Platform penghubung kebutuhan UMKM Lampung — temukan mitra, supplier,
          investor, atau peluang pelatihan yang tepat.
        </p>
      </div>

      {/* Body */}
      <div className={styles.umkmBody}>
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
        <div className={styles.listingGrid}>
          {filtered.map((listing) => (
            <div key={listing.id} className={styles.listingCard}>
              <div className={styles.listingImage}>
                <Store size={40} />
              </div>
              <div className={styles.listingBody}>
                <span className={styles.listingCategory}>
                  {KATEGORI_UMKM[listing.kategori]}
                </span>
                <h3 className={styles.listingName}>{listing.nama_umkm}</h3>
                <p className={styles.listingDesc}>{listing.deskripsi}</p>
                <div className={styles.listingFooter}>
                  <span className={styles.listingContact}>
                    <User size={14} />
                    {listing.kontak_nama}
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
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="empty-state">
            <Store size={48} className="empty-state__icon" />
            <h3 className="empty-state__title">Belum Ada Listing</h3>
            <p>Tidak ada UMKM yang sesuai dengan filter Anda.</p>
          </div>
        )}
      </div>
    </div>
  );
}
