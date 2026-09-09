import * as React from 'react';
import { formatQty, unitLabel } from '@/lib/archUom';
import { lotAllocation, formatShortDate } from '@/lib/archFixtures';
import {
  reservedRows,
  anyUnsourced,
  anyUnavailable,
  formatOrderDate,
  traderName,
  NO_VALUE,
} from '@/lib/archLotOrders';
import { ARCH_BUCKET_META, ARCH_RESERVE_INK, ARCH_SURFACE } from '@/components/arch/archColors';
import { TallyButton, TallyImageDialog } from '@/components/arch/TallyImageDialog';
import { demoTallyProps } from '@/lib/archTallyFixtures';
import type { ArchSummaryRow } from '@/types/arch';

/**
 * Reserved lots, listed under the On Hand table.
 *
 * Reserved stock is a SUBSET of the on-hand boards above — it is not a separate
 * pile. It is broken out because of the bundle-split rule: a bundle with any
 * reservation at all is locked in full, so a trader looking at on-hand needs to
 * see which bundles are spoken for and by whom before promising anything.
 *
 * ⚠️ QUANTITIES ARE IN THE ROW'S OWN UNIT, not board feet. This comment used to
 * read "always board feet, matching the tally tables", which stopped being true
 * when ARCH became multi-unit: Lumber is BF, Veneer is SQFT, Ovals are pieces.
 * `WALVENFCAA` is a live SQFT item in this account. The cells format with
 * `row.unit` and so, since 2026-09-08, does the column header.
 *
 * ── The SO columns are REAL as of 2026-09-08 ───────────────────────────────
 * SO #, SO Creation Date, Reserved For, Ship Week, Customer and Trader came from
 * `lotAllocation()`, a seeded generator, until the ARCH cache started carrying
 * the sales orders behind each bundle's reserve. The generator is now reached
 * only where nothing can source them — a fixture row, or a cached payload
 * written before the field existed — and the placeholder banner appears with it.
 * See lib/archLotOrders.ts for the three states and why an empty array is not
 * the same as an absent one.
 */

interface ArchReservedSectionProps {
  row: ArchSummaryRow;
  tallyImages: Record<string, string>;
  onUploadTally: (lotNo: string, dataUrl: string) => void;
}

const COLUMNS = ['Lot #', 'Container #', 'SO #', 'SO Creation Date', 'Reserved For', 'Ship Week', 'Customer', 'Trader'];

export const ArchReservedSection = ({ row, tallyImages, onUploadTally }: ArchReservedSectionProps) => {
  // `accent` paints fills — borders and tints, where contrast rules do not apply.
  // Anything that becomes a glyph uses `ink`: the same orange is under AA as text.
  const accent = ARCH_BUCKET_META.reserve.color;
  const ink = ARCH_RESERVE_INK;
  const [tallyOpen, setTallyOpen] = React.useState<string | null>(null);

  /**
   * ONE ROW PER (BUNDLE, ORDER), not per bundle.
   *
   * A bundle can be held by more than one sales order — 31 inventory numbers in
   * this sandbox are held by two or more open orders right now, one of them by
   * 17 — so collapsing to one row per bundle would have to choose a customer,
   * and would print one customer's name over another's reservation. Every claim
   * gets its own line with its own share, and `reservedRows` guarantees the
   * shares still sum to the footer figure below.
   */
  const reserved = React.useMemo(() => row.lots.filter((l) => (l.reserve || 0) > 0), [row.lots]);
  const rows = React.useMemo(() => reservedRows(reserved), [reserved]);

  /**
   * ⚠️ THE FOOTER IS SUMMED FROM THE BUNDLES, NOT FROM THE ROWS ABOVE.
   *
   * Identical arithmetic to before this panel expanded — `Math.round` per bundle
   * — so the figure in the strip cannot move because the rendering changed. The
   * per-order shares reconcile to it inside `reservedRows`; this line is the
   * definition, and that one is the thing that has to agree with it.
   */
  const total = reserved.reduce((s, l) => s + Math.round(l.reserve), 0);

  /* The SO columns are only generated where NOTHING can source them. See
     lib/archLotOrders.ts for the three states; these two drive the notices. */
  const showPlaceholderBanner = anyUnsourced(reserved);
  const showUnattributedNote = anyUnavailable(reserved);
  const lotCount = reserved.length;

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
  // #B36B16 measured 4.17:1 on white — the same amber the SO wizard already had
  // to darken to #8F5612 for exactly this reason.
  const ageColor = (days: number) => (days > 21 ? '#B22222' : days > 10 ? '#8F5612' : '#2E7D32');

  return (
    <div
      style={{
        margin: '18px 0 6px',
        // Opaque, deliberately. Everything below is tinted with alpha, and the
        // modal body behind this is dark — without an opaque light base the
        // tints composite over near-black and the panel inverts.
        background: '#fff',
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
          // #FDF1EB is `${accent}14` already flattened onto white. As an alpha
          // tint it rendered on the dark modal body instead: the strip came out
          // near-black while its own table below stayed light peach.
          background: '#FDF1EB',
          borderBottom: `1px solid ${accent}33`,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: ink }}>
          Reserved
        </span>
        {/* Counts BUNDLES, not table rows. The two diverge the moment a bundle
            is held by two orders, and "3 lots" against 2 bundles would be wrong
            about the thing the strip is describing. */}
        <span style={{ fontSize: 11.5, color: ARCH_SURFACE.textMid }}>
          {lotCount} lot{lotCount === 1 ? '' : 's'} of the on-hand stock above committed to sales orders
          {rows.length > lotCount ? ` across ${rows.length} orders` : ''}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: ink }} className="font-mono">
          {formatQty(total, row.unit)} <span style={{ fontSize: 9.5 }}>{unitLabel(row.unit)}</span>
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 18, textAlign: 'center', color: ARCH_SURFACE.textLight, fontSize: 12.5 }}>
          No reserved quantities on this item
        </div>
      ) : (
        <>
          {/* Honesty line, and it is now CONDITIONAL.
              ────────────────────────────────────────────────────────────────────
              Until 2026-09-08 this banner was unconditional, because six of the
              eight columns came from lotAllocation(), a seeded generator, on
              every payload. The cache now carries the real order per bundle
              (`ArchLot.orders`), so the banner appears only where nothing can
              source those columns: a fixture row, or a cached payload written
              before the field existed and not yet rebuilt.
              ⚠️ Do not make this unconditional again "to be safe". Warning on
              real data is not caution, it is a different lie, and it would train
              the trader to ignore the one case that matters.
              A test pins the pair: while lotAllocation() is still called, this
              text must still exist in the source. */}
          {showPlaceholderBanner && (
            <div style={{
              margin: '8px 12px 0', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8,
              padding: '7px 11px', fontSize: 11, color: '#92400E', lineHeight: 1.5,
            }}>
              <b>Placeholder columns.</b> SO #, SO creation date, age, ship week, customer and trader are
              generated for layout on these bundles; nothing in this payload links them to a sales order.
              Lot, container and quantity are the real figures whenever the header badge says Live.
            </div>
          )}

          {/* The other half of the same honesty. A LIVE payload that lists a
              bundle it cannot attribute renders six em dashes, and empty cells
              with nothing beside them read as a bug. This names the cause: the
              order line carries no inventory detail, so no bundle is named on
              it — the same gap archBuckets.ts reports for the column total. */}
          {showUnattributedNote && (
            <div style={{
              margin: '8px 12px 0', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 8,
              padding: '7px 11px', fontSize: 11, color: ARCH_SURFACE.textMid, lineHeight: 1.5,
            }}>
              <b>No order named.</b> Some bundles below show no SO: the reservation sits on a sales-order
              line written without inventory detail, so NetSuite does not record which bundle it took.
              The quantity is real; the order behind it is not recorded.
            </div>
          )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c} style={headerCell}>
                    {c}
                  </th>
                ))}
                {/* The ROW'S OWN UNIT, not a hardcoded "BF". ARCH is multi-unit —
                    Veneer is SQFT and Ovals are counted in pieces — and the cell
                    below already formats with `row.unit`, so the header was the
                    one place still asserting board feet. WALVENFCAA is a real
                    SQFT item in this account. */}
                <th style={{ ...headerCell, textAlign: 'right' }}>Reserved {unitLabel(row.unit)}</th>
                <th style={{ ...headerCell, width: 44, textAlign: 'center' }}>Tally</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ lot, order, source, qty, age, index, count }, i) => {
                /* The generator is reached ONLY on the 'unsourced' branch — a
                   fixture row, or a pre-2026-09-08 cached payload. On a live
                   payload with no order to name, every one of these six cells is
                   an em dash: nothing is better than something invented, and the
                   grey note above says why the cells are empty. */
                const fixture = source === 'unsourced' ? lotAllocation(lot.lotNo, 'reserve') : null;
                const soNumber = order ? order.soNumber || NO_VALUE : fixture ? fixture.soNumber : NO_VALUE;
                const created = order
                  ? formatOrderDate(order.created)
                  : fixture
                    ? formatShortDate(fixture.createdDate)
                    : NO_VALUE;
                const shipWeek = order
                  ? formatOrderDate(order.shipDate)
                  : fixture
                    ? formatShortDate(fixture.shipWeek)
                    : NO_VALUE;
                const customer = order ? order.customer || NO_VALUE : fixture ? fixture.customer : NO_VALUE;
                const trader = order ? traderName(order) : fixture ? fixture.trader : NO_VALUE;
                const ageValue = order ? age : fixture ? fixture.ageDays : null;
                /* A bundle held by several orders repeats down the Lot # column.
                   The number is printed once and the continuation rows are blank
                   there, so the eye reads two claims on ONE bundle rather than
                   two bundles that happen to share a number. */
                const continuation = index > 0;
                return (
                <tr
                  key={`${lot.lotNo}|${order ? order.tranId : 'none'}|${index}`}
                  style={{ background: i % 2 === 0 ? '#fff' : '#FDF9F4' }}
                >
                  <td
                    style={{ ...cell, fontWeight: 600, color: ARCH_SURFACE.navyMid, fontSize: 11 }}
                    className="font-mono"
                    title={
                      count > 1
                        ? `${lot.lotNo} is held by ${count} sales orders — one row each`
                        : undefined
                    }
                  >
                    {continuation ? (
                      <span style={{ color: ARCH_SURFACE.textLight }} aria-label={lot.lotNo}>
                        ↳
                      </span>
                    ) : (
                      lot.lotNo
                    )}
                  </td>
                  <td style={{ ...cell, fontSize: 11, color: ARCH_SURFACE.textMid }} className="font-mono">
                    {continuation ? '' : lot.containerNo || NO_VALUE}
                  </td>
                  <td style={{ ...cell, fontWeight: 700, color: ink }} className="font-mono">
                    {soNumber}
                  </td>
                  <td style={{ ...cell, color: ARCH_SURFACE.textMid }}>{created}</td>
                  <td
                    style={{
                      ...cell,
                      fontWeight: 700,
                      color: ageValue === null ? ARCH_SURFACE.textLight : ageColor(ageValue),
                    }}
                    className="font-mono"
                  >
                    {ageValue === null ? NO_VALUE : `${ageValue} d`}
                  </td>
                  {/* THE SHIP DATE, under a column the client's prototype called
                      "Ship Week". `t.shipdate` is one date and it is what NetSuite
                      holds; the prototype derived the Monday of its week from a
                      generated date, and deriving one here would print a day the
                      order does not name. The shipped Open Orders tab already
                      renders the raw date under a "Ship week" header for the same
                      reason. If Marc-Antoine wants the week's Monday, it is one
                      formatter in lib/archLotOrders.ts. */}
                  <td style={{ ...cell, color: ARCH_SURFACE.textMid }}>{shipWeek}</td>
                  <td style={cell}>{customer}</td>
                  {/* The Sales Team rep, not the record's creator, and the tooltip
                      says which. Marc-Antoine treats them as two different things
                      ("le sales team définit le split commission" vs "la personne
                      qui a créé le SO", 2026-09-08) and the Open Orders tab shows
                      both in labelled columns; substituting one for the other here
                      would credit a sale to whoever saved the record, which on 2 of
                      the 4 real ARCH orders is a developer account. */}
                  <td
                    style={{ ...cell, color: ARCH_SURFACE.textMid }}
                    title={
                      order
                        ? order.repNameUnreadable
                          ? 'This order names a rep whose employee record your role cannot read, so only the id is shown'
                          : order.repShared
                            ? `Sales Team rep. This order's team has more than one member${order.repTied ? ' and they split evenly' : ''}`
                            : order.repSource === 'salesTeam'
                              ? "Sales Team rep, from the order's Sales Team sublist"
                              : order.repSource === 'header'
                                ? 'Header Sales Rep'
                                : 'No rep is named on this order'
                        : undefined
                    }
                  >
                    {trader}
                    {order && order.repShared ? <span style={{ color: ARCH_SURFACE.textLight }}> +</span> : null}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700, color: ink }} className="font-mono">
                    {formatQty(qty, row.unit)}
                  </td>
                  {/* One tally per BUNDLE, so a bundle split across two orders
                      does not grow a second button for the same document. */}
                  <td style={{ ...cell, textAlign: 'center', paddingLeft: 6, paddingRight: 10 }}>
                    {continuation ? null : (
                    <TallyButton
                      hasImage={!!(tallyImages[lot.lotNo] || lot.tallyImageUrl)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTallyOpen(lot.lotNo);
                      }}
                    />
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {tallyOpen && (
        <TallyImageDialog
          lotNo={tallyOpen}
          itemDescription={row.description}
          imageUrl={tallyImages[tallyOpen] || row.lots.find((l) => l.lotNo === tallyOpen)?.tallyImageUrl}
          onClose={() => setTallyOpen(null)}
          onUpload={onUploadTally}
          /* A reserved lot is ALSO in the On Hand table above, so this is the same lot
             number with two tally buttons on one screen. Until 2026-09-05 they opened
             two different dialogs. See demoTallyProps for why the choice lives there. */
          {...demoTallyProps(tallyOpen, row.lots.find((l) => l.lotNo === tallyOpen)?.tally)}
        />
      )}
    </div>
  );
};
