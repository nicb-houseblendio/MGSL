/**
 * The two things Marc-Antoine asked for on the 2026-09-21 call that were not in
 * his written Feedback 9 list: the customer-facing milling line, and automatic
 * freight on FOB Reload.
 *
 * `autoFreightForFobReload` is brace-walked out of the SHIPPED archOrderCreate.js
 * rather than copied, same as archDepartmentResolve.test.mjs. The milling half is
 * tested through the wizard's own summing rule, restated here, plus assertions
 * against the shipped source so the rule and the code cannot drift apart
 * silently.
 *
 * 🔴 What these guards are really for: BOTH features write a line the trader did
 * not type into the Items step, and the last time that happened (the freight
 * charge, earlier the same day) the Review step did not show it and a trader was
 * asked to approve a total that was wrong. So the interesting assertions are not
 * "does it add a line" but "can it add a line nobody sees" and "can it add two".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRV = join(
  here,
  '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js',
);
const WIZ = join(here, '../components/arch/SOWizard.tsx');

const srv = readFileSync(SRV, 'utf8');
const wiz = readFileSync(WIZ, 'utf8');

let fails = 0;
let ran = 0;
const ok = (label, got, want) => {
  ran++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.error(`  FAIL ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
  }
};

/* ── extract autoFreightForFobReload from the shipped file ────────────────── */
const START = 'const autoFreightForFobReload = (incotermId, charges) => {';
const at = srv.indexOf(START);
if (at === -1) throw new Error('autoFreightForFobReload not found in archOrderCreate.js');
let depth = 0;
let end = -1;
for (let i = srv.indexOf('{', at + START.length - 1); i < srv.length; i++) {
  if (srv[i] === '{') depth++;
  else if (srv[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const body = srv.slice(at + START.length, end - 1);

const FOB_RELOAD = Number((srv.match(/FOB_RELOAD_INCOTERM = (\d+)/) || [])[1]);

/* 🔴 IDS ARE NO LONGER HARDCODED, so the harness resolves them the way the
 * shipped code does: by NAME, through a stand-in for `chargeItemsByName`.
 *
 * The ids below are SANDBOX ids and they are deliberately only in the test. The
 * source used to carry them, and two of the five were wrong in production:
 * Milling Charges is 2976 there and Freight Charges does not exist at all, so
 * the milling feature silently added no line and raised no error. Pinning them
 * here instead means the harness can still exercise the arithmetic while the
 * source stays account-neutral. */
const SBX_IDS = {
  'Freight/Transport': 2089,
  Freight: 1859,
  'Freight Charges': 3541,
  'Drop Charges': 1874,
  'Milling Charges': 3540,
};
const FREIGHT_NAMES = JSON.parse(
  (srv.match(/FREIGHT_SHAPED_NAMES = (\[[^\]]*\])/) || [])[1]
    .replace(/'/g, '"').replace(/,\s*\]/, ']'),
);
const AUTO_NAME = (srv.match(/AUTO_FREIGHT_NAME = '([^']+)'/) || [])[1];
const FREIGHT_IDS = FREIGHT_NAMES.map((n) => SBX_IDS[n]);

const autoFreight = (incotermId, charges, byName) => new Function(
  'incotermId', 'charges', 'int', 'FOB_RELOAD_INCOTERM',
  'freightShapedIds', 'chargeItemsByName', 'AUTO_FREIGHT_NAME', 'log',
  body,
)(
  incotermId,
  charges,
  (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; },
  FOB_RELOAD,
  () => FREIGHT_NAMES.map((n) => (byName || SBX_IDS)[n]).filter(Boolean),
  () => (byName || SBX_IDS),
  AUTO_NAME,
  { error: () => {}, audit: () => {} },
);

console.log('FOB Reload automatic freight');

ok('FOB Reload with no charges adds a line', !!autoFreight(FOB_RELOAD, []), true);
ok('  on Freight/Transport', autoFreight(FOB_RELOAD, []).itemId, SBX_IDS['Freight/Transport']);
ok('  named, so the response does not depend on an id', autoFreight(FOB_RELOAD, []).itemCode, 'Freight/Transport');
ok('  at rate 0, because they do not know the price yet', autoFreight(FOB_RELOAD, []).rate, 0);
ok('  quantity 1', autoFreight(FOB_RELOAD, []).quantity, 1);
ok('  flagged so the response can say it was not asked for', autoFreight(FOB_RELOAD, []).autoAdded, true);
// Feedback 17 (MA, 2026-09-23, SO-ARC-25): « Juste inscrire Freight dans la description ».
ok('  and the description is just Freight', autoFreight(FOB_RELOAD, []).description, 'Freight');

/* Any other incoterm must do nothing at all. */
for (const other of [3, 4, 6, 7, 8]) {
  ok(`incoterm ${other} adds nothing`, autoFreight(other, []), null);
}
ok('a blank incoterm adds nothing', autoFreight('', []), null);
ok('undefined adds nothing', autoFreight(undefined, []), null);
ok('a string "5" still counts, since ids arrive as strings', !!autoFreight('5', []), true);

/* ── 🔴 never double a freight line the trader already chose ─────────────── */
console.log('never doubles an existing freight line');
for (const id of FREIGHT_IDS) {
  ok(`a charge on item ${id} suppresses it`, autoFreight(FOB_RELOAD, [{ itemId: id, quantity: 1, rate: 500 }]), null);
  ok(`  even at rate 0`, autoFreight(FOB_RELOAD, [{ itemId: id, quantity: 1, rate: 0 }]), null);
  ok(`  and as a string id`, autoFreight(FOB_RELOAD, [{ itemId: String(id), quantity: 1, rate: 1 }]), null);
}
ok('suppressed when freight is not the first charge',
  autoFreight(FOB_RELOAD, [{ itemId: 3540, quantity: 1, rate: 50 }, { itemId: 2089, quantity: 1, rate: 9 }]),
  null);

/* 🔴 MILLING IS NOT FREIGHT. An order with milling and no freight still owes
 * freight, and treating "any charge at all" as freight would silently drop it. */
ok('a MILLING charge does NOT suppress it',
  !!autoFreight(FOB_RELOAD, [{ itemId: 3540, quantity: 1, rate: 250 }]), true);
ok('  which is the whole reason the check is a list, not a length',
  FREIGHT_IDS.includes(3540), false);

console.log('the freight list itself');
ok('holds the four freight-shaped items, by name',
  FREIGHT_NAMES.slice().sort(), ['Drop Charges', 'Freight', 'Freight Charges', 'Freight/Transport']);
ok('  which resolve to these ids in SANDBOX', FREIGHT_IDS.slice().sort((a, b) => a - b), [1859, 1874, 2089, 3541]);
/* 🔴 Milling must never satisfy the freight requirement. An order carrying a
 * milling charge and no freight still owes freight. */
ok('  and milling is NOT among them', FREIGHT_NAMES.indexOf('Milling Charges'), -1);
ok('FOB Reload is incoterm 5, as measured in the account', FOB_RELOAD, 5);

/* ── the server must accept milling, and only the customer-facing item ───── */
console.log('milling on the server allowlist');
/* 🔴 Asserted on the NAME list now, because the id list is gone. The rule is
 * unchanged and it is the one that matters: the CUSTOMER-FACING milling item is
 * offered and the two internal reman-cost items are not. Expressing it by name is
 * what makes it survive an account change, which the id version did not: 3540 is
 * sandbox-only and production's Milling Charges is 2976. */
const allowlist = srv.slice(srv.indexOf('const ARCH_CHARGE_ITEM_NAMES = ['));
const firstBlock = allowlist.slice(0, allowlist.indexOf('];'));
ok("'Milling Charges' is allowed", /'Milling Charges'/.test(firstBlock), true);
ok("'Milling Charges : Cut' is NOT (it is the internal cost, on POs)",
  /Milling Charges : Cut/.test(firstBlock), false);
ok("'Planing' is NOT, same reason", /'Planing'/.test(firstBlock), false);
ok('all five charge items are declared',
  firstBlock.split('\n').filter((l) => /^\s+'/.test(l)).length, 5);

/* ── the wizard: one line, the column total, per WRITABLE line ───────────── */
console.log('the wizard collapses the column to one line');
ok('the milling state is not called `milling`, which is the rate record',
  /const \[millingCharge, setMillingCharge\]/.test(wiz), true);
ok('the total sums over writableLines, not lines',
  /millingTotal[\s\S]{0,400}writableLines\.reduce/.test(wiz), true);
ok('the item is resolved from the server allowlist, not hardcoded',
  /chargeItems\.find\(\(x\) => \/milling\/i\.test\(x\.name\)\)/.test(wiz), true);
/*
 * ⚠️ Comments stripped first. The wizard's only "3540" sits in a comment saying
 * the id is deliberately NOT hardcoded, and a bare text search failed on that
 * explanation. Second time this exact trap has bitten a guard in this codebase,
 * so: assert against code, keep the prose.
 */
const wizCode = wiz.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('no hardcoded 3540 in the wizard CODE', /\b3540\b/.test(wizCode), false);
ok('  but the comment explaining why survives', /NOT a hardcoded 3540/.test(wiz), true);
ok('exactly one charge is appended, never one per line',
  /charges\.concat\(\[\{/.test(wiz), true);
ok('the request sends chargesWithMilling, not the raw Items rows',
  /charges: mode === 'existing' \? undefined : chargesWithMilling,/.test(wiz), true);
ok('milling never joins the per-line reman payload',
  /planing:[\s\S]{0,200}millingCharge/.test(wiz), false);

/* ── 🔴 and Review must show everything the request carries ──────────────── */
console.log('Review cannot hide a line the request carries');
ok('the charges block renders chargesWithMilling', /\{chargesWithMilling\.map\(/.test(wiz), true);
ok('the order total sums chargesWithMilling', /chargesWithMilling\.reduce\(/.test(wiz), true);
ok('no Review path still renders the bare `charges` array',
  /\{charges\.map\(\(c, i\) => \([\s\S]{0,80}borderTop/.test(wiz), false);
ok('FOB Reload is announced on Review, since the server adds that line',
  /FOB Reload:<\/strong>/.test(wiz), true);
ok('  and the announcement is suppressed when freight is already present',
  /!chargesWithMilling\.some\(\(c\) => \/freight\|transport\|drop\/i\.test\(c\.itemName\)\)/.test(wiz), true);
ok('the column total is shown next to the inputs that produce it',
  /Milling to customer: \{fmtMoney\(millingTotal/.test(wiz), true);

console.log(`\n${ran - fails}/${ran} passed`);
if (fails) process.exit(1);
