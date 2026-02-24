import * as XLSX from 'xlsx';
import type { PivotRow } from './pivotTransform';

interface Totals {
  onHand: number;
  committed: number;
  outbound: number;
  inTransit: number;
  available: number;
}

export const exportToExcel = (
  pivotData: PivotRow[],
  totals: Totals
) => {
  const flatRows = pivotData.flatMap((row) => {
    if (row.subRows && row.subRows.length > 0) {
      return row.subRows.map((r) => ({
        Width: r.width,
        Length: r.length || '',
        'On Hand': r.onHand,
        Committed: r.committed,
        Outbound: r.outbound,
        'In Transit': r.inTransit,
        Available: r.available,
      }));
    }
    return [{
      Width: row.width,
      Length: row.length || '',
      'On Hand': row.onHand,
      Committed: row.committed,
      Outbound: row.outbound,
      'In Transit': row.inTransit,
      Available: row.available,
    }];
  });

  flatRows.push({
    Width: '',
    Length: 'TOTALS',
    'On Hand': totals.onHand,
    Committed: totals.committed,
    Outbound: totals.outbound,
    'In Transit': totals.inTransit,
    Available: totals.available,
  });

  const ws = XLSX.utils.json_to_sheet(flatRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  XLSX.writeFile(wb, `trader-screen-${Date.now()}.xlsx`);
};
