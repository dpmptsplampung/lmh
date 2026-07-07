-- ============================================================
-- Migration 002: Fase 1 — Absensi Instansi Mitra (Buku P4)
-- ============================================================

CREATE TABLE kehadiran_layanan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instansi_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nama_piket TEXT NOT NULL,
  jam_hadir TIMESTAMPTZ NOT NULL DEFAULT now(),
  jam_pulang TIMESTAMPTZ,
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE kehadiran_layanan IS 'Absensi instansi mitra P4 — akun shared per instansi, nama piket teks bebas';
COMMENT ON COLUMN kehadiran_layanan.nama_piket IS 'Nama petugas yang piket hari itu (teks bebas karena akun shared)';

CREATE INDEX idx_kehadiran_tanggal ON kehadiran_layanan(tanggal DESC);
CREATE INDEX idx_kehadiran_instansi ON kehadiran_layanan(instansi_user_id);
