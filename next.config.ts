import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === 'development';

export function buildContentSecurityPolicy(supabaseUrl: string | undefined, development = false): string {
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
    `connect-src 'self'${httpOrigin ? ` ${httpOrigin} ${webSocketOrigin}` : ''}`,
    `img-src 'self' data: blob:${httpOrigin ? ` ${httpOrigin}` : ''}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const contentSecurityPolicy = buildContentSecurityPolicy(process.env.NEXT_PUBLIC_SUPABASE_URL, isDevelopment);

const nextConfig: NextConfig = {
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
        { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy },
      ],
    }];
  },
};

export default nextConfig;
