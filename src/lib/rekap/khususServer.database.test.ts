// @vitest-environment node
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';
import { muatJawabanKhusus } from './khususServer';
import { lampirkanKhusus } from './khusus';
import { buatWorkbookTerpadu } from './exportTerpadu';
import { petaBarisPelayanan } from './terpadu';
import { petaFieldKhusus } from '@/lib/pendataan-khusus/jenis';

let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
const fo = randomUUID(), pembuat = randomUUID(), petugasLain = randomUUID();
const layanan = randomUUID(), layananLain = randomUUID(), kunjungan = randomUUID();
const tiket = randomUUID(), pelayanan = randomUUID(), field = randomUUID();
const stafFo = randomUUID(), stafPembuat = randomUUID(), stafLain = randomUUID();
const petugasLayanan = randomUUID(), admin = randomUUID(), nonaktif = randomUUID();
const pelayananLain = randomUUID();
const klien = (uid: string) => ({ rpc: async (nama: string, args: { p_penanganan: string[] }) => {
  if (nama !== 'rekap_khusus_peta') throw new Error(`RPC tak diharapkan: ${nama}`);
  const r = await sebagai(db, 'authenticated', uid, `SELECT ${nama}($1::uuid[]) AS hasil`, [args.p_penanganan]);
  return r.ok ? { data: r.rows[0]?.hasil, error: null } : { data: null, error: { code: r.kode, message: r.pesan } };
} }) as unknown as SupabaseClient;

beforeAll(async () => {
  console.log('Host tujuan: PGlite lokal dalam memori; data sintetis.');
  db = await bukaDbPenuh({ sampai: '202611160003' });
  const seed = await sebagai(db, 'postgres', null, `
    SET TIME ZONE 'Asia/Jakarta';
    SET session_replication_role=replica;
    INSERT INTO auth.users(id) VALUES ('${fo}'),('${pembuat}'),('${petugasLain}'),('${petugasLayanan}'),('${admin}'),('${nonaktif}');
    INSERT INTO layanan(id,nama,slug,prefiks_antrean) VALUES
      ('${layanan}','Khusus Ekspor','khusus-ekspor','KE'),('${layananLain}','Lain','khusus-lain','KL');
    INSERT INTO petugas(id,auth_user_id,nama,role,layanan_id,aktif) VALUES
      ('${stafFo}','${fo}','FO pembaca','front_office',NULL,true),
      ('${stafPembuat}','${pembuat}','FO pencatat','front_office',NULL,true),
      ('${stafLain}','${petugasLain}','Petugas lain','petugas','${layananLain}',true),
      ('${randomUUID()}','${petugasLayanan}','Petugas layanan','petugas','${layanan}',true),
      ('${randomUUID()}','${admin}','Admin','admin',NULL,true),
      ('${randomUUID()}','${nonaktif}','Nonaktif','front_office',NULL,false);
    INSERT INTO kunjungan(id,nama,asal,tanggal,status,dibuat_oleh,qr_token) VALUES
      ('${kunjungan}','Pengunjung sintetis','walk_in',current_date,'selesai','${stafPembuat}','ekspor-sintetis');
    INSERT INTO tiket_antrean(id,kunjungan_id,layanan_id,tanggal,nomor,nomor_display,status,waktu_selesai) VALUES
      ('${tiket}','${kunjungan}','${layanan}',current_date,1,'KE-001','selesai',now());
    INSERT INTO penanganan(id,kunjungan_id,tiket_id,layanan_id,peran_tahap,tahap_ke,saluran,status,hasil,mulai_at,selesai_at,penangan_id,topik,catatan) VALUES
      ('${pelayanan}','${kunjungan}','${tiket}','${layanan}','layanan',1,'walk_in','selesai','selesai',now(),now(),'${stafPembuat}','Topik sintetis','Catatan sintetis'),
      ('${pelayananLain}','${kunjungan}',NULL,'${layananLain}','layanan',2,'chat','selesai','selesai',now(),now(),'${stafLain}','Topik lain','Catatan lain');
    INSERT INTO pendataan_khusus_field(id,layanan_id,label,jenis,wajib,urut,pernah_diisi) VALUES
      ('${field}','${layanan}','Nomor Berkas','teks_singkat',true,1,true);
    INSERT INTO pendataan_khusus_jawaban(penanganan_id,field_id,nilai,label_snapshot,jenis_snapshot) VALUES
      ('${pelayanan}','${field}','"BERKAS-LINTAS-FO"','Nomor Berkas','teks_singkat');
    SET session_replication_role=origin;
  `);
  expect(seed.ok, seed.pesan).toBe(true);
}, 30000);
afterAll(async () => { await db?.close(); });

describe('rekap Khusus melalui lingkup RPC dan RLS asli', () => {
  it('FO bukan pencatat mengekspor jawaban terisi hingga sel workbook tanpa SELECT tabel sensitif', async () => {
    const langsung = await sebagai(db, 'authenticated', fo, 'SELECT * FROM pendataan_khusus_jawaban');
    expect(langsung).toMatchObject({ ok: true, rows: [] });
    const rekap = await sebagai(db, 'authenticated', fo,
      'SELECT rekap_data_pelayanan(current_date,current_date,NULL,NULL,1000,0,NULL,false) AS hasil');
    expect(rekap.ok, rekap.pesan).toBe(true);
    const rows = rekap.rows[0].hasil.rows.map(petaBarisPelayanan);
    expect(rows.map((r: { pelayanan_id: string }) => r.pelayanan_id)).toContain(pelayanan);
    const jawaban = await muatJawabanKhusus(klien(fo), [pelayanan]);
    expect(jawaban.get(pelayanan)?.[field]).toBe('BERKAS-LINTAS-FO');
    const buf = await buatWorkbookTerpadu(lampirkanKhusus(rows, jawaban), [{ id: layanan, nama: 'Khusus Ekspor',
      form_pendataan: null, fields: [petaFieldKhusus({ id: field, layanan_id: layanan, label: 'Nomor Berkas', jenis: 'teks_singkat', urut: 1 })] }],
    { dari: '2026-11-17', sampai: '2026-11-17', filter: 'Semua', lingkup: 'Semua', truncated: false }, 'front_office');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.getWorksheet('Khusus Ekspor')?.getRow(2).values).toContain('BERKAS-LINTAS-FO');
    const audit = await sebagai(db, 'postgres', null,
      "SELECT count(*)::integer AS n FROM audit_log WHERE actor_id=$1 AND aksi='lihat_data' AND entitas='rekap_khusus'", [fo]);
    expect(audit.rows[0]?.n).toBe(1);
  });

  it('petugas layanan lain, ID campuran/tidak dikenal dan batch terlalu besar ditolak', async () => {
    await expect(muatJawabanKhusus(klien(petugasLain), [pelayanan])).rejects.toMatchObject({ code: '42501' });
    await expect(muatJawabanKhusus(klien(fo), [pelayanan, randomUUID()])).rejects.toMatchObject({ code: '42501' });
    await expect(muatJawabanKhusus(klien(petugasLayanan), [pelayanan, pelayananLain])).rejects.toMatchObject({ code: '42501' });
    const besar = await sebagai(db, 'authenticated', fo, 'SELECT rekap_khusus_peta($1::uuid[])', [Array(501).fill(pelayanan)]);
    expect(besar).toMatchObject({ ok: false, kode: '22023' });
    expect(await sebagai(db, 'authenticated', petugasLain, 'SELECT * FROM pendataan_khusus_jawaban'))
      .toMatchObject({ ok: true, rows: [] });
  });

  it('admin, FO pencatat, dan petugas satu layanan tetap membaca jawaban', async () => {
    for (const uid of [admin, pembuat, petugasLayanan]) {
      expect((await muatJawabanKhusus(klien(uid), [pelayanan])).get(pelayanan)?.[field]).toBe('BERKAS-LINTAS-FO');
    }
    const denganNull = await sebagai(db, 'authenticated', fo, 'SELECT rekap_khusus_peta($1::uuid[])', [[pelayanan, null]]);
    expect(denganNull).toMatchObject({ ok: false, kode: '42501' });
  });

  it('anon, akun nonaktif, bukan staf, serta sesi digantikan ditolak', async () => {
    expect(await sebagai(db, 'anon', null, 'SELECT rekap_khusus_peta($1::uuid[])', [[pelayanan]]))
      .toMatchObject({ ok: false, kode: '42501' });
    for (const uid of [nonaktif, randomUUID()]) {
      await expect(muatJawabanKhusus(klien(uid), [pelayanan])).rejects.toMatchObject({ code: '42501' });
    }
    await db.query('INSERT INTO sesi_staf(user_id,session_id) VALUES($1,$2)', [fo, randomUUID()]);
    try {
      await expect(muatJawabanKhusus(klien(fo), [pelayanan])).rejects.toMatchObject({ code: '42501', message: expect.stringContaining('SESI_TIDAK_SAH:') });
    } finally {
      await db.query('DELETE FROM sesi_staf WHERE user_id=$1', [fo]);
    }
  });

  it('kegagalan audit menolak pembacaan batch lintas pembuat', async () => {
    await db.exec(`CREATE FUNCTION public.g2d_audit_gagal() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.entitas='rekap_khusus' THEN RAISE EXCEPTION 'audit sintetis gagal'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER g2d_audit_gagal BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.g2d_audit_gagal();`);
    try {
      await expect(muatJawabanKhusus(klien(fo), [pelayanan])).rejects.toMatchObject({ message: 'audit sintetis gagal' });
    } finally {
      await db.exec('DROP TRIGGER g2d_audit_gagal ON audit_log; DROP FUNCTION public.g2d_audit_gagal()');
    }
  });
});
