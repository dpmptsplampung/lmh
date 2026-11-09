import { katalogRequest } from '@/components/umkm-katalog/api';

export { KatalogError } from '@/components/umkm-katalog/api';

// Semua panggilan tahap B lewat route katalog yang sama (no-store, cookie sesi). Nomor UMKM tidak pernah
// disimpan di sini: pemanggil hanya menaruhnya di state komponen sementara.
export function ambil<T>(path: string, signal?: AbortSignal) {
  return katalogRequest<T>(path, { signal });
}

export function kirim<T>(path: string, body: Record<string, unknown> = {}) {
  return katalogRequest<T>(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
