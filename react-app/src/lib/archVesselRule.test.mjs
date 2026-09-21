/**
 * The Lot Vessel rule, Feedback 9 item 2.
 *
 * Marc-Antoine, 2026-09-17: "Container : Sur un IA est-ce qu'on peut feed a
 * partir de custbody5 (lot Vessel)". He is right about the field. Measured
 * account-wide, `custbody5` holds real ship names on adjustments outside ARCH:
 * ULTRA YORKSHIRE, SAGA ANDORINHA, SAGA FRAM, SEA WAVE, JNS LAKE, KARLINO, and
 * one honest "Inbound Truck".
 *
 * 🔴 BUT ALL 210 VESSEL-BEARING ARCH ADJUSTMENTS CARRY THE LOT'S OWN PREFIX
 * INSTEAD (lot 314307-1535, vessel "314307"), and by his OWN earlier answer that
 * number is the PO: « le 316027 c'est le numéro du PO qu'on utilise dans notre
 * nomenclature du bundle » (2026-08-19). The builder's `poFromLotNo` carries a
 * capitalised warning never to let that value reach `containerNo`, because it
 * would ship a column headed Container full of PO numbers, and that is why the
 * column was pulled off the main grid in August. Two of his instructions
 * collide; the prefix refusal is what satisfies both.
 *
 * ── Why this file executes the builder's source instead of a copy ───────────
 * The REFUSAL path has 210 real rows behind it and is verified live. The ACCEPT
 * path has none, because no ARCH adjustment carries a genuine vessel yet, so
 * "0 containers on screen" cannot distinguish a rule that refuses correctly from
 * one that returns '' unconditionally. That is the same trap that hid
 * `costUsdPartial` being dead code on item 1.
 *
 * Seeding a real vessel was the obvious way to close it and turned out to be
 * impossible: there is no record-write tooling in this repo (SuiteQL is
 * SELECT-only in both accounts), so it would have meant deploying a writer into
 * a sandbox the client is actively testing in. Extracting the rule and calling it
 * is strictly cheaper and strictly safer.
 *
 * ⚠️ This reads the SHIPPED FUNCTION out of the builder and evaluates it, rather
 * than restating the logic here. A restatement would only ever test the
 * restatement, which is how a test comes to agree with itself about a bug.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Same resolution as archUiGuards: this file sits in react-app/src/lib, and the
// builder is three levels up. Anchored to the module URL rather than cwd, so the
// test does not depend on where it is invoked from.
const here = dirname(fileURLToPath(import.meta.url));
const MR = join(here, '..', '..', '..',
  'src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js');

let fail = 0;
const ok = (name, cond, got) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};

const src = readFileSync(MR, 'utf8');

/*
 * The extraction is deliberately anchored and brittle. If someone renames the
 * rule or changes its shape, this fails loudly rather than silently testing
 * nothing — a test that quietly stops covering its subject is worse than no
 * test, and `archUiGuards` has been bitten by exactly that.
 */
const START = 'const vesselOrBlank = (lotNo, vessel) => {';
const i = src.indexOf(START);
ok('the rule is still a pure named function in the builder', i !== -1, i);
if (i === -1) {
  console.log('\nFAIL 1 (extraction anchor gone — fix the anchor, do not delete the test)');
  process.exit(1);
}

// Walk braces from the opening one so the body is taken exactly, comments and all.
const open = src.indexOf('{', i);
let depth = 0;
let end = -1;
for (let p = open; p < src.length; p++) {
  if (src[p] === '{') depth++;
  else if (src[p] === '}') {
    depth--;
    if (depth === 0) { end = p; break; }
  }
}
ok('...and its body is balanced and extractable', end !== -1, end);

const body = src.slice(open + 1, end);
// eslint-disable-next-line no-new-func
const vesselOrBlank = new Function('lotNo', 'vessel', body);

ok('the extracted function is callable', typeof vesselOrBlank === 'function');

/* ── 1. THE ACCEPT PATH. This is the half no live row exercises. ─────────── */

ok('a real vessel name survives and is returned verbatim',
  vesselOrBlank('314307-1535', 'ULTRA YORKSHIRE') === 'ULTRA YORKSHIRE',
  vesselOrBlank('314307-1535', 'ULTRA YORKSHIRE'));
ok('...for every vessel name actually present in this account',
  ['SAGA ANDORINHA', 'SAGA FRAM', 'SEA WAVE', 'JNS LAKE', 'SZARE SZEREGI', 'KARLINO',
   'Trawind Dolphin', 'SEA BREEZE', 'YASA LOTUS', 'EVA MASTER', 'Western Stabaek',
   'SAGA PIONEER', 'Inbound Truck']
    .every((v) => vesselOrBlank('315688-10', v) === v));
ok('...and case is preserved, not upper-cased for display',
  vesselOrBlank('315688-10', 'Trawind Dolphin') === 'Trawind Dolphin',
  vesselOrBlank('315688-10', 'Trawind Dolphin'));
ok('...and surrounding whitespace is trimmed off',
  vesselOrBlank('315688-10', '  SEA WAVE  ') === 'SEA WAVE',
  vesselOrBlank('315688-10', '  SEA WAVE  '));

/* ── 2. THE REFUSAL PATH, which is what 210 live rows do ─────────────────── */

ok('the lot prefix is refused, which is all 210 ARCH rows today',
  vesselOrBlank('314307-1535', '314307') === '', vesselOrBlank('314307-1535', '314307'));
ok('...on every real prefix/lot pair measured',
  [['314307-1535', '314307'], ['314331-1568', '314331'], ['315301-1', '315301'],
   ['314837-179625', '314837'], ['314742-315937-1', '314742'], ['314876-836425', '314876']]
    .every(([lot, v]) => vesselOrBlank(lot, v) === ''));
ok('...case-insensitively, so a lower-case prefix cannot slip past',
  vesselOrBlank('ABC-1', 'abc') === '', vesselOrBlank('ABC-1', 'abc'));

/* ── 3. The numeric-substring hole the prefix test alone leaves open ─────── */

ok('an all-digit value MID-lot-number is refused too',
  vesselOrBlank('001326-2', '1326') === '', vesselOrBlank('001326-2', '1326'));
ok('...which the prefix test alone would have let through',
  '001326-2'.indexOf('1326') === 2);
ok('but an unrelated numeric reference is KEPT, not blanket-refused',
  vesselOrBlank('315688-10', '55946') === '55946', vesselOrBlank('315688-10', '55946'));
ok('...and a letter-prefixed code is kept when it is not the lot prefix',
  vesselOrBlank('315688-10', 'A89') === 'A89', vesselOrBlank('315688-10', 'A89'));

/* ── 4. Absence, and nothing here may throw ──────────────────────────────── */

ok('no vessel reads as no vessel', vesselOrBlank('315688-10', null) === '');
ok('...undefined too', vesselOrBlank('315688-10', undefined) === '');
ok('...and an empty or whitespace-only value', vesselOrBlank('315688-10', '   ') === '');
ok('a missing lot number does not throw and does not invent a vessel',
  vesselOrBlank(null, 'SEA WAVE') === 'SEA WAVE', vesselOrBlank(null, 'SEA WAVE'));
ok('...and both missing is simply empty', vesselOrBlank(null, null) === '');
ok('a numeric zero vessel is treated as absent, not as the string "0"',
  vesselOrBlank('315688-10', 0) === '', vesselOrBlank('315688-10', 0));

console.log(fail ? `\nFAIL ${fail}` : '\nall vessel-rule assertions hold');
process.exit(fail ? 1 : 0);
