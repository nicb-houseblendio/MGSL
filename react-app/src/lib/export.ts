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

export const exportToExcel = (
  rows: SummaryRow[],
  totals: Totals
) => {
  const excelRows = rows.map((r) => ({
    'Item ID': r.itemCode || '',
    'Location': r.locationName || '',
    'Item': r.itemName || '',
    'Species': r.species || '',
    'Thickness': r.thickness || '',
    'Width': r.width || '',
    'Length': r.length || '',
    'Grade': r.grade || '',
    'Finish': r.finition || '',
    'Humidity': r.humidity || '',
    'Planing': r.plannage || '',
    'Stamping': r.etampage || '',
    'On Hand': r.onHand || 0,
    'Committed': r.committed || 0,
    'Outbound': r.outbound || 0,
    'On Order': r.onOrder || 0,
    'In Transit': r.inTransit || 0,
    'Available': r.available || 0,
    'Avg Price': r.averageCost || 0,
  }));

  excelRows.push({
    'Item ID': '',
    'Location': '',
    'Item': `TOTALS — ${rows.length} items`,
    'Species': '',
    'Thickness': '',
    'Width': '',
    'Length': '',
    'Grade': '',
    'Finish': '',
    'Humidity': '',
    'Planing': '',
    'Stamping': '',
    'On Hand': totals.onHand,
    'Committed': totals.committed,
    'Outbound': totals.outbound,
    'On Order': totals.onOrder,
    'In Transit': totals.inTransit,
    'Available': totals.available,
    'Avg Price': 0,
  });

  const ws = XLSX.utils.json_to_sheet(excelRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  XLSX.writeFile(wb, `trader-screen-${Date.now()}.xlsx`);
};
