/**
 * Saved Search: customsearch_mgsl_trader_outbound
 * Purpose: Detail search for Outbound transactions per item x location.
 *          Used in Map/Reduce reduce stage to build TS_DETAIL cache.
 *
 * Referenced by: mcgi_mr_trader_screen_cache.js (OUTBOUND_SEARCH_ID)
 *
 * Expected columns (per SDD v1.3 §3.5.3):
 *   tranid (docNum), entity (customerName), duedate/shipdate,
 *   itemid join item (itemCode), custcol_mgsl_packqty (packQty), rate,
 *   FORMULA columns: "Invoiced Quantity", "Remaining Quantity"
 *
 * Last updated: <PASTE DATE HERE>
 * Exported from NetSuite via: Lists > Search > Saved Searches > Export as Script
 *
 * ──────────────────────────────────────────────────────────────────
 * PASTE EXPORTED SCRIPT BELOW THIS LINE
 * ──────────────────────────────────────────────────────────────────
 */
