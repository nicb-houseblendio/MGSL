/**
 * Lot-level rules for CWP ARCH.
 *
 * The bundle-lock rule below is the single most important piece of domain logic
 * on this screen — get it wrong and two traders sell the same bundle.
 */

import type { ArchLot, ArchDetailKey } from '@/types/arch';

/* ── Deterministic RNG ──────────────────────────────────────────────────────
 * Used to derive stable demo detail (SO numbers, suppliers, ETAs) from a lot
 * number. Deterministic on purpose: a demo that reshuffles between screenshots
 * is useless for review, and a lot must always show the same SO.
 * ------------------------------------------------------------------------- */

const strToSeed = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const seededRandom = (key: string) => {
  let a = strToSeed(key);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/* ── Bundle lock ───────────────────────────────────────────────────────────*/

/**
 * A bundle carrying ANY commitment is unsellable in full.
 *
 * Per Marc-Antoine (2026-08-11 call): a trader selling 300 BF off a 690 BF bundle
 * blocks the
 * whole bundle, because nobody knows what is actually left until the warehouse
 * physically splits it — the tally is subjective and the split lands wherever a
 * full row of planks ends (maybe 288, maybe 320). The bundle stays locked until
 * the split is completed in the system.
 *
 * Two things this test gets right that are easy to get wrong:
 *
 *  1. It is `> 0`, NOT `>= onHand`. A PARTIALLY committed bundle is the exact
 *     case the rule exists for — treating only fully-committed bundles as locked
 *     would leave every split-in-progress bundle sellable.
 *
 *  2. It counts readyToBuild and outbound, not just reserve. Those are further
 *     along the same pipeline — released to the warehouse, and picked — so the
 *     bundle is even more spoken for, not less. Checking `reserve` alone let a
 *     trader select a bundle the warehouse was already building.
 */
export const commitmentOn = (lot: ArchLot): number =>
  (lot.reserve || 0) + (lot.readyToBuild || 0) + (lot.outbound || 0);

export const isLotLocked = (lot: ArchLot): boolean => commitmentOn(lot) > 0;

/**
 * Why a bundle is locked, for the tooltip and the row badge.
 * Colour matches the bucket doing the locking — a bundle held for shipment
 * showing the orange RESERVED colour would misreport which stage it is at.
 */
export const lockReason = (
  lot: ArchLot
): { badge: string; detail: string; color: string } | null => {
  if ((lot.reserve || 0) > 0) {
    return {
      badge: 'Rsvd',
      detail: `${Math.round(lot.reserve)} BF reserved against a sales order`,
      // ARCH_RESERVE_INK. The bucket's own #E65100 is 3.79:1 on the white lot
      // rows — fine as a fill, under AA as a glyph, and this badge is a glyph.
      // Kept as a literal so lib/ does not reach up into components/.
      color: '#B23F00',
    };
  }
  if ((lot.readyToBuild || 0) > 0) {
    return {
      badge: 'Bld',
      detail: `${Math.round(lot.readyToBuild)} BF released to the warehouse to build`,
      color: '#00838F',
    };
  }
  if ((lot.outbound || 0) > 0) {
    return {
      badge: 'Out',
      detail: `${Math.round(lot.outbound)} BF already picked for shipment`,
      color: '#880E4F',
    };
  }
  return null;
};

/**
 * Which physical bucket a lot sits in, for the Available view.
 * A lot lives in exactly one: uncommitted on-hand, else on order, else in
 * transit. Stock cannot be in the yard and on a vessel at the same time.
 *
 * Declared BEFORE lotQuantity, which calls it — these are const arrow functions,
 * so ordering is load-bearing for anything that ever calls them at module scope.
 */
export const availabilityStatus = (
  lot: ArchLot
): { label: string; color: string; qty: number } | null => {
  const netOnHand = (lot.onHand || 0) - commitmentOn(lot);
  if (netOnHand > 0) return { label: 'On Hand', color: '#1B5E20', qty: netOnHand };
  if ((lot.onOrder || 0) > 0) return { label: 'On Order', color: '#1565C0', qty: lot.onOrder };
  if ((lot.inTransit || 0) > 0) return { label: 'In Transit', color: '#7E57C2', qty: lot.inTransit };
  return null;
};

/**
 * Board feet of a lot in a given bucket.
 *
 * `available` is derived and spans buckets: a lot contributes its UNCOMMITTED
 * on-hand quantity if it is in the yard, otherwise its incoming quantity. Taking
 * only the on-hand part here would make the Available view omit every on-order
 * and in-transit bundle, so the lots listed would not add up to the Available
 * figure the trader clicked — which is the whole reason they opened it.
 */
export const lotQuantity = (lot: ArchLot, bucket: ArchDetailKey): number => {
  if (bucket === 'available') return availabilityStatus(lot)?.qty ?? 0;
  return lot[bucket] || 0;
};
