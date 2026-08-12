import * as XLSX from 'xlsx';
import { convertBF, uomSuffix, ARCH_UOM_M3 } from '@/lib/archUom';
import type { ArchSummaryRow, ArchTotals } from '@/types/arch';

/**
 * Excel export for CWP ARCH.
 *
 * Quantities are exported in the UNIT CURRENTLY ON SCREEN and the unit is named
 * in every quantity header — a spreadsheet of bare numbers that might be board
 * feet or might be cubic metres is a trap.
 */

// xlsx 0.18.5's escapexml fails to escape '&' in the Vite-minified bundle (it
// escapes other XML chars correctly), producing sheet1.xml that Excel renders as
// blank. Pre-escape '&' so the live bundle leaves it intact.
const escAmp = (v: string): string => v.replace(/&/g, '&amp;');

const downloadXlsx = (wb: XLSX.WorkBook, filename: string) => {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/** m³ needs decimals; BF is whole. */
const qty = (bf: number, uom: string): number => {
  const v = convertBF(bf || 0, uom);
  return uom === ARCH_UOM_M3 ? Math.round(v * 1000) / 1000 : Math.round(v);
};

export const exportToExcelARCH = (rows: ArchSummaryRow[], totals: ArchTotals, uom: string) => {
  const u = uomSuffix(uom);

  const headers = [
    'Item Code',
    'Item Description',
    'Location',
    'Species',
    'Thickness',
    'Category',
    'Grade',
    'Grain',
    'Containers',
    'Bundles',
    `Available (${u})`,
    `On Hand (${u})`,
    `Reserved (${u})`,
    `Ready to Build (${u})`,
    // Outbound must be here for the same reason it is on the grid: Available
    // subtracts it, so omitting it makes the exported Available unreconcilable.
    `Outbound (${u})`,
    `In Transit (${u})`,
    `On Order (${u})`,
    'Avg Cost/BF',
  ];

  const dataRows: (string | number)[][] = rows.map((r) => [
    escAmp(r.itemCode || ''),
    escAmp(r.description || ''),
    escAmp(r.locationName || ''),
    escAmp(r.species || ''),
    escAmp(r.thickness || ''),
    escAmp(r.category || ''),
    escAmp(r.grade || ''),
    escAmp(r.grain || ''),
    escAmp(r.containers.join(', ')),
    r.lots.length,
    qty(r.available, uom),
    qty(r.onHand, uom),
    qty(r.reserve, uom),
    qty(r.readyToBuild, uom),
    qty(r.outbound, uom),
    qty(r.inTransit, uom),
    qty(r.onOrder, uom),
    r.avgCostBF || 0,
  ]);

  const totalsRow: (string | number)[] = [
    '',
    `TOTALS — ${rows.length} items`,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    rows.reduce((s, r) => s + r.lots.length, 0),
    qty(totals.available, uom),
    qty(totals.onHand, uom),
    qty(totals.reserve, uom),
    qty(totals.readyToBuild, uom),
    qty(totals.outbound, uom),
    qty(totals.inTransit, uom),
    qty(totals.onOrder, uom),
    '',
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows, totalsRow]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hardwood');
  downloadXlsx(wb, `trader-screen-arch-${Date.now()}.xlsx`);
};
