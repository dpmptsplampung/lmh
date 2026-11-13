// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { amanSel, buildSurveiWorkbook } from './export';

const muatExcel = vi.hoisted(() => vi.fn());
vi.mock('exceljs', async (importOriginal) => {
  muatExcel();
  return importOriginal();
});

it('memuat ExcelJS hanya ketika berkas survei dibuat', async () => {
  expect(amanSel('=1+1')).toBe("'=1+1");
  expect(muatExcel).not.toHaveBeenCalled();
  const berkas = await buildSurveiWorkbook({
    dari: '2026-11-01', sampai: '2026-11-03', spak: [], skm: [], ringkasanRate: [],
  });
  expect(muatExcel).toHaveBeenCalledOnce();
  expect(berkas.subarray(0, 2).toString()).toBe('PK');
});
