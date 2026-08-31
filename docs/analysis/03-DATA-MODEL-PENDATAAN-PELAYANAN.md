# 03 — DATA MODEL: FITUR PENDATAAN PELAYANAN
**Lampung Maju Hub (LMH)**  
**Modul:** Skema Basis Data Pendataan Pelayanan  
**Dokumen Induk:** LMH-AGENT-SPEC.md

---

## 1. STRUKTUR TABEL SQL

### 1.1 Tabel `public.pelayanan_oss`
```sql
CREATE TABLE IF NOT EXISTS public.pelayanan_oss (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiket_id                uuid NOT NULL UNIQUE REFERENCES public.tiket_antrean(id) ON DELETE RESTRICT,
  kunjungan_id            uuid NOT NULL REFERENCES public.kunjungan(id) ON DELETE CASCADE,
  petugas_id              uuid NOT NULL REFERENCES public.petugas(id) ON DELETE RESTRICT,
  
  -- Identitas Pemohon
  nama_pemohon            text NOT NULL,
  alamat_pemohon          text,
  no_hp                   text,
  email                   text,
  keperluan_awal          text,
  
  -- Data Usaha & OSS
  nama_usaha              text NOT NULL,
  tipe_pelaku_usaha       text CHECK (tipe_pelaku_usaha IS NULL OR tipe_pelaku_usaha IN ('perseorangan', 'non_perseorangan')),
  status_penanaman_modal  text CHECK (status_penanaman_modal IS NULL OR status_penanaman_modal IN ('PMDN', 'PMA', 'tidak_ada')),
  lokasi_usaha            text,
  skala_usaha             text CHECK (skala_usaha IS NULL OR skala_usaha IN ('Mikro', 'Kecil', 'Menengah', 'Besar')),
  sektor_usaha_kbli       text,
  tindak_lanjut           text NOT NULL,
  uraian_solusi           text NOT NULL,
  catatan_internal        text,
  
  -- Kontrol Siklus Hidup & Kunci Data
  status_draft            text NOT NULL DEFAULT 'draft' CHECK (status_draft IN ('draft', 'selesai')),
  is_locked               boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
```

---

### 1.2 Tabel `public.pelayanan_perizinan`
```sql
CREATE TABLE IF NOT EXISTS public.pelayanan_perizinan (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiket_id                uuid NOT NULL UNIQUE REFERENCES public.tiket_antrean(id) ON DELETE RESTRICT,
  kunjungan_id            uuid NOT NULL REFERENCES public.kunjungan(id) ON DELETE CASCADE,
  petugas_id              uuid NOT NULL REFERENCES public.petugas(id) ON DELETE RESTRICT,
  
  -- Identitas Pemohon
  nama_pemohon            text NOT NULL,
  alamat_pemohon          text,
  no_hp                   text,
  email                   text,
  keperluan_awal          text,
  
  -- Substansi Perizinan DPMPTSP
  nama_perusahaan         text NOT NULL,
  opd_teknis              text NOT NULL,
  uraian_permohonan       text NOT NULL,
  tindak_lanjut           text NOT NULL,
  catatan_petugas         text,
  
  -- Kontrol Siklus Hidup & Kunci Data
  status_draft            text NOT NULL DEFAULT 'draft' CHECK (status_draft IN ('draft', 'selesai')),
  is_locked               boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
```
