// Lebar penampil dan batas dimensi WebP untuk PDF dengan halaman sangat tinggi.
export const BATAS_VARIAN_WEB = { width: 1920, height: 16_383 } as const;

export function pathVarianWeb(pathPng: string): string | null {
  const web = pathPng.replace(/(^|\/)page-([1-9]\d*)\.png$/, '$1web-$2.webp');
  return web === pathPng ? null : web;
}

export const pathTautan = (id: string) => `pages/${id}/${id}/links.json`;
