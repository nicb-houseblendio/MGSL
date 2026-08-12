import * as React from 'react';
import { formatBF } from '@/lib/archUom';
import { lotAllocation, formatShortDate } from '@/lib/archFixtures';
import { ARCH_BUCKET_META, ARCH_SURFACE } from '@/components/arch/archColors';
import { TallyButton, TallyImageDialog } from '@/components/arch/TallyImageDialog';
import type { ArchSummaryRow } from '@/types/arch';

/**
 * Reserved lots, listed under the On Hand table.
 *
 * Reserved stock is a SUBSET of the on-hand boards above — it is not a separate
 * pile. It is broken out because of the bundle-split rule: a bundle with any
 * reservation at all is locked in full, so a trader looking at on-hand needs to
 * see which bundles are spoken for and by whom before promising anything.
 *
 * Quantities here are always board feet, matching the tally tables.
 */

interface ArchReservedSectionProps {
  row: ArchSummaryRow;
  tallyImages: Record<string, string>;
  onUploadTally: (lotNo: string, dataUrl: string) => void;
}

const COLUMNS = ['Lot #', 'Container #', 'SO #', 'SO Creation Date', 'Reserved For', 'Ship Week', 'Customer', 'Trader'];

export const ArchReservedSection = ({ row, tallyImages, onUploadTally }: ArchReservedSectionProps) => {
  const accent = ARCH_BUCKET_META.reserve.color;
  const [tallyOpen, setTallyOpen] = React.useState<string | null>(null);

  const rows = React.useMemo(
    () =>
      row.lots
        .filter((l) => (l.reserve || 0) > 0)
        .map((lot) => ({ lot, allocation: lotAllocation(lot.lotNo, 'reserve'), qty: Math.round(lot.reserve) })),
    [row.lots]
  );

  const total = rows.reduce((s, r) => s + r.qty, 0);

  const headerCell: React.CSSProperties = {
    padding: '8px 10px',
    background: 'linear-gradient(to bottom,#FFF6EC,#FDEEDD)',
    color: '#7A4100',
    fontWeight: 700,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    borderBottom: `2px solid ${accent}44`,
    borderRight: `1px solid ${accent}22`,
    whiteSpace: 'nowrap',
    textAlign: 'left',
  };

  const cell: React.CSSProperties = {
    padding: '9px 10px',
    borderBottom: '1px solid #E2E8F0',
    color: ARCH_SURFACE.text,
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
    fontSize: 12,
  };

  /** Older reservations are the ones worth chasing — colour by age. */
  const ageColor = (days: number) => (days > 21 ? '#B22222' : days > 10 ? '#B36B16' : '#2E7D32');

  return (
    <div
      style={{
        margin: '18px 0 6px',
        border: `1px solid ${accent}44`,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(13,31,51,0.06)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 12px',
          background: `${accent}14`,
          borderBottom: `1px solid ${accent}33`,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: accent }}>
          Reserved
        </span>
        <span style={{ fontSize: 11.5, color: ARCH_SURFACE.textMid }}>
          {rows.length} lot{rows.length === 1 ? '' : 's'} of the on-hand stock above committed to sales orders
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: accent }} className="font-mono">
          {formatBF(total)} <span style={{ fontSize: 9.5, opacity: 0.7 }}>BF</span>
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 18, textAlign: 'center', color: ARCH_SURFACE.textLight, fontSize: 12.5 }}>
          No reserved quantities on this item
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c} style={headerCell}>
                    {c}
                  </th>
                ))}
                <th style={{ ...headerCell, textAlign: 'right' }}>Reserved BF</th>
                <th style={{ ...headerCell, width: 44, textAlign: 'center' }}>Tally</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ lot, allocation, qty }, i) => (
                <tr key={lot.lotNo} style={{ background: i % 2 === 0 ? '#fff' : '#FDF9F4' }}>
                  <td style={{ ...cell, fontWeight: 600, color: ARCH_SURFACE.navyMid, fontSize: 11 }} className="font-mono">
                    {lot.lotNo}
                  </td>
                  <td style={{ ...cell, fontSize: 11, color: ARCH_SURFACE.textMid }} className="font-mono">
                    {lot.containerNo || '—'}
                  </td>
                  <td style={{ ...cell, fontWeight: 700, color: accent }} className="font-mono">
                    {allocation.soNumber}
                  </td>
                  <td style={{ ...cell, color: ARCH_SURFACE.textMid }}>{formatShortDate(allocation.createdDate)}</td>
                  <td style={{ ...cell, fontWeight: 700, color: ageColor(allocation.ageDays) }} className="font-mono">
                    {allocation.ageDays} d
                  </td>
                  <td style={{ ...cell, color: ARCH_SURFACE.textMid }}>{formatShortDate(allocation.shipWeek)}</td>
                  <td style={cell}>{allocation.customer}</td>
                  <td style={{ ...cell, color: ARCH_SURFACE.textMid }}>{allocation.trader}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700, color: accent }} className="font-mono">
                    {formatBF(qty)}
                  </td>
                  <td style={{ ...cell, textAlign: 'center', paddingLeft: 6, paddingRight: 10 }}>
                    <TallyButton
                      hasImage={!!(tallyImages[lot.lotNo] || lot.tallyImageUrl)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTallyOpen(lot.lotNo);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tallyOpen && (
        <TallyImageDialog
          lotNo={tallyOpen}
          itemDescription={row.description}
          imageUrl={tallyImages[tallyOpen] || row.lots.find((l) => l.lotNo === tallyOpen)?.tallyImageUrl}
          onClose={() => setTallyOpen(null)}
          onUpload={onUploadTally}
        />
      )}
    </div>
  );
};
