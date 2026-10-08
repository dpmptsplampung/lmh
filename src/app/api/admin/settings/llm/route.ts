// Konfigurasi penyedia LLM (Admin aktif saja). GET = aktif + draf + riwayat (tanpa kunci); PUT = simpan DRAF.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, requireAdmin } from '@/lib/akun/server';
import { parseChatProviderSpec } from '@/lib/llm/registry';
import { isEncryptionConfigured } from '@/lib/settings/crypto';
import { LLM_KUNCI, LLM_PRESETS, hostEntri, rantaiSchema, sanitizeEntries } from '@/lib/settings/llm-schema';
import { readJson, rpcErrorResponse } from '@/lib/settings/admin';
import { validateBaseUrl } from '@/lib/settings/ssrf';

export const dynamic = 'force-dynamic';

type Row = {
  versi: number; status: string; nilai: unknown; alasan: string | null; hasil_uji: unknown;
  diuji_at: string | null; dibuat_at: string; diaktifkan_at: string | null;
};

export async function GET() {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { service } = g;

  const { data, error } = await service
    .from('pengaturan_sistem')
    .select('versi, status, nilai, alasan, hasil_uji, diuji_at, dibuat_at, diaktifkan_at')
    .eq('kunci', LLM_KUNCI)
    .order('versi', { ascending: false })
    .limit(30);
  if (error) return json({ error: 'Gagal membaca pengaturan' }, 500);
  const rows = (data ?? []) as Row[];

  const ids = new Set<string>();
  for (const r of rows) {
    for (const e of Array.isArray(r.nilai) ? r.nilai : []) {
      const rid = (e as { rahasia_id?: string | null }).rahasia_id;
      if (rid) ids.add(rid);
    }
  }
  const last4 = new Map<string, string>();
  if (ids.size > 0) {
    // Hanya id + 4 akhir; ciphertext TIDAK pernah dipilih.
    const { data: rs } = await service.from('rahasia_pengaturan').select('id, last4').in('id', [...ids]);
    for (const r of (rs ?? []) as Array<{ id: string; last4: string }>) last4.set(r.id, r.last4);
  }
  const tampil = (r: Row | undefined) =>
    r
      ? {
          versi: r.versi, alasan: r.alasan, hasil_uji: r.hasil_uji, diuji_at: r.diuji_at,
          dibuat_at: r.dibuat_at, diaktifkan_at: r.diaktifkan_at, entries: sanitizeEntries(r.nilai, last4),
        }
      : null;

  const aktif = rows.find((r) => r.status === 'aktif');
  return json({
    enkripsi_siap: isEncryptionConfigured(),
    sumber_aktif: aktif ? 'db' : 'env',
    aktif: tampil(aktif),
    draf: tampil(rows.find((r) => r.status === 'draf')),
    riwayat: rows.map((r) => ({
      versi: r.versi, status: r.status, alasan: r.alasan, dibuat_at: r.dibuat_at, diaktifkan_at: r.diaktifkan_at,
    })),
    preset: LLM_PRESETS,
    env_cadangan: {
      gemini_sdk: !!process.env.GEMINI_API_KEY,
      penyedia: parseChatProviderSpec(process.env.LLM_CHAT_PROVIDERS).map((s) => ({ nama: s.name, model: s.model })),
    },
  });
}

const putSchema = z.object({ entries: z.unknown(), alasan: z.string().trim().max(500).optional() }).strict();

export async function PUT(request: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { actor, service } = g;

  const body = putSchema.safeParse(await readJson(request));
  if (!body.success) return json({ error: 'Invalid input' }, 400);
  const parsed = rantaiSchema.safeParse(body.data.entries);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten() }, 400);
  const entries = parsed.data;

  // SSRF: base URL kustom divalidasi saat simpan (dan lagi setiap kali dipakai).
  const urlErrors: Array<{ id: string; error: string }> = [];
  for (const e of entries) {
    if (e.tipe !== 'openai_compat' || !e.base_url) continue;
    const c = await validateBaseUrl(e.base_url);
    if (!c.ok) urlErrors.push({ id: e.id, error: c.error });
  }
  if (urlErrors.length > 0) return json({ error: 'Base URL ditolak', details: urlErrors }, 400);

  const rids = [...new Set(entries.map((e) => e.rahasia_id).filter((x): x is string => !!x))];
  if (rids.length > 0) {
    const { data: ada } = await service.from('rahasia_pengaturan').select('id, host').in('id', rids);
    if ((ada ?? []).length !== rids.length) return json({ error: 'rahasia_id tidak dikenal' }, 400);

    // Kunci hanya boleh dikirim ke host yang terikat padanya (cegah kunci dipakai ke gateway lain).
    // Belum terikat (host NULL) -> diikat ke host entri ini pada pemakaian pertama.
    const terikat = new Map((ada as Array<{ id: string; host: string | null }>).map((r) => [r.id, r.host ?? null]));
    const pakai = new Map<string, string | null>();
    const hostBentrok: Array<{ id: string; error: string }> = [];
    for (const e of entries) {
      if (!e.rahasia_id) continue;
      const h = hostEntri(e);
      const target = terikat.get(e.rahasia_id) ?? pakai.get(e.rahasia_id) ?? h;
      if (!h || target !== h) {
        hostBentrok.push({ id: e.id, error: `Kunci ini terikat ke host ${target ?? '?'}; tidak boleh dipakai untuk ${h ?? 'host tidak valid'}. Masukkan kunci baru.` });
      }
      pakai.set(e.rahasia_id, h);
    }
    if (hostBentrok.length > 0) return json({ error: 'Kunci tidak cocok dengan host', details: hostBentrok }, 400);
    for (const [rid, h] of pakai) {
      if (!terikat.get(rid) && h) await service.from('rahasia_pengaturan').update({ host: h }).eq('id', rid).is('host', null);
    }
  }

  const { data: versi, error } = await service.rpc('simpan_draf_pengaturan', {
    p_kunci: LLM_KUNCI, p_kategori: 'llm', p_nilai: entries, p_oleh: actor.id, p_alasan: body.data.alasan ?? null,
  });
  if (error) return rpcErrorResponse(error);
  return json({ ok: true, versi });
}
