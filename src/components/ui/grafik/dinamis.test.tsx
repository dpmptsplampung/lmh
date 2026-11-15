import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as dinamis from './dinamis';

describe('grafik dinamis', () => {
  it('mengekspor ketujuh pembungkus malas', () => {
    for (const nama of ['GrafikBatangMalas', 'GrafikDonatMalas', 'GrafikGarisMalas', 'IkmPanelMalas', 'PanelIkmGlobalMalas', 'PanelSpakGlobalMalas', 'TrenGrafikMalas']) {
      expect(dinamis).toHaveProperty(nama);
    }
  });

  it('menampilkan kerangka lalu grafik asli', async () => {
    render(<dinamis.GrafikDonatMalas data={[{ nama: 'A', nilai: 3 }]} label="Uji donat" />);
    expect(screen.getByText('Memuat grafik')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Memuat grafik')).not.toBeInTheDocument(), { timeout: 20000 });
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
  }, 30000);
});
