// Pengisi LEDGER migrasi (retroaktif): mencatat migrasi yang SUDAH terpasang di produksi tetapi belum tercatat di
// supabase_migrations.schema_migrations, supaya `supabase db push` tidak mencoba menerapkannya lagi.
//
// DEFAULT = DRY-RUN (hanya mencetak apa yang akan di-INSERT; seluruh koneksi READ ONLY).
// Menulis ke DB produksi HANYA bila kedua flag diberikan:  --apply --yes
//
//   node scripts/fill-migration-ledger.mjs                 # dry-run (default)
//   node scripts/fill-migration-ledger.mjs --dry-run       # sama
//   node scripts/fill-migration-ledger.mjs --apply --yes   # BENAR-BENAR menulis (butuh konfirmasi CEO; lihat docs/MIGRATIONS.md)
//
// Aturan:
//  - Hanya migrasi berstatus `terpasang` (hasil scripts/verify-migration-ledger.mjs, dijalankan ulang di sini) yang dicatat.
//    `sebagian`, `tidak_ditemukan`, `tidak_dapat_ditentukan` (termasuk berkas no-op) TIDAK pernah dicatat oleh skrip ini.
//  - INSERT idempoten (WHERE NOT EXISTS version) dan seluruhnya dalam SATU transaksi; kolom yang diisi: version, name, statements.
//  - Nilai DIRECT_URL tidak pernah dicetak.
//  - Perubahan wajib dicatat di docs/analysis/DB-CHANGES.md sebelum/sesudah dijalankan.
import pg from 'pg';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  bacaDaftarMigrasi, bacaEnv, bukaKoneksiBacaSaja, galatAman, tutupKoneksi, verifikasiLedger,
} from './verify-migration-ledger.mjs';

/** Parameter INSERT (satu baris) untuk satu migrasi. */
export function barisInsert(h) {
  return { version: h.versi, name: h.nama, statements: h.pernyataan };
}

export const SQL_INSERT = `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT $1::text, $2::text, $3::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1::text)`;

/** Tentukan apa yang akan dicatat dan apa yang dilewati (fungsi murni; diuji tanpa DB). */
export function rencanaPengisian(hasil) {
  const tak = hasil.filter((h) => !h.tercatat);
  return {
    isi: tak.filter((h) => h.status === 'terpasang'),
    lewati: tak.filter((h) => h.status !== 'terpasang'),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const yes = args.includes('--yes');
  const dryRunEksplisit = args.includes('--dry-run');
  const tidakDikenal = args.filter((a) => !['--apply', '--yes', '--dry-run'].includes(a));
  if (tidakDikenal.length) { console.error(`Argumen tidak dikenal: ${tidakDikenal.join(' ')}`); process.exit(1); }
  if (apply && dryRunEksplisit) { console.error('--apply dan --dry-run saling bertentangan'); process.exit(1); }
  if (apply && !yes) { console.error('--apply wajib disertai --yes (konfirmasi eksplisit). Tanpa keduanya skrip hanya dry-run.'); process.exit(1); }
  if (yes && !apply) { console.error('--yes hanya berlaku bersama --apply'); process.exit(1); }

  const env = bacaEnv();
  const berkas = bacaDaftarMigrasi();
  let ro;
  let rencana;
  try {
    ro = await bukaKoneksiBacaSaja(env);
    const v = await verifikasiLedger(ro, berkas);
    rencana = rencanaPengisian(v.hasil);
  } catch (err) {
    console.error(`GAGAL memverifikasi (tidak ada yang ditulis): ${galatAman(err, env)}`);
    process.exit(1);
  } finally {
    if (ro) await tutupKoneksi(ro);
  }

  console.log(`Mode: ${apply ? 'APPLY (menulis ke produksi)' : 'DRY-RUN (read-only; tidak ada yang ditulis)'}`);
  console.log(`\nAkan dicatat di supabase_migrations.schema_migrations (${rencana.isi.length} migrasi berstatus terpasang):`);
  for (const h of rencana.isi) {
    console.log(`  INSERT version='${h.versi}' name='${h.nama}' statements=text[${h.pernyataan.length}]`);
  }
  console.log(`\nTIDAK dicatat (${rencana.lewati.length} migrasi bukan terpasang):`);
  for (const h of rencana.lewati) console.log(`  ${h.versi} ${h.nama}: ${h.status} — ${h.alasan}`);
  console.log(`\nSQL per baris:\n${SQL_INSERT.split('\n').map((l) => `  ${l}`).join('\n')}`);

  if (!apply) {
    console.log('\nDRY-RUN selesai: tidak ada perubahan di database. Untuk menulis: --apply --yes (setelah konfirmasi CEO).');
    return;
  }
  if (rencana.isi.length === 0) { console.log('\nTidak ada yang perlu dicatat.'); return; }

  // ---- Penulisan nyata: satu transaksi, koneksi terpisah dari koneksi read-only ----
  const c = new pg.Client({
    connectionString: env.DIRECT_URL,
    ssl: { rejectUnauthorized: false },
    application_name: 'lmh-ledger-fill',
    statement_timeout: 60_000,
  });
  try {
    await c.connect();
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout = '5s'");
    let dicatat = 0;
    for (const h of rencana.isi) {
      const b = barisInsert(h);
      const r = await c.query(SQL_INSERT, [b.version, b.name, b.statements]);
      dicatat += r.rowCount ?? 0;
    }
    await c.query('COMMIT');
    console.log(`\nSELESAI: ${dicatat} baris dicatat (${rencana.isi.length - dicatat} sudah ada). Catat di docs/analysis/DB-CHANGES.md.`);
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch { /* koneksi sudah putus */ }
    console.error(`GAGAL, di-ROLLBACK (tidak ada perubahan): ${galatAman(err, env)}`);
    process.exitCode = 1;
  } finally {
    await c.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
