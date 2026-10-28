import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === 'development';

// Origin R2 hanya diterima bila HTTPS; yang tidak valid dibuang (fail closed).
function originHttps(v: string | undefined): string | undefined {
  try {
    const u = new URL(v ?? '');
    return u.protocol === 'https:' ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

export function buildContentSecurityPolicy(
  supabaseUrl: string | undefined,
  development = false,
  r2?: { endpoint?: string; publikBase?: string },
): string {
  const r2Endpoint = originHttps(r2?.endpoint);
  const r2Publik = originHttps(r2?.publikBase);
  let httpOrigin: string | undefined;
  let webSocketOrigin: string | undefined;
  try {
    const parsed = new URL(supabaseUrl ?? '');
    if (parsed.protocol === 'https:') {
      httpOrigin = parsed.origin;
      webSocketOrigin = `wss://${parsed.host}`;
    }
  } catch {
    // Invalid or absent origins are omitted so the policy fails closed.
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `connect-src 'self'${httpOrigin ? ` ${httpOrigin} ${webSocketOrigin}` : ''}${r2Endpoint ? ` ${r2Endpoint}` : ''}`,
    `img-src 'self' data: blob:${httpOrigin ? ` ${httpOrigin}` : ''}${r2Publik ? ` ${r2Publik}` : ''}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const r2AccountId = process.env.R2_ACCOUNT_ID?.trim();
const contentSecurityPolicy = buildContentSecurityPolicy(process.env.NEXT_PUBLIC_SUPABASE_URL, isDevelopment, {
  endpoint: r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : undefined,
  publikBase: process.env.R2_PUBLIC_BASE_URL,
});

// deploymentId Vercel maksimal 32 karakter; SHA commit penuh (40) membuat build gagal.
const buildId = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_DEPLOYMENT_ID)?.slice(0, 12);

const nextConfig: NextConfig = {
  // Version skew: klien yang memegang build lama otomatis hard-navigate saat ID deploy berbeda.
  ...(buildId ? { deploymentId: buildId } : {}),
  env: { NEXT_PUBLIC_BUILD_ID: buildId ?? 'dev' },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
        // SEC-01: ditegakkan (bukan lagi Report-Only). Kebijakan sudah mengizinkan
        // 'unsafe-inline' untuk script/style sehingga transisi tidak memutus fungsi.
        { key: 'Content-Security-Policy', value: contentSecurityPolicy },
      ],
    }];
  },
};

export default nextConfig;
