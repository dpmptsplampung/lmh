'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  FileText,
  ArrowLeft,
  ExternalLink,
  FileCheck,
  TrendingUp,
  Mail,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getSiteSettings } from '@/lib/site-settings';
import { CONTACT_EMAIL_FALLBACK } from '@/lib/constants';
import FormulirMinat from '@/components/investasi/FormulirMinat';
import PenampilDokumen from '@/components/investasi/PenampilDokumen';
import Tombol from '@/components/ui/Tombol';
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

  const [leadModalDoc, setLeadModalDoc] = useState<GalleryDoc | null>(null);
  const [contactEmail, setContactEmail] = useState(CONTACT_EMAIL_FALLBACK);

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

        const settings = await getSiteSettings(['foila_url', 'contact_email']);
        if (settings.foila_url) {
          setFoilaUrl(settings.foila_url);
        }
        if (settings.contact_email) {
          setContactEmail(settings.contact_email);
        }
      } catch (e) {
        console.error('Error loading gallery data:', e);
        setDocs([]);
      }
    }
    loadData();
  }, []);

  const selectedDoc = selectedDocId ? docs.find((d) => d.id === selectedDocId) ?? null : null;
  const hasPages = !!(selectedDoc?.halaman_gambar && selectedDoc.halaman_gambar.length > 0);

  return (
    <div className={styles.galleryPage}>
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
        <nav aria-label="Remah roti" className={styles.remahGaleri}>
          <Link href="/investasi">Investasi</Link>
          <span aria-hidden="true">›</span>
          <span aria-current="page">Dokumen Investasi</span>
        </nav>
        <h1 className={styles.galleryHeaderTitle}>
          <FileText size={36} style={{ display: 'inline', marginRight: '12px', verticalAlign: 'middle', color: 'var(--color-primary-400)' }} />
          Dokumen Investasi
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
          <button
            type="button"
            className={styles.petaCard}
            onClick={() => {
              const petaDoc = docs.find((d) => d.kategori === 'Peta Potensi' || d.judul.toLowerCase().includes('peta potensi'));
              if (petaDoc) setSelectedDocId(petaDoc.id);
            }}
          >
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
          </button>

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
              <h3 className={styles.foilaTitle}>Portal FOILA</h3>
            </div>
            <p className={styles.foilaDesc}>
              Forum Investasi Lampung (FOILA) memuat proyek investasi daerah, panduan prosedur, infrastruktur, dan berita investasi.
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
            Dokumen proyek investasi
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
                      unoptimized
                      className={styles.iproCardImage}
                      style={{ objectFit: 'cover' }}
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
                          <span className={styles.nilaiProyek}>{project.nilai_investasi}</span>
                        </>
                      )}
                    </div>

                    <Tombol
                      varian="sekunder"
                      ukuran="kecil"
                      ikon={FileCheck}
                      onClick={() => setSelectedDocId(project.id)}
                    >
                      Lihat Dokumen
                    </Tombol>
                  </div>

                  <button
                    type="button"
                    className={styles.leadCtaBtn}
                    onClick={() => setLeadModalDoc(project)}
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

      {/* Penampil view-only dipakai bersama halaman detail IPRO. Dipasang hanya saat dibuka (halaman mulai dari 1). */}
      {selectedDoc && (
        <PenampilDokumen
          dokumenId={selectedDoc.id}
          judul={selectedDoc.judul}
          jumlahHalaman={hasPages ? selectedDoc.jumlah_halaman : 0}
          kontakEmail={contactEmail}
          onTutup={() => setSelectedDocId(null)}
        />
      )}

      {/* Formulir minat tanpa login: persetujuan PDP, operasi_id, dan honeypot dibawa FormulirMinat. */}
      <FormulirMinat
        terbuka={leadModalDoc !== null}
        onTutup={() => setLeadModalDoc(null)}
        kanal="dokumen"
        refId={leadModalDoc?.id ?? ''}
        konteks={leadModalDoc?.judul ?? ''}
      />
    </div>
  );
}
