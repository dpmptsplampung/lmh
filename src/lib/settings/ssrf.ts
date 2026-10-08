// Penjaga SSRF untuk base URL gateway LLM kustom (server-only).
// https saja, port 443, bukan IP literal/kredensial; semua hasil DNS harus publik; koneksi DIKUNCI ke
// IP yang sudah divalidasi (menutup DNS rebinding); tanpa mengikuti redirect; timeout & batas ukuran.
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';

export type Resolver = (host: string) => Promise<Array<{ address: string; family: number }>>;
const defaultResolver: Resolver = (host) => dns.lookup(host, { all: true, verbatim: true });

function v4Blocked(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** true = alamat privat/loopback/link-local/metadata/dll. yang tidak boleh dituju. */
export function isBlockedIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return v4Blocked(ip);
  if (kind !== 6) return true;
  const low = ip.toLowerCase();
  const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Blocked(mapped[1]);
  if (low.startsWith('::ffff:')) return true; // bentuk hex ::ffff:7f00:1 -> tolak
  return (
    low === '::' || low === '::1' ||
    /^f[cd]/.test(low) || // fc00::/7
    /^fe[89ab]/.test(low) || // fe80::/10
    low.startsWith('ff') || // multicast
    low.startsWith('64:ff9b:') || // NAT64
    low.startsWith('2001:db8') // dokumentasi
  );
}

export type UrlCheck = { ok: true; url: URL; ip: { address: string; family: number } } | { ok: false; error: string };

export async function validateBaseUrl(raw: string, resolve: Resolver = defaultResolver): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'URL tidak valid' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'Hanya https yang diizinkan' };
  if (url.username || url.password) return { ok: false, error: 'URL tidak boleh memuat kredensial' };
  if (url.port && url.port !== '443') return { ok: false, error: 'Hanya port 443 yang diizinkan' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return { ok: false, error: 'Alamat IP langsung tidak diizinkan, gunakan nama domain' };
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await resolve(host);
  } catch {
    return { ok: false, error: 'Nama domain tidak dapat di-resolve' };
  }
  if (addrs.length === 0) return { ok: false, error: 'Nama domain tidak dapat di-resolve' };
  if (addrs.some((a) => isBlockedIp(a.address))) {
    return { ok: false, error: 'Domain mengarah ke alamat privat/internal (diblokir)' };
  }
  return { ok: true, url, ip: addrs[0] };
}

export interface GuardedOpts {
  timeoutMs?: number;
  maxBytes?: number;
  resolve?: Resolver;
}

/**
 * fetch-compatible (POST/GET + header + body string) yang aman SSRF. Mengembalikan Response asli.
 * Redirect TIDAK diikuti (3xx dikembalikan apa adanya -> pemanggil menganggap gagal).
 */
export function makeGuardedFetch(opts: GuardedOpts = {}): typeof fetch {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxBytes = opts.maxBytes ?? 256 * 1024;
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const check = await validateBaseUrl(String(input), opts.resolve);
    if (!check.ok) throw new Error(`URL ditolak: ${check.error}`);
    const { url, ip } = check;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    const body = typeof init?.body === 'string' ? init.body : undefined;
    if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));

    return new Promise<Response>((resolve, reject) => {
      let done = false;
      const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
      const req = https.request(
        {
          protocol: 'https:',
          host: url.hostname,
          servername: url.hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: init?.method ?? 'GET',
          headers,
          // Kunci ke IP tervalidasi (anti DNS-rebinding); TLS tetap diverifikasi terhadap hostname.
          lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
            o?.all ? cb(null, [{ address: ip.address, family: ip.family }]) : cb(null, ip.address, ip.family)) as never,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              req.destroy();
              finish(() => reject(new Error('Respons terlalu besar')));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => finish(() => {
            const status = res.statusCode ?? 502;
            const noBody = status === 204 || status === 205 || status === 304;
            resolve(new Response(noBody ? null : Buffer.concat(chunks), { status }));
          }));
          res.on('error', (e) => finish(() => reject(e)));
        },
      );
      const timer = setTimeout(() => { req.destroy(); finish(() => reject(new Error('Timeout'))); }, timeoutMs);
      req.on('error', (e) => finish(() => reject(e)));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }) as typeof fetch;
}
