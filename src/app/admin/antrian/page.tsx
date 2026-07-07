'use client';

import { useState } from 'react';
import {
  Calendar,
  Clock,
  Users,
  TrendingUp,
  Filter,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';

// Demo data
const demoAntrian = [
  { nomor: 1, nama: 'Ahmad Surya', keperluan: 'Konsultasi NIB baru', waktu_masuk: '08:15', status: 'selesai', durasi: 15 },
  { nomor: 2, nama: 'Budi Santoso', keperluan: 'Perubahan data NIB', waktu_masuk: '08:30', status: 'selesai', durasi: 20 },
  { nomor: 3, nama: 'Dewi Lestari', keperluan: 'Izin berusaha mikro', waktu_masuk: '09:00', status: 'selesai', durasi: 10 },
  { nomor: 4, nama: 'Eka Putra', keperluan: 'Konsultasi izin lingkungan', waktu_masuk: '09:30', status: 'menunggu', durasi: null },
  { nomor: 5, nama: 'Fani Rahmawati', keperluan: 'NIB baru PT', waktu_masuk: '09:45', status: 'menunggu', durasi: null },
];

export default function AntrianPage() {
  const [tanggal] = useState(new Date().toISOString().split('T')[0]);

  const selesai = demoAntrian.filter(a => a.status === 'selesai');
  const rataWaktu = selesai.length > 0
    ? Math.round(selesai.reduce((sum, a) => sum + (a.durasi || 0), 0) / selesai.length)
    : 0;

  return (
    <>
      <PageHeader
        title="Log Antrian Helpdesk OSS"
        description="Urutan kedatangan harian khusus Helpdesk OSS"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Calendar size={16} style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="date"
            className="form-input"
            value={tanggal}
            readOnly
            style={{ width: '160px', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}
          />
        </div>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {/* Stats */}
        <div className="grid-stats" style={{ marginBottom: 'var(--space-8)' }}>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
              <Users size={22} />
            </div>
            <span className="stat-card__value">{demoAntrian.length}</span>
            <span className="stat-card__label">Total Hari Ini</span>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-success-50)', color: 'var(--color-success-600)' }}>
              <TrendingUp size={22} />
            </div>
            <span className="stat-card__value">{selesai.length}</span>
            <span className="stat-card__label">Selesai Dilayani</span>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-accent-50)', color: 'var(--color-accent-600)' }}>
              <Clock size={22} />
            </div>
            <span className="stat-card__value">{rataWaktu} <small style={{ fontSize: '0.4em', fontWeight: 400 }}>mnt</small></span>
            <span className="stat-card__label">Rata-rata Durasi</span>
          </div>
        </div>

        {/* Table */}
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>No. Urut</th>
                <th>Nama</th>
                <th>Keperluan</th>
                <th>Waktu Masuk</th>
                <th>Status</th>
                <th>Durasi</th>
              </tr>
            </thead>
            <tbody>
              {demoAntrian.map((a) => (
                <tr key={a.nomor}>
                  <td>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '32px',
                      height: '32px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-primary-50)',
                      color: 'var(--color-primary-700)',
                      fontWeight: 700,
                      fontSize: 'var(--text-sm)',
                    }}>
                      {a.nomor}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{a.nama}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{a.keperluan}</td>
                  <td>{a.waktu_masuk}</td>
                  <td>
                    <span className={`badge badge--${a.status}`}>
                      {a.status === 'menunggu' ? '● Menunggu' : '✓ Selesai'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {a.durasi ? `${a.durasi} menit` : '—'}
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
