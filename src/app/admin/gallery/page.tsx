'use client';

import { useState } from 'react';
import {
  FileText,
  Upload,
  Eye,
  EyeOff,
  GripVertical,
  Trash2,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';

// Demo data
const demoDocs = [
  {
    id: '1',
    judul: 'Profil Investasi Provinsi Lampung 2026',
    kategori: 'Profil Investasi',
    jumlah_halaman: 24,
    status: 'aktif',
    urutan: 1,
    uploaded_at: '2026-06-15',
  },
  {
    id: '2',
    judul: 'Peta Potensi Industri Lampung Selatan',
    kategori: 'Potensi Daerah',
    jumlah_halaman: 18,
    status: 'aktif',
    urutan: 2,
    uploaded_at: '2026-06-20',
  },
  {
    id: '3',
    judul: 'Proposal KEK Bakauheni',
    kategori: 'KEK',
    jumlah_halaman: 32,
    status: 'nonaktif',
    urutan: 3,
    uploaded_at: '2026-05-10',
  },
];

export default function AdminGalleryPage() {
  return (
    <>
      <PageHeader
        title="Investment Gallery"
        description="Kelola dokumen galeri investasi — upload PDF, atur urutan tampil"
      >
        <button className="btn btn--primary btn--sm">
          <Upload size={16} />
          Upload Dokumen
        </button>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {/* Stats */}
        <div className="grid-stats" style={{ marginBottom: 'var(--space-8)' }}>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
              <FileText size={22} />
            </div>
            <span className="stat-card__value">{demoDocs.filter(d => d.status === 'aktif').length}</span>
            <span className="stat-card__label">Dokumen Aktif</span>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-neutral-100)', color: 'var(--color-neutral-600)' }}>
              <EyeOff size={22} />
            </div>
            <span className="stat-card__value">{demoDocs.filter(d => d.status === 'nonaktif').length}</span>
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
              {demoDocs.map((doc) => (
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
                  <td style={{ fontSize: 'var(--text-sm)' }}>{doc.jumlah_halaman} hal</td>
                  <td style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{doc.uploaded_at}</td>
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
                      <button className="btn btn--ghost btn--sm" title={doc.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}>
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
