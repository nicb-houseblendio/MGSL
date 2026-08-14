import * as React from 'react';
import { formatArchQty, formatBF, formatCostPerBF, uomSuffix } from '@/lib/archUom';
import { isLotLocked, lockReason, lotQuantity, commitmentOn } from '@/lib/archLots';
import { lotAllocation, lotIncomingInfo, formatShortDate } from '@/lib/archFixtures';
import { ARCH_BUCKET_META, ARCH_SURFACE } from '@/components/arch/archColors';
import { TallyButton, TallyImageDialog } from '@/components/arch/TallyImageDialog';
import { ArchReservedSection } from '@/components/arch/ArchReservedSection';
import type { ArchSummaryRow, ArchDetailKey, ArchLot } from '@/types/arch';

/**
 * Lot-level table behind every quantity cell on the ARCH grid.
 *
 * Hardwood is sold by the bundle, so the unit a trader reasons about is the lot,
 * not the transaction. That is why this replaces the transaction list IND and MTL
 * show: what matters is which physical bundles exist, how big they are, who has
 * claimed them, and what their tally looks like.
 */

interface ArchLotTableProps {
  row: ArchSummaryRow;
  bucket: ArchDetailKey;
  uom: string;
  showReserved: boolean;
  onToggleReserved: () => void;
  /** Lot numbers currently ticked. Lifted so the SO cart can read it. */
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  /** Add the ticked bundles to the sales order cart. */
  onAddToCart?: (lotNos: string[], bucket: ArchDetailKey) => void;
  /** Lot numbers already in the cart, so the button can read as added. */
  cartLotNos?: Set<string>;
}

interface LeadColumn {
  label: string;
  render: (lot: ArchLot) => React.ReactNode;
  mono?: boolean;
  color?: (lot: ArchLot) => string | undefined;
}

const cellStyle: React.CSSProperties = {
  padding: '9px 10px',
  borderBottom: '1px solid #E2E8F0',
  color: ARCH_SURFACE.text,
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  fontSize: 12,
};

const headerCellStyle: React.CSSProperties = {
  padding: '7px 8px',
  background: 'linear-gradient(to bottom,#F1F5FA,#E8EDF5)',
  color: ARCH_SURFACE.textMid,
  fontWeight: 700,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  borderBottom: '2px solid #CBD5E1',
  borderRight: '1px solid #E2E8F0',
  whiteSpace: 'nowrap',
  textAlign: 'left',
};

const ageColor = (days: number) => (days > 21 ? '#B22222' : days > 10 ? '#B36B16' : '#2E7D32');

export const ArchLotTable = ({
  row,
  bucket,
  uom,
  showReserved,
  onToggleReserved,
  selected,
  onSelectionChange,
  onAddToCart,
  cartLotNos,
}: ArchLotTableProps) => {
  const [tallyOpen, setTallyOpen] = React.useState<string | null>(null);
  const [tallyImages, setTallyImages] = React.useState<Record<string, string>>({});

  const handleUpload = React.useCallback((lotNo: string, dataUrl: string) => {
    setTallyImages((m) => ({ ...m, [lotNo]: dataUrl }));
  }, []);

  const reserveMeta = ARCH_BUCKET_META.reserve;
  const isOnHand = bucket === 'onHand';
  /**
   * Views a trader could sell from. The bundle lock must apply to BOTH: a
   * partially-committed bundle still has net availability, so it shows up under
   * Available too, and offering it there would defeat the lock entirely.
   */
  const isSellableView = bucket === 'onHand' || bucket === 'available';

  /**
   * Lots to list: every lot with a quantity in this bucket. Nothing is hidden.
   *
   * An earlier version hid FULLY reserved bundles from the On Hand view so the
   * table read as "what could I still sell". That was wrong on two counts:
   *  - The header total is the row's full on-hand figure, so on 17 of 40 demo rows
   *    the visible lots did not add up to the number above them.
   *  - It drew an unprincipled line. Partially committed bundles are shown here
   *    (locked), so hiding only the fully committed ones was arbitrary — and it
   *    could empty the table completely on an item that plainly has stock.
   * Every bundle is listed; the lock badge says why one cannot be sold, and the
   * "Show reserved" toggle adds the order/customer detail underneath.
   */
  const lots = React.useMemo(
    () => row.lots.filter((l) => lotQuantity(l, bucket) > 0),
    [row.lots, bucket]
  );

  const selectableLots = React.useMemo(
    () => lots.filter((l) => !(isSellableView && isLotLocked(l))),
    [lots, isSellableView]
  );

  /**
   * Count only lots visible in THIS bucket. `selected` is held by the modal so it
   * survives a tab switch (a later phase needs it for the SO cart), which means a
   * raw `selected.size` would report bundles ticked on another tab and read as
   * "1 of 1 selected" with nothing ticked on screen.
   */
  const selectedInView = React.useMemo(
    () => lots.filter((l) => selected.has(l.lotNo)).length,
    [lots, selected]
  );

  const allSelected = selectableLots.length > 0 && selectableLots.every((l) => selected.has(l.lotNo));

  const toggleAll = () => {
    onSelectionChange(allSelected ? new Set() : new Set(selectableLots.map((l) => l.lotNo)));
  };

  const toggleOne = (lotNo: string) => {
    const next = new Set(selected);
    if (next.has(lotNo)) next.delete(lotNo);
    else next.add(lotNo);
    onSelectionChange(next);
  };

  /** Columns between the identity block and the quantity block, per bucket. */
  const leadColumns = React.useMemo<LeadColumn[]>(() => {
    if (bucket === 'reserve' || bucket === 'readyToBuild' || bucket === 'outbound') {
      const durationLabel =
        bucket === 'readyToBuild' ? 'Building For' : bucket === 'outbound' ? 'Held For' : 'Reserved For';
      return [
        {
          label: 'SO #',
          mono: true,
          color: () => ARCH_BUCKET_META[bucket].color,
          render: (l) => lotAllocation(l.lotNo, bucket).soNumber,
        },
        { label: 'SO Creation Date', render: (l) => formatShortDate(lotAllocation(l.lotNo, bucket).createdDate) },
        {
          label: durationLabel,
          mono: true,
          color: (l) => ageColor(lotAllocation(l.lotNo, bucket).ageDays),
          render: (l) => `${lotAllocation(l.lotNo, bucket).ageDays} d`,
        },
        { label: 'Ship Week', render: (l) => formatShortDate(lotAllocation(l.lotNo, bucket).shipWeek) },
        { label: 'Customer', render: (l) => lotAllocation(l.lotNo, bucket).customer },
        { label: 'Trader', render: (l) => lotAllocation(l.lotNo, bucket).trader },
      ];
    }
    if (bucket === 'inTransit') {
      return [
        { label: 'PO #', mono: true, render: (l) => l.po || '—' },
        { label: 'ETA', render: (l) => formatShortDate(lotIncomingInfo(l.lotNo, 'inTransit').eta) },
      ];
    }
    return [];
  }, [bucket]);

  const reservedTotal = isOnHand ? row.lots.reduce((s, l) => s + Math.round(l.reserve || 0), 0) : 0;

  /** Nothing here can be sold — every listed bundle carries a commitment. */
  const nothingSellable = isSellableView && lots.length > 0 && selectableLots.length === 0;

  return (
    <div style={{ padding: '14px 18px 22px' }}>
      {/* Toolbar — selection summary and the reserved toggle */}
      {lots.length > 0 && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 15,
            background: '#fff',
            margin: '-14px -18px 14px',
            padding: '12px 18px',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 11.5, color: ARCH_SURFACE.textMid, fontWeight: 600 }}>
            {/*
              "all are committed" was wrong and contradicted the row next to it:
              a bundle with 741 of 2,350 reserved shows Avail. 1,609 in green
              while the header claimed everything was spoken for. What is
              actually true is the RULE — any commitment holds the whole bundle,
              because a bundle is one physical lift and cannot be half-sold
              without going through the split flow.
            */}
            {nothingSellable
              ? `${lots.length} bundle${lots.length === 1 ? '' : 's'} — none sellable: any commitment holds the whole bundle`
              : selectedInView > 0
                ? `${selectedInView} of ${selectableLots.length} bundle${selectableLots.length === 1 ? '' : 's'} selected`
                : `${lots.length} bundle${lots.length === 1 ? '' : 's'}`}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
            {isOnHand && (
              <button
                type="button"
                onClick={onToggleReserved}
                role="switch"
                aria-checked={showReserved}
                title={showReserved ? 'Reserved lots listed under the on-hand table' : 'All on-hand lots'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <span
                  style={{
                    width: 30,
                    height: 16,
                    borderRadius: 20,
                    flexShrink: 0,
                    position: 'relative',
                    transition: 'background 0.14s',
                    background: showReserved ? reserveMeta.color : ARCH_SURFACE.border,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: showReserved ? 16 : 2,
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: '#fff',
                      transition: 'left 0.14s',
                      boxShadow: '0 1px 2px rgba(13,31,51,0.3)',
                    }}
                  />
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: showReserved ? reserveMeta.color : ARCH_SURFACE.textMid,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Show reserved
                </span>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: showReserved ? reserveMeta.color : ARCH_SURFACE.textLight,
                  }}
                >
                  {formatBF(reservedTotal)} <span style={{ fontSize: 9.5, opacity: 0.7 }}>BF</span>
                </span>
              </button>
            )}

            {/* Add to SO — only on views a trader can actually sell from. */}
            {isSellableView && onAddToCart && (
              <>
                <span style={{ width: 1, height: 20, background: '#E2E8F0', flexShrink: 0 }} />
                {(() => {
                  const ticked = lots.filter((l) => selected.has(l.lotNo) && !isLotLocked(l));
                  const allAdded =
                    ticked.length > 0 && ticked.every((l) => cartLotNos?.has(l.lotNo));
                  const disabled = ticked.length === 0 || allAdded;
                  return (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onAddToCart(ticked.map((l) => l.lotNo), bucket)}
                      title={
                        allAdded
                          ? 'These bundles are already on the order'
                          : ticked.length === 0
                            ? 'Tick one or more bundles first'
                            : undefined
                      }
                      style={{
                        padding: '6px 16px',
                        borderRadius: 7,
                        fontSize: 11.5,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        border: `1px solid ${disabled ? '#9DB0A4' : ARCH_SURFACE.green}`,
                        background: allAdded ? '#fff' : disabled ? '#9DB0A4' : ARCH_SURFACE.green,
                        color: allAdded ? ARCH_SURFACE.green : '#fff',
                        opacity: disabled && !allAdded ? 0.7 : 1,
                      }}
                    >
                      <span style={{ fontSize: 13, lineHeight: 1 }}>{allAdded ? '✓' : '＋'}</span>
                      {allAdded ? 'Added to SO' : `Add to SO${ticked.length ? ` (${ticked.length})` : ''}`}
                    </button>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {lots.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: ARCH_SURFACE.textLight, fontSize: 14 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
          No bundles in this status
        </div>
      ) : (
        <div
          style={{
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(13,31,51,0.06)',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={{ ...headerCellStyle, width: 32, textAlign: 'center', borderRight: 'none' }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={selectableLots.length === 0}
                      aria-label="Select all bundles"
                      style={{ width: 13, height: 13, accentColor: ARCH_SURFACE.navy, margin: 0, cursor: 'pointer' }}
                    />
                  </th>
                  <th style={headerCellStyle}>Lot #</th>
                  <th style={headerCellStyle}>Container #</th>
                  {isOnHand && <th style={headerCellStyle}>Res.</th>}
                  {leadColumns.map((c) => (
                    <th key={c.label} style={headerCellStyle}>
                      {c.label}
                    </th>
                  ))}
                  <th style={headerCellStyle}>Grain</th>
                  <th style={{ ...headerCellStyle, textAlign: 'right' }}>Total {uomSuffix(uom)}</th>
                  {isOnHand && (
                    <th
                      style={{ ...headerCellStyle, textAlign: 'right' }}
                      title="Uncommitted board feet — this bundle's on-hand less anything reserved, released to build, or held for shipment"
                    >
                      Avail. {uomSuffix(uom)}
                    </th>
                  )}
                  <th style={{ ...headerCellStyle, textAlign: 'right' }}>BF Cost</th>
                  <th style={{ ...headerCellStyle, width: 44, textAlign: 'center' }}>Tally</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot, i) => {
                  const lock = isSellableView ? lockReason(lot) : null;
                  const locked = !!lock;
                  const reserved = Math.round(lot.reserve || 0);
                  // Uncommitted on-hand for THIS bundle. Deliberately not
                  // lotQuantity(lot,'available'), which is a cross-bucket rollup
                  // and falls back to incoming quantity once a bundle is fully
                  // committed — that would print in-transit board feet in an
                  // on-hand column. Clamped because commitments are independent
                  // figures and could in principle over-subscribe a bundle.
                  const freeBF = Math.max(0, (lot.onHand || 0) - commitmentOn(lot));
                  const hasImage = !!(tallyImages[lot.lotNo] || lot.tallyImageUrl);
                  return (
                    <tr key={lot.lotNo} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC' }}>
                      <td
                        style={{ ...cellStyle, textAlign: 'center' }}
                        title={
                          lock
                            ? `${lock.detail} — the whole bundle is locked until that is resolved`
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(lot.lotNo)}
                          onChange={() => toggleOne(lot.lotNo)}
                          disabled={locked}
                          aria-label={`Select bundle ${lot.lotNo}`}
                          style={{
                            width: 14,
                            height: 14,
                            accentColor: ARCH_SURFACE.navy,
                            cursor: locked ? 'not-allowed' : 'pointer',
                            margin: 0,
                            opacity: locked ? 0.35 : 1,
                          }}
                        />
                        {lock && (
                          <div
                            style={{
                              fontSize: 8,
                              fontWeight: 800,
                              letterSpacing: 0.3,
                              textTransform: 'uppercase',
                              color: lock.color,
                              marginTop: 1,
                            }}
                          >
                            {lock.badge}
                          </div>
                        )}
                      </td>
                      <td style={{ ...cellStyle, fontWeight: 700, color: ARCH_SURFACE.navyMid }} className="font-mono">
                        {lot.lotNo}
                      </td>
                      <td style={{ ...cellStyle, fontSize: 11, color: ARCH_SURFACE.textMid }} className="font-mono">
                        {lot.containerNo || '—'}
                      </td>
                      {isOnHand && (
                        <td
                          style={{ ...cellStyle, padding: '6px 10px' }}
                          title={
                            reserved > 0
                              ? `${formatBF(reserved)} BF of this bundle is reserved — turn on "Show reserved" for detail`
                              : 'Nothing reserved on this bundle'
                          }
                        >
                          {reserved > 0 ? (
                            <span
                              className="font-mono"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: 10.5,
                                fontWeight: 700,
                                color: reserveMeta.color,
                                background: `${reserveMeta.color}14`,
                                border: `1px solid ${reserveMeta.color}44`,
                                borderRadius: 4,
                                padding: '1px 6px',
                              }}
                            >
                              <span
                                style={{ width: 5, height: 5, borderRadius: '50%', background: reserveMeta.color }}
                              />
                              {formatBF(reserved)} <span style={{ fontSize: 9, opacity: 0.75 }}>BF</span>
                            </span>
                          ) : (
                            <span style={{ color: ARCH_SURFACE.border, fontSize: 11 }}>—</span>
                          )}
                        </td>
                      )}
                      {leadColumns.map((c) => (
                        <td
                          key={c.label}
                          className={c.mono ? 'font-mono' : undefined}
                          style={{
                            ...cellStyle,
                            fontWeight: c.mono ? 700 : 500,
                            color: c.color?.(lot) || (c.mono ? ARCH_SURFACE.navyMid : ARCH_SURFACE.text),
                          }}
                        >
                          {c.render(lot)}
                        </td>
                      ))}
                      <td style={{ ...cellStyle, color: ARCH_SURFACE.textMid }}>{row.grain || '—'}</td>
                      <td
                        style={{ ...cellStyle, textAlign: 'right', fontWeight: 700, color: ARCH_SURFACE.navy }}
                        className="font-mono"
                      >
                        {formatArchQty(lotQuantity(lot, bucket), uom)}
                      </td>
                      {isOnHand && (
                        <td
                          style={{
                            ...cellStyle,
                            textAlign: 'right',
                            fontWeight: 700,
                            // Dimmed at zero so a fully committed bundle reads as
                            // "nothing here for you" at a glance rather than as a
                            // figure to be scanned. Same grey the grid dims its
                            // zeros to; the border colour is faint enough that a
                            // lone 0 in it reads as a rendering artifact.
                            color: freeBF > 0 ? '#1B5E20' : '#7A8FA3',
                          }}
                          className="font-mono"
                        >
                          {formatArchQty(freeBF, uom)}
                        </td>
                      )}
                      <td style={{ ...cellStyle, textAlign: 'right' }} className="font-mono">
                        {formatCostPerBF(row.avgCostBF)}
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'center', paddingLeft: 6, paddingRight: 10 }}>
                        <TallyButton
                          hasImage={hasImage}
                          onClick={(e) => {
                            e.stopPropagation();
                            setTallyOpen(lot.lotNo);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isOnHand && showReserved && (
        <ArchReservedSection row={row} tallyImages={tallyImages} onUploadTally={handleUpload} />
      )}

      {tallyOpen && (
        <TallyImageDialog
          lotNo={tallyOpen}
          itemDescription={row.description}
          imageUrl={tallyImages[tallyOpen] || row.lots.find((l) => l.lotNo === tallyOpen)?.tallyImageUrl}
          onClose={() => setTallyOpen(null)}
          onUpload={handleUpload}
        />
      )}
    </div>
  );
};
