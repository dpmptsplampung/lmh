import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Rute yang WAJIB login
const protectedPrefixes = ['/admin', '/me'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware unless it's a protected route
  const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
  if (!isProtected) {
    return NextResponse.next();
  }

  // Defensive Check: If environment variables are missing in Vercel/Production
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error("Supabase environment variables are missing in next proxy!");
    return new NextResponse(
      `<html>
        <head>
          <title>Configuration Error | Lampung Maju Hub</title>
        </head>
        <body style="font-family: system-ui, -apple-system, sans-serif; padding: 2rem; max-width: 600px; margin: 4rem auto; background: #f8fafc; color: #0f172a; line-height: 1.6;">
          <h1 style="color: #ef4444; margin-bottom: 1rem;">Supabase Configuration Error (500)</h1>
          <p style="font-size: 1.1rem; color: #334155;">Environment variables <code>NEXT_PUBLIC_SUPABASE_URL</code> or <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are missing or empty.</p>
          <div style="background: #e2e8f0; padding: 1rem; border-radius: 8px; font-family: monospace; font-size: 0.9rem; margin: 1.5rem 0;">
            1. Buka Vercel Dashboard<br>
            2. Masuk ke Project Settings -> Environment Variables<br>
            3. Tambahkan kedua variabel tersebut dengan nilai dari Supabase<br>
            4. Buat deployment baru (Redeploy) agar konfigurasi diterapkan.
          </div>
          <p style="color: #64748b; font-size: 0.875rem;">Sistem Digital Pelayanan Terpadu DPMPTSP Provinsi Lampung</p>
        </body>
      </html>`,
      {
        status: 500,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }
    );
  }

  // Buat response yang bisa dimodifikasi cookie-nya
  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Set cookies di request (untuk server components)
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          // Set cookies di response (untuk browser)
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refresh session — ini juga memvalidasi apakah user masih login
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect ke /login jika belum login
  if (!user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // JIKA USER LOGIN: Cek otorisasi untuk rute admin (/admin/*)
  if (pathname.startsWith('/admin')) {
    const { data: petugas } = await supabase
      .from('petugas')
      .select('role')
      .eq('auth_user_id', user.id)
      .single();

    // Jika user tidak terdaftar sebagai petugas/admin, alihkan ke dashboard pengunjung (/me)
    if (!petugas || (petugas.role !== 'admin' && petugas.role !== 'petugas')) {
      return NextResponse.redirect(new URL('/me', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match semua route kecuali:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - File gambar (.svg, .png, .jpg, .jpeg, .gif, .webp, .ico)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
