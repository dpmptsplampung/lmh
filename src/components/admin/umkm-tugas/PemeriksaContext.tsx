'use client';

import { createContext, useContext } from 'react';

export const PemeriksaContext = createContext(false);
export const usePemeriksaUmkm = () => useContext(PemeriksaContext);
