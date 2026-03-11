/**
 * Saved Search: customsearch_mgsl_trader_committed
 * Purpose: Detail search for Committed transactions per item x location.
 *          Used in Map/Reduce reduce stage to build TS_DETAIL cache.
 *
 * Referenced by: mcgi_mr_trader_screen_cache.js (COMMITTED_SEARCH_ID)
 *
 * Expected columns (per SDD v1.3 §3.5.2):
 *   tranid (docNum), entity (customerName), trandate, custbody_ship_week (expectedShipDate),
 *   itemid join item (itemCode), rate, custcol_prixpiece (pricePerPiece),
 *   FORMULA columns: "Pack Committed", "Open Pack Quantity"
 *
 * Last updated: <PASTE DATE HERE>
 * Exported from NetSuite via: Lists > Search > Saved Searches > Export as Script
 *
 * ──────────────────────────────────────────────────────────────────
 * PASTE EXPORTED SCRIPT BELOW THIS LINE
 * ──────────────────────────────────────────────────────────────────
 */
