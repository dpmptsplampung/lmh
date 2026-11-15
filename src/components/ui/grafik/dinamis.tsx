'use client';

import type { ComponentProps } from 'react';
import dynamic from 'next/dynamic';
import Skeleton from '@/components/ui/Skeleton';
import type GrafikBatang from './GrafikBatang';
import type GrafikDonat from './GrafikDonat';
import type GrafikGaris from './GrafikGaris';
import type IkmPanel from '@/components/IkmPanel';
import type PanelIkmGlobal from '@/components/admin/survei/PanelIkmGlobal';
import type PanelSpakGlobal from '@/components/admin/survei/PanelSpakGlobal';
import type TrenGrafik from '@/components/admin/survei/TrenGrafik';

// Recharts berat: komponen grafik dimuat malas di klien saja (ssr: false hanya sah di client component).
// Semua grafik memakai kerangka kartu yang sama selama memuat agar tata letak tidak melompat.
const memuat = () => <Skeleton bentuk="kartu" label="Memuat grafik" />;

export const GrafikBatangMalas = dynamic<ComponentProps<typeof GrafikBatang>>(() => import('./GrafikBatang'), { ssr: false, loading: memuat });
export const GrafikDonatMalas = dynamic<ComponentProps<typeof GrafikDonat>>(() => import('./GrafikDonat'), { ssr: false, loading: memuat });
export const GrafikGarisMalas = dynamic<ComponentProps<typeof GrafikGaris>>(() => import('./GrafikGaris'), { ssr: false, loading: memuat });
export const IkmPanelMalas = dynamic<ComponentProps<typeof IkmPanel>>(() => import('@/components/IkmPanel'), { ssr: false, loading: memuat });
export const PanelIkmGlobalMalas = dynamic<ComponentProps<typeof PanelIkmGlobal>>(() => import('@/components/admin/survei/PanelIkmGlobal'), { ssr: false, loading: memuat });
export const PanelSpakGlobalMalas = dynamic<ComponentProps<typeof PanelSpakGlobal>>(() => import('@/components/admin/survei/PanelSpakGlobal'), { ssr: false, loading: memuat });
export const TrenGrafikMalas = dynamic<ComponentProps<typeof TrenGrafik>>(() => import('@/components/admin/survei/TrenGrafik'), { ssr: false, loading: memuat });
