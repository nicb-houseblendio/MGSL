import * as React from 'react';
import { ThemeProvider } from '@/context/ThemeProvider';
import { NetSuiteProvider, useNetSuite } from '@/context/NetSuiteContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { FilterPanel } from '@/components/FilterPanel';
import { PivotTable } from '@/components/PivotTable';
import { DetailDrawer } from '@/components/DetailDrawer';
import { Button } from '@/components/ui/button';
import { FileDown, Loader2 } from 'lucide-react';
import { useSummaryData } from '@/hooks/useSummaryData';
import { useRefreshState } from '@/hooks/useRefreshState';
import { transformToPivot } from '@/lib/pivotTransform';
import { exportToExcel } from '@/lib/export';
import type { FilterState } from '@/types';
import type { PivotRow } from '@/lib/pivotTransform';
import type { DetailType } from '@/hooks/useDetailData';

const defaultFilters: FilterState = {
  quantityGreaterThanZero: true,
};

function TraderScreenContent() {
  const { subsidiaryId, subsidiaryName } = useNetSuite();
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

  const pivotData = React.useMemo((): PivotRow[] => {
    if (!filteredRows?.length) return [];
    return transformToPivot(filteredRows);
  }, [filteredRows]);

  const totals = React.useMemo(
    () => getTotals(filteredRows),
    [getTotals, filteredRows]
  );

  const filterOptions = React.useMemo(
    () => getFilterOptions(allRows),
    [getFilterOptions, allRows]
  );

  const handleApply = React.useCallback(() => {
    setFilters((f) => ({ ...f }));
  }, []);

  const handleReset = React.useCallback(() => {
    setFilters(defaultFilters);
  }, []);

  const handleDrillDown = React.useCallback(
    (type: string, row: PivotRow) => {
      if (row.internalId && row.locationId) {
        setDetailParams({
          itemId: row.internalId,
          locationId: row.locationId,
          type: type as DetailType,
        });
        setDetailOpen(true);
      }
    },
    []
  );

  const handleExport = React.useCallback(() => {
    exportToExcel(pivotData, totals);
  }, [pivotData, totals]);

  const displayError = error || refreshError;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b px-4 sticky top-0 bg-navy text-white z-20">
        <h1 className="text-lg font-semibold font-sans">
          Trader Screen — {subsidiaryName || 'CWP Industriel Inc.'}
        </h1>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void doRefresh()}
            disabled={refreshState === 'checking' || refreshState === 'fetching'}
            className="border-white/30 text-white hover:bg-white/10"
          >
            {(refreshState === 'checking' || refreshState === 'fetching') && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {refreshState === 'checking' && 'Checking…'}
            {refreshState === 'up-to-date' && 'Up to date'}
            {refreshState === 'fetching' && 'Loading…'}
            {refreshState === 'error' && 'Retry'}
            {refreshState === 'idle' && 'Refresh'}
          </Button>
          <span
            className={`text-xs ${
              getLastUpdatedBadgeState(meta?.lastUpdated ?? '') === 'ok'
                ? 'text-white/70'
                : getLastUpdatedBadgeState(meta?.lastUpdated ?? '') === 'stale'
                ? 'text-amber-300'
                : 'bg-amber-500/30 text-amber-100 px-2 py-0.5 rounded'
            }`}
          >
            {loading && !allRows
              ? 'Loading…'
              : meta?.lastUpdated
              ? `Last updated: ${formatLastUpdated(meta.lastUpdated)}`
              : '—'}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="p-4 space-y-4">
        <FilterPanel
          filters={filters}
          onFiltersChange={setFilters}
          onApply={handleApply}
          onReset={handleReset}
          filterOptions={filterOptions}
        />

        <div className="flex items-center gap-2">
          <Button onClick={handleApply} disabled={loading}>
            Apply Filters
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={!allRows}>
            <FileDown className="mr-2 h-4 w-4" />
            Export to Excel
          </Button>
        </div>

        {newVersionAvailable && (
          <div className="flex items-center justify-between bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 px-4 py-2 rounded">
            <span>New data available.</span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { dismissBanner(); void doRefresh(true); }}>
                Load now
              </Button>
              <Button size="sm" variant="outline" onClick={dismissBanner}>
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {displayError && (
          <p className="text-destructive text-sm">{displayError}</p>
        )}

        <div className="relative">
          {loading && !allRows && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
          {allRows ? (
            <PivotTable
              data={pivotData}
              totals={totals}
              onDrillDown={handleDrillDown}
            />
          ) : !loading ? (
            <p className="text-muted-foreground py-8 text-center">
              Loading inventory data…
            </p>
          ) : null}
        </div>
      </main>

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
