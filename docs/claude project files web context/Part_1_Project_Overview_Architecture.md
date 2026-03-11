# MGSL Trader Screen — Part 1: Project Overview & Architecture

> **Purpose of this document:** This is Part 1 of a multi-part context package for Claude AI. It provides the high-level project overview, architecture, file map, tech stack, and deployment details. Feed this to Claude first before other parts.

---

## 1. Project Identity

| Field | Value |
|---|---|
| Project Name | MGSL Trader Screen — Phase 1 |
| Client | CWP Industriel Inc. (MGSL — McGill Steel Group Limited) |
| Phase Scope | CWP Industriel Inc. (single subsidiary, internal ID = 7) only |
| Platform | NetSuite (SuiteScript 2.1) + React 18 |
| Status | Active development on `dev` branch, proof-of-concept stage |
| Repository | `D:\HouseBlend\Clients\MGSL\Implementation` |

**What it does:** The Trader Screen gives lumber/commodity traders a real-time view of inventory positions (on hand, committed, outbound, on order, in transit, available) per item x location. Traders can drill into transaction-level detail, create Purchase Orders / Sales Orders, filter by product attributes, and export to Excel.

---

## 2. Architecture

### 2.1 Component Overview

```
Map/Reduce (scheduled every 15 min)
    |
    | Writes pre-computed JSON to N/cache
    v
N/cache (MGSL_TRADERSCREEN_CACHE, PUBLIC scope)
    |
    | Read by RESTlet (zero searches)
    v
RESTlet (GET meta/summary/detail, POST createOrder)
    |
    | JSON over HTTP (NetSuite session cookie auth)
    v
React 18 App (served by Suitelet HTML shell)
    |
    | Client-side filtering, sorting, UOM conversion
    v
Trader's Browser
```

### 2.2 Component Table

| Component | Script Type | Script ID | Purpose |
|---|---|---|---|
| Cache Builder | Map/Reduce | `customscript_mcgi_mr_trader_cache` | Runs every 15 min. Executes inventory searches, serializes to JSON, writes to N/cache. Full rebuild + delta modes. |
| Data API | RESTlet | `customscript_mcgi_rl_traderapi` | GET: reads from N/cache, returns JSON. POST: creates PO/SO records. Zero search governance on GET. |
| HTML Shell | Suitelet | `customscriptmcgi_sl_trader_screen_react` | Outputs minimal HTML page that bootstraps React. Injects `window.MCGI_CONFIG` with restletUrl, user context, subsidiary info. Zero searches. |
| React App | Vite bundle (IIFE) | N/A | Client-side inventory grid with filtering, sorting, drill-down modals, UOM conversion, order creation. |

### 2.3 Data Flow (Step by Step)

1. **Map/Reduce runs on schedule.** Loads `customsearch_suitelet_all_items_search` (item summary) + 5 detail searches (onHand, committed, outbound, onOrder, inTransit). Writes `TS_SUMMARY`, `TS_DETAIL__{itemId}__{locationId}`, `TS_META`, `TS_LAST_RUN_TIMESTAMP` to N/cache.
2. **Trader opens Suitelet URL.** HTML shell loads instantly (zero searches). Injects `window.MCGI_CONFIG` with RESTlet URL and user context.
3. **React mounts.** Calls `GET ?action=summary` to RESTlet. RESTlet reads `TS_SUMMARY` from cache, applies server-side filters if provided, computes totals, returns JSON.
4. **React renders grid.** All subsequent filtering, sorting, UOM conversion happen client-side with no further API calls.
5. **Trader clicks quantity cell.** React calls `GET ?action=detail&itemId=X&locationId=Y`. RESTlet reads `TS_DETAIL__X__Y` from cache. Detail drawer opens with tabbed transaction data.
6. **Trader creates PO/SO.** React POSTs to `?action=createOrder`. RESTlet creates record via `record.create()`, returns `{ docId, docNum, docUrl }`.

### 2.4 Core Invariants

These rules are non-negotiable and must never be violated:

- **No searches in RESTlet GET** — all data comes from N/cache reads only
- **No searches in Suitelet** — HTML write + config injection only
- **All heavy computation in Map/Reduce** — searches, URL resolution, data assembly
- **Client-side filtering only** — React applies filters to loaded data, no API calls
- **Client-side UOM conversion** — config-driven per CWP view
- **URLs pre-resolved server-side** — Map/Reduce calls `url.resolveRecord()`, React uses them as `href` directly
- **Quantities stored in Packs** — conversion to other UOM happens only on the client

---

## 3. Cache Contract Summary

| Cache Key | TTL | Written By | Read By | Contains |
|---|---|---|---|---|
| `TS_META` | 1800s | MR summarize | RESTlet, React | `{ cacheVersion, lastUpdated, rowCount, lastRunMode, deltaCount, lastRunTimestamp }` |
| `TS_SUMMARY` | 1800s | MR summarize | RESTlet | JSON array of all summary rows (item x location grid data) |
| `TS_DETAIL__{itemId}__{locationId}` | 1800s | MR reduce | RESTlet | `{ onHand: [], committed: [], outbound: [], onOrder: [], inTransit: [] }` |
| `TS_LAST_RUN_TIMESTAMP` | 86400s | MR summarize | MR getInputData | ISO 8601 string for delta window |
| `TS_SUMMARY_CHUNK__{key}` | 1800s | MR reduce | MR summarize | Temporary reduce chunks (deleted after merge) |

Cache name: `MGSL_TRADERSCREEN_CACHE`, scope: `PUBLIC`
Max value size: **500 KB per key** (detail payloads auto-split by bucket if exceeded)

---

## 4. Saved Search IDs

| Search ID | Used By | Purpose |
|---|---|---|
| `customsearch_suitelet_all_items_search` | MR getInputData | Main item inventory summary (all attributes + quantity formulas) |
| `customsearch_mgsl_trader_onhand_tran` | MR reduce | On-hand transaction detail (receipts, adjustments) |
| `customsearch_mgsl_trader_committed` | MR reduce | Committed inventory (SO lines) |
| `customsearch_mgsl_trader_outbound` | MR reduce | Outbound fulfillments |
| `customsearch_mgsl_trader_onorder` | MR reduce | On-order PO lines |
| `customsearch_mgsl_trader_intransit` | MR reduce | In-transit shipments |

**Note:** The SDD references `customsearch_mgsl_trader_onhand` but the code uses `customsearch_mgsl_trader_onhand_tran`. This needs verification.

---

## 5. Script Parameters

| Parameter | Type | Used By | Purpose | Current Default |
|---|---|---|---|---|
| `custscript_ts_subsidiary_id` | TEXT | Map/Reduce | CWP Industriel Inc. subsidiary internal ID | Set to `7` on deployment |
| `custscript_ts_force_full_rebuild` | CHECKBOX | Map/Reduce | Force full rebuild vs delta | Currently defaults to `true` in code (should be `false`) |
| `custscript_ts_delta_fallback_threshold` | INTEGER | Map/Reduce | Max delta pairs before fallback to full | 500 |
| `custscript_ts_uom_config_json` | TEXT (JSON) | RESTlet | UOM options per CWP view | Hardcoded defaults in service |

---

## 6. Complete File Structure

```
Implementation/
|-- .gitignore
|-- docs/
|   |-- MGSL_TraderScreen_Phase1_Master_LLM_Spec.md
|   |-- MGSL_TraderScreen_Phase1_Folder_Structure_Blueprint.md
|   |-- MGSL_TraderScreen_Phase1_Canonical_Cache_Contract.md
|   |-- MGSL_TraderScreen_Phase1_Canonical_Cache_Contract_FULL.md
|   |-- MGSL_TraderScreen_Phase1_Cursor_Implementation_Breakdown.md
|   |-- MGSL_TraderScreen_Phase1_Production_Readiness_Checklist.md
|   |-- MGSL_TraderScreen_Phase1_Test_Plan.md
|   |-- claude project files web context/
|       |-- Andrei - Lee Meeting 03_05_2026.txt
|       |-- Documentation/
|           |-- MGSL_TraderScreen_React_Requirements_v1.3.md
|           |-- MGSL_TraderScreen_React_Requirements_v1.3.md.pdf
|           |-- MGSL_TraderScreen_React_Requirements_v1.3 (1).docx
|
|-- src/                                          # NETSUITE SUITESCRIPT BACKEND
|   |-- manifest.xml                              # SuiteCloud project manifest
|   |-- deploy.xml                                # Deployment config
|   |-- FileCabinet/
|   |   |-- SuiteScripts/
|   |       |-- mcgi_services/
|   |       |   |-- trader_screen/
|   |       |       |-- entry_points/
|   |       |       |   |-- mr/
|   |       |       |   |   |-- mcgi_mr_trader_screen_cache.js      # Map/Reduce cache builder
|   |       |       |   |-- rl/
|   |       |       |   |   |-- mcgi_rl_trader_api.js               # RESTlet API gateway
|   |       |       |   |-- sl/
|   |       |       |       |-- mcgi_sl_trader_screen_react.js      # Suitelet HTML shell
|   |       |       |-- service/
|   |       |       |   |-- trader_screen_service.js                # Business logic (handlers)
|   |       |       |   |-- trader_screen_service_factory.js        # Service factory
|   |       |       |-- shared/
|   |       |       |   |-- cacheClient.js                          # N/cache wrapper
|   |       |       |   |-- cacheKeys.js                            # Cache key constants + builders
|   |       |       |   |-- schemas.js                              # Cache schema contracts
|   |       |       |   |-- urlResolver.js                          # URL resolution wrapper
|   |       |       |-- react-app/
|   |       |           |-- dist/                                   # Built React bundle (deployed here)
|   |       |-- trader-screen/                    # LEGACY SCRIPTS (not currently deployed)
|   |           |-- MCGI_RL_TraderAPI.js           # Old monolithic RESTlet
|   |           |-- MCGI_SL_TraderScreen_React.js  # Old Suitelet
|   |           |-- MCGI_SSU_TraderScreen_v3.js    # Old monolithic Suitelet (50KB+)
|   |-- Objects/
|       |-- scripts/
|           |-- mr/customscript_mcgi_mr_trader_cache.xml
|           |-- rl/customscript_mcgi_rl_traderapi.xml
|           |-- sl/customscriptmcgi_sl_trader_screen_react.xml
|
|-- react-app/                                    # REACT 18 VITE APPLICATION
    |-- package.json
    |-- vite.config.ts                            # IIFE bundle output for Suitelet
    |-- tailwind.config.ts
    |-- tsconfig.json
    |-- postcss.config.js
    |-- index.html
    |-- src/
        |-- main.tsx                              # React root entry
        |-- App.tsx                               # Main app component
        |-- index.css                             # Global styles + design tokens
        |-- types/
        |   |-- index.ts                          # TypeScript interfaces
        |-- lib/
        |   |-- api.ts                            # RESTlet communication (GET/POST)
        |   |-- export.ts                         # Excel export utility
        |   |-- utils.ts                          # cn() class merge utility
        |-- config/
        |   |-- businessConfig.ts                 # Per-subsidiary filter/column config
        |-- context/
        |   |-- NetSuiteContext.tsx                # NS environment context provider
        |   |-- ThemeProvider.tsx                  # Light/dark theme provider
        |-- hooks/
        |   |-- useSummaryData.ts                 # Main inventory data fetch + client filtering
        |   |-- useDetailData.ts                  # Detail drill-down fetch + cache
        |   |-- useFilterOptions.ts               # Compute filter options from loaded data
        |   |-- useInventoryData.ts               # Alternative inventory fetch (unused?)
        |   |-- useRefreshState.ts                # Refresh state machine + background polling
        |   |-- useSavedViews.ts                  # LocalStorage-backed saved filter views
        |-- components/
            |-- InventoryTable.tsx                 # Main data table (TanStack Table)
            |-- FilterPanel.tsx                    # Collapsible filter UI
            |-- DetailDrawer.tsx                   # Side drawer for drill-down detail
            |-- CreateOrderModal.tsx               # PO/SO creation dialog
            |-- OrderPopover.tsx                   # $ button popover (PO/SO choice)
            |-- MultiSelectCombobox.tsx            # Reusable multi-select combobox
            |-- ThemeToggle.tsx                    # Light/dark/system toggle
            |-- ui/                               # shadcn/Radix UI primitives
                |-- badge.tsx, button.tsx, checkbox.tsx, collapsible.tsx,
                |-- command.tsx, dialog.tsx, dropdown-menu.tsx, input.tsx,
                |-- popover.tsx, sheet.tsx, skeleton.tsx, table.tsx, tabs.tsx
```

---

## 7. Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| React | 18.3.1 | UI framework |
| Vite | 5.4.11 | Bundler (IIFE output for NetSuite) |
| TypeScript | ~5.6.2 | Type safety |
| TanStack Table | ^8.20.5 | Data grid with sorting |
| TanStack Virtual | ^3.13.2 | Row virtualization (imported but may not be active) |
| Tailwind CSS | ^3.4.15 | Utility-first styling |
| Radix UI | Various | Accessible UI primitives (dialog, popover, tabs, etc.) |
| Lucide React | ^0.460.0 | Icons |
| XLSX | ^0.18.5 | Excel export |
| cmdk | ^1.0.4 | Command/search component |

### Backend
| Technology | Purpose |
|---|---|
| SuiteScript 2.1 | NetSuite scripting API |
| N/search | Saved search execution |
| N/cache | In-memory cache (PUBLIC scope) |
| N/record | PO/SO creation |
| N/url | URL resolution |
| N/runtime | Script parameters, user context |
| N/log | Logging |

---

## 8. Build & Deploy

### React Build
```bash
cd react-app
npm run build          # TypeScript check + Vite build
npm run build:deploy   # Build + copy to FileCabinet path
npm run dev            # Local dev server
```

**Vite output config:** IIFE format, library name `MCGIReactSuitelet`, generates `bundle.js` + `bundle.css` deployed to `FileCabinet/SuiteScripts/mcgi_services/trader_screen/react-app/dist/`.

### NetSuite Deploy
```bash
suitecloud project:deploy
```
Deploys from `src/` — includes FileCabinet scripts + Objects (script definitions).

### Deployment Checklist
1. Build React app (`npm run build:deploy`)
2. Verify bundle in `src/FileCabinet/.../react-app/dist/`
3. `suitecloud project:deploy`
4. Set Map/Reduce deployment schedule (every 15 min)
5. Set `custscript_ts_subsidiary_id = 7` on MR deployment
6. Verify RESTlet deployment is RELEASED with correct audience
7. Verify Suitelet deployment status

---

## 9. Design Tokens (CSS Variables)

| Token | Light Value | Usage |
|---|---|---|
| `--navy` | `#0F2641` | Header bg, table header gradient |
| `--navy-mid` | `#1A3D63` | Header gradient end, tab bar bg |
| `--navy-light` | `#264A73` | Header gradient end |
| `--green` | `#1E6B47` | Available/OnHand accent, CWP pill active, Apply button |
| `--gold` | `#C8A035` | Sort indicator, footer border, Avg Price, $ button |
| `--background` | `#EEF1F6` | Page background |
| `--surface` | `#FFFFFF` | Table rows, cards |
| `--border` | `#CBD5E1` | All borders |
| `--text` | `#0D1F33` | Primary text |
| `--text-mid` | `#3D5166` | Secondary text |
| `--text-light` | `#7A8FA3` | Hints, sub-labels |
| `--row-hover` | `#F0F7F4` | Table row hover |
| `--row-alt` | `#F8FAFC` | Alternating row shade |
| `--metric-onhand` | `#2E7D32` | On Hand metric color |
| `--metric-committed` | `#E65100` | Committed metric color |
| `--metric-outbound` | `#AD1457` | Outbound metric color |
| `--metric-onorder` | `#1565C0` | On Order metric color |
| `--metric-intransit` | `#6A1B9A` | In Transit metric color |

Dark mode overrides exist for all tokens.

---

## 10. UOM Configuration

Default UOM config (hardcoded in both service and App.tsx):

```json
{
  "CWP IND": ["MBF", "Packs"],
  "CWP MTL": ["MBF", "Packs", "TL"],
  "CWP ARCH": ["MBF", "Cubic meters (m3)", "Packs"]
}
```

Can be overridden via `custscript_ts_uom_config_json` script parameter on the RESTlet deployment.

**IMPORTANT:** UOM conversion logic is NOT YET IMPLEMENTED in the React app. The selector exists but changing it has no effect on displayed quantities. Conversion factors (Packs to MBF, etc.) have not been confirmed by the business.

---

*End of Part 1. Next: Part 2 — Gap Analysis & Implementation Status*
