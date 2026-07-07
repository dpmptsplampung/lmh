'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  FileText,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  ArrowLeft,
  Building2,
  Lock,
} from 'lucide-react';
import { APP_NAME } from '@/lib/constants';
import styles from './gallery.module.css';

// Demo data
const demoDocs = [
  { id: '1', judul: 'Profil Investasi Provinsi Lampung 2026', kategori: 'Profil Investasi', halaman: 24 },
  { id: '2', judul: 'Peta Potensi Industri Lampung Selatan', kategori: 'Potensi Daerah', halaman: 18 },
];

export default function GalleryPage() {
  const [selectedDoc, setSelectedDoc] = useState<typeof demoDocs[0] | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Disable right-click on the page
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return (
    <div className={styles.galleryPage} onContextMenu={handleContextMenu}>
      {/* Navbar */}
      <nav className={styles.galleryNav}>
        <Link href="/" className={styles.galleryNavBrand}>
          <Building2 size={20} style={{ color: 'var(--color-primary-600)' }} />
          {APP_NAME}
        </Link>
        <Link href="/" className={styles.galleryNavBack}>
          <ArrowLeft size={16} />
          Beranda
        </Link>
      </nav>

      {!selectedDoc ? (
        <>
          {/* Header */}
          <div className={styles.galleryHeader}>
            <h1 className={styles.galleryHeaderTitle}>
              <FileText size={36} style={{ display: 'inline', marginRight: '12px', verticalAlign: 'middle' }} />
              Investment Gallery
            </h1>
            <p className={styles.galleryHeaderDesc}>
              Dokumen profil investasi dan potensi ekonomi Provinsi Lampung.
              Tersedia untuk dilihat secara daring.
            </p>
          </div>

          {/* Document Grid */}
          <div className={styles.galleryBody}>
            <div className={styles.docGrid}>
              {demoDocs.map((doc) => (
                <button
                  key={doc.id}
                  className={styles.docCard}
                  onClick={() => { setSelectedDoc(doc); setCurrentPage(1); }}
                >
                  <div className={styles.docCardPreview}>
                    <FileText size={48} />
                  </div>
                  <div className={styles.docCardInfo}>
                    <span className={styles.docCardCategory}>{doc.kategori}</span>
                    <h3 className={styles.docCardTitle}>{doc.judul}</h3>
                    <p className={styles.docCardMeta}>
                      {doc.halaman} halaman
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        /* Viewer */
        <div className={styles.viewer}>
          <div className={styles.viewerToolbar}>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setSelectedDoc(null)}
            >
              <ArrowLeft size={16} />
              Kembali
            </button>
            <span className={styles.viewerTitle}>{selectedDoc.judul}</span>
            <div className={styles.viewerControls}>
              <div className={styles.viewerPagination}>
                <button
                  className="btn btn--ghost btn--icon btn--sm"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft size={18} />
                </button>
                <span className={styles.viewerPageInfo}>
                  {currentPage} / {selectedDoc.halaman}
                </span>
                <button
                  className="btn btn--ghost btn--icon btn--sm"
                  onClick={() => setCurrentPage(Math.min(selectedDoc.halaman, currentPage + 1))}
                  disabled={currentPage === selectedDoc.halaman}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className={styles.viewerCanvas}>
            {/* Placeholder for rendered page image */}
            <div className={styles.viewerPage}>
              <div className={styles.viewerPagePlaceholder}>
                <Lock size={24} style={{ marginBottom: '8px' }} />
                <p>Halaman {currentPage}</p>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  Konten akan ditampilkan sebagai gambar (bukan PDF)
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
