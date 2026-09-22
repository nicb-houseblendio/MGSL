import * as React from 'react';
import { formatQty, formatCostPerUnit, displaySuffix, unitLabel } from '@/lib/archUom';
import { isLotLocked, lockReason, lotQuantity, commitmentOn, lotCostDisplay } from '@/lib/archLots';
import { bucketLots, bucketGap, bucketGapReason, notSourcedNote } from '@/lib/archBuckets';
import { lotAllocation, formatShortDate } from '@/lib/archFixtures';
import {
  orderSource,
  ordersFor,
  oldestAge,
  joinValues,
  formatOrderDate,
  shipWeekCell,
  SHIP_DATE_DEFAULTED_TITLE,
  traderName,
  NO_VALUE,
} from '@/lib/archLotOrders';
import { ARCH_BUCKET_META, ARCH_RESERVE_INK, ARCH_SURFACE } from '@/components/arch/archColors';
import { tallyStateNote, toLengthWidthGrid, filterGridByLength, bundleLengthChips } from '@/lib/archTally';
import { lengthDisplayRow } from '@/lib/archTallyLength';
import type { ArchDataSource } from '@/hooks/useArchSummaryData';

/* One shared object, not a fresh literal per call. Every `toLengthWidthGrid` call in
 * this file must use the SAME options as `TallyMatrixPanel` does, or `hasMatrix` says
 * a lot has no grid while the panel underneath happily draws one (or the reverse, and
 * the caret opens an empty row). Passing a module constant makes that impossible to
 * get wrong in one place and not another. See archTally.ts for what it turns on. */
const GRID_OPTS = { allowSingleLength: true } as const;
import { TallyButton, TallyImageDialog, TallyMatrixPanel } from '@/components/arch/TallyImageDialog';
import { demoTallyProps } from '@/lib/archTallyFixtures';
import { ArchReservedSection } from '@/components/arch/ArchReservedSection';
import type { ArchSummaryRow, ArchDetailKey, ArchLot, ArchLotOrder } from '@/types/arch';


/**
 * Dual-thumb length filter, ported from the prototype's `LengthRangeSlider`.
 *
 * 🔴 NOT an `<input type="range">`. The prototype draws a 4px track with two
 * 15px circular thumbs positioned by percentage and dragged on window pointermove,
 * with a number box either side and a live caption. An earlier pass here shipped two
 * number boxes and the word "to", which is not what the client approved.
 *
 * `fmtLbl` marks the top of the range with a `+` (`16'+`), because the highest bucket
 * means "this length and anything longer", and the caption shows the SELECTION, not
 * the data bounds: it is the trader's readout of the window they have chosen.
 */
const LengthRangeSlider = ({
  lo, hi, min, max, onChange,
}: {
  lo: number; hi: number; min: number; max: number;
  onChange: (lo: number, hi: number) => void;
}) => {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const pct = (v: number) => ((v - min) / ((max - min) || 1)) * 100;
  const valFromX = (cx: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return min;
    let p = (cx - r.left) / r.width;
    p = Math.max(0, Math.min(1, p));
    return Math.round(p * (max - min) + min);
  };
  const startDrag = (which: 'lo' | 'hi') => (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const v = valFromX(ev.clientX);
      if (which === 'lo') onChange(Math.min(v, hi), hi);
      else onChange(lo, Math.max(v, lo));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const thumb: React.CSSProperties = {
    position: 'absolute', width: 15, height: 15, background: '#fff',
    border: `2px solid ${ARCH_SURFACE.navy}`, borderRadius: '50%', top: '50%',
    transform: 'translate(-50%,-50%)', cursor: 'grab', zIndex: 2,
    boxShadow: '0 1px 3px rgba(13,31,51,0.25)',
  };
  const numInput: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: ARCH_SURFACE.text, background: '#fff',
    border: '1px solid #CBD5E1', borderRadius: 5, padding: '3px 4px', width: 42,
    textAlign: 'center', outline: 'none',
  };
  const fmtLbl = (v: number) => (v >= max ? `${v}′+` : `${v}′`);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: '1 1 300px', minWidth: 250, maxWidth: 560 }}>
      <span style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: 0.7, textTransform: 'uppercase', color: ARCH_SURFACE.textLight, whiteSpace: 'nowrap' }}>
        Length range
      </span>
      <input
        type="number" style={numInput} min={min} max={hi} value={lo}
        aria-label="Shortest length in the range"
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          onChange(isNaN(v) ? min : Math.max(min, Math.min(v, hi)), hi);
        }}
      />
      <div ref={trackRef} style={{ position: 'relative', height: 4, background: '#E2E8F0', borderRadius: 2, flex: 1, minWidth: 80, margin: '0 7px' }}>
        <div style={{ position: 'absolute', height: '100%', borderRadius: 2, background: ARCH_SURFACE.navy, top: 0, left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />
        <div style={{ ...thumb, left: `${pct(lo)}%` }} onPointerDown={startDrag('lo')} role="slider" aria-label="Shortest length" aria-valuenow={lo} aria-valuemin={min} aria-valuemax={max} tabIndex={0} />
        <div style={{ ...thumb, left: `${pct(hi)}%` }} onPointerDown={startDrag('hi')} role="slider" aria-label="Longest length" aria-valuenow={hi} aria-valuemin={min} aria-valuemax={max} tabIndex={0} />
      </div>
      <input
        type="number" style={numInput} min={lo} max={max} value={hi}
        aria-label="Longest length in the range"
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          onChange(lo, isNaN(v) ? max : Math.min(max, Math.max(v, lo)));
        }}
      />
      <span style={{ fontSize: 10.5, fontWeight: 700, color: ARCH_SURFACE.navyMid, whiteSpace: 'nowrap' }} className="font-mono">
        {fmtLbl(lo)}{'–'}{fmtLbl(hi)}
      </span>
    </div>
  );
};

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
  /**
   * Real ARCH cache, or local demo fixtures.
   *
   * Only the tally panel cares, and it cares a lot: see `allowFixture` in
   * `demoTallyProps`. Defaults to `'netsuite'` so the truthful behaviour is what a
   * caller gets by forgetting.
   */
  dataSource?: ArchDataSource;
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
/* Why a cell is a dash, when the answer is "there is no data", not "we failed".
 * Feedback 13, 2026-09-21: « Il manque de l'info dans les colonnes ». After the
 * Ready to Build fix, four columns stay empty on every live ARC bundle because
 * the data does not exist in NetSuite: 0 of 841 lots carry a container, only two
 * tallies exist in the account (neither for an ARC PO today), and there is no
 * grain field at all. A bare dash reads as the same bug again. */
const NO_CONTAINER_TITLE = 'No container or vessel is recorded on this bundle’s receipt in NetSuite.';
const NO_TALLY_TITLE =
  'No usable tally for this bundle (none attached, or it no longer matches after a split), ' +
  'so its lengths and widths are not known.';
const NO_GRAIN_TITLE = 'Grain is not recorded anywhere in NetSuite yet, so there is nothing to show.';

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
  dataSource = 'netsuite',
}: ArchLotTableProps) => {
  /* 🔴 THE ONE PLACE THAT DECIDES WHETHER A FIXTURE MAY BE DRAWN.
   * Derived once and passed to every `demoTallyProps` call in this file, so the caret,
   * the inline panel and the modal cannot disagree about whether a lot has a matrix. */
  const allowFixture = dataSource === 'fixtures';
  const [tallyOpen, setTallyOpen] = React.useState<string | null>(null);
  /**
   * The lot whose tally grid is expanded inline, directly under its row.
   *
   * This is the primary way to view a tally now, matching the Feedback 5 mockup:
   * the grid sits in the same table as the lot it belongs to, not behind a second
   * modal. `tallyOpen` (the full-screen dialog) still exists for image upload,
   * reached from a link inside the expanded row.
   */
  /* 🔴 COLLAPSED, not expanded, and that inversion is the point.
   *
   * The V4 mockup holds `const [collapsed,setCollapsed]=useState(()=>new Set())` with
   * `isExpanded=ln=>!collapsed.has(ln)`: every lot's matrix is open on arrival and the
   * set records what the trader has actively HIDDEN. This screen had the opposite,
   * one lot at a time behind a click, which is why the tally read as a detail view
   * rather than as the table.
   *
   * A Set rather than a single value, so several lots stay open at once, which is what
   * the mockup's screenshot shows and what makes the lengths comparable across lots. */
  /* Lots whose tally panel is in the OPPOSITE state from its default.
   *
   * 🔴 The default is not the same for every lot, which is why this is a "toggled"
   * set and not an "expanded" one. The prototype opens the matrix for every lot that
   * HAS a matrix, and shows a dash for the rest — it never renders an expanded row
   * that says "no tally". Ours did, for all of them, on first paint: 820 ARCH lots,
   * 49 with a tally, so the screen opened as a wall of "No tally parsed for this
   * bundle yet" with the real grids buried in it.
   *
   * Storing the DELTA rather than the state keeps both behaviours: a tallied lot is
   * open until the trader closes it, an untallied one is closed until the trader opens
   * it from the tally button, and neither needs a second Set or an effect to seed. */
  const [toggledTally, setToggledTally] = React.useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const isTallyExpanded = (lotNo: string, hasMatrix: boolean) =>
    hasMatrix !== toggledTally.has(lotNo);

  /* The bundle behind a lot, or null. Goes through the SAME `demoTallyProps` the panel
   * uses, so a split lot yields nothing here either: the Lengths and Avg width cells
   * must not quote a fixture from another shipment, nor a matrix the split invalidated.
   * That is the whole reason this is a helper and not an inline `lot.tally.bundles[0]`. */
  const lotBundle = (lot: { lotNo: string; tally?: unknown; tallyState?: unknown }) =>
    demoTallyProps(
      lot.lotNo,
      lot.tally as Parameters<typeof demoTallyProps>[1],
      lot.tallyState as Parameters<typeof demoTallyProps>[2],
      allowFixture,
    ).bundle ?? null;
  /** Whether Lengths / Avg width will render something, computed exactly as those cells do. */
  const hasLengths = (lot: { lotNo: string; tally?: unknown; tallyState?: unknown }) => {
    const b = lotBundle(lot);
    const g = toLengthWidthGrid(b, GRID_OPTS);
    return g ? g.rows.length > 0 : bundleLengthChips(b).length > 0;
  };
  const hasAvgWidth = (lot: { lotNo: string; tally?: unknown; tallyState?: unknown }) => {
    const g = toLengthWidthGrid(lotBundle(lot), GRID_OPTS);
    return !!g && g.avgWidth != null;
  };
  const toggleTally = (lotNo: string) =>
    setToggledTally((cur) => {
      const next = new Set(cur);
      if (next.has(lotNo)) next.delete(lotNo); else next.add(lotNo);
      return next;
    });

  /* The length window, in feet. `null` means no filter, which is the default: a
   * control that silently hides stock on arrival would be worse than no control. */
  const [lengthRange, setLengthRange] = React.useState<{ lo: number; hi: number } | null>(null);
  /* 🔴 A LENGTH FILTER BELONGS TO THE TAB IT WAS SET IN.
   *
   * This component is NOT remounted when the drawer switches bucket — same instance,
   * new `bucket` prop — so the range survived the switch while `lengthBounds`
   * recomputed underneath it from a different set of lots.
   *
   * Reproduced live 2026-09-15: filter Ready to Build to 12′, switch to On Hand. The
   * header still said "23 bundles", the table drew 21, and BOTH slider thumbs sat
   * pinned at 100% — a control that reads as wide open while it withholds stock. Two
   * bundles vanished with nothing on screen admitting it was a filter.
   *
   * Clearing on bucket change is the honest default: a trader opening a tab expects
   * to see what is in it. `bucket` is the only dependency; clearing on `lots` would
   * also fire on every cache refresh and throw away a filter the trader is using. */
  React.useEffect(() => { setLengthRange(null); }, [bucket]);
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
  /* Wood on this row that is bought but not in the yard. Read only by the
   * Available empty state, to explain a 0 that used to be a bundle list. */
  const incomingOnRow = (row.onOrder || 0) + (row.inTransit || 0);
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
       * ⚠️ CORRECTED 2026-09-14. This said "`readyToBuild` and `outbound` can
       * never resolve to a real order and that is correct, not a gap to close.
       * readyToBuild is a literal 0 in the cache, so no live bundle is ever
       * listed under it."
       *
       * The premise expired the day the field went live. Measured on the
       * deployed sandbox screen: lot 315643-5 carries readyToBuild 25 and IS
       * listed under that tab, while SO #, SO CREATION DATE, BUILDING FOR, SHIP
       * WEEK, CUSTOMER and TRADER all rendered an em dash. A column called
       * "Building For" that cannot say what it is building for.
       *
       * `readyToBuild` now resolves orders like `reserve`, gated on the cache
       * stamping which bucket each order's share landed in. See the long note in
       * `archLotOrders.ts`: reading `orders` for both buckets WITHOUT that stamp
       * was tried on 2026-09-10 and reverted the same day, because a bundle
       * shared between a Reserved order and a Ready-to-Build one would show the
       * same list and the same number under both tabs.
       *
       * `outbound` stays unresolvable, and that part was always right: the wood
       * has shipped and the bundle's on-hand is already net of it, so naming an
       * order there would be a claim on stock that has left the building.
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
              ? joinValues(claims(l).map((o) => shipWeekCell(o.shipDate, o.created).text).filter((t) => t !== NO_VALUE)).text
              : fallback(l, (f) => formatShortDate(f.shipWeek)),
          // A dash that is only NetSuite's default ship date says so (see shipWeekCell).
          title: (l) =>
            claims(l).length && claims(l).every((o) => shipWeekCell(o.shipDate, o.created).title)
              ? SHIP_DATE_DEFAULTED_TITLE
              : undefined,
        },
        {
          label: 'Customer',
          render: (l) => (claims(l).length ? joined(l, (o) => o.customer).text : fallback(l, (f) => f.customer)),
          title: (l) => joined(l, (o) => o.customer).title,
        },
        {
          /* The Sales Team rep. Never the record's creator: Marc-Antoine treats
           * those as two different things, and on 2 of the 4 real ARCH orders the
           * creator is a developer account. The Open Orders tab shows both in
           * labelled columns; this cell must not conflate them.
           *
           * ⚠️ LABELLED "Sales rep", NOT "Trader", since 2026-09-14. It read
           * "Trader" while the Open Orders tab called the same person "Sales rep",
           * so one human had two names on one screen. Marc-Antoine settled which
           * one matters on the 2026-09-10 call at [32:53]: "le sales rep il est
           * ici. Comme ça, c'est la personne qui a créé, puis après ça, le sales
           * team est utilisé juste pour le split de commission." He is the OWNER
           * of the order; Sales Team is the commission split and nothing else.
           * The underlying field is still `trader`, renaming that is a wider
           * change than the label warrants. */
          label: 'Sales rep',
          render: (l) => (claims(l).length ? joined(l, traderName).text : fallback(l, (f) => f.trader)),
          title: (l) => joined(l, traderName).title,
        },
      ];
    }
    /* 🔴 THE In Transit ARM WAS DELETED 2026-09-22 rather than fixed.
     *
     * It read `ETA: formatShortDate(lotIncomingInfo(l.lotNo, 'inTransit').eta)`,
     * an unconditional call into the seeded demo generator, with no check of
     * `lot.incoming` and no banner. In Transit now routes to `ArchPOListView`
     * from `DetailDrawerARCH`, which resolves the real PO, supplier and ETA and
     * labels invented values when it has to fall back.
     *
     * Removing it rather than repairing it is deliberate: while this arm exists,
     * one routing change puts a fabricated arrival date back on live wood, and
     * the tab was empty for so long that nobody would notice. */
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

  /* The widest length window any listed lot can offer, for clamping the control.
   * Across ALL lots rather than per lot, because one slider drives the whole table. */
  const lengthBounds = React.useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const l of lots) {
      const rows = lotBundle(l)?.matrix?.rows || [];
      for (const r of rows) {
        const v = typeof r.lengthFt === 'number' ? r.lengthFt
          : typeof r.lengthFtMin === 'number' ? r.lengthFtMin : NaN;
        if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
    }
    /* 🔴 WHOLE FEET, because the control only ever reports whole feet: valFromX
     * rounds, and both number boxes parseInt. Left raw, a metric lot dragged the
     * minimum to 2.789 and the caption read "2.789′–12′+" — a figure no drag could
     * ever return to, so the trader could not restore the full range once moved.
     * Floor the bottom and ceil the top so every real length stays inside. */
    if (!(Number.isFinite(lo) && Number.isFinite(hi))) return null;
    const flo = Math.floor(lo), fhi = Math.ceil(hi);
    return fhi > flo ? { lo: flo, hi: fhi } : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lots]);

  /* 🔴 HIDING A LOT IS NOT THE SAME AS FILTERING ITS ROWS, and the mockup does
   * both: `lots = allLots.filter(l => filterTally(...).rows.length > 0)` with a
   * `hiddenCount` reported beside the control. A lot with nothing in the window drops
   * out of the table entirely, and the count is what stops that reading as missing
   * stock. Only ever applied when the trader has actually moved the control. */
  /* Belt and braces for the same class of bug: even with the reset above, a range is
   * only ever applied where it can mean something. A stored range that no longer
   * overlaps the lots on screen is treated as absent rather than as "hide everything",
   * so the worst a stale range can do is nothing. */
  const effectiveRange = React.useMemo(() => {
    if (!lengthRange || !lengthBounds) return null;
    const lo = Math.max(lengthRange.lo, lengthBounds.lo);
    const hi = Math.min(lengthRange.hi, lengthBounds.hi);
    return hi >= lo ? { lo, hi } : null;
  }, [lengthRange, lengthBounds]);

  const lengthFiltered = (lot: ArchLot) => {
    if (!effectiveRange) return true;
    const g = toLengthWidthGrid(lotBundle(lot), GRID_OPTS);
    if (!g) return true;   // no matrix to filter on: never hide a lot over a filter it cannot answer
    return (filterGridByLength(g, effectiveRange.lo, effectiveRange.hi)?.rows.length || 0) > 0;
  };
  const visibleLots = effectiveRange ? lots.filter(lengthFiltered) : lots;
  const lengthHiddenCount = lots.length - visibleLots.length;

  /** Nothing here can be sold — every listed bundle carries a commitment. */
  const nothingSellable = isSellableView && lots.length > 0 && selectableLots.length === 0;

  /**
   * Width of the inline tally row, and it has to track the header cell for cell.
   *
   * TEN are unconditional: caret, select, Lot #, Container / Vessel, Lengths, Grain, Avg
   * width, Total/Avail., BF Cost, Tally. It was nine earlier on 2026-09-15 before the
   * caret column landed, seven before Lengths and Avg width, and six until
   * 2026-09-13, which is why the expanded panel once stopped a column short. `isOnHand`
   * adds two more (Res. and the second Avail. column), and `leadColumns` is
   * whatever the bucket contributes in between.
   */
  const tallyColSpan = 10 + leadColumns.length + (isOnHand ? 2 : 0);

  return (
    <div style={{ padding: '14px 18px 22px' }}>
      {/* Toolbar — length filter, selection summary and the reserved toggle */}
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
          {/* First in the bar and flexing to fill, which is what pushes the actions to
              the right, exactly as the prototype's toolbar does. Only when the lots
              actually span more than one length: a slider that cannot move is furniture. */}
          {lengthBounds && (
            <LengthRangeSlider
              /* The CLAMPED range, not the raw one, or the thumbs can render off the
                 track. Pinned at 100%% while quietly hiding stock is what this looked
                 like before the clamp. */
              lo={effectiveRange?.lo ?? lengthBounds.lo}
              hi={effectiveRange?.hi ?? lengthBounds.hi}
              min={lengthBounds.lo}
              max={lengthBounds.hi}
              onChange={(a, b) => setLengthRange({ lo: a, hi: b })}
            />
          )}
          {/* 🔴 A lot dropping out of the table over a filter looks exactly like
              stock that is not there. This count is the only thing on screen that
              tells those two apart. */}
          {lengthHiddenCount > 0 && (
            <span style={{ fontSize: 11.5, color: '#B45309', fontWeight: 600 }}>
              {lengthHiddenCount} hidden by length
            </span>
          )}
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
        A bucket with NO NetSuite source.

        ⚠️ CORRECTED 2026-09-14. This said "`readyToBuild` is a hardcoded 0 in
        the ARCH cache, so this tab can never hold anything and its header total
        can never be anything but zero." That stopped being true when the field
        went live: the tab carried 25 BF on lot 315643-5 when the deployed screen
        was opened.

        The banner is NOT deleted, because `notSourced` is still a real state:
        it is driven by META's `bucketsEmpty`, so it fires when the cache genuinely
        could not read `custbody_arch_ready_to_build` (the field missing, or the
        chunked read failing, which unsources the whole run). What changed is that
        it is now a MEASUREMENT of this run rather than a permanent fact about the
        column.
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
          {/*
            🔴 THIRD BRANCH ADDED 2026-09-22, and it covers a regression this
            same day's change introduced.

            When `onOrder` and `inTransit` left the Available formula, twelve
            live rows fell to Available 0 while still carrying incoming wood.
            Their Available drawer then said only "No bundles in this status",
            which is true and useless: the trader is looking at a row whose grid
            line shows 3,000 BF On Order, and the panel tells them nothing about
            why none of it is available. Before the change those bundles were
            listed here.

            Neither existing branch could say it. `gap` is
            `max(0, header - lots)`, and here both sides are 0, so the first
            branch cannot fire; the second is the generic case. Verified on
            screen against AFM54KD @ Ambassador Services International.
          */}
          {gap > 0 && !notSourced
            ? `The ${meta.label.toLowerCase()} total is real, but no bundle carries it, so there is nothing to list`
            : bucket === 'available' && incomingOnRow > 0
              ? `Nothing on this row is available to sell yet. ${formatQty(incomingOnRow, row.unit, uom)} ${displaySuffix(row.unit, uom)} is incoming, on order or in transit, and is counted in its own column rather than in Available. It becomes available when it arrives in the yard.`
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
                  {/* Caret column. Empty header, as the prototype has it. */}
                  <th style={{ ...headerCellStyle, width: 26, paddingLeft: 12, paddingRight: 0, borderRight: 'none' }} />
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
                  {/* Feedback 9 item 2 let this cell hold a Lot Vessel as well as
                      an ISO container code, so the header stops promising a
                      number. Feeding a ship name into a column headed
                      "Container #" is the same mislabel this screen already
                      carries two comments about. */}
                  <th style={headerCellStyle}>Container / Vessel</th>
                  {isOnHand && <th style={headerCellStyle}>Res.</th>}
                  {leadColumns.map((c) => (
                    <th key={c.label} style={headerCellStyle}>
                      {c.label}
                    </th>
                  ))}
                  {/* Lengths and Avg width, both per lot, both in the V4 mockup and
                      neither previously on this screen. The mockup prints
                      `avgW.toFixed(1)` and a chip per distinct length, so a trader can
                      see what a bundle holds without opening anything. */}
                  <th style={headerCellStyle}>Lengths</th>
                  <th style={headerCellStyle}>Grain</th>
                  <th style={{ ...headerCellStyle, textAlign: 'right' }} title="Piece-weighted average width">
                    Avg width
                  </th>
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
                        ? "What is left of this bundle after its reservations and Ready to Build. A bundle with ANY commitment is locked whole until it is split, so that remainder cannot be sold yet; only bundles with no commitment can be added to an order."
                        : undefined
                    }
                  >
                    {bucket === 'available' ? 'Avail.' : 'Total'} {displaySuffix(row.unit, uom)}
                  </th>
                  {isOnHand && (
                    <th
                      style={{ ...headerCellStyle, textAlign: 'right' }}
                      title="This bundle's on-hand less anything reserved or released to build. On a bundle with any commitment it is shown dimmed: the bundle is locked whole until it is split, so this remainder is not sellable yet."
                    >
                      Avail. {displaySuffix(row.unit, uom)}
                    </th>
                  )}
                  <th style={{ ...headerCellStyle, textAlign: 'right' }}>BF Cost</th>
                  <th style={{ ...headerCellStyle, width: 44, textAlign: 'center' }}>Tally</th>
                </tr>
              </thead>
              <tbody>
                {visibleLots.map((lot, i) => {
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
                  /* Does this lot have a length x width matrix worth expanding?
                   * The prototype gates its caret on the same question (`lotHasMatrix`),
                   * so a lot carrying only a scanned sheet shows a dash and does not
                   * pretend to open into a grid. Goes through `lotBundle`, so a split
                   * lot reports none: its matrix is exactly what the split invalidated. */
                  const hasMatrix = !!toLengthWidthGrid(lotBundle(lot), GRID_OPTS);
                  return (
                    /*
                     * The lot row and its tally panel are ONE fragment, so the
                     * panel renders directly under the lot it belongs to. It
                     * used to be appended after the whole `lots.map`, which put
                     * it at the foot of the table: right only when the lot you
                     * expanded happened to be the last one, and the placement
                     * this inline view exists to get right.
                     */
                    <React.Fragment key={lot.lotNo}>
                      <tr
                        style={{
                          /* The open row is tinted, as in the prototype, so the matrix
                             under it reads as belonging to it rather than floating. */
                          background: hasMatrix && isTallyExpanded(lot.lotNo, hasMatrix)
                            ? '#F0F5FF'
                            : (i % 2 === 0 ? '#fff' : '#F8FAFC'),
                          cursor: hasMatrix ? 'pointer' : 'default',
                        }}
                        onClick={() => { if (hasMatrix) toggleTally(lot.lotNo); }}
                      >
                        {/* 🔴 THE CARET IS ITS OWN COLUMN, first, and the WHOLE ROW
                            toggles. The prototype does both; this table had neither, and
                            hid expansion behind a 26px icon at the far right labelled
                            "Open tally image". A lot with no system tally shows a dimmed
                            glyph rather than a caret, because there is nothing to open. */}
                        <td style={{ ...cellStyle, textAlign: 'center', paddingLeft: 12, paddingRight: 0 }}>
                          {hasMatrix ? (
                            <span
                              style={{
                                display: 'inline-block', transition: 'transform 0.12s',
                                transform: isTallyExpanded(lot.lotNo, hasMatrix) ? 'rotate(90deg)' : 'none',
                                color: ARCH_SURFACE.textMid, fontSize: 11,
                              }}
                            >
                              {'▶'}
                            </span>
                          ) : (
                            <span
                              title={hasImage
                                ? 'No system tally on this lot, open the attached tally image'
                                : 'No tally on this lot, neither a parsed one nor an attached image'}
                              style={{ color: '#CBD5E1', fontSize: 11 }}
                            >
                              {'—'}
                            </span>
                          )}
                        </td>
                        <td
                          style={{ ...cellStyle, textAlign: 'center' }}
                          /* 🔴 The row now toggles the matrix, so selecting a bundle must
                             not also expand it. Without this, every click of a checkbox
                             opens or closes the grid underneath it. */
                          onClick={(e) => e.stopPropagation()}
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
                        <td
                          style={{ ...cellStyle, fontSize: 11, color: ARCH_SURFACE.textMid }}
                          className="font-mono"
                          title={lot.containerNo ? undefined : NO_CONTAINER_TITLE}
                        >
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
                        {/* Lengths and Avg width, per lot, from this lot's own bundle.
                            Both fall back to an em dash rather than a zero: a lot with no
                            parsed matrix has no lengths and no average, and printing 0.0"
                            would be a measurement nobody took. */}
                        <td
                          style={{ ...cellStyle, color: ARCH_SURFACE.textMid }}
                          title={hasLengths(lot) ? undefined : NO_TALLY_TITLE}
                        >
                          {(() => {
                            /* From the FILTERED grid, so a row never advertises
                               lengths its own matrix below no longer lists. The
                               prototype derives both this and Avg width from the
                               filtered tally for the same reason. */
                            const fg = effectiveRange
                              ? filterGridByLength(toLengthWidthGrid(lotBundle(lot), GRID_OPTS), effectiveRange.lo, effectiveRange.hi)
                              : toLengthWidthGrid(lotBundle(lot), GRID_OPTS);
                            const chips = fg
                              ? fg.rows.map((r) => lengthDisplayRow(r).text)
                              : bundleLengthChips(lotBundle(lot));
                            if (!chips.length) return '—';
                            return (
                              <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                                {chips.map((c) => (
                                  <span
                                    key={c}
                                    className="font-mono"
                                    style={{
                                      border: '1px solid #E2E8F0', borderRadius: 4,
                                      padding: '1px 5px', fontSize: 10.5,
                                      color: ARCH_SURFACE.textMid, background: '#fff',
                                    }}
                                  >
                                    {c}
                                  </span>
                                ))}
                              </span>
                            );
                          })()}
                        </td>
                        <td
                          style={{ ...cellStyle, color: ARCH_SURFACE.textMid }}
                          title={row.grain ? undefined : NO_GRAIN_TITLE}
                        >
                          {row.grain || '—'}
                        </td>
                        <td
                          style={{ ...cellStyle, textAlign: 'right' }}
                          className="font-mono"
                          title={hasAvgWidth(lot) ? undefined : NO_TALLY_TITLE}
                        >
                          {(() => {
                            const base = toLengthWidthGrid(lotBundle(lot), GRID_OPTS);
                            const g = effectiveRange && base
                              ? filterGridByLength(base, effectiveRange.lo, effectiveRange.hi)
                              : base;
                            if (!g || g.avgWidth == null) return '—';
                            return g.avgWidth.toFixed(1) + (g.widthUnit === 'mm' ? 'mm' : '"');
                          })()}
                        </td>
                        {(() => {
                          /* ── TOTAL BF, and the one place the prototype and real data
                           * genuinely disagree.
                           *
                           * Unfiltered, this column is NetSuite's quantity. It has to be:
                           * it is the stock figure the trader sells against, the tally is
                           * a supplier's paperwork, and the two differ on real lots. The
                           * prototype cannot show that conflict because its lot BF and
                           * its matrix are the same fake number.
                           *
                           * 🔴 Filtered, it MUST come from the tally, or the length
                           * slider silently does nothing here. A trader who drags the
                           * range to 8-12 ft and still reads the full 3,629 BF on the row
                           * has been told the filter changed nothing, while the matrix
                           * one line below already says 2,104. Same complaint the SHOWN
                           * vs TOTAL footer label fixes, one row up.
                           *
                           * The title says which of the two is on screen, every time. */
                          const base = toLengthWidthGrid(lotBundle(lot), GRID_OPTS);
                          const fg = effectiveRange && base
                            ? filterGridByLength(base, effectiveRange.lo, effectiveRange.hi)
                            : null;
                          const filteredBF = fg && fg.isFiltered ? fg.totals.boardFeet : null;
                          const showFiltered = filteredBF != null;
                          return (
                            <td
                              style={{
                                ...cellStyle, textAlign: 'right', fontWeight: 700,
                                color: showFiltered ? ARCH_SURFACE.navyMid : ARCH_SURFACE.navy,
                              }}
                              className="font-mono"
                              title={
                                showFiltered
                                  ? `${formatQty(Math.round(filteredBF as number), row.unit, uom)} of ${formatQty(lotQuantity(lot, bucket), row.unit, uom)} — the boards inside the length filter, off this lot's tally. Clear the filter for the full NetSuite quantity.`
                                  /* A filter is on but the tally states no board feet for the rows
                                     that survived it, so there is no filtered figure to show. Say
                                     that, rather than let the unchanged number read as "the filter
                                     matched everything". */
                                  : fg
                                    ? "The whole bundle, from NetSuite — this lot's tally states no board feet for the lengths in the filter"
                                    : "NetSuite's quantity for this bundle"
                              }
                            >
                              {showFiltered
                                ? formatQty(Math.round(filteredBF as number), row.unit, uom)
                                : formatQty(lotQuantity(lot, bucket), row.unit, uom)}
                            </td>
                          );
                        })()}
                        {isOnHand && (
                          <td
                            /* Round-2 review, Feedback 13: 127 BF printed GREEN on
                               lot 315310-16, a bundle whose 300 BF Ready to Build
                               locks all of it (whole-bundle rule, MA S3). Green
                               said "sellable"; the order endpoint refuses it. */
                            title={freeBF > 0 && commitmentOn(lot) > 0
                              ? 'Locked until this bundle is split: it carries a commitment, so the remainder cannot be sold yet.'
                              : undefined}
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
                              color: freeBF > 0 && commitmentOn(lot) === 0 ? '#1B5E20' : ARCH_SURFACE.textLight,
                            }}
                            className="font-mono"
                          >
                            {formatQty(freeBF, row.unit, uom)}
                          </td>
                        )}
                        <td style={{ ...cellStyle, textAlign: 'right' }} className="font-mono">
                          {/* 🔴 THIS BUNDLE'S cost, Feedback 6 item 18. Every lot row
                              printed `row.avgCostPerUnit` here, so the column read the
                              same number down the whole drawer whatever the bundles
                              actually cost: 12.76 against a lot that cost 14.15. The
                              row average is still the fallback for a lot with no
                              posting history, because it is the best honest estimate
                              available and it is what this cell has always shown. */}
                          {/* Feedback 9 item 1 moved the three-rung fallback into
                              `lotCostDisplay`, which now also decides the currency.
                              The rungs are unchanged; what is new is that rung 2
                              keeps this bundle's own CAD figure rather than
                              reaching for the row's USD average. */}
                          {(() => {
                            const cost = lotCostDisplay(lot, row);
                            return formatCostPerUnit(cost.value, row.unit, cost.currency);
                          })()}
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'center', paddingLeft: 6, paddingRight: 10 }}>
                          <TallyButton
                            hasImage={hasImage}
                            expanded={isTallyExpanded(lot.lotNo, hasMatrix)}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTally(lot.lotNo);
                            }}
                          />
                        </td>
                      </tr>
                      {isTallyExpanded(lot.lotNo, hasMatrix) && (() => {
                        const { bundle, siblings, sample, source, tallyState } =
                          demoTallyProps(lot.lotNo, lot.tally, lot.tallyState, allowFixture);
                        return (
                          <tr>
                            <td colSpan={tallyColSpan} style={{ padding: 0, borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                              <div style={{ padding: '14px 18px' }}>
                                {bundle ? (
                                  <>
                                    <TallyMatrixPanel
                                      bundle={bundle}
                                      siblings={siblings || []}
                                      imageUrl={tallyImages[lot.lotNo] || lot.tallyImageUrl}
                                      lengthRange={effectiveRange}
                                      sample={sample}
                                      source={source}
                                      hideDistribution
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setTallyOpen(lot.lotNo)}
                                      style={{
                                        marginTop: 10,
                                        padding: 0,
                                        border: 'none',
                                        background: 'transparent',
                                        color: ARCH_SURFACE.navyMid,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        textDecoration: 'underline',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      {tallyImages[lot.lotNo] || lot.tallyImageUrl ? 'View / replace the attached photo' : 'Attach a photo of this tally'}
                                    </button>
                                  </>
                                ) : (
                                  <div style={{ fontSize: 11.5, color: ARCH_SURFACE.textLight }}>
                                    {/* A split lot is not the same as a lot nobody has
                                        tallied yet, and the trader needs to know which
                                        it is to know who to chase. See tallyStateNote. */}
                                    {tallyStateNote(tallyState) || 'No tally parsed for this bundle yet.'}{' '}
                                    <button
                                      type="button"
                                      onClick={() => setTallyOpen(lot.lotNo)}
                                      style={{
                                        padding: 0, border: 'none', background: 'transparent',
                                        color: ARCH_SURFACE.navyMid, fontSize: 11.5, fontWeight: 600,
                                        textDecoration: 'underline', cursor: 'pointer',
                                      }}
                                    >
                                      View or attach a photo
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })()}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isOnHand && showReserved && (
        <ArchReservedSection
          row={row}
          tallyImages={tallyImages}
          onUploadTally={handleUpload}
          allowFixture={allowFixture}
        />
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
          {...demoTallyProps(
            tallyOpen,
            row.lots.find((l) => l.lotNo === tallyOpen)?.tally,
            row.lots.find((l) => l.lotNo === tallyOpen)?.tallyState,
            allowFixture,
          )}
        />
      )}
    </div>
  );
};
