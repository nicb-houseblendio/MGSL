import * as React from 'react';
import { formatQty, displaySuffix } from '@/lib/archUom';
import { lotIncomingInfo, formatShortDate } from '@/lib/archFixtures';
import { ARCH_BUCKET_META, ARCH_SURFACE } from '@/components/arch/archColors';
import type { ArchSummaryRow } from '@/types/arch';

/**
 * On Order view — purchase orders, not tallies.
 *
 * Stock still on order has not been received, so there is no tally: the supplier
 * sends the packing list with the shipment. What a trader needs here is the PO,
 * who it is with, and when it lands.
 */

interface ArchPOListViewProps {
  row: ArchSummaryRow;
  uom: string;
}

const EtaPill = ({ date, color }: { date: string; color: string }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 9px',
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 600,
      background: '#EEF2FB',
      color,
      border: `1px solid ${color}33`,
    }}
  >
    <svg
      width="13"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 16h20l-2 5H4z" />
      <path d="M6 16v-5h12v5" />
      <path d="M9 11V7h6v4" />
    </svg>
    {date}
  </span>
);

export const ArchPOListView = ({ row, uom }: ArchPOListViewProps) => {
  const meta = ARCH_BUCKET_META.onOrder;
  const lots = row.lots.filter((l) => (l.onOrder || 0) > 0);

  if (lots.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: ARCH_SURFACE.textLight, fontSize: 14 }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🛒</div>
        No open purchase orders
      </div>
    );
  }

  const total = lots.reduce((s, l) => s + (l.onOrder || 0), 0);

  const headerCell: React.CSSProperties = {
    padding: '8px 10px',
    background: 'linear-gradient(to bottom,#F1F5FA,#E8EDF5)',
    color: ARCH_SURFACE.textMid,
    fontWeight: 700,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    borderBottom: '2px solid #CBD5E1',
  };

  const cell: React.CSSProperties = {
    padding: '9px 10px',
    borderBottom: '1px solid #E2E8F0',
  };

  return (
    <div style={{ padding: '16px 18px 22px' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
        <thead>
          <tr>
            {['PO #', 'Supplier', 'Container #', 'ETA', `On Order (${displaySuffix(row.unit, uom)})`].map((h, i) => (
              <th key={h} style={{ ...headerCell, textAlign: i >= 3 ? 'right' : 'left' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lots.map((lot, i) => {
            const incoming = lotIncomingInfo(lot.lotNo, 'onOrder');
            return (
              <tr key={lot.lotNo} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC' }}>
                <td style={{ ...cell, fontWeight: 700, color: meta.color }} className="font-mono">
                  {lot.po}
                </td>
                <td style={{ ...cell, fontWeight: 600, color: ARCH_SURFACE.text }}>{incoming.supplier}</td>
                <td style={{ ...cell, fontSize: 11, color: ARCH_SURFACE.textMid }} className="font-mono">
                  {lot.containerNo || '—'}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  <EtaPill date={formatShortDate(incoming.eta)} color={meta.color} />
                </td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 700, color: ARCH_SURFACE.navy }} className="font-mono">
                  {formatQty(lot.onOrder, row.unit, uom)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: '#F1F5FA' }}>
            <td colSpan={4} style={{ ...cell, borderBottom: 'none', fontWeight: 700, color: ARCH_SURFACE.textMid }}>
              {lots.length} purchase order{lots.length === 1 ? '' : 's'}
            </td>
            <td
              style={{ ...cell, borderBottom: 'none', textAlign: 'right', fontWeight: 800, color: ARCH_SURFACE.navy }}
              className="font-mono"
            >
              {formatQty(total, row.unit, uom)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
