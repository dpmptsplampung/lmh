'use client';

import { useState, useEffect } from 'react';
import {
  FileText,
  Upload,
  Eye,
  EyeOff,
  GripVertical,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';

// Seed data
const demoDocs = [
  {
    id: 'kiwk',
    judul: 'Kawasan Industri Way Kanan (KIWK)',
    kategori: 'Manufaktur & Industri',
    deskripsi: 'Pengembangan kawasan industri manufaktur terintegrasi seluas 500 Hektar untuk menampung industri hilir komoditas perkebunan.',
    halaman: 24,
    status: 'aktif',
    urutan: 1,
    uploaded_at: '2026-06-15',
  },
  {
    id: 'bhc',
    judul: 'Bakauheni Harbour City (BHC)',
    kategori: 'Pariwisata & Jasa',
    deskripsi: 'Pengembangan kawasan pariwisata terpadu skala internasional di gerbang pulau Sumatera (Pelabuhan Bakauheni).',
    halaman: 18,
    status: 'aktif',
    urutan: 2,
    uploaded_at: '2026-06-20',
  },
  {
    id: 'pltsa',
    judul: 'PLTSa Bakung Bandar Lampung',
    kategori: 'Infrastruktur & Energi',
    deskripsi: 'Proyek pengelolaan sampah perkotaan menjadi energi listrik ramah lingkungan berkapasitas 15 MW.',
    halaman: 32,
    status: 'aktif',
    urutan: 3,
    uploaded_at: '2026-05-10',
  },
  {
    id: 'kiluan',
    judul: 'Kawasan Terpadu Pariwisata Teluk Kiluan',
    kategori: 'Pariwisata & Jasa',
    deskripsi: 'Pengembangan resort dan fasilitas ekowisata pengamatan lumba-lumba berstandar internasional.',
    halaman: 20,
    status: 'aktif',
    urutan: 4,
    uploaded_at: '2026-05-15',
  },
  {
    id: 'agro_nanas',
    judul: 'Agroindustri Nanas Terpadu Lampung Tengah',
    kategori: 'Pertanian & Pangan',
    deskripsi: 'Pembangunan pabrik pengolahan nanas kaleng dan konsentrat untuk pasar ekspor Timur Tengah.',
    halaman: 28,
    status: 'aktif',
    urutan: 5,
    uploaded_at: '2026-05-20',
  },
  {
    id: 'dipasena',
    judul: 'Revitalisasi Tambak Udang Dipasena',
    kategori: 'Perikanan & Kelautan',
    deskripsi: 'Modernisasi infrastruktur pertambakan dan penerapan teknologi smart aquaculture di Tulang Bawang.',
    halaman: 40,
    status: 'aktif',
    urutan: 6,
    uploaded_at: '2026-06-01',
  },
  {
    id: 'kek_karet',
    judul: 'KEK Industri Karet Tulang Bawang',
    kategori: 'Manufaktur & Industri',
    deskripsi: 'Kawasan Ekonomi Khusus yang difokuskan pada hilirisasi produk karet spesifikasi tinggi dan ban.',
    halaman: 45,
    status: 'aktif',
    urutan: 7,
    uploaded_at: '2026-06-05',
  },
  {
    id: 'pltp_ulubelu',
    judul: 'Ekspansi PLTP Ulubelu Unit 5 & 6',
    kategori: 'Infrastruktur & Energi',
    deskripsi: 'Pembangunan pembangkit listrik tenaga panas bumi tambahan untuk mendukung ketahanan energi hijau.',
    halaman: 36,
    status: 'aktif',
    urutan: 8,
    uploaded_at: '2026-06-10',
  },
  {
    id: 'pelabuhan_panjang',
    judul: 'Pengembangan Terminal Petikemas Panjang',
    kategori: 'Infrastruktur & Logistik',
    deskripsi: 'Peningkatan kapasitas terminal petikemas pelabuhan internasional Panjang menjadi 1 juta TEUs.',
    halaman: 22,
    status: 'aktif',
    urutan: 9,
    uploaded_at: '2026-06-12',
  }
];

export default function AdminGalleryPage() {
  const [docs, setDocs] = useState<any[]>(demoDocs);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    // Disabled for seed
  };

  useEffect(() => {
    // Disabled for seed
  }, []);

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'aktif' ? 'nonaktif' : 'aktif';
    setDocs(prev => prev.map(d => d.id === id ? { ...d, status: newStatus } : d));
  };

  const aktifCount = docs.filter(d => d.status === 'aktif').length;
  const nonaktifCount = docs.filter(d => d.status === 'nonaktif').length;

  return (
    <>
      <PageHeader
        title="Investment Gallery"
        description="Kelola dokumen galeri investasi — upload PDF, atur urutan tampil"
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn--ghost btn--sm" onClick={loadData}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button className="btn btn--primary btn--sm">
            <Upload size={16} />
            Upload Dokumen
          </button>
        </div>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {/* Stats */}
        <div className="grid-stats" style={{ marginBottom: 'var(--space-8)' }}>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
              <FileText size={22} />
            </div>
            <span className="stat-card__value">{aktifCount}</span>
            <span className="stat-card__label">Dokumen Aktif</span>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-neutral-100)', color: 'var(--color-neutral-600)' }}>
              <EyeOff size={22} />
            </div>
            <span className="stat-card__value">{nonaktifCount}</span>
            <span className="stat-card__label">Nonaktif</span>
          </div>
        </div>

        {/* Table */}
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}></th>
                <th>Dokumen</th>
                <th>Kategori</th>
                <th>Halaman</th>
                <th>Upload</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <GripVertical size={16} style={{ color: 'var(--text-tertiary)', cursor: 'grab' }} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div style={{
                        width: '40px',
                        height: '48px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-primary-50)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <FileText size={20} style={{ color: 'var(--color-primary-600)' }} />
                      </div>
                      <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{doc.judul}</span>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge--draft">{doc.kategori}</span>
                  </td>
                  <td style={{ fontSize: 'var(--text-sm)' }}>{doc.halaman} hal</td>
                  <td style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    {new Date(doc.uploaded_at).toLocaleDateString('id-ID')}
                  </td>
                  <td>
                    <span className={`badge badge--${doc.status}`}>
                      {doc.status === 'aktif' ? '✓ Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button className="btn btn--ghost btn--sm" title="Lihat">
                        <Eye size={14} />
                      </button>
                      <button 
                        className="btn btn--ghost btn--sm" 
                        title={doc.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                        onClick={() => handleToggleStatus(doc.id, doc.status)}
                      >
                        {doc.status === 'aktif' ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button className="btn btn--ghost btn--sm" title="Hapus" style={{ color: 'var(--color-danger-500)' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
