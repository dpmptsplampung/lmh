// Pemulihan otomatis dari version skew (klien memegang chunk build lama setelah deploy baru).
// Gejala: "Module N was instantiated because it was required from module M, but the module factory
// is not available" (Turbopack), ChunkLoadError, "Loading chunk ... failed".

const POLA_ERROR_CHUNK = [
  /module factory is not available/i,
  /ChunkLoadError/i,
  /Loading chunk [^\s]+ failed/i,
  /Loading CSS chunk/i,
  /Failed to fetch dynamically imported module/i,
];

export const RELOAD_KEY = 'lmh:chunk-reload-at';
export const RELOAD_JEDA_MS = 60_000;

export function isChunkError(pesan: unknown): boolean {
  const teks =
    typeof pesan === 'string'
      ? pesan
      : pesan instanceof Error
        ? `${pesan.name} ${pesan.message}`
        : pesan && typeof pesan === 'object' && 'message' in pesan
          ? String((pesan as { message: unknown }).message)
          : '';
  return POLA_ERROR_CHUNK.some((p) => p.test(teks));
}

/** Benar bila pengguna sedang mengetik / ada isian yang sudah terisi (reload akan membuangnya). */
export function adaIsianAktif(doc: Document = document): boolean {
  const aktif = doc.activeElement as HTMLElement | null;
  if (aktif && (aktif.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(aktif.tagName))) return true;
  const isian = doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])',
  );
  return Array.from(isian).some((el) => el.value.trim() !== '');
}

/**
 * Reload satu kali (penjaga loop via sessionStorage). Mengembalikan 'reload' | 'banner'.
 * Reload otomatis hanya bila tidak ada isian aktif/terisi dan belum reload dalam RELOAD_JEDA_MS.
 */
export function pulihkanDariErrorChunk(
  opsi: {
    now?: number;
    storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
    reload?: () => void;
    isianAktif?: boolean;
  } = {},
): 'reload' | 'banner' {
  const now = opsi.now ?? Date.now();
  const reload = opsi.reload ?? (() => window.location.reload());
  const isianAktif = opsi.isianAktif ?? adaIsianAktif();
  let storage: Pick<Storage, 'getItem' | 'setItem'> | null = null;
  try {
    storage = opsi.storage === undefined ? window.sessionStorage : opsi.storage;
  } catch {
    storage = null;
  }
  if (isianAktif || !storage) return 'banner';
  try {
    const terakhir = Number(storage.getItem(RELOAD_KEY) ?? 0);
    if (terakhir && now - terakhir < RELOAD_JEDA_MS) return 'banner';
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    return 'banner';
  }
  reload();
  return 'reload';
}
