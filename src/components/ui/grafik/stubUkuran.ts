import { vi } from 'vitest';

// recharts memerlukan ukuran layout nyata; jsdom tidak punya. Stub ResizeObserver yang langsung melapor 320x240
// agar ResponsiveContainer menggambar grafik pada tes.
export function stubUkuranGrafik(lebar = 320, tinggi = 240) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        const rect = { width: lebar, height: tinggi, top: 0, left: 0, right: lebar, bottom: tinggi, x: 0, y: 0 } as DOMRectReadOnly;
        this.cb(
          [{ target, contentRect: rect, borderBoxSize: [{ inlineSize: lebar, blockSize: tinggi }], contentBoxSize: [{ inlineSize: lebar, blockSize: tinggi }], devicePixelContentBoxSize: [] } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: lebar, height: tinggi, top: 0, left: 0, right: lebar, bottom: tinggi, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

/** Meniru pengguna dengan prefers-reduced-motion: reduce (animasi grafik mati, hasil akhir langsung tergambar). */
export function stubGerakDikurangi(aktif = true) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: aktif && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
}
