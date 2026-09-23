import * as React from 'react';
import { FilterPanel } from '@/components/FilterPanel';
import { InventoryTableARCH, selectedArchRows } from '@/components/InventoryTableARCH';
import { ArchOpenOrdersView } from '@/components/arch/ArchOpenOrdersView';
import { useArchOpenOrders } from '@/hooks/useArchOpenOrders';
import { DetailDrawerARCH } from '@/components/DetailDrawerARCH';
import { SOCartBar } from '@/components/arch/SOCartBar';
import { SOWizard } from '@/components/arch/SOWizard';
import { ArchOrderDraftDialog } from '@/components/arch/ArchOrderDraftDialog';
import { lotQuantity } from '@/lib/archLots';
import { useArchSummaryData, setArchAutoRefreshHeld, addArchOrderOverlay } from '@/hooks/useArchSummaryData';
import { overlayFromOrder, cartTakenNote } from '@/lib/archOrderOverlay';
import type { ArchCostCurrency } from '@/lib/archLots';
import type { ArchDataSource, ArchCacheMeta } from '@/hooks/useArchSummaryData';
import { exportToExcelARCH } from '@/lib/exportARCH';
import type { FilterState } from '@/types';
import type { ArchSummaryRow, ArchDetailKey } from '@/types/arch';
import type { ArchCartLine, ArchOrderDraft } from '@/types/archOrder';
import {
  createArchOrder,
  newIdempotencyKey,
  orderEndpointConfigured,
  orderOutcome,
  type ArchOrderResult,
} from '@/lib/archOrderApi';

/**
 * CWP ARCH (hardwood) trader screen.
 *
 * Self-contained on purpose: IND and MTL render through App.tsx directly, and
 * ARCH must not reach into either. Everything ARCH-specific — its own data hook,
 * grid, detail modal and export — hangs off this one component, so App.tsx needs
 * a single branch and the IND/MTL paths are untouched.
 */

const EMPTY_FILTERS: FilterState = {};

interface ArchScreenProps {
  uom: string;
  /** Feedback 16: which currency the cost columns and export show. Owned by App. */
  costCurrency?: ArchCostCurrency;
  /** Which of the two ARCH tabs to show. Owned by App so this stays mounted. */
  tab?: 'inventory' | 'orders';
  /** Reports whether the grid is showing NetSuite data or fixtures. */
  onSourceChange?: (source: ArchDataSource, meta: ArchCacheMeta | null, sourceError: string | null) => void;
  /**
   * Hands the grid's refetch up to App, which owns the toolbar refresh button.
   *
   * Same upward pattern as onSourceChange and for the same reason: the data is
   * fetched here but the control lives there, and calling the hook twice would give
   * two copies that can disagree.
   */
  /* `reload` is async. The type said `() => void`, which erased that and left
   * App unable to await it -- the reason the refresh button could not show an
   * in-flight state on ARCH. */
  onReloadReady?: (reload: () => void | Promise<unknown>) => void;
}

export const ArchScreen = ({ uom, costCurrency = 'USD', tab = 'inventory', onSourceChange, onReloadReady }: ArchScreenProps) => {
  const { allRows, loading, error, reload, getFilteredRows, getTotals, getFilterOptions, source, meta, sourceError } =
    useArchSummaryData(true);

  /*
   * Philippe, 2026-08-27: after creating an SO the stock "disparait du TS".
   *
   * It does not disappear, and it is NOT the hourly cache: the builder rebuilt 53
   * seconds after his order. The grid simply NEVER REFETCHES. `startLive` sits behind
   * a module-level flag, there is no interval, no visibilitychange and no focus
   * refetch, and App's refresh button was hard-disabled for ARCH. So the numbers were
   * frozen from page load until a tab reload, unbounded, and his cart clearing looked
   * like the stock vanishing.
   *
   * The hook has always exposed `reload`; nobody wired it. This hands it up.
   */
  React.useEffect(() => {
    onReloadReady?.(reload);
  }, [reload, onReloadReady]);

  // The header badge lives in App but the data is fetched here, so the source has
  // to travel upward. Passing it up beats calling the hook twice — two copies
  // could disagree, which is exactly the ambiguity the badge exists to remove.
  React.useEffect(() => {
    onSourceChange?.(source, meta, sourceError);
  }, [source, meta, sourceError, onSourceChange]);

  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS);
  const [resetKey, setResetKey] = React.useState(0);
  const [filterOpenTrigger, setFilterOpenTrigger] = React.useState(0);
  const [detailOpen, setDetailOpen] = React.useState(false);
  // Store the KEY, not the row object. Holding a row snapshot means an open modal
  // keeps showing pre-refresh figures after the data reloads — harmless while the
  // source is a fixed fixture, wrong the moment the real RESTlet is wired in.
  const [detail, setDetail] = React.useState<{ detailKey: string; bucket: ArchDetailKey } | null>(null);

  /* ── Sales order cart ────────────────────────────────────────────────────
   * Held here rather than in the modal so a trader can tick bundles across
   * several items, closing and reopening detail modals, and keep the selection.
   * ---------------------------------------------------------------------- */
  const [cart, setCart] = React.useState<ArchCartLine[]>([]);
  const [wizardOpen, setWizardOpen] = React.useState(false);
  /**
   * Bumped every time the builder closes, and used as its `key` so React
   * remounts it fresh. Without this the wizard keeps all fourteen pieces of
   * state between openings: create an order and reopen, and you land back on the
   * Review step showing the previous customer and prices against an empty cart.
   * The prototype does the same thing (`soWizardKey`).
   */
  const [wizardKey, setWizardKey] = React.useState(0);
  /**
   * Set when the builder is opened from Edit on the Open Sales Orders tab, so it
   * lands straight on that order instead of asking which one again.
   */
  const [editingSO, setEditingSO] = React.useState<string | null>(null);

  /* 2026-09-23: the grid refreshes itself now (lib/archAutoRefresh), but never
   * under an open SO wizard, whose prices, lots and coverage come from the loaded
   * rows. A refresh that arrives meanwhile is applied when the wizard closes. */
  React.useEffect(() => {
    setArchAutoRefreshHeld(wizardOpen);
    return () => setArchAutoRefreshHeld(false);
  }, [wizardOpen]);

  const closeWizard = React.useCallback(() => {
    setWizardOpen(false);
    setEditingSO(null);
    setWizardKey((k) => k + 1);
  }, []);

  /*
   * ONE open-orders fetch for the whole screen, Feedback 6 item 15.
   *
   * The tab and the wizard each used to hold their own instance of this hook, so
   * Edit remounted the wizard and made it re-fetch the very list the tab was
   * displaying. Measured 2026-09-15, that call runs 2.3s to 11.9s against the
   * sandbox and the wizard's header cannot fill until it lands, which is the
   * "bon délais (10 secondes)" he reported. Shared, Edit has nothing to wait for.
   *
   * 🔴 NO LONGER GATED, Feedback 9 item 12: "Sales Order tab. Est-ce qu'on peut
   * faire en sorte qu'elle popule directement (comme le TS)".
   *
   * It used to fetch only when the tab was shown or the builder opened, so that
   * "a trader who never opens an order never pays for the list". That saved the
   * request and spent the trader's time instead: arriving at the tab meant
   * watching a spinner for the whole round trip.
   *
   * WHY THE TAB IS SLOW AND THE GRID IS NOT, measured 2026-09-21: the grid is
   * served from the N/cache and answers in 358-599 ms. This list is queried LIVE
   * and took 2,248-5,057 ms on the RESTlet leg. ⚠️ Treat those as a FLOOR: the
   * browser calls the Suitelet leg FIRST, which the note above records as slower
   * still, and a fallback pays both round trips. That is the same delay he
   * reported as "bon delais (10 secondes)" in Feedback 6 item 15.
   *
   * So the fetch now starts with the screen. The cost does not go away, it moves
   * OFF the critical path: it runs while the trader is reading the grid instead
   * of while they wait on an empty tab. That serves his earlier complaint rather
   * than contradicting it.
   *
   * ⚠️ WHAT THIS GIVES UP, stated plainly: every screen load now pays for a list
   * many loads never look at. The page-load frequency has NOT been measured, so
   * the justification is that the cost is off the critical path, not that it is
   * small.
   *
   * 🔴 AND IT IS DELIBERATELY NOT CACHED LIKE THE GRID, which is what "comme le
   * TS" would literally mean. Open orders change the moment a trader creates one,
   * so a 15-minute cache would hide a just-created order for up to 15 minutes --
   * and the builder's "add to existing order" mode decides which existing lines
   * to keep or drop from `chosenOrder.lines`, so a stale list would feed the
   * APPEND path's line arithmetic. The grid tolerates a cache because stock moves
   * slowly and a shrink guard protects it; open orders have neither property. If
   * this is ever cached it has to be invalidated ON WRITE by the order endpoint,
   * not rebuilt on a timer.
   */
  const openOrdersState = useArchOpenOrders(true);

  /*
   * 🔴 AND REFRESHED WHEN THE TAB IS OPENED. The prefetch above is only a latency
   * win; THIS is what keeps the change honest. Without it a trader who opens the
   * tab forty minutes after loading the screen reads forty-minute-old orders, and
   * a mount fetch that FAILED would show an error that may no longer be true.
   *
   * Safe to fire with rows on screen, verified rather than assumed: the blank
   * state is gated `isLoading && orders.length === 0`, and the hook never clears
   * `orders` at the start of a fetch -- it only ever calls `setOrders` with a
   * result. So the prefetched rows stay visible while the refresh runs behind
   * them, which is the whole point.
   *
   * `reload` is a `useCallback` with no deps, so it is stable and this cannot
   * loop.
   *
   * Reads `.reload` off the state rather than destructuring the whole object,
   * for the reason the existing alias below already records: the state object's
   * identity changes every render, `reload` does not.
   */
  React.useEffect(() => {
    if (tab !== 'orders') return;
    openOrdersState.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, openOrdersState.reload]);

  const handleEditOrder = React.useCallback((soNo: string) => {
    setEditingSO(soNo);
    // Remount, so the wizard re-primes even if it was opened before.
    setWizardKey((k) => k + 1);
    setWizardOpen(true);
  }, []);
  const [createdDraft, setCreatedDraft] = React.useState<ArchOrderDraft | null>(null);
  const [orderResult, setOrderResult] = React.useState<ArchOrderResult | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  /**
   * Why the cart is still here after the last attempt. Outlives the dialog on
   * purpose: onClose nulls the result, and after Done the cart bar was the only
   * thing left on screen, green, saying nothing about a refused or unanswered
   * request. Reset on the next attempt and when the cart is cleared.
   */
  const [cartNote, setCartNote] = React.useState<string | null>(null);

  /**
   * One idempotency key per order ATTEMPT, reused across retries of that order.
   *
   * 🔴 Regenerating it on retry is what creates a duplicate. A failed fetch does
   * not mean the server did nothing — it may have created the order and lost the
   * response — so a retry has to carry the same key to be refused rather than
   * duplicated. Cleared only once an order actually succeeds.
   */
  const orderKeyRef = React.useRef<string | null>(null);

  const cartLotNos = React.useMemo(() => new Set(cart.map((l) => l.lotNo)), [cart]);

  const handleAddToCart = React.useCallback(
    (row: ArchSummaryRow, lotNos: string[], bucket: ArchDetailKey) => {
      setCart((prev) => {
        const byKey = new Map(prev.map((l) => [l.key, l]));
        lotNos.forEach((lotNo) => {
          const lot = row.lots.find((l) => l.lotNo === lotNo);
          if (!lot) return;
          // Key on the PHYSICAL BUNDLE only. Including the bucket let the same
          // lot be added once from On Hand and again from Available, showing
          // twice in the cart and double-counting its board feet and revenue.
          // A bundle is one thing; which view it was picked from is metadata.
          const key = `${row.internalId}|${lotNo}`;
          // First add wins. `set` overwrote unconditionally, and `bf` is
          // bucket-dependent, so re-adding the same bundle from a different view
          // silently CHANGED its board feet rather than being a no-op — a worse
          // failure than the visible duplicate this key was meant to kill.
          // Not reachable today (the cart is only fed from On Hand and Available,
          // and anything addable has no commitment, so the two agree), but a
          // silent order-dependent mutation is not worth leaving armed.
          if (byKey.has(key)) return;
          byKey.set(key, {
            key,
            internalId: row.internalId,
            itemCode: row.itemCode,
            description: row.description,
            // Internal ids for the write path. Carried from the row and the lot
            // rather than resolved later from names: a lot number is only unique
            // within its item, and the endpoint checks that the pairing is real.
            locationId: row.locationId,
            lotId: lot.lotId,
            // Carried explicitly rather than parsed back out of the description
            // downstream — the row knows it, and real NetSuite descriptions will
            // not reliably contain a parseable "n/4".
            thickness: row.thickness,
            locationName: row.locationName,
            lotNo,
            containerNo: lot.containerNo,
            // Board feet this bundle can contribute FROM THE BUCKET it was picked
            // in — on the Available view that is the uncommitted remainder, not
            // the full on-hand figure.
            preSplitQty: lotQuantity(lot, bucket),
            unit: row.unit,
            /*
             * 🔴 THE BUNDLE'S OWN COST, falling back to the row. Feedback 6 item 18:
             * the wizard priced every line at `row.avgCostPerUnit`, an on-hand-weighted
             * average over every costed lot in the item and location, so lot 316027-9
             * was quoted at 12.76 when it cost 14.15. The margin and the profit are
             * computed off this same number, so the error was never only cosmetic.
             *
             * The fallback is the row average and NOT zero: a lot with no posting
             * history sends null, and the row figure is the best honest estimate for
             * it -- the same one this line has always used.
             */
            costPerBF: lot.costPerUnit === null || lot.costPerUnit === undefined
              ? row.avgCostPerUnit
              : lot.costPerUnit,
            bucket,
          });
        });
        return [...byKey.values()];
      });
    },
    []
  );

  const removeCartLine = React.useCallback(
    (key: string) => setCart((prev) => prev.filter((l) => l.key !== key)),
    []
  );

  /*
   * Pulled out so the callback below can depend on it without depending on the
   * whole state object, whose identity changes every render. `reload` is a
   * `useCallback([])` inside the hook, so this is stable for the screen's life.
   */
  const reloadOpenOrders = openOrdersState.reload;

  const handleCreateOrder = React.useCallback(async (draft: ArchOrderDraft) => {
    setCartNote(null);
    setCreatedDraft(draft);
    setWizardOpen(false);
    setEditingSO(null);
    setWizardKey((k) => k + 1);

    // Not connected to NetSuite — a local preview or a storybook. Show the draft
    // and keep the cart, because nothing was written and the trader has not lost
    // their selection.
    if (!orderEndpointConfigured()) {
      setOrderResult(null);
      setCartNote(orderOutcome(null, false).cartReason);
      return;
    }

    if (!orderKeyRef.current) orderKeyRef.current = newIdempotencyKey();

    setSubmitting(true);
    setOrderResult(null);
    /*
     * 🔴 THE `finally` IS LOAD-BEARING, not tidiness.
     *
     * Every one of the confirmation dialog's five exits is gated on `submitting`
     * (onOpenChange, Escape, pointer-outside, interact-outside and, since 2026-09-08,
     * the Done button), and this DialogContent renders no close X. So if `submitting`
     * is ever left true the trader is stranded in a modal covering the whole screen
     * with no way out but a reload, which loses the cart and tells them nothing about
     * whether their order exists.
     *
     * `createArchOrder` is written to always resolve, but "written to" is not a
     * guarantee: a throw anywhere before its own try rejects instead, and this was the
     * only line that cleared the flag. Chrome also freezes a hidden tab, so a trader
     * who submits and switches to NetSuite to watch for the order suspends both the
     * fetch and its timeout, which is precisely the case the timeout cannot rescue.
     */
    let result: ArchOrderResult;
    try {
      result = await createArchOrder(draft, orderKeyRef.current);
    } catch (e) {
      // Never claim nothing was written: we do not know how far the request got.
      result = {
        ok: false,
        transportFailure: true,
        error:
          (e instanceof Error ? e.message : 'The request could not be completed.') +
          ' If you retry, use the same order — a duplicate will be refused rather than created twice.',
      };
    } finally {
      setSubmitting(false);
    }
    setOrderResult(result);
    setCartNote(orderOutcome(result, false).cartReason);

    if (result.ok) {
      // 🔴 The cart is cleared ONLY on success. Clearing it on failure would
      // destroy the trader's selection while the stock is still sellable, which
      // is worse than leaving a cart they can retry from.
      setCart([]);
      // 2026-09-23: lock this order's bundles on screen NOW, until the cache
      // rebuilds with them (lib/archOrderOverlay). Not for refused lots.
      addArchOrderOverlay(overlayFromOrder(draft.lines, result, draft.header.customer, Date.now()));
      /*
       * 🔴 REFRESH THE ORDER LIST, or the next Edit shows the order as it was
       * BEFORE this write. Nothing reloaded it before either, but the wizard used
       * to remount and fetch its own copy, so at least the append path was fresh.
       * Sharing one list (Feedback 6 item 15) removed that accident, and without
       * this the trader can open the order they just appended to, not see the lines
       * they added, and add them a second time -- a duplicate write, not a stale
       * caption. `reload` is a no-op while the list is not in use and refetches on
       * the next use, so this costs nothing when nobody is looking at it.
       */
      reloadOpenOrders();
      orderKeyRef.current = null;
    }
  }, [reloadOpenOrders]);

  const rowSelectionRef = React.useRef<Record<string, boolean>>({});
  const handleSelectionChange = React.useCallback((selection: Record<string, boolean>) => {
    rowSelectionRef.current = selection;
  }, []);

  const filteredRows = React.useMemo(() => getFilteredRows(filters), [getFilteredRows, filters]);
  const totals = React.useMemo(() => getTotals(filteredRows), [getTotals, filteredRows]);
  const filterOptions = React.useMemo(() => getFilterOptions(filters), [getFilterOptions, filters]);

  const activeFilters = React.useMemo(
    () => ({
      location: filters.location || [],
      species: filters.species || [],
      thickness: filters.thickness || [],
      category: filters.category || [],
      // No grade: the filter was removed 2026-08-27. This drives cell highlighting,
      // so listing a key ARCH cannot filter on would highlight nothing.
      // See applyArchFilters in useArchSummaryData for why the value is always ''.
    }),
    [filters]
  );

  const handleReset = React.useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setResetKey((k) => k + 1);
  }, []);

  /** Clicking an attribute cell toggles that value in its filter. */
  const handleCellFilter = React.useCallback((filterKey: string, value: string) => {
    setFilters((prev) => {
      const current = (prev[filterKey as keyof FilterState] as string[]) || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return {
        ...prev,
        [filterKey]: next,
        // FilterPanel renders the location field from `reload || location`, so a
        // cell click that updated only `location` left the panel showing a stale
        // selection while the grid filtered on the new one. Keep them in step —
        // same mirroring App.tsx does for IND/MTL.
        ...(filterKey === 'location' && { reload: next }),
      };
    });
    setFilterOpenTrigger((k) => k + 1);
  }, []);

  const handleDrillDown = React.useCallback((bucket: ArchDetailKey, row: ArchSummaryRow) => {
    setDetail({ detailKey: row.detailKey, bucket });
    setDetailOpen(true);
  }, []);

  /** Resolve the open row against current data so the modal never shows stale figures. */
  const detailRow = React.useMemo(
    () => (detail && allRows ? allRows.find((r) => r.detailKey === detail.detailKey) ?? null : null),
    [detail, allRows]
  );

  const handleExport = React.useCallback(() => {
    const rows = selectedArchRows(filteredRows, rowSelectionRef.current);
    exportToExcelARCH(rows, getTotals(rows), uom, costCurrency);
  }, [filteredRows, getTotals, uom, costCurrency]);

  // The grid refreshes itself now, so a cart can hold a bundle someone else just
  // took. Said on the cart bar, next to any note of our own.
  const takenNote = React.useMemo(() => cartTakenNote(cart, allRows), [cart, allRows]);

  return (
    <>
      <SOCartBar
        cart={cart}
        note={[takenNote, cartNote].filter(Boolean).join(' ') || null}
        onOpenWizard={() => setWizardOpen(true)}
        onClear={() => {
          setCart([]);
          setCartNote(null);
        }}
      />

      {tab === 'inventory' && (
      <div className="px-4 pt-3 flex-shrink-0">
        <FilterPanel
          filters={filters}
          onFiltersChange={setFilters}
          onReset={handleReset}
          onExport={handleExport}
          filterOptions={filterOptions}
          exportDisabled={!allRows}
          activeView="CWP ARCH"
          openTrigger={filterOpenTrigger}
          defaultOpen
          cartCount={cart.length}
          onOpenCart={() => setWizardOpen(true)}
        />
      </div>
      )}

      {error && (
        <div className="px-4 pt-2 flex-shrink-0">
          <p className="text-destructive text-sm bg-destructive/10 px-3 py-2 rounded">{error}</p>
        </div>
      )}

      {/* 🔴 STOCK THE SCREEN CANNOT SHOW, said out loud.
        *
        * Added 2026-09-10 in answer to Marc-Antoine: he added bundles in sandbox the
        * previous day, saw the grid unchanged the next morning, and asked whether he
        * needed to trigger something manually. He did not. The cache had rebuilt on
        * the hour and his lots were on items with no Hardwood segment, so no query in
        * the chain could see them. The cache MR had been listing those exact item ids
        * in its audit log hourly, which is not a place a trader looks.
        *
        * A tooltip on the "Live" badge would not have answered him either, because
        * the symptom is the ABSENCE of a change - there is nothing to hover. So this
        * is a standing notice, on the inventory tab only, whenever the count is
        * non-zero. It is deliberately not dismissible: the condition is real until
        * somebody tags the items or confirms they are not hardwood, and it is the
        * difference between "the screen is broken" and "the data is not tagged".
        *
        * `source === 'netsuite'` gates it because on demo data the count is
        * meaningless and would read as a live account problem. */}
      {tab === 'inventory' && source === 'netsuite' && !!meta?.untaggedItemCount && (
        <div className="px-4 pt-2 flex-shrink-0">
          <p
            className="text-[12px] px-3 py-2 rounded leading-relaxed"
            style={{ background: 'rgba(200,160,53,0.12)', color: '#7A5B00', border: '1px solid rgba(200,160,53,0.45)' }}
            role="status"
          >
            <strong>{meta.untaggedItemCount} item{meta.untaggedItemCount === 1 ? '' : 's'} with stock are not on this
            screen</strong>, because they are not in subsidiary ARC, which is what this screen shows. If you have just
            added bundles and nothing changed here, this is almost certainly why, and nothing needs triggering: the
            cache rebuilds every 15 minutes on its own.
            {meta.untaggedItemSample?.length
              ? <> For example <span className="font-mono">{meta.untaggedItemSample.join(', ')}</span>
                {meta.untaggedItemCount > meta.untaggedItemSample.length
                  ? ' and ' + (meta.untaggedItemCount - meta.untaggedItemSample.length) + ' more'
                  : ''}.</>
              : null}
            {' '}If it is ARCH stock, put the item in subsidiary <span className="font-mono">ARC</span>; otherwise
            nothing needs doing.
          </p>
        </div>
      )}

      <main className="flex-1 flex flex-col px-4 pt-3 pb-2 min-h-0 overflow-auto">
        {tab === 'orders' ? (
          <ArchOpenOrdersView onEditOrder={handleEditOrder} ordersState={openOrdersState} />
        ) : (
        <div className="relative flex-1 flex flex-col min-h-0">
          {loading && !allRows && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center z-10 rounded backdrop-blur-sm"
              style={{ background: 'rgba(238,241,246,0.88)' }}
            >
              <div className="w-11 h-11 rounded-full border-4 border-[#CBD5E1] border-t-[var(--green)] animate-spin" />
              <div className="mt-3 text-[13px] font-medium text-[#3D5166]">Loading…</div>
            </div>
          )}
          {allRows ? (
            <InventoryTableARCH
              costCurrency={costCurrency}
              data={filteredRows}
              onDrillDown={handleDrillDown}
              onCellFilter={handleCellFilter}
              activeFilters={activeFilters}
              onRowSelectionChange={handleSelectionChange}
              resetKey={resetKey}
              totals={totals}
              rowCount={filteredRows.length}
              uom={uom}
              readyToBuildSourced={!!meta?.bucketsBuilt?.includes('readyToBuild')}
            />
          ) : !loading ? (
            /*
             * The FINISHED-AND-EMPTY state. It used to read "Loading inventory
             * data…", which was actively misleading: this branch is reached only
             * when `loading` is FALSE, so it announced a load that had already
             * stopped. The genuine loading state is the spinner above, gated on
             * `loading && !allRows`.
             *
             * That label cost hours on 2026-08-19 — an empty grid looked like a
             * hang, so the investigation went after a request that was never the
             * problem. A screen that misreports its own state makes every
             * downstream diagnosis unreliable, so this now says what is actually
             * known and distinguishes the two ways of arriving here.
             */
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-[#3D5166]">No inventory data loaded.</p>
              <p className="mt-1 text-xs text-[#7A8FA3]">
                {error
                  ? 'The load failed — see the message above.'
                  : 'The data source returned nothing and reported no error.'}
              </p>
            </div>
          ) : null}
        </div>
        )}
      </main>

      {detail && detailRow && (
        <DetailDrawerARCH
          costCurrency={costCurrency}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          row={detailRow}
          triggerBucket={detail.bucket}
          uom={uom}
          /* The tally panel refuses to draw a demo fixture over a real lot, so it has
             to know which of the two this screen is showing. Same signal the demo-data
             badge in the toolbar reads. See demoTallyProps. */
          dataSource={source}
          onAddToCart={handleAddToCart}
          cartLotNos={cartLotNos}
        />
      )}

      <SOWizard
        key={wizardKey}
        open={wizardOpen}
        cart={cart}
        onClose={closeWizard}
        onRemoveLine={removeCartLine}
        onCreate={handleCreateOrder}
        initialExistingSO={editingSO ?? undefined}
        ordersState={openOrdersState}
        // "Add item" returns to the grid but KEEPS the draft, so it must not bump
        // the key — the trader is coming back to this same order.
        onAddMoreItems={() => setWizardOpen(false)}
      />

      {createdDraft && (
        <ArchOrderDraftDialog
          draft={createdDraft}
          submitting={submitting}
          result={orderResult}
          onClose={() => {
            setCreatedDraft(null);
            setOrderResult(null);
          }}
        />
      )}
    </>
  );
};
