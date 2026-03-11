 into# MGSL Trader Screen — Architecture Summary

## Overview
A NetSuite-embedded React application that displays real-time lumber inventory across CWP subsidiaries (IND, MTL, ARCH). Data is pre-computed on a schedule and served from N/cache — zero search governance on page load. Traders can view summary inventory, drill into transaction details, filter across 12 dimensions, and create PO/SO orders directly from the screen.

---

## Scripts

| Script | Type | Purpose |
|--------|------|---------|
| `mcgi_mr_trader_screen_cache.js` | Map/Reduce (Scheduled) | Runs every 15 min. Loads item data from 6 saved searches, computes summary + detail rows per item x location, writes to N/cache. Supports full rebuild and incremental delta modes. Filters by subsidiary. |
| `mcgi_rl_trader_api.js` | RESTlet | Thin router. Receives GET/POST requests from the React app, delegates to the service layer. Exposes actions: `getContext`, `meta`, `summary`, `detail`, `createOrder`. |
| `trader_screen_service.js` | Service Module | Core business logic — reads from cache, applies server-side filters, computes totals, handles PO/SO creation, returns structured JSON responses. |
| `trader_screen_service_factory.js` | Factory Module | Instantiates the service for the RESTlet. |
| `mcgi_sl_trader_screen_react.js` | Suitelet | Serves the HTML shell page. Injects `bundle.js`, `bundle.css`, and a config object (RESTlet URL, user info, subsidiary) into the page. No data fetching — purely a delivery mechanism. |
| `cacheKeys.js` | Shared Module | Centralized cache key constants and builders (TS_META, TS_SUMMARY, TS_DETAIL, chunking keys). Single source of truth for all cache key formats. |
| `cacheClient.js` | Shared Module | N/cache wrapper — creates/retrieves the shared PUBLIC cache with scope accessible across all scripts. |
| `urlResolver.js` | Shared Module | Builds NetSuite record URLs (`url.resolveRecord`) for clickable links in the UI (items, locations, vendors, customers, transactions). |

---

## Saved Searches (NetSuite Configuration)

These 6 saved searches are the data sources for the Map/Reduce script. They are configured in NetSuite (not in code) and referenced by script ID.

| Search ID | Purpose | Used In |
|-----------|---------|---------|
| `customsearch_suitelet_all_items_search` | Main item data — grouped by item x location. Returns all item attributes (species, thickness, width, length, grade, etc.), quantity formulas (on-hand, committed, outbound, on-order, in-transit, available), and location info. | getInputData (summary rows) |
| `customsearch_mgsl_trader_onhand_tran` | On-hand transaction detail — item receipts, inventory adjustments, credit memos per item x location. | reduce (detail: onHand) |
| `customsearch_mgsl_trader_committed` | Committed transaction detail — open sales orders with pack committed and open pack quantity. | reduce (detail: committed) |
| `customsearch_mgsl_trader_outbound` | Outbound transaction detail — sales orders with invoiced and remaining quantities. | reduce (detail: outbound) |
| `customsearch_mgsl_trader_onorder` | On-order transaction detail — open purchase orders with open quantity and pricing. | reduce (detail: onOrder) |
| `customsearch_mgsl_trader_intransit` | In-transit transaction detail — POs/TOs that are billed but not yet received. | reduce (detail: inTransit) |

The main item search uses complex SQL formula columns to compute inventory quantities (on-hand, committed, etc.) directly in the search, avoiding the need for multiple API calls per item.

---

## Data Flow

```
Saved Searches (6)  -->  Map/Reduce (every 15 min)  -->  N/cache
                                                            |
React App (browser)  <--  RESTlet + Service  <-----------  N/cache
```

1. **Map/Reduce** runs on schedule, loads the main item search, builds a summary row per item x location pair, then for each pair runs 5 detail searches (on-hand, committed, outbound, on-order, in-transit). All results written to N/cache.
2. **Suitelet** serves the React app as a single HTML page with injected configuration.
3. **React app** calls the RESTlet on load (`action=summary`) to fetch all cached summary rows in one request.
4. **Filtering** is 100% client-side — all rows loaded once, 12 filter dropdowns narrow in the browser instantly.
5. **Detail drill-down** — clicking a quantity cell calls the RESTlet (`action=detail`) for that item x location's transaction-level data.
6. **Create Order** — user can create a PO or SO directly from the UI, which calls `action=createOrder` via POST to the RESTlet.

---

## Map/Reduce Logic

### Stages

| Stage | What It Does |
|-------|-------------|
| **getInputData** | Loads the main item search filtered by subsidiary. In full mode, processes all results. In delta mode, finds recently changed item x location pairs from transaction history and only reprocesses those. |
| **map** | Pass-through — validates and forwards each key (itemId__locationId) with its summary row JSON. |
| **reduce** | For each item x location pair: runs 5 detail searches, writes detail payload to cache, writes summary chunk to cache. |
| **summarize** | Collects all summary chunks, merges with existing summary (for delta), writes final TS_SUMMARY (chunked if >450KB), TS_META, and TS_LAST_RUN_TIMESTAMP. |

### Full Rebuild vs Delta Mode

- **Full rebuild**: Processes all item x location pairs from the saved search. Triggered when `forceFull=true` (script parameter) or no previous run timestamp exists.
- **Delta mode**: Queries recent transactions (PO, SO, IR, IF, IA, TO) modified since last run to find changed item x location pairs. Only those pairs are reprocessed. Falls back to full rebuild if delta pairs exceed threshold (default 500) or if none found.
- **Merge logic**: In delta mode, new rows are merged with existing cached summary — updated pairs overwrite, unchanged pairs preserved.

### Subsidiary Filtering

Each MR deployment runs for a single subsidiary (script parameter `custscript_ts_subsidiary_id`). The subsidiary filter is applied to the saved search in all code paths (full, delta, delta fallback). Each CWP subsidiary (IND=7, MTL=5, ARCH=9) needs its own deployment.

---

## RESTlet API Endpoints

All requests go through a single RESTlet URL. The `action` parameter determines the handler.

### GET Actions

| Action | Parameters | Returns |
|--------|-----------|---------|
| `getContext` | (none) | User info, subsidiary, account ID, UOM config |
| `meta` | (none) | Cache availability, version, last updated, row count |
| `summary` | Optional filters (location, item, species, thickness, etc.) | Filtered summary rows, totals, meta |
| `detail` | `itemId`, `locationId`, optional `bucket` | Transaction-level detail (onHand, committed, outbound, onOrder, inTransit) |

### POST Actions

| Action | Parameters | Returns |
|--------|-----------|---------|
| `createOrder` | `type` (PO/SO), `itemId`, `locationId`, `partyId`, `quantity`, `date`, `notes` | `docId`, `docNum`, `docUrl` on success |

---

## Summary Row Schema (TS_SUMMARY)

Each row in the summary cache represents one item at one location:

| Field | Source | Description |
|-------|--------|-------------|
| `internalId` | `internalid MAX` | Item internal ID |
| `locationId` | `inventorylocation GROUP` | Location internal ID |
| `locationName` | `inventorylocation GROUP (text)` | Location display name |
| `locationUrl` | `url.resolveRecord` | Clickable link to location record |
| `isReload` | `custrecord_is_reload` join `inventoryLocation` | Whether location is a reload point |
| `itemType` | `type MAX` | Item type (InvtPart, Assembly, etc.) |
| `itemCode` | `itemid GROUP` | Item code identifier |
| `itemName` | `salesdescription GROUP` | Item description |
| `itemUrl` | `url.resolveRecord` | Clickable link to item record |
| `species` | `custitem_species GROUP` | Species (e.g., Maple, Oak) |
| `thickness` | `custitem_mgsl_thickness GROUP` | Thickness |
| `width` | `custitem_mgsl_width GROUP` | Width |
| `length` | `custitem_mgsl_length GROUP` | Length |
| `grade` | `custitem_grade GROUP` | Grade |
| `finition` | `custitem_finition GROUP` | Finishing |
| `humidity` | `custitem_humidity GROUP` | Humidity |
| `plannage` | `custitem_plannage GROUP` | Planing |
| `etampage` | `custitem_etampage GROUP` | Stamping |
| `autres` | `custitem_autres GROUP` | Other attributes |
| `quantityFBM` | `locationquantityonhand GROUP` | Native FBM quantity |
| `onHand` | Formula column | Packs on hand |
| `committed` | Formula column | Packs committed to sales orders |
| `outbound` | Formula column | Packs outbound (billed, not shipped) |
| `onOrder` | Formula column | Packs on order from purchase orders |
| `inTransit` | Formula column | Packs in transit |
| `available` | Formula column | Available = onHand - committed - outbound + onOrder + inTransit |
| `averageCost` | `locationaveragecost GROUP` | Average cost per pack |

---

## Detail Row Schemas (TS_DETAIL)

Each detail payload contains 5 arrays of transaction rows:

### On Hand
`docType`, `docNum`, `docUrl`, `receiptDate`, `vendor`, `vendorUrl`, `lotNo`, `packQty`, `avgPrice`

### Committed
`docNum`, `docUrl`, `customerName`, `customerUrl`, `tranDate`, `expectedShipDate`, `itemCode`, `itemUrl`, `packCommitted`, `openPackQty`, `rate`, `pricePerPiece`

### Outbound
`docNum`, `docUrl`, `customerName`, `customerUrl`, `dueDate`, `itemCode`, `itemUrl`, `packQty`, `invoicedQty`, `remainingQty`, `rate`

### On Order
`docNum`, `docUrl`, `vendorName`, `vendorUrl`, `shipDate`, `itemCode`, `itemUrl`, `packQty`, `openQty`, `rate`

### In Transit
`docNum`, `docUrl`, `tranDate`, `vendor`, `vendorUrl`, `itemCode`, `itemUrl`, `packQty`, `inTransitAdditional`, `rate`

---

## Cache Strategy

| Key | Content | TTL |
|-----|---------|-----|
| `TS_META` | Version, last updated, row count, run mode, chunk count | 30 min |
| `TS_SUMMARY` | All summary rows as JSON array, or `{ chunked: true, chunkCount: N }` manifest if data exceeds 450KB | 30 min |
| `TS_SUMMARY_DATA__0`, `__1`, etc. | Summary row chunks when total exceeds 450KB single-key limit | 30 min |
| `TS_DETAIL__itemId__locationId` | Detail payload (5 arrays) per item x location | 30 min |
| `TS_DETAIL__itemId__locationId__bucket` | Individual detail bucket when payload exceeds 500KB | 30 min |
| `TS_LAST_RUN_TIMESTAMP` | ISO timestamp of last successful run (for delta mode) | 24 hr |
| `TS_SUMMARY_CHUNK__key` | Temporary per-reduce chunks (deleted after summarize) | 30 min |

N/cache limit: 512KB per key. The chunking strategy splits large payloads across multiple keys and reassembles on read.

---

## Script Deployments

| Deployment ID | Script | Subsidiary | Schedule |
|--------------|--------|-----------|----------|
| `customdeploy_mcgi_mr_trader_cache_sched` | Map/Reduce | CWP IND (7) | Every 15 min |
| `customdeploy_mcgi_rl_traderapi` | RESTlet | All | On demand |
| `customscriptmcgi_sl_trader_screen_react` | Suitelet | All | On demand |

Additional MR deployments needed for CWP MTL (subsidiary=5) and CWP ARCH (subsidiary=9) — each with its own `custscript_ts_subsidiary_id` parameter.

---

## Frontend (React 18 + Vite)

- Built as a single IIFE bundle (`bundle.js` + `bundle.css`) deployed to File Cabinet
- TanStack Table for the data grid (sorting, row selection)
- Tailwind CSS + Radix UI + shadcn components
- CWP view pills in the header (IND / MTL / ARCH)
- Filter panel with 12 multi-select dropdowns — options narrow dynamically based on active filters (cross-filtering)
- Detail drawer for drill-down into on-hand, committed, outbound, on-order, in-transit
- Refresh state machine with background meta polling every 5 minutes
- Create PO/SO modal triggered from the UI
- Export to Excel functionality
- Light/dark theme support

---

## Bugs Fixed (March 2026)

| ID | Issue | Fix |
|----|-------|-----|
| GAP-MR-04/05 | Item attribute columns (species, thickness, width, length, grade, etc.) showing blank | Added `summary: 'GROUP'` to all `getText` calls to match saved search definition. Added `getValue` fallback for free-text fields. Replaced fragile column-scanning for width/length with direct field references. |
| GAP-MR-01 | Subsidiary filter commented out — MR returning all subsidiaries | Uncommented and applied subsidiary filter in all 4 code paths (full, delta, delta fallback, invalid timestamp fallback). |
| GAP-MR-02 | `forceFull` defaulting to `true` — delta mode never engaging | Changed default from `true` to `false`. |
| GAP-SVC-01 | `const` reassignment in `handleGetSummary` — crashes on non-array cache data | Replaced with separate parse + conditional assignment. |
| GAP-SVC-03 | `docNum` always null after PO/SO creation — `getValue` on stale record after `save()` | Added `record.load()` after save to read `tranid` from the saved record. |
| GAP-SL-01 | Suitelet using `log.debug()` without importing `N/log` — `ReferenceError` at runtime | Added `N/log` to `define()` imports. |
| Cache 512KB | Summary data (777 rows, ~505KB) exceeding N/cache 512KB per-key limit | Implemented chunked summary storage — splits across multiple keys with manifest, reassembles on read. |
| Filter options | Filter dropdowns showing all options regardless of active filters | Changed `getFilterOptions` to derive options from cross-filtered rows (each filter excludes its own selection). |
| isReload | `isReload` hardcoded to `false` despite saved search providing the field | Now reads `custrecord_is_reload` from the search result. |
