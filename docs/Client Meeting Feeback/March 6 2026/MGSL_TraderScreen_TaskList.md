# MGSL Trader Screen — Task List
_Last updated: March 10, 2026_

---

## 🔴 Due Wednesday (Client Meeting Action Items)

| # | Task | Notes |
|---|------|-------|
| 1 | **Fix filter reset (X button)** `[10:20]` | Clicking X on a selected filter item does nothing — requires manual deselection per option. Must fix the clear/reset behavior on individual filter selections. |
| 2 | **Remove "Appliquer les filtres" button** `[11:52]` | Filters should apply automatically on selection, no manual apply button needed. |
| 3 | **Horizontal scroll bar** `[12:44]` | Too much data to fit on screen. Add a bottom horizontal scrollbar to the table. |
| 4 | **Sticky column headers** `[13:50]` | When scrolling down, column headers must remain visible. |
| 5 | **Location as 2nd column + drag to reorder** `[18:35]` | Move Location to 2nd column position. Columns must be draggable to reorder. |
| 6 | **Remove Finish, Humidity, Planning, Stamping from table columns** `[19:45]` | Keep them in filters, remove from the visible column results. |
| 7 | **Detail modal parity with POC** `[22:30]` | When clicking On Hand or other qty cells, the drill-down detail must match 1-to-1 what was in the POC — same columns, same data. |
| 8 | **Rename "Average Price m3" → "Avg Price"** `[24:09]` | Column header rename only. |
| 9 | **UoM: FBM columns update** `[26:37]` | When UoM is switched to FBM, all related quantity columns must show FBM data. (See `CLAUDE_UOM_TASK.md` — already specced, needs Claude Code execution.) |
| 10 | **Click cell value to auto-filter** `[27:04]` | Clicking a cell value (e.g. species = Aspen, thickness = 4) auto-populates that value in the filter. Clicking it again removes the filter. Table updates in real time. |
| 11 | **Remove $ button (Create PO/SO)** `[27:50]` | Push to Phase 2. Remove the $ button from the table entirely. |
| 12 | **Checkbox column → export selected rows to Excel** `[28:30]` | Checkbox column stays. Selecting rows + clicking Export exports only the checked rows. |
| 13 | **Detail modal: centered, full width** `[29:45]` | Side panel must open centered on screen, using almost full screen width. No horizontal scrolling inside the modal. |
| 14 | **Filter search/type-ahead** `[30:20]` | In Location, Item, Species, etc. filters — user must be able to type to search/filter the options list. |
| 15 | **Fix filter tab navigation** `[32:00]` | After selecting an option with Enter, pressing Tab should move to the next filter. Currently requires Escape then Tab. |
| 16 | **Standardize language to English** `[35:10]` | All labels, buttons, headers, and UI text must be in English. No French. |
| 17 | **Remove "Quantité > 0 seulement" toggle** `[37:00]` | Already removed from client-side logic. Remove the UI toggle entirely. |
| 18 | **Fix footer totals column alignment + remove Moy. Prix** `[37:30]` | Total quantities at the bottom must align with their respective columns. Remove "Moy. Prix" / avg price from footer entirely. |
| 19 | **Remove "Vues sauvegardées" tab** `[39:00]` | Remove the saved views tab from the UI. |
| 20 | **Reinitialize + Export Excel buttons — icon only** `[40:30]` | Replace text buttons with icon-only versions (symbol without label). |
| 21 | **Detail modal quantities in MBF mode** | When drill-down modal is open and UoM = FBM, quantities inside the modal must also show FBM. Do this last — depends on UoM task (#9) being complete first. |

---

## 🟡 Ready to Execute (Claude Code)

| # | Task | File |
|---|------|------|
| 22 | **UoM/MBF conversion** | `CLAUDE_UOM_TASK.md` — fully specced and validated, just needs execution |

---

## 🟢 Quick Cleanup (Small, Self-Contained)

| # | Task | Where |
|---|------|-------|
| 23 | Remove `quantityGreaterThanZero` from `FilterState` interface | `types/index.ts` |
| 24 | Remove `quantityGreaterThanZero: true` from `defaultFilters` | `App.tsx` |
| 25 | Filter panel collapsed by default (`useState(false)`) | `FilterPanel.tsx` line 78 — GAP-APP-04 |
| 26 | Last Updated badge not rendering in header | `App.tsx` — GAP-APP-03 |

---

## 🔵 Needs Client Confirmation

| # | Task | Status |
|---|------|--------|
| 27 | **PO creation** — missing Terms/Department fields | GAP-SVC-02 — awaiting required field list |
| 28 | **CWP MTL / ARCH pills** — keep visible, inactive for now | Confirmed by client — no action needed |
| 29 | **White vs navy theme** | Client may prefer white — confirm before prod |

---

## ⚪ Phase 2 (Post-Demo)

| # | Task | Notes |
|---|------|-------|
| 30 | CWP pills filter by subsidiary | GAP-APP-01 — needs multiple MR deployments per subsidiary |
| 31 | Create PO / Create SO | Removed from UI for now, full feature in Phase 2 |
