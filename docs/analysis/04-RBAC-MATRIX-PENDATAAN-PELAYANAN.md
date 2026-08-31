# 04 — RBAC MATRIX: FITUR PENDATAAN PELAYANAN
**Lampung Maju Hub (LMH)**  
**Modul:** Matriks Akses Peran Pendataan Pelayanan  
**Dokumen Induk:** LMH-AGENT-SPEC.md / RBA-01..10

---

## 1. MATRIKS HAK AKSES PER PERAN

| Tindakan / Resource | Admin | Front Office (FO) | Petugas OSS | Petugas Perizinan | Petugas Lain | Pengunjung |
|---|---|---|---|---|---|---|
| **Buka Wizard Pendataan OSS** | Ya | Ya (Lihat) | **Ya (Penuh)** | Tidak | Tidak | Tidak |
| **Simpan / Autosave Draft OSS** | Ya | Tidak | **Ya (Layanan Sendiri)** | Tidak | Tidak | Tidak |
| **Selesaikan & Kunci Data OSS** | Ya | Tidak | **Ya (Layanan Sendiri)** | Tidak | Tidak | Tidak |
| **Buka Wizard Perizinan DPMPTSP**| Ya | Ya (Lihat) | Tidak | **Ya (Penuh)** | Tidak | Tidak |
| **Simpan / Autosave Draft Perizinan**| Ya | Tidak | Tidak | **Ya (Layanan Sendiri)** | Tidak | Tidak |
| **Selesaikan & Kunci Data Perizinan**| Ya | Tidak | Tidak | **Ya (Layanan Sendiri)** | Tidak | Tidak |
| **Buka Kunci Data (Unlock Override)**| **Ya** | Tidak | Tidak | Tidak | Tidak | Tidak |
| **Lihat Tab Rekap OSS & Perizinan**| **Ya** | **Ya** | Ya (Layanannya) | Ya (Layanannya) | Tidak | Tidak |
| **Ekspor CSV Laporan Pendataan** | **Ya** | **Ya** | Ya (Layanannya) | Ya (Layanannya) | Tidak | Tidak |

---

## 2. ATURAN ROW LEVEL SECURITY (RLS) DI DATABASE

### 2.1 Kebijakan pada `public.pelayanan_oss`
```sql
ALTER TABLE public.pelayanan_oss ENABLE ROW LEVEL SECURITY;

-- 1. SELECT: Admin, FO, atau Petugas yang melayani OSS
CREATE POLICY oss_read_staff ON public.pelayanan_oss
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'front_office')
    OR (
      public.get_my_role() = 'petugas'
      AND EXISTS (
        SELECT 1 FROM public.petugas p
        JOIN public.layanan l ON l.id = p.layanan_id
        WHERE p.auth_user_id = auth.uid()
          AND (l.nama ILIKE '%oss%' OR l.id = (SELECT layanan_id FROM public.tiket_antrean WHERE id = pelayanan_oss.tiket_id))
      )
    )
  );

-- 2. INSERT: Admin atau Petugas OSS
CREATE POLICY oss_insert_staff ON public.pelayanan_oss
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'petugas'
      AND petugas_id = (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())
    )
  );

-- 3. UPDATE: Admin atau Petugas OSS pemegang draf yang belum terkunci
CREATE POLICY oss_update_staff ON public.pelayanan_oss
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'petugas'
      AND is_locked = false
      AND petugas_id = (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())
    )
  );
```

### 2.2 Kebijakan pada `public.pelayanan_perizinan`
```sql
ALTER TABLE public.pelayanan_perizinan ENABLE ROW LEVEL SECURITY;

-- 1. SELECT: Admin, FO, atau Petugas Perizinan
CREATE POLICY perizinan_read_staff ON public.pelayanan_perizinan
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'front_office')
    OR (
      public.get_my_role() = 'petugas'
      AND EXISTS (
        SELECT 1 FROM public.petugas p
        JOIN public.layanan l ON l.id = p.layanan_id
        WHERE p.auth_user_id = auth.uid()
          AND (l.nama ILIKE '%perizinan%' OR l.id = (SELECT layanan_id FROM public.tiket_antrean WHERE id = pelayanan_perizinan.tiket_id))
      )
    )
  );

-- 2. INSERT: Admin atau Petugas Perizinan
CREATE POLICY perizinan_insert_staff ON public.pelayanan_perizinan
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'petugas'
      AND petugas_id = (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())
    )
  );

-- 3. UPDATE: Admin atau Petugas Perizinan pemegang draf yang belum terkunci
CREATE POLICY perizinan_update_staff ON public.pelayanan_perizinan
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'petugas'
      AND is_locked = false
      AND petugas_id = (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())
    )
  );
```
