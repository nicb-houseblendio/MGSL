# Trader-Screen ↔ PO Allocation availability consolidation

**Status:** proposed (awaiting scope decision + owner sign-off)
**Date:** 2026-07-31
**Author:** investigation for Nic (Houseblend)
**Scope of change:** `MGSL/` trader-screen repo only. PO Allocation (`houseblend-clients/McGillStLaurent/…/PO Segment Assignment/`) requires **no** change.

---

## 1. Problem

PO Allocation's per-lot availability disagrees with what the trader sees on the Trader Screen, even though both read the same cache (`MGSL_TRADERSCREEN_CACHE`).

Concrete live case — item `SS241412…`, PPP 294:

| PO / Lot | Trader Screen (Available tab) | PO Allocation panel |
|---|---|---|
| 345225 net | **+34** | 32 (EMCU dropped) |
| 345225 / FFAU2144036 | on-hand 40, part of +34 | 32 ✓ |
| 345225 / EMCU8819044 | on-hand 32, part of +34 | **not shown** |
| 345226 net | **+52** | 45 |
| 345226 / CSNU6450643 - 14' | on-hand 40, part of +52 | 13 (should be 18) |
| 345226 / UETU5152158 - 14' | on-hand 40, part of +52 | 32 (should be 38) |

PO Alloc under-states availability and drops a lot (EMCU) that physically has 2 free packs — exactly the qty the SO line needs.

## 2. Root cause (evidence-anchored)

The cache payload carries **six** arrays: `onHand`, `committed`, `outbound`, `onOrder`, `inTransit`, and `available`
(`mcgi_mr_trader_screen_cache_mtl.js:2447-2454`). `available` is produced by `buildAvailable`. There are **two** independent
availability computations, and the two consumers read **different** ones:

1. **Trader Screen Available tab** computes its numbers in the browser from the **raw** `onHand`/`committed`/`outbound`
   arrays via `buildPOGroups` (`react-app/src/components/AvailableTabMTL.tsx:50-240`). It **never reads `data.available`**.
   Net per PO-group = `Σ supply − Σ committed` (`:213-223`). This reproduces the +34/+52 the trader sees.
2. **PO Allocation** reads the derived `available` array verbatim: `reconciledAvailByLot[seg|lot] = ar.packsAvail`
   (`MSL_LIB_POAllocationCore.js:1758`), used as `availQty` with no recompute (`:1804-1811`). Lots that `buildAvailable`
   reconciled to ≤0 are absent → default 0 → dropped by the display filter `return lotAvail > 0` (`:1505`).

`available` was **built to be the shared number** (`mcgi_mr_trader_screen_cache_mtl.js:1322-1324`: "lets PO Alloc consume
this reconciled `available` row directly instead of re-deriving"), but the trader tab never adopted it. So availability is
computed twice and the two disagree. PO Alloc bet on the array the screen does not use.

Why `available` diverges from the screen (both are real defects in `buildAvailable`):

- **Item-wide reconciliation.** The "excess" step (`mcgi_mr_trader_screen_cache_mtl.js:1384-1407`) pools all POs' committed
  + outbound at the **item** level and trims the overage from the **largest-available lots first** across every PO. This
  shifts availability *between* PO groups (it is what pulls EMCU's packs into another PO's reconciliation and drops it).
- **Multi-lot commitments lose their per-lot split.** `dedupeByLine` (`:995-1041`) collapses a single SO line committed
  across two lots into **one** row with a composite lot name (`"CSNU…, EMCU…"`, `:1026`) carrying the **line-level**
  `packsCommitted` (`:531`). `committedByLot` keys by that composite string (`:1282-1286`), which matches no real on-hand
  lot, so those packs never pin per-lot and only re-enter through the item-wide excess step, which then smears them by lot size.

## 3. Decision

**`available` (the MR's `buildAvailable`) becomes the single source of truth.** It is already per-lot, already in the cache,
already consumed by PO Alloc, and already shipped to the React app (`DetailPayload.available`, `useDetailData.ts:12`). We
fix it to equal what the screen shows, point the tab at it, and PO Alloc's one-line read is untouched. No fourth computation.

**Correctness target (exact):** `Σ per-lot packsAvail` within a PO-group must equal `buildPOGroups`' group net
(`Σ supply − Σ committed` = +34/+52).

## 4. Edits

### Edit 1 — MR: scope the reconciliation per PO-group  *(required; fixes screen parity)*

`mcgi_mr_trader_screen_cache_mtl.js:1384-1407`. Today the excess step is item-wide. Change it to run **per group**, using the
same keys `buildPOGroups` uses:
- on-hand → `(poNumber || docNumber, ppp)`
- committed / outbound → `(allocatedPO, ppp)`

Per group: `groupTarget = Σ onHand − Σ committed(group) − Σ outbound(group)`; trim the excess only within that group's lots.
This makes each group's per-lot sum equal the screen's net and stops availability leaking across POs (the EMCU-drop vector).

> Edit 1 alone gets the screen and PO Alloc to agree at the **group** level. It does **not** guarantee correct per-**lot**
> numbers when a commitment can't pin (a stranded multi-lot commitment is trimmed off the biggest lot, not its real one).
> PO Alloc reserves against a specific lot, so per-lot correctness needs Edit 2.

### Edit 2 — MR: carry per-lot committed/outbound quantities  *(fixes per-lot precision; includes a saved-search change)*

Root of the per-lot error is `dedupeByLine:1019-1038` collapsing a multi-lot line to one composite-lot row at line-level qty.
Fix: emit **one row per (line, lot)** with that lot's **InventoryAssignment quantity** instead of collapsing to the line total.
Requires:
- the committed/outbound **saved searches** to expose the per-lot inventory-detail quantity (a NetSuite saved-search edit,
  not just script), and
- `dedupeByLine` to stop concatenating multi-lot rows and keep them split with the per-lot qty.

With Edit 2, `committedByLot` (`:1282-1298`) pins exactly, per-lot `packsAvail` is each lot's true free packs, and Edit 1's
excess step becomes a genuine no-op (belt-and-suspenders for unallocated/`—` lots that still can't pin).

### Edit 3 — React tab: read the net from the cache, delete the local netting

`react-app/src/components/AvailableTabMTL.tsx:213-223`. Replace `netAvailable = supplyTotal − committedTotal` (browser math)
with the **sum of the group's `available` rows' `packsAvail`** (already present in `data.available`). Keep the gross
on-hand/committed/outbound **display** rows sourced from the raw arrays (they are the drill detail, not availability math).
Only the authoritative *net* moves to the cache. This is what actually eliminates "computed twice."

### PO Allocation — no change

Keeps its verbatim read of `available.packsAvail` (`MSL_LIB_POAllocationCore.js:1758`). Once the cache is right, PO Alloc is
right for free.

## 5. Ownership & deploy reality

- All three edits are in the **`MGSL/` trader-screen repo** — not the PO Allocation files.
- Edits 1-2 are in the MR, which feeds the **entire** trader screen → high blast radius, needs regression across the
  Available tab, summary grid, and any other `available`/detail consumer.
- Edit 2 includes a **NetSuite saved-search edit** (per-lot inventory-detail quantity).
- Edit 3 requires a **React bundle rebuild + redeploy** (the app is bundled and served by a Suitelet).
- The summary-row `available` total (`mcgi_mr_trader_screen_cache_mtl.js:2329`) is computed independently at item level and is
  **not** affected by `buildAvailable` changes — but confirm no other consumer re-derives availability a third way.

## 6. Verification

After Edits 1-2, dump the cache `available` for `(SS241412…, location)`:
- PO345225 group sums to **34**, EMCU shows **2** (not dropped).
- PO345226 group sums to **52** (CSNU 18 / UETU 38).

After Edit 3, the tab's net reads those same numbers from the cache; PO Alloc's panel matches with **no** PO-Alloc change.

Regression: Available tab totals, summary grid, and PO Alloc availability all unchanged for single-lot / whole-pack items
(where `buildAvailable` and `buildPOGroups` already agreed).

## 7. Open decisions (need sign-off)

1. **Scope:** Edit 1 only (screen-parity, script-only, fast) — or Edits 1+2 (per-lot correct, includes the saved-search
   change)? For PO Alloc to show the correct lot to allocate against, 1+2 is required.
2. **Execution:** make the edits directly in `MGSL/` (owner deploys/coordinates) — or hand this doc to the trader-screen
   owner (Andrei) as a spec?
