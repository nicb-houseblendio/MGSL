/**
 * A bundle split must not create money.
 *
 * Marc-Antoine, 2026-09-09: "Je remarque que ca fait un impact GL. Il faudrait
 * que l'impact GL net a 0. (IA-CWP-595). On se retrouve avec plus de mbf apres
 * le split, donc le $/bf devrait diminuer."
 *
 * He is describing a real defect and he found it on a real record. Until today
 * `postSplitAdjustment` posted two lines and set no unit cost at all, so
 * NetSuite priced the receipt off the item's own estimate. Measured against the
 * two adjustments this code has ever made in the sandbox:
 *
 *   IA-CWP-595 (126870)  -82 BF and +100 BF, both at rate 2740   -> +$49.32
 *   IA-CWP-467 (126451)  -0.645 at 12250, +0.645 at 12990        -> +$477.30
 *
 * $526.62 invented, all of it offset to account 612 (9999997 Temp Inventory),
 * an other-current-asset account, which is the only reason it never showed up
 * in the P&L.
 *
 * What this file pins:
 *
 *   A. the arithmetic conserves value, on his own numbers and on the second
 *      record's, and the OLD two-line shape provably does not
 *   B. a short tally, a long tally, a whole-bundle sale and a pure re-measure
 *      all conserve value too, because a rate change absorbs them
 *   C. an uncostable lot is REFUSED, never priced by guess
 *   D. the record actually written is three lines, the issue line carries no
 *      unit cost, the customer's wood returns to the PARENT lot by name, and
 *      only the remainder mints a lot
 *   E. the unit cost goes in on the same basis as the quantity on its line,
 *      and a run that fails to conserve value logs at ERROR rather than
 *      reporting success
 *
 * The module is loaded through a four-line AMD `define` shim, the same way
 * archLotOrders.test.mjs loads the cache MR.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
/*
 * Set ARCH_SPLIT_PRE to a directory holding the pre-change archSplitExecute.js
 * and every section below reads from there instead of the repo. That is how the
 * failing-before output in the commit message was produced.
 */
const PRE = process.env.ARCH_SPLIT_PRE || '';
const SPLIT_JS = PRE
  ? join(PRE, 'archSplitExecute.js')
  : join(
    here, '..', '..', '..', 'src', 'FileCabinet', 'SuiteScripts',
    'mcgi_services', 'trader_screen', 'shared', 'archSplitExecute.js',
  );

let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('ok - ' + name); return; }
  fail += 1;
  console.log('not ok - ' + name + (detail === undefined ? '' : '  << ' + JSON.stringify(detail)));
};
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

/* ── the AMD shim ─────────────────────────────────────────────────────────── */

const loadSplit = ({ lotCosts = {}, recordFake = null, logSink = null } = {}) => {
  const sink = logSink || { audit: [], error: [], debug: [] };
  const fakes = {
    'N/record': recordFake || { create: () => { throw new Error('no record fake'); }, Type: { INVENTORY_ADJUSTMENT: 'invadj' } },
    'N/query': {
      runSuiteQL: () => ({ asMappedResults: () => [] }),
    },
    'N/runtime': { getCurrentScript: () => ({ getParameter: () => null }) },
    'N/log': {
      audit: (t, d) => sink.audit.push(String(t) + ' | ' + String(d)),
      error: (t, d) => sink.error.push(String(t) + ' | ' + String(d)),
      debug: (t, d) => sink.debug.push(String(t) + ' | ' + String(d)),
    },
    '/SuiteScripts/MCGI_LIB_LotCost': {
      getLotCostsAtLocation: (ids) => {
        const out = {};
        ids.forEach((id) => { out[String(id)] = Object.prototype.hasOwnProperty.call(lotCosts, String(id)) ? lotCosts[String(id)] : null; });
        return out;
      },
    },
  };
  let exported = null;
  const define = (deps, factory) => { exported = factory(...deps.map((d) => fakes[d])); };
  new Function('define', fs.readFileSync(SPLIT_JS, 'utf8'))(define);
  return { mod: exported, sink };
};

const { mod } = loadSplit();
const { planSplitCost } = mod;

/* ════ A. value is conserved, on the records he actually looked at ═════════ */

{
  // His own worked example, from IA-CWP-595: lot 315093-27, 307 BF at $2.74/BF.
  const plan = planSplitCost(307, 2.74, 225, 100);

  ok('A: the opening value is the lot value he quoted, 841.18',
    near(plan.openingValue, 841.18), plan.openingValue);
  ok('A: 307 BF becomes the measured 325, so the rate must fall',
    plan.totalAfter === 325 && plan.newUnitCost < 2.74,
    { totalAfter: plan.totalAfter, newUnitCost: plan.newUnitCost });
  ok('A: the new rate is the 2.59 he predicted, to the cent',
    near(plan.newUnitCost, 2.59, 0.005), plan.newUnitCost);
  ok('A: the three lines net to zero, which is the whole request',
    near(plan.residual, 0, 0.01), plan.residual);

  const issue = plan.lines.find((l) => l.role === 'issue');
  const cust  = plan.lines.find((l) => l.role === 'customer');
  const rem   = plan.lines.find((l) => l.role === 'remainder');

  ok('A: three lines, not two, because NetSuite will not issue below cost',
    plan.lines.length === 3, plan.lines.map((l) => l.role));
  ok('A: line 1 issues the WHOLE lot, his 307, not the 82 net delta',
    issue.qty === -307, issue.qty);
  ok('A: line 2 is the customer quantity he measured',
    cust.qty === 225, cust.qty);
  ok('A: line 3 is the remainder',
    rem.qty === 100, rem.qty);
  ok('A: both receipts carry the SAME new rate, so neither child is favoured',
    cust.unitCost === rem.unitCost, [cust.unitCost, rem.unitCost]);
  ok('A: the two receipts add back to the opening value',
    near(cust.expectedAmount + rem.expectedAmount, plan.openingValue, 0.01),
    { cust: cust.expectedAmount, rem: rem.expectedAmount, opening: plan.openingValue });

  /*
   * The OLD shape, reconstructed exactly: parentDelta = customerQty - onHand,
   * child = remainderQty, and NO unit cost, so both lines post at the parent's
   * own rate. This is the assertion that fails before the change.
   */
  const oldDrift = ((225 - 307) * 2.74) + (100 * 2.74);
  ok('A: the OLD two-line shape drifts by the $49.32 he saw on IA-CWP-595',
    near(oldDrift, 49.32, 0.01), oldDrift);
  ok('A: and the new shape does not',
    Math.abs(plan.residual) < Math.abs(oldDrift) / 100,
    { now: plan.residual, before: oldDrift });
}

{
  // IA-CWP-467, the worse of the two: 645 BF of ZEB84KD at $12.25/BF was
  // repriced to lastpurchaseprice 12.99 on the way into the child lot.
  const plan = planSplitCost(645, 12.25, 0, 645);
  ok('A: the second record conserves 7,901.25 as well',
    near(plan.openingValue, 7901.25) && near(plan.residual, 0, 0.01),
    { opening: plan.openingValue, residual: plan.residual });
  ok('A: a pure re-measure keeps the rate where it was',
    near(plan.newUnitCost, 12.25, 0.0001), plan.newUnitCost);
  ok('A: and it is TWO lines, because a zero-quantity line is rejected by NS',
    plan.lines.length === 2, plan.lines.map((l) => l.role + ' ' + l.qty));

  const oldDrift = (645 * 12.99) - (645 * 12.25);
  ok('A: the OLD shape drifted by the measured $477.30 here',
    near(oldDrift, 477.3, 0.01), oldDrift);
}

/* ════ B. a tally that disagrees with the book still conserves value ══════ */

{
  // Short tally: the warehouse found less wood than NetSuite believed. The
  // dollars cannot vanish with it, so the rate has to rise.
  const short = planSplitCost(307, 2.74, 200, 80);
  ok('B: a SHORT tally raises the rate rather than writing value off',
    short.totalAfter === 280 && short.newUnitCost > 2.74,
    { totalAfter: short.totalAfter, newUnitCost: short.newUnitCost });
  ok('B: and still nets to zero',
    near(short.residual, 0, 0.01), short.residual);

  // Long tally: more wood than the book. Same value, lower rate.
  const long = planSplitCost(307, 2.74, 260, 100);
  ok('B: a LONG tally lowers the rate rather than inventing value',
    long.totalAfter === 360 && long.newUnitCost < 2.74,
    { totalAfter: long.totalAfter, newUnitCost: long.newUnitCost });
  ok('B: and still nets to zero',
    near(long.residual, 0, 0.01), long.residual);

  // The whole bundle goes to the customer: no remainder, no child lot.
  const whole = planSplitCost(307, 2.74, 307, 0);
  ok('B: a whole-bundle sale is two lines and conserves value',
    whole.lines.length === 2 && near(whole.residual, 0, 0.01) &&
      near(whole.newUnitCost, 2.74, 0.0001),
    { lines: whole.lines.length, residual: whole.residual, rate: whole.newUnitCost });

  // A rate of 1 (Each and Unit, two of the three ARCH unit types) must behave
  // identically. These are the cases that hide a unit error.
  const each = planSplitCost(40, 118.5, 25, 18);
  ok('B: a rate-1 unit type conserves value the same way',
    near(each.openingValue, 4740) && near(each.residual, 0, 0.01) &&
      near(each.newUnitCost, 4740 / 43, 0.0001),
    { opening: each.openingValue, residual: each.residual, rate: each.newUnitCost });

  // A cost that does not divide cleanly: the residual must stay in pennies,
  // which is what makes 8900000 Rounding Gain/Loss the right home for it.
  const awkward = planSplitCost(333, 7.77, 111, 223);
  ok('B: an awkward division leaves a residual of pennies, not dollars',
    Math.abs(awkward.residual) < 0.02, awkward.residual);
}

/* ════ C. a lot we cannot cost is refused, never guessed ══════════════════ */

{
  const threw = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

  const noCost = threw(() => planSplitCost(307, null, 225, 100));
  ok('C: a lot with no cost is REFUSED', !!noCost && /no cost/i.test(noCost), noCost);
  ok('C: and the refusal says why guessing is not an option',
    !!noCost && /item estimate/i.test(noCost), noCost);
  ok('C: a zero cost is refused too, because free wood is not a thing',
    !!threw(() => planSplitCost(307, 0, 225, 100)));
  ok('C: a negative cost is refused',
    !!threw(() => planSplitCost(307, -2.74, 225, 100)));
  ok('C: an empty lot cannot be split',
    /nothing on hand/i.test(threw(() => planSplitCost(0, 2.74, 225, 100)) || ''));
  ok('C: a split that leaves no wood at all is refused',
    /some wood/i.test(threw(() => planSplitCost(307, 2.74, 0, 0)) || ''));
}

/* ════ D+E. what actually reaches the record ══════════════════════════════ */

const drive = ({ storedQty = 0.307, rate = 0.001, lotCost = 2740, customerQty = 225,
                 remainderQty = 100, glRows = null } = {}) => {
  const lines = [];
  let header = {};
  let saved = false;
  const adj = {
    setValue: ({ fieldId, value }) => { header[fieldId] = value; },
    selectNewLine: () => { lines.push({ fields: {}, assignments: [] }); },
    setCurrentSublistValue: ({ fieldId, value }) => { lines[lines.length - 1].fields[fieldId] = value; },
    getCurrentSublistSubrecord: () => {
      const line = lines[lines.length - 1];
      return {
        selectNewLine: () => { line.assignments.push({}); },
        setCurrentSublistValue: ({ fieldId, value }) => {
          line.assignments[line.assignments.length - 1][fieldId] = value;
        },
        commitLine: () => {},
      };
    },
    commitLine: () => {},
    save: () => { saved = true; return 987654; },
  };

  const sink = { audit: [], error: [], debug: [] };
  const fakes = {
    'N/record': { create: () => adj, Type: { INVENTORY_ADJUSTMENT: 'invadj' } },
    'N/query': {
      runSuiteQL: () => ({ asMappedResults: () => (glRows === null ? [] : glRows) }),
    },
    'N/runtime': { getCurrentScript: () => ({ getParameter: () => null }) },
    'N/log': {
      audit: (t, d) => sink.audit.push(String(t) + ' | ' + String(d)),
      error: (t, d) => sink.error.push(String(t) + ' | ' + String(d)),
      debug: (t, d) => sink.debug.push(String(t) + ' | ' + String(d)),
    },
    '/SuiteScripts/MCGI_LIB_LotCost': {
      getLotCostsAtLocation: () => ({ 49821: lotCost }),
    },
  };
  let exported = null;
  const define = (deps, factory) => { exported = factory(...deps.map((d) => fakes[d])); };
  new Function('define', fs.readFileSync(SPLIT_JS, 'utf8'))(define);

  const v = {
    rate,
    lot: { lotId: '49821', lotName: '315093-27', itemId: '2912', storedQty },
  };
  const input = {
    subsidiaryId: '9', locationId: '135', departmentId: '12',
    adjustmentAccountId: '228', soTranId: 'SO-CWP-001353',
    customerQty, remainderQty,
  };
  const id = exported.postSplitAdjustment(v, input, '315093-27-B');
  return { id, lines, header, saved, sink };
};

{
  const r = drive();

  ok('D: the record is written with THREE lines', r.lines.length === 3,
    r.lines.map((l) => l.fields.adjustqtyby));
  ok('D: the adjustment saved', r.saved && r.id === 987654, r.id);

  const [issue, cust, rem] = r.lines;

  ok('D: line 1 issues the whole 307 BF, in DISPLAY units',
    issue.fields.adjustqtyby === -307, issue.fields.adjustqtyby);
  ok('D: line 1 names the parent by INTERNAL ID, which is what an issue takes',
    issue.assignments[0].issueinventorynumber === 49821, issue.assignments[0]);
  ok('D: line 1 carries NO unit cost, so NetSuite relieves at the lot\'s own',
    !('unitcost' in issue.fields), issue.fields);

  ok('D: line 2 is the customer quantity', cust.fields.adjustqtyby === 225, cust.fields.adjustqtyby);
  ok('D: line 2 returns the wood to the PARENT lot, by name',
    cust.assignments[0].receiptinventorynumber === '315093-27', cust.assignments[0]);
  ok('D: line 3 is the remainder', rem.fields.adjustqtyby === 100, rem.fields.adjustqtyby);
  ok('D: only line 3 mints a lot, and it is the child',
    rem.assignments[0].receiptinventorynumber === '315093-27-B', rem.assignments[0]);

  ok('E: both receipts carry a unit cost, and it is the same one',
    near(cust.fields.unitcost, rem.fields.unitcost, 1e-9) && cust.fields.unitcost > 0,
    [cust.fields.unitcost, rem.fields.unitcost]);
  ok('E: the unit cost is per DISPLAY unit, 2.59 and not 2590',
    near(cust.fields.unitcost, 2.588246, 0.0001), cust.fields.unitcost);
  ok('E: which is the engine\'s per-base 2740 multiplied by rate, never divided',
    cust.fields.unitcost < 3, cust.fields.unitcost);

  ok('E: the assignment quantity matches its line, in display units',
    issue.assignments[0].quantity === -307 && cust.assignments[0].quantity === 225 &&
      rem.assignments[0].quantity === 100,
    r.lines.map((l) => l.assignments[0].quantity));

  ok('E: the memo states the rate change, so the GL entry explains itself',
    /307 at 2.74 -> 325 at 2.58/.test(String(r.header.memo)), r.header.memo);
  ok('E: the header still carries the account it was given',
    r.header.account === '228', r.header.account);
}

{
  // The GL check is the only thing standing between a per-MBF unit cost and a
  // silent thousandfold error, so it has to speak up.
  const clean = drive({ glRows: [{ acctnumber: '1500100', net: '0.00' }, { acctnumber: '8900000', net: '0.00' }] });
  ok('E: a conserved split logs at AUDIT and not at ERROR',
    clean.sink.error.length === 0 &&
      clean.sink.audit.some((a) => /GL conserved/.test(a)),
    { errors: clean.sink.error, audits: clean.sink.audit });

  const broken = drive({ glRows: [{ acctnumber: '1500100', net: '840350.00' }, { acctnumber: '8900000', net: '-840350.00' }] });
  ok('E: a split that moved real money logs at ERROR',
    broken.sink.error.some((e) => /NOT conserved/.test(e)), broken.sink.error);
  ok('E: and the error names the 1000x unit trap by name',
    broken.sink.error.some((e) => /per MBF instead of per BF/.test(e)), broken.sink.error);

  const unseen = drive({ glRows: [] });
  ok('E: no accounting lines yet is reported as UNVERIFIED, never as clean',
    unseen.sink.audit.some((a) => /UNVERIFIED/.test(a)) &&
      !unseen.sink.audit.some((a) => /GL conserved/.test(a)),
    unseen.sink.audit);
}

{
  // A lot the engine cannot price must stop the run BEFORE a record exists.
  let msg = null;
  try { drive({ lotCost: null }); } catch (e) { msg = e.message; }
  ok('C: an uncostable lot throws before anything is saved',
    !!msg && /no cost/i.test(msg), msg);
}

console.log(fail ? ('# FAIL ' + fail) : '# archSplitCost ok');
if (fail) process.exitCode = 1;
