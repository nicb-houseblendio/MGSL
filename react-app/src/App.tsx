import * as React from 'react';
import { ThemeProvider } from '@/context/ThemeProvider';
import { NetSuiteProvider, useNetSuite } from '@/context/NetSuiteContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { FilterPanel } from '@/components/FilterPanel';
import { PivotTable } from '@/components/PivotTable';
import { DetailDrawer } from '@/components/DetailDrawer';
import { Button } from '@/components/ui/button';
import { FileDown, Loader2 } from 'lucide-react';
import { useInventoryData } from '@/hooks/useInventoryData';
import { useSavedViews } from '@/hooks/useSavedViews';
import { transformToPivot } from '@/lib/pivotTransform';
import { exportToExcel } from '@/lib/export';
import type { FilterState } from '@/types';
import type { PivotRow } from '@/lib/pivotTransform';
import type { DetailType } from '@/hooks/useDetailData';

const defaultFilters: FilterState = {
  quantityGreaterThanZero: true,
};

function TraderScreenContent() {
  const { subsidiaryId } = useNetSuite();
  const { data, loading, error, fetchItems } = useInventoryData();
  useSavedViews(subsidiaryId || 'default');

  const [filters, setFilters] = React.useState<FilterState>(defaultFilters);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailParams, setDetailParams] = React.useState<{
    itemId: string;
    locationId: string;
    type: DetailType;
  } | null>(null);

  const pivotData = React.useMemo((): PivotRow[] => {
    if (!data?.rows?.length) return [];
    return transformToPivot(data.rows);
  }, [data?.rows]);

  const totals = data?.totals ?? {
    onHand: 0,
    committed: 0,
    outbound: 0,
    inTransit: 0,
    available: 0,
  };

  const handleApply = React.useCallback(() => {
    fetchItems(filters);
  }, [filters, fetchItems]);

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b px-4 sticky top-0 bg-background z-20">
        <h1 className="text-lg font-semibold">Trader Screen</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>

      <main className="p-4 space-y-4">
        <FilterPanel
          filters={filters}
          onFiltersChange={setFilters}
          onApply={handleApply}
          onReset={handleReset}
        />

        <div className="flex items-center gap-2">
          <Button onClick={handleApply} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Apply Filters
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={!data}>
            <FileDown className="mr-2 h-4 w-4" />
            Export to Excel
          </Button>
        </div>

        {error && (
          <p className="text-destructive text-sm">{error}</p>
        )}

        <div className="relative">
          {loading && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
          {data ? (
            <PivotTable
              data={pivotData}
              totals={totals}
              onDrillDown={handleDrillDown}
            />
          ) : !loading ? (
            <p className="text-muted-foreground py-8 text-center">
              Click Apply Filters to load inventory data.
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
