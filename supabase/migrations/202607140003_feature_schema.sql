-- Production baseline 3/5: final application feature schema.
BEGIN;

CREATE TABLE public.faq_knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  pertanyaan text NOT NULL,
  jawaban text NOT NULL,
  aktif boolean NOT NULL DEFAULT true,
  urutan integer NOT NULL DEFAULT 0,
  embedding extensions.vector(768),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_faq_layanan ON public.faq_knowledge_base(layanan_id);
CREATE INDEX idx_faq_embedding ON public.faq_knowledge_base
  USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = 100);

CREATE TABLE public.chat_sesi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id uuid NOT NULL REFERENCES public.layanan(id) ON DELETE RESTRICT,
  pengunjung_id uuid REFERENCES public.pengunjung(id) ON DELETE SET NULL,
  kontak_pengunjung text,
  status text NOT NULL DEFAULT 'bot' CHECK (status IN ('aktif', 'bot', 'eskalasi', 'selesai')),
  ditangani_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_sesi_layanan ON public.chat_sesi(layanan_id);
CREATE INDEX idx_chat_sesi_status ON public.chat_sesi(status);
CREATE INDEX idx_chat_sesi_pengunjung ON public.chat_sesi(pengunjung_id);

CREATE TABLE public.chat_pesan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesi_id uuid NOT NULL REFERENCES public.chat_sesi(id) ON DELETE CASCADE,
  pengirim text NOT NULL CHECK (pengirim IN ('pengunjung', 'bot', 'petugas')),
  isi text NOT NULL,
  sumber_faq_id uuid REFERENCES public.faq_knowledge_base(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_pesan_sesi ON public.chat_pesan(sesi_id);

CREATE TABLE public.chat_ai_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesi_id uuid REFERENCES public.chat_sesi(id) ON DELETE CASCADE,
  pertanyaan text NOT NULL,
  context_faq_ids uuid[] NOT NULL DEFAULT '{}',
  jawaban text,
  top_similarity double precision,
  eskalasi boolean NOT NULL DEFAULT false,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_ai_log_created ON public.chat_ai_log(created_at DESC);
CREATE INDEX idx_chat_ai_log_eskalasi ON public.chat_ai_log(eskalasi) WHERE eskalasi = true;

CREATE TABLE public.listing_umkm (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama_umkm text NOT NULL,
  kategori_kebutuhan text NOT NULL CHECK (kategori_kebutuhan IN (
    'bahan_baku', 'pemasaran', 'modal', 'peralatan', 'pelatihan', 'kemitraan', 'lainnya'
  )),
  sisi text NOT NULL DEFAULT 'kebutuhan' CHECK (sisi IN ('kebutuhan', 'penawaran')),
  deskripsi text,
  foto_produk text[],
  kontak_nama text NOT NULL,
  kontak_hp text,
  kontak_email text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'published', 'nonaktif', 'expired')),
  snapshot_approved jsonb,
  dibuat_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_listing_status ON public.listing_umkm(status);
CREATE INDEX idx_listing_kategori ON public.listing_umkm(kategori_kebutuhan);
CREATE INDEX idx_listing_sisi ON public.listing_umkm(sisi);

CREATE TABLE public.umkm_listing_owner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listing_umkm(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, email)
);
CREATE INDEX idx_umkm_owner_email ON public.umkm_listing_owner(email);

CREATE TABLE public.umkm_inquiry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listing_umkm(id) ON DELETE CASCADE,
  from_email text NOT NULL,
  from_nama text,
  pesan text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_umkm_inquiry_listing ON public.umkm_inquiry(listing_id);
CREATE INDEX idx_umkm_inquiry_status ON public.umkm_inquiry(status);
CREATE INDEX idx_umkm_inquiry_created_at ON public.umkm_inquiry(created_at DESC);

CREATE TABLE public.investment_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judul text NOT NULL,
  kategori text,
  urutan_tampil integer NOT NULL DEFAULT 0,
  file_path text NOT NULL,
  halaman_gambar text[],
  jumlah_halaman integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'nonaktif')),
  deskripsi text,
  nilai_investasi text,
  image_url text,
  uploaded_by uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_investment_status ON public.investment_documents(status);
CREATE INDEX idx_investment_urutan ON public.investment_documents(urutan_tampil);

CREATE TABLE public.investasi_lead (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid REFERENCES public.investment_documents(id) ON DELETE SET NULL,
  nama text NOT NULL,
  email text NOT NULL,
  instansi text,
  minat text,
  catatan text,
  status text NOT NULL DEFAULT 'baru'
    CHECK (status IN ('baru', 'dihubungi', 'berlanjut', 'ditolak', 'selesai')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_investasi_lead_status ON public.investasi_lead(status);
CREATE INDEX idx_investasi_lead_doc ON public.investasi_lead(doc_id);
CREATE INDEX idx_investasi_lead_created_at ON public.investasi_lead(created_at DESC);

CREATE TABLE public.anon_rate_limit (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_anon_rate_user_action_time
  ON public.anon_rate_limit(user_id, action, created_at DESC);

CREATE TABLE public.audit_log (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  actor_id uuid,
  actor_role text,
  aksi text NOT NULL,
  entitas text NOT NULL,
  entitas_id text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_entitas ON public.audit_log(entitas, entitas_id);
CREATE INDEX idx_audit_log_actor ON public.audit_log(actor_id);
CREATE INDEX idx_audit_log_created ON public.audit_log(created_at DESC);

CREATE TABLE public.consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subjek_ref text NOT NULL,
  tujuan text NOT NULL,
  disetujui boolean NOT NULL,
  versi_kebijakan text NOT NULL DEFAULT '1.0',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_consent_subjek ON public.consent_log(subjek_ref);

CREATE TABLE public.skm_respons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid REFERENCES public.visit(id) ON DELETE SET NULL,
  layanan_id uuid REFERENCES public.layanan(id) ON DELETE RESTRICT,
  u1_persyaratan smallint CHECK (u1_persyaratan BETWEEN 1 AND 4),
  u2_prosedur smallint CHECK (u2_prosedur BETWEEN 1 AND 4),
  u3_waktu smallint CHECK (u3_waktu BETWEEN 1 AND 4),
  u4_biaya smallint CHECK (u4_biaya BETWEEN 1 AND 4),
  u5_produk smallint CHECK (u5_produk BETWEEN 1 AND 4),
  u6_kompetensi smallint CHECK (u6_kompetensi BETWEEN 1 AND 4),
  u7_perilaku smallint CHECK (u7_perilaku BETWEEN 1 AND 4),
  u8_sarana smallint CHECK (u8_sarana BETWEEN 1 AND 4),
  u9_pengaduan smallint CHECK (u9_pengaduan BETWEEN 1 AND 4),
  saran text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_skm_layanan ON public.skm_respons(layanan_id);
CREATE INDEX idx_skm_visit ON public.skm_respons(visit_id);
CREATE INDEX idx_skm_created ON public.skm_respons(created_at DESC);
CREATE UNIQUE INDEX skm_respons_visit_id_uniq
  ON public.skm_respons(visit_id) WHERE visit_id IS NOT NULL;

CREATE TABLE public.notifikasi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tujuan_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  tujuan_email text,
  kanal text NOT NULL CHECK (kanal IN ('email', 'web_push')),
  subjek text,
  body text NOT NULL,
  payload jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  claim_token uuid,
  claimed_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  retry_count integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX idx_notifikasi_status ON public.notifikasi(status, created_at);
CREATE INDEX idx_notifikasi_tujuan ON public.notifikasi(tujuan_user_id);
CREATE INDEX idx_notifikasi_claim
  ON public.notifikasi(status, available_at)
  WHERE status IN ('pending', 'failed');
CREATE UNIQUE INDEX idx_notifikasi_idempotency_key
  ON public.notifikasi(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  keys jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_sub_user ON public.push_subscriptions(user_id);
CREATE UNIQUE INDEX idx_push_sub_endpoint ON public.push_subscriptions(endpoint);

COMMIT;
