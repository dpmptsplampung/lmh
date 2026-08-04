import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { z } from 'zod';

const bodySchema = z
  .object({
    email: z.email(),
    nama: z.string().min(2).max(200),
    layanan_id: z.string().uuid().nullable().optional(),
    role: z.enum(['petugas', 'admin', 'front_office']).default('petugas'),
  })
  .refine((v) => v.role === 'admin' || v.role === 'front_office' || !!v.layanan_id, {
    message: 'layanan_id wajib untuk role petugas',
    path: ['layanan_id'],
  });

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function publicBaseUrl(): string | null {
  // Prefer the same canonical public URL used by notif + magic-link flows.
  const url = process.env.NEXT_PUBLIC_PUBLIC_URL;
  if (!url) return null;
  return url.replace(/\/$/, '');
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: petugas } = await supabase
    .from('petugas')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!petugas || petugas.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { email, nama, layanan_id, role } = parsed.data;

  const adminClient = getServiceClient();
  if (!adminClient) {
    return NextResponse.json(
      { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY required' },
      { status: 500 },
    );
  }

  const base = publicBaseUrl();
  const resend = getResend();
  if (!base || !resend) {
    const missing = [!base && 'NEXT_PUBLIC_PUBLIC_URL', !resend && 'RESEND_API_KEY'].filter(Boolean);
    console.error('[admin/petugas/invite] env vars missing:', missing);
    return NextResponse.json(
      { error: `Service unavailable — missing env: ${missing.join(', ')}` },
      { status: 503 },
    );
  }

  const redirectTo = `${base}/auth/callback?next=/admin`;

  // Buat user bila belum ada. createUser mengembalikan error "already
  // registered" bila email sudah ada — dalam kasus itu lanjut tanpa userId
  // baru; baris petugas kemungkinan sudah ada (unique constraint menolak
  // duplikat) dan tautan reset tetap dikirim.
  let userId: string | null = null;
  let alreadyRegistered = false;

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (createError) {
    const msg = createError.message.toLowerCase();
    if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
      alreadyRegistered = true;
    } else {
      console.error('[admin/petugas/invite] gagal membuat user', createError);
      return NextResponse.json(
        { error: 'Gagal membuat akun petugas.' },
        { status: 500 },
      );
    }
  } else {
    userId = created.user?.id ?? null;
  }

  // Email sudah terdaftar (mis. user Google-login lama atau pegawai yang sama
  // ditambahkan ke layanan lain): resolusi userId-nya lalu upsert baris
  // petugas — jangan balas sukses palsu tanpa membuat baris.
  if (alreadyRegistered && !userId) {
    const { data: listData, error: listError } = await adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) {
      console.error('[admin/petugas/invite] gagal mencari user existing', listError);
      return NextResponse.json(
        { error: 'Gagal memproses akun yang sudah terdaftar.' },
        { status: 500 },
      );
    }
    userId =
      listData?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
    if (!userId) {
      return NextResponse.json(
        { error: 'Email terdaftar tetapi akun tidak ditemukan.' },
        { status: 500 },
      );
    }
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'Gagal membuat akun petugas.' },
      { status: 500 },
    );
  }

  const { error: insertError } = await adminClient
    .from('petugas')
    .upsert(
      {
        auth_user_id: userId,
        nama,
        layanan_id: layanan_id ?? null,
        role,
      },
      { onConflict: 'auth_user_id' },
    );

  if (insertError) {
    console.error('[admin/petugas/invite] gagal menyimpan baris petugas', insertError);
    const code = (insertError as { code?: string }).code;
    const msg =
      code === '23503'
        ? 'Layanan yang dipilih tidak ditemukan.'
        : code === '23505'
          ? 'Akun ini sudah terdaftar sebagai petugas.'
          : 'Gagal menyimpan data petugas.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    email,
    type: 'recovery',
    options: { redirectTo },
  });

  if (linkError || !linkData?.properties?.action_link) {
    console.error('[admin/petugas/invite] gagal membuat tautan recovery', linkError);
    return NextResponse.json(
      { error: 'Gagal membuat tautan pengaturan kata sandi.' },
      { status: 500 },
    );
  }

  const actionLink = linkData.properties.action_link;
  const from = process.env.RESEND_FROM || 'DPMPTSP Lampung <noreply@lmh.lampungprov.go.id>';
  const { error: sendError } = await resend.emails.send({
    from,
    to: email,
    subject: 'Atur kata sandi akun petugas — DPMPTSP Lampung',
    html: `
      <p>Akun petugas Layanan Maju Hub telah dibuat untuk Anda.</p>
      <p><a href="${actionLink}">Klik di sini untuk mengatur kata sandi Anda</a></p>
      <p>Jika Anda tidak merasa terdaftar sebagai petugas, abaikan email ini.</p>
    `,
  });

  if (sendError) {
    console.error('[admin/petugas/invite] gagal mengirim email', sendError);
    return NextResponse.json(
      { error: 'Gagal mengirim email tautan pengaturan kata sandi.' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { user_id: userId, success: true },
    { status: 201 },
  );
}
