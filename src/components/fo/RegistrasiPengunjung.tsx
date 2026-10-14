'use client';

// Isi halaman Registrasi Pengunjung: tab "Walk-in" dan "Scan QR" (pola tab WAI-ARIA, aktivasi otomatis).
// - Tab aktif tersinkron ke `?tab=walkin|scan` lewat window.history.replaceState (terintegrasi dengan Next Router,
//   instan tanpa round-trip server dan tanpa scroll; guide linking-and-navigating) sehingga bisa di-bookmark. Tautan
//   masuk lain (sidebar, tombol back) yang mengubah ?tab= ikut diikuti.
// - Panel Scan QR HANYA dirender saat tabnya aktif: berpindah tab = unmount = kamera mati (useKameraPemindai).
// - Panel Walk-in tetap terpasang (disembunyikan) setelah pernah dibuka agar isian yang setengah terisi tidak hilang
//   saat petugas sebentar memindai QR.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { QrCode, UserPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { todayWIB } from '@/lib/time';
import { tabDariParam, urlRegistrasi, type TabRegistrasi } from '@/lib/fo/registrasi-url';
import WalkinPanel from './WalkinPanel';
import ScanPanel from './ScanPanel';
import styles from './registrasi.module.css';

const TAB: { id: TabRegistrasi; label: string }[] = [
  { id: 'walkin', label: 'Walk-in' },
  { id: 'scan', label: 'Scan QR' },
];

const idTab = (t: TabRegistrasi) => `tab-registrasi-${t}`;
const idPanel = (t: TabRegistrasi) => `panel-registrasi-${t}`;

export default function RegistrasiPengunjung() {
  const sp = useSearchParams();
  const tabUrl = tabDariParam(sp.get('tab'));
  const [tab, setTab] = useState<TabRegistrasi>(tabUrl);
  const [tabUrlSebelumnya, setTabUrlSebelumnya] = useState<TabRegistrasi>(tabUrl);
  // URL berubah dari luar (tautan, back/forward): ikuti. (Pola "sesuaikan state saat prop berubah", tanpa efek.)
  if (tabUrl !== tabUrlSebelumnya) {
    setTabUrlSebelumnya(tabUrl);
    setTab(tabUrl);
  }
  const [walkinPernahDibuka, setWalkinPernahDibuka] = useState(tabUrl === 'walkin');
  const [sudahPilihTab, setSudahPilihTab] = useState(false);
  const [jumlahReservasi, setJumlahReservasi] = useState<number | null>(null);
  const tombolRef = useRef<Record<TabRegistrasi, HTMLButtonElement | null>>({ walkin: null, scan: null });
  const queryRef = useRef(sp);
  useEffect(() => {
    queryRef.current = sp;
  });

  // Walk-in terpasang begitu pernah aktif (juga bila URL berubah dari luar).
  const walkinTerpasang = walkinPernahDibuka || tab === 'walkin';

  const pilih = useCallback((t: TabRegistrasi, fokus = false) => {
    setSudahPilihTab(true);
    setTab(t);
    if (t === 'walkin') setWalkinPernahDibuka(true);
    // Sinkron ke URL tanpa menambah riwayat dan tanpa scroll; query lain dipertahankan.
    window.history.replaceState(null, '', urlRegistrasi(t, queryRef.current));
    if (fokus) tombolRef.current[t]?.focus();
  }, []);

  const saatTombol = (e: KeyboardEvent<HTMLButtonElement>, t: TabRegistrasi) => {
    const i = TAB.findIndex((x) => x.id === t);
    let tujuan: number | null = null;
    if (e.key === 'ArrowRight') tujuan = (i + 1) % TAB.length;
    else if (e.key === 'ArrowLeft') tujuan = (i - 1 + TAB.length) % TAB.length;
    else if (e.key === 'Home') tujuan = 0;
    else if (e.key === 'End') tujuan = TAB.length - 1;
    if (tujuan === null) return;
    e.preventDefault();
    pilih(TAB[tujuan].id, true);
  };

  // Penanda jumlah di tab Scan QR: reservasi hari ini yang menunggu check-in. Satu kueri hitung ringan (tanpa baris),
  // dimuat ulang saat tab berganti; gagal = tanpa penanda.
  useEffect(() => {
    let aktif = true;
    void (async () => {
      try {
        const { count, error } = await createClient()
          .from('kunjungan')
          .select('id', { count: 'exact', head: true })
          .eq('asal', 'reservasi')
          .eq('status', 'terjadwal')
          .eq('tanggal', todayWIB());
        if (aktif) setJumlahReservasi(!error && typeof count === 'number' ? count : null);
      } catch {
        if (aktif) setJumlahReservasi(null);
      }
    })();
    return () => {
      aktif = false;
    };
  }, [tab]);

  return (
    <div className={styles.halaman}>
      <div role="tablist" aria-label="Jenis registrasi pengunjung" className={styles.daftarTab}>
        {TAB.map((t) => {
          const terpilih = tab === t.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tombolRef.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={idTab(t.id)}
              aria-selected={terpilih}
              aria-controls={idPanel(t.id)}
              tabIndex={terpilih ? 0 : -1}
              className={`${styles.tab} ${terpilih ? styles.tabAktif : ''}`}
              onClick={() => pilih(t.id)}
              onKeyDown={(e) => saatTombol(e, t.id)}
            >
              {t.id === 'walkin' ? <UserPlus size={18} aria-hidden="true" /> : <QrCode size={18} aria-hidden="true" />}
              <span>{t.label}</span>
              {t.id === 'scan' && jumlahReservasi !== null && jumlahReservasi > 0 && (
                <span className={styles.penanda}>
                  <span aria-hidden="true">{jumlahReservasi}</span>
                  <span className={styles.srOnly}>, {jumlahReservasi} reservasi menunggu check-in hari ini</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {walkinTerpasang && (
        <div
          role="tabpanel"
          id={idPanel('walkin')}
          aria-labelledby={idTab('walkin')}
          hidden={tab !== 'walkin'}
          className={styles.panel}
        >
          <WalkinPanel fokusAwal={!sudahPilihTab} />
        </div>
      )}

      {tab === 'scan' && (
        <div role="tabpanel" id={idPanel('scan')} aria-labelledby={idTab('scan')} className={styles.panel}>
          <ScanPanel />
        </div>
      )}
    </div>
  );
}
