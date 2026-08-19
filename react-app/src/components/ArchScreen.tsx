import * as React from 'react';
import { FilterPanel } from '@/components/FilterPanel';
import { InventoryTableARCH, selectedArchRows } from '@/components/InventoryTableARCH';
import { ArchOpenOrdersView } from '@/components/arch/ArchOpenOrdersView';
import { DetailDrawerARCH } from '@/components/DetailDrawerARCH';
import { SOCartBar } from '@/components/arch/SOCartBar';
import { SOWizard } from '@/components/arch/SOWizard';
import { ArchOrderDraftDialog } from '@/components/arch/ArchOrderDraftDialog';
import { lotQuantity } from '@/lib/archLots';
import { useArchSummaryData } from '@/hooks/useArchSummaryData';
import type { ArchDataSource, ArchCacheMeta } from '@/hooks/useArchSummaryData';
import { exportToExcelARCH } from '@/lib/exportARCH';
import type { FilterState } from '@/types';
import type { ArchSummaryRow, ArchDetailKey } from '@/types/arch';
import type { ArchCartLine, ArchOrderDraft } from '@/types/archOrder';

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
  /** Which of the two ARCH tabs to show. Owned by App so this stays mounted. */
  tab?: 'inventory' | 'orders';
  /** Reports whether the grid is showing NetSuite data or fixtures. */
  onSourceChange?: (source: ArchDataSource, meta: ArchCacheMeta | null, sourceError: string | null) => void;
}

export const ArchScreen = ({ uom, tab = 'inventory', onSourceChange }: ArchScreenProps) => {
  const { allRows, loading, error, getFilteredRows, getTotals, getFilterOptions, source, meta, sourceError } =
    useArchSummaryData(true);

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

  const closeWizard = React.useCallback(() => {
    setWizardOpen(false);
    setEditingSO(null);
    setWizardKey((k) => k + 1);
  }, []);

  const handleEditOrder = React.useCallback((soNo: string) => {
    setEditingSO(soNo);
    // Remount, so the wizard re-primes even if it was opened before.
    setWizardKey((k) => k + 1);
    setWizardOpen(true);
  }, []);
  const [createdDraft, setCreatedDraft] = React.useState<ArchOrderDraft | null>(null);

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
            bf: lotQuantity(lot, bucket),
            unit: row.unit,
            costPerBF: row.avgCostPerUnit,
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

  const handleCreateOrder = React.useCallback((draft: ArchOrderDraft) => {
    // No NetSuite write yet — see the note in SOWizard. Surface the draft so the
    // flow can be reviewed end to end, and clear the cart as a real create would.
    setCreatedDraft(draft);
    setWizardOpen(false);
    setEditingSO(null);
    setWizardKey((k) => k + 1);
    setCart([]);
  }, []);

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
      grade: filters.grade || [],
      containerNo: filters.containerNo || [],
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
    exportToExcelARCH(rows, getTotals(rows), uom);
  }, [filteredRows, getTotals, uom]);

  return (
    <>
      <SOCartBar cart={cart} onOpenWizard={() => setWizardOpen(true)} onClear={() => setCart([])} />

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

      <main className="flex-1 flex flex-col px-4 pt-3 pb-2 min-h-0 overflow-auto">
        {tab === 'orders' ? (
          <ArchOpenOrdersView onEditOrder={handleEditOrder} />
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
              data={filteredRows}
              onDrillDown={handleDrillDown}
              onCellFilter={handleCellFilter}
              activeFilters={activeFilters}
              onRowSelectionChange={handleSelectionChange}
              resetKey={resetKey}
              totals={totals}
              rowCount={filteredRows.length}
              uom={uom}
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
          open={detailOpen}
          onOpenChange={setDetailOpen}
          row={detailRow}
          triggerBucket={detail.bucket}
          uom={uom}
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
        // "Add item" returns to the grid but KEEPS the draft, so it must not bump
        // the key — the trader is coming back to this same order.
        onAddMoreItems={() => setWizardOpen(false)}
      />

      {createdDraft && (
        <ArchOrderDraftDialog draft={createdDraft} onClose={() => setCreatedDraft(null)} />
      )}
    </>
  );
};
