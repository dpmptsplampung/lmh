import 'server-only';
import { revalidateTag } from 'next/cache';

export const TAG_INVESTASI_PUBLIK = 'publik-investasi';

export function invalidasiInvestasiPublik(): void {
  revalidateTag(TAG_INVESTASI_PUBLIK, { expire: 0 });
}
