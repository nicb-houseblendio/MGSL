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
  /*
   * 🔴 THIS PINNED THE WRONG MAPPING until 2026-09-16 and is why a 67/67 suite stayed
   * green through item 16's reversal. `entry('300','192')` is 300 BF to the CUSTOMER
   * and 192 back into stock, so the stock lot keeps 192 and the customer's new bundle
   * carries 300 -- the opposite of what this asserted.
   */
  ok('A: the quantities land on the right bundles, customer on the new one',
    o.customerLotBF === 300 && o.stockLotBF === 192, o);

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

/*
 * Feedback 6 item 16. Two changes, and they are one decision: the customer's piece
 * takes the new number and the wood staying in stock keeps the parent's.
 *
 *   "Le bundle client devient 314000-13-1 et le bundle qui retourne en
 *    inventaire garde son numero?"
 *
 * Verified on IA-CWP-729, the split behind SO-CWP-001369: it did the reverse.
 */
{
  const ex = repo('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archSplitExecute.js');
  ok('16: the ladder is numeric, the letters are gone',
    /candidate = parentName \+ '-' \+ i;/.test(ex) &&
      !/String\.fromCharCode\(66 \+ i\)/.test(ex), null);
  ok('16: the CUSTOMER line takes the child lot',
    /lot: divides \? 'child' : 'parent',/.test(ex), null);
  ok('16: the remainder is received back into the parent by name',
    /role: 'remainder'[\s\S]{0,140}lot: 'parent',/.test(ex), null);
  // The adjustment must follow the plan's marker, not the role: since the swap the
  // two no longer coincide, and reading the role is how they drift apart again.
  ok('16: the receipt follows the plan marker, not the role',
    /line\.lot === 'child'/.test(ex) && !/line\.role === 'remainder'/.test(ex), null);
  // Renaming the customer's piece is what forces this; without it the order would
  // reserve a lot that no longer holds the wood.
  ok('16: the sales order is repointed at the lot that holds the wood',
    /const syncAssignment = /.test(ex) && /value: childId,/.test(ex), null);
  ok('16: ...in DISPLAY units, which is a sales order, not an adjustment',
    /line: i, value: input\.customerQty,/.test(ex), null);
  ok('16: ...and it refuses rather than inventing an assignment',
    /it cannot be pointed at/.test(ex) && /The wood has moved; the order has not/.test(ex), null);
  // A full-bundle sale and a pure re-measure have nothing to tell apart.
  ok('16: no child is minted when the bundle does not divide',
    /const divides = input\.customerQty > 0 && input\.remainderQty > 0;/.test(ex), null);
  const sl = repo('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/sl/mcgi_sl_arch_split_execute.js');
  ok('16: the dry run does not promise a lot the write will not mint',
    /input\.customerQty > 0 && input\.remainderQty > 0/.test(sl), null);
}

/*
 * Item 16, adversarial pass. Renaming the customer's piece widened the window
 * between "the wood has moved" and "the order says so", and moved which physical
 * bundle carries the new number. Both are pinned here.
 */
{
  const ex = repo('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archSplitExecute.js');
  // Pending was called "the safe direction". It is safe for the screen and unsafe
  // for the stock: revalidate reads that same status to allow a re-run, which would
  // split the REMAINDER a second time.
  ok('16adv: a posted adjustment is stamped on the line before anything can throw',
    /const stampAdjustmentOnLine = /.test(ex) &&
      /stampAdjustmentOnLine\(input, adjustmentId\);/.test(ex), null);
  ok('16adv: ...and a stamped line that is not Done refuses a re-run',
    /Re-running would split the remainder a second time/.test(ex), null);
  ok('16adv: ...and the stamp writes the adjustment only, never the status',
    !/stampAdjustmentOnLine[\s\S]{0,700}F_SPLIT_STATUS/.test(ex), null);
  // A brand-new record in this account has already been invisible to a search
  // right after creation; a miss here throws with the wood already moved.
  /*
   * SUPERSEDED 2026-09-16 by the write-path audit. Reading it back off the record
   * was itself wrong: `receiptinventorynumber` holds the lot NAME, not an id, so
   * this threw on every dividing split. The assignment table is the id source, and
   * the name lookup survives only as the fallback for post-creation search lag.
   * See `audit D1` below.
   */
  ok('16adv: the minted lot id is looked up, never parsed out of a receipt row',
    /SELECT DISTINCT ia\.inventorynumber AS lotid/.test(ex) &&
      !/fieldId: 'receiptinventorynumber', line: j/.test(ex), null);
  // The loop sets each match to the full customer quantity, so two would reserve it twice.
  ok('16adv: two assignments on the parent are refused, not both repointed',
    /separate assignments/.test(ex) && /matches\.length !== 1/.test(ex), null);
  // The plan and the caller each decide from their own copy of the quantities.
  ok('16adv: the plan and the caller must agree that a child exists',
    /const childLines = plan\.lines\.filter/.test(ex) &&
      /Refusing to post: the cost plan has/.test(ex), null);

  const sheet = src('components/warehouse/SplitWorkOrder.tsx');
  // The sheet tells a worker to staple it to a bundle. Item 16 reversed which one
  // carries the new number, so the paper has to say so.
  ok('16adv: the printed sheet names which bundle takes the new number',
    /THE CUSTOMER&rsquo;S BUNDLE/.test(sheet) &&
      /the piece that ships/.test(sheet), null);
  ok('16adv: ...and prints the number the stock keeps, which IS known at print time',
    /The wood going back into stock keeps/.test(sheet), null);
}

/*
 * Feedback 6 item 17. "Le BF sur la ligne se modifie bien, par contre dans le INV
 * detail c'est toujours l'ancienne valeur." The line was trued up to the measured
 * figure and the reservation kept the ordered one, so the difference reserved
 * nothing. Measured 2026-09-15: 9 split-linked lines disagree, 297 BF, two of them
 * raised after the defect was first written up.
 */
{
  const ex = repo('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archSplitExecute.js');
  // The lot only moves when a child exists; the quantity moves every time. A
  // full-bundle sale and a pure re-measure mint no child and are exactly the cases
  // where the measurement is the only thing that changed.
  ok('17: the reservation is synced on EVERY split, not only when a lot is minted',
    /syncAssignment\(so, line, v, input, childLotName, adjustmentId\);/.test(ex) &&
      !/if \(childLotName\) syncAssignment/.test(ex), null);
  ok('17: ...the quantity write is unconditional inside it',
    /The QUANTITY moves every time/.test(ex) && /if \(childId\) \{/.test(ex), null);
  ok('17: a missing assignment stops a lot move and only logs a quantity sync',
    /left alone and still reserves the ordered figure/.test(ex), null);
  // An exception from the subrecord fetch lands AFTER the adjustment posted and
  // would walk straight past the decision about what is safe to leave behind.
  ok('17adv: the subrecord fetch is guarded, the way archOrderCreate guards it',
    /no readable inventory detail/.test(ex), null);
  // Level by CAUSE: this is exceptional, it leaves a record needing a human, and
  // the line is about to be marked Done over a reservation nobody will revisit.
  ok('17adv: leaving a reservation stale is an ERROR and says the line goes Done',
    /log\.error\('ARCH Split . reservation left stale'/.test(ex) &&
      /marked Done because the wood really was/.test(ex), null);
  // Deciding while writing means a refusal arrives after the record was changed,
  // and on the logging path those changes would be saved -- two assignments each
  // holding the full customer quantity, the opposite of the fix.
  ok('17: the matches are counted before anything is written',
    /const matches = \[\];/.test(ex) && /COUNT FIRST, WRITE SECOND/.test(ex), null);
}

/*
 * The direction, pinned where it renders as well as where it is computed. The
 * completion panel is what a warehouse worker reads to label physical wood, and
 * for one day it stated the rule correctly in prose and inverted it in the numbers
 * directly above.
 */
{
  const lib = src('lib/archSplit.ts');
  ok('16adv2: the customer takes the new bundle, stock keeps the parent number',
    /stockLotBF: s\.inventory,/.test(lib) && /customerLotBF: s\.customer,/.test(lib), null);
  const scr = src('components/warehouse/WarehouseSplitScreen.tsx');
  ok('16adv2:  ...and the panel puts each quantity on the bundle that holds it',
    /stays in\s*\n?\s*stock at.*o\.stockLotBF/s.test(scr) && /o\.customerLotBF/.test(scr), null);
  // The old names described the lot RECORD and stayed true only while the parent
  // number followed the customer's wood.
  ok('16adv2:  ...under names that cannot survive being reversed again',
    !/originalLotBF:/.test(lib) && !/newLotBF:/.test(lib), null);
}

/*
 * Write-path audit, 2026-09-16. Five defects in the split, four of them introduced
 * or widened by items 16 and 17 earlier the same day.
 */
{
  const ex = repo('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archSplitExecute.js');
  // `receiptinventorynumber` holds the lot NAME, not an id: measured on adjustment
  // 128223, line 2 reads "315643-6-B". Number() of that is NaN, so the first version
  // threw on EVERY dividing split, after the adjustment had committed.
  ok('audit D1: the minted lot id comes from the assignment table, not the record',
    /FROM inventoryassignment ia ' \+\s*\n?\s*'WHERE ia\.transaction = \? AND ia\.inventorynumber <> \?/.test(ex) &&
      !/getSublistValue\(\{\s*\n?\s*sublistId: 'inventoryassignment', fieldId: 'receiptinventorynumber'/.test(ex), null);
  // A re-tally moves a bundle by board feet, not by half of it. IA-CWP-731 issued
  // 1,348 BF and received back 570: 778 BF destroyed, and the GL check passed
  // because planSplitCost divides the value by whatever total it is given.
  ok('audit D3: a measured total far from on-hand is refused before anything posts',
    /const SPLIT_VARIANCE_CEILING = /.test(ex) && /drift > SPLIT_VARIANCE_CEILING/.test(ex), null);
  // lotId and locationId arrive in the request body and decide which wood is cut.
  ok('audit D4: the lot and the location must match the line being written',
    /does not reserve lot /.test(ex) && /ships from location /.test(ex), null);
  ok('audit D4:  ...joined on tl.id and filtered on the unique key, which differ',
    /tl\.id = ia\.transactionline ' \+/.test(ex) && /tl\.uniquekey = \?/.test(ex), null);
  // Counting only the assignments naming the split lot let a two-lot line through,
  // and the repoint then made the assignments sum to more than the line.
  ok('audit D6: a line reserving more than one lot is refused',
    /matches\.length !== 1 \|\| count !== 1/.test(ex), null);
  ok('audit D10: the department comes from the order, never from the caller',
    /departmentId: rows\[0\]\.departmentid,/.test(ex) &&
      !/input\.departmentId \|\|/.test(ex), null);
}

/*
 * The pre-write claim, 2026-09-16. Until this, the only re-run guard was the
 * adjustment id stamped AFTER the adjustment, in a save that is best effort, so two
 * concurrent posts both read Pending and both cut the bundle.
 */
{
  const ex = repo('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archSplitExecute.js');
  const q  = repo('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archSplitQueue.js');
  const list = repo('src/Objects/lists/customlist_mgsl_split_status.xml');
  // Order is the whole point: claim then post fails closed, post then claim fails open.
  ok('claim: the line is claimed BEFORE the adjustment is posted',
    /claimLine\(input\);[\s\S]{0,400}adjustmentId = postSplitAdjustment/.test(ex), null);
  ok('claim: ...and a claim that cannot be written stops the split',
    /could not be claimed, so nothing was adjusted/.test(ex), null);
  // Nothing was posted, so the job is genuinely safe to retry.
  ok('claim: ...and a failed adjustment releases it back to Pending',
    /setLineStatus\(input, STATUS_PENDING\)/.test(ex), null);
  ok('claim: a claimed line refuses a second run rather than resuming',
    /STATUS_INPROGRESS = 'In progress'/.test(ex) &&
      /This bundle is already being split/.test(ex), null);
  // The list can gain a fourth value without this file being edited again.
  ok('claim: an unknown status is refused too',
    /statusText !== STATUS_PENDING/.test(ex), null);
  // The queue drops it automatically; silence is the part that needed fixing.
  ok('claim: the queue counts claimed-but-unfinished splits instead of hiding them',
    /inProgress:         stuckLines\.length/.test(q) &&
      /splits claimed and not finished/.test(q), null);
  ok('claim: the list value exists in the repo object',
    /<value>In progress<\/value>/.test(list), null);
}

console.log(fail ? '# FAIL ' + fail : '# archSplitLotName ok');
if (fail) process.exitCode = 1;
