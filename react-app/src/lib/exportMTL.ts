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

export const exportToExcelMTL = (rows: SummaryRow[], totals: Totals, uom?: string) => {
  const isPacks = uom === 'Packs';

  const headers: string[] = [
    'Location', 'Item Code', 'Item Description', 'Vendor',
    'Thickness', 'Width', 'Length', 'Grade',
    ...(isPacks ? ['On Hand (MBF)'] : []),
    'On Hand', 'Committed', 'Outbound', 'On Order', 'In Transit', 'Available', 'To Be Sold',
  ];

  const dataRows: (string | number)[][] = rows.map((r) => {
    const base: (string | number)[] = [
      escAmp(r.locationName || ''),
      escAmp(r.itemCode || ''),
      escAmp(r.itemName || ''),
      escAmp(r.vendor || ''),
      escAmp(r.thickness || ''),
      escAmp(r.width || ''),
      escAmp(r.length || ''),
      escAmp(r.grade || ''),
    ];
    if (isPacks) base.push(r.quantityFBM ?? 0);
    base.push(
      r.onHand || 0,
      r.committed || 0,
      r.outbound || 0,
      r.onOrder || 0,
      r.inTransit || 0,
      r.available || 0,
      (r.onHand || 0) - (r.committed || 0) - (r.outbound || 0) + (r.inTransit || 0),
    );
    return base;
  });

  const onHandMBFTotal = isPacks ? rows.reduce((s, r) => s + (r.quantityFBM ?? 0), 0) : 0;

  const totalsRow: (string | number)[] = [
    '', '', '',
    `TOTALS — ${rows.length} rows`,
    '', '', '', '',
    ...(isPacks ? [onHandMBFTotal] : []),
    totals.onHand,
    totals.committed,
    totals.outbound,
    totals.onOrder,
    totals.inTransit,
    totals.available,
    totals.onHand - totals.committed - totals.outbound + totals.inTransit,
  ];

  const sheetData: (string | number)[][] = [headers, ...dataRows, totalsRow];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MTL Inventory');
  downloadXlsx(wb, `trader-screen-mtl-${Date.now()}.xlsx`);
};
