'use client';

import { useState } from 'react';
import {
  BookOpen,
  LogIn,
  LogOut as LogOutIcon,
  Calendar,
  UserCheck,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';

// Demo data
const demoAbsensi = [
  { id: '1', instansi: 'BPJS Kesehatan Lampung', nama_piket: 'Rina Sulastri', jam_hadir: '08:00', jam_pulang: '16:00', tanggal: '2026-07-06' },
  { id: '2', instansi: 'Kemenag Prov. Lampung', nama_piket: 'Hendra Wijaya', jam_hadir: '08:30', jam_pulang: null, tanggal: '2026-07-06' },
  { id: '3', instansi: 'BPJS Kesehatan Lampung', nama_piket: 'Andi Permana', jam_hadir: '08:15', jam_pulang: '16:00', tanggal: '2026-07-05' },
  { id: '4', instansi: 'Kemenag Prov. Lampung', nama_piket: 'Sari Dewi', jam_hadir: '08:00', jam_pulang: '15:30', tanggal: '2026-07-05' },
];

export default function AbsensiPage() {
  const [filterTanggal] = useState(new Date().toISOString().split('T')[0]);

  const filtered = demoAbsensi.filter(a => a.tanggal === filterTanggal);
  const hadirHariIni = filtered.length;
  const sudahPulang = filtered.filter(a => a.jam_pulang).length;

  return (
    <>
      <PageHeader
        title="Absensi Instansi Mitra"
        description="Buku P4 Digital — Pencatatan kehadiran petugas instansi mitra"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Calendar size={16} style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="date"
            className="form-input"
            value={filterTanggal}
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
              <UserCheck size={22} />
            </div>
            <span className="stat-card__value">{hadirHariIni}</span>
            <span className="stat-card__label">Hadir Hari Ini</span>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-success-50)', color: 'var(--color-success-600)' }}>
              <LogOutIcon size={22} />
            </div>
            <span className="stat-card__value">{sudahPulang}</span>
            <span className="stat-card__label">Sudah Pulang</span>
          </div>
        </div>

        {/* Table */}
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Instansi</th>
                <th>Nama Piket</th>
                <th>Jam Hadir</th>
                <th>Jam Pulang</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.instansi}</td>
                  <td>{a.nama_piket}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <LogIn size={14} style={{ color: 'var(--color-success-500)' }} />
                      {a.jam_hadir}
                    </span>
                  </td>
                  <td>
                    {a.jam_pulang ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <LogOutIcon size={14} style={{ color: 'var(--text-tertiary)' }} />
                        {a.jam_pulang}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    {a.jam_pulang ? (
                      <span className="badge badge--selesai">Selesai</span>
                    ) : (
                      <span className="badge badge--aktif">● Aktif</span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                      <BookOpen size={40} className="empty-state__icon" />
                      <h3 className="empty-state__title">Belum Ada Absensi</h3>
                      <p>Belum ada instansi mitra yang absen untuk tanggal ini.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
