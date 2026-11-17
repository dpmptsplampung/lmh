// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const path = 'supabase/migrations/202611160002_pendataan_khusus_langkah.sql';
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const fungsi = (nama: string) => sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?END \\$\\$;`))?.[0] ?? '';

describe('kontrak migrasi G5 pendataan dua langkah', () => {
  it('menyediakan draf per tiket tanpa hak tulis langsung klien', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.pendataan_khusus_draf');
    expect(sql).toMatch(/tiket_id\s+uuid\s+PRIMARY KEY/);
    expect(sql).toContain('ALTER TABLE public.pendataan_khusus_draf ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('GRANT SELECT ON TABLE public.pendataan_khusus_draf TO authenticated');
    expect(sql).not.toMatch(/GRANT (?:ALL|INSERT|UPDATE|DELETE)[^;]*pendataan_khusus_draf[^;]*authenticated/);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });

  it('menjaga signature pemanggil lama dan jalur formulir tetap/chat', () => {
    const lama = readFileSync('supabase/migrations/202611010003_identitas_satu_kesatuan.sql', 'utf8');
    const headerLama = lama.match(/CREATE OR REPLACE FUNCTION public\.layanan_selesai_khusus\([\s\S]*?\)\s*RETURNS jsonb/)?.[0];
    const headerBaru = fungsi('layanan_selesai_khusus').match(/CREATE OR REPLACE FUNCTION[\s\S]*?\)\s*RETURNS jsonb/)?.[0];
    expect(headerBaru?.replace(/\s+/g, ' ')).toBe(headerLama?.replace(/\s+/g, ' '));
    expect(fungsi('layanan_mulai')).toContain('public.layanan_mulai(p_tiket_id uuid)');
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.pendataan_khusus_validasi\(/);
    for (const [nama, asal] of [
      ['layanan_selesai', '202610140015_pendataan_tanpa_topik_email_opsional.sql'],
      ['chat_selesai', '202610310002_chat_luar_jam.sql'],
    ]) {
      const lama = readFileSync(`supabase/migrations/${asal}`, 'utf8');
      const inti = lama.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?END \\$\\$;`))?.[0];
      expect(fungsi(`${nama}_inti`)).toBe(inti?.replace(`public.${nama}(`, `public.${nama}_inti(`));
      const args = nama === 'layanan_selesai' ? 'uuid,text,jsonb,uuid,text' : 'uuid,uuid,text';
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${nama}_inti(${args}) FROM PUBLIC, anon, authenticated, service_role`);
      expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.${nama}_inti`);
      expect(fungsi(nama)).toContain(`public.${nama}_khusus(`);
      expect(fungsi(`${nama}_khusus`)).toContain(`public.${nama}_inti(`);
      expect(fungsi(`${nama}_khusus`)).not.toContain(`public.${nama}(`);
      expect(fungsi(`${nama}_khusus`)).toContain('DELETE FROM public.pendataan_khusus_draf');
    }
  });

  it('membatasi seluruh RPC ke authenticated dengan search_path tetap', () => {
    for (const [nama, argumen] of [
      ['layanan_mulai', 'uuid'],
      ['pendataan_khusus_draf_simpan', 'uuid,jsonb'],
      ['pendataan_khusus_draf_baca', 'uuid'],
      ['pendataan_khusus_definisi', 'uuid'],
      ['layanan_selesai_khusus', 'uuid,uuid,text,jsonb,jsonb'],
    ]) {
      expect(fungsi(nama), nama).toContain('SECURITY DEFINER');
      expect(fungsi(nama), nama).toContain('SET search_path = pg_catalog, public');
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${nama}(${argumen}) FROM PUBLIC, anon, authenticated`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${nama}(${argumen}) TO authenticated`);
    }
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.pendataan_khusus_penanganan_pastikan(uuid) FROM PUBLIC, anon, authenticated');
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.pendataan_khusus_penanganan_pastikan/);
  });

  it('mewajibkan sesi dan kepemilikan serta mengunci dalam urutan kunjungan-tiket-tahap', () => {
    const f = fungsi('pendataan_khusus_penanganan_pastikan');
    expect(f).toContain('public.sesi_valid()');
    expect(f).toContain('v_t.dilayani_oleh IS DISTINCT FROM v_me.id');
    expect(f).toContain('v_me.layanan_id IS DISTINCT FROM v_t.layanan_id');
    expect(f.indexOf('WHERE k.id = v_kid FOR UPDATE')).toBeLessThan(f.indexOf('WHERE t.id = p_tiket FOR UPDATE'));
    expect(f.indexOf('WHERE t.id = p_tiket FOR UPDATE')).toBeLessThan(f.indexOf("p.status IN ('menunggu', 'berjalan') FOR UPDATE"));
    expect(fungsi('pendataan_khusus_draf_baca')).toContain('public.boleh_baca_pendataan(p_tiket, NULL)');
  });

  it('saklar hanya mengatur pengisian dan mempertahankan historis ekspor', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS pendataan_khusus_aktif boolean NOT NULL DEFAULT true');
    const f = fungsi('pendataan_khusus_definisi');
    expect(f).toContain('AND NOT f.tersembunyi AND l.pendataan_khusus_aktif');
    expect(f).toContain('ORDER BY f.urut, f.created_at, f.id LIMIT 40');
    expect(sql).not.toMatch(/(?:DELETE FROM|UPDATE|ALTER TABLE) public\.pendataan_khusus_(?:field|jawaban)\b/);
    expect(fungsi('pendataan_khusus_draf_simpan')).not.toContain('pernah_diisi');
  });

  it('fallback topik memakai seed layanan dan catatan sistem eksplisit', () => {
    const f = fungsi('layanan_selesai_khusus');
    expect(f).toContain("t.layanan_id = v_layanan AND t.aktif AND pg_catalog.lower(pg_catalog.btrim(t.nama)) = 'lainnya'");
    expect(f).toContain('TOPIK_SISTEM_TIDAK_ADA:');
    expect(f).toContain('Diisi sistem: Pendataan Khusus telah diisi');
    expect(f).not.toMatch(/INSERT INTO public\.topik_penanganan/);
  });
});
