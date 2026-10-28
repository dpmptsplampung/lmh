// Pembungkus fetch JSON untuk halaman admin: galat server -> Error(pesan). `kode` (bila ada di badan galat) tetap
// tersedia lewat AdminFetchError agar UI bisa memilih pesan sendiri untuk galat tertentu (mis. SUDAH_DIPAKAI).
export class AdminFetchError extends Error {
  readonly kode?: string;
  readonly status: number;
  constructor(pesan: string, status: number, kode?: string) {
    super(pesan);
    this.name = 'AdminFetchError';
    this.status = status;
    this.kode = kode;
  }
}

export async function adminFetch<T = Record<string, unknown>>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const j = json as { error?: string; kode?: string };
    throw new AdminFetchError(j.error ?? 'Permintaan gagal', res.status, j.kode);
  }
  return json as T;
}
