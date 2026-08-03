# `buildAvailable` per-PO-group reconciliation — fix spec **v2** (amended after Fable proof)

**Status:** v2, re-proof pending. v1 was proven to have 3 regressions (Fable, 2026-07-31); this version applies the proof's amendments.
**File touched:** `mcgi_mr_trader_screen_cache_mtl.js` — `buildAvailable`, **the excess-reconciliation step ONLY** (~:1384-1407).
**NOT touched (deliberately, v1 broke by touching these):** the per-lot pinning (`committedByLot`/`outboundByLot`, :1282-1298); the lot-`'—'` negative-row re-emission (:1411-1421); PO Allocation; the React tab; saved searches; onOrder/inTransit emission.

## v1 → v2: why the change

v1 re-grouped and re-pinned every committed/outbound row by (PO, ppp). The Fable proof (`fable-prove-buildavailable-pergroup`, 2026-07-31, HAS_REGRESSION/high) showed this regresses three real flows because the **frozen PO-Alloc consumer's self-claim add-back (Core:1691/1811) only recovers EXACT-LOT deductions**:
- R1 partial-receipt: SO committed pre-receipt carries `lot='—'`; deducting it per-lot locks the trader out of his own received packs.
- R2 no-PO-but-real-lot commit: dropping it lets PO-Alloc over-allocate physically-committed packs.
- R3 cross-PPP commit: grouping by the SO-line ppp deducts from the wrong lots → double-commit.

Root cause: the actual bug (SS241412 EMCU drop) is the **item-wide excess step bleeding one PO's over-attribution onto another PO's lots** — NOT the per-lot pinning. So v2 changes only the excess step's scope.

## The minimal fix

1. **Per-lot pinning — UNCHANGED (:1282-1298).** `committedByLot[lotNumber] += packsCommitted` / `outboundByLot[lotNumber] += packs`, by exact `lotNumber`, **item-wide, ignoring allocatedPO and ppp**. This pins a lot-named commit to its physical lot (kills R2, R3). Composite `'A, B'` strings and `'—'` never match a surviving lot (unchanged).
2. **lot-`'—'` committed — UNCHANGED (:1376-1382, :1411-1421).** Not deducted from on-hand; re-emitted as negative `'Committed'` rows (kills R1). PO-Alloc reads only `status==='On Hand'`, so these never enter its per-lot availability, exactly as today.
3. **Excess-reconciliation — CHANGED from item-wide to per-(PO,ppp)-group (replaces :1384-1407).** For each group `g`, keyed as `buildPOGroups` keys (on-hand PO = `poNumber` unless empty/`'—'` → `docNumber`; committed/outbound attributed by `allocatedPO`; ppp = piecesPerPack):
   - `target_g = max(0, groupOnHand_g − Σ(lot-bearing committed attributed to g) − Σ(outbound attributed to g))`
   - `actual_g = Σ` current per-lot `packsAvail` over g's surviving on-hand lots (after step-1 pinning)
   - if `actual_g > target_g`, deduct the excess **from g's lots only** (largest-first or capacity-waterfall), then drop `≤0` rows **only when the group had excess** (preserve the 0-pack-visible rule, :1299-1304, otherwise).
   - Attribution of a committed/outbound row to a group for the target: by its **lotNumber's on-hand group** when the lot survives in some group; otherwise (stranded/composite/absent-lot) by its **allocatedPO**. This confines each stranded reservation's excess to its own PO, ending the cross-PO bleed.
4. **Rounding (Amendment 4a):** the group excess target is `round2` of the RAW group net (matching tab :223); use largest-remainder so `Σ round(lot) == round2(Σ raw)`. Ship even though packs are usually integer.
5. **0-pack rows (Amendment 4b):** outbound-consumed 0-pack On-Hand rows must survive the per-group waterfall (all-zero groups are exactly C1; the UI needs the section — :1299-1304).
6. **Per-row abs (Amendment 4c):** mirror the tab's per-row `Math.abs` (:214) if a committed/outbound qty can be negative.

## Parity claim (honest, restated)

For a **fully-received, positive-net** (PO,ppp) group: `Σ(On-Hand packsAvail) + Σ(re-emitted lot-'—' negative rows of the group) == buildPOGroups.netAvailable`. The **On-Hand-only** subtotal (what PO-Alloc consumes) equals the tab net minus the group's unlotted commitments — which is exactly the server headroom PO-Alloc needs, and the drawer group total still ties the tab.

## Carve-outs (documented non-parity — accepted)

- **C1 — negative net.** `available` shows 0; tab shows −N. Correct-for-allocation (can't allocate from an over-committed PO). Proven never-worse-than-today.
- **C2 — partial receipt.** On-order/in-transit gap vs the tab is pre-existing and unchanged. **Corrected wording:** for a partially-received segment PO-Alloc **skips** the incoming qty (Core:2024) — it is NOT reconciled via a separate unreceived row.
- **C3 — lot-pinned no-PO commit/outbound** (real lot, `allocatedPO='—'`): reduces its lot's availability (physically correct); the tab shows it in the `unallocated` section, so `available` trails the tab's PO net by that amount. **We choose physical correctness** (PO-Alloc must not over-allocate a committed lot).
- **C4 — cross-PPP lot-named commit** (SO-line ppp ≠ the named lot's physical ppp): deducted from the group physically containing the lot (correct), not the ppp-group the tab charges it to (the tab mis-groups it). **We choose physical correctness.** Alternative: also fix the tab's grouping to pin lot-first — restores full parity. **← product decision.**

## Proof obligation (re-prove v2)

Prove: with v2, every use case either matches `buildPOGroups` (fully-received positive-net) or is exactly C1/C2/C3/C4, AND none of the v1 regressions R1/R2/R3 recur (verify against Core:1691/1811 that no exact-lot self-claim is dropped). Adversarially seek any residual mismatch or any new cross-group/self double-count.
