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

export const exportToExcelMTL = (rows: SummaryRow[], totals: Totals, uom?: string) => {
  const isPacks = uom === 'Packs';

  // Explicit type required — conditional spread causes TypeScript inference failure on .push()
  const excelRows: Record<string, string | number>[] = rows.map((r) => ({
    'Location':       r.locationName || '',
    'Item Code':      r.itemCode || '',
    'Item Description': r.itemName || '',
    'Vendor':         r.vendor || '',
    'Thickness':      r.thickness || '',
    'Width':          r.width || '',
    'Length':         r.length || '',
    'Grade':          r.grade || '',
    ...(isPacks ? { 'On Hand (MBF)': r.quantityFBM ?? 0 } : {}),
    'On Hand':        r.onHand || 0,
    'Committed':      r.committed || 0,
    'Outbound':       r.outbound || 0,
    'On Order':       r.onOrder || 0,
    'In Transit':     r.inTransit || 0,
    'Available':      r.available || 0,
  }));

  const onHandMBFTotal = isPacks ? rows.reduce((s, r) => s + (r.quantityFBM ?? 0), 0) : undefined;

  excelRows.push({
    'Location':   '',
    'Item Code':  '',
    'Item Description': '',
    'Vendor':     `TOTALS — ${rows.length} rows`,
    'Thickness':  '',
    'Width':      '',
    'Length':     '',
    'Grade':      '',
    ...(isPacks ? { 'On Hand (MBF)': onHandMBFTotal ?? 0 } : {}),
    'On Hand':    totals.onHand,
    'Committed':  totals.committed,
    'Outbound':   totals.outbound,
    'On Order':   totals.onOrder,
    'In Transit': totals.inTransit,
    'Available':  totals.available,
  });

  const ws = XLSX.utils.json_to_sheet(excelRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MTL Inventory');
  XLSX.writeFile(wb, `trader-screen-mtl-${Date.now()}.xlsx`);
};
