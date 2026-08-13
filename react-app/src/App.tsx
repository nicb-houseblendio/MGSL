import * as React from 'react';
import { ThemeProvider } from '@/context/ThemeProvider';
import { NetSuiteProvider, useNetSuite } from '@/context/NetSuiteContext';
import { FilterPanel } from '@/components/FilterPanel';
import { InventoryTable } from '@/components/InventoryTable';
import { DetailDrawer } from '@/components/DetailDrawer';
import { Button } from '@/components/ui/button';
import { RefreshCw, Maximize2, Minimize2 } from 'lucide-react';
import { useSummaryData } from '@/hooks/useSummaryData';
import { useRefreshState } from '@/hooks/useRefreshState';
import { exportToExcel } from '@/lib/export';
import type { FilterState } from '@/types';
import type { SummaryRow } from '@/lib/api';
import type { DetailType } from '@/hooks/useDetailData';
import { InventoryTableMTL } from '@/components/InventoryTableMTL';
import { DetailDrawerMTL } from '@/components/DetailDrawerMTL';
import { PriceListModal } from '@/components/PriceListModal';
import { exportToExcelMTL } from '@/lib/exportMTL';
import { ArchScreen } from '@/components/ArchScreen';
import { WarehouseSplitScreen } from '@/components/warehouse/WarehouseSplitScreen';
import { ARCH_UOMS } from '@/lib/archUom';
import { ARCH_IS_DEMO_DATA } from '@/hooks/useArchSummaryData';

// ARCH is board-foot native: no packs, no PPP, no MBF. Cubic metres exist only
// because European packing lists arrive metric (1 m³ = 423 BF).
const DEFAULT_UOM_CONFIG: Record<string, string[]> = {
  'CWP IND': ['Packs'],
  'CWP MTL': ['Packs'],
  'CWP ARCH': ARCH_UOMS,
};

const defaultFilters: FilterState = {};

const getIsFullscreen = () => {
  const win = typeof window !== 'undefined' ? window : null;
  const config = (win as { MCGI_CONFIG?: { fullscreen?: boolean } })?.MCGI_CONFIG;
  return config?.fullscreen === true;
};

const getSuiteletUrl = () => {
  const win = typeof window !== 'undefined' ? window : null;
  return (win as { MCGI_CONFIG?: { suiteletUrl?: string } })?.MCGI_CONFIG?.suiteletUrl || '';
};

function TraderScreenContent() {
  const { subsidiaryId, uomConfig: contextUomConfig } = useNetSuite();
  const uomConfig = contextUomConfig && Object.keys(contextUomConfig).length > 0
    ? contextUomConfig
    : DEFAULT_UOM_CONFIG;
  const CWP_VIEWS = Object.keys(uomConfig);

  // Map subsidiary to default view tab.
  // Verified against NetSuite 2026-08-12 — CWP MTL (5) is the parent of IND (7),
  // PBF (8), ARC (9), ELIM (10) and 9501 (11); ARC is a SIBLING of IND, not a
  // child of it. 9 previously landed on the IND view, which showed a trader IND
  // data under an ARCH label.
  const SUBSIDIARY_TO_VIEW: Record<string, string> = {
    '5': 'CWP MTL', '8': 'CWP MTL', '10': 'CWP MTL', '11': 'CWP MTL',
    '7': 'CWP IND', '14': 'CWP IND', '15': 'CWP IND', '16': 'CWP IND', '17': 'CWP IND', '18': 'CWP IND',
    '9': 'CWP ARCH',
  };
  const defaultView = SUBSIDIARY_TO_VIEW[subsidiaryId] && CWP_VIEWS.includes(SUBSIDIARY_TO_VIEW[subsidiaryId])
    ? SUBSIDIARY_TO_VIEW[subsidiaryId]
    : CWP_VIEWS[0] || 'CWP IND';
  const [activeView, setActiveView] = React.useState(defaultView);
  const isMTL = activeView === 'CWP MTL';
  const isARCH = activeView === 'CWP ARCH';
  const effectiveSubsidiaryId = isMTL ? '5' : isARCH ? '9' : (subsidiaryId || 'default');

  const {
    allRows,
    meta,
    loading,
    error,
    fetchSummary,
    getFilteredRows,
    getTotals,
    getTotalsMBF,
    getFilterOptions,
    // Passing '' suppresses the fetch (the hook guards on a truthy id) — ARCH has
    // no RESTlet to call, and firing a summary request for it would only 503.
  } = useSummaryData(isARCH ? '' : effectiveSubsidiaryId);

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

  /**
   * Units offered for the active view.
   *
   * ARCH does NOT take this from the server. `uomConfig` comes from the RESTlet,
   * which reads an optional `custscript_ts_uom_config_json` script parameter that
   * is not tracked in this repo and historically listed MBF and Packs for ARCH.
   * The ARCH screen can only compute BF and m³ — handed "Packs" it would render
   * board-foot figures under a Packs label with a BF suffix, which is silently
   * wrong data rather than a visible failure. Pin it to what the code can
   * actually convert; IND and MTL keep their server-driven behaviour untouched.
   */
  const uomOptionsFor = React.useCallback(
    (view: string): string[] => (view === 'CWP ARCH' ? ARCH_UOMS : uomConfig[view] || ['Packs']),
    [uomConfig]
  );

  const [uom, setUom] = React.useState('Packs');
  React.useEffect(() => {
    const options = uomOptionsFor(activeView);
    setUom((prev) => options.includes(prev) ? prev : options[0]);
  }, [activeView, uomOptionsFor]);
  const [filters, setFilters] = React.useState<FilterState>(defaultFilters);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailParams, setDetailParams] = React.useState<{
    itemId: string;
    locationId: string;
    type: DetailType;
    row: SummaryRow;
  } | null>(null);
  const [priceListOpen, setPriceListOpen] = React.useState(false);
  const handlePriceList = React.useCallback(() => setPriceListOpen(true), []);

  const isFullscreen = getIsFullscreen();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [appHeight, setAppHeight] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (isFullscreen) return; // fullscreen uses 100vh, no measurement needed
    const measure = () => {
      if (rootRef.current) {
        const top = rootRef.current.getBoundingClientRect().top;
        setAppHeight(window.innerHeight - top);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isFullscreen]);

  const handleToggleFullscreen = React.useCallback(() => {
    const base = getSuiteletUrl();
    if (!base) return;
    if (isFullscreen) {
      window.location.href = base;
    } else {
      window.location.href = base + (base.includes('?') ? '&' : '?') + 'fullscreen=true';
    }
  }, [isFullscreen]);

  const rowSelectionRef = React.useRef<Record<string, boolean>>({});
  const handleSelectionChange = React.useCallback((selection: Record<string, boolean>) => {
    rowSelectionRef.current = selection;
  }, []);

  const filteredRows = React.useMemo(
    () => getFilteredRows(filters),
    [getFilteredRows, filters]
  );

  const totals = React.useMemo(
    () => uom === 'MBF' ? getTotalsMBF(filteredRows) : getTotals(filteredRows),
    [getTotals, getTotalsMBF, filteredRows, uom]
  );

  const filterOptions = React.useMemo(() => {
    const opts = getFilterOptions(allRows, filters);
    const uniquePOs = isMTL ? (meta?.uniquePOs ?? []) : [];
    if (uniquePOs.length) {
      opts['po'] = uniquePOs.map((po) => ({ value: po, label: po }));
    }
    return opts;
  }, [getFilterOptions, allRows, filters, isMTL, meta?.uniquePOs]);

  const activeFilters = React.useMemo(() => ({
    location: filters.location || [],
    item: filters.item || [],
    species: filters.species || [],
    thickness: filters.thickness || [],
    width: filters.width || [],
    length: filters.length || [],
    grade: filters.grade || [],
  }), [filters]);

  const [resetKey, setResetKey] = React.useState(0);

  const handleReset = React.useCallback(() => {
    setFilters(defaultFilters);
    setResetKey(k => k + 1);
  }, []);

  const [filterOpenTrigger, setFilterOpenTrigger] = React.useState(0);

  /**
   * ARCH's two tabs, per the client prototype: Hardwood and Open Sales Orders.
   *
   * Held here rather than inside ArchScreen because the tab strip is rendered in
   * this shell, but ArchScreen stays MOUNTED across both tabs so the cart and any
   * half-built order survive a trip to the orders list and back.
   */
  const [archTab, setArchTab] = React.useState<'inventory' | 'orders'>('inventory');

  const handleCellFilter = React.useCallback((filterKey: string, value: string) => {
    setFilters(prev => {
      const current = (prev[filterKey as keyof FilterState] as string[]) || [];
      const newValues = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return {
        ...prev,
        [filterKey]: newValues,
        ...(filterKey === 'location' && { reload: newValues }),
      };
    });
    setFilterOpenTrigger(k => k + 1);
  }, []);

  const handleDrillDown = React.useCallback(
    (type: DetailType, row: SummaryRow) => {
      if (row.internalId && row.locationId) {
        setDetailParams({
          itemId: row.internalId,
          locationId: row.locationId,
          type,
          row,
        });
        setDetailOpen(true);
      }
    },
    []
  );

  const handleExport = React.useCallback(() => {
    const selection = rowSelectionRef.current;
    const selectedKeys = Object.keys(selection).filter(k => selection[k]);
    const exportFn = isMTL ? exportToExcelMTL : exportToExcel;
    if (selectedKeys.length > 0) {
      const selectedRows = filteredRows.filter(r => {
        const key = r.detailKey || `${r.internalId}-${r.locationId}`;
        return selectedKeys.includes(key);
      });
      exportFn(selectedRows, getTotals(selectedRows), uom);
    } else {
      exportFn(filteredRows, isMTL ? getTotals(filteredRows) : totals, uom);
    }
  }, [filteredRows, totals, getTotals, uom, isMTL]);

  const displayError = error || refreshError;

  const today = typeof window !== 'undefined' ? new Date().toLocaleDateString('en-CA', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const uomOptions = uomOptionsFor(activeView);

  return (
    <div
      ref={rootRef}
      className="flex flex-col text-foreground overflow-hidden"
      style={{
        background: 'var(--background)',
        height: isFullscreen ? '100vh' : appHeight ? `${appHeight}px` : '100vh',
      }}
    >
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
              onClick={() => {
                setActiveView(view);
                setFilters(defaultFilters);
                setDetailOpen(false);
                setPriceListOpen(false);
              }}
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
            <span className="text-white text-[10px] font-bold uppercase tracking-wider">UoM</span>
            <select
              value={uomOptions.includes(uom) ? uom : uomOptions[0]}
              onChange={(e) => setUom(e.target.value)}
              className="py-1 px-2.5 rounded-md text-[#0D1F33] text-xs font-semibold cursor-pointer outline-none border border-[#CBD5E1] bg-white hover:bg-[#EDF1F7]"
            >
              {uomOptions.map((o) => (
                <option key={o} value={o} className="bg-white text-[#0D1F33]">{o}</option>
              ))}
            </select>
          </div>
          <div className="w-px h-5 bg-white/15" />
          <span className="text-white text-[11px]">{today}</span>
          {/* ARCH runs on local demo data — say so, and never show the IND/MTL
              cache timestamp next to it (meta persists from the previous view). */}
          {isARCH && ARCH_IS_DEMO_DATA && (
            <>
              <div className="w-px h-5 bg-white/15" />
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                style={{ background: 'rgba(200,160,53,0.30)', color: '#FFFFFF' }}
                title="CWP ARCH has no data in NetSuite yet — this screen is running on local demo data"
              >
                Demo data
              </span>
            </>
          )}
          {!isARCH && meta?.lastUpdated && (() => {
            const badgeState = getLastUpdatedBadgeState(meta.lastUpdated);
            const badgeColor = badgeState === 'ok' ? 'rgba(76,175,80,0.25)' : badgeState === 'stale' ? 'rgba(255,183,77,0.25)' : 'rgba(239,83,80,0.25)';
            const textColor = '#FFFFFF';
            return (
              <>
                <div className="w-px h-5 bg-white/15" />
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background: badgeColor, color: textColor }}
                >
                  Updated {formatLastUpdated(meta.lastUpdated)}
                </span>
              </>
            );
          })()}
          <div className="w-px h-5 bg-white/15" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void doRefresh()}
            // No cache behind ARCH — refreshing would fire a summary request with
            // no subsidiary id.
            disabled={isARCH || refreshState === 'checking' || refreshState === 'fetching'}
            title={isARCH ? 'Not applicable — CWP ARCH is running on demo data' : 'Refresh'}
            className="h-8 w-8 text-white hover:bg-white/10 disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${(refreshState === 'checking' || refreshState === 'fetching') ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="h-8 w-8 text-white hover:bg-white/10"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-0.5 px-6 flex-shrink-0" style={{ background: 'var(--navy-mid)', paddingTop: 0, paddingBottom: 0 }}>
        {isARCH ? (
          ([
            ['inventory', 'Hardwood'],
            ['orders', 'Open Sales Orders'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setArchTab(key)}
              className="px-4 py-2 text-xs font-semibold rounded-t-md transition-all"
              // Fixed hex, not var(--navy) on var(--background). Those two are
              // BOTH dark in dark mode, so the active tab's label disappeared —
              // the pre-existing single tab had the same latent bug.
              style={
                archTab === key
                  ? { background: '#EEF1F6', color: '#0F2641' }
                  : { background: 'transparent', color: 'rgba(255,255,255,0.72)' }
              }
            >
              {label}
            </button>
          ))
        ) : (
          <button
            type="button"
            className="px-4 py-2 text-xs font-semibold rounded-t-md transition-all text-[var(--navy)]"
            style={{ background: 'var(--background)' }}
          >
            Inventory
          </button>
        )}
      </div>

      {/* New version banner — cache-driven, so not applicable to ARCH */}
      {!isARCH && newVersionAvailable && (
        <div className="flex items-center justify-between bg-green/10 text-green px-4 py-2 text-sm border-b border-green/20 flex-shrink-0">
          <span>New data available.</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { dismissBanner(); void doRefresh(true); }} className="bg-green text-white hover:bg-green/90 text-xs">
              Load now
            </Button>
            <Button size="sm" variant="outline" onClick={dismissBanner} className="text-xs">
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* CWP ARCH owns its own data hook, grid, detail modal and export — see
          components/ArchScreen.tsx. Keeping it behind one branch leaves the
          IND/MTL render path below completely untouched. */}
      {isARCH ? (
        <ArchScreen uom={uom} tab={archTab} />
      ) : (
      <>
      {/* Filters */}
      <div className="px-4 pt-3 flex-shrink-0">
        <FilterPanel
          filters={filters}
          onFiltersChange={setFilters}
          onReset={handleReset}
          onExport={handleExport}
          filterOptions={filterOptions}
          exportDisabled={!allRows}
          onPriceList={isMTL ? handlePriceList : undefined}
          activeView={activeView}
          openTrigger={filterOpenTrigger}
        />
      </div>

      {/* Error display */}
      {displayError && (
        <div className="px-4 pt-2 flex-shrink-0">
          <p className="text-destructive text-sm bg-destructive/10 px-3 py-2 rounded">{displayError}</p>
        </div>
      )}

      {/* Main table area — POC: bg #EEF1F6, loading "Chargement…" with circular spinner */}
      <main className="flex-1 flex flex-col px-4 pt-3 pb-2 min-h-0">
        <div className="relative flex-1 flex flex-col min-h-0">
          {loading && !allRows && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center z-10 rounded backdrop-blur-sm"
              style={{ background: 'rgba(238,241,246,0.88)' }}
            >
              <div
                className="w-11 h-11 rounded-full border-4 border-[#CBD5E1] border-t-[var(--green)] animate-spin"
              />
              <div className="mt-3 text-[13px] font-medium text-[#3D5166]">Loading…</div>
            </div>
          )}
          {allRows ? (
            isMTL ? (
              <InventoryTableMTL
                data={filteredRows}
                onDrillDown={handleDrillDown}
                onCellFilter={handleCellFilter}
                activeFilters={activeFilters}
                resetKey={resetKey}
                totals={totals}
                rowCount={filteredRows.length}
                uom={uom}
              />
            ) : (
              <InventoryTable
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
            )
          ) : !loading ? (
            <p className="py-12 text-center text-sm text-[#3D5166]">
              Loading inventory data…
            </p>
          ) : null}
        </div>
      </main>

      {/* Detail drawer */}
      {detailParams && (
        isMTL ? (
          <DetailDrawerMTL
            open={detailOpen}
            onOpenChange={setDetailOpen}
            type={detailParams.type}
            row={detailParams.row}
            resetCacheVersion={meta?.cacheVersion ?? null}
            uom={uom}
            subsidiaryId={effectiveSubsidiaryId}
          />
        ) : (
          <DetailDrawer
            open={detailOpen}
            onOpenChange={setDetailOpen}
            itemId={detailParams.itemId}
            locationId={detailParams.locationId}
            triggerType={detailParams.type}
            row={detailParams.row}
            resetCacheVersion={meta?.cacheVersion ?? null}
            uom={uom}
          />
        )
      )}
      {isMTL && (
        <PriceListModal
          open={priceListOpen}
          onOpenChange={setPriceListOpen}
          rows={filteredRows}
        />
      )}
      </>
      )}
    </div>
  );
}

/**
 * Which screen this Suitelet renders.
 *
 * The warehouse split queue is deliberately NOT part of the trader screen —
 * "le gars dans l'entrepôt, on veut pas nécessairement qu'il ait le trader
 * screen, mais qu'il ait juste l'écran ici". Access is enforced by deploying it
 * as its own Suitelet with its own role, and that Suitelet sets
 * MCGI_CONFIG.screen = 'warehouse'.
 *
 * The two screens share one bundle for now. If the client wants warehouse users
 * not to receive the trader code at all, split the Vite build into two entry
 * points — the component boundary here is already clean enough for that.
 */
const getScreen = (): string => {
  const win = typeof window !== 'undefined' ? window : null;
  return (win as { MCGI_CONFIG?: { screen?: string } })?.MCGI_CONFIG?.screen || 'trader';
};

function App() {
  const screen = getScreen();
  if (screen === 'warehouse') {
    // No NetSuiteProvider: this screen needs no subsidiary context or UoM config,
    // and it must not depend on trader-screen data access.
    return (
      <ThemeProvider>
        <WarehouseSplitScreen />
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider>
      <NetSuiteProvider>
        <TraderScreenContent />
      </NetSuiteProvider>
    </ThemeProvider>
  );
}

export default App;
