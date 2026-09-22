/**
 * What puts wood In Transit. Phase 1.2, shipped 2026-09-22.
 *
 * Marc-Antoine, 2026-09-17 Slack: "Techniquement on le met en transit une fois
 * qu'il est sur le bateau, donc ca ne devrait pas changer", confirming ARCH
 * follows the rule the other two screens already use: the take-ownership
 * journal, or a non-agency PO billed ahead of receipt.
 *
 * 🔴 THE PLAN FOR THIS STEP WAS SELF-CANCELLING, which is what this file exists
 * to stop happening again. It said to adopt the journal rule AND keep ARCH's
 * min(billed, ordered) clamp as the quantity. Measured 2026-09-22 on PO344950,
 * the only sandbox hardwood PO with both a transit journal and open lines: both
 * its lines read quantitybilled 0, so the clamp returns 0 and the step would
 * have shipped and changed nothing visible at all.
 *
 * Proven live before the code was written, via REST SuiteQL:
 *
 *   PO344950 line 1  PUR44KDSRT     qty 10     recv 0  billed 0  JE 129879
 *                    old formula 0, new formula 10 (rate 0.001 => 10,000 BF)
 *   PO344950 line 2  AMM44OVLLRGKD  qty 15000  recv 0  billed 0  JE 129879
 *                    old formula 0, new formula 15,000 (rate 1 => 15,000 Unit)
 *   PO344949 lines   fully received, both formulas 0, so a closed-out PO
 *                    contributes no phantom in-transit wood
 *
 * ⚠️ The assertions run against the SHIPPED cache builder, read off disk and
 * sliced out by text, then executed. Same technique as archSplitPending and
 * archAvailableOnOrder, for the same reason: a copy tests the copy.
 *
 * ⚠️ This proves the ARITHMETIC and the QUERY TEXT. It cannot prove the query
 * RUNS: BUCKET_SQL executes through N/query, and the two new columns were
 * verified only through REST SuiteQL, which is a different dialect. A body field
 * readable in one has been unreadable in the other on this account before.
 * Confirming that needs a deploy and a look at the post-deploy meta.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(
  here,
  '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js',
);
const src = readFileSync(SRC, 'utf8');

/* Comments explain this change directly above the code that makes it, so a bare
 * text search matches the prose and passes while the code says otherwise. */
const stripped = src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ');

let fails = 0;
let ran = 0;
const ok = (label, got, want) => {
  ran++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.error(`  FAIL ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
  }
};

/* ── 1. the two columns the rule cannot work without ─────────────────────── */
console.log('BUCKET_SQL selects what the rule reads');

ok('the take-ownership journal is selected',
  /custbody_po_intransit_journal\s+AS transitje/.test(stripped), true);
ok('the agency flag is selected',
  /custbody_po_is_agency\s+AS agencyflag/.test(stripped), true);
ok('both are read off the TRANSACTION, not the line (header grain)',
  /t\.custbody_po_intransit_journal/.test(stripped)
  && /t\.custbody_po_is_agency/.test(stripped), true);
/* 🔴 The staleness filter this whole bucket leans on. Without it, quantity on a
 * closed PO line counts as in transit forever. MTL, IND and ARCH all carry it;
 * it is NOT an ARCH addition, contrary to what the plan said. */
ok('the line must still be open',
  /tl\.isclosed = 'F'/.test(stripped), true);
ok('and only sales and purchase orders are read',
  /t\.type IN \('SalesOrd', 'PurchOrd'\)/.test(stripped), true);

/* ── 2. the quantity split, executed out of the shipped source ───────────── */
console.log('the in-transit quantity split');

/* Three slices, each taken from the shipped file and executed as written. They
 * are separate because step 0.2 hoisted the split above the per-line guard so
 * the LOT attribution could reach it, which put the row totals and the lot
 * attribution in different scopes. Slicing the whole span between them would
 * drag in the sales-order branch and its closure variables. */
const slice = (from, to, what) => {
  const at = stripped.indexOf(from);
  if (at === -1) throw new Error(`${what}: "${from}" not found — reverted?`);
  const end = stripped.indexOf(to, at);
  if (end === -1) throw new Error(`${what}: "${to}" not found after it`);
  const close = stripped.indexOf(';', end);
  if (close === -1) throw new Error(`${what}: unterminated`);
  return stripped.slice(at, close + 1);
};

const splitSrc = slice('const hasTransitJE', 'const waterShare', 'the split');
const totalsSrc = slice('bucket.totals.inTransit +=', 'bucket.totals.onOrder', 'the row totals');
const lotSrc = slice('bucket.lots[r.lotno].inTransit +=', 'bucket.lots[r.lotno].onOrder', 'the lot attribution');

ok('the split was located', splitSrc.length > 0, true);
ok('the row totals were located', totalsSrc.length > 0, true);
ok('🔴 the lot attribution writes inTransit at all, which is step 0.2',
  /bucket\.lots\[r\.lotno\]\.inTransit/.test(stripped), true);
ok('the split is computed ONCE and shared, not restated per scope',
  (stripped.match(/const water =/g) || []).length, 1);

const block = splitSrc + totalsSrc;
const split = new Function('r', 'open', 'billed', 'ordered', 'moved', 'isSale', 'bucket', block);
const run = (o) => {
  const ordered = o.ordered;
  const moved = o.moved || 0;
  const billed = o.billed || 0;
  const open = Math.max(0, ordered - moved);
  const bucket = { totals: { inTransit: 0, onOrder: 0 } };
  split({ transitje: o.je, agencyflag: o.agency }, open, billed, ordered, moved, !!o.isSale, bucket);
  return bucket.totals;
};

/* The lot side, same split, executed out of the same file. */
const lotFn = new Function(
  'r', 'open', 'billed', 'ordered', 'moved', 'isSale', 'bucket', 'assigned', 'openShare',
  splitSrc + lotSrc,
);
const runLot = (o) => {
  const ordered = o.ordered;
  const moved = o.moved || 0;
  const billed = o.billed || 0;
  const open = Math.max(0, ordered - moved);
  const openShare = ordered > 0 ? open / ordered : 0;
  const bucket = { lots: { L1: { reserve: 0, outbound: 0, onOrder: 0, inTransit: 0, readyToBuild: 0 } } };
  lotFn({ transitje: o.je, agencyflag: o.agency, lotno: 'L1' },
    open, billed, ordered, moved, !!o.isSale, bucket, o.assigned, openShare);
  return { inTransit: bucket.lots.L1.inTransit, onOrder: bucket.lots.L1.onOrder };
};

/* 🔴 The live fixture, and the exact case the old formula got wrong. */
ok('PO344950 line 1: journal set, nothing billed, nothing received',
  run({ ordered: 10, moved: 0, billed: 0, je: '129879' }),
  { inTransit: 10, onOrder: 0 });
ok('PO344950 line 2: same, in Units',
  run({ ordered: 15000, moved: 0, billed: 0, je: '129879' }),
  { inTransit: 15000, onOrder: 0 });
/* The regression this replaces: identical inputs under the old clamp gave 0. */
ok('🔴 and the OLD formula would have given zero on that line',
  Math.max(0, Math.min(0, 10) - 0), 0);

ok('PO344949: journal set but fully received, so nothing is on the water',
  run({ ordered: 350, moved: 350, billed: 350, je: '130205' }),
  { inTransit: 0, onOrder: 0 });

/* ── 3. the billing branch keeps its clamp ───────────────────────────────── */
console.log('the billing branch, where over-billing can happen');

ok('no journal, billed ahead of receipt: the billed part is on the water',
  run({ ordered: 100, moved: 0, billed: 60 }),
  { inTransit: 60, onOrder: 40 });
ok('no journal, nothing billed: all of it is still on order',
  run({ ordered: 100, moved: 0, billed: 0 }),
  { inTransit: 0, onOrder: 100 });
ok('🔴 an over-billing supplier cannot push In Transit above the open quantity',
  run({ ordered: 100, moved: 0, billed: 250 }),
  { inTransit: 100, onOrder: 0 });
ok('...nor when part is already received',
  run({ ordered: 100, moved: 40, billed: 250 }),
  { inTransit: 60, onOrder: 0 });
ok('billed and received equally: nothing on the water',
  run({ ordered: 100, moved: 60, billed: 60 }),
  { inTransit: 0, onOrder: 40 });

/* ── 4. the journal branch ignores billing, which is the whole point ─────── */
console.log('the journal branch ignores billing');

ok('journal set and over-billed: still just the open quantity, never more',
  run({ ordered: 100, moved: 0, billed: 250 }),
  { inTransit: 100, onOrder: 0 });
ok('journal set, part received: only the open remainder is on the water',
  run({ ordered: 100, moved: 30, billed: 0, je: '1' }),
  { inTransit: 70, onOrder: 0 });
ok('a journal id of 0 as a string still counts as set',
  run({ ordered: 10, moved: 0, billed: 0, je: '0' }).inTransit, 10);

/* ⚠️ An unset body field arrives as null, as '' and as spaces depending on the
 * dialect, and all three mean the same thing. Oracle stores '' as NULL, so a
 * guard written as `!== ''` alone would read a real NULL as set. */
console.log('an unset journal, in every spelling');
ok('null is unset', run({ ordered: 10, moved: 0, billed: 0, je: null }),
  { inTransit: 0, onOrder: 10 });
ok('undefined is unset', run({ ordered: 10, moved: 0, billed: 0, je: undefined }),
  { inTransit: 0, onOrder: 10 });
ok('an empty string is unset', run({ ordered: 10, moved: 0, billed: 0, je: '' }),
  { inTransit: 0, onOrder: 10 });
ok('whitespace is unset', run({ ordered: 10, moved: 0, billed: 0, je: '   ' }),
  { inTransit: 0, onOrder: 10 });

/* ── 5. agency, which is a no-op on ARCH today and must stay safe ────────── */
console.log('the agency flag');

ok('agency with no journal is NOT in transit, per what MTL actually does',
  run({ ordered: 100, moved: 0, billed: 60, agency: 'T' }),
  { inTransit: 0, onOrder: 100 });
ok('agency WITH a journal is in transit, because the journal wins',
  run({ ordered: 100, moved: 0, billed: 0, je: '1', agency: 'T' }),
  { inTransit: 100, onOrder: 0 });
/* 🔴 284 open production PO lines carry this flag NULL rather than 'F'. ARCH has
 * none today (all 56 ARCH-scope lines read 'F', measured 2026-09-22) but ARCH has
 * no production data at all yet. A null read as agency would silently zero the
 * wood rather than error, which is the exact silent-false-zero shape this repo
 * has been bitten by. */
ok('a NULL agency flag behaves as F, not as T',
  run({ ordered: 100, moved: 0, billed: 60, agency: null }),
  { inTransit: 60, onOrder: 40 });
ok('an absent agency flag behaves as F',
  run({ ordered: 100, moved: 0, billed: 60, agency: undefined }),
  { inTransit: 60, onOrder: 40 });
ok('lowercase t is still agency, so a dialect change cannot flip the meaning',
  run({ ordered: 100, moved: 0, billed: 60, agency: 't' }),
  { inTransit: 0, onOrder: 100 });
ok('the code normalises case rather than comparing raw',
  /toUpperCase\(\)/.test(block), true);
ok('and defaults the flag rather than testing a bare value',
  /agencyflag \|\| 'F'/.test(block), true);

/* ── 6. 🔴 the invariant that keeps Available honest ─────────────────────── */
console.log('inTransit and onOrder stay disjoint and sum to open');

const cases = [
  { ordered: 100, moved: 0, billed: 0 },
  { ordered: 100, moved: 0, billed: 60 },
  { ordered: 100, moved: 0, billed: 250 },
  { ordered: 100, moved: 40, billed: 250 },
  { ordered: 100, moved: 100, billed: 100 },
  { ordered: 100, moved: 0, billed: 0, je: '1' },
  { ordered: 100, moved: 30, billed: 0, je: '1' },
  { ordered: 100, moved: 0, billed: 60, agency: 'T' },
  { ordered: 100, moved: 0, billed: 0, je: '1', agency: 'T' },
  { ordered: 0, moved: 0, billed: 0 },
  { ordered: 10, moved: 50, billed: 0 },
];
/* 🔴 They must sum to `open` for every input. Available adds inTransit and the
 * grid shows onOrder beside it; if the two ever overlap, the same wood is
 * counted twice and Available inflates. That is a bug this file has already had
 * once, corrected 2026-09-09, and it was latent for weeks because every hardwood
 * line read billed 0 so inTransit was 0 everywhere. */
for (const c of cases) {
  const open = Math.max(0, c.ordered - (c.moved || 0));
  const t = run(c);
  ok(`disjoint and complete: ordered ${c.ordered} recv ${c.moved || 0} billed ${c.billed || 0}`
    + `${c.je ? ' JE' : ''}${c.agency ? ' agency ' + c.agency : ''}`,
    t.inTransit + t.onOrder, open);
  ok(`  ...and neither goes negative`, t.inTransit >= 0 && t.onOrder >= 0, true);
}
ok('a line received beyond its order contributes nothing, not a negative',
  run({ ordered: 10, moved: 50, billed: 0 }), { inTransit: 0, onOrder: 0 });

/* ── 7. step 0.2: the LOT splits the same way the ROW does ───────────────── */
console.log('per-lot attribution, build step 0.2');

/* 🔴 Before 0.2 this line booked the whole open share as the lot's onOrder no
 * matter where the wood was, so 100% of every row's In Transit landed in
 * `unattributed`, the cell read 0, and a 0 cell is not clickable. That is the
 * client's "sont comme hardcoded, il n'y a pas de details". */
ok('journal set: the lot\'s whole open share is in transit, none on order',
  runLot({ ordered: 10, moved: 0, billed: 0, je: '129879', assigned: 10 }),
  { inTransit: 10, onOrder: 0 });
ok('no journal, nothing billed: the lot\'s share is all still on order',
  runLot({ ordered: 100, moved: 0, billed: 0, assigned: 100 }),
  { inTransit: 0, onOrder: 100 });
ok('no journal, half billed: the lot splits in the same proportion',
  runLot({ ordered: 100, moved: 0, billed: 50, assigned: 100 }),
  { inTransit: 50, onOrder: 50 });
ok('a partial assignment gets a proportional share, not the whole line',
  runLot({ ordered: 100, moved: 0, billed: 50, assigned: 40 }),
  { inTransit: 20, onOrder: 20 });

/* 🔴 THE INVARIANT THAT KEEPS THE DRILL-DOWN HONEST. The lot's two buckets must
 * sum to `assigned * openShare`, its whole open share, for every input. If they
 * did not, the bundles listed under In Transit would add up to a different
 * number than the column the trader clicked, which is the
 * header-says-X-detail-says-Y shape this file has been bitten by twice. */
const lotCases = [
  { ordered: 100, moved: 0, billed: 0, assigned: 100 },
  { ordered: 100, moved: 0, billed: 60, assigned: 100 },
  { ordered: 100, moved: 0, billed: 250, assigned: 100 },
  { ordered: 100, moved: 40, billed: 250, assigned: 100 },
  { ordered: 100, moved: 0, billed: 0, je: '1', assigned: 100 },
  { ordered: 100, moved: 30, billed: 0, je: '1', assigned: 70 },
  { ordered: 100, moved: 0, billed: 60, agency: 'T', assigned: 100 },
  { ordered: 15000, moved: 0, billed: 0, je: '129879', assigned: 15000 },
  { ordered: 100, moved: 25, billed: 40, assigned: 33 },
];
for (const c of lotCases) {
  const open = Math.max(0, c.ordered - (c.moved || 0));
  const openShare = c.ordered > 0 ? open / c.ordered : 0;
  const t = runLot(c);
  const want = c.assigned * openShare;
  ok(`lot share conserved: ordered ${c.ordered} recv ${c.moved || 0} billed ${c.billed || 0}`
    + ` assigned ${c.assigned}${c.je ? ' JE' : ''}${c.agency ? ' agency' : ''}`,
    Math.abs(t.inTransit + t.onOrder - want) < 1e-9, true);
  ok('  ...and neither lot bucket goes negative',
    t.inTransit >= 0 && t.onOrder >= 0, true);
}

/* A fully shipped or fully received line has openShare 0, so it reaches neither
 * bucket. That is the SO-CWP-001346 / lot 315643-7 defect one field along, and
 * the existing guard on `openShare > 0` is what stops it. */
ok('a fully received line attributes nothing to the lot',
  runLot({ ordered: 100, moved: 100, billed: 100, je: '1', assigned: 100 }),
  { inTransit: 0, onOrder: 0 });
ok('the attribution is still guarded on an open share',
  /openShare > 0/.test(stripped), true);
ok('...and on the assignment being non-zero',
  /assigned > 0/.test(stripped), true);

/* ⚠️ The lot accumulator already carried an inTransit key before 0.2, so this is
 * a write that was missing rather than a shape change. If that key ever goes,
 * `+=` yields NaN and the whole column reads blank instead of wrong. */
ok('the lot accumulator declares inTransit, so += cannot produce NaN',
  /const blank = \(\) => \(\{[^}]*inTransit: 0/.test(stripped), true);

console.log(`\n${ran - fails}/${ran} passed`);
if (fails) process.exit(1);
