'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  FileText,
  ArrowLeft,
  Building2,
  Globe,
  ExternalLink,
  Info,
  X,
  FileCheck,
  TrendingUp,
} from 'lucide-react';
import { APP_NAME } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import styles from './gallery.module.css';

export default function GalleryPage() {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [iproProjects, setIproProjects] = useState<any[]>([]);
  const [foilaUrl, setFoilaUrl] = useState('https://invest.lampungprov.go.id/');

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();
      
      // Load Gallery Docs
      const { data: docs } = await supabase
        .from('gallery_docs')
        .select('*')
        .eq('status', 'aktif')
        .order('urutan', { ascending: true });
        
      if (docs) {
        setIproProjects(docs);
      }

      // Load Site Settings (FOILA URL)
      const { data: settings } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'foila_url')
        .single();
        
      if (settings) {
        setFoilaUrl(settings.value);
      }
    }
    
    loadData();
  }, []);

  // Disable right click inside the document viewer
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const handleCloseViewer = () => {
    setSelectedDocId(null);
  };

  // Helper to render pages content for the secure viewer
  const renderDocPages = () => {
    const watermarkText = 'DPMPTSP PROV LAMPUNG — DILINDUNGI';

    if (selectedDocId === 'peta_potensi') {
      return (
        <>
          {/* Page 1: Cover */}
          <div className={styles.securePage}>
            <div className={styles.watermark}>{watermarkText}</div>
            <div className={styles.pageHeader}>
              <span>DOKUMEN POTENSI DAERAH</span>
              <span>HALAMAN 1</span>
            </div>
            <div className={styles.pageContent} style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
              <Building2 size={64} style={{ color: 'var(--color-primary-600)', marginBottom: '16px' }} />
              <h2 style={{ fontSize: '20px', fontWeight: 900, color: '#111827', margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
                PETA POTENSI INVESTASI DAERAH
              </h2>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#4b5563', margin: '0 0 24px 0' }}>
                PROVINSI LAMPUNG 2026
              </h3>
              <div style={{ width: '40px', height: '3px', background: 'var(--color-primary-600)', marginBottom: '24px' }} />
              <p style={{ fontSize: '10px', color: '#9ca3af', maxWidth: '300px', lineHeight: 1.5 }}>
                Diterbitkan oleh Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu (DPMPTSP) Provinsi Lampung.
              </p>
            </div>
            <div className={styles.pageFooter}>
              <span>© {new Date().getFullYear()} DPMPTSP Lampung</span>
              <span>RAHASIA - VIEW ONLY</span>
            </div>
          </div>

          {/* Page 2: Ringkasan Sektoral */}
          <div className={styles.securePage}>
            <div className={styles.watermark}>{watermarkText}</div>
            <div className={styles.pageHeader}>
              <span>PETA POTENSI INVESTASI LAMPUNG</span>
              <span>HALAMAN 2</span>
            </div>
            <div className={styles.pageContent}>
              <h4 className={styles.pageSectionTitle}>1. RINGKASAN SEKTORAL UNGGULAN</h4>
              <p className={styles.pageParagraph}>
                Provinsi Lampung memiliki letak geografis strategis sebagai pintu gerbang Pulau Sumatera. Sektor-sektor utama penyumbang PDRB yang memiliki potensi investasi tinggi meliputi:
              </p>
              <ul style={{ paddingLeft: '16px', margin: '8px 0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <li style={{ fontSize: '10px', color: '#4b5563', lineHeight: 1.5 }}>
                  <strong>Pertanian & Perkebunan:</strong> Penghasil utama kopi robusta, lada hitam, tebu, kelapa sawit, dan singkong skala nasional.
                </li>
                <li style={{ fontSize: '10px', color: '#4b5563', lineHeight: 1.5 }}>
                  <strong>Agroindustri:</strong> Peluang industri pengolahan hasil panen terintegrasi untuk meningkatkan nilai tambah ekspor.
                </li>
                <li style={{ fontSize: '10px', color: '#4b5563', lineHeight: 1.5 }}>
                  <strong>Pariwisata Bahari:</strong> Kawasan Pesisir Barat (Krui) untuk selancar internasional dan Teluk Lampung untuk resort wisata terpadu.
                </li>
              </ul>
            </div>
            <div className={styles.pageFooter}>
              <span>© {new Date().getFullYear()} DPMPTSP Lampung</span>
              <span>RAHASIA - VIEW ONLY</span>
            </div>
          </div>

          {/* Page 3: Proyek Strategis */}
          <div className={styles.securePage}>
            <div className={styles.watermark}>{watermarkText}</div>
            <div className={styles.pageHeader}>
              <span>PETA POTENSI INVESTASI LAMPUNG</span>
              <span>HALAMAN 3</span>
            </div>
            <div className={styles.pageContent}>
              <h4 className={styles.pageSectionTitle}>2. DAFTAR PELUANG INVESTASI STRATEGIS</h4>
              <p className={styles.pageParagraph}>
                Berikut adalah rekapitulasi zonasi potensi proyek investasi strategis siap ditawarkan (Ready to Offer) di Provinsi Lampung:
              </p>
              <table className={styles.pageTable}>
                <thead>
                  <tr>
                    <th>Wilayah</th>
                    <th>Sektor Unggulan</th>
                    <th>Potensi Pengembangan</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Lampung Selatan</strong></td>
                    <td>Kawasan Industri & Pariwisata</td>
                    <td>Bakauheni Harbour City, Kawasan Industri Lamsel</td>
                  </tr>
                  <tr>
                    <td><strong>Way Kanan</strong></td>
                    <td>Manufaktur Hilir Sawit/Karet</td>
                    <td>Kawasan Industri Way Kanan (KIWK)</td>
                  </tr>
                  <tr>
                    <td><strong>Pesawaran</strong></td>
                    <td>Pariwisata Bahari & Kerajinan</td>
                    <td>Kawasan Resort Wisata Pulau Pahawang</td>
                  </tr>
                  <tr>
                    <td><strong>Pesisir Barat</strong></td>
                    <td>Wisata Selancar & Ekoturisme</td>
                    <td>Kawasan Tanjung Setia Krui</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={styles.pageFooter}>
              <span>© {new Date().getFullYear()} DPMPTSP Lampung</span>
              <span>RAHASIA - VIEW ONLY</span>
            </div>
          </div>
        </>
      );
    }

    if (selectedDocId === 'kiwk') {
      return (
        <>
          <div className={styles.securePage}>
            <div className={styles.watermark}>{watermarkText}</div>
            <div className={styles.pageHeader}>
              <span>IPRO PROJECT PROFILE</span>
              <span>HALAMAN 1</span>
            </div>
            <div className={styles.pageContent} style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
              <div style={{
                padding: '12px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.1)',
                color: '#f59e0b', marginBottom: '16px'
              }}>
                <FileCheck size={48} />
              </div>
              <h2 style={{ fontSize: '18px', fontWeight: 900, color: '#111827', margin: '0 0 8px 0' }}>
                INVESTMENT PROJECT READY TO OFFER (IPRO)
              </h2>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#4b5563', margin: '0' }}>
                KAWASAN INDUSTRI WAY KANAN (KIWK)
              </h3>
              <div style={{ width: '40px', height: '3px', background: '#f59e0b', margin: '16px 0' }} />
              <table style={{ border: 'none', fontSize: '10px', color: '#4b5563', maxWidth: '300px' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px', fontWeight: 'bold' }}>Estimasi Investasi:</td>
                    <td style={{ padding: '4px' }}>Rp 2.4 Triliun</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px', fontWeight: 'bold' }}>Luas Lahan:</td>
                    <td style={{ padding: '4px' }}>500 Hektar</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={styles.pageFooter}>
              <span>IPRO PROYEK KIWK 2026</span>
              <span>HALAMAN 1</span>
            </div>
          </div>

          <div className={styles.securePage}>
            <div className={styles.watermark}>{watermarkText}</div>
            <div className={styles.pageHeader}>
              <span>IPRO PROJECT PROFILE</span>
              <span>HALAMAN 2</span>
            </div>
            <div className={styles.pageContent}>
              <h4 className={styles.pageSectionTitle}>SPESIFIKASI PROYEK & DUKUNGAN INFRASTRUKTUR</h4>
              <p className={styles.pageParagraph}>
                Proyek Kawasan Industri Way Kanan (KIWK) dirancang untuk menampung hilirisasi perkebunan kelapa sawit, karet, dan singkong.
              </p>
              <h5 style={{ fontSize: '10px', fontWeight: 700, marginTop: '8px', color: '#1f2937' }}>Dukungan Pemerintah Daerah:</h5>
              <ul style={{ paddingLeft: '16px', margin: '4px 0', fontSize: '9px', color: '#4b5563', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <li>Kemudahan izin lokasi dan insentif pajak daerah.</li>
                <li>Ketersediaan akses jalan provinsi berkapasitas muatan berat.</li>
                <li>Jaminan pasokan listrik dari gardu induk PLN terdekat.</li>
              </ul>
            </div>
            <div className={styles.pageFooter}>
              <span>IPRO PROYEK KIWK 2026</span>
              <span>HALAMAN 2</span>
            </div>
          </div>
        </>
      );
    }

    if (selectedDocId === 'bhc') {
      return (
        <>
          <div className={styles.securePage}>
            <div className={styles.watermark}>{watermarkText}</div>
            <div className={styles.pageHeader}>
              <span>IPRO PROJECT PROFILE</span>
              <span>HALAMAN 1</span>
            </div>
            <div className={styles.pageContent} style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
              <div style={{
                padding: '12px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.1)',
                color: '#f59e0b', marginBottom: '16px'
              }}>
                <FileCheck size={48} />
              </div>
              <h2 style={{ fontSize: '18px', fontWeight: 900, color: '#111827', margin: '0 0 8px 0' }}>
                INVESTMENT PROJECT READY TO OFFER (IPRO)
              </h2>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#4b5563', margin: '0' }}>
                BAKAUHENI HARBOUR CITY (BHC)
              </h3>
              <div style={{ width: '40px', height: '3px', background: '#f59e0b', margin: '16px 0' }} />
              <table style={{ border: 'none', fontSize: '10px', color: '#4b5563', maxWidth: '300px' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px', fontWeight: 'bold' }}>Estimasi Investasi:</td>
                    <td style={{ padding: '4px' }}>Rp 4.2 Triliun</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px', fontWeight: 'bold' }}>Sektor:</td>
                    <td style={{ padding: '4px' }}>Pariwisata & Hospitality</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={styles.pageFooter}>
              <span>IPRO PROYEK BHC 2026</span>
              <span>HALAMAN 1</span>
            </div>
          </div>

          <div className={styles.securePage}>
            <div className={styles.watermark}>{watermarkText}</div>
            <div className={styles.pageHeader}>
              <span>IPRO PROJECT PROFILE</span>
              <span>HALAMAN 2</span>
            </div>
            <div className={styles.pageContent}>
              <h4 className={styles.pageSectionTitle}>KONSEP PENGEMBANGAN WISATA</h4>
              <p className={styles.pageParagraph}>
                Bakauheni Harbour City memadukan pariwisata rekreasi, budaya, dan akomodasi premium berupa Theme Park, Krakatau Park, Masjid Raya BSI, serta pusat UMKM terintegrasi.
              </p>
              <h5 style={{ fontSize: '10px', fontWeight: 700, marginTop: '8px', color: '#1f2937' }}>Target Pasar Proyek:</h5>
              <p className={styles.pageParagraph}>
                Menyasar jutaan penyeberang Selat Sunda setiap tahunnya serta pasar liburan akhir pekan penduduk Jabodetabek dan Sumatera Bagian Selatan.
              </p>
            </div>
            <div className={styles.pageFooter}>
              <span>IPRO PROYEK BHC 2026</span>
              <span>HALAMAN 2</span>
            </div>
          </div>
        </>
      );
    }

    if (selectedDocId === 'pltsa') {
      return (
        <>
          <div className={styles.securePage}>
            <div className={styles.watermark}>{watermarkText}</div>
            <div className={styles.pageHeader}>
              <span>IPRO PROJECT PROFILE</span>
              <span>HALAMAN 1</span>
            </div>
            <div className={styles.pageContent} style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
              <div style={{
                padding: '12px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.1)',
                color: '#f59e0b', marginBottom: '16px'
              }}>
                <FileCheck size={48} />
              </div>
              <h2 style={{ fontSize: '18px', fontWeight: 900, color: '#111827', margin: '0 0 8px 0' }}>
                INVESTMENT PROJECT READY TO OFFER (IPRO)
              </h2>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#4b5563', margin: '0' }}>
                PLTSA BAKUNG BANDAR LAMPUNG
              </h3>
              <div style={{ width: '40px', height: '3px', background: '#f59e0b', margin: '16px 0' }} />
              <table style={{ border: 'none', fontSize: '10px', color: '#4b5563', maxWidth: '300px' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px', fontWeight: 'bold' }}>Estimasi Investasi:</td>
                    <td style={{ padding: '4px' }}>Rp 650 Miliar</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px', fontWeight: 'bold' }}>Kapasitas Output:</td>
                    <td style={{ padding: '4px' }}>15 Megawatt (MW)</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={styles.pageFooter}>
              <span>IPRO PLTSA BAKUNG 2026</span>
              <span>HALAMAN 1</span>
            </div>
          </div>

          <div className={styles.securePage}>
            <div className={styles.watermark}>{watermarkText}</div>
            <div className={styles.pageHeader}>
              <span>IPRO PROJECT PROFILE</span>
              <span>HALAMAN 2</span>
            </div>
            <div className={styles.pageContent}>
              <h4 className={styles.pageSectionTitle}>TINJAUAN OPERASIONAL & BAHAN BAKU</h4>
              <p className={styles.pageParagraph}>
                PLTSa Bakung dirancang menggunakan teknologi insinerasi modern ramah lingkungan untuk mengubah sampah TPA Bakung menjadi tenaga listrik mandiri.
              </p>
              <h5 style={{ fontSize: '10px', fontWeight: 700, marginTop: '8px', color: '#1f2937' }}>Skema Bisnis Kerjasama:</h5>
              <p className={styles.pageParagraph}>
                Menggunakan Kerjasama Pemerintah dengan Badan Usaha (KPBU) dengan jaminan pembelian tarif listrik (fit-in-tariff) oleh PLN.
              </p>
            </div>
            <div className={styles.pageFooter}>
              <span>IPRO PLTSA BAKUNG 2026</span>
              <span>HALAMAN 2</span>
            </div>
          </div>
        </>
      );
    }

    return null;
  };

  const getSelectedDocTitle = () => {
    if (selectedDocId === 'peta_potensi') return 'Peta Potensi Investasi Daerah Lampung 2026';
    return iproProjects.find((p) => p.id === selectedDocId)?.judul || 'Dokumen Investasi';
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
          <div className={styles.petaCard} onClick={() => setSelectedDocId('peta_potensi')}>
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
              <div className={styles.foilaIcon}>
                <Globe size={24} />
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
          
          <div className={styles.iproGrid}>
            {iproProjects.map((project) => (
              <div key={project.id} className={styles.iproCard}>
                <div className={styles.iproCardHeader}>
                  <span className={styles.iproBadge}>{project.kategori}</span>
                  <h3 className={styles.iproTitle}>{project.judul}</h3>
                  <p className={styles.iproDesc}>{project.deskripsi}</p>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '9px', color: 'var(--color-neutral-400)', fontWeight: 'bold' }}>NILAI PROYEK</span>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 800, color: '#f59e0b' }}>{project.nilai}</span>
                  </div>
                  
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    style={{ fontSize: '11px', display: 'flex', gap: '4px', alignItems: 'center' }}
                    onClick={() => setSelectedDocId(project.id)}
                  >
                    <FileText size={12} />
                    Lihat IPRO
                  </button>
                </div>
              </div>
            ))}
          </div>
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

            {/* Body (Scrollable pages list) */}
            <div className={styles.secureViewerBody}>
              {renderDocPages()}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
