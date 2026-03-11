/**
 * Saved Search: customsearch_mgsl_trader_intransit
 * Purpose: Detail search for In Transit transactions per item x location.
 *          Used in Map/Reduce reduce stage to build TS_DETAIL cache.
 *
 * Referenced by: mcgi_mr_trader_screen_cache.js (IN_TRANSIT_SEARCH_ID)
 *
 * Expected columns (per SDD v1.3 §3.5.5):
 *   type (docType), tranid (docNum), trandate, mainname (vendor),
 *   itemid join item (itemCode), custcol_mgsl_packqty (packQty), rate,
 *   FORMULA column: "In Transit *Additional" / "In Transit * Additional"
 *
 * Last updated: <PASTE DATE HERE>
 * Exported from NetSuite via: Lists > Search > Saved Searches > Export as Script
 *
 * ──────────────────────────────────────────────────────────────────
 * PASTE EXPORTED SCRIPT BELOW THIS LINE
 * ──────────────────────────────────────────────────────────────────
 */
