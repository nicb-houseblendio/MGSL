import * as React from 'react';
import { FilterPanel } from '@/components/FilterPanel';
import { InventoryTableARCH, selectedArchRows } from '@/components/InventoryTableARCH';
import { DetailDrawerARCH } from '@/components/DetailDrawerARCH';
import { SOCartBar } from '@/components/arch/SOCartBar';
import { SOWizard } from '@/components/arch/SOWizard';
import { ArchOrderDraftDialog } from '@/components/arch/ArchOrderDraftDialog';
import { lotQuantity } from '@/lib/archLots';
import { useArchSummaryData } from '@/hooks/useArchSummaryData';
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
}

export const ArchScreen = ({ uom }: ArchScreenProps) => {
  const { allRows, loading, error, getFilteredRows, getTotals, getFilterOptions } = useArchSummaryData(true);

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
  const [createdDraft, setCreatedDraft] = React.useState<ArchOrderDraft | null>(null);

  const cartLotNos = React.useMemo(() => new Set(cart.map((l) => l.lotNo)), [cart]);

  const handleAddToCart = React.useCallback(
    (row: ArchSummaryRow, lotNos: string[], bucket: ArchDetailKey) => {
      setCart((prev) => {
        const byKey = new Map(prev.map((l) => [l.key, l]));
        lotNos.forEach((lotNo) => {
          const lot = row.lots.find((l) => l.lotNo === lotNo);
          if (!lot) return;
          const key = `${row.internalId}|${bucket}|${lotNo}`;
          byKey.set(key, {
            key,
            internalId: row.internalId,
            itemCode: row.itemCode,
            description: row.description,
            locationName: row.locationName,
            lotNo,
            containerNo: lot.containerNo,
            // Board feet this bundle can contribute FROM THE BUCKET it was picked
            // in — on the Available view that is the uncommitted remainder, not
            // the full on-hand figure.
            bf: lotQuantity(lot, bucket),
            costPerBF: row.avgCostBF,
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
        />
      </div>

      {error && (
        <div className="px-4 pt-2 flex-shrink-0">
          <p className="text-destructive text-sm bg-destructive/10 px-3 py-2 rounded">{error}</p>
        </div>
      )}

      <main className="flex-1 flex flex-col px-4 pt-3 pb-2 min-h-0">
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
            <p className="py-12 text-center text-sm text-[#3D5166]">Loading inventory data…</p>
          ) : null}
        </div>
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
        open={wizardOpen}
        cart={cart}
        onClose={() => setWizardOpen(false)}
        onRemoveLine={removeCartLine}
        onCreate={handleCreateOrder}
        onAddMoreItems={() => setWizardOpen(false)}
      />

      {createdDraft && (
        <ArchOrderDraftDialog draft={createdDraft} onClose={() => setCreatedDraft(null)} />
      )}
    </>
  );
};
