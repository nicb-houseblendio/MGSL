/**
 * `isPending` from archSplitQueue.js — which split lines the warehouse queue serves.
 *
 * Marc-Antoine reported this at [11:06] on the 2026-09-21 call, alongside the Open
 * SO tab: "Meme chose bundle split." The Open SO half was a department-scope bug.
 * This half was a status filter that required 'Pending' when nothing sets 'Pending'
 * on a line a trader ticks in the NetSuite UI.
 *
 * 🔴 The dangerous direction here is NOT the empty queue, it is the opposite. The
 * file's own history records a stale job that would have had `archSplitExecute`
 * post an inventory adjustment of +89 BF against a lot whose wood had already
 * shipped and been billed, INVENTING Purpleheart. So these guards care most about
 * what must STAY out: Done, In progress, and anything the upstream staleness
 * filters would have caught.
 *
 * ⚠️ Extracted from the shipped source by brace-walking, not copied. Same technique
 * as archDepartmentResolve and archMillingFreight, and for the same reason: a copy
 * tests the copy.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(
  here,
  '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archSplitQueue.js',
);
const src = readFileSync(SRC, 'utf8');

/* ── the status constants, read from the source rather than restated ──────── */
const constOf = (name) => {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*'([^']*)'`));
  if (!m) throw new Error(`${name} not found in archSplitQueue.js`);
  return m[1];
};
const STATUS_PENDING = constOf('STATUS_PENDING');
const STATUS_INPROGRESS = constOf('STATUS_INPROGRESS');

/* ── extract the arrow function body ─────────────────────────────────────── */
const START = 'const isPending = (r) => {';
const at = src.indexOf(START);
if (at === -1) throw new Error('isPending not found — did the fix get reverted?');
let depth = 0;
let end = -1;
for (let i = src.indexOf('{', at + START.length - 1); i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const body = src.slice(at + START.length, end - 1);
const isPending = new Function('r', 'STATUS_PENDING', body).bind(null);
const call = (status) => isPending({ splitstatus: status }, STATUS_PENDING);

let fails = 0;
let ran = 0;
const ok = (label, got, want) => {
  ran++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.error(`  FAIL ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
  }
};

console.log('isPending — the bundle split queue');

/* ── the bug: a UI-ticked line carries no status ──────────────────────────── */
ok('a blank status IS pending (the six ARC jobs)', call(''), true);
ok('null is pending', call(null), true);
ok('undefined is pending', call(undefined), true);
ok('whitespace only is pending', call('   '), true);
ok('an explicit Pending is pending', call(STATUS_PENDING), true);

/* ── 🔴 what must never enter the queue ──────────────────────────────────── */
ok('Done is NOT pending', call('Done'), false);
ok('In progress is NOT pending', call(STATUS_INPROGRESS), false);
ok('  and In progress is a distinct constant, not a blank', STATUS_INPROGRESS !== '', true);

/* An unrecognised status must fail CLOSED. A status nobody anticipated showing up
 * as warehouse work is how the stale +89 BF job would have been executed. */
ok('an unknown status is NOT pending', call('Cancelled'), false);
ok('a typo of Pending is NOT pending', call('pending '), false);
ok('  nor a different case', call('PENDING'), false);

/* ── the constants themselves ─────────────────────────────────────────────── */
console.log('constants');
ok('STATUS_PENDING is the list label, not an id', STATUS_PENDING, 'Pending');
ok('STATUS_INPROGRESS is the list label', STATUS_INPROGRESS, 'In progress');

/* ── and the staleness filters this fix RELIES ON must still be upstream ─── */
console.log('the upstream staleness filters this fix depends on');
ok('the ORDER must still be open (both status spellings)',
  /t\.status NOT IN \('G','H','C','SalesOrd:G','SalesOrd:H','SalesOrd:C'\)/.test(src), true);
ok('the LINE must be unshipped',
  /ABS\(NVL\(tl\.quantityshiprecv, 0\)\) = 0/.test(src), true);
ok('only split-flagged lines are considered',
  /tl\.custcol_mgsl_split = 'T'/.test(src), true);
// ⚠️ The optional backslashes are not decoration. That line is written with
// escaped quotes in the source (`'  AND tl.mainline = \\'F\\' '`), so a regex
// expecting bare quotes reports the filter missing when it is right there.
ok('mainline is excluded', /tl\.mainline = \\?'F\\?'/.test(src), true);
/*
 * 🔴 This is the load-bearing assertion of the whole file. Blank-as-pending is
 * only safe because 18 of the 24 blank-status lines in the account are stale and
 * are removed by the two filters above. If either is ever dropped, this fix turns
 * into 15 jobs against billed wood.
 */
ok('both staleness filters present together, which is what makes blank safe',
  /t\.status NOT IN/.test(src) && /quantityshiprecv/.test(src), true);

console.log(`\n${ran - fails}/${ran} passed`);
if (fails) process.exit(1);
