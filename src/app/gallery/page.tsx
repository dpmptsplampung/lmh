'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  FileText,
  ArrowLeft,
  ExternalLink,
  Info,
  X,
  FileCheck,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import styles from './gallery.module.css';

interface GalleryDoc {
  id: string;
  judul: string;
  kategori: string | null;
  urutan_tampil: number;
  file_path: string;
  jumlah_halaman: number;
  status: string;
  deskripsi: string | null;
  nilai_investasi: string | null;
  image_url: string | null;
}

export default function GalleryPage() {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [docs, setDocs] = useState<GalleryDoc[]>([]);
  const [foilaUrl, setFoilaUrl] = useState('https://invest.lampungprov.go.id/');
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingSignedUrl, setLoadingSignedUrl] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const supabase = createClient();

        const { data: documents } = await supabase
          .from('investment_documents')
          .select('id, judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url')
          .eq('status', 'aktif')
          .order('urutan_tampil', { ascending: true });

        if (documents && documents.length > 0) {
          setDocs(documents as GalleryDoc[]);
        } else {
          setDocs([]);
        }

        const { data: setting } = await supabase
          .from('site_settings')
          .select('value')
          .eq('key', 'foila_url')
          .single();
        if (setting?.value) {
          setFoilaUrl(setting.value);
        }
      } catch (e) {
        console.error('Error loading gallery data:', e);
        setDocs([]);
      }
    }
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedDocId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSignedUrl(null);
      return;
    }
    const selectedDoc = docs.find((d) => d.id === selectedDocId);
    if (!selectedDoc || !selectedDoc.file_path) {
      setSignedUrl(null);
      return;
    }
    let cancelled = false;
    setLoadingSignedUrl(true);
    setSignedUrl(null);
    fetch('/api/investment-docs/public-view?file_path=' + encodeURIComponent(selectedDoc.file_path))
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch signed URL');
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setSignedUrl(data.signedUrl);
      })
      .catch((e) => {
        console.error('Error fetching signed URL:', e);
        if (!cancelled) setSignedUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingSignedUrl(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDocId, docs]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const handleCloseViewer = () => {
    setSelectedDocId(null);
  };

  const getSelectedDocTitle = () => {
    const doc = docs.find((d) => d.id === selectedDocId);
    return doc?.judul || 'Dokumen Investasi';
  };

  return (
    <div className={styles.galleryPage} onContextMenu={handleContextMenu}>
      {/* Navbar */}
      <nav className={styles.galleryNav}>
        <Link href="/" className={styles.galleryNavBrand}>
          <Image
            src="/logo.png"
            alt="Lampung Maju Hub Logo"
            width={100}
            height={40}
            style={{ objectFit: 'contain' }}
            priority
          />
        </Link>
        <Link href="/" className={styles.galleryNavBack}>
          <ArrowLeft size={16} />
          Beranda
        </Link>
      </nav>

      {/* Header */}
      <div className={styles.galleryHeader}>
        <h1 className={styles.galleryHeaderTitle}>
          <FileText size={36} style={{ display: 'inline', marginRight: '12px', verticalAlign: 'middle', color: 'var(--color-primary-400)' }} />
          Investment Gallery
        </h1>
        <p className={styles.galleryHeaderDesc}>
          Galeri promosi komoditas unggulan dan peluang investasi Provinsi Lampung. Seluruh dokumen dilindungi hak cipta untuk kepentingan pameran daring (view only).
        </p>
      </div>

      {/* Body */}
      <div className={styles.galleryBody}>

        {/* TOP SECTION: PETA POTENSI & FOILA PORTAL */}
        <div className={styles.topGrid}>

          {/* Peta Potensi Investasi Card */}
          <div className={styles.petaCard} onClick={() => {
            const petaDoc = docs.find((d) => d.kategori === 'Peta Potensi' || d.judul.toLowerCase().includes('peta potensi'));
            if (petaDoc) setSelectedDocId(petaDoc.id);
          }}>
            <div className={styles.petaHeader}>
              <div className={styles.petaIcon}>
                <FileText size={24} />
              </div>
              <h3 className={styles.petaTitle}>Peta Potensi Investasi Daerah</h3>
            </div>
            <p className={styles.petaDesc}>
              Dokumen komprehensif memetakan sebaran komoditas perkebunan, pertanian, pertambangan, pariwisata, dan industri manufaktur strategis di 15 Kabupaten/Kota se-Provinsi Lampung.
            </p>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-primary-400)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              Buka Peta Potensi (PDF) &rarr;
            </span>
          </div>

          {/* FOILA Portal Link Card */}
          <div className={styles.foilaCard}>
            <div className={styles.foilaHeader}>
              <div className={styles.foilaIcon} style={{ background: 'transparent', padding: 0 }}>
                <Image
                  src="/logo_foila.webp"
                  alt="FOILA Logo"
                  width={100}
                  height={40}
                  style={{ objectFit: 'contain' }}
                />
              </div>
              <h3 className={styles.foilaTitle}>Portal FOILA (Fast Track)</h3>
            </div>
            <p className={styles.foilaDesc}>
              Masuk ke portal resmi Forum Investasi Lampung (FOILA) untuk mengakses direktori regulasi daerah, kalkulator investasi, insentif pajak daerah, dan pendampingan izin cepat.
            </p>
            <a
              href={foilaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.foilaLinkBtn}
            >
              Kunjungi Portal FOILA
              <ExternalLink size={14} />
            </a>
          </div>

        </div>

        {/* IPRO PROJECTS SECTION */}
        <div className={styles.iproSection}>
          <h2 className={styles.sectionTitle}>
            <TrendingUp size={20} style={{ color: 'var(--color-primary-400)' }} />
            Investment Project Ready to Offer (IPRO)
          </h2>

          {docs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-neutral-400)' }}>
              <FileText size={48} style={{ marginBottom: 'var(--space-4)', opacity: 0.5 }} />
              <p style={{ fontSize: 'var(--text-base)' }}>Belum ada dokumen tersedia</p>
            </div>
          ) : (
            <div className={styles.iproGrid}>
              {docs.map((project) => (
                <div key={project.id} className={styles.iproCard}>
                  {project.image_url && (
                    <Image
                      src={project.image_url}
                      alt={project.judul}
                      width={400}
                      height={180}
                      className={styles.iproCardImage}
                      style={{ objectFit: 'cover' }}
                      unoptimized
                    />
                  )}
                  <div className={styles.iproCardHeader}>
                    {project.kategori && (
                      <span className={styles.iproBadge}>{project.kategori}</span>
                    )}
                    <h3 className={styles.iproTitle}>{project.judul}</h3>
                    {project.deskripsi && (
                      <p className={styles.iproDesc}>{project.deskripsi}</p>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {project.nilai_investasi && (
                        <>
                          <span style={{ fontSize: '9px', color: 'var(--color-neutral-400)', fontWeight: 'bold' }}>NILAI PROYEK</span>
                          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 800, color: '#f59e0b' }}>{project.nilai_investasi}</span>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      style={{ fontSize: '11px', display: 'flex', gap: '4px', alignItems: 'center' }}
                      onClick={() => setSelectedDocId(project.id)}
                    >
                      <FileCheck size={12} />
                      Lihat Dokumen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* SECURE VIEW-ONLY MODAL VIEWER */}
      {selectedDocId && (
        <div className={styles.secureModal}>
          <div className={styles.secureViewerContent}>

            {/* Header */}
            <div className={styles.secureViewerHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <FileText size={18} style={{ color: 'var(--color-primary-400)' }} />
                <span className={styles.secureViewerTitle}>{getSelectedDocTitle()}</span>
              </div>

              {/* Warning label */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', padding: '4px 10px', borderRadius: '4px' }}>
                <Info size={12} />
                <span>View-only (Unduh dinonaktifkan)</span>
              </div>

              {/* Close Button */}
              <button
                type="button"
                className={styles.secureCloseBtn}
                onClick={handleCloseViewer}
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className={styles.secureViewerBody}>
              <style>{`@media print { .no-print { display: none !important; } }`}</style>
              <div className="no-print" style={{ width: '100%', position: 'relative' }}>
                {loadingSignedUrl ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '600px', color: 'var(--color-neutral-400)' }}>
                    <Loader2 size={32} className="animate-spin" />
                  </div>
                ) : signedUrl ? (
                  <>
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%) rotate(-45deg)',
                      fontSize: '36px',
                      fontWeight: 900,
                      color: 'rgba(239, 68, 68, 0.06)',
                      pointerEvents: 'none',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                      letterSpacing: '0.1em',
                      zIndex: 1,
                    }}>
                      DPMPTSP PROV LAMPUNG — DILINDUNGI
                    </div>
                    <iframe
                      src={signedUrl}
                      style={{ width: '100%', height: '600px', border: 'none', position: 'relative', zIndex: 2 }}
                      onContextMenu={(e) => e.preventDefault()}
                      title="Document Viewer"
                    />
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '600px', color: 'var(--color-neutral-400)' }}>
                    <p>Dokumen tidak tersedia untuk dilihat.</p>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
