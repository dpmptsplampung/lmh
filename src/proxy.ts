import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { logServerEvent } from '@/lib/observability/logger';
import { parseAlasanSesi, urlLoginAlasan } from '@/lib/sesi-staf';
import { bolehAksesRute, butuhModulUntukRute, type AdminRole, type ModulLayanan } from '@/lib/admin-nav';
import { alihkanAreaPeran, berandaTolak, halamanProfilPeran } from '@/lib/rute-peran';

// Rute yang WAJIB login. /admin = admin dan Front Office; /petugas = Petugas Layanan.
const protectedPrefixes = ['/admin', '/petugas', '/me'];
const AREA_STAF = ['/admin', '/petugas'];
const MODUL_VALID: readonly string[] = ['umkm', 'investasi'];
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function getRequestId(request: NextRequest): string {
  const incoming = request.headers.get('x-request-id');
  return incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
}

function attachRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  return response;
}

// Batas waktu pemeriksaan sesi: RPC yang lambat tidak boleh menahan setiap navigasi /admin. Penegakan keras
// sesi ada di RPC mutasi (sesi_valid()) dan heartbeat klien; proxy hanya lapisan tambahan (gagal-terbuka).
const BATAS_CEK_SESI_MS = 1500;

type HasilCekSesi = { jenis: 'lanjut' } | { jenis: 'tolak'; url: string };

// Satu panggilan sesi_status() untuk staf yang sudah lolos cek role. Status 'ok'/'transisi'/'bukan_staf' lanjut;
// 'digantikan'/'idle'/'tidak_terdaftar' dialihkan ke /login?alasan=. Galat jaringan/RPC, timeout, atau status
// di luar kontrak = lanjut (gagal-terbuka) dan dicatat; halaman tidak boleh jatuh karena pemeriksaan ini.
async function cekSesiStaf(
  supabase: ReturnType<typeof createServerClient>,
  request: NextRequest,
  requestId: string,
): Promise<HasilCekSesi> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const hasil = await Promise.race([
      Promise.resolve(supabase.rpc('sesi_status')),
      new Promise<never>((_, tolak) => {
        timer = setTimeout(() => tolak(new Error('sesi_status timeout')), BATAS_CEK_SESI_MS);
      }),
    ]);
    if (hasil.error) throw hasil.error;
    const status = hasil.data;
    if (status === 'ok' || status === 'transisi' || status === 'bukan_staf') return { jenis: 'lanjut' };
    const alasan = parseAlasanSesi(typeof status === 'string' ? status : null);
    if (alasan) return { jenis: 'tolak', url: urlLoginAlasan(alasan) };
    throw new Error('sesi_status mengembalikan nilai di luar kontrak');
  } catch (error) {
    logServerEvent('warn', {
      requestId,
      route: request.nextUrl.pathname,
      method: request.method,
      operation: 'proxy.sesi_status_gagal',
      error: { type: error instanceof Error ? error.name : 'UnknownError' },
    });
    return { jenis: 'lanjut' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Modul layanan petugas (staf_modul()), hanya dipanggil untuk rute modul. Galat/RPC belum ada/nilai asing = null,
// sehingga rute modul DITOLAK (fail-closed) dan halaman lain tidak terpengaruh.
async function bacaModul(supabase: ReturnType<typeof createServerClient>): Promise<ModulLayanan | null> {
  try {
    const { data, error } = await supabase.rpc('staf_modul');
    if (error || typeof data !== 'string' || !MODUL_VALID.includes(data)) return null;
    return data as ModulLayanan;
  } catch {
    return null;
  }
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

  // JIKA USER LOGIN: Cek otorisasi untuk area staf (/admin/* dan /petugas/*)
    if (AREA_STAF.some((prefix) => pathname.startsWith(prefix))) {
    // A1: Baca role dari JWT app_metadata (lebih cepat, no DB query)
    // Fallback ke DB query jika claim belum dikonfigurasi (pre-hook)
      const jwtRole = (user.app_metadata?.role as string | undefined) ?? null;

      let role: string | null = jwtRole;
      if (!role) {
      // Fallback: query petugas table (sebelum Auth hook dikonfigurasi).
      // Petugas nonaktif tidak dianggap punya peran (I-22 / RBA-06).
        const { data: petugas } = await supabase
          .from('petugas')
          .select('role, aktif')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        role = petugas && petugas.aktif !== false ? (petugas.role ?? null) : null;
      }

    // Jika user tidak terdaftar sebagai petugas/admin, alihkan ke dashboard pengunjung (/me)
      if (role !== 'admin' && role !== 'petugas' && role !== 'front_office') {
        return attachRequestId(NextResponse.redirect(new URL('/me', request.url)), requestId);
      }

      // Area peran: petugas di /admin/* dialihkan ke padanannya di /petugas (menjaga tautan notifikasi dan bookmark
      // lama), admin dan Front Office di /petugas/* dialihkan ke /admin. Query string ikut.
      const areaLain = alihkanAreaPeran(role, pathname);
      if (areaLain) {
        const tujuan = new URL(areaLain, request.url);
        tujuan.search = request.nextUrl.search;
        return attachRequestId(NextResponse.redirect(tujuan), requestId);
      }

      // Sesi tunggal staf (A2): sesi yang digantikan login lain / idle dialihkan ke login dengan alasan.
      const sesi = await cekSesiStaf(supabase, request, requestId);
      if (sesi.jenis === 'tolak') {
        return attachRequestId(NextResponse.redirect(new URL(sesi.url, request.url)), requestId);
      }

      // Otorisasi halaman di server (fail-closed): rute yang tidak terdaftar atau tidak diizinkan untuk peran ini
      // dialihkan. AdminGuard di klien tinggal lapisan UX. Modul layanan hanya dibaca untuk rute modul.
      const peran = role as AdminRole;
      const modul = butuhModulUntukRute(peran, pathname) ? await bacaModul(supabase) : null;
      if (!bolehAksesRute(peran, pathname, { modul })) {
        return attachRequestId(NextResponse.redirect(new URL(berandaTolak(peran), request.url)), requestId);
      }

      // Akun dengan sandi sementara (reset Admin) wajib ganti sandi dulu. Hanya mengarahkan ke
      // halaman profil peran itu; tidak melonggarkan cek role di atas (galat/kolom hilang = tidak memaksa).
      const halamanProfil = halamanProfilPeran(peran);
      if (pathname !== halamanProfil && !pathname.startsWith(`${halamanProfil}/`)) {
        const { data: flag } = await supabase
          .from('petugas')
          .select('wajib_ganti_sandi')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        if (flag?.wajib_ganti_sandi === true) {
          return attachRequestId(NextResponse.redirect(new URL(`${halamanProfil}?ganti=1`, request.url)), requestId);
        }
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
