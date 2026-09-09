/**
 * Which sales order holds a bundle, and whether the answer is real.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Six of the Reserved panel's eight columns — SO #, SO Creation Date, Reserved
 * For, Ship Week, Customer and Trader — came from `lotAllocation()` in
 * lib/archFixtures.ts, a SEEDED GENERATOR, on live data as well as demo data. A
 * yellow banner said so from 2026-09-08, which is honest but is not the fix: a
 * trader was still going to read `SO-48213` and `Ab Martin Roofing Supply LLC`
 * off that panel and act on them.
 *
 * NetSuite has always known the link. The ARCH cache's own bucket query joins
 * `inventoryassignment` to the order line that names a lot — that join is what
 * tied SO-CWP-001346 to lot 315643-7 during the phantom-reservation fix. What
 * was missing was carrying the ORDER through beside the quantity, and as of
 * 2026-09-08 the cache does: `ArchLot.orders`.
 *
 * ── THE THREE STATES, AND WHY THERE ARE THREE ──────────────────────────────
 * A component cannot ask "is this row live?" — nothing hands it that flag, and
 * the drawer that renders it is not this lane's file. So the discriminator is
 * the DATA, in the one shape that cannot be faked by accident:
 *
 *   'netsuite'    `orders` is a non-empty array. Real orders. Render them.
 *   'unavailable' `orders` is an array but has nothing to say for this bucket.
 *                 A live payload that cannot name an order. Render NOTHING —
 *                 an em dash — never a fixture.
 *   'unsourced'   `orders` is absent entirely: fixtures, or a cache written
 *                 before the field existed. Fall back to the generator AND show
 *                 the placeholder banner.
 *
 * The middle state is why absence of the key and an empty array must not be
 * collapsed. It is also what makes the change safe before the hourly cache
 * rebuild lands: until it does, every lot is 'unsourced', the banner stays, and
 * nothing on screen claims to be real.
 *
 * ── ONLY `reserve` HAS A SOURCE ────────────────────────────────────────────
 * `orders` describes the sales orders behind a bundle's RESERVE. The other two
 * buckets with SO columns cannot be answered from it and must not borrow it:
 *
 *   readyToBuild  is a hardcoded literal 0 in the cache — no NetSuite field
 *                 feeds it — so no live bundle is ever listed under it.
 *   outbound      is attributed to NO lot on purpose. The wood has shipped, the
 *                 bundle's on-hand is already net of it, and booking it against
 *                 the bundle would count the same stock twice.
 *
 * On a live payload both therefore resolve to 'unavailable' rather than to
 * somebody else's order. On a fixture payload they keep the generator, which is
 * the only thing that ever populated them.
 */

import type { ArchLot, ArchDetailKey, ArchLotOrder } from '@/types/arch';
import { lotQuantity } from '@/lib/archLots';

export type ArchOrderSource = 'netsuite' | 'unavailable' | 'unsourced';

/** Rendered where a value is genuinely absent. Never a placeholder value. */
export const NO_VALUE = '—';

/**
 * Which of the three states a bundle is in for a given bucket.
 *
 * `Array.isArray` and not a truthiness check: `[]` is truthy in JS but is the
 * whole signal here, and `orders && orders.length` would have silently thrown
 * the 'unavailable' state away.
 */
export const orderSource = (lot: ArchLot, bucket: ArchDetailKey): ArchOrderSource => {
  if (!Array.isArray(lot.orders)) return 'unsourced';
  if (bucket === 'reserve' && lot.orders.length > 0) return 'netsuite';
  return 'unavailable';
};

/** The orders to show for this bucket — empty unless the source is real. */
export const ordersFor = (lot: ArchLot, bucket: ArchDetailKey): ArchLotOrder[] =>
  orderSource(lot, bucket) === 'netsuite' ? (lot.orders as ArchLotOrder[]) : [];

/**
 * Days between an ISO date and today, floored at 0; null when there is no date.
 *
 * ⚠️ PARSED AS LOCAL MIDNIGHT. `new Date('2026-08-20')` is UTC midnight, which
 * is the 19th everywhere west of Greenwich, so an order written today would read
 * as one day old in Montreal. The `T00:00:00` suffix is what makes it local, and
 * it is the same form ArchOpenOrdersView already uses for the same reason.
 *
 * Floored because a future `trandate` is possible (a back-dated batch, a
 * timezone edge) and "-1 d reserved" reads as a bug rather than as a date.
 */
export const ageDays = (iso: string | undefined | null, today: Date = new Date()): number | null => {
  if (!iso) return null;
  const then = new Date(`${iso}T00:00:00`);
  if (isNaN(then.getTime())) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const ms = start.getTime() - new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  return Math.max(0, Math.round(ms / 86400000));
};

/** An ISO date as "Aug 20, 2026", or an em dash. Local, for the reason above. */
export const formatOrderDate = (iso: string | undefined | null): string => {
  if (!iso) return NO_VALUE;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return NO_VALUE;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

/**
 * The trader's name for one order, or an em dash.
 *
 * Never "Unassigned": that word was the symptom of reading the null header rep,
 * and printing it here would make "nobody is named on the order" look identical
 * to "this role could not read the sublist". An em dash says only what is true.
 */
export const traderName = (o: ArchLotOrder): string => (o.rep || '').trim() || NO_VALUE;

/**
 * One panel row per (bundle, order).
 *
 * A bundle held by three orders becomes three rows, because the alternative is
 * to print one customer's name over another's reservation. 31 lots in this
 * sandbox are held by two or more open orders right now, one of them by 17, so
 * this is a measured case and not a hypothetical.
 */
export interface ArchReservedRow {
  lot: ArchLot;
  /** Null on the 'unavailable' and 'unsourced' branches. */
  order: ArchLotOrder | null;
  source: ArchOrderSource;
  /** This row's reserved quantity, rounded, in the parent row's unit. */
  qty: number;
  /** Days since the order was written; null when unknown. */
  age: number | null;
  /** 0-based position within this bundle's orders, and how many there are. */
  index: number;
  count: number;
}

/**
 * Rows for the Reserved panel, in the bundle order given.
 *
 * ── THE ROWS ADD UP TO THE FOOTER, EXACTLY ─────────────────────────────────
 * The footer total is the sum of `Math.round(lot.reserve)` and always has been.
 * Rounding each order's share independently does not have to reach that number:
 * two orders of 540.5 BF round to 541 + 541 = 1,082 against a bundle rounding to
 * 1,081. A panel whose visible rows do not sum to its own header is the exact
 * class of thing this screen has spent the week removing, and it would be blamed
 * on the data rather than on the formatter.
 *
 * ⚠️ SO THE SHARES ARE ALLOCATED BY LARGEST REMAINDER, not by letting the last
 * row absorb the difference. The simpler version — round the first n-1 and give
 * the remainder to the last — can go NEGATIVE: five orders of 0.5 BF against a
 * bundle rounding to 3 place 1+1+1+1 and leave the last row at −1. That is a
 * contrived quantity, and printing "−1 BF reserved" is exactly the kind of
 * confidently wrong number that gets reported as a bug. Largest remainder sums
 * to the target, never goes below zero, and is deterministic (ties break to the
 * earlier order, which is the older one).
 */
export const reservedRows = (lots: ArchLot[], today: Date = new Date()): ArchReservedRow[] => {
  const out: ArchReservedRow[] = [];
  lots.forEach((lot) => {
    const target = Math.round(lot.reserve || 0);
    const source = orderSource(lot, 'reserve');
    const orders = ordersFor(lot, 'reserve');
    if (!orders.length) {
      out.push({ lot, order: null, source, qty: target, age: null, index: 0, count: 1 });
      return;
    }
    const raw = orders.map((o) => Math.max(0, o.qty || 0));
    const sum = raw.reduce((s, n) => s + n, 0);
    let shares: number[];
    if (sum <= 0) {
      /* The orders claim nothing but the bundle reserves something: contradictory
         data, so it is shown on the oldest claim rather than silently vanishing. */
      shares = orders.map((_, i) => (i === 0 ? target : 0));
    } else {
      const ideal = raw.map((n) => (target * n) / sum);
      shares = ideal.map((n) => Math.floor(n));
      let short = target - shares.reduce((s, n) => s + n, 0);
      const byRemainder = ideal
        .map((n, i) => ({ i, frac: n - Math.floor(n) }))
        .sort((a, b) => (b.frac === a.frac ? a.i - b.i : b.frac - a.frac));
      for (let k = 0; short > 0 && k < byRemainder.length; k++, short--) shares[byRemainder[k].i]++;
    }
    orders.forEach((o, i) => {
      out.push({
        lot,
        order: o,
        source,
        qty: shares[i],
        age: ageDays(o.created, today),
        index: i,
        count: orders.length,
      });
    });
  });
  return out;
};

/**
 * One cell's worth of a value that may differ across a bundle's orders.
 *
 * The lot TABLE is one row per bundle by construction — the quantity block on it
 * describes the bundle, not an order — so it cannot expand the way the panel
 * does. It still must not silently pick one order: with two orders on a bundle
 * the SO # cell reads `SO-CWP-001344 +1` and its tooltip names both. Disclosed,
 * not hidden, and not fabricated.
 */
export const joinValues = (values: string[]): { text: string; title?: string } => {
  const distinct = [...new Set(values.map((v) => (v || '').trim()).filter(Boolean))];
  if (distinct.length === 0) return { text: NO_VALUE };
  if (distinct.length === 1) return { text: distinct[0] };
  return { text: `${distinct[0]} +${distinct.length - 1}`, title: distinct.join(', ') };
};

/**
 * The oldest reservation on a bundle, which is the one worth chasing.
 *
 * MAX and not the first entry: `orders` is sorted oldest first by the cache, but
 * this must stay correct if that sort ever changes, and "the age shown is the
 * oldest claim" is a statement a trader can rely on either way.
 */
export const oldestAge = (orders: ArchLotOrder[], today: Date = new Date()): number | null => {
  const ages = orders.map((o) => ageDays(o.created, today)).filter((n): n is number => n !== null);
  return ages.length ? Math.max(...ages) : null;
};

/**
 * True when at least one listed bundle still has NO source for its SO columns,
 * i.e. the placeholder banner has to stay up.
 *
 * Deliberately "any" and not "all". A panel that is half real and half generated
 * has to warn, and a mixed payload is not hypothetical: fixtures and live rows
 * can both be on screen during a cache rebuild.
 */
export const anyUnsourced = (lots: ArchLot[], bucket: ArchDetailKey = 'reserve'): boolean =>
  lots.some((l) => orderSource(l, bucket) === 'unsourced');

/**
 * True when a live payload lists a bundle it cannot attribute — the case that
 * earns a note of its own, because empty cells with no explanation read as a
 * bug.
 */
export const anyUnavailable = (lots: ArchLot[], bucket: ArchDetailKey = 'reserve'): boolean =>
  lots.some((l) => orderSource(l, bucket) === 'unavailable' && lotQuantity(l, bucket) > 0);
