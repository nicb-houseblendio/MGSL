/**
 * The split's child lot number is the SERVER'S answer, never the client's guess.
 *
 * What went wrong. `nextSplitLotNo()` returned `` `${lotNo}-${priorSplits + 1}` ``
 * and that string reached three surfaces, one of them the printed SPLIT / LOT
 * SHEET the warehouse staples to the new bundle. NetSuite never created it. The
 * server mints `<lot>-B`, then `-C`, walking past every sibling name already
 * taken (`archSplitExecute.js` `nextChildLotNumber`), and it returns the real
 * name as `childLot`. That value existed and was spent on a toast string while
 * the result panel recomputed the wrong one locally.
 *
 * Why the wrong one is dangerous rather than untidy. The numeric `-N` suffix is
 * RECEIVING's namespace, not a split marker. Measured on Marc-Antoine's own
 * screen 2026-09-10 at [11:50]: one 2,000 BF purchase order line of BEM84AD
 * carrying lots `12345` AND `12345-1`, 1,000 BF each, two different physical
 * bundles. His receiving reports do the same, `315946-1` through `315946-15`.
 * So a split printing `<lot>-1` can label wood with the number of a bundle that
 * already exists, or one that has not landed yet.
 *
 * What this file pins:
 *
 *   A. `splitOutcome` invents nothing. No server answer means no name at all
 *   B. it passes the server's answer through verbatim, letter ladder included
 *   C. the predictor is gone from the module and cannot be imported back
 *   D. the three render sites cannot print a client-derived name, and the
 *      screen actually feeds them `res.childLot`
 *   E. the cache MR keeps a second bundle from the SAME capture, and only says
 *      "more than one capture" when that is true
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitOutcome } from './archSplit.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(here, '..', rel), 'utf8');
const repo = (rel) => readFileSync(join(here, '..', '..', '..', rel), 'utf8');

let fail = 0;
const ok = (name, cond, got) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};

const bundle = (lotNo, systemBF) => ({
  lotNo,
  itemDescription: 'Purpleheart 4/4 KD',
  species: 'Purpleheart',
  containerNo: '',
  unit: 'BF',
  systemBF,
  requestedBF: 300,
});
const entry = (customerBF, inventoryBF) => ({ customerBF, inventoryBF });

/* ── A. Nothing is invented ────────────────────────────────────────────────*/
{
  const o = splitOutcome(bundle('316027-4-B', 492), entry('300', '192'));
  ok('A: no server answer yields no child lot name', o.newLotNo === null, o.newLotNo);
  ok('A: the quantities are still reported in full',
    o.originalLotBF === 300 && o.newLotBF === 192, o);

  // The specific string that used to be produced, on the specific shape that makes
  // it a collision: a lot whose base already carries receiving's numeric sequence.
  const r = splitOutcome(bundle('12345', 2000), entry('1000', '1000'));
  ok('A: a split of 12345 does not claim 12345-1, which is a real sibling bundle',
    r.newLotNo !== '12345-1' && r.newLotNo === null, r.newLotNo);
}

/* ── B. The server's answer passes through ─────────────────────────────────*/
{
  const o = splitOutcome(bundle('315643-14', 492), entry('300', '192'), '315643-14-B');
  ok('B: the server name is used verbatim', o.newLotNo === '315643-14-B', o.newLotNo);

  // The server walks the alphabet when -B is taken, so the client must not assume
  // the first letter either.
  const c = splitOutcome(bundle('315643-14', 492), entry('300', '192'), '315643-14-C');
  ok('B: a later letter is carried unchanged, not normalised to -B',
    c.newLotNo === '315643-14-C', c.newLotNo);

  // A name the client would never have derived at all.
  const odd = splitOutcome(bundle('316027-4-B', 492), entry('300', '192'), '316027-4-B Leon');
  ok('B: a name outside any convention is still reported as-is',
    odd.newLotNo === '316027-4-B Leon', odd.newLotNo);
}

/* ── C. The predictor cannot come back ─────────────────────────────────────*/
{
  const s = src('lib/archSplit.ts');
  const live = s
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .join('\n');
  ok('C: no exported nextSplitLotNo remains', !/export const nextSplitLotNo/.test(s));
  ok('C: no template literal appends a numeric suffix to a lot in live code',
    !/\$\{lotNo\}-\$\{/.test(live), null);
  ok('C: and the deletion is explained rather than silent',
    /nextSplitLotNo\(\)`? WAS HERE AND IS DELETED/.test(s) && /11:50/.test(s), null);
}

/* ── D. The render sites ───────────────────────────────────────────────────*/
{
  const sheet = src('components/warehouse/SplitWorkOrder.tsx');
  const screen = src('components/warehouse/WarehouseSplitScreen.tsx');

  ok('D: the printed sheet no longer imports the predictor',
    !/nextSplitLotNo/.test(sheet), null);
  ok('D: the printed sheet leaves NEW LOT # blank, like LOT BF above it',
    /NEW LOT #/.test(sheet) && /Assigned by NetSuite when this split is recorded/.test(sheet), null);
  ok('D: the sheet identifies itself by the lot being SPLIT',
    /<Chip>\{b\.lotNo\}<\/Chip>/.test(sheet), null);

  ok('D: the screen captures the server name per parent lot',
    /childByParent\.set\(b\.lotNo, res\.childLot\)/.test(screen), null);
  ok('D: and feeds it into the outcome rather than recomputing',
    /splitOutcome\(b, entryFor\(job, b\.lotNo\), childByParent\.get\(b\.lotNo\)/.test(screen), null);
  ok('D: the panel omits the name when there is none instead of printing a blank',
    /\{o\.newLotNo && </.test(screen) &&
      /NetSuite assigns its lot number when the split is recorded/.test(screen), null);

  // The fixture path writes nothing, so it must not name a lot either.
  ok('D: the fixture path passes no third argument',
    /if \(!left\) setResult\(\{ job, outcomes: job\.bundles\.map\(\(b\) => splitOutcome\(b, entryFor\(job, b\.lotNo\)\)\) \}\);/.test(screen),
    null);
}

/* ── E. The cache MR keeps every bundle a document gives one lot ───────────*/
{
  const mr = repo(
    'src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js'
  );

  ok('E: a second bundle from the SAME capture is kept, not dropped',
    /if \(held && held\.captureId === r\.captureid\) \{\s*\n\s*held\.bundles\.push\(b\);/.test(mr), null);
  ok('E: the map is seeded with the first bundle rather than an empty array',
    /bundles:\s*\[b\],/.test(mr) && !/bundles:\s*\[\],/.test(mr), null);
  ok('E: "more than one capture" is only reachable across captures',
    /if \(held\) \{\s*\n\s*log\.audit\('ARCH tally lot claimed twice'/.test(mr), null);

  // The reason the branch exists, so nobody deletes it as redundant.
  ok('E: the same-capture branch names the document that proves it happens',
    /09230-13/.test(mr) && /02PS000198/.test(mr), null);
}

console.log(fail ? '# FAIL ' + fail : '# archSplitLotName ok');
if (fail) process.exitCode = 1;
