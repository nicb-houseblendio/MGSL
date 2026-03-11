/**
 * Saved Search: customsearch_mgsl_trader_onorder
 * Purpose: Detail search for On Order (PO) transactions per item x location.
 *          Used in Map/Reduce reduce stage to build TS_DETAIL cache.
 *
 * Referenced by: mcgi_mr_trader_screen_cache.js (ON_ORDER_SEARCH_ID)
 *
 * Expected columns (per SDD v1.3 §3.5.4):
 *   tranid summary:GROUP (docNum), entity summary:GROUP (vendorName),
 *   entityid join vendor, duedate/shipdate summary:GROUP,
 *   itemid join item summary:GROUP (itemCode), custcol_mgsl_packqty summary:GROUP (packQty),
 *   rate summary:MAX,
 *   FORMULA columns: "Open Quantity", "Price"
 *
 * Last updated: <PASTE DATE HERE>
 * Exported from NetSuite via: Lists > Search > Saved Searches > Export as Script
 *
 * ──────────────────────────────────────────────────────────────────
 * PASTE EXPORTED SCRIPT BELOW THIS LINE
 * ──────────────────────────────────────────────────────────────────
 */
