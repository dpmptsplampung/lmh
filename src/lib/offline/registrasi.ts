const REGISTRASI = new WeakMap<ServiceWorkerContainer, Promise<ServiceWorkerRegistration>>();
const BATAS_AKTIVASI_MS = 10000;

async function tungguWorkerAktif(container: ServiceWorkerContainer, registrasi: ServiceWorkerRegistration) {
  if (registrasi.active) return registrasi;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const aktif = await Promise.race([
      container.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Service worker belum aktif')), BATAS_AKTIVASI_MS);
      }),
    ]);
    if (aktif.scope !== registrasi.scope) throw new Error('Scope service worker tidak cocok');
    return aktif;
  } finally {
    clearTimeout(timer);
  }
}

export function daftarkanServiceWorker(container = navigator.serviceWorker): Promise<ServiceWorkerRegistration> {
  const sudahTerdaftar = REGISTRASI.get(container);
  if (sudahTerdaftar) return sudahTerdaftar;

  const registrasi = container.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then((hasil) => tungguWorkerAktif(container, hasil))
    .catch((error: unknown) => {
      REGISTRASI.delete(container);
      throw error;
    });
  REGISTRASI.set(container, registrasi);
  return registrasi;
}
