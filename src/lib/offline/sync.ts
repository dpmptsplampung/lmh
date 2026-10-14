// Pendaftaran Background Sync untuk antrean offline FO. Tag HARUS sama dengan SYNC_TAGS di public/sw.js
// (dijaga src/test/service-worker.test.ts). Pemutaran sendiri dilakukan halaman (lihat OfflineReplayer).

export const SYNC_TAG_FO_WALKIN = 'fo-walkin-sync';

type RegistrasiSync = ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } };

/** Mendaftarkan sync; mengembalikan false bila tidak didukung/gagal (pemutaran tetap terjadi saat 'online' dan saat halaman dibuka). */
export async function daftarkanSyncOffline(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
    const reg = (await navigator.serviceWorker.ready) as RegistrasiSync;
    if (!reg.sync) return false;
    await reg.sync.register(SYNC_TAG_FO_WALKIN);
    return true;
  } catch {
    return false;
  }
}
