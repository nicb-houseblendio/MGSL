/**
 * Saved Search: customsearch_mgsl_trader_onhand_tran
 * Purpose: Detail search for On Hand transactions per item x location.
 *          Used in Map/Reduce reduce stage to build TS_DETAIL cache.
 *
 * Referenced by: mcgi_mr_trader_screen_cache.js (ON_HAND_SEARCH_ID)
 *
 * Expected columns (per SDD v1.3 §3.5.1):
 *   type, tranid (docNum), trandate (receiptDate), mainname (vendor),
 *   serialnumber/inventorynumber (lotNo), locationaveragecost (avgPrice),
 *   FORMULA column with label for pack quantity
 *
 * Last updated: <PASTE DATE HERE>
 * Exported from NetSuite via: Lists > Search > Saved Searches > Export as Script
 *
 * ──────────────────────────────────────────────────────────────────
 * PASTE EXPORTED SCRIPT BELOW THIS LINE
 * ──────────────────────────────────────────────────────────────────
 */
