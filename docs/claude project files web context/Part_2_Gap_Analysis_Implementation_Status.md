# MGSL Trader Screen — Part 2: Gap Analysis & Implementation Status

> **Purpose of this document:** This is the most critical part. It provides an exhaustive comparison of the SDD requirements (v1.3) against the current implementation, identifies every gap, bug, and missing feature, and includes context from the Andrei-Lee meeting on 2026-03-05. Feed this to Claude along with Part 1 for maximum context.

---

## 1. Meeting Context (Andrei & Lee — March 5, 2026)

Lee (senior dev/lead) walked through the deployed Trader Screen with Andrei and identified several issues. Key findings from the meeting transcript:

1. **Map/Reduce was set to run at noon instead of 12:00 AM** — corrected during meeting to every 15 minutes starting next day with subsidiary parameter = 7 and force full rebuild checked.

2. **Item attribute columns not showing** — thickness, width, length, grade, finition, humidity, plannage, etampage are not appearing in the trader screen despite being expected. Lee noted "I don't know why these are not showing up. Could be the columns." and "They don't have any grading or finish or humidity or planning in the data itself."

3. **Saved search needs additional fields** — The item search (`customsearch_suitelet_all_items_search`) may be missing columns for the item attribute fields. Lee mentioned needing to "run the this guy again to pick up the fields."

4. **PO/SO creation failing** — When attempting to create a PO, it failed silently with no script logs. Likely due to missing required fields (department, class, etc.) that aren't specified in the SDD. Lee: "either we have to add those requirements or we just make them not required."

5. **CWP view pills don't filter data** — Clicking CWP IND / CWP MTL / CWP ARCH changes the button state but the data doesn't change. Lee: "this now changed but the data didn't."

6. **Subsidiary filter was removed from Map/Reduce** — Andrei confirmed he removed the subsidiary filter from the item search because "I wasn't getting any results. So I was doing everything." The search currently returns ALL items across all subsidiaries.

7. **UoM selector purpose unclear** — Lee: "I don't know what the unit of measure is supposed to do."

8. **Multiple Map/Reduce deployments needed** — Lee clarified that each CWP subsidiary (IND=7, MTL=5, ARCH=9) needs its own MR deployment with its own subsidiary parameter. The CWP view pills should switch which cached dataset is displayed.

9. **Refresh button behavior** — Lee had difficulty getting fresh data to appear after running the MR script. The refresh mechanism may not be working correctly.

10. **Saved Views tab** — Lee: "I don't know what this is... I think it's just filters that you save... Ignore that for time being."

11. **White theme preference** — Lee mentioned the client may prefer a white/light theme instead of the current navy/blue: "they may want this to be white instead of blue, just as a CSS change."

12. **This is a proof of concept** — Lee: "I think this is just a proof of concept. They're not looking for a finished product right now, are they?"

---

## 2. Exhaustive Gap Analysis: SDD Requirements v1.3 vs Current Implementation

### Legend
- **CRITICAL** — Blocks core functionality, must fix
- **HIGH** — Important feature missing, should fix before demo
- **MEDIUM** — Feature gap, fix when possible
- **LOW** — Nice-to-have, can defer

---

### 2.1 Backend — Map/Reduce (`mcgi_mr_trader_screen_cache.js`)

#### GAP-MR-01: Subsidiary filter is COMMENTED OUT [CRITICAL]

**SDD Reference:** Section 3.3, getInputData Step 2 — "Load `customsearch_suitelet_all_items_search` with CWP Industriel Inc. subsidiary filter"

**Current Code:** Lines 184-186 of `mcgi_mr_trader_screen_cache.js`:
```javascript
//const filters = mySearch.filterExpression ? mySearch.filterExpression.concat() : [];
//filters.push('AND', ['subsidiary', 'anyof', subsidiaryId]);
//mySearch.filterExpression = filters;
```

The subsidiary filter is commented out. The search returns items for ALL subsidiaries, not just CWP Industriel Inc. Andrei confirmed in the meeting this was done because the filter was causing zero results.

**What needs to change:** Uncomment and fix the subsidiary filter. The issue was likely that `filterExpression` concatenation was malformed. The filter needs to be applied correctly — either by modifying `filterExpression` or by adding to `mySearch.filters`. Test against live data to confirm subsidiary ID 7 returns results.

---

#### GAP-MR-02: `custscript_ts_force_full_rebuild` defaults to TRUE [HIGH]

**SDD Reference:** Section 3.3 — "script parameter `custscript_ts_force_full_rebuild` (checkbox, default unchecked)"

**Current Code:** Line 169:
```javascript
const forceFull = getScriptParam('custscript_ts_force_full_rebuild', true);
```

The code defaults to `true` when the parameter is not set, meaning the script ALWAYS does a full rebuild and never uses delta mode.

**What needs to change:** Change default to `false`. Delta mode is important for performance — full rebuilds are expensive on governance.

---

#### GAP-MR-03: `isReload` is hardcoded to `false` [MEDIUM]

**SDD Reference:** Section 3.4 — "`isReload` | boolean | `custrecord_is_reload join inventoryLocation` | true if location is a Reload"

**Current Code:** Line 131:
```javascript
isReload: false,
```

Always hardcoded to `false`. The SDD says it should come from a custom record field on the location record.

**What needs to change:** Read `custrecord_is_reload` from the search result (if the saved search includes it as a join column) or look it up separately. This determines whether a location shows a "Reload" badge in the UI.

---

#### GAP-MR-04: Width and Length extraction is fragile / wrong [HIGH]

**SDD Reference:** Section 3.4 — "`width` | string | `custitem_mgsl_width getText`" and "`length` | string | `custitem_mgsl_length getText`"

**Current Code:** Lines 109-122:
```javascript
result.columns.forEach((col) => {
    const name = (col.name || '').toLowerCase();
    const label = (col.label || '').toLowerCase();
    if (name.indexOf('width') >= 0 || label.indexOf('width') >= 0) {
        widthVal = result.getText(col) || result.getValue(col) || widthVal;
    }
    if (name.indexOf('length') >= 0 || label.indexOf('length') >= 0) {
        lengthVal = result.getText(col) || result.getValue(col) || lengthVal;
    }
});
if (!widthVal) widthVal = itemCode || '';
```

Instead of using `custitem_mgsl_width` and `custitem_mgsl_length` directly, the code searches through ALL columns looking for any column name containing "width" or "length". This could match wrong columns. Fallback sets width to `itemCode` which makes no sense.

**What needs to change:** Use `result.getText({ name: 'custitem_mgsl_width' })` and `result.getText({ name: 'custitem_mgsl_length' })` directly, same as the other attribute fields. Verify these columns exist in the saved search.

---

#### GAP-MR-05: Item attribute fields may need summary parameters [HIGH]

**SDD Reference:** Section 3.4 — All attribute fields use `getText` with specific custom field IDs

**Current Code:** Lines 136-144:
```javascript
species: result.getText({ name: 'custitem_species' }) || '',
thickness: result.getText({ name: 'custitem_mgsl_thickness' }) || '',
// ... etc
```

These calls don't include a `summary` parameter. The main item search uses `summary: 'GROUP'` for fields like `inventorylocation` and `summary: 'MAX'` for `internalid`. If the custom item fields are also defined with summary types in the saved search, calling `getText` without the matching summary parameter will return empty/wrong values. This is likely why Lee saw blank attribute columns.

**What needs to change:** Check the saved search `customsearch_suitelet_all_items_search` definition in NetSuite. If these custom fields have summary types (GROUP or MAX), add the matching `summary` parameter to each `getText` call. If they don't have summary types, they may need to be added to the saved search as summary columns.

---

#### GAP-MR-06: lotNo source field is wrong [LOW]

**SDD Reference:** Section 3.5.1 — "`lotNo` | `inventorynumber join inventoryNumber`"

**Current Code:** Line 369:
```javascript
lotNo: r.getValue({ name: 'serialnumber' }) || '-',
```

Uses `serialnumber` instead of `inventorynumber` join. These are different fields in NetSuite.

**What needs to change:** Use `r.getValue({ name: 'inventorynumber', join: 'inventoryNumber' })` or verify which field the saved search actually uses.

---

#### GAP-MR-07: On Hand search ID mismatch [MEDIUM]

**SDD Reference:** Section 3.5.1 — "source: `customsearch_mgsl_trader_onhand`"

**Current Code:** Line 22:
```javascript
const ON_HAND_SEARCH_ID = 'customsearch_mgsl_trader_onhand_tran';
```

The code uses `_tran` suffix. The SDD says `customsearch_mgsl_trader_onhand` without `_tran`.

**What needs to change:** Verify the actual saved search ID in NetSuite and align code and SDD.

---

#### GAP-MR-08: Delta mode subsidiary filter applied correctly but full mode filter is commented out [CRITICAL]

**Current Code:** Lines 257-258 (delta mode):
```javascript
['subsidiary', 'anyof', subsidiaryId],
```

The delta transaction search correctly applies the subsidiary filter. But the full-mode item search (GAP-MR-01) has it commented out. This creates an inconsistency where delta mode processes only one subsidiary's transactions but the full rebuild has all subsidiaries' items.

---

### 2.2 Backend — Service Layer (`trader_screen_service.js`)

#### GAP-SVC-01: const reassignment bug in handleGetSummary [CRITICAL]

**Current Code:** Lines 251-252:
```javascript
const rows = JSON.parse(summaryStr);
if (!Array.isArray(rows)) rows = [];
```

`rows` is declared with `const` but then reassigned with `rows = []`. This will throw a TypeError in strict mode / modern JS engines. In SuiteScript 2.1 this may or may not throw depending on the runtime.

**What needs to change:** Change `const` to `let`, or restructure: `let rows = JSON.parse(summaryStr); if (!Array.isArray(rows)) rows = [];`

---

#### GAP-SVC-02: PO/SO creation missing required fields [HIGH]

**SDD Reference:** Section 4.4 Note — "Exact required fields for PO and SO record creation must be verified against the live account (some custom mandatory fields may exist)"

**Meeting Context:** PO creation failed silently. Lee mentioned missing department field and other mandatory fields.

**Current Code:** Lines 348-378 create the record with only: `entity`, `location`, `item` (line), `quantity` (line), `location` (line), `duedate`/`shipdate`, `memo`. No `department`, `class`, `subsidiary`, or other potentially mandatory fields.

**What needs to change:** Test record creation interactively in NetSuite. Identify all mandatory body-level fields (department, class, subsidiary, terms, etc.) and either:
- Add them to the RESTlet (from script params or defaults)
- Make them not required on the record type (NetSuite admin)
- Add them to the CreateOrderModal form for user input

---

#### GAP-SVC-03: docNum retrieval after save may fail [MEDIUM]

**Current Code:** Lines 380-381:
```javascript
const docId = rec.save();
const docNum = rec.getValue({ fieldId: 'tranid' });
```

After `rec.save()`, the in-memory record object may not retain field values in all cases. `tranid` is auto-generated on save.

**What needs to change:** After save, load the record: `const saved = record.load({ type: ..., id: docId }); const docNum = saved.getValue({ fieldId: 'tranid' });`

---

### 2.2b Backend — Suitelet (`mcgi_sl_trader_screen_react.js`)

#### GAP-SL-01: `log` variable used but not imported [HIGH]

**Current Code:** Line 96:
```javascript
log.debug('Config Object', configObj)
```

But the `define()` on line 11 imports `serverWidget, runtime, url, file, record` — `N/log` is NOT included. This will throw a `ReferenceError: log is not defined` at runtime when the Suitelet is opened.

**What needs to change:** Either add `'N/log'` to the define imports and `log` to the callback parameters, or remove the `log.debug` call.

---

### 2.3 Frontend — App.tsx

#### GAP-APP-01: CWP view pills don't filter by subsidiary [CRITICAL]

**SDD Reference:** Section 2.2 — Each CWP view shows data for that subsidiary. Section 6.3 — Header has CWP pills.

**Meeting Context:** Lee confirmed "this now changed but the data didn't."

**Current Code:** App.tsx lines 150-165:
```javascript
<button onClick={() => setActiveView(view)} ...>
```

Clicking a CWP pill only changes `activeView` state, which only affects UOM options. It does NOT re-fetch data for a different subsidiary. The `useSummaryData` hook always fetches the same data.

**What needs to change:** For Phase 1 (CWP IND only), these pills should either:
- Be disabled/hidden (since Phase 1 is single-subsidiary)
- Or trigger a re-fetch with a different subsidiary parameter (requires multiple MR deployments writing to separate cache keys, or separate cache namespaces)

Lee's guidance: "Each of those require a different map reduce... just a deployment."

---

#### GAP-APP-02: UoM selector is non-functional [HIGH]

**SDD Reference:** Section 6.6 — "When the UOM changes, all displayed quantities and the Avg Price column update instantly client-side."

**Current Code:** App.tsx line 57:
```javascript
const [uom, setUom] = React.useState('Packs');
```

The `uom` state is set but never read by any component. No conversion logic exists anywhere. InventoryTable always displays raw Pack quantities.

**What needs to change:** Implement UOM conversion utility. When UoM changes:
- Multiply all quantity columns by conversion factor
- Adjust Avg Price column accordingly
- Update totals footer
- Conversion factors need to be confirmed by business (Packs -> MBF factor unknown)

---

#### GAP-APP-03: No "Last Updated" badge in header [MEDIUM]

**SDD Reference:** Section 6.11 — "Last Updated badge states" table with color-coded states (ok/stale/refresh)

**Current Code:** `useRefreshState` hook exports `formatLastUpdated` and `getLastUpdatedBadgeState` functions, but App.tsx header never renders them. There's no timestamp display.

**What needs to change:** Add a badge next to the refresh button showing the last updated time with appropriate color state.

---

#### GAP-APP-04: Filter panel opens by default instead of collapsed [LOW]

**SDD Reference:** Section 6.3 — "Collapsible panel, collapsed by default"

**Current Code:** FilterPanel.tsx line 78:
```javascript
const [filtersOpen, setFiltersOpen] = React.useState(true);
```

**What needs to change:** Change to `useState(false)`.

---

#### GAP-APP-05: No active filter chips/tags above table [MEDIUM]

**SDD Reference:** Section 6.3 — "Active filters are shown as dismissible chips/tags above the table"

**Current Code:** Active filters are only shown as a count badge on the filter panel header. No chips above the table.

**What needs to change:** Add a row between FilterPanel and InventoryTable that renders active filters as dismissible Badge components.

---

#### GAP-APP-06: Saved Views tab is non-functional [LOW]

**SDD Reference:** Not explicitly in SDD (it was in the POC design).

**Meeting Context:** Lee: "Ignore that for time being."

**Current Code:** App.tsx lines 205-210 render the tab but it does nothing. `useSavedViews` hook exists but is not connected.

**What needs to change:** Either connect the hook or remove the tab for now. Low priority per Lee.

---

#### GAP-APP-07: No toast notification on successful refresh [LOW]

**SDD Reference:** Section 6.11 step 8 — "Show a brief green 'Updated' toast (1.5 s)"

**Current Code:** No toast component exists. Refresh completes silently.

**What needs to change:** Add a toast/notification component that briefly appears after successful data refresh.

---

#### GAP-APP-08: Background polling doesn't properly pause when tab hidden [LOW]

**SDD Reference:** Section 6.11 — "Background polling pauses when the browser tab is hidden"

**Current Code:** useRefreshState.ts line 113 checks `if (document.hidden) return;` inside the callback but the interval keeps firing. This means the callback runs every 5 minutes regardless but skips the actual check. This is acceptable behavior but not exactly "pausing."

**What needs to change:** Minor — could use Page Visibility API to clear/restart interval, but current approach is functionally adequate.

---

#### GAP-APP-09: No suppress banner during CreateOrderModal [LOW]

**SDD Reference:** Section 6.11 — "If the user is filling out a CreateOrderModal, suppress the banner until the modal is closed"

**Current Code:** Not implemented. The "new version available" banner will appear even if the user is mid-order.

**What needs to change:** Track whether CreateOrderModal is open and conditionally hide the banner.

---

### 2.4 Frontend — InventoryTable.tsx

#### GAP-TBL-01: Column order doesn't match SDD [MEDIUM]

**SDD Reference:** Section 6.4 — Column #1 is `order` ($), #2 is `itemCode`, ... #21 is `avgPrice`

**Current Code:** Column order is: select (checkbox), itemCode, locationName, itemName, species, ..., averageCost, order ($)

Differences:
- `select` checkbox column is NOT in the SDD at all
- `order` ($) is last instead of first
- SDD has no select/checkbox column

**What needs to change:** Move `order` ($) to first position. Remove or discuss the `select` checkbox column — it's not specified in the SDD and its purpose is unclear (bulk operations? not implemented).

---

#### GAP-TBL-02: Qty cells show "0" instead of em dash [MEDIUM]

**SDD Reference:** Section 6.5 — "Cells with value 0 display as '---' (em dash) and are not clickable"

**Current Code:** MetricCell line 46-47:
```javascript
const display = `${prefix || ''}${formatNum(value)}`;
```

`formatNum(0)` returns `'0'`, not `'---'`.

**What needs to change:** When value is 0, display `'---'` instead.

---

#### GAP-TBL-03: No attribute cell click-to-filter [MEDIUM]

**SDD Reference:** Section 6.5 — "Hovering an attribute cell changes background to light green (#E8F5EF) and underlines the text" and "Clicking an attribute cell filters by that value"

**Current Code:** Attribute cells (species, thickness, etc.) are plain text spans with no click handlers or hover effects.

**What needs to change:** Make attribute cells clickable. On click, add the cell's value to the corresponding filter. Add hover effect (light green bg + underline).

---

#### GAP-TBL-04: No drag-to-reorder columns [LOW]

**SDD Reference:** Section 6.4 — "Drag-to-reorder is supported for all columns except 'order'"

**Current Code:** No drag/reorder implementation.

**What needs to change:** Add column reorder support via TanStack Table's column ordering API or a drag library. Low priority — "session-only (not persisted)" per SDD.

---

#### GAP-TBL-05: averageCost header says "AVG PRIX/M3" but should be UoM-dependent [MEDIUM]

**Current Code:** InventoryTable.tsx line 287:
```javascript
header: 'AVG PRIX/M\u00B3',
```

Hardcoded to "M3" regardless of selected UoM. When UoM is Packs it should say "Avg Price/Pack".

**What needs to change:** Make the header label dynamic based on active UoM.

---

#### GAP-TBL-06: averageCost column is not sortable [LOW]

**Current Code:** Line 292: `enableSorting: false`

**SDD Reference:** Section 6.4 — "Sortable. Right-aligned."

**What needs to change:** Change to `enableSorting: true`.

---

#### GAP-TBL-07: No qty cell hover effects per SDD [LOW]

**SDD Reference:** Section 6.5 — "Hovering a clickable qty cell changes its background to a light blue (#EDF4FF) and shows a pointer cursor"

**Current Code:** MetricCell has `hover:underline` but no background color change.

**What needs to change:** Add `hover:bg-[#EDF4FF]` and cursor-pointer to clickable metric cells.

---

### 2.5 Frontend — DetailDrawer.tsx

#### GAP-DTL-01: Uses side drawer instead of modal [MEDIUM]

**SDD Reference:** Section 6.7 — "Backdrop overlay (click outside to close). Modal box: max-width 1200px, max-height 88vh, scrollable body."

**Current Code:** Uses `Sheet` (side drawer) component that slides from the right, max-width 672px (sm:max-w-2xl).

**What needs to change:** Consider switching to a Dialog/Modal component centered on screen with max-width 1200px per SDD. Or keep the drawer if the client prefers it — this is a UX decision.

---

#### GAP-DTL-02: Missing modal header details [MEDIUM]

**SDD Reference:** Section 6.7 — "Header: bucket icon + label + 'Transaction Detail' + item code + location. Total quantity in current UOM on the right."

**Current Code:** Header just says "Inventory Detail" with no item code, location, or total.

**What needs to change:** Pass the item code, location name, and total quantity to DetailDrawer and display in the header.

---

#### GAP-DTL-03: No $ button on detail modal rows [MEDIUM]

**SDD Reference:** Section 6.7 — "Each row has a $ button for Create PO/SO in context of that transaction"

**Current Code:** Detail rows have no action buttons.

**What needs to change:** Add an OrderPopover to each detail row, pre-filling the CreateOrderModal with that row's vendor/customer, quantity, etc.

---

#### GAP-DTL-04: Missing pricePerPiece column in committed tab [LOW]

**SDD Reference:** Section 6.7 — Committed modal columns include "Price/Piece"

**Current Code:** DetailDrawer.tsx committed COLUMN_MAP does not include `pricePerPiece`. It has: docNum, customerName, tranDate, expectedShipDate, itemCode, packCommitted, openPackQty, rate.

**What needs to change:** Add `{ id: 'pricePerPiece', label: 'Price/Piece' }` to the committed column config.

---

#### GAP-DTL-05: No footer row with totals in detail table [LOW]

**SDD Reference:** Section 6.7 — "Footer row: 'TOTAL' + summed quantity"

**Current Code:** No footer row in DetailTable.

**What needs to change:** Add a footer row that sums the quantity column.

---

### 2.6 Frontend — CreateOrderModal.tsx

#### GAP-ORD-01: No pre-fill from detail row context [MEDIUM]

**SDD Reference:** Section 6.9 — "Pre-fills the form with that row's quantity, vendor/customer, and any existing PO/SO reference"

**Current Code:** The modal accepts `prefill` prop but it's never passed from detail rows (because GAP-DTL-03 means there are no $ buttons on detail rows). From the main table, OrderPopover passes `itemId` and `locationId` but no prefill data.

**What needs to change:** When triggered from a detail row, pass vendor/customer ID and quantity as prefill.

---

#### GAP-ORD-02: Party ID is a raw text input (internal ID) [MEDIUM]

**SDD Reference:** Section 6.9 — "Vendor (PO) / Customer (SO) | Select"

**Current Code:** The Vendor/Customer field is a plain text input where the user must type a NetSuite internal ID. This is unusable for traders.

**What needs to change:** Ideally, implement a searchable select/combobox that queries for vendors or customers. At minimum, show the entity name after lookup. This may require a new RESTlet action to search vendors/customers.

---

### 2.7 Frontend — FilterPanel.tsx

#### GAP-FLT-01: "Apply Filters" button is redundant [LOW]

**Current Code:** Filters are stored in state and `getFilteredRows` is called with the current filters on every render via `useMemo`. The "Apply Filters" button calls `handleApply` which just does `setFilters((f) => ({ ...f }))` — a no-op identity update.

**What needs to change:** Filters already apply in real-time. Either remove the Apply button or implement deferred filtering (accumulate changes and apply on click). Current behavior is fine functionally.

---

### 2.8 Frontend — Loading & Error States

#### GAP-UX-01: No skeleton loading [LOW]

**SDD Reference:** Section 6.10 — "Initial load: skeleton placeholder rows (shimmering bars)"

**Current Code:** Shows a spinner overlay with "Chargement..." text instead of skeleton rows.

**What needs to change:** Replace with skeleton table rows using the existing `Skeleton` component.

---

#### GAP-UX-02: No spinner in qty cell during detail load [LOW]

**SDD Reference:** Section 6.10 — "Detail load: spinner inside the clicked qty cell while the detail GET is in flight"

**Current Code:** The qty cell doesn't show any loading state. The drawer shows a Skeleton placeholder.

**What needs to change:** Add a loading indicator to the clicked cell.

---

#### GAP-UX-03: Cache miss banner could be more user-friendly [LOW]

**SDD Reference:** Section 6.10 — "Cache miss (503): banner — 'Cache is refreshing, please try again in a few minutes' with a Retry button"

**Current Code:** Error is displayed but has a long technical message about running the Map/Reduce script.

**What needs to change:** Simplify the error message for end users.

---

### 2.9 Frontend — Export

#### GAP-EXP-01: Export column mismatch with current schema [LOW]

**Current Code:** export.ts hardcodes column headers. Need to verify they match the current data structure. The header says "Avg Prix/M3" which should match UoM.

**What needs to change:** Verify alignment and make UoM-responsive.

---

### 2.10 SDD Open Questions (Still Unresolved)

These are from SDD Section 10 and remain open:

| # | Question | Status |
|---|---|---|
| 1 | UOM conversion factors (Packs to MBF, others)? | **UNRESOLVED** — business must confirm |
| 2 | CWP Industriel Inc. subsidiary internal ID? | **RESOLVED** — ID is 7 |
| 3 | Autres and Etampage: single or separate columns? | **RESOLVED** — separate columns implemented |
| 4 | Lot numbers: serialized items or custom field? | **UNRESOLVED** — need to test with live data |
| 5 | Create PO/SO: full creation or pre-fill redirect? | **UNRESOLVED** — current impl does full creation but it fails |
| 6 | Roles for Suitelet access? | **UNRESOLVED** |
| 7 | Hide avg cost for certain roles? | **UNRESOLVED** |
| 8 | Detail payload >500KB: split by bucket or omit fields? | **RESOLVED** — implementation splits by bucket |
| 9 | Cache refresh frequency? | **RESOLVED** — every 15 minutes |
| 10 | Confirm exact saved search IDs? | **PARTIALLY RESOLVED** — IDs in code differ from SDD for onHand search |

---

### 2.11 SDD Unresolved Gaps (Section 3.7.7)

| ID | Gap | Status |
|---|---|---|
| G-01 | Lot number source not confirmed | **UNRESOLVED** — code uses `serialnumber`, SDD says `inventorynumber join` |
| G-02 | Committed formula label spelled `'commited'` (one t) | **RESOLVED** — code handles this spelling |
| G-03 | 'In Transit *Additional' formula label exact string | **RESOLVED** — code checks both `'In Transit *Additional'` and `'In Transit * Additional'` |
| G-04 | averageCost source (location avg vs receipt avg) | **UNRESOLVED** |
| G-05 | UOM conversion factor for MBF | **UNRESOLVED** |
| G-06 | Delta doesn't capture item master changes | **ACKNOWLEDGED** — by design, only full rebuild catches attribute changes |

---

## 3. Prioritized Work Items

### Tier 1: Critical (Must Fix)

| ID | Description | Component |
|---|---|---|
| GAP-MR-01 | Uncomment and fix subsidiary filter in Map/Reduce | Backend MR |
| GAP-MR-08 | Ensure subsidiary filter consistency between full and delta modes | Backend MR |
| GAP-SVC-01 | Fix const reassignment bug in handleGetSummary | Backend Service |
| GAP-APP-01 | CWP view pills: either disable for Phase 1 or implement subsidiary switching | Frontend App |

### Tier 2: High Priority (Should Fix Before Demo)

| ID | Description | Component |
|---|---|---|
| GAP-MR-02 | Change forceFull default to false | Backend MR |
| GAP-MR-04 | Fix width/length extraction to use proper custom fields | Backend MR |
| GAP-MR-05 | Fix item attribute getText calls (add summary params if needed) | Backend MR |
| GAP-APP-02 | Implement UoM conversion logic (at least Packs display) | Frontend App |
| GAP-SVC-02 | Fix PO/SO creation (identify required fields) | Backend Service |
| GAP-SL-01 | Fix `log` not imported in Suitelet (ReferenceError) | Backend Suitelet |
| GAP-TBL-01 | Fix column order, remove checkbox column | Frontend Table |

### Tier 3: Medium Priority

| ID | Description | Component |
|---|---|---|
| GAP-APP-03 | Add "Last Updated" badge to header | Frontend App |
| GAP-APP-05 | Add active filter chips above table | Frontend App |
| GAP-TBL-02 | Show em dash for zero qty cells | Frontend Table |
| GAP-TBL-03 | Attribute cell click-to-filter | Frontend Table |
| GAP-TBL-05 | Dynamic UoM label on avg price header | Frontend Table |
| GAP-DTL-01 | Switch detail from drawer to centered modal | Frontend Detail |
| GAP-DTL-02 | Add item code + location to detail header | Frontend Detail |
| GAP-DTL-03 | Add $ buttons to detail rows | Frontend Detail |
| GAP-ORD-01 | Pre-fill order modal from detail row | Frontend Modal |
| GAP-ORD-02 | Vendor/customer searchable select | Frontend Modal |
| GAP-MR-03 | Implement isReload from location record | Backend MR |
| GAP-MR-07 | Verify and align on-hand search ID | Backend MR |

### Tier 4: Low Priority (Can Defer)

| ID | Description | Component |
|---|---|---|
| GAP-APP-04 | Filter panel collapsed by default | Frontend App |
| GAP-APP-06 | Saved Views tab | Frontend App |
| GAP-APP-07 | Toast on refresh success | Frontend App |
| GAP-APP-08 | Proper pause polling on hidden tab | Frontend App |
| GAP-APP-09 | Suppress banner during order modal | Frontend App |
| GAP-TBL-04 | Drag-to-reorder columns | Frontend Table |
| GAP-TBL-06 | Make averageCost sortable | Frontend Table |
| GAP-TBL-07 | Qty cell hover background | Frontend Table |
| GAP-DTL-04 | pricePerPiece column in committed | Frontend Detail |
| GAP-DTL-05 | Totals footer in detail table | Frontend Detail |
| GAP-UX-01 | Skeleton loading state | Frontend UX |
| GAP-UX-02 | Spinner in clicked qty cell | Frontend UX |
| GAP-UX-03 | User-friendly cache miss message | Frontend UX |
| GAP-EXP-01 | Export column alignment | Frontend Export |
| GAP-MR-06 | lotNo field source | Backend MR |
| GAP-SVC-03 | docNum retrieval after save | Backend Service |

---

## 4. Additional Notes

### Multi-Subsidiary Architecture (Future)

Lee clarified in the meeting that each CWP subsidiary needs its own Map/Reduce deployment:
- CWP IND (subsidiary 7) — currently being built
- CWP MTL (subsidiary 5) — future
- CWP ARCH (subsidiary 9) — future

Each deployment would write to the same cache with subsidiary-prefixed keys (or separate cache names). The React app would switch views by passing the subsidiary to the RESTlet, which reads the correct cached data. This is Phase 2+ scope.

### Theme Change

Lee mentioned the client may prefer white/light theme over navy. The app already has dark mode support. Switching to a light default would be a CSS variable change — low effort.

### Production Readiness Checklist (from docs)

These items from the production readiness doc are still unchecked:
- [ ] RESTlet restricted to Trader roles
- [ ] Suitelet access restricted
- [ ] No hardcoded subsidiary IDs (GAP-MR-01 violates this)
- [ ] Governance under threshold per cycle
- [ ] Payload size verified
- [ ] Delta fallback tested
- [ ] Saved search IDs confirmed with sort columns
- [ ] UOM config finalized
- [ ] Logging reduced for production
- [ ] Old Suitelet retained during UAT

---

*End of Part 2. Next: Part 3 — SDD Requirements Document (paste the existing MGSL_TraderScreen_React_Requirements_v1.3.md directly)*
