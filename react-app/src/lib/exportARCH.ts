import * as XLSX from 'xlsx';
import { convertQty, displaySuffix, unitListLabel, ARCH_UOM_M3 } from '@/lib/archUom';
import type { ArchUnit } from '@/lib/archUom';
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

/** m³ needs decimals; every native unit is whole. */
const qty = (value: number, unit: ArchUnit, uom: string): number => {
  const v = convertQty(value || 0, unit, uom);
  return uom === ARCH_UOM_M3 && v !== (value || 0) ? Math.round(v * 1000) / 1000 : Math.round(v);
};

export const exportToExcelARCH = (rows: ArchSummaryRow[], totals: ArchTotals, uom: string) => {
  // The quantity headers can no longer name a unit — the sheet may hold BF,
  // SQFT and piece rows together — so a Unit column is added and each row
  // declares its own. That is also the shape a pivot table wants.
  const mixedUnits = totals.units.length > 1;
  const totalsUnit: ArchUnit = totals.units[0] ?? 'BF';

  const headers = [
    'Item Code',
    'Item Description',
    'Location',
    'Species',
    'Thickness',
    'Category',
    'Grade',
    'Grain',
    // Was 'Containers' until 2026-08-19. Same cell, honest label: the value is a
    // PO number. Marc-Antoine confirmed the lot prefix is the PO, and a container
    // can span several POs, so this column never held containers. Derived here
    // from the lots rather than from a row field, so the cache contract does not
    // grow a `pos` array nobody else needs.
    'POs',
    'Bundles',
    'Unit',
    'Available',
    'On Hand',
    'Reserved',
    'Ready to Build',
    // Outbound must be here for the same reason it is on the grid: Available
    // subtracts it, so omitting it makes the exported Available unreconcilable.
    'Outbound',
    'In Transit',
    'On Order',
    'Avg Cost/Unit',
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
    escAmp([...new Set(r.lots.map((l) => l.po).filter(Boolean))].join(', ')),
    r.lots.length,
    displaySuffix(r.unit, uom),
    qty(r.available, r.unit, uom),
    qty(r.onHand, r.unit, uom),
    qty(r.reserve, r.unit, uom),
    qty(r.readyToBuild, r.unit, uom),
    qty(r.outbound, r.unit, uom),
    qty(r.inTransit, r.unit, uom),
    qty(r.onOrder, r.unit, uom),
    // Empty cell, NOT 0. The grid already renders an em dash for an absent
    // cost; writing 0 into a spreadsheet would be worse, because a spreadsheet
    // gets forwarded and totalled by someone who never saw the screen.
    r.avgCostPerUnit === null || r.avgCostPerUnit === undefined ? '' : r.avgCostPerUnit,
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
    // Board feet, square feet and pieces do not add up. Rather than write a
    // confident wrong number into a spreadsheet someone will forward, the
    // totals row goes blank and says why.
    mixedUnits ? 'mixed: ' + unitListLabel(totals.units) : displaySuffix(totalsUnit, uom),
    ...(mixedUnits
      ? ['', '', '', '', '', '', '']
      : [
          qty(totals.available, totalsUnit, uom),
          qty(totals.onHand, totalsUnit, uom),
          qty(totals.reserve, totalsUnit, uom),
          qty(totals.readyToBuild, totalsUnit, uom),
          qty(totals.outbound, totalsUnit, uom),
          qty(totals.inTransit, totalsUnit, uom),
          qty(totals.onOrder, totalsUnit, uom),
        ]),
    '',
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows, totalsRow]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hardwood');
  downloadXlsx(wb, `trader-screen-arch-${Date.now()}.xlsx`);
};
