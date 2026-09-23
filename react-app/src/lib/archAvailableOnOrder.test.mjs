/**
 * What Available counts, and what it must not. Phase 0.1, 2026-09-22.
 *
 * Marc-Antoine on the 2026-09-14 status call [17:15]: "On order c'est juste pour
 * avoir une visibilite sur qu'est-ce qu'on a commande, tu sais en termes de
 * volume, mais je peux juste commencer a le vendre quand il est in transit a peu
 * pres."
 *
 * 🔴 AVAILABLE MEANS WHAT THE ORDER ENDPOINT WILL ACCEPT. Both `onOrder` and
 * `inTransit` were removed from it on 2026-09-22, and the second removal is the
 * one worth explaining, because an earlier version of this file argued for
 * keeping it.
 *
 * The client does call in-transit wood sellable. This code cannot sell it:
 *   - `isLotLocked` is `commitmentOn(lot) > 0 || !hasArrived(lot)`
 *   - `hasArrived` is `(lot.onHand || 0) > 0`
 *   - `archOrderCreate` compares the wanted quantity against
 *     `inventorynumberlocation.quantityonhand`, which is 0 on wood at sea
 * So counting in-transit volume in Available reproduced the exact defect this
 * change exists to remove, on the same two bundles, one bucket along: the header
 * offered 10,000 BF and 15,000 Unit that the checkbox disabled and the server
 * refused. It returns to Available when phases 2.4 to 2.6 land, together with
 * `hasArrived`, `isSellableView` and the oversell gate, never on its own.
 *
 * Measured on the live sandbox cache 2026-09-22: Available goes 507,106 BF to
 * 445,664 BF, a drop of 61,442 BF, plus 15,000 Unit off AMM44OVLLRGKD.
 *
 * ⚠️ THE FORMULA IS EXTRACTED FROM THE SHIPPED SOURCE AND EXECUTED, not restated
 * here. An earlier version of this file declared its own copy, and an agent
 * proved the consequence: putting `onOrder` back into the server formula left
 * this file reporting 42 of 43 passing, with every assertion in the section
 * titled "the arithmetic" green while the server said the opposite. A copy tests
 * the copy. Same technique as `archSplitPending.test.mjs`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  availabilityStatus,
  lotQuantity,
  isLotLocked,
  lockReason,
} from './archLots.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

const CACHE = read(
  '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js',
);
const SERVICE = read(
  '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service_arch.js',
);
const FIXTURES = read('./archFixtures.ts');
const LOTS = read('./archLots.ts');

/* ⚠️ Strip comments before asserting on code. Every file above explains this
 * change in prose directly above the code that implements it, so a bare text
 * search matches the explanation and passes while the code says the opposite.
 * That has produced two false green guards in this repo already. */
const code = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

let fails = 0;
let ran = 0;
const ok = (label, got, want) => {
  ran++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.error(`  FAIL ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
  }
};

/* ── 1. the shipped formula, extracted and EXECUTED ───────────────────────── */
console.log('the server available formula, executed out of the shipped source');

const formulaText = (() => {
  const src = code(CACHE);
  const at = src.indexOf('available:');
  if (at === -1) throw new Error('available: not found in the ARCH cache builder');
  const open = src.indexOf('Math.max(', at);
  if (open === -1 || open - at > 40) throw new Error('available: is no longer a Math.max expression');
  let depth = 0;
  for (let i = src.indexOf('(', open); i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1).replace(/\s+/g, ' ');
    }
  }
  throw new Error('unbalanced parentheses in the available formula');
})();

/* 🔴 This is the whole point of the file. The shipped expression is compiled and
 * run against inputs. If someone puts `onOrder` or `inTransit` back, these
 * assertions fail on VALUES, not just on a text search that a reformat defeats. */
const available = new Function(
  'onHand', 'onOrder', 'inTransit', 'reserve', 'readyToBuild', 'outbound', 'held',
  'return ' + formulaText,
);
const av = (o) => available(
  o.onHand || 0, o.onOrder || 0, o.inTransit || 0,
  o.reserve || 0, o.readyToBuild || 0, o.outbound || 0, o.held || 0,
);

ok('the formula compiles and runs', typeof available, 'function');
ok('plain on-hand stock is available', av({ onHand: 500 }), 500);
ok('🔴 on-order wood is NOT available', av({ onHand: 0, onOrder: 5000 }), 0);
ok('🔴 in-transit wood is NOT available either, because nothing can sell it',
  av({ onHand: 0, inTransit: 5000 }), 0);
ok('🔴 nor both together', av({ onHand: 0, onOrder: 5000, inTransit: 5000 }), 0);
ok('on hand beside on order counts only the on-hand part',
  av({ onHand: 3600, onOrder: 7384 }), 3600);
ok('on hand beside in transit counts only the on-hand part',
  av({ onHand: 20000, inTransit: 10000 }), 20000);
ok('reserve is subtracted', av({ onHand: 500, reserve: 200 }), 300);
ok('readyToBuild is subtracted', av({ onHand: 500, readyToBuild: 200 }), 300);
ok('held is subtracted', av({ onHand: 500, held: 200 }), 300);
/* 🔴 REVERSED BY FEEDBACK 10. The 2026-09-08 rule ("outbound is NOT subtracted")
 * was right for shipped wood. For ARC, outbound is now the open share of orders
 * ticked Ready to Ship: still on hand, still sold, so it IS a claim. */
ok('outbound (Ready to Ship, still on hand) IS subtracted, since Feedback 10',
  av({ onHand: 500, outbound: 200 }), 300);
ok('...and all three claims together', av({ onHand: 900, reserve: 100, readyToBuild: 200, outbound: 300 }), 300);
ok('it floors at zero', av({ onHand: 100, reserve: 900 }), 0);
ok('an over-reserved row does not go negative', av({ onHand: 0, reserve: 900 }), 0);

/* The live rows this change moves, run through the shipped formula. */
console.log('the live rows, through the shipped formula');
ok('AFM44KD @ Bluelinx  3,285 -> 285', av({ onHand: 285, onOrder: 3000 }), 285);
ok('BLI44KD @ CWP Prevost  10,984 -> 3,600', av({ onHand: 3600, onOrder: 7384 }), 3600);
ok('BOC44KD @ Bluelinx  11,290 -> 4,990', av({ onHand: 4990, onOrder: 6300 }), 4990);
ok('AFM54KD @ Ambassador  3,000 -> 0, on-order only', av({ onHand: 0, onOrder: 3000 }), 0);
/* 🔴 The two journal-backed rows. Phase 1.2 moves their quantity from onOrder to
 * inTransit; neither term is in the formula, so they drop either way. An earlier
 * revision claimed these two would not move at all. */
ok('PUR44KDSRT @ Prevost (PBF)  30,000 -> 20,000', av({ onHand: 20000, inTransit: 10000 }), 20000);
ok('AMM44OVLLRGKD @ Prevost (PBF)  60,798 -> 45,798', av({ onHand: 45798, inTransit: 15000 }), 45798);

/* ── 2. 🔴 the upstream filter that keeps the zeroed rows on screen ───────── */
console.log('the row filter that keeps the zeroed rows visible');

/* ⚠️ Anchored on the greaterThanZero gate, NOT on the first `r.onHand` in the
 * file: `computeTotals` earlier reads `r.onHand` and then `r.available` two
 * lines later, so a naive window lands there and tests the wrong function. */
const filter = (() => {
  const src = code(SERVICE);
  const gate = src.indexOf('greaterThanZero !== false');
  if (gate === -1) throw new Error('the greaterThanZero gate is gone from the ARCH service');
  const at = src.indexOf('.filter(', gate);
  const end = src.indexOf('> 0);', at);
  if (at === -1 || end === -1) throw new Error('the greaterThanZero gate no longer filters a sum');
  return src.slice(at, end + 5).replace(/\s+/g, ' ');
})();

ok('the filter sums the RAW buckets, not the derived available',
  /r\.onHand/.test(filter) && !/r\.available/.test(filter), true);
ok('🔴 onOrder is STILL in the filter sum, which is what keeps the zeroed rows on screen',
  /r\.onOrder/.test(filter), true);
ok('🔴 and inTransit is too', /r\.inTransit/.test(filter), true);
ok('reserve is in the filter sum', /r\.reserve/.test(filter), true);
ok('outbound is in the filter sum', /r\.outbound/.test(filter), true);

/* ── 3. the fixture generator must not drift from the server ──────────────── */
console.log('the fixture generator carries its own copy of the formula');

const fixFormula = (() => {
  const m = code(FIXTURES).match(/available:\s*Math\.max\([^\n]*\)/);
  return m ? m[0].replace(/\s+/g, ' ') : '';
})();
ok('the fixture formula was located', fixFormula.length > 0, true);
ok('🔴 the fixture dropped onOrder too, or a demo disagrees with the server',
  !/\bonOrder\b/.test(fixFormula), true);
ok('🔴 and inTransit', !/\binTransit\b/.test(fixFormula), true);

/* ── 4. the front-end cascade, which decides the Available LOT LIST ──────── */
console.log('availabilityStatus, the Available drill-down list');

const cascade = (() => {
  const src = code(LOTS);
  const at = src.indexOf('export const availabilityStatus');
  if (at === -1) throw new Error('availabilityStatus not found');
  const end = src.indexOf('\n};', at);
  return src.slice(at, end === -1 ? at + 800 : end);
})();

ok('🔴 the On Order rung is gone from the cascade', !/'On Order'/.test(cascade), true);
ok('🔴 the In Transit rung is gone too', !/'In Transit'/.test(cascade), true);
ok('the On Hand rung remains', /'On Hand'/.test(cascade), true);
ok('a held lot still short-circuits to null', /onHold/.test(cascade), true);

const lot = (over) => ({
  lotNo: 'T-1', onHand: 0, onOrder: 0, inTransit: 0, reserve: 0,
  readyToBuild: 0, outbound: 0, onHold: false, ...over,
});

const onOrderBundle = lot({ onOrder: 3000 });
const inTransitBundle = lot({ inTransit: 500 });

ok('an on-order bundle reports no availability',
  availabilityStatus(onOrderBundle), null);
ok('an in-transit bundle reports no availability either',
  availabilityStatus(inTransitBundle), null);
ok('neither contributes to the Available drill-down',
  [lotQuantity(onOrderBundle, 'available'), lotQuantity(inTransitBundle, 'available')], [0, 0]);

/* 🔴 The visibility half of his instruction. He asked to SEE incoming wood and
 * not to be able to sell it. If a change ever hides it from its own bucket too,
 * that breaks what he asked for and one of these fails. */
ok('🔴 on-order wood is STILL visible under On Order, at its full quantity',
  lotQuantity(onOrderBundle, 'onOrder'), 3000);
ok('🔴 in-transit wood is STILL visible under In Transit',
  lotQuantity(inTransitBundle, 'inTransit'), 500);
ok('the on-order bundle still explains itself with the Ord badge',
  lockReason(onOrderBundle)?.badge, 'Ord');
ok('the in-transit bundle keeps its own badge, not the on-order one',
  lockReason(inTransitBundle)?.badge, 'Trns');

/* 🔴 The consistency the whole change is for: the header and the checkbox now
 * agree. Anything inside Available must be tickable; anything locked must be
 * outside it. */
ok('🔴 everything locked is now OUTSIDE Available, which is the point',
  [isLotLocked(onOrderBundle), lotQuantity(onOrderBundle, 'available'),
    isLotLocked(inTransitBundle), lotQuantity(inTransitBundle, 'available')],
  [true, 0, true, 0]);

const arrived = lot({ onHand: 690 });
ok('arrived stock is sellable and available', [isLotLocked(arrived), lotQuantity(arrived, 'available')], [false, 690]);
ok('...and reports On Hand', availabilityStatus(arrived)?.label, 'On Hand');

const partly = lot({ onHand: 690, reserve: 200 });
ok('a partly committed bundle is locked whole, per the client',
  isLotLocked(partly), true);
ok('...but still shows its free volume in the list, which is the row total\'s business',
  lotQuantity(partly, 'available'), 490);

/* ── 5. the empty state a zeroed Available row now shows ─────────────────── */
console.log('the Available empty state explains itself');

/* 🔴 Twelve live rows fell to Available 0 while still carrying incoming wood,
 * and their drawer said only "No bundles in this status": true, and useless
 * beside a grid line reading 3,000 BF On Order. Before this change those bundles
 * were listed there. Neither existing branch could say it, because `gap` is
 * max(0, header - lots) and both sides are 0 here. Verified on screen against
 * AFM54KD @ Ambassador Services International, 2026-09-22. */
const TABLE = read('../components/arch/ArchLotTable.tsx');
const tableCode = code(TABLE);

ok('the Available empty state has a branch for incoming wood',
  /bucket === 'available' && incomingOnRow > 0/.test(tableCode), true);
ok('...and it names the quantity rather than saying nothing',
  /incoming, on order or in transit/.test(TABLE), true);
ok('...derived from the ROW, because the lot list is empty in exactly this case',
  /const incomingOnRow = \(row\.onOrder \|\| 0\) \+ \(row\.inTransit \|\| 0\)/.test(tableCode), true);
ok('the generic message still exists for rows with genuinely nothing',
  /'No bundles in this status'/.test(tableCode), true);
/* 🔴 And the In Transit tab must NOT reach the seeded generator any more. */
ok('🔴 the lot table can no longer call the demo ETA generator',
  /lotIncomingInfo/.test(tableCode), false);

console.log(`\n${ran - fails}/${ran} passed`);
if (fails) process.exit(1);
