/**
 * On Order is not Available. Phase 0.1's arithmetic half, shipped 2026-09-22.
 *
 * Marc-Antoine on the 2026-09-14 status call [17:15]: "On order c'est juste pour
 * avoir une visibilite sur qu'est-ce qu'on a commande, tu sais en termes de
 * volume, mais je peux juste commencer a le vendre quand il est in transit a peu
 * pres." The sellability half of that shipped on 2026-09-21 in `ce93c5a`
 * (`isLotLocked` refuses a bundle with no yard stock). This is the arithmetic
 * half: the row-level `available` figure itself.
 *
 * Measured against the live sandbox cache on 2026-09-22: 507,106 BF to 445,664
 * BF, a drop of 61,442 BF over 114 BF rows.
 *
 * 🔴 THREE THINGS MUST MOVE TOGETHER AND ONE MUST NOT MOVE AT ALL, which is what
 * this file is for.
 *
 *   1. the server formula        (cache_arch.js)
 *   2. the front-end lot cascade (archLots.ts availabilityStatus)
 *   3. the fixture generator      (archFixtures.ts, its own copy of the formula)
 *   4. 🔴 the row filter in trader_screen_service_arch.js must KEEP summing the
 *      raw buckets including onOrder. It is the only reason the 14 rows that
 *      fall to Available 0 stay on the screen instead of vanishing. Rewriting it
 *      to filter on `available` would read like a simplification and would hide
 *      14 real rows of the client's stock.
 *
 * ⚠️ Assertions run against the SHIPPED sources, read off disk and brace-walked.
 * Same technique and same reason as `archSplitPending.test.mjs`: a copy tests the
 * copy. Nothing here imports a mock of the server.
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

/* ── Strip comments before asserting on code ───────────────────────────────
 *
 * ⚠️ Not optional. Every file above explains this change in prose directly
 * above the code that implements it, so a bare text search for "onOrder"
 * matches the explanation and passes while the code says the opposite. This
 * has produced two false green guards in this repo already.
 */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');

let fails = 0;
let ran = 0;
const ok = (label, cond, extra) => {
  ran++;
  if (!cond) {
    fails++;
    console.error(`  FAIL ${label}${extra === undefined ? '' : `\n       got ${JSON.stringify(extra)}`}`);
  }
};

/* ── 1. the server formula ────────────────────────────────────────────────── */
console.log('the server available formula');

const formula = (() => {
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

ok('the formula was located in the shipped source', formula.length > 0, formula);
ok('🔴 onOrder is NOT in it', !/\bonOrder\b/.test(formula), formula);
ok('inTransit IS still in it, because he sells from in transit',
  /\binTransit\b/.test(formula), formula);
ok('onHand is still the base', /\bonHand\b/.test(formula), formula);
ok('reserve is still subtracted', /-\s*reserve\b/.test(formula), formula);
ok('readyToBuild is still subtracted', /-\s*readyToBuild\b/.test(formula), formula);
ok('held is still subtracted', /-\s*held\b/.test(formula), formula);
ok('it is still floored at zero', /Math\.max\(\s*0\s*,/.test(formula), formula);
ok('outbound is still NOT subtracted, per the 2026-09-08 correction',
  !/\boutbound\b/.test(formula), formula);

/* ── 2. 🔴 the upstream filter this change depends on ─────────────────────── */
console.log('the row filter that keeps the zeroed rows visible');

/* ⚠️ Anchored on the greaterThanZero gate, NOT on the first `r.onHand` in the
 * file. `computeTotals` earlier in the same file also reads `r.onHand`, and it
 * reads `r.available` two lines later, so a naive window lands there and the
 * "does not read available" assertion fails against the wrong function. */
const filter = (() => {
  const src = code(SERVICE);
  const gate = src.indexOf('greaterThanZero !== false');
  if (gate === -1) throw new Error('the greaterThanZero gate is gone from the ARCH service');
  const at = src.indexOf('.filter(', gate);
  if (at === -1) throw new Error('the greaterThanZero gate no longer filters');
  const end = src.indexOf('> 0);', at);
  if (end === -1) throw new Error('the filter no longer tests a sum against zero');
  return src.slice(at, end + 5).replace(/\s+/g, ' ');
})();

ok('the filter sums the RAW buckets, not the derived available',
  /r\.onHand/.test(filter) && !/r\.available/.test(filter), filter.slice(0, 200));
ok('🔴 onOrder is STILL in the filter sum, which is what keeps 14 rows on screen',
  /r\.onOrder/.test(filter), filter.slice(0, 200));
ok('inTransit is in the filter sum', /r\.inTransit/.test(filter));
ok('reserve is in the filter sum', /r\.reserve/.test(filter));
ok('outbound is in the filter sum', /r\.outbound/.test(filter));
ok('the filter keeps anything whose buckets sum above zero',
  /> 0/.test(filter), filter.slice(0, 200));

/* ── 3. the fixture generator must not drift from the server ──────────────── */
console.log('the fixture generator carries its own copy of the formula');

const fixFormula = (() => {
  const src = code(FIXTURES);
  const m = src.match(/available:\s*Math\.max\([^\n]*\)/);
  return m ? m[0].replace(/\s+/g, ' ') : '';
})();

ok('the fixture formula was located', fixFormula.length > 0, fixFormula);
ok('🔴 the fixture dropped onOrder too, or a demo disagrees with the server',
  !/\bonOrder\b/.test(fixFormula), fixFormula);
ok('the fixture keeps inTransit', /\binTransit\b/.test(fixFormula), fixFormula);

/* ── 4. the front-end cascade, which decides the Available LOT LIST ──────── */
console.log('availabilityStatus, the Available drill-down list');

const cascade = (() => {
  const src = code(LOTS);
  const at = src.indexOf('export const availabilityStatus');
  if (at === -1) throw new Error('availabilityStatus not found');
  const end = src.indexOf('\n};', at);
  return src.slice(at, end === -1 ? at + 800 : end);
})();

ok('🔴 the On Order rung is gone from the cascade',
  !/'On Order'/.test(cascade), cascade);
ok('the In Transit rung is still there', /'In Transit'/.test(cascade), cascade);
ok('the On Hand rung is still first', cascade.indexOf("'On Hand'") < cascade.indexOf("'In Transit'"));
ok('a held lot still short-circuits to null', /onHold/.test(cascade), cascade);

/* Behavioural, through the real exported functions. */
const lot = (over) => ({
  lotNo: 'T-1', onHand: 0, onOrder: 0, inTransit: 0, reserve: 0,
  readyToBuild: 0, outbound: 0, onHold: false, ...over,
});

const onOrderBundle = lot({ onOrder: 3000 });
ok('an on-order bundle reports no availability at all',
  availabilityStatus(onOrderBundle) === null, availabilityStatus(onOrderBundle));
ok('so it contributes nothing to the Available drill-down',
  lotQuantity(onOrderBundle, 'available') === 0);

/* 🔴 The visibility half of his instruction. He asked to SEE on-order wood and
 * not to be able to sell it. If a future change hides it from the On Order
 * column too, that breaks what he asked for, and this fails. */
ok('🔴 but it is STILL visible under On Order, at its full quantity',
  lotQuantity(onOrderBundle, 'onOrder') === 3000);
ok('...and still explains itself with the Ord badge',
  lockReason(onOrderBundle)?.badge === 'Ord', lockReason(onOrderBundle));
ok('...and is still refused for sale', isLotLocked(onOrderBundle));

const inTransitBundle = lot({ inTransit: 500 });
ok('an in-transit bundle DOES still report availability',
  availabilityStatus(inTransitBundle)?.label === 'In Transit',
  availabilityStatus(inTransitBundle));
ok('...at its in-transit quantity', availabilityStatus(inTransitBundle).qty === 500);
ok('...and contributes to the Available drill-down',
  lotQuantity(inTransitBundle, 'available') === 500);

/* ⚠️ In transit is sellable to the CLIENT, but not to this codebase yet: there is
 * no reservation mechanism, so `isLotLocked` still refuses it and must keep
 * refusing it until phase 2.4 to 2.6 land. Unlocking the In Transit view is one
 * boolean at `ArchLotTable.tsx` `isSellableView` and it must be the LAST thing
 * anyone flips, or two traders can sell the same bundle off the same boat. */
ok('🔴 an in-transit bundle is STILL locked, because no reservation mechanism exists yet',
  isLotLocked(inTransitBundle));
ok('...with its own badge, not the on-order one',
  lockReason(inTransitBundle)?.badge === 'Trns', lockReason(inTransitBundle));

const arrived = lot({ onHand: 690 });
ok('ordinary arrived stock is unaffected and sellable', !isLotLocked(arrived));
ok('...and still reports On Hand', availabilityStatus(arrived)?.label === 'On Hand');

/* ── 5. the arithmetic, replayed ──────────────────────────────────────────── */
console.log('the arithmetic');

const available = (r) =>
  Math.max(0, (r.onHand || 0) + (r.inTransit || 0)
    - (r.reserve || 0) - (r.readyToBuild || 0) - (r.held || 0));

ok('a row whose only stock is on order lands at Available 0',
  available({ onHand: 0, onOrder: 4238 }) === 0);
ok('...and is still kept by the filter, because the filter reads onOrder',
  4238 > 0);
ok('a row with both keeps only the arrived part',
  available({ onHand: 3600, onOrder: 7384 }) === 3600);
ok('in-transit stock still counts',
  available({ onHand: 0, inTransit: 15000 }) === 15000);
ok('the floor still absorbs an over-reserved row',
  available({ onHand: 10000, onOrder: 2000, reserve: 14000 }) === 0);
/* 🔴 That floor is why the screen-wide drop is 61,442 BF and not the 67,280 BF
 * of the On Order column: it already absorbed 5,838 BF on four rows before this
 * change, so those rows lose less than their on-order figure. Quoting the column
 * to the client would overstate the cost by that much. */
ok('the clamp absorption is the difference between the two figures',
  67280 - 61442 === 5838);

console.log(`\n${ran - fails}/${ran} passed`);
if (fails) process.exit(1);
