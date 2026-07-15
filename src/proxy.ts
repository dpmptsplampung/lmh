import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { logServerEvent } from '@/lib/observability/logger';

// Rute yang WAJIB login
const protectedPrefixes = ['/admin', '/me'];
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function getRequestId(request: NextRequest): string {
  const incoming = request.headers.get('x-request-id');
  return incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
}

function attachRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  return response;
}

function failureResponse(request: NextRequest, requestId: string, error: unknown): NextResponse {
  logServerEvent('error', {
    requestId,
    route: request.nextUrl.pathname,
    method: request.method,
    operation: 'proxy.failure',
    statusCode: 500,
    error: { type: error instanceof Error ? error.name : 'UnknownError' },
  });
  return attachRequestId(NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 },
  ), requestId);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = getRequestId(request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);

  // Skip middleware unless it's a protected route
  const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
  if (!isProtected) {
    return attachRequestId(NextResponse.next({ request: { headers: requestHeaders } }), requestId);
  }

  // Defensive Check: If environment variables are missing in Vercel/Production
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const error = new Error('Proxy configuration is unavailable');
    error.name = 'ConfigurationError';
    return failureResponse(request, requestId, error);
  }

  // Buat response yang bisa dimodifikasi cookie-nya
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  try {
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
      },
    );

  // Refresh session — ini juga memvalidasi apakah user masih login
    const {
      data: { user },
    } = await supabase.auth.getUser();

  // Redirect ke /login jika belum login
    if (!user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return attachRequestId(NextResponse.redirect(loginUrl), requestId);
    }

  // JIKA USER LOGIN: Cek otorisasi untuk rute admin (/admin/*)
    if (pathname.startsWith('/admin')) {
    // A1: Baca role dari JWT app_metadata (lebih cepat, no DB query)
    // Fallback ke DB query jika claim belum dikonfigurasi (pre-hook)
      const jwtRole = (user.app_metadata?.role as string | undefined) ?? null;

      let role: string | null = jwtRole;
      if (!role) {
      // Fallback: query petugas table (sebelum Auth hook dikonfigurasi)
        const { data: petugas } = await supabase
          .from('petugas')
          .select('role')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        role = petugas?.role ?? null;
      }

    // Jika user tidak terdaftar sebagai petugas/admin, alihkan ke dashboard pengunjung (/me)
      if (role !== 'admin' && role !== 'petugas') {
        return attachRequestId(NextResponse.redirect(new URL('/me', request.url)), requestId);
      }
    }

    return attachRequestId(response, requestId);
  } catch (error) {
    return failureResponse(request, requestId, error);
  }
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
