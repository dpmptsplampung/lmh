'use client';

import { useEffect, useState } from 'react';
import Tombol from '@/components/ui/Tombol';
import type { Kartu } from '@/lib/umkm-katalog/types';
import { katalogRequest } from './api';
import KartuKatalog from './KartuKatalog';
import type { KonteksFormulir } from './FormulirKatalog';
import styles from './katalog.module.css';

export default function UmkmSerupa({ id, onHubungi }: {
  id: string; onHubungi: (value: KonteksFormulir) => void;
}) {
  const [items, setItems] = useState<Kartu[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void katalogRequest<{ items: Kartu[] }>(`/${id}/serupa`, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setItems(value.items); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [id, attempt]);
  return <section aria-labelledby="umkm-serupa">
    <h2 id="umkm-serupa">UMKM serupa</h2>
    {failed ? <div>
      <p role="status">UMKM serupa belum berhasil dimuat. Profil ini tetap dapat Anda lihat.</p>
      <Tombol varian="sekunder" onClick={() => {
        setFailed(false); setAttempt((value) => value + 1);
      }}>Coba muat UMKM serupa</Tombol>
    </div> : items === null ? <p role="status">Memuat UMKM serupa...</p>
      : items.length === 0 ? <p>Belum ada UMKM serupa yang dapat ditampilkan.</p>
        : <ul className={styles.kartuDaftar}>
          {items.map((item) => <KartuKatalog key={item.id} item={item} onHubungi={onHubungi} />)}
        </ul>}
  </section>;
}
