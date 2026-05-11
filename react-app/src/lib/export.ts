import * as XLSX from 'xlsx';
import type { SummaryRow } from './api';

interface Totals {
  onHand: number;
  committed: number;
  outbound: number;
  onOrder: number;
  inTransit: number;
  available: number;
}

// xlsx 0.18.5's escapexml fails to escape '&' in the Vite-minified bundle (escapes
// other XML chars correctly), producing malformed sheet1.xml that Excel renders as
// blank. Pre-escape '&' so the live bundle leaves it intact and the output is valid.
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

export const exportToExcel = (
  rows: SummaryRow[],
  totals: Totals,
  uom?: string
) => {
  const isPacks = uom === 'Packs';

  const headers: string[] = [
    'Item ID', 'Location', 'Item', 'Species',
    'Thickness', 'Width', 'Length', 'Grade',
    'Finish', 'Humidity', 'Planing', 'Stamping',
    ...(isPacks ? ['On Hand (MBF)'] : []),
    'On Hand', 'Committed', 'Outbound', 'On Order', 'In Transit', 'Available', 'Avg Price',
  ];

  const dataRows: (string | number)[][] = rows.map((r) => {
    const base: (string | number)[] = [
      escAmp(r.itemCode || ''),
      escAmp(r.locationName || ''),
      escAmp(r.itemName || ''),
      escAmp(r.species || ''),
      escAmp(r.thickness || ''),
      escAmp(r.width || ''),
      escAmp(r.length || ''),
      escAmp(r.grade || ''),
      escAmp(r.finition || ''),
      escAmp(r.humidity || ''),
      escAmp(r.plannage || ''),
      escAmp(r.etampage || ''),
    ];
    if (isPacks) base.push(r.quantityFBM ?? 0);
    base.push(
      r.onHand || 0,
      r.committed || 0,
      r.outbound || 0,
      r.onOrder || 0,
      r.inTransit || 0,
      r.available || 0,
      r.averageCost || 0,
    );
    return base;
  });

  const quantityFBMTotal = isPacks ? rows.reduce((sum, r) => sum + (r.quantityFBM ?? 0), 0) : 0;

  const totalsRow: (string | number)[] = [
    '', '',
    `TOTALS — ${rows.length} items`,
    '', '', '', '', '', '', '', '', '',
    ...(isPacks ? [quantityFBMTotal] : []),
    totals.onHand,
    totals.committed,
    totals.outbound,
    totals.onOrder,
    totals.inTransit,
    totals.available,
    0,
  ];

  const sheetData: (string | number)[][] = [headers, ...dataRows, totalsRow];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  downloadXlsx(wb, `trader-screen-${Date.now()}.xlsx`);
};
