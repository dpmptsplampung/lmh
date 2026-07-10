/**
 * Backfill script — convert existing investment_documents rows
 * that have no halaman_gambar into per-page PNGs.
 *
 * Usage:
 *   npx tsx scripts/backfill-investment-pdf.ts
 *
 * Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (service role to bypass RLS for reading _raw PDFs + writing pages/*).
 *
 * If a row's file_path points to the old `demo/*` location (pre-K1
 * seeding), it is treated as the raw PDF path directly.
 */
import { createClient } from '@supabase/supabase-js';
import { convertPdfToPngBuffers } from '../src/app/api/investment-docs/upload/route';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

async function backfill() {
  const { data: rows, error } = await supabase
    .from('investment_documents')
    .select('id, file_path, jumlah_halaman, halaman_gambar')
    .or('halaman_gambar.is.null,halaman_gambar.eq.{}');

  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('No documents need backfill.');
    return;
  }

  console.log(`Found ${rows.length} document(s) to backfill.`);

  for (const row of rows) {
    console.log(`\nProcessing ${row.id} (${row.file_path})...`);

    const { data: dl, error: dlErr } = await supabase.storage
      .from('investment-docs')
      .download(row.file_path);

    if (dlErr || !dl) {
      console.error(`  SKIP: cannot download ${row.file_path}: ${dlErr?.message ?? 'no data'}`);
      continue;
    }

    const pdfBytes = new Uint8Array(await dl.arrayBuffer());

    let pngs: Buffer[];
    try {
      pngs = await convertPdfToPngBuffers(pdfBytes);
    } catch (e) {
      console.error(`  SKIP: conversion failed: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    console.log(`  Converted to ${pngs.length} page(s).`);

    const halamanGambar: string[] = [];
    for (let i = 0; i < pngs.length; i++) {
      const pagePath = `pages/${row.id}/page-${i + 1}.png`;
      const { error: upErr } = await supabase.storage
        .from('investment-docs')
        .upload(pagePath, pngs[i], { contentType: 'image/png', upsert: true });
      if (upErr) {
        console.error(`  SKIP: upload ${pagePath} failed: ${upErr.message}`);
        continue;
      }
      halamanGambar.push(pagePath);
    }

    const { error: updErr } = await supabase
      .from('investment_documents')
      .update({ halaman_gambar: halamanGambar, jumlah_halaman: halamanGambar.length })
      .eq('id', row.id);

    if (updErr) {
      console.error(`  DB update failed: ${updErr.message}`);
    } else {
      console.log(`  OK: ${halamanGambar.length} pages stored.`);
    }
  }

  console.log('\nBackfill complete.');
}

backfill().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
