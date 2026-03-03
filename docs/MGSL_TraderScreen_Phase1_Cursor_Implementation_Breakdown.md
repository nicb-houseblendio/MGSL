# MGSL Trader Screen --- Phase 1 (CWP Industriel Inc.)

## Cursor-Ready Implementation Task Breakdown

------------------------------------------------------------------------

## 1. Baseline Setup

### Script Parameters

-   custscript_ts_subsidiary_id
-   custscript_ts_force_full_rebuild
-   custscript_ts_delta_fallback_threshold
-   custscript_ts_uom_config_json

No subsidiary IDs may be hardcoded.

------------------------------------------------------------------------

## 2. Shared Modules

Create reusable modules:

-   cacheKeys.js
-   cacheClient.js (PUBLIC scope, MGSL_TRADERSCREEN_CACHE)
-   urlResolver.js
-   schemas.js (TS_SUMMARY + TS_DETAIL contracts)

All cache key names must be centralized.

------------------------------------------------------------------------

## 3. Map/Reduce Script

### Modes

-   FULL → rebuild entire dataset
-   DELTA → process modified item×location pairs only
-   Fallback to FULL if delta threshold exceeded

### Responsibilities

-   Build TS_DETAIL\_\_{itemId}\_\_{locationId}
-   Build TS_SUMMARY
-   Write TS_META
-   Maintain TS_LAST_RUN_TIMESTAMP

Use runPaged() for all searches.

Measure detail payload size (warn \>450KB, split if \>500KB).

------------------------------------------------------------------------

## 4. RESTlet

### GET action=meta

Return TS_META only.

### GET action=summary

-   Read TS_SUMMARY
-   Apply filters client-side (pure JS)
-   Compute totals
-   Return rows + totals + meta
-   No searches allowed

### GET action=detail

-   Read TS_DETAIL key
-   Support bucket-only fetch

### POST

Create PO or SO: - Validate required fields - record.create() - Return
docId, docNum, docUrl

------------------------------------------------------------------------

## 5. Suitelet Shell

-   Raw HTML (no serverWidget form)
-   React 18 UMD
-   IBM Plex fonts
-   Inject window.\_\_NS_CONFIG\_\_ via url.resolveScript()

Zero searches in shell.

------------------------------------------------------------------------

## 6. React App

### State

-   rows
-   totals
-   meta
-   loadedCacheVersion
-   refreshState
-   detailCache (Map)

### Features

-   Client-side filtering
-   Client-side sorting
-   Sticky header/footer
-   Lazy detail modal loading
-   UOM conversion (config-driven)
-   Refresh state machine (meta-check first)

------------------------------------------------------------------------

## 7. Performance Targets

-   HTML load \< 500ms
-   Meta GET \< 200ms
-   Summary GET \< 3s
-   Detail GET \< 1s
-   Client filter/sort \< 100ms

------------------------------------------------------------------------

## 8. Governance Targets

-   Map/Reduce \< 10k units typical cycle
-   RESTlet GET \< 10 units
-   Suitelet shell 0 search units

------------------------------------------------------------------------

## 9. Production Checklist

-   Role-restricted RESTlet
-   Cache miss handling tested
-   Delta verified
-   Saved search IDs confirmed
-   UOM conversion confirmed
-   Old Suitelet retained during UAT

------------------------------------------------------------------------

End of Document
