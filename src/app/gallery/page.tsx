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
  ChevronLeft,
  ChevronRight,
  Mail,
  Loader2,
  CheckCircle,
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
  halaman_gambar: string[] | null;
}

export default function GalleryPage() {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [docs, setDocs] = useState<GalleryDoc[]>([]);
  const [foilaUrl, setFoilaUrl] = useState('https://invest.lampungprov.go.id/');
  const [currentPage, setCurrentPage] = useState(1);

  const [leadModalDoc, setLeadModalDoc] = useState<GalleryDoc | null>(null);
  const [leadForm, setLeadForm] = useState({ nama: '', email: '', instansi: '', minat: '', catatan: '' });
  const [leadSending, setLeadSending] = useState(false);
  const [leadSent, setLeadSent] = useState(false);
  const [leadError, setLeadError] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        const supabase = createClient();

        const { data: documents } = await supabase
          .from('investment_documents')
          .select('id, judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url, halaman_gambar')
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
    // Reset to page 1 whenever a new document is opened.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPage(1);
  }, [selectedDocId]);

  const selectedDoc = selectedDocId ? docs.find((d) => d.id === selectedDocId) ?? null : null;
  const pageCount = selectedDoc?.jumlah_halaman ?? 0;
  const hasPages = !!(selectedDoc?.halaman_gambar && selectedDoc.halaman_gambar.length > 0);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const handleCloseViewer = () => {
    setSelectedDocId(null);
  };

  const handleOpenLeadModal = (doc: GalleryDoc) => {
    setLeadModalDoc(doc);
    setLeadForm({ nama: '', email: '', instansi: '', minat: '', catatan: '' });
    setLeadSent(false);
    setLeadError('');
    setLeadSending(false);
  };

  const handleCloseLeadModal = () => {
    setLeadModalDoc(null);
    setLeadSent(false);
    setLeadError('');
  };

  const handleSubmitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadModalDoc) return;
    setLeadSending(true);
    setLeadError('');
    try {
      const res = await fetch('/api/investasi/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_id: leadModalDoc.id,
          nama: leadForm.nama,
          email: leadForm.email,
          instansi: leadForm.instansi || undefined,
          minat: leadForm.minat || undefined,
          catatan: leadForm.catatan || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Gagal mengirim permintaan');
      }
      setLeadSent(true);
    } catch (err) {
      setLeadError(err instanceof Error ? err.message : 'Gagal mengirim permintaan');
    } finally {
      setLeadSending(false);
    }
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

                  <button
                    type="button"
                    className={styles.leadCtaBtn}
                    onClick={() => handleOpenLeadModal(project)}
                  >
                    <Mail size={14} />
                    Ajukan Minat Investasi
                  </button>
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
                {!hasPages ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '600px', color: 'var(--color-neutral-400)', gap: 'var(--space-4)' }}>
                    <FileText size={48} style={{ opacity: 0.4 }} />
                    <p>Dokumen ini sedang diproses.</p>
                    <a href="mailto:gallery@lmh.go.id" style={{ color: 'var(--color-primary-400)', fontSize: 'var(--text-sm)' }}>
                      Hubungi admin untuk informasi lebih lanjut
                    </a>
                  </div>
                ) : (
                  <>
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%) rotate(-30deg)',
                      fontSize: '32px',
                      fontWeight: 900,
                      color: 'rgba(239, 68, 68, 0.10)',
                      pointerEvents: 'none',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                      letterSpacing: '0.1em',
                      zIndex: 1,
                    }}>
                      DPMPTSP PROV LAMPUNG — DILINDUNGI
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element -- dynamic watermarked PNG, next/image does not apply */}
                    <img
                      src={`/api/investment-docs/page-image?doc_id=${selectedDocId}&page=${currentPage}`}
                      alt={`Halaman ${currentPage} dari ${pageCount}`}
                      style={{ width: '100%', maxWidth: '640px', height: 'auto', border: 'none', position: 'relative', zIndex: 2, display: 'block', margin: '0 auto', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
                      onContextMenu={(e) => e.preventDefault()}
                      draggable={false}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        style={{ display: 'flex', gap: '4px', alignItems: 'center' }}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                      >
                        <ChevronLeft size={14} />
                        Sebelumnya
                      </button>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-neutral-400)' }}>
                        Halaman {currentPage} dari {pageCount}
                      </span>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        style={{ display: 'flex', gap: '4px', alignItems: 'center' }}
                        onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
                        disabled={currentPage >= pageCount}
                      >
                        Berikutnya
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {leadModalDoc && (
        <div
          className={styles.leadModal}
          role="dialog"
          aria-modal="true"
          aria-label="Formulir Minat Investasi"
        >
          <div className={styles.leadModalContent}>
            <div className={styles.leadModalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Mail size={18} style={{ color: 'var(--color-primary-400)' }} />
                <span className={styles.leadModalTitle}>Ajukan Minat Investasi</span>
              </div>
              <button
                type="button"
                className={styles.secureCloseBtn}
                onClick={handleCloseLeadModal}
                aria-label="Tutup"
              >
                <X size={20} />
              </button>
            </div>

            <div className={styles.leadModalBody}>
              {leadSent ? (
                <div className={styles.leadSuccess}>
                  <CheckCircle size={48} style={{ color: '#10b981', marginBottom: 'var(--space-4)' }} />
                  <p className={styles.leadSuccessText}>
                    Permintaan Anda tercatat. Tim kami akan menghubungi Anda.
                  </p>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleCloseLeadModal}
                  >
                    Tutup
                  </button>
                </div>
              ) : (
                <form className={styles.leadForm} onSubmit={handleSubmitLead}>
                  <p className={styles.leadContext}>
                    Untuk dokumen: <strong>{leadModalDoc.judul}</strong>
                  </p>

                  {leadError && (
                    <div className={styles.leadError} role="alert">
                      <Info size={14} />
                      {leadError}
                    </div>
                  )}

                  <div className={styles.leadField}>
                    <label htmlFor="lead-nama" className={styles.leadLabel}>Nama <span style={{ color: '#f87171' }}>*</span></label>
                    <input
                      id="lead-nama"
                      type="text"
                      className={styles.leadInput}
                      value={leadForm.nama}
                      onChange={(e) => setLeadForm({ ...leadForm, nama: e.target.value })}
                      required
                      maxLength={200}
                      autoFocus
                    />
                  </div>

                  <div className={styles.leadField}>
                    <label htmlFor="lead-email" className={styles.leadLabel}>Email <span style={{ color: '#f87171' }}>*</span></label>
                    <input
                      id="lead-email"
                      type="email"
                      className={styles.leadInput}
                      value={leadForm.email}
                      onChange={(e) => setLeadForm({ ...leadForm, email: e.target.value })}
                      required
                    />
                  </div>

                  <div className={styles.leadField}>
                    <label htmlFor="lead-instansi" className={styles.leadLabel}>Instansi</label>
                    <input
                      id="lead-instansi"
                      type="text"
                      className={styles.leadInput}
                      value={leadForm.instansi}
                      onChange={(e) => setLeadForm({ ...leadForm, instansi: e.target.value })}
                      maxLength={200}
                    />
                  </div>

                  <div className={styles.leadField}>
                    <label htmlFor="lead-minat" className={styles.leadLabel}>Minat</label>
                    <textarea
                      id="lead-minat"
                      className={styles.leadTextarea}
                      value={leadForm.minat}
                      onChange={(e) => setLeadForm({ ...leadForm, minat: e.target.value })}
                      rows={3}
                      maxLength={1000}
                    />
                  </div>

                  <div className={styles.leadField}>
                    <label htmlFor="lead-catatan" className={styles.leadLabel}>Catatan</label>
                    <textarea
                      id="lead-catatan"
                      className={styles.leadTextarea}
                      value={leadForm.catatan}
                      onChange={(e) => setLeadForm({ ...leadForm, catatan: e.target.value })}
                      rows={3}
                      maxLength={2000}
                    />
                  </div>

                  <button
                    type="submit"
                    className={styles.leadSubmit}
                    disabled={leadSending}
                  >
                    {leadSending ? (
                      <><Loader2 size={16} className="animate-pulse" /> Mengirim...</>
                    ) : (
                      <><Mail size={16} /> Kirim Permintaan</>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
