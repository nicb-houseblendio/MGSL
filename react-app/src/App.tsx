import * as React from 'react';
import { ThemeProvider } from '@/context/ThemeProvider';
import { NetSuiteProvider, useNetSuite } from '@/context/NetSuiteContext';
import { FilterPanel } from '@/components/FilterPanel';
import { InventoryTable, InventoryFooter } from '@/components/InventoryTable';
import { DetailDrawer } from '@/components/DetailDrawer';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, ChevronDown, User, Plus } from 'lucide-react';
import { useSummaryData } from '@/hooks/useSummaryData';
import { useRefreshState } from '@/hooks/useRefreshState';
import { exportToExcel } from '@/lib/export';
import type { FilterState } from '@/types';
import type { SummaryRow } from '@/lib/api';
import type { DetailType } from '@/hooks/useDetailData';

const CWP_VIEWS = ['CWP MTL', 'CWP IND', 'CWP ARCH'] as const;
type CwpView = typeof CWP_VIEWS[number];

const defaultFilters: FilterState = {
  quantityGreaterThanZero: true,
};

function TraderScreenContent() {
  const { subsidiaryId, userName } = useNetSuite();
  const {
    allRows,
    meta,
    loading,
    error,
    fetchSummary,
    getFilteredRows,
    getTotals,
    getFilterOptions,
  } = useSummaryData(subsidiaryId || 'default');

  const {
    refreshState,
    newVersionAvailable,
    error: refreshError,
    doRefresh,
    dismissBanner,
    formatLastUpdated,
    getLastUpdatedBadgeState,
  } = useRefreshState({
    loadedCacheVersion: meta?.cacheVersion ?? null,
    lastUpdated: meta?.lastUpdated ?? null,
    onFetchNeeded: async () => { await fetchSummary(); },
    onFetchComplete: () => {},
  });

  const [activeView, setActiveView] = React.useState<CwpView>('CWP IND');
  const [filters, setFilters] = React.useState<FilterState>(defaultFilters);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailParams, setDetailParams] = React.useState<{
    itemId: string;
    locationId: string;
    type: DetailType;
  } | null>(null);

  const filteredRows = React.useMemo(
    () => getFilteredRows(filters),
    [getFilteredRows, filters]
  );

  const totals = React.useMemo(
    () => getTotals(filteredRows),
    [getTotals, filteredRows]
  );

  const filterOptions = React.useMemo(
    () => getFilterOptions(allRows),
    [getFilterOptions, allRows]
  );

  const avgCost = React.useMemo(() => {
    if (!filteredRows.length) return 0;
    const sum = filteredRows.reduce((s, r) => s + (r.averageCost || 0), 0);
    return sum / filteredRows.length;
  }, [filteredRows]);

  const handleApply = React.useCallback(() => {
    setFilters((f) => ({ ...f }));
  }, []);

  const handleReset = React.useCallback(() => {
    setFilters(defaultFilters);
  }, []);

  const handleDrillDown = React.useCallback(
    (type: DetailType, row: SummaryRow) => {
      if (row.internalId && row.locationId) {
        setDetailParams({
          itemId: row.internalId,
          locationId: row.locationId,
          type,
        });
        setDetailOpen(true);
      }
    },
    []
  );

  const handleExport = React.useCallback(() => {
    exportToExcel(filteredRows, totals);
  }, [filteredRows, totals]);

  const displayError = error || refreshError;
  const badgeState = getLastUpdatedBadgeState(meta?.lastUpdated ?? '');

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground pb-10">
      {/* Primary header — navy bar */}
      <header className="sticky top-0 z-30 bg-navy text-white">
        <div className="flex h-12 items-center justify-between px-4">
          {/* Left: branding */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">MGSL Commodity Group</span>
            <span className="text-sm font-semibold">Trader Screen</span>
          </div>

          {/* Center: CWP view tabs */}
          <div className="flex items-center gap-1">
            {CWP_VIEWS.map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setActiveView(view)}
                className={`px-4 py-1.5 text-xs font-semibold rounded transition-colors ${
                  activeView === view
                    ? 'bg-green text-white'
                    : 'bg-transparent text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                {view}
              </button>
            ))}
          </div>

          {/* Right: user, last updated, refresh */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-white/60 text-xs">
              <User className="h-3.5 w-3.5" />
              <span>{userName || 'User'}</span>
              <ChevronDown className="h-3 w-3" />
            </div>
            <span
              className={`text-[10px] px-2 py-0.5 rounded ${
                badgeState === 'ok'
                  ? 'text-white/50'
                  : badgeState === 'stale'
                  ? 'text-amber-300 bg-amber-500/10'
                  : 'bg-amber-500/30 text-amber-100'
              }`}
            >
              {loading && !allRows
                ? 'Loading…'
                : meta?.lastUpdated
                ? formatLastUpdated(meta.lastUpdated)
                : '—'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void doRefresh()}
              disabled={refreshState === 'checking' || refreshState === 'fetching'}
              className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
            >
              <RefreshCw className={`h-4 w-4 ${(refreshState === 'checking' || refreshState === 'fetching') ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Secondary nav */}
        <div className="flex items-center gap-1 px-4 pb-1.5 border-t border-white/10 pt-1.5">
          <button
            type="button"
            className="px-3 py-1 text-xs font-medium rounded bg-white/10 text-white"
          >
            Inventaire
          </button>
          <button
            type="button"
            className="px-3 py-1 text-xs font-medium rounded text-white/50 hover:text-white/80 hover:bg-white/5 flex items-center gap-1"
          >
            <Plus className="h-3 w-3" />
            Nouveau sauvegarder
          </button>
        </div>
      </header>

      {/* New version banner */}
      {newVersionAvailable && (
        <div className="flex items-center justify-between bg-green/10 text-green px-4 py-2 text-sm border-b border-green/20">
          <span>Nouvelles donn&eacute;es disponibles.</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { dismissBanner(); void doRefresh(true); }} className="bg-green text-white hover:bg-green/90 text-xs">
              Charger maintenant
            </Button>
            <Button size="sm" variant="outline" onClick={dismissBanner} className="text-xs">
              Ignorer
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="px-4 pt-3">
        <FilterPanel
          filters={filters}
          onFiltersChange={setFilters}
          onApply={handleApply}
          onReset={handleReset}
          onExport={handleExport}
          filterOptions={filterOptions}
          exportDisabled={!allRows}
        />
      </div>

      {/* Error display */}
      {displayError && (
        <div className="px-4 pt-2">
          <p className="text-destructive text-sm bg-destructive/10 px-3 py-2 rounded">{displayError}</p>
        </div>
      )}

      {/* Main table area */}
      <main className="flex-1 px-4 pt-3 pb-2">
        <div className="relative">
          {loading && !allRows && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center z-10 rounded">
              <Loader2 className="h-8 w-8 animate-spin text-green" />
            </div>
          )}
          {allRows ? (
            <InventoryTable
              data={filteredRows}
              onDrillDown={handleDrillDown}
            />
          ) : !loading ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              Chargement des donn&eacute;es d&apos;inventaire…
            </p>
          ) : null}
        </div>
      </main>

      {/* Fixed footer with totals */}
      <InventoryFooter
        rowCount={filteredRows.length}
        totals={totals}
        averageCost={avgCost}
      />

      {/* Detail drawer */}
      {detailParams && (
        <DetailDrawer
          open={detailOpen}
          onOpenChange={setDetailOpen}
          itemId={detailParams.itemId}
          locationId={detailParams.locationId}
          triggerType={detailParams.type}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <NetSuiteProvider>
        <TraderScreenContent />
      </NetSuiteProvider>
    </ThemeProvider>
  );
}

export default App;
