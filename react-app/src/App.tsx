import * as React from 'react';
import { ThemeProvider } from '@/context/ThemeProvider';
import { NetSuiteProvider, useNetSuite } from '@/context/NetSuiteContext';
import { FilterPanel } from '@/components/FilterPanel';
import { InventoryTable, InventoryFooter } from '@/components/InventoryTable';
import { DetailDrawer } from '@/components/DetailDrawer';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useSummaryData } from '@/hooks/useSummaryData';
import { useRefreshState } from '@/hooks/useRefreshState';
import { exportToExcel } from '@/lib/export';
import type { FilterState } from '@/types';
import type { SummaryRow } from '@/lib/api';
import type { DetailType } from '@/hooks/useDetailData';

const DEFAULT_UOM_CONFIG: Record<string, string[]> = {
  'CWP IND': ['MBF', 'Packs'],
  'CWP MTL': ['MBF', 'Packs', 'TL'],
  'CWP ARCH': ['MBF', 'Cubic meters (m³)', 'Packs'],
};

const defaultFilters: FilterState = {
  quantityGreaterThanZero: true,
};

function TraderScreenContent() {
  const { subsidiaryId, uomConfig: contextUomConfig } = useNetSuite();
  const uomConfig = contextUomConfig && Object.keys(contextUomConfig).length > 0
    ? contextUomConfig
    : DEFAULT_UOM_CONFIG;
  const CWP_VIEWS = Object.keys(uomConfig);
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
  } = useRefreshState({
    loadedCacheVersion: meta?.cacheVersion ?? null,
    lastUpdated: meta?.lastUpdated ?? null,
    onFetchNeeded: async () => { await fetchSummary(); },
    onFetchComplete: () => {},
  });

  const [activeView, setActiveView] = React.useState(CWP_VIEWS[0] || 'CWP IND');
  const [uom, setUom] = React.useState('Packs');
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
    () => getFilterOptions(allRows, filters),
    [getFilterOptions, allRows, filters]
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

  const today = typeof window !== 'undefined' ? new Date().toLocaleDateString('fr-CA', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const uomOptions = uomConfig[activeView] || ['MBF', 'Packs'];

  return (
    <div className="min-h-screen flex flex-col text-foreground pb-10" style={{ background: 'var(--background)' }}>
      {/* POC-style header: gradient 56px, MG logo, two-line branding, CWP pills, UoM + date */}
      <header
        className="sticky top-0 z-30 text-white flex-shrink-0 shadow-lg"
        style={{
          background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-mid) 60%, var(--navy-light) 100%)',
          height: 56,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md"
              style={{ background: 'linear-gradient(135deg, var(--green), #2A9060)' }}
            >
              <span className="text-white text-sm font-extrabold tracking-tight">MG</span>
            </div>
            <div>
              <div className="text-white text-[15px] font-bold tracking-wide">MGSL</div>
              <div className="text-white/50 text-[10px] uppercase tracking-widest">Commodity Group</div>
            </div>
          </div>
          <div className="w-px h-7 bg-white/15" />
          <div className="text-white/85 text-[13px] font-medium">Trader Screen</div>
        </div>

        <div className="flex gap-1">
          {CWP_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setActiveView(view)}
              className="px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all"
              style={{
                background: activeView === view ? 'linear-gradient(135deg, var(--green), #237A52)' : 'rgba(255,255,255,0.1)',
                color: activeView === view ? '#fff' : 'rgba(255,255,255,0.65)',
                boxShadow: activeView === view ? '0 2px 8px rgba(0,0,0,0.25)' : 'none',
              }}
            >
              {view}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-white/45 text-[11px] uppercase tracking-wider">UoM</span>
            <select
              value={uomOptions.includes(uom) ? uom : uomOptions[0]}
              onChange={(e) => setUom(e.target.value)}
              className="py-1 px-2.5 rounded-md text-white text-xs cursor-pointer outline-none border border-white/25 bg-white/10"
            >
              {uomOptions.map((o) => (
                <option key={o} value={o} className="bg-navy text-white">{o}</option>
              ))}
            </select>
          </div>
          <div className="w-px h-5 bg-white/15" />
          <span className="text-white/40 text-[11px]">{today}</span>
          <div className="w-px h-5 bg-white/15" />
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
      </header>

      {/* POC-style tabs: navyMid bg, Inventaire / Vues sauvegardées */}
      <div className="flex gap-0.5 px-6 flex-shrink-0" style={{ background: 'var(--navy-mid)', paddingTop: 0, paddingBottom: 0 }}>
        <button
          type="button"
          className="px-4 py-2 text-xs font-semibold rounded-t-md transition-all text-[var(--navy)]"
          style={{ background: 'var(--background)' }}
        >
          📦  Inventaire
        </button>
        <button
          type="button"
          className="px-4 py-2 text-xs font-semibold rounded-t-md transition-all text-white/60 hover:text-white/80 hover:bg-white/5"
        >
          ⭐  Vues sauvegardées
        </button>
      </div>

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

      {/* Main table area — POC: bg #EEF1F6, loading "Chargement…" with circular spinner */}
      <main className="flex-1 px-4 pt-3 pb-2 min-h-0">
        <div className="relative flex-1">
          {loading && !allRows && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center z-10 rounded backdrop-blur-sm"
              style={{ background: 'rgba(238,241,246,0.88)' }}
            >
              <div
                className="w-11 h-11 rounded-full border-4 border-[#CBD5E1] border-t-[var(--green)] animate-spin"
              />
              <div className="mt-3 text-[13px] font-medium text-[#3D5166]">Chargement…</div>
            </div>
          )}
          {allRows ? (
            <InventoryTable
              data={filteredRows}
              onDrillDown={handleDrillDown}
            />
          ) : !loading ? (
            <p className="py-12 text-center text-sm text-[#3D5166]">
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
          resetCacheVersion={meta?.cacheVersion ?? null}
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
