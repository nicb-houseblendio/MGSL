import * as React from 'react';
import { formatQty, formatCostPerUnit, displaySuffix, unitLabel } from '@/lib/archUom';
import { isLotLocked, lockReason, lotQuantity, commitmentOn } from '@/lib/archLots';
import { bucketLots, bucketGap, bucketGapReason, notSourcedNote } from '@/lib/archBuckets';
import { lotAllocation, lotIncomingInfo, formatShortDate } from '@/lib/archFixtures';
import {
  orderSource,
  ordersFor,
  oldestAge,
  joinValues,
  formatOrderDate,
  traderName,
  NO_VALUE,
} from '@/lib/archLotOrders';
import { ARCH_BUCKET_META, ARCH_RESERVE_INK, ARCH_SURFACE } from '@/components/arch/archColors';
import { TallyButton, TallyImageDialog } from '@/components/arch/TallyImageDialog';
import { demoTallyProps } from '@/lib/archTallyFixtures';
import { ArchReservedSection } from '@/components/arch/ArchReservedSection';
import type { ArchSummaryRow, ArchDetailKey, ArchLot, ArchLotOrder } from '@/types/arch';

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
  /**
   * Hover text for the cell.
   *
   * Added 2026-09-08 for the SO columns: this table is one row per BUNDLE, and a
   * bundle held by several sales orders cannot show them all in one cell. It
   * shows the first plus `+N` and names the rest here, so the extra claims are
   * disclosed rather than dropped.
   */
  title?: (lot: ArchLot) => string | undefined;
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

// #B36B16 measured 4.17:1 on white. #8F5612 is the same amber, AA-clear.
const ageColor = (days: number) => (days > 21 ? '#B22222' : days > 10 ? '#8F5612' : '#2E7D32');

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
  const meta = ARCH_BUCKET_META[bucket];
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
  const lots = React.useMemo(() => bucketLots(row, bucket), [row, bucket]);

  /**
   * Quantity the header total carries that NO bundle here claims.
   *
   * Row buckets are summed from the order LINES; per-lot buckets exist only
   * where a line names an inventory number. Where they disagree the table used
   * to print a header total and a shorter list of bundles and say nothing — the
   * shape that reads as stock having gone missing (Marc-Antoine, 2026-09-08:
   * « on dirait qu'il fait juste disparaitre du TS »). It is named now.
   */
  const gap = React.useMemo(() => bucketGap(row, bucket), [row, bucket]);
  const gapReason = gap > 0 ? bucketGapReason(bucket) : null;
  const notSourced = notSourcedNote(bucket);

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
      // Outbound's label used to say the stock was being held, which is the
      // opposite of the truth: outbound is `quantityshiprecv`, wood that has
      // already left on an Item Fulfillment. Nothing is holding it. The figure
      // beside it is elapsed time since the shipment.
      const durationLabel =
        bucket === 'readyToBuild' ? 'Building For' : bucket === 'outbound' ? 'Shipped' : 'Reserved For';
      /* ── REAL ORDERS WHERE THERE ARE ANY ─────────────────────────────────
       *
       * These six columns came entirely from `lotAllocation()`, a seeded
       * generator, until 2026-09-08. The cache now carries the sales orders
       * behind a bundle's reserve, so `lib/archLotOrders.ts` decides per bundle:
       *
       *   real orders  → render them
       *   live payload → em dash, never a generated value
       *   no `orders`  → the generator, which is what the Reserved panel's
       *                  placeholder banner is warning about
       *
       * ⚠️ ONE ROW PER BUNDLE IS STRUCTURAL HERE, unlike the Reserved panel.
       * The quantity block to the right of these cells describes the BUNDLE, so
       * this table cannot split a bundle into one row per order. A bundle with
       * two claims therefore reads `SO-CWP-001344 +1` with both named in the
       * tooltip: disclosed, not silently narrowed to one. The panel below the On
       * Hand table is the place that lists every claim on its own line.
       *
       * ⚠️ `readyToBuild` and `outbound` can never resolve to a real order and
       * that is correct, not a gap to close. readyToBuild is a literal 0 in the
       * cache, so no live bundle is ever listed under it; outbound is
       * deliberately attributed to no bundle, because the wood has shipped and
       * the bundle's on-hand is already net of it.
       */
      const claims = (l: ArchLot) => ordersFor(l, bucket);
      const fixture = (l: ArchLot) =>
        orderSource(l, bucket) === 'unsourced' ? lotAllocation(l.lotNo, bucket) : null;
      /** The generated value where nothing can be sourced, else an em dash. */
      const fallback = (l: ArchLot, pick: (f: ReturnType<typeof lotAllocation>) => string): string => {
        const f = fixture(l);
        return f ? pick(f) : NO_VALUE;
      };
      const joined = (l: ArchLot, pick: (o: ArchLotOrder) => string) => joinValues(claims(l).map(pick));

      return [
        {
          label: 'SO #',
          mono: true,
          color: () => ARCH_BUCKET_META[bucket].color,
          render: (l) =>
            claims(l).length ? joined(l, (o) => o.soNumber).text : fallback(l, (f) => f.soNumber),
          title: (l) =>
            claims(l).length > 1
              ? `${l.lotNo} is held by ${claims(l).length} sales orders: ${joined(l, (o) => o.soNumber).title}`
              : undefined,
        },
        {
          label: 'SO Creation Date',
          render: (l) =>
            claims(l).length
              ? joinValues(claims(l).map((o) => formatOrderDate(o.created))).text
              : fallback(l, (f) => formatShortDate(f.createdDate)),
        },
        {
          label: durationLabel,
          mono: true,
          // The OLDEST claim on the bundle, which is the one worth chasing.
          color: (l) => {
            const a = claims(l).length ? oldestAge(claims(l)) : fixture(l)?.ageDays ?? null;
            return a === null ? ARCH_SURFACE.textLight : ageColor(a);
          },
          render: (l) => {
            const a = claims(l).length ? oldestAge(claims(l)) : fixture(l)?.ageDays ?? null;
            return a === null ? NO_VALUE : `${a} d`;
          },
          title: (l) =>
            claims(l).length > 1 ? 'The oldest of this bundle’s reservations' : undefined,
        },
        {
          label: 'Ship Week',
          render: (l) =>
            claims(l).length
              ? joinValues(claims(l).map((o) => formatOrderDate(o.shipDate))).text
              : fallback(l, (f) => formatShortDate(f.shipWeek)),
        },
        {
          label: 'Customer',
          render: (l) => (claims(l).length ? joined(l, (o) => o.customer).text : fallback(l, (f) => f.customer)),
          title: (l) => joined(l, (o) => o.customer).title,
        },
        {
          // The Sales Team rep. Never the record's creator: Marc-Antoine treats
          // those as two different things, and on 2 of the 4 real ARCH orders the
          // creator is a developer account. The Open Orders tab shows both in
          // labelled columns; this cell must not conflate them.
          label: 'Trader',
          render: (l) => (claims(l).length ? joined(l, traderName).text : fallback(l, (f) => f.trader)),
          title: (l) => joined(l, traderName).title,
        },
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
  /**
   * The row's RESERVED column can be larger than the figure on this toggle: the
   * column is summed from the order lines, the toggle from the bundles those
   * lines name. An order written without inventory detail moves the column and
   * leaves every bundle at zero, so the panel below would open empty against a
   * non-zero column. Declared on the toggle rather than left to be discovered.
   */
  const reservedNotOnAnyBundle = isOnHand ? Math.max(0, Math.round(row.reserve || 0) - reservedTotal) : 0;

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
                title={
                  reservedNotOnAnyBundle > 0
                    ? `${formatQty(reservedNotOnAnyBundle, row.unit)} ${unitLabel(row.unit)} more is reserved on this row's order lines but names no bundle, so it cannot be listed`
                    : showReserved
                      ? 'Reserved lots listed under the on-hand table'
                      : 'All on-hand lots'
                }
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
                    color: showReserved ? ARCH_RESERVE_INK : ARCH_SURFACE.textMid,
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
                    color: showReserved ? ARCH_RESERVE_INK : ARCH_SURFACE.textLight,
                  }}
                >
                  {formatQty(reservedTotal, row.unit)} <span style={{ fontSize: 9.5 }}>{unitLabel(row.unit)}</span>
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

      {/*
        THE RECONCILIATION LINE. Shown whenever the header total is bigger than
        the bundles listed under it, and it names the cause rather than leaving
        the trader to work out whether they are looking at a data gap or a bug.
        Not shown on a bucket that has no source at all — the notice below says
        something stronger about those.
      */}
      {gap > 0 && gapReason && !notSourced && (
        <div
          style={{
            margin: '0 0 12px',
            background: '#FFFBEB',
            border: '1px solid #FCD34D',
            borderRadius: 8,
            padding: '8px 11px',
            fontSize: 11,
            color: '#92400E',
            lineHeight: 1.5,
          }}
        >
          <b className="font-mono">
            {formatQty(gap, row.unit, uom)} {displaySuffix(row.unit, uom)}
          </b>{' '}
          of the {meta.label.toLowerCase()} total above is not attributed to any bundle, so it cannot be
          listed here. {gapReason}. The column total is still correct.
        </div>
      )}

      {/*
        A bucket with NO NetSuite source. `readyToBuild` is a hardcoded 0 in the
        ARCH cache, so this tab can never hold anything and its header total can
        never be anything but zero. Marc-Antoine expects a new order to land
        here; saying why it does not beats an empty table that looks like a
        transient state.
      */}
      {notSourced && (
        <div
          style={{
            margin: '0 0 12px',
            background: '#FFFBEB',
            border: '1px solid #FCD34D',
            borderRadius: 8,
            padding: '8px 11px',
            fontSize: 11,
            color: '#92400E',
            lineHeight: 1.5,
          }}
        >
          <b>Not sourced yet.</b> {notSourced}
        </div>
      )}

      {lots.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: ARCH_SURFACE.textLight, fontSize: 14 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
          {/*
            "No bundles in this status" was the only message, and on a bucket
            carrying a quantity it was the wrong one — it read as "there is none
            of this", which is exactly the vanishing Marc-Antoine described. The
            quantity is real; what is missing is the bundle attribution.
          */}
          {gap > 0 && !notSourced
            ? `The ${meta.label.toLowerCase()} total is real, but no bundle carries it, so there is nothing to list`
            : 'No bundles in this status'}
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
                  {/*
                    "Total" was wrong on the Available tab, where the cell holds
                    the bundle's UNCOMMITTED remainder rather than its total —
                    741 of a 2,350 BF bundle reserved makes this cell 1,609, and
                    calling that the bundle's total is how a reserved bundle came
                    to read as available stock.
                  */}
                  <th
                    style={{ ...headerCellStyle, textAlign: 'right' }}
                    title={
                      bucket === 'available'
                        ? "Uncommitted quantity this bundle can contribute: its on-hand less anything reserved or released to build"
                        : undefined
                    }
                  >
                    {bucket === 'available' ? 'Avail.' : 'Total'} {displaySuffix(row.unit, uom)}
                  </th>
                  {isOnHand && (
                    <th
                      style={{ ...headerCellStyle, textAlign: 'right' }}
                      title="Uncommitted board feet — this bundle's on-hand less anything reserved, released to build, or held for shipment"
                    >
                      Avail. {displaySuffix(row.unit, uom)}
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
                              ? `${formatQty(reserved, row.unit)} ${unitLabel(row.unit)} of this bundle is reserved — turn on "Show reserved" for detail`
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
                                color: ARCH_RESERVE_INK,
                                background: `${reserveMeta.color}14`,
                                border: `1px solid ${reserveMeta.color}44`,
                                borderRadius: 4,
                                padding: '1px 6px',
                              }}
                            >
                              <span
                                style={{ width: 5, height: 5, borderRadius: '50%', background: reserveMeta.color }}
                              />
                              {formatQty(reserved, row.unit)} <span style={{ fontSize: 9 }}>{unitLabel(row.unit)}</span>
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
                          title={c.title?.(lot)}
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
                        {formatQty(lotQuantity(lot, bucket), row.unit, uom)}
                      </td>
                      {isOnHand && (
                        <td
                          style={{
                            ...cellStyle,
                            textAlign: 'right',
                            fontWeight: 700,
                            // Dimmed at zero so a fully committed bundle reads as
                            // "nothing here for you" at a glance rather than as a
                            // figure to be scanned. Must come from the palette, not
                            // a literal: this cell had #7A8FA3 hard-coded and so
                            // missed the AA fix, measuring 3.34:1 on the white rows
                            // and 3.21 on the #F8FAFC ones.
                            color: freeBF > 0 ? '#1B5E20' : ARCH_SURFACE.textLight,
                          }}
                          className="font-mono"
                        >
                          {formatQty(freeBF, row.unit, uom)}
                        </td>
                      )}
                      <td style={{ ...cellStyle, textAlign: 'right' }} className="font-mono">
                        {formatCostPerUnit(row.avgCostPerUnit, row.unit)}
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
          /* Real tally when the ARCH cache resolved one for this lot (row.lots[].tally),
             else the labelled fixture so the four render states stay reviewable. The
             selection is demoTallyProps, the only place that decides. */
          {...demoTallyProps(tallyOpen, row.lots.find((l) => l.lotNo === tallyOpen)?.tally)}
        />
      )}
    </div>
  );
};
