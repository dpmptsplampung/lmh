-- Production baseline 2/5: core identity, content, attendance, and visit spine.
BEGIN;

CREATE TABLE public.layanan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama text NOT NULL UNIQUE,
  tipe text NOT NULL DEFAULT 'konsultatif'
    CHECK (tipe IN ('konsultatif', 'mitra', 'modul_publik')),
  aktif boolean NOT NULL DEFAULT true,
  chatbot_aktif boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.petugas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nama text NOT NULL,
  layanan_id uuid REFERENCES public.layanan(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'petugas' CHECK (role IN ('petugas', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_petugas_layanan ON public.petugas(layanan_id);

CREATE TABLE public.pengunjung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nama text NOT NULL,
  email text,
  foto_url text,
  provider text NOT NULL DEFAULT 'google',
  asal_instansi text,
  kategori text CHECK (kategori IN ('UMKM', 'Umum', 'Instansi', 'Investor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pengunjung_auth_user ON public.pengunjung(auth_user_id);
CREATE INDEX idx_pengunjung_updated_at ON public.pengunjung(updated_at);

CREATE TABLE public.site_settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.landing_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  item_key text NOT NULL,
  item_value text,
  item_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section, item_key, item_order)
);

CREATE TABLE public.absensi_petugas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  petugas_id uuid NOT NULL REFERENCES public.petugas(id) ON DELETE CASCADE,
  tanggal date NOT NULL DEFAULT CURRENT_DATE,
  jam_masuk timestamptz,
  jam_pulang timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  approved_by uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (petugas_id, tanggal)
);
CREATE INDEX idx_absensi_tanggal ON public.absensi_petugas(tanggal DESC);

CREATE TABLE public.visit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asal text NOT NULL CHECK (asal IN ('walk_in', 'reservasi')),
  pengunjung_id uuid REFERENCES public.pengunjung(id) ON DELETE SET NULL,
  nama text NOT NULL,
  asal_instansi text,
  layanan_id uuid REFERENCES public.layanan(id) ON DELETE RESTRICT,
  tujuan text CHECK (tujuan IN ('loket', 'bertemu_seseorang')),
  nama_yang_ditemui text,
  keperluan text,
  qr_token text UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  status text NOT NULL DEFAULT 'menunggu'
    CHECK (status IN ('terjadwal', 'menunggu', 'dilayani', 'selesai', 'batal', 'no_show')),
  tanggal_rencana date,
  jam_rencana time,
  waktu_masuk timestamptz,
  waktu_scan timestamptz,
  waktu_mulai_layan timestamptz,
  waktu_selesai timestamptz,
  diarahkan_ke text,
  catatan_petugas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_visit_layanan_status ON public.visit(layanan_id, status);
CREATE INDEX idx_visit_tanggal ON public.visit(tanggal_rencana);
CREATE INDEX idx_visit_qr ON public.visit(qr_token);
CREATE INDEX idx_visit_pengunjung ON public.visit(pengunjung_id);
CREATE INDEX idx_visit_asal ON public.visit(asal);

COMMENT ON TABLE public.petugas IS 'Individual staff accounts; each row belongs to one person, never a shared institution login.';
COMMENT ON TABLE public.visit IS 'Unified final visit spine for walk-in and reservation flows.';

COMMIT;
