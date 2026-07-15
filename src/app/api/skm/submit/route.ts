import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const bodySchema = z.object({
  token: z.string().min(16).max(128),
  u1: z.number().int().min(1).max(4),
  u2: z.number().int().min(1).max(4),
  u3: z.number().int().min(1).max(4),
  u4: z.number().int().min(1).max(4),
  u5: z.number().int().min(1).max(4),
  u6: z.number().int().min(1).max(4),
  u7: z.number().int().min(1).max(4),
  u8: z.number().int().min(1).max(4),
  u9: z.number().int().min(1).max(4),
  saran: z.string().max(2000).optional(),
}).strict();

const errors: Record<string, { status: number; error: string }> = {
  duplicate: { status: 409, error: 'Anda sudah mengisi survei ini' },
  not_completed: { status: 400, error: 'Survei tersedia setelah layanan Anda selesai' },
  not_found: { status: 404, error: 'Token kunjungan tidak ditemukan' },
  invalid: { status: 400, error: 'Input survei tidak valid' },
};

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { token, u1, u2, u3, u4, u5, u6, u7, u8, u9, saran } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_skm_response', {
    p_token: token,
    p_u1: u1,
    p_u2: u2,
    p_u3: u3,
    p_u4: u4,
    p_u5: u5,
    p_u6: u6,
    p_u7: u7,
    p_u8: u8,
    p_u9: u9,
    p_saran: saran?.trim() || null,
  });

  if (error || typeof data !== 'string') {
    return NextResponse.json({ error: 'Gagal mengirim survei' }, { status: 500 });
  }
  if (data !== 'submitted') {
    const mapped = errors[data] ?? { status: 500, error: 'Gagal mengirim survei' };
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  return NextResponse.json({ message: 'Terima kasih atas penilaian Anda.' }, { status: 201 });
}
