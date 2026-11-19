// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const path = 'supabase/migrations/202611190002_investasi_kotak_masuk.sql';
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const fungsi = (nama: string) => sql.match(new RegExp(`CREATE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`))?.[0] ?? '';

describe('kontrak kotak masuk investasi', () => {
  it('backfill tidak mengubah updated_at lama dan mengaktifkan kembali trigger', () => {
    const nonaktif = sql.indexOf('DISABLE TRIGGER trg_investasi_lead_updated');
    const backfill = sql.indexOf('UPDATE public.investasi_lead SET aktivitas_pada = updated_at;');
    const aktif = sql.indexOf('ENABLE TRIGGER trg_investasi_lead_updated');
    expect(nonaktif).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(nonaktif);
    expect(aktif).toBeGreaterThan(backfill);
  });

  it('menerima pesan hanya lewat RPC atomik dengan consent dan tiga batas laju', () => {
    expect(sql).toContain('CREATE FUNCTION public.investasi_kirim_minat(');
    expect(sql).toContain('DROP POLICY IF EXISTS investasi_lead_insert');
    expect(sql).toContain('INSERT INTO public.consent_log');
    expect(sql).toContain("public.check_anon_rate('investasi_lead_insert', 5, 3600)");
    expect(sql).toContain("public.check_anon_rate('investasi_lead_insert', 20, 86400)");
    expect(sql).toContain("created_at > now() - interval '600 seconds') >= 100");
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });

  it('memperluas tabel lama secara kompatibel dengan kanal dan relasi nullable', () => {
    for (const token of [
      "ADD COLUMN kanal text NOT NULL DEFAULT 'dokumen' CHECK (kanal IN ('dokumen', 'ipro'))",
      'ADD COLUMN ipro_id uuid REFERENCES public.ipro_proyek(id) ON DELETE SET NULL',
      "ADD COLUMN no_hp text CHECK (no_hp ~ '^\\+?[0-9]{8,20}$')",
      'ADD COLUMN aktor_uid uuid', 'ADD COLUMN operasi_id uuid', 'ADD COLUMN sidik text',
      'ADD COLUMN consent_id uuid REFERENCES public.consent_log(id) ON DELETE SET NULL',
      'ADD COLUMN petugas_id uuid REFERENCES public.petugas(id) ON DELETE SET NULL',
      'ADD COLUMN versi integer NOT NULL DEFAULT 1 CHECK (versi > 0)',
      'ADD COLUMN aktivitas_pada timestamptz NOT NULL DEFAULT now()',
      "(kanal = 'ipro' AND doc_id IS NULL) OR (kanal = 'dokumen' AND ipro_id IS NULL)",
      'CREATE UNIQUE INDEX investasi_lead_operasi ON public.investasi_lead(aktor_uid, operasi_id)',
      'WHERE operasi_id IS NOT NULL', '(kanal, status, created_at DESC)',
    ]) expect(sql).toContain(token);
    expect(sql).not.toMatch(/ADD COLUMN aktor_uid[^;\n]*REFERENCES auth/);
    for (const kolom of ['ipro_id', 'petugas_id', 'consent_id', 'aktivitas_pada']) {
      expect(sql).toContain(`ON public.investasi_lead(${kolom})`);
    }
  });

  it('menutup insert/update langsung dan membatasi baca PII ke pengelola investasi', () => {
    for (const nama of ['investasi_lead_insert', 'investasi_lead_select_staff', 'investasi_lead_update_admin']) {
      expect(sql).toContain(`DROP POLICY IF EXISTS ${nama} ON public.investasi_lead`);
    }
    expect(sql).toContain('REVOKE ALL ON TABLE public.investasi_lead FROM PUBLIC, anon');
    expect(sql).toMatch(/REVOKE INSERT, UPDATE[^;]*ON TABLE public\.investasi_lead FROM authenticated/);
    expect(sql).toContain('GRANT SELECT ON TABLE public.investasi_lead TO authenticated');
    expect(sql).toMatch(/CREATE POLICY investasi_lead_select_staff[^;]*USING \(\(SELECT public\.boleh_kelola_investasi\(\)\)\)/);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR (?:INSERT|UPDATE|ALL)|GRANT (?:INSERT|UPDATE|ALL)[^;]*investasi_lead/);
  });

  it('kedua RPC memakai search_path tetap dan execute hanya authenticated', () => {
    for (const [nama, tipe] of [
      ['investasi_kirim_minat', 'text, uuid, text, text, text, text, text, boolean, text, uuid'],
      ['investasi_ubah_status_minat', 'uuid, text, integer'],
    ]) {
      expect(fungsi(nama)).toContain('LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp');
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${nama}(${tipe})\n  FROM PUBLIC, anon, authenticated, service_role`);
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${nama}\\([^;]*\\)\\s+TO authenticated;`));
    }
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*TO (?:anon|PUBLIC|service_role)/);
  });

  it('RPC memvalidasi sesi, consent, konteks dan panjang input dengan galat eksplisit', () => {
    const f = fungsi('investasi_kirim_minat');
    for (const token of [
      'v_uid uuid := auth.uid()', 'IF v_uid IS NULL', "'LOGIN_DIPERLUKAN' USING ERRCODE = '28000'",
      'NOT public.sesi_valid()', "'DILARANG' USING ERRCODE = '42501'",
      "p_kanal NOT IN ('ipro', 'dokumen')", 'p_operasi_id IS NULL OR p_ref_id IS NULL',
      'char_length(v_nama) NOT BETWEEN 1 AND 200', 'v_email IS NULL OR char_length(v_email) > 254',
      "v_email !~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'",
      "regexp_replace(p_no_hp, '[[:space:].()\\-]', '', 'g')", "v_nomor !~ '^\\+?[0-9]{8,20}$'",
      'char_length(v_instansi) > 200', 'char_length(v_pesan) > 2000',
      "p_kanal = 'ipro' AND (v_pesan IS NULL OR char_length(v_pesan) < 10)",
      'p_setuju_pdp IS NOT TRUE', 'v_kebijakan IS NULL OR char_length(v_kebijakan) NOT BETWEEN 1 AND 20',
      "'INPUT_TIDAK_VALID' USING ERRCODE = '22023'", "p.status = 'terbit' AND p.sumber = 'ptsp'",
      "d.status = 'aktif'", "'TIDAK_DITEMUKAN' USING ERRCODE = 'P0002'",
    ]) expect(f).toContain(token);
  });

  it('retry tervalidasi mengunci operasi dan mengembalikan id sebelum konteks/laju/consent', () => {
    const f = fungsi('investasi_kirim_minat');
    expect(f).toContain('pg_advisory_xact_lock(hashtextextended(v_uid::text || p_operasi_id::text, 0))');
    expect(f).toContain('l.aktor_uid = v_uid AND l.operasi_id = p_operasi_id');
    expect(f).toContain('md5(jsonb_build_object(');
    for (const field of ['kanal', 'ref_id', 'nama', 'email', 'no_hp', 'instansi', 'pesan', 'setuju_pdp', 'versi_kebijakan']) {
      expect(f).toContain(`'${field}',`);
    }
    expect(f).toContain('v_lama.sidik IS DISTINCT FROM v_sidik');
    expect(f).toContain("'KONFLIK_OPERASI' USING ERRCODE = '40001'");
    // Retry tetap sah setelah konteks diarsipkan; hanya operasi baru memeriksa konteks.
    const urutan = [
      'IF v_uid IS NULL', 'NOT public.sesi_valid()',
      "'INPUT_TIDAK_VALID' USING ERRCODE = '22023'", 'v_sidik := md5(',
      'pg_advisory_xact_lock(hashtextextended(v_uid::text || p_operasi_id::text, 0))',
      'SELECT l.* INTO v_lama', 'v_lama.sidik IS DISTINCT FROM v_sidik',
      "'KONFLIK_OPERASI' USING ERRCODE = '40001'",
      "RETURN jsonb_build_object('id', v_lama.id)",
      'SELECT p.judul INTO v_judul', 'SELECT d.judul INTO v_judul',
      "'TIDAK_DITEMUKAN' USING ERRCODE = 'P0002'",
      "hashtextextended('investasi.laju', 0)", 'public.check_anon_rate(',
      'INSERT INTO public.consent_log', 'INSERT INTO public.investasi_lead',
    ].map((token) => {
      const posisi = f.indexOf(token);
      expect(posisi, token).toBeGreaterThan(-1);
      return posisi;
    });
    for (let i = 1; i < urutan.length; i++) expect(urutan[i]).toBeGreaterThan(urutan[i - 1]);
    for (const [field, nilai] of [
      ['nama', 'v_nama'], ['email', 'v_email'], ['no_hp', 'v_nomor'],
      ['instansi', 'v_instansi'], ['pesan', 'v_pesan'], ['versi_kebijakan', 'v_kebijakan'],
    ]) expect(f).toContain(`'${field}', ${nilai}`);
    const ulang = f.indexOf("RETURN jsonb_build_object('id', v_lama.id)");
    const laju = f.indexOf("hashtextextended('investasi.laju', 0)");
    expect(ulang).toBeGreaterThan(-1);
    expect(laju).toBeGreaterThan(ulang);
    expect(f.indexOf('INSERT INTO public.consent_log')).toBeGreaterThan(laju);
    expect(f).not.toContain('INSERT INTO public.anon_rate_limit');
    expect(sql).not.toMatch(/DROP TRIGGER[^;]*trg_log_investasi_lead_insert/);
    expect(f).toContain("'TERLALU_BANYAK' USING ERRCODE = 'P0001'");
  });

  it('consent, pesan, notifikasi dan tanda terima merupakan satu transaksi tanpa penelanan galat', () => {
    const f = fungsi('investasi_kirim_minat');
    expect(f).toContain("VALUES (v_uid::text, 'investasi_minat', true, v_kebijakan)");
    expect(f).toContain('RETURNING id INTO v_consent');
    expect(f).toContain("v_nama, v_email, v_nomor, v_instansi, v_pesan, 'baru', v_uid, p_operasi_id, v_sidik, v_consent");
    expect(f.indexOf('INSERT INTO public.investasi_lead')).toBeGreaterThan(f.indexOf('INSERT INTO public.consent_log'));
    expect(f.indexOf('INSERT INTO public.notifikasi')).toBeGreaterThan(f.indexOf('INSERT INTO public.investasi_lead'));
    expect(f).toContain("RETURN jsonb_build_object('id', v_id)");
    expect(f).not.toMatch(/EXCEPTION WHEN|jsonb_build_object\('(?:nama|email|pesan)'/);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });

  it('notifikasi tanpa PII hanya ke petugas investasi terverifikasi, fallback admin', () => {
    const f = fungsi('investasi_kirim_minat');
    const kiriman = f.slice(f.indexOf('INSERT INTO public.notifikasi'), f.indexOf('END LOOP'));
    expect(kiriman).toContain("'Pesan baru di Kotak Masuk Investasi'");
    expect(kiriman).toContain("'/petugas/investasi/kotak-masuk'");
    expect(kiriman).toContain("'/admin/investasi-leads'");
    expect(kiriman).toContain("'type', 'investasi_minat', 'lead_id', v_id, 'kanal', p_kanal");
    expect(kiriman).toContain("format('investasi_minat:%s:%s', v_id, v_penerima.id)");
    expect(kiriman).toContain('ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING');
    expect(kiriman).not.toMatch(/\b[vp]_(?:nama|email|no_hp|nomor|pesan|instansi)\b/);
    expect(f).toContain('p.aktif AND p.email_notifikasi IS NOT NULL AND p.email_notifikasi_verified_at IS NOT NULL');
    expect(f).toContain("p.role = 'petugas' AND EXISTS");
    expect(f).toContain("l.modul = 'investasi'");
    expect(f).toContain("p.role = 'admin' AND NOT EXISTS");
    expect(f).toContain('q.email_notifikasi IS NOT NULL AND q.email_notifikasi_verified_at IS NOT NULL');
    expect(f).toContain("s.key = 'public_url'");
    expect(f).not.toContain('front_office');
  });

  it('perubahan status mengunci baris, menjaga versi dan penangan pertama serta audit lama', () => {
    const f = fungsi('investasi_ubah_status_minat');
    for (const token of [
      'NOT public.boleh_kelola_investasi()', "'DILARANG' USING ERRCODE = '42501'",
      "p_status NOT IN ('baru', 'dihubungi', 'berlanjut', 'ditolak', 'selesai')", 'WHERE l.id = p_id FOR UPDATE',
      "'TIDAK_DITEMUKAN' USING ERRCODE = 'P0002'", 'p_versi IS DISTINCT FROM v_lama.versi',
      "'KONFLIK_VERSI' USING ERRCODE = '40001'", 'versi = versi + 1',
      'aktivitas_pada = clock_timestamp()', 'petugas_id = coalesce(petugas_id, v_petugas)',
      "RETURN jsonb_build_object('id', v_lama.id, 'status', v_lama.status, 'versi', v_lama.versi)",
    ]) expect(f).toContain(token);
    expect(sql).not.toMatch(/DROP TRIGGER[^;]*trg_audit_investasi_lead_status/);
  });

  it('retensi hanya terminal setelah 365 hari, batch 500, consent tetap, cron 02:25 WIB', () => {
    const f = fungsi('investasi_bersihkan_retensi');
    expect(f).toContain('SECURITY DEFINER SET search_path = pg_catalog, pg_temp');
    expect(f).toContain("pg_try_advisory_xact_lock(hashtextextended('investasi.retensi', 0))");
    expect(f).toContain("status IN ('selesai', 'ditolak') AND aktivitas_pada < now() - interval '365 days'");
    expect(f).toContain('ORDER BY aktivitas_pada, id LIMIT 500 FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.investasi_bersihkan_retensi() FROM PUBLIC, anon, authenticated, service_role');
    expect(sql).toContain("cron.schedule('investasi_retensi_harian', '25 19 * * *', 'SELECT public.investasi_bersihkan_retensi()')");
    expect(sql).not.toMatch(/DELETE FROM public\.consent_log|DROP TABLE|(?:^|;)\s*TRUNCATE\b|net\.http/i);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });
});
