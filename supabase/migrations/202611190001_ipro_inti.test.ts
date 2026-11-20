// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const path = 'supabase/migrations/202611190001_ipro_inti.sql';
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const fungsi = (nama: string) => sql.match(new RegExp(`CREATE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`))?.[0] ?? '';
const policy = (nama: string) => sql.match(new RegExp(`CREATE POLICY ${nama}\\b[\\s\\S]*?;`))?.[0] ?? '';

describe('kontrak inti IPRO', () => {
  it('menyediakan dua tabel dan membatasi FOILA ke host resmi dengan URL wajib', () => {
    expect(sql).toContain('CREATE TABLE public.ipro_proyek');
    expect(sql).toContain('CREATE TABLE public.ipro_gambar');
    expect(sql).toContain('CONSTRAINT ipro_sumber_sah CHECK');
    expect(sql).toContain("sumber = 'foila' AND sumber_url IS NOT NULL");
    expect(sql).toContain("sumber_url ~ '^https://invest\\.lampungprov\\.go\\.id/[^[:space:]]*$'");
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });

  it('membatasi isi kartu FOILA dan menolak URL dengan host atau protokol lain', () => {
    const sumber = sql.match(/CONSTRAINT ipro_sumber_sah CHECK[\s\S]*?CONSTRAINT ipro_terbit_bertanggal/)?.[0] ?? '';
    expect(sumber).toContain("sumber = 'ptsp' AND sumber_url IS NULL AND sumber_slug IS NULL");
    for (const kolom of ['deskripsi', 'deskripsi_en', 'dokumen_id', 'kontak_instansi', 'kontak_email', 'kontak_telepon']) {
      expect(sumber).toContain(`${kolom} IS NULL`);
    }
    expect(sql).toContain('sumber_url text CHECK (char_length(sumber_url) <= 2048)');
    expect(sql).toContain('sumber_slug text CHECK (char_length(sumber_slug) <= 300)');
    expect(sql).toContain('CREATE UNIQUE INDEX ipro_foila_unik');
    expect(sql).toContain("WHERE sumber = 'foila' AND sumber_slug IS NOT NULL");
  });

  it('menjaga slug, status, sektor, panjang teks dan seluruh kolom terjemahan', () => {
    for (const token of [
      "sumber IN ('ptsp', 'foila')", "status IN ('draf', 'terbit', 'arsip')",
      "slug text NOT NULL UNIQUE", "slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'",
      'char_length(slug) BETWEEN 3 AND 120', 'char_length(btrim(judul)) BETWEEN 3 AND 200',
      'char_length(btrim(judul_en)) BETWEEN 3 AND 200',
      'char_length(btrim(ringkasan)) BETWEEN 1 AND 600', 'char_length(btrim(ringkasan_en)) BETWEEN 1 AND 600',
      'char_length(deskripsi) <= 20000', 'char_length(deskripsi_en) <= 20000',
      'char_length(btrim(kab_kota)) BETWEEN 3 AND 60', 'char_length(lokasi_teks) <= 300',
      'char_length(pemilik) <= 200', 'char_length(perizinan) <= 2000',
      "'pertanian', 'perikanan', 'pariwisata', 'industri', 'energi', 'infrastruktur', 'kawasan', 'jasa', 'lainnya'",
    ]) expect(sql).toContain(token);
  });

  it('memvalidasi koordinat berpasangan dan ukuran finansial tanpa asumsi mata uang tunggal', () => {
    for (const token of [
      'lat numeric(9,6) CHECK (lat BETWEEN -6.6 AND -3.0)',
      'lng numeric(9,6) CHECK (lng BETWEEN 103.0 AND 106.6)',
      'CHECK ((lat IS NULL) = (lng IS NULL))',
      'nilai_investasi numeric(18,0) CHECK (nilai_investasi >= 0)',
      "mata_uang text NOT NULL DEFAULT 'IDR' CHECK (mata_uang IN ('IDR', 'USD'))",
      'nilai_teks text CHECK (char_length(nilai_teks) <= 200)', 'npv_nilai numeric(18,0)',
      'irr_persen numeric(6,2) CHECK (irr_persen BETWEEN -100 AND 1000)',
      'payback_bulan integer CHECK (payback_bulan BETWEEN 1 AND 600)',
      'luas_ha numeric(12,2) CHECK (luas_ha > 0)',
      "skema IN ('kpbu', 'b2b', 'bumd', 'swasta_penuh', 'lainnya')",
      "'milik_pemda', 'milik_bumn_bumd', 'milik_swasta', 'milik_masyarakat', 'belum_ditetapkan'",
      "tahap_kajian IN ('pra_fs', 'fs', 'ipro')",
    ]) expect(sql).toContain(token);
    expect(sql).not.toMatch(/\b(?:nilai_rp|npv_rp)\b/);
    expect(sql).not.toMatch(/CHECK\s*\(npv_nilai\s*>=/);
  });

  it('menyimpan kontak lembaga saja dan memakai FK serta indeks untuk relasi', () => {
    expect(sql).toContain('kontak_instansi text CHECK (char_length(kontak_instansi) <= 200)');
    expect(sql).toContain('char_length(kontak_email) <= 254');
    expect(sql).toContain("kontak_email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'");
    expect(sql).toContain("kontak_telepon ~ '^\\+?[0-9][0-9 \\-]{5,19}$'");
    expect(sql).toContain('dilarang mengisi nomor pribadi petugas');
    expect(sql).not.toMatch(/(?:no_hp|telepon_pribadi|email_pribadi)\s+text/);
    expect(sql).toContain('dokumen_id uuid REFERENCES public.investment_documents(id) ON DELETE SET NULL');
    for (const indeks of ['ipro_publik_urut', 'ipro_sektor', 'ipro_kab_kota', 'ipro_dokumen', 'ipro_pembuat', 'ipro_pengubah']) {
      expect(sql).toContain(`CREATE INDEX ${indeks} ON public.ipro_proyek`);
    }
  });

  it('menyimpan kunci WebP, alt wajib, dimensi terbatas dan satu gambar utama', () => {
    for (const token of [
      'proyek_id uuid NOT NULL REFERENCES public.ipro_proyek(id) ON DELETE CASCADE',
      "kunci text NOT NULL UNIQUE CHECK (kunci ~ '^ipro-gambar/[0-9a-f-]{36}/[0-9a-f-]{36}\\.webp$')",
      "kunci_mini text NOT NULL UNIQUE CHECK (kunci_mini ~ '^ipro-gambar/[0-9a-f-]{36}/[0-9a-f-]{36}-640\\.webp$')",
      'lebar integer NOT NULL CHECK (lebar BETWEEN 1 AND 4000)',
      'tinggi integer NOT NULL CHECK (tinggi BETWEEN 1 AND 4000)',
      'alt text NOT NULL CHECK (char_length(btrim(alt)) BETWEEN 3 AND 200)',
      'char_length(btrim(alt_en)) BETWEEN 3 AND 200',
      'char_length(keterangan) <= 300', 'char_length(keterangan_en) <= 300',
      'CREATE UNIQUE INDEX ipro_gambar_satu_utama ON public.ipro_gambar(proyek_id) WHERE utama',
      'CREATE INDEX ipro_gambar_proyek ON public.ipro_gambar(proyek_id, urutan)',
    ]) expect(sql).toContain(token);
  });

  it('mengikat pengelola ke admin bersesi valid atau petugas modul investasi, tanpa FO', () => {
    const f = fungsi('boleh_kelola_investasi');
    expect(f).toContain('LANGUAGE sql STABLE SECURITY DEFINER');
    expect(f).toContain('SET search_path = pg_catalog, public');
    expect(f).toContain("public.get_my_role() = 'admin' AND public.sesi_valid()");
    expect(f).toContain("public.staf_modul() = 'investasi'");
    expect(f).not.toMatch(/front_office|is_ptsp_staff/);
    expect(sql).toContain("to_regprocedure('public.staf_modul()') IS NULL");
    expect(sql).toContain('202611160001_lingkup_layanan_staf wajib tersedia');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.boleh_kelola_investasi() FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.boleh_kelola_investasi() TO authenticated');
  });

  it('publik hanya membaca terbit dan pengelola hanya menghapus draf', () => {
    for (const tabel of ['ipro_proyek', 'ipro_gambar']) expect(sql).toContain(`ALTER TABLE public.${tabel} ENABLE ROW LEVEL SECURITY`);
    expect(sql).toContain('REVOKE ALL ON TABLE public.ipro_proyek, public.ipro_gambar FROM PUBLIC, anon, authenticated');
    expect(policy('ipro_publik_baca')).toContain("FOR SELECT TO anon, authenticated\n  USING (status = 'terbit')");
    for (const nama of ['ipro_kelola_baca', 'ipro_kelola_tambah', 'ipro_kelola_ubah', 'ipro_kelola_hapus', 'ipro_gambar_kelola']) {
      expect(policy(nama)).toContain('(SELECT public.boleh_kelola_investasi())');
    }
    for (const nama of ['ipro_kelola_ubah', 'ipro_gambar_kelola']) {
      expect(policy(nama)).toContain('USING ((SELECT public.boleh_kelola_investasi()))');
      expect(policy(nama)).toContain('WITH CHECK ((SELECT public.boleh_kelola_investasi()))');
    }
    expect(policy('ipro_kelola_hapus')).toContain("AND status = 'draf'");
    expect(policy('ipro_gambar_publik')).toContain("p.id = proyek_id AND p.status = 'terbit'");
    for (const grant of sql.matchAll(/GRANT\s+[^;]+;/g)) {
      if (/\bTO\s+anon\b/.test(grant[0])) expect(grant[0]).toMatch(/^GRANT SELECT\s*\(/);
    }
  });

  it('hak baca kedua role hanya mencakup kolom publik, tanpa UUID staf atau SELECT tabel penuh', () => {
    const grants = [...sql.matchAll(/GRANT\s+[^;]+;/g)].map(([grant]) => grant);
    for (const tabel of ['ipro_proyek', 'ipro_gambar']) {
      const definisi = sql.match(new RegExp(`CREATE TABLE public\\.${tabel} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? '';
      const kolomPublik = [...definisi.matchAll(/^  (\w+) (?:uuid|text|numeric|integer|boolean|timestamptz)\b/gm)]
        .map(([, kolom]) => kolom).filter((kolom) => !['dibuat_oleh', 'diubah_oleh'].includes(kolom));
      expect(kolomPublik.length).toBeGreaterThan(10);
      const baca = grants.filter((grant) => new RegExp(`ON (?:TABLE )?public\\.${tabel}\\b`).test(grant)
        && /TO\s+anon,\s*authenticated;/.test(grant));
      expect(baca).toHaveLength(1);
      const kolom = baca[0].match(/^GRANT SELECT\s*\(([^)]+)\)/)?.[1].split(',').map((k) => k.trim()) ?? [];
      expect(kolom.sort()).toEqual(kolomPublik.sort());
      expect(kolom).not.toContain('dibuat_oleh');
      expect(kolom).not.toContain('diubah_oleh');
    }
    // Seluruh grant ke role publik dibatasi SELECT per kolom, termasuk grant terpisah.
    for (const grant of grants.filter((g) => /\bTO\b[^;]*\b(?:anon|authenticated|PUBLIC)\b/.test(g)
      && /\bON\s+(?:TABLE\s+)?public\.ipro_(?:proyek|gambar)\b/.test(g))) {
      if (/^GRANT INSERT, UPDATE, DELETE /.test(grant)) {
        expect(grant).toMatch(/TO authenticated;$/);
      } else {
        expect(grant).toMatch(/^GRANT SELECT\s*\(/);
        expect(grant).not.toMatch(/\b(?:dibuat_oleh|diubah_oleh)\b/);
        expect(grant).not.toMatch(/\bTO\b[^;]*\bPUBLIC\b/);
      }
    }
    expect(sql).toContain('GRANT INSERT, UPDATE, DELETE ON TABLE public.ipro_proyek, public.ipro_gambar TO authenticated');
    expect(sql).toContain('select=*');
    expect(sql).toContain('kolom eksplisit');
  });

  it('audit otomatis menjaga sumber, versi, pembuat dan tanggal terbit yang mengunci slug', () => {
    const f = fungsi('ipro_isi_audit');
    for (const token of [
      'SECURITY DEFINER SET search_path = pg_catalog, public',
      'p.auth_user_id = auth.uid() AND p.aktif', 'NEW.sumber IS DISTINCT FROM OLD.sumber',
      "RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE = '22023'",
      'OLD.diterbitkan_pada IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug',
      "RAISE EXCEPTION 'SLUG_TERKUNCI' USING ERRCODE = '22023'",
      'NEW.versi := OLD.versi + 1', 'NEW.dibuat_oleh := OLD.dibuat_oleh',
      'IF NOT EXISTS (SELECT 1 FROM public.petugas AS p WHERE p.id = OLD.dibuat_oleh)',
      'NEW.dibuat_oleh := NULL',
      'NEW.dibuat_pada := OLD.dibuat_pada', 'NEW.diterbitkan_pada := OLD.diterbitkan_pada',
      'NEW.diubah_oleh := v_petugas', 'NEW.diubah_pada := now()',
      "NEW.status = 'terbit' AND NEW.diterbitkan_pada IS NULL", 'NEW.diterbitkan_pada := now()',
    ]) expect(f).toContain(token);
    expect(sql).toContain('versi integer NOT NULL DEFAULT 1 CHECK (versi > 0)');
    expect(sql).toContain("CHECK (status <> 'terbit' OR diterbitkan_pada IS NOT NULL)");
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public.ipro_proyek');
    expect(sql).toContain('AFTER UPDATE OF status ON public.ipro_proyek');
    expect(sql).toContain("EXECUTE FUNCTION public.audit_change('update_status')");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ipro_isi_audit() FROM PUBLIC, anon, authenticated, service_role');
  });

  it('hanya migrasi maju tanpa kontrol transaksi atau penghancuran tabel', () => {
    expect(sql).not.toMatch(/\b(?:DROP TABLE|TRUNCATE|DROP SCHEMA)\b/i);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });
});
