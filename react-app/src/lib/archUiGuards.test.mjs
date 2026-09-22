// Source-level guards for honesty in the ARCH components. node cannot load a .tsx
// (ERR_UNKNOWN_FILE_EXTENSION under --experimental-strip-types), so these read the
// component source and pin the pairs that must move together. Each one is here
// because the screen once showed generated data with nothing saying so.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcAbs = (rel) => readFileSync(join(here, '..', '..', '..', rel), 'utf8');
const src = (rel) => readFileSync(join(here, '..', rel), 'utf8');

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

// Reserved panel: while lotAllocation() feeds the SO columns, the panel must say so.
{
  const s = src('components/arch/ArchReservedSection.tsx');
  const usesFixture = /lotAllocation\(/.test(s);
  const saysSo = s.includes('Placeholder columns.') && /SO #, SO creation date, age, ship week, customer and trader/.test(s);
  ok('reserved panel: lotAllocation() present implies the placeholder banner is present', !usesFixture || saysSo, { usesFixture, saysSo });
  ok('reserved panel: banner does not claim to know live from demo', !/Placeholder columns\.[^<]*\b(demo mode|live data)\b/i.test(s));
}

// Sales rep AND sales team, as two distinct things, with no FIXTURE commission split.
//
// ⚠️ THIS BLOCK REPLACES THE ONE 11d1007 ADDED, whose premise was false. That commit
// deleted the commission panel from the Customer step and from Review on the stated
// grounds that "no NetSuite field carries a split", and pinned the deletion here. The
// split IS NetSuite data: `transactionsalesteam` holds 10,170 rows carrying a
// `contribution` per rep in this sandbox, SO-CWP-001352 really is a Samuel Nadon /
// Justin Loveland 50/50, and the named teams Marc-Antoine means by "Setup > sales
// team" are the 44 active `entitygroup` rows with `issalesrep = 'T'`, whose percentages
// in `entitygroupmember.contribution`. So these guards pin the OPPOSITE of 11d1007's:
// the concept is PRESENT and fed from the order's own Sales Team, and only an invented
// split is forbidden.
{
  const w = src('components/arch/SOWizard.tsx');
  const d = src('components/arch/ArchOrderDraftDialog.tsx');
  const f = src('lib/archOrderFixtures.ts');
  ok('fixtures: no SALES_TEAMS map and no percentages', !/SALES_TEAMS/.test(f) && !/pct/.test(f));
  ok('fixtures: no invented team per customer', !/salesTeamFor/.test(f) && !/SALES_TEAM_NAMES/.test(f));
  ok('fixtures: a fixture open order carries no commission split', /salesTeam: '',/.test(f));
  ok('fixtures: the offline rep options are PEOPLE, not team names',
    /export const FIXTURE_SALES_REPS = TRADERS;/.test(f));
  ok('wizard: no fixture commission map survives', !/SALES_TEAMS/.test(w));
  ok('wizard: the rep field is labelled Sales rep', /Sales rep \*/.test(w));
  ok('wizard: the split has its own field, labelled for what it is',
    /Sales team \(commission split\)/.test(w));
  ok('wizard: offline dropdown lists people', /FIXTURE_SALES_REPS\.map\(/.test(w) && !/SALES_TEAM_NAMES/.test(w));
  ok('wizard: offline warning calls them placeholders and drops the em dash', /These names are placeholders\./.test(w));
  ok('confirmation dialog: row is labelled Sales rep', /\['Sales rep', draft\.header\.salesTeam\]/.test(d) && !/'Sales team'/.test(d));
}

// SO wizard gates come from archOrderGate, not from an inline count. Two gates
// collapsed into one is what made Edit say "Add at least one lot" over a full cart.
{
  const w = src('components/arch/SOWizard.tsx');
  ok('wizard: imports orderGate', /import \{ orderGate \} from '@\/lib\/archOrderGate'/.test(w));
  ok('wizard: step gate and write gate both read the gate object', /const itemsOk = gate\.itemsStepOk;/.test(w) && /startOk && gate\.canWrite && headerOk/.test(w));
  ok('wizard: no inline writableLines.length > 0 gate survives', !/itemsOk = writableLines\.length > 0/.test(w));
  ok('wizard: editing an order prefills its Customer PO', /setCustomerPO\(o\.customerPO \|\| ''\)/.test(w));
  const v = src('components/arch/ArchOpenOrdersView.tsx');
  // Updated 2026-09-09: the Ready to Build clause was REMOVED from this gate, because
  // the client asked in writing for a warning rather than a block. The fixture rule
  // is the part that must survive, and it does.
  ok('orders view: Edit is hidden on fixture orders (no internalId)', /const editable = !!o\.internalId;/.test(v));
  ok('orders view: and Ready to Build no longer appears in that gate', !/editable = o\.status !== 'Ready to Build'/.test(v));
}

// Order confirmation: every dismissal route is guarded while submitting, and the
// outcome text has one home. The Done button was the route the guards missed.
{
  const d = src('components/arch/ArchOrderDraftDialog.tsx');
  ok('confirmation: Done is disabled while submitting', /disabled=\{submitting\}/.test(d));
  ok('confirmation: Done onClick refuses while submitting', /if \(!submitting\) onClose\(\);/.test(d));
  ok('confirmation: header reads orderOutcome, no inline copy of the branch', /orderOutcome\(result, !!submitting\)\.title/.test(d) && !/'NetSuite refused this order/.test(d));
  ok('confirmation: notice reads orderOutcome for refused-vs-unknown', /orderOutcome\(result, false\)\.kind === 'refused'/.test(d));
  const s = src('components/ArchScreen.tsx');
  ok('screen: cart bar receives the outcome reason', /note=\{cartNote\}/.test(s) && /setCartNote\(orderOutcome\(result, false\)\.cartReason\)/.test(s));
  const a = src('lib/archOrderApi.ts');
  ok('api: fetch carries an abort signal and a timer', /signal: ctrl\.signal/.test(a) && /setTimeout\(\(\) => ctrl\.abort\(\), timeoutMs\)/.test(a) && /clearTimeout\(timer\)/.test(a));
}

/* Cart bar: the cart IS the way forward, and Clear must not ride along with it.
 *
 * Lucas, 2026-09-08: "Can we make it so when you get to cart - you only have to single
 * or double click the 'create sales order' card to move to next menu instead of proceed
 * button in the bottom right?"
 *
 * ⚠️ SOURCE GUARDS, NOT BEHAVIOUR. node cannot load a .tsx here (there is no jsdom and
 * no vitest), so these read the file and pin the pairs that must move together. They
 * prove the handlers and the a11y attributes are present and that the destructive
 * button stops the bubble; they cannot prove a click opens the wizard. */
{
  const c = src('components/arch/SOCartBar.tsx');

  // The bar itself advances. This is the whole request.
  ok('cart bar: the strip carries a click handler that opens the wizard',
    /onClick=\{barClick\}/.test(c) && /const barClick = \(e: React\.MouseEvent\) =>/.test(c), null);
  ok('cart bar: the summary is a real keyboard-reachable button, not a bare div',
    /role="button"/.test(c) && /tabIndex=\{0\}/.test(c) && /onKeyDown=\{cardKey\}/.test(c), null);
  ok('cart bar: Enter and Space both activate it',
    /e\.key === 'Enter' \|\| e\.key === ' '/.test(c), null);
  ok('cart bar: the summary card names its action for a screen reader',
    /aria-label="Build the sales order/.test(c), null);

  /* 🔴 A CARD CLICK MUST NEVER REACH CLEAR. Clear discards the trader's whole
   * selection behind one window.confirm; a stray bubble that pops that dialog is the
   * one regression this change could cause. */
  ok('cart bar: Clear stops the click from reaching the strip',
    /Clear the selected bundles\?/.test(c) && /e\.stopPropagation\(\);[\s\S]{0,200}?window\.confirm\('Clear the selected bundles\?'\)/.test(c), null);
  ok('cart bar: the explicit Build button also stops the bubble, so it fires once',
    /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onOpenWizard\(\); \}\}/.test(c), null);
  ok('cart bar: the explicit Build button survives', /Build sales order/.test(c), null);

  // A drag-select over the note must not be read as "proceed".
  ok('cart bar: a click that ends a text selection is ignored',
    /getSelection\(\)/.test(c), null);

  // The note prop is why the bar stops being green and silent after a failed create.
  ok('cart bar: the note is still rendered', /note &&/.test(c) && /note\?: string \| null/.test(c), null);
  const endCard = c.indexOf('{/* end summary card */}');
  const noteAt = c.indexOf('⚠️ {note}');
  ok('cart bar: the note sits OUTSIDE the keyboard card, so it stays selectable',
    endCard > 0 && noteAt > endCard, { endCard, noteAt });
}

/* ═══ WHICH BUCKET STOCK APPEARS IN ═══════════════════════════════════════════
 *
 * SOURCE-TEXT GUARDS. Everything below is only observable in rendered markup or
 * in a SuiteScript AMD module, neither of which node can load here — there is no
 * jsdom and the cache MR is a `define([...])` bundle. The arithmetic these pin
 * lives in lib/archBuckets.ts and lib/archLots.ts and is tested for real in
 * archBuckets.test.mjs; these guard the wiring.
 *
 * Both 2026-09-08 client reports were about a bucket showing the wrong stock:
 *
 *   Lucas: "When there is material reserved it shows in the 'available' with a
 *   note on it even when reserved toggle is off. Shows again when toggled on."
 *
 *   Marc-Antoine: « quand je crée un SO ça devrait aller dans ready to build ou
 *   dans reserved mais en ce moment on dirait qu'il fait juste disparaitre du TS. »
 */
{
  const t = src('components/InventoryTableARCH.tsx');
  const d = src('components/DetailDrawerARCH.tsx');
  const l = src('components/arch/ArchLotTable.tsx');
  // The cache MR lives outside react-app/src.
  const mr = readFileSync(
    join(here, '..', '..', '..', 'src', 'FileCabinet', 'SuiteScripts', 'mcgi_services',
      'trader_screen', 'entry_points', 'mr', 'mcgi_mr_trader_screen_cache_arch.js'),
    'utf8'
  );

  // ── Marc-Antoine: the shipped lane exists on the grid again ──────────────
  ok('grid: OUTBOUND is a column, so a fulfilled order does not leave the screen',
    /key: 'outbound',\s*\n\s*label: 'OUTBOUND',/.test(t));
  ok('grid: OUTBOUND is not offered as a drill-down (no bundle carries it)',
    /key: 'outbound'[\s\S]{0,160}?drillable: false/.test(t));
  ok('grid: the stale "no Outbound column" claim is gone',
    !/six buckets, no Outbound column/.test(t));
  ok('grid: a non-drillable column is rendered without the click handler',
    /onDrillDown=\{drillable \? onDrillDown : undefined\}/.test(t));

  // ── Marc-Antoine: Ready to Build cannot receive anything, and says so ────
  // Updated 2026-09-10: the note is no longer a permanent claim. It is wired
  // to the cache's own META (`readyToBuildSourced`) via `getMetricColumns`,
  // because the field it describes ("no field in NetSuite yet") stopped being
  // permanently true the moment `setReadyToBuild` and the isolated cache read
  // shipped — see `archOrderCreate.js` and the cache MR below. A hardcoded
  // string here would keep asserting absence after the field exists.
  ok('grid: READY TO BUILD is a function of readyToBuildSourced, not a fixed string',
    /key: 'readyToBuild'[\s\S]{0,800}?note: readyToBuildSourced\s*\n\s*\? undefined\s*\n\s*: 'Not sourced yet/.test(t));
  ok('grid: no hardcoded not-sourced literal survives for readyToBuild',
    !/note: 'Not sourced yet: no field in NetSuite feeds this/.test(t));
  ok('grid: the column function takes readyToBuildSourced as its only argument',
    /const getMetricColumns = \(\s*\n\s*readyToBuildSourced: boolean,/.test(t));
  ok('grid: a column carrying a note renders the marker, not just a tooltip',
    /note && <span aria-hidden/.test(t));

  // ── Lucas: Available is a real view, not a redirect to On Hand ───────────
  ok('drawer: Available has its own tab', /\{ key: 'available', label: 'Available' \}/.test(d));
  ok('drawer: the false claim that Available equals the per-lot column is gone',
    !/the clicked figure is the sum of that column/.test(d));
  ok('drawer: Reserved still folds into On Hand with its panel expanded',
    /setShowReserved\(triggerBucket === 'reserve'\)/.test(d));

  // ── Lucas: no note about a bundle's state on a bucket that has no use for it.
  // The Res. pill, the reserved toggle and the Reserved panel are all gated on
  // the On Hand view; Available shows the lock badge only.
  ok('lot table: the Res. column is On Hand only', /\{isOnHand && \(\s*<td/.test(l));
  ok('lot table: the reserved toggle is On Hand only', /\{isOnHand && \(\s*<button/.test(l));
  ok('lot table: the Reserved panel is On Hand only',
    /\{isOnHand && showReserved && \(/.test(l));
  ok('lot table: the quantity column is not called Total on the Available view',
    /bucket === 'available' \? 'Avail\.' : 'Total'/.test(l));
  ok('lot table: Outbound reports elapsed time since shipment, not stock being held',
    /bucket === 'outbound' \? 'Shipped'/.test(l) && !/'Held For'/.test(l));

  // ── Both: a header total the bundles cannot account for is named ─────────
  ok('lot table: reads the gap and the not-sourced note from archBuckets',
    /import \{ bucketLots, bucketGap, bucketGapReason, notSourcedNote \} from '@\/lib\/archBuckets'/.test(l));
  ok('lot table: renders the reconciliation line', /is not attributed to any bundle, so it cannot be/.test(l));
  ok('lot table: renders the not-sourced notice', /<b>Not sourced yet\.<\/b> \{notSourced\}/.test(l));
  ok('lot table: the empty state does not claim there is none of this stock',
    /no bundle carries it, so there is nothing to list/.test(l));
  ok('lot table: the reserved toggle declares reserve that names no bundle',
    /reservedNotOnAnyBundle > 0/.test(l));

  // ── Lucas, ROOT CAUSE, server side ──────────────────────────────────────
  // The cache booked a SHIPPED sales-order assignment as the lot's `reserve`,
  // so lot 315643-7 carried reserve 300 on an order that had shipped (IF1208)
  // and been billed (INV-CWP-1236) while the row's Reserved column read 0.
  // Whitespace-tolerant since 2026-09-22: step 0.2 split the purchase-order
  // side into onOrder and inTransit, so those two lines gained a trailing
  // factor and an alignment space. The INTENT is unchanged and is what this
  // pins: an assignment is scaled by the line's open share, never booked whole.
  ok('cache MR: a lot assignment is scaled by the line-level open share',
    /reserve\s*\+= assigned \* openShare/.test(mr)
    && /onOrder\s*\+= assigned \* openShare/.test(mr)
    && /inTransit\s*\+= assigned \* openShare/.test(mr));
  ok('🔴 cache MR: per-lot inTransit is WRITTEN, which is what makes the cell clickable',
    /bucket\.lots\[r\.lotno\]\.inTransit \+=/.test(mr));
  ok('cache MR: and the lot splits on the SAME ratio as the row, not its own rule',
    /const waterShare = open > 0 \? water \/ open : 0;/.test(mr)
    && /openShare \* waterShare/.test(mr)
    && /openShare \* \(1 - waterShare\)/.test(mr));
  ok('cache MR: the unconditional whole-assignment reserve is gone',
    !/\.reserve \+= assigned;/.test(mr));
  // Updated 2026-09-10: readyToBuild moved from a hardcoded literal 0 to an
  // isolated, separately try/caught query over `custbody_arch_ready_to_build`
  // — see `loadBuckets`. Pin the shape that keeps it safe to deploy before the
  // field exists (never joined into BUCKET_SQL, which the other five buckets
  // depend on) rather than the old hardcoded absence.
  // Comment-stripped copy. Every rule in this file is about CODE; the source
  // explains each rule in prose directly above the code that implements it, so a
  // raw text search matches the explanation and answers the wrong question.
  const mrCode = mr.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ 	]*\/\/.*$/gm, ' ');
  ok('cache MR: readyToBuild is read from its own isolated, try/caught query',
    /custbody_arch_ready_to_build = 'T'/.test(mr) && /readyToBuildSourced = false/.test(mr));
  /* ⚠️ Comments stripped first, added 2026-09-22. This matched the word in a
   * COMMENT inside BUCKET_SQL that explains why the field is kept out of it, and
   * reported the rule broken by the very text describing the rule. Third time
   * this exact trap has fired in this repo: assert on code, never on prose. */
  ok('cache MR: that query is never joined into BUCKET_SQL itself',
    !(mrCode.match(/const BUCKET_SQL =[\s\S]*?;/) || [''])[0].includes('custbody_arch_ready_to_build'));
  ok('🔴 cache MR: and neither is the transit journal',
    !(mrCode.match(/const BUCKET_SQL =[\s\S]*?;/) || [''])[0].includes('custbody_po_intransit_journal'));
  ok('cache MR: no unconditional hardcoded readyToBuild literal survives',
    !/readyToBuild:\s*0,/.test(mr));

  /* ── Marc-Antoine, ROOT CAUSE, server side ────────────────────────────────
   * `available` subtracted `outbound` from an `onHand` figure that was already
   * net of the fulfilment, so every shipment took the same wood off twice and
   * the deduction never expired — nothing closes a shipped-and-billed line.
   * 1,166 BF across the 13 live rows on 2026-09-08. With it gone all 13
   * reconcile; 4 did not before. */
  // Updated 2026-09-10: `readyToBuild` is a real subtracted variable now, not
  // the literal `0 /*readyToBuild*/` placeholder — it is sold wood one stage
  // further along, and must be excluded from Available the same as `reserve`.
  // ⚠️ Updated twice on 2026-09-22. `onOrder` left first, then `inTransit`:
  // the client calls in-transit wood sellable but this code refuses it at three
  // gates, so counting it offered volume no trader could order. Available now
  // means what the order endpoint will accept.
  ok('cache MR: available is on-hand net of claims, nothing incoming',
    /available:\s*Math\.max\(0, onHand\s*\n\s*- reserve - readyToBuild\s*\n\s*- held\)/.test(mr));
  ok('🔴 cache MR: onOrder is genuinely gone, not merely reordered',
    !/available:\s*Math\.max\([^)]*onOrder/.test(mr));
  ok('🔴 cache MR: and inTransit too',
    !/available:\s*Math\.max\([^)]*inTransit/.test(mr));
  ok('cache MR: both removals are documented against the client quote, not silent',
    /ON ORDER IS NOT AVAILABLE/.test(mr) && /in transit a peu pres/.test(mr)
    && /AVAILABLE MEANS WHAT THE ORDER ENDPOINT WILL ACCEPT/.test(mr));
  /* 🔴 The two new columns must NEVER go back into BUCKET_SQL. A custom body
   * field there fails the whole query on one unknown column, and that query feeds
   * five buckets; the measured result is Available RISING by 35,985 BF with every
   * bundle unlocked, and a shrink guard that accepts the poisoned payload. */
  ok('🔴 cache MR: the transit journal is NOT a BUCKET_SQL column',
    !/BUCKET_SQL[\s\S]*?custbody_po_intransit_journal[\s\S]*?t\.type IN/.test(mr));
  ok('cache MR: it is read in its own isolated, chunked query instead',
    /transitByPo/.test(mr) && /FROM transaction ' \+/.test(mr));
  ok('cache MR: that read degrades to a flag rather than taking the run down',
    /transitSourced = false/.test(mr));
  ok('cache MR: and a failed BUCKET_SQL now records that it failed',
    /bucketsSourced = false/.test(mr));
  ok('cache MR: the catch names the real consequence, which is an OVER-report',
    /OVER-REPORTS/.test(mr));
  ok('🔴 cache MR: a closed order contributes no in-transit wood',
    /closedOrder/.test(mr) && /split\(':'\)/.test(mr));
  ok('cache MR: and the removal is documented, not silent',
    /`outbound` IS NOT SUBTRACTED/.test(mr));
  ok('grid: the Outbound header does not claim a second deduction',
    /NOT deducted from Available a second time/.test(t));
  ok('contract: types\\/arch.ts states the corrected formula',
    /onHand − reserve − readyToBuild − held/.test(src('types/arch.ts')));
  ok('contract: and it records that onOrder was removed rather than just omitting it',
    /CORRECTED 2026-09-22/.test(src('types/arch.ts')));

  // ── Ready to Build, the manual toggle, 2026-09-10 ─────────────────────────
  const oc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js');
  const sl = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/sl/mcgi_sl_arch_order_create.js');
  const svc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service_arch.js');
  const api = src('lib/archOrderApi.ts');
  const v = src('components/arch/ArchOpenOrdersView.tsx');

  ok('order create: setReadyToBuild REFUSES rather than silently no-opping when the field is absent',
    /throw refusal\('Ready to Build is not available on this account yet/.test(oc));
  ok('order create: it is a plain checkbox — the same call reverts it, no separate path',
    /Reverting \(`value: false`\) is the SAME call with the opposite value/.test(oc));
  ok('order create: the write uses setIfPresent rather than a bare setValue',
    /setIfPresent\(so, F_READY_TO_BUILD, !!value, 'Ready to Build'\)/.test(oc));
  ok('order create: write is verified by re-reading the saved record, not trusted from save()',
    /const verifyReadyToBuild = \(soId, expected\) => \{/.test(oc));
  ok('suitelet: setReadyToBuild is dispatched before the order-creation shape checks',
    /input\.action === 'setReadyToBuild'[\s\S]{0,2000}?The order has no lines\./.test(sl));
  ok('open orders service: the flag is read in its OWN query, never joined into OPEN_ORDERS_SQL',
    !(svc.match(/const OPEN_ORDERS_SQL =[\s\S]*?;/) || [''])[0].includes('custbody_arch_ready_to_build'));
  ok('open orders service: archStatusFor lets a shipped status win over the tick',
    /case 'D':\s*\n\s*case 'E':\s*\n\s*case 'F':\s*\n\s*return 'In Transit';\s*\n\s*default:\s*\n\s*return readyToBuild \? 'Ready to Build' : 'Reserved';/.test(svc));
  /*
   * This used to pin `if (rtbIdList.length) {`. The loop that replaced it on
   * 2026-09-13 cannot build an empty IN () at all — a `for` over an empty list
   * never runs — so the guard now pins the loop rather than the old wrapper.
   * The three below it are the reason that loop exists.
   */
  ok('open orders service: an empty order list never reaches an invalid IN ()',
    /for \(let i = 0; i < rtbIdList\.length; i \+= RTB_CHUNK\)/.test(svc));
  ok('open orders service: the id list is DEDUPED — rows fan out per line, not per order',
    /const rtbIdList = \[\.\.\.new Set\(rows/.test(svc));
  ok('open orders service: and CHUNKED at 500, matching the sales-team read over the same ids',
    /const RTB_CHUNK = 500;/.test(svc));
  ok('open orders service: and the 1,000-expression cap that justified it is recorded as measured FALSE',
    /MEASURED FALSE/.test(svc));
  ok('open orders service: and parameterized, not concatenated',
    /params: slice,/.test(svc));
  ok('open orders service: a partial read is reported as partial, not as an absent field',
    /Ready to Build PARTIAL read/.test(svc));
  /*
   * The cache MR runs its own copy of the same read. It always deduped, so it
   * was further from the cap than the service, but it hit it the same way and
   * degrades SILENTLY by design — the catch is the intended path while the
   * field does not exist, so an overflow would land as "Ready to Build reads
   * zero" with nothing naming the cause.
   */
  const mrArch = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js');
  ok('cache MR: its copy of the Ready to Build read is chunked and parameterized too',
    /const FLAG_CHUNK = 500;/.test(mrArch) && /params: slice,/.test(mrArch));
  ok('cache MR: and a failed chunk unsources the WHOLE run, because this read splits two buckets',
    /readyToBuildSourced = false;\s*\n\s*readyToBuildIds = \{\};/.test(mrArch));
  /*
   * `readyToBuildSourced` is written in getInputData and META is written in
   * summarize — a different execution, where every module variable is a fresh
   * `true`. Read there, it made META claim the bucket was sourced on exactly
   * the runs where the read had failed. It travels in the rows instead.
   */
  // Widened 2026-09-22: bucketsMeta gained a second flag, `bktSourced`, for
  // BUCKET_SQL as a whole. The rule is unchanged and is what this pins: both
  // flags arrive as ARGUMENTS and neither is read off the module copy.
  ok('cache MR: bucketsMeta takes the flags as ARGUMENTS, so summarize cannot read the module copy',
    /const bucketsMeta = \(sourced, bktSourced\) =>/.test(mrArch) && !/bucketsMeta\(\)/.test(mrArch));
  /* 🔴 A run where BUCKET_SQL itself threw must not report a healthy screen.
   * Five totals read 0 while onHand survives from LOT_SQL, so Available
   * OVER-reports and every bundle unlocks; META used to answer bucketsEmpty: []
   * on exactly that run, which App.tsx renders as a plain "Live" badge. */
  ok('🔴 cache MR: a failed BUCKET_SQL empties the five buckets it feeds, and only those',
    /bucketsEmpty: \['reserve', 'outbound', 'onOrder', 'inTransit', 'readyToBuild'\]/.test(mrArch)
    && /bucketsBuilt: \['onHand'\]/.test(mrArch));
  ok('cache MR: and summarize derives THAT flag from the rows too, not from the module copy',
    /const bktSourced = bktSourcedFrom\(rows\);/.test(mrArch)
    && /bktSourced:   pair\.bktSourced !== false/.test(mrArch));
  ok('cache MR: summarize derives it from the ROWS that crossed the stage boundary',
    /const rtbSourced = rtbSourcedFrom\(rows\);/.test(mrArch));
  ok('cache MR: and both pair constructors plus the reduce row carry it across',
    (mrArch.match(/rtbSourced:   readyToBuildSourced,/g) || []).length === 2 &&
    /rtbSourced:   pair\.rtbSourced !== false,/.test(mrArch));
  ok('sales team: the same measured-false note reached the module that started the belief',
    /MEASURED FALSE/.test(srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archSalesTeam.js')));
  ok('frontend api: setReadyToBuild sends the action discriminator the Suitelet expects',
    /body: JSON\.stringify\(\{ action: 'setReadyToBuild', soId, value \}\)/.test(api));
  /*
   * The server re-reads the saved record; these pin that the answer is ACTED
   * ON. Until 2026-09-13 `verifiedMatches` was returned by the Suitelet and
   * dropped by the client, so a value NetSuite stored as the opposite of what
   * was asked for reported to the trader as success.
   */
  ok('frontend api: a save NetSuite accepted but did not store is a FAILURE, not a success',
    /body\.verified === true && body\.verifiedMatches === false/.test(api));
  ok('orders view: a NOT_STORED re-reads the row, because that row is now stale',
    /if \(result\.code === 'NOT_STORED'\) reload\(\);/.test(v));
  ok('orders view: the toggle only renders on a real order, the same gate as Edit',
    /\{editable && \(\s*\n\s*<label/.test(v));
  ok('orders view: the checked state reads the raw flag, not the derived status string',
    /checked=\{!!o\.readyToBuild\}/.test(v));
}

/* ───────────────────────────────────────────────────────────────────────────
   Customer and ship-to are TYPE-AHEADS, and the typed text is visible.

   Marc-Antoine, 2026-09-08: "Est-ce que ça pourrait être un field où on type
   ahead (en gardant la flèche comme possibilité pour la recherche globale).
   Quand je tape certains caractères, je ne vois pas ce que j'ai tappé." Both
   fields were native <select>s, which DO type-ahead but never render the buffer,
   so the complaint is literally true of the control and no styling fixes it.

   ⚠️ SOURCE GUARDS, not behavioural tests. There is no jsdom here, so what a
   keystroke actually paints cannot be asserted. The matching itself IS tested
   behaviourally, in archTypeahead.test.mjs. */
{
  const w = src('components/arch/SOWizard.tsx');
  const t = src('lib/archTypeahead.ts');
  ok('wizard: the combobox input renders the TYPED text, which is the whole bug',
    /value=\{editing \? \(query as string\) : value\}/.test(w));
  ok('wizard: the customer field is the combobox, not a native select',
    /ariaLabel="Customer"/.test(w) && !/value=\{customersAreLive \? customerId : customer\}/.test(w));
  ok('wizard: the ship-to field is the combobox too',
    /ariaLabel="Ship-to address"/.test(w) && !/<option value="__new__">/.test(w));
  ok('wizard: the arrow he asked to keep is kept, and it clears the query',
    /aria-label=\{open \? 'Close the list' : 'Show the whole list'\}/.test(w) &&
    /setQuery\(''\);\s*\n\s*setActive\(-1\);\s*\n\s*setOpen\(true\);/.test(w));
  ok('wizard: a typed near-match resolves to nothing, never to a customer',
    /resolveTyped\(options, query \|\| '', \(o\) => o\.label\)/.test(w));
  ok('wizard: both pickers keep their own id alongside the label',
    /pickCustomerById\(o\.id\) : pickCustomerByName\(o\.label\)/.test(w) &&
    /setShipAddressId\(hit \? hit\.id : ''\)/.test(w));
  /* The diacritic range must be written as an ESCAPE, not as the characters
     themselves. U+0300..U+036F typed into a source file is invisible in every
     review and in every diff, and this repo has already lost a day to a real
     0x08 byte where a \b was meant. I wrote it the wrong way once here. */
  ok('typeahead: the combining-mark range is an escape sequence',
    /\[\\u0300-\\u036f\]/.test(t));
  ok('typeahead: no RAW combining marks anywhere in the module',
    ![...t].some((c) => c.codePointAt(0) >= 0x300 && c.codePointAt(0) <= 0x36f));
  ok('typeahead: a blank query is documented as the whole list, i.e. the arrow',
    /recherche globale/.test(t));
}

/* ───────────────────────────────────────────────────────────────────────────
   The commission split survives a rep change, and comes from the order.

   "Sales Team : Ça ne semble pas feeder de la bonne affaire : On veut les teams
   qui sont dela page (Setup > sales team). Quand je change de rep, le split
   disparaît" (Marc-Antoine, 2026-09-08).

   The reducer behaviour is tested for real in archSalesTeamSplit.test.mjs. These
   guards pin that the COMPONENT uses it, because the bug was in the wiring: one
   state field held a rep id and a team name by turns, so writing the rep erased
   the team the panel was drawn from. */
{
  const w = src('components/arch/SOWizard.tsx');
  const m = src('lib/archSalesTeamSplit.ts');
  ok('wizard: the two-field state replaced the one that held both',
    /const \[repTeam, setRepTeam\] = React\.useState<ArchRepTeamState>\(emptyRepTeam\);/.test(w) &&
    !/setSalesTeam\(/.test(w) && !/const \[salesTeam, setSalesTeam\]/.test(w));
  ok('wizard: the rep select goes through repPicked, which carries the split',
    /setRepTeam\(\(s\) =>\s*repPicked\(s, e\.target\.value, liveReps\.some\(\(r\) => r\.id === e\.target\.value\)\)\s*\)/.test(w));
  ok('wizard: opening an order adopts its REAL split, from the sublist fields',
    /orderOpened\(o\.traderId \|\| '', \{/.test(w) &&
    /shared: !!o\.traderShared,/.test(w) && /tied: !!o\.traderTied,/.test(w));
  ok('wizard: the split is described by the tested module, not inline',
    /describeOrderSalesTeam\(repTeam\.team\)/.test(w));
  /* Updated 2026-09-09 TWICE. First when the panel became a PICKER over the 44 real
     teams; then to strike the sentence that followed, which said a picked team is
     "the only one of the three this order actually sends". That was exactly INVERTED:
     with the commission latch off, a picked team is the one thing that is NOT sent.
     The guard's point is unchanged - Review must restate the split before the order
     is committed - and it now also pins the qualification. */
  ok('wizard: Review restates the split, which 11d1007 also removed',
    /'Sales team',/.test(w) &&
    /pickedTeam\.name \+ ' \(' \+ teamSplitLabel\(pickedTeam\) \+ '\)'/.test(w) &&
    /: orderSplit\s*\?\s*orderSplit\.headline\s*: NEW_ORDER_SPLIT_HEADLINE/.test(w));
  /* And the id it sends can only be one the live list holds. A team picked before
     a reload that no longer offers it must not post an entitygroup id.

     🔴 THE "NEW ORDERS ONLY" HALF WAS DROPPED 2026-09-14, deliberately. It was
     justified by "the endpoint skips the whole header block on an append", which
     is not true: that branch applies the customer PO, the incoterms and the ship
     date, and it has an explicit argued case for writing a named team too. The
     gate made that server branch unreachable and made the panel tell the trader
     to go and change the split in NetSuite instead. What the gate was RIGHT about
     -- never sending a team just because one was left sitting in state -- is what
     `sendableTeamId` does, and that still applies in both modes. */
  ok('wizard: the team id is sent only when the live list still holds it',
    /salesTeamId: sendableTeamId\(liveTeams, salesTeamId\),/.test(w));
  ok('wizard: and a team picked on an APPEND is sent, since the endpoint honours it',
    !/salesTeamId: mode === 'new'/.test(w)
    && /mode === 'existing' && pickedTeam && \(/.test(w));
  ok('wizard: the required-field gate is salesRepOk over the two fields',
    /salesRepOk\(repTeam, liveReps\.length > 0\)/.test(w) &&
    !/liveReps\.length === 0 \|\| !!salesRepId/.test(w));
  ok('wizard: the header text field is driven by the REP, not by a team',
    /salesTeam: salesRepLabel,/.test(w));
  ok('wizard: switching back to a new order drops the edited order\'s split',
    /setRepTeam\(emptyRepTeam\(\)\);/.test(w));
  /* The module has to keep citing what it was measured against. A bare "no field
     feeds this" claim is what deleted the panel in the first place. */
  ok('split module: names the real sources it was measured against',
    /transactionsalesteam/.test(m) && /entitygroupmember/.test(m) &&
    /customersalesteam/.test(m));
  ok('split module: says outright that a new order cannot read or send a team',
    /Setup > Sales > Sales Teams/.test(m) && /cannot read or change/.test(m));
}

/* ───────────────────────────────────────────────────────────────────────────
   Review totals bar: the figures span the pane instead of clumping left.

   Lucas, 2026-09-08, arrow pointing at the empty right-hand half of the dark
   bar: "Can we move these to the right side of the pane?" Six figures at their
   natural width against flex-start left about half of an 1,180px dialog blank.

   ⚠️ SOURCE GUARD. Layout cannot be measured without a browser; what is asserted
   is the property, and that every figure and every colour survived it. */
{
  const w = src('components/arch/SOWizard.tsx');
  ok('review totals: the dark bar distributes across the full width',
    /justifyContent: 'space-between',\s*gap: 24,\s*rowGap: 14,\s*flexWrap: 'wrap',\s*padding: '14px 18px',\s*borderRadius: 10,\s*background: 'linear-gradient\(135deg, #0F2641, #1A3D63\)',/.test(w));
  ok('review totals: every figure survived',
    ["'Quantity'", "'Revenue'", "'Lot cost'", "'Services + ops'", "'Estimated profit'", "'Margin'"]
      .every((k) => w.includes('[' + k + ',')));
  ok('review totals: the colour contrast survived',
    /'rgba\(255,255,255,0\.75\)'/.test(w) && /'#FCA5A5'/.test(w) && /'#A5D6A7'/.test(w) &&
    /'#CBD5E1'\]/.test(w));
}

// The ARCH grid must say how old its figures are. The shared badge is gated
// `!isARCH` because its one-hour bound equals this cache's rebuild interval, so
// suppressing it left the grid with no age at all - half of "on dirait qu'il fait
// juste disparaitre du TS". Source guard: App.tsx cannot be rendered in this repo.
{
  const a = src('App.tsx');
  ok('app: the ARCH header renders its own freshness badge', /archFreshness\(archMeta\?\.lastUpdated, Date\.now\(\)\)/.test(a));
  ok('app: it imports the tested module rather than inlining a threshold', /from '@\/lib\/archFreshness'/.test(a));
  ok('app: the shared badge stays gated off for ARCH, whose interval it misreads', /\{!isARCH && meta\?\.lastUpdated/.test(a));
  ok('app: the badge carries a tooltip explaining the age', /title=\{f\.title\}/.test(a));
  ok('app: all three states get a colour, so overdue does not read as fresh', /f\.state === 'fresh'/.test(a) && /f\.state === 'due'/.test(a));
}

// 🔴 READY TO BUILD WARNS, IT NEVER BLOCKS. The client superseded his own call remark
// in writing on 2026-08-14 11:33: a warning « qui n'empeche pas le Edit ». The code had
// implemented the call and ignored the written answer, which is the reverse of this
// project's own rule that Marc-Antoine's word beats a stale note. Source guards: this
// repo cannot render a component.
{
  const w = src('components/arch/SOWizard.tsx');
  const v = src('components/arch/ArchOpenOrdersView.tsx');
  ok('wizard: only a fixture order is locked, never Ready to Build', /const locked = demo;/.test(w));
  ok('wizard: no "can no longer be edited" claim survives', !/no longer be edited/.test(w));
  ok('wizard: Ready to Build says the warehouse MAY be preparing it, and lets you continue',
    /may already be preparing this order\. You can still add lines/.test(w));
  ok('wizard: cites the written answer that superseded the call', /2026-08-14/.test(w));
  ok('orders view: Edit is gated on a real order only', /const editable = !!o\.internalId;/.test(v));
  ok('orders view: the header note no longer says the contradiction is open',
    !/the contradiction is open with him/.test(v));
}

// 🔴 THE SCREEN MUST NOT SAY A TEAM WAS SENT WHILE THE LATCH IS OFF. Two surfaces said
// exactly that, unconditionally, on the panels before an order is committed, and the
// honesty helper written for it was dead code imported nowhere. We had told MGSL in
// writing, twice, that a picked team is shown and not written.
{
  const w = src('components/arch/SOWizard.tsx');
  ok('wizard: the field description follows the latch, it does not assert "Sent"',
    /salesTeamWriteEnabled\(\)\s*\?\s*'\. Sent with the order as the commission split/.test(w));
  ok('wizard: and says plainly it is NOT written when the latch is off',
    /NOT written to the order yet/.test(w));
  ok('wizard: Review qualifies a picked team while the latch is off',
    /salesTeamWriteEnabled\(\) \? '' : ' - not written yet'/.test(w));
  ok('wizard: the honesty notice is actually rendered, not dead code',
    /teamWriteNotice\(\) && \(/.test(w) && /\{teamWriteNotice\(\)\}/.test(w));
  ok('wizard: imports both latch helpers', /salesTeamWriteEnabled,/.test(w) && /teamWriteNotice,/.test(w));
  // The sentence may now appear ONLY inside the latch ternary, never on its own.
  ok('wizard: no unconditional "Sent with the order" survives',
    (w.match(/Sent with the order as the commission split/g) || []).length === 1 &&
    /salesTeamWriteEnabled\(\)\s*\?[^:]*Sent with the order/.test(w));
  // The latch has to be OPENABLE, or a go-ahead from MGSL cannot be honoured.
  const sl = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/sl/mcgi_sl_trader_screen_react.js');
  ok('suitelet: MCGI_CONFIG carries salesTeamWriteEnabled, so the latch can be opened',
    /salesTeamWriteEnabled: salesTeamWriteEnabled/.test(sl));
  ok('suitelet: and it defaults to OFF, from a parameter, failing off when it throws',
    /let salesTeamWriteEnabled = false;/.test(sl) && /custscript_ts_salesteam_write_on/.test(sl));
}


/* The refresh button must be able to SAY it is working, on both screens.
 *
 * Andrei, 2026-09-09: "i did click it nothing happend, the animation of the circle
 * turning isnt working." Structural, not a CSS slip: the spin and the disabled state
 * both read `refreshState`, which only `doRefresh` advances -- the IND/MTL path. The
 * ARCH branch called the child's reload directly and never touched it, so on ARCH the
 * icon could never spin and the button was `disabled={isARCH ? false : ...}`, i.e.
 * never disabled either. The refetch worked; the screen said nothing.
 *
 * These pin the shape rather than the pixels, because the defect WAS the shape: two
 * separate expressions that could disagree, and one of them hard-coded per screen.
 */
{
  const app = src('App.tsx');
  const arch = src('components/ArchScreen.tsx');

  ok('refresh: a single derived flag exists for the control',
    /const refreshBusy = isARCH/.test(app), false);
  ok('refresh: it uses ARCH\'s own in-flight state on ARCH',
    /const refreshBusy = isARCH\s*\n?\s*\?\s*archRefreshing/.test(app), false);
  ok('refresh: and the shared refreshState elsewhere',
    /refreshBusy = isARCH[\s\S]{0,120}refreshState === 'checking'/.test(app), false);

  // The two that drifted apart. They must now be the SAME expression.
  ok('refresh: the disabled state reads that one flag',
    /disabled=\{refreshBusy\}/.test(app), false);
  ok('refresh: the spinner reads that same one flag',
    /animate-spin[\s\S]{0,40}/.test(app) && /refreshBusy \? 'animate-spin'/.test(app), false);

  ok('refresh: ARCH is no longer hard-coded as never-disabled',
    !/disabled=\{isARCH\s*\n?\s*\?\s*false/.test(app), false);

  // Without awaiting the reload there is nothing to turn the flag off.
  ok('refresh: the ARCH reload is awaited rather than fired and forgotten',
    /Promise\.resolve\(fn\(\)\)/.test(app), false);
  ok('refresh: a failed refetch still clears the spinner',
    /Promise\.resolve\(fn\(\)\)\.catch/.test(app), false);
  ok('refresh: a second click cannot stack a second refetch',
    /disabled=\{refreshBusy\}/.test(app), false);

  // A warm cache answers in under a frame; without a floor the fix is invisible and
  // the original complaint stands.
  ok('refresh: there is a minimum visible spin duration',
    /ARCH_SPIN_FLOOR_MS/.test(app) && /setTimeout\(r, ARCH_SPIN_FLOOR_MS\)/.test(app), false);

  ok('refresh: the reload prop type admits the promise it actually returns',
    /onReloadReady\?: \(reload: \(\) => void \| Promise<unknown>\) => void;/.test(arch), false);
  ok('refresh: and ArchScreen still hands its reload up at all',
    /onReloadReady\?\.\(reload\)/.test(arch), false);
}


/* The failure notice must not tell the trader the request never came back when it did.
 *
 * `orderOutcome` has always separated the two ways of not knowing, with different
 * titles and cart reasons. The dialog BODY had one branch for both, so a server that
 * answered with an error printed that error underneath "The request did not come
 * back, so we cannot tell you whether NetSuite saved it." Seen on 2026-09-09 when a
 * rejected incoterms value came back as a clear server error.
 */
{
  const dlg = src('components/arch/ArchOrderDraftDialog.tsx');
  ok('outcome notice: the no-reply wording is gated on transportFailure',
    /\) : result\.transportFailure \? \(/.test(dlg), false);
  ok('outcome notice: a server error gets its OWN wording',
    /NetSuite answered with an error/.test(dlg), false);
  ok('outcome notice: and that branch does NOT claim the request never returned',
    !/answered with an error[\s\S]{0,200}did not\s*\n?\s*come back/.test(dlg), false);
  ok('outcome notice: both unknown branches still send the trader to the SO list',
    (dlg.match(/Check the sales order list before trying again/g) || []).length >= 2, false);
  ok('outcome notice: the refusal branch still claims nothing was written',
    /Nothing was written\./.test(dlg), false);
}


/* Lists a trader needs must not be read as the trader.
 *
 * A RESTlet ignores runasrole and runs as the CALLER. Measured 2026-09-09, the same
 * service call under three roles:
 *
 *                        customers visible   offered
 *   Administrator               806            465
 *   role 2181 (the trader)       25             24
 *   role 2184 (order endpoint)  416            397
 *
 * Role 2181 holds LIST_CUSTJOB, so nothing errored and the list was not empty. It is
 * a SALESCENTER sales role, so NetSuite narrowed it to its own customers in silence.
 * The sales-rep list was moved to the Suitelet for exactly this reason; customers and
 * sales teams were left behind.
 */
{
  const hook = src('hooks/useArchCustomers.ts');
  const api = src('lib/archOrderApi.ts');
  const sl = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/sl/mcgi_sl_arch_order_create.js');

  ok('customers: the endpoint is tried BEFORE the RESTlet',
    /fetchCustomersFromEndpoint\(ARCH_SUBSIDIARY_ID\)[\s\S]{0,200}apiGet\('customers'/.test(hook), false);
  ok('customers: and the RESTlet remains the fallback, so an old Suitelet still works',
    /viaEndpoint \|\| apiGet\('customers'/.test(hook), false);
  ok('customers: the endpoint helper returns null on failure rather than an empty list',
    /export const fetchCustomersFromEndpoint[\s\S]{0,1600}return null;/.test(api), false);
  ok('customers: the Suitelet proxies the action', /action === 'customers'/.test(sl), false);
  ok('customers: and calls the SAME service code rather than a copy',
    /archService\.getRouter\(\{/.test(sl), false);

  /*
   * 🔴 salesTeams must NOT be proxied. Under role 2184 the call fails outright with
   * `Record 'entitygroup' was not found` -- that role holds no group permission at
   * all, while 2181 holds LIST_CRMGROUP. Proxying turns partial data (44 teams, 0
   * members) into total failure. It was proxied for about ten minutes until the
   * measurement was taken.
   */
  ok('salesTeams: NOT proxied through the endpoint, because 2184 cannot read entitygroup',
    !/action === 'salesTeams'/.test(sl), false);
  ok('salesTeams: and the reason is written down where it would be re-added',
    /entitygroup.*was not found|no group permission/i.test(sl), false);
}

/* Item 5.b: the Open Sales Orders tab returned NO orders under the trader's role.
 *
 * Same silent-narrowing class as the customer list above, with a sharper cause.
 * MEASURED 2026-09-09/10:
 *
 *   role 2181 is SALESCENTER, issalesrole=T, subsidiaryoption=OWN, so NetSuite
 *   narrows a transaction search to that role's OWN records. Its only holder,
 *   employee 3293, sits on ZERO transactionsalesteam rows account-wide, reads
 *   issalesrep='F', and no customer on any open ARCH order carries a salesrep.
 *   The role's "own" set is empty by construction: the query succeeds, returns
 *   nothing, nothing errors.
 *
 * Unlike salesTeams this was measured BEFORE it shipped. handleGetOpenOrders
 * touches no entitygroup; the rep column reads transactionsalesteam, and
 * ADMI_TEAMSELLINGCONTRIBUTION is level 4 on BOTH roles. On the deployed endpoint,
 * 2184 against Administrator came back identical on all sixteen axes checked.
 *
 * 🔴 These are SOURCE-TEXT GREPS and they prove a string is in a file. They cannot
 * observe role narrowing at all -- archOpenOrders.test.mjs fakes N/query and returns
 * canned rows whatever role is faked -- so no test here can fail on the bug or prove
 * the fix. The live measurement is the proof; these only stop it being undone.
 */
{
  const hook = src('hooks/useArchOpenOrders.ts');
  const api = src('lib/archOrderApi.ts');
  const view = src('components/arch/ArchOpenOrdersView.tsx');
  const att = src('lib/archTraderAttribution.ts');
  const sl = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/sl/mcgi_sl_arch_order_create.js');

  ok('openOrders: the endpoint is tried BEFORE the RESTlet',
    /fetchOpenOrdersFromEndpoint\(ARCH_SUBSIDIARY_ID\)[\s\S]{0,400}apiGet\('openOrders'/.test(hook), false);
  ok('openOrders: and the RESTlet remains the fallback, so an old Suitelet still works',
    /leg\.outcome === 'ok'\) return leg\.body;[\s\S]{0,200}apiGet\('openOrders'/.test(hook), false);
  ok('openOrders: the Suitelet proxies the action', /action === 'openOrders'/.test(sl), false);
  ok('openOrders: and calls the SAME service code rather than a copy',
    /if \(action === 'openOrders'\)[\s\S]{0,400}archService\.getRouter\(\{/.test(sl), false);

  /* 🔴 `ok` is NOT enough and this is the guard that says why. An older Suitelet
   * falls through to its health payload, which is `{ok: true, service: ...}` with
   * no `success` and no `orders`. Branching on `ok` would read that as an order
   * list of length zero and render an empty tab -- the defect, in a new costume. */
  ok('openOrders: the helper demands success AND an orders array, never bare ok',
    /fetchOpenOrdersFromEndpoint[\s\S]{0,2600}body\.success !== true \|\| !Array\.isArray\(body\.orders\)/.test(api), false);

  /* The honesty half of 5.b. A data fix alone leaves the screen asserting a cause
   * that is false for whichever leg it did not come from. */
  ok('openOrders: the hook reports WHICH leg answered',
    /transport: ArchOpenOrdersTransport \| null/.test(hook), false);
  ok('openOrders: and derives it from the Suitelet own service key, which the RESTlet never sends',
    /body\.service === 'arch-order-create' \? 'endpoint' : 'restlet'/.test(hook), false);

  /* 🔴 A TWO-FILE STRING CONTRACT, so guard BOTH ends. The client above matches on
   * the literal 'arch-order-create'; if the Suitelet ever stops emitting it, every
   * endpoint response silently reclassifies as the RESTlet leg and the screen
   * starts naming the wrong cause -- with the whole suite green, because only one
   * side was pinned. */
  ok('openOrders: and the Suitelet actually EMITS that key on this action',
    /if \(action === 'openOrders'\)[\s\S]{0,900}service: 'arch-order-create'/.test(sl), false);

  ok('honesty: the RESTlet sentence is no longer printed unconditionally',
    /transport === 'endpoint'/.test(att) && /A RESTlet ignores runasrole/.test(att), false);
  ok('honesty: and the empty-state banner names a cause per leg rather than one for both',
    /transport === 'restlet'[\s\S]{0,900}transport === 'endpoint'/.test(view), false);

  /* 🔴 PIN THE CORRECTION ITSELF, not the mechanism that made it possible. The
   * false claim was "Only N items in the account carry the Hardwood segment",
   * presented as an account fact when HARDWOOD_ITEM_COUNT_SQL runs under whichever
   * role served the request. Guarding only for the word `transport` would let the
   * old sentence come straight back. */
  ok('honesty: the tagged count is no longer presented as an account fact',
    /This request could see \{taggedItemCount\} item/.test(view) &&
    !/item\{taggedItemCount === 1 \? '' : 's'\} in the account/.test(view), false);
  ok('honesty: and the tagging advice is inside the per-leg branches, not promised to everyone',
    !/\}\{' '\}\s*\n\s*Tagging the remaining hardwood items will populate this tab\./.test(view), false);

  /* 🔴 The endpoint-first chain falls back only on TOTAL failure, and the service is
   * built never to total-fail: three catch blocks swallow a failed cost lookup, a
   * failed sales-team read and a failed tagged-item count, each still returning
   * success:true with a full order list. Without these the screen prints a confident
   * count over data that quietly lost a column. */
  ok('degradation: a POPULATED tab can still say it is incomplete',
    /degraded: string\[\]/.test(hook) && /degradationsIn\(/.test(hook), false);
  ok('degradation: uncosted lines are counted, since costSource reaches the client and nothing rendered it',
    /costSource === 'unknown'/.test(hook), false);
  ok('degradation: and the view renders it on a live populated tab, not only on an empty one',
    /orders\.length > 0 &&\s*\n?\s*\(visibleDegradations\.length > 0 \|\| transport === 'restlet'\)/.test(view), false);
  ok('degradation: row-level narrowing is recorded as undetectable rather than papered over',
    /Row-level narrowing is NOT in here and cannot be|ROW-LEVEL narrowing is NOT in here/.test(hook), false);

  /* 🔴 THREE STATES, NOT ONE. `null` from the helper used to mean "unconfigured",
   * "refused" and "failed" all at once, and the banner named the third for all of
   * them. Refusal is the MAJORITY case -- the screen is deployed to all employees
   * while this endpoint permits [2181, 3] -- so the commonest reading was the
   * wrong one, and it named a cause the reader could not act on. */
  ok('fallback: the helper distinguishes unconfigured, refused and failed',
    /outcome: 'unconfigured'/.test(api) && /outcome: 'refused'/.test(api) && /outcome: 'failed'/.test(api), false);
  ok('fallback: refusal is read off the body code, because the Suitelet answers 200 to a 403',
    /body\.code === 'FORBIDDEN'/.test(api), false);
  ok('fallback: and the banner words each reason differently',
    /fallbackReason === 'refused'/.test(view) && /fallbackReason === 'unconfigured'/.test(view), false);

  /* A live fetch in flight is not demo data, and this change made that window
   * longer by putting a slower leg in front of the RESTlet. */
  ok('loading: is its own state, so the tab stops calling live data placeholders',
    /const isLoading = source === 'loading'/.test(view) && /const isDemo = source === 'fixtures'/.test(view), false);
  ok('loading: and does not fall through to the live-and-empty banner either',
    /\{isLoading && orders\.length === 0 \? \(/.test(view), false);
}

// Stock the screen cannot show must be said out loud on the screen, not only in the
// MR's audit log. Added 2026-09-10 after Marc-Antoine added bundles in sandbox, saw
// the grid unchanged, and asked whether he had to trigger something. He did not: his
// lots were on items with no Hardwood segment, and the only place that fact appeared
// was an hourly execution log no trader reads.
{
  const s = src('components/ArchScreen.tsx');
  const mr = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js');

  ok('the MR carries the untagged count into META, or the screen can never say it',
    /untaggedItemCount:\s*untaggedItems\.length/.test(mr), null);
  ok('  ...at BOTH META write sites, so the shrink-guard path does not blank it',
    (mr.match(/untaggedItemCount:/g) || []).length === 2,
    (mr.match(/untaggedItemCount:/g) || []).length);

  ok('the screen reads it', /meta\?\.untaggedItemCount/.test(s), null);
  const flat = s.replace(/\s+/g, ' ');
  ok('  ...and renders a VISIBLE notice, not only a tooltip title',
    /role="status"/.test(s) && /are not on this screen/.test(flat), null);
  ok('  ...telling him nothing needs triggering, which was his actual question',
    /nothing needs triggering/.test(flat), null);
  ok('  ...and naming what to do about it',
    /put the item in subsidiary <span className="font-mono">ARC<\/span>/.test(s) &&
      !/Set <span className="font-mono">Hardwood<\/span>/.test(s), null);

  // It must NOT fire on demo data, where the count would read as a live account fault.
  ok('the notice is gated on live NetSuite data',
    /source === 'netsuite' && !!meta\?\.untaggedItemCount/.test(s), null);
}

// Ready to Build warns instead of blocking (Marc-Antoine, in writing, 2026-08-14 11:33:
// « un warning qui n'empeche pas le Edit, mais qui le mentionne au trader »). The trap
// is that no NetSuite field feeds this status on real orders yet, so a FIXTURE order is
// the only thing that can carry it. Both warn sites originally hid behind a
// "is this a real order" test, which made the behaviour render nowhere at all. On
// 2026-09-09 a branch reorder in the wizard removed the last state where it had ever
// appeared, and nothing caught it. These pin reachability, not wording.
{
  const w = src('components/arch/SOWizard.tsx').replace(/\s+/g, ' ');
  const v = src('components/arch/ArchOpenOrdersView.tsx').replace(/\s+/g, ' ');

  // The status must never disable the control. That is the client's actual instruction.
  ok('wizard: Ready to Build does not lock the order button',
    /const locked = demo;/.test(w) && !/locked = readyToBuild/.test(w), null);
  ok('orders view: Ready to Build does not gate editability',
    /const editable = !!o\.internalId;/.test(v) && !/editable =[^;]*buildWarning/.test(v), null);

  // ...and it must still be SAID. A ternary that picks one fact drops the other, and
  // since demo is true on every order that can carry the status, demo always won.
  ok('wizard: the demo and Ready to Build texts compose rather than exclude',
    /\.filter\(Boolean\) \.join\(' '\)/.test(w) || /\.filter\(Boolean\)\.join\(' '\)/.test(w), null);
  ok('  ...so a demo order that is Ready to Build says both things',
    /demo \? 'Demo order/.test(w) && /readyToBuild \? 'Ready to Build/.test(w), null);

  // The orders view attached the warning only to Edit, which renders only when editable,
  // i.e. never on the fixture orders that are the only ones carrying the status.
  ok('orders view: the warning is reachable on a non-editable row too',
    /buildWarning \? 'These are demo orders/.test(v), null);

  // Both sites must warn about preparation, which is the substance he asked for.
  for (const [label, s] of [['wizard', w], ['orders view', v]]) {
    ok(`${label}: the warning says the warehouse may already be preparing it`,
      /may already be preparing/.test(s), null);
  }
}

// ── Open Sales Orders bands by the SALES REP, and setReadyToBuild is scoped ──
//
// Both added 2026-09-14 after clicking the deployed sandbox screen.
//
// The grouping default was CREATOR, citing Marc-Antoine 2026-09-08. He retracted
// it on the 2026-09-10 call at [32:00] once he saw the result, and the live screen
// showed exactly what he complained about: 7 open orders banded as "House Blend 2"
// x6 and "Marc-Antoine Poirier" x1, while the Sales Rep column underneath carried
// Lucas Gibb, Alec Wolf and Camil Perrault. The creator is the integration account
// on nearly every real order, so it is the axis with no information in it.
{
  const v = src('components/arch/ArchOpenOrdersView.tsx');

  ok('open orders: the grouping default is the rep, unconditionally',
    /const groupBy: GroupAxis = axisOverride !== null \? axisOverride : 'rep';/.test(v), null);
  ok('  ...and the anyCreator fallback is gone, not merely unused',
    !/const anyCreator = React\.useMemo/.test(v), null);
  ok('  ...while the creator SURVIVES as a column and an option',
    /<option value="creator">/.test(v) && /<option value="rep">/.test(v), null);
  ok('open orders: the retraction is recorded, not just the change',
    /32:00/.test(v) && /mal compris pour le created by/.test(v), null);
}

// setReadyToBuild took ANY sales order id, in a module whose creation path refuses
// a non-ARCH item line by line. Measured live 2026-09-14: 4,219 non-Hardwood sales
// orders exist in this sandbox, every one of which it would have written to.
{
  const s = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js');

  ok('setReadyToBuild: an ARCH scope check exists',
    /const readOrderArchScope = \(soId\) =>/.test(s), null);
  ok('  ...and runs BEFORE the record is loaded',
    s.indexOf('const scope = readOrderArchScope(id);') > 0 &&
      s.indexOf('const scope = readOrderArchScope(id);') <
        s.indexOf("so = record.load({ type: record.Type.SALES_ORDER"), null);
  // Feedback 14 (2026-09-22): the scope is subsidiary ARC by NAME. Still never an id.
  ok('  ...testing the subsidiary BY NAME, never an internal id',
    /return sub === ARCH_SUBSIDIARY_NAME;/.test(s) && !/department === 11/.test(s) && !/subsidiary === 9/.test(s), null);
  // 🔴 RELOCATED 2026-09-21, not removed. The exclusion moved into the shared
  // `inArchScope`, which refuses decking BEFORE testing either arm of the
  // department/subsidiary union -- a stronger form of the same rule, because it
  // cannot be forgotten on the new arm.
  ok('  ...and honouring the same decking exclusions as the line check',
    /if \(NON_ARCH_DEPARTMENT_ITEMS\.indexOf\(code\) !== -1\) return false;/.test(s) &&
      /if \(inArchScope\(dept, rows\[i\]\.sub, code\)\)/.test(s), null);

  // The distinction that matters: a read that FAILED must not be reported as a
  // business rule about the order. Three separate refusals, three separate causes.
  ok('setReadyToBuild: "could not read" is refused differently from "not ARCH"',
    /its lines could not be read/.test(s) && /is not an ARCH order/.test(s), null);
  ok('  ...and an empty order is its own case again',
    /has no lines, so there is nothing to/.test(s), null);
  ok('  ...with the scope failure logged rather than swallowed',
    /ARCH scope check failed/.test(s), null);

  // Prod has no Hardwood department, so this refuses everything there. That is
  // correct, and it must be written down or it reads as a bug during cutover.
  ok('setReadyToBuild: the production consequence is recorded next to the guard',
    /IN PRODUCTION THIS CURRENTLY REFUSES EVERYTHING/.test(s), null);
  // One hardwood line is enough, and nobody asked the client. Flagged, not hidden.
  ok('  ...and the one-line-is-enough choice is flagged as unconfirmed',
    /ONE LINE IS ENOUGH, and that is a decision nobody has put to the/.test(s), null);
}

// ── Ready to Build, after driving the deployed sandbox screen 2026-09-14 ─────
//
// Four defects were found by clicking, not by reading. Each guard below pins the
// fix AND the reason, because three of the four were protected by a comment that
// asserted the opposite of what the screen was doing.
{
  const lo = src('lib/archLotOrders.ts');
  const lt = src('components/arch/ArchLotTable.tsx');
  const v = src('components/arch/ArchOpenOrdersView.tsx');
  const mr = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js');

  // 1. The drawer named no order. Cache carried it; one hardcoded bucket dropped it.
  ok('drawer: readyToBuild can resolve orders, not only reserve',
    /bucket === 'readyToBuild' && ordersCarryBucket\(lot\.orders\)/.test(lo), null);
  ok('  ...but ONLY on a payload that says which bucket each order landed in',
    /const ordersCarryBucket = /.test(lo) &&
      /typeof o\.readyToBuild === 'boolean'/.test(lo), null);
  ok('  ...and each tab is filtered, so neither shows the other tab\'s orders',
    /bucket === 'readyToBuild' \? o\.readyToBuild === true : o\.readyToBuild !== true/.test(lo), null);
  ok('  ...while outbound stays unresolvable, which was always correct',
    !/'outbound'/.test(lo.split('export const orderSource')[1].split('};')[0] || ''), null);

  // The server half. Without the stamp the client cannot tell the buckets apart,
  // which is why reading `orders` for both was reverted on 2026-09-10.
  ok('cache MR: each order entry is stamped with the bucket its share landed in',
    /readyToBuild: !!readyToBuildIds\[oid\]/.test(mr), null);
  ok('  ...from the SAME map that decided the quantity, so they cannot disagree',
    /Stamped from the SAME `readyToBuildIds` map/.test(mr), null);

  // 2. The comments that justified the empty drawer, all three sites.
  /* The old claim is deliberately still QUOTED, because this codebase records what
     was wrong rather than deleting it. So absence is the wrong test: what matters is
     that every place it appears is inside a correction, never as a live assertion. */
  ok('the "readyToBuild is a literal 0" claim appears only inside a correction',
    (lt.match(/readyToBuild is a literal 0|hardcoded 0 in\s*\n?\s*\*?\s*the ARCH cache/g) || [])
      .length === (lt.match(/CORRECTED 2026-09-14[\s\S]{0,900}?(readyToBuild is a literal 0|hardcoded 0 in\s*\n?\s*\*?\s*the ARCH cache)/g) || []).length,
    null);
  ok('  ...both sites carry the correction marker',
    (lt.match(/⚠️ CORRECTED 2026-09-14/g) || []).length >= 2, null);
  ok('  ...and the correction names what was actually on screen',
    /315643-5/.test(lt), null);

  // 3. A tick is invisible on the grid until the cache rebuilds.
  ok('open orders: a successful tick says the grid lags behind',
    /rtbLagNotice/.test(v) && /will not\b[\s\S]{0,40}show it until the next rebuild/.test(v), null);
  ok('  ...without hardcoding a duration, because the TTL is 12h not 1h',
    !/within the hour|up to an hour|in about an hour/i.test(v), null);

  // 4. The tick was offered where it provably does nothing.
  ok('open orders: the tick is disabled once the order has shipped',
    /const shippedAlready = o\.status === 'In Transit';/.test(v) &&
      /disabled=\{rtbBusy\.has\(o\.soNo\) \|\| shippedAlready\}/.test(v), null);
  ok('  ...and says why, rather than just going grey',
    /already shipped, so Ready to Build no longer applies/.test(v), null);
  ok('  ...with the no-op arithmetic recorded so nobody re-enables it',
    /open = max\(0, ordered - moved\)/.test(v), null);
}

// ── A team that credits somebody other than the order's owner ───────────────
//
// Measured 2026-09-14: Lucas Gibb, the rep on two of the three genuinely open
// ARCH orders, appears in NONE of the 44 named teams. Alec Wolf, Christopher
// Pajot and Tom Gorelle have no solo team, so picking them means picking a
// pairing that credits somebody else too.
{
  const w = src('components/arch/SOWizard.tsx');
  const s = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js');

  ok('wizard: warns when the picked team excludes the order\'s rep',
    /const teamExcludesRep = React\.useMemo/.test(w) &&
      /This team does not include the rep above/.test(w), null);
  ok('  ...naming who is credited instead, rather than a generic caution',
    /commission goes to\{' '\}/.test(w), null);
  ok('  ...and telling the truth about whether anything is written yet',
    /Nothing is written yet, so today the rep above is credited in full/.test(w), null);

  // 🔴 The important half. A REFUSAL here would break a combination the client
  // asked for, and the server comment says so. This guard exists to stop a future
  // reader "hardening" the notice into a block.
  ok('server: a rep outside the team is still ACCEPTED, not refused',
    /header\.salesRepId` is NOT required to be a member of the team/.test(s) &&
      /refusing it would block it/.test(s), null);
  ok('  ...and nothing cross-checks the two on the write path',
    /const repId = namedTeam \? null : resolveSalesRep\(/.test(s), null);
}

// Wizard navigation, Feedback 6 items 6a and 6b. Both are one-line behaviours that a
// later refactor could quietly revert, and neither is reachable by a unit test: the
// rule they rest on is tested in wizardNav.test.mjs, what is pinned here is that the
// component actually uses it.
{
  const w = src('components/arch/SOWizard.tsx');

  // 6b. The rail used to read `i < stepIndex && setStepIndex(i)`, backwards only.
  ok('rail: navigation goes through canJumpToStep, not an inline backwards-only test',
    /canJumpToStep\(stepIndex, i, stepValidList\)/.test(w) &&
      !/onClick=\{\(\) => i < stepIndex && setStepIndex\(i\)\}/.test(w), null);
  ok('  ...and a step that cannot be reached says so rather than sitting silently inert',
    /aria-disabled=\{!on && !canJump \? true : undefined\}/.test(w), null);
  // 🔴 NOT `disabled`. Chrome suppresses mouse events on a disabled button, so its
  // title never renders, and the tooltip would be invisible on exactly the tabs that
  // need to explain themselves.
  ok('  ...without using the disabled attribute, which would hide that explanation',
    !/\sdisabled=\{!on && !canJump\}/.test(w), null);
  ok('  ...and says which step is blocking it',
    /firstBlockingStep\(i, stepValidList\)/.test(w) && /Finish ' \+ STEPS\[blocker\]\.label/.test(w), null);
  ok('  ...with a hover state, because an inline style carries no :hover',
    /hoverStep/.test(w) && /onMouseEnter=\{\(\) => setHoverStep\(i\)\}/.test(w), null);
  ok('  ...fed by the same validity the Continue button uses',
    /const stepValidList = STEPS\.map\(\(s\) => stepValid\[s\.key\]\)/.test(w), null);

  // 6a. Clicking the "Create sales order" card advances. ONLY that card: the other
  // one reveals an order picker, so advancing from it would skip the question.
  const startCard = w.slice(w.indexOf('const startBody'), w.indexOf('const startBody') + 7000);
  ok('start: the Create sales order card moves to the next step by itself',
    /setStepIndex\(1\);/.test(startCard), null);
  ok('  ...and only from the new-order branch',
    /if \(m === 'new'\) \{[\s\S]*?setStepIndex\(1\);[\s\S]*?\}/.test(startCard), null);

  // 🔴 The pair 6a and 6b created between them. Clicking this card clears the whole
  // header, which was survivable while Start was six Back clicks from Review and
  // nobody went there. With the rail one click away and this card the way forward, an
  // unguarded reset loses a header the trader filled in three steps earlier.
  ok('start: the header reset fires only when the mode actually changes',
    /const changed = mode !== m;/.test(startCard) &&
      /if \(changed\) \{[\s\S]*?setCustomer\(''\);/.test(startCard), null);
  ok('  ...and so does clearing the sales team',
    /if \(changed\) setSalesTeamId\(''\);/.test(startCard), null);
  ok('  ...while the advance itself is NOT conditional, or the card stops answering',
    /\}\s*\/\*[\s\S]*?THE CARD IS THE ANSWER[\s\S]*?\*\/\s*setStepIndex\(1\);/.test(startCard), null);
}

// Feedback 6 item 9. The banner is gone from the Remanufacturing step, and every
// figure that is a SERVICE or a COST prints Canadian dollars whatever the order is
// billed in: "Le service cost sera toujours en CAD, même si le SO est en USD."
{
  const w = src('components/arch/SOWizard.tsx');
  const remanStep = w.slice(w.indexOf('const remanBody'), w.indexOf('const priceBody'));
  ok('reman step: the warning banner is gone', remanStep.length > 500 && !/<ProvisionalNote>/.test(remanStep), null);
  ok('reman step: the per-line service cost follows the conversion, never the raw order currency',
    /fmtMoney\(e\.planingCost \+ e\.cuttingCost, costShown\)/.test(w) &&
      !/fmtMoney\(e\.planingCost \+ e\.cuttingCost, currency/.test(w), null);
  // The constant that every cost label now routes through, and what it holds.
  ok('  ...and that currency is Canadian, named once in the pricing module',
    /export const COST_CURRENCY = 'CAD';/.test(src('lib/archOrderPricing.ts')), null);
  ok('  ...so the reman rate legend is Canadian too, rather than falling back to USD',
    /fmtMoney\(planingRate, COST_CURRENCY\)/.test(w) && /fmtMoney\(cuttingRate, COST_CURRENCY\)/.test(w), null);
  // Item 10c: the rate the legend prints is the one the maths uses, record first.
  ok('  ...and both come from the record when it has a usable row',
    /const planingRate = liveRates\.planing \?\? PLANING_RATE;/.test(w) &&
      /const cuttingRate = liveRates\.cut \?\? CUT_RATE;/.test(w), null);
  ok('review strip: the cost side follows the conversion',
    /fmtMoney\(totals\.lotCost, costShown, 0\)/.test(w) &&
      /fmtMoney\(totals\.processingCost \+ totals\.opsInsuranceCost, costShown, 0\)/.test(w), null);
  // 🔴 Item 10b. A converted figure must say the currency it was converted INTO,
  // and an unconverted one must keep saying CAD. One derivation, both cases.
  ok('  ...and that label is derived from the rate, not chosen by hand',
    /const costShown = costFx === 1 \? COST_CURRENCY : orderCurrency;/.test(w), null);
  ok('  ...with a missing rate treated as not converted rather than as parity',
    /const costFx = fx && fx\.status === 'ok' && fx\.rate \? fx\.rate : 1;/.test(w) &&
      /fx !== null && costFx === 1;/.test(w), null);
  // 🔴 Three states. Loading is not failing: the first render of every non-Canadian
  // order has no rate yet, and saying "NOT converted" there trains a trader to
  // ignore the line that matters when it is true.
  ok('  ...and loading is distinguished from failing',
    /const fxLoading = currency !== '' && currency !== COST_CURRENCY && fx === null;/.test(w) &&
      /const fxNote = fxLoading/.test(w), null);
  // Items 9b and 10b disagree on the reman step without this: a Canadian rate above
  // a converted column.
  ok('  ...and the reman step says its service cost column was converted',
    /The <strong>Service cost<\/strong> column is converted into \{orderCurrency\}/.test(w), null);
  // Items 5 and 12: a role that may read but not write learns it before the work.
  ok('order wizard: a role that cannot create is stopped before it fills the form',
    /const writeRefused = !!writeAuth && writeAuth\.status === 'ok' && !writeAuth\.allowed;/.test(w) &&
      /priceOk && !writeRefused;/.test(w) &&
      /cannot create orders with it/.test(w), null);
  ok('  ...and the rate is stated on screen whenever one was applied',
    /\{fxNote &&/.test(w) && /Costs converted from/.test(w) && /Costs are NOT converted/.test(w), null);
  ok('  ...and the confirmation totals use the same rate and rates as the screen',
    /writableLines\.map\(\(l\) => lineEconomics\(l, sp\(l\.key\), rm\(l\.key\), parseFloat\(pr\(l\.key\)\) \|\| 0, costFx, liveRates\)\)/.test(w), null);
  // Item 10a: the two columns he ringed say which currency they are in.
  ok('pricing table: Cost/BF and Price/BF name their currencies in the header',
    /Cost \/ BF \(\{COST_CURRENCY\}\)/.test(w) && /Price \/ BF \(\{orderCurrency\}\) \*/.test(w), null);
  // 🔴 Every fmtMoney call names a currency. Its default is USD, so an unlabelled
  // call is a silent claim that the figure is American, which is how the reman rate
  // legend and the Review price column came to be wrong. Scanned rather than
  // regexed in one shot: a call like fmtMoney(parseFloat(pr(l.key)) || 0, cur)
  // carries nested parentheses that a single pattern reads badly.
  {
    const bare = [];
    let at = 0;
    for (;;) {
      const i = w.indexOf('fmtMoney(', at);
      if (i === -1) break;
      at = i + 9;
      const window = w.slice(i, i + 170);
      if (!/COST_CURRENCY|orderCurrency|costShown|currency \|\| 'USD'/.test(window)) bare.push(window.slice(0, 60));
    }
    ok('  ...and every money cell names its currency rather than defaulting to USD',
      bare.length === 0, bare);
  }
  // 🔴 The other half of the rule. Revenue and profit are the ORDER's currency, and
  // a later pass that relabels everything CAD would be just as wrong in the other
  // direction. The mixing itself is item 10b and is not solved by a label.
  ok('review strip: revenue and profit stay in the order currency',
    /fmtMoney\(totals\.revenue, currency \|\| 'USD', 0\)/.test(w) &&
      /fmtMoney\(totals\.profit, currency \|\| 'USD', 0\)/.test(w), null);
  ok('the profit formula quotes the service rates in CAD',
    /Services = CA\$/.test(w) && /CA\$\{cuttingRate\.toFixed\(2\)\}\/BF cutting/.test(w), null);
}

// Feedback 6 item 11. The two panels he ringed at the foot of Review are gone, and
// the ones he did not ring are still there. Both halves matter: the append notices
// are the difference between updating an order and silently not updating it.
{
  const w = src('components/arch/SOWizard.tsx');
  const review = w.slice(w.indexOf('const reviewBody'), w.indexOf('const bodies:'));
  ok('review: the source slice was found', review.length > 1000, review.length);
  // Every remaining panel on Review must be CONDITIONAL. An unconditional one is
  // what he ringed: a box that is there on every order whatever it says.
  {
    const unconditional = [];
    let at = 0;
    for (;;) {
      const i = review.indexOf('<ProvisionalNote>', at);
      if (i === -1) break;
      at = i + 17;
      if (!/&& \(\s*$/.test(review.slice(Math.max(0, i - 120), i))) {
        unconditional.push(review.slice(i, i + 70));
      }
    }
    ok('review: every remaining panel is conditional', unconditional.length === 0, unconditional);
  }
  ok('review: the "this writes a real sales order" panel is gone',
    !/This writes a real sales order/.test(w), null);
  ok('review: the reman panel is gone, and its derived state with it',
    !/Remanufacturing on \{remanLines\.length\}/.test(w) &&
      !/const remanLines = React\.useMemo/.test(w) &&
      !/const remanTotalCost = React\.useMemo/.test(w), null);
  // 🔴 NOT removed, and not his to lose. An append that writes nothing, or writes
  // only some of what is on screen, is the one thing Review has to say.
  ok('review: the append-mode notices survive',
    /Nothing would be written to \{existingSO\}/.test(review) &&
      /written to \{existingSO\}/.test(review) &&
      /Lines already on the order are shown for context/.test(review), null);
  ok('review: the under-trigger pricing notice survives, he left it unringed',
    /priced under the trigger/.test(review), null);
  // 🔴 And it compares like with like. The typed price is the ORDER's currency and
  // costPerBF is Canadian, so without costFx the notice fired on healthy US prices
  // between 2.94 and 4.09 against a CA$3.72 cost. Same multiplier as the margins.
  ok('review: the low-price trigger is the tested rule, with the same rate as the margins',
    /isLowPricedAt\(parseFloat\(pr\(l\.key\)\) \|\| 0, l\.costPerBF, costFx\)/.test(w) &&
      !/p < \(l\.costPerBF \|\| 0\) \* LOW_PRICE_TRIGGER/.test(w), null);
}

// Feedback 6 item 12. The order endpoint authorises READS by the deployment
// audience and WRITES by its own allowlist. Pinned on the server file because the
// difference between the two is the difference between a trader being able to load
// the wizard and a trader being able to commit stock with it.
{
  const sl = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/sl/mcgi_sl_arch_order_create.js');
  ok('order endpoint: the role allowlist applies to writes only',
    /const isWrite = context\.request\.method !== 'GET';/.test(sl) &&
      /if \(isWrite && allowed\.indexOf\(Number\(user\.role\)\) === -1\)/.test(sl), null);
  // 🔴 The load-bearing half. Opening GET is only safe while every write action is
  // behind the POST guard; a write reachable from the GET branch would have handed
  // three roles the ability to change an order.
  {
    const postGuard = sl.indexOf("context.request.method !== 'POST'");
    const setRtb = sl.indexOf("input.action === 'setReadyToBuild'");
    ok('order endpoint: every write action sits behind the POST guard',
      postGuard > 0 && setRtb > postGuard, { postGuard, setRtb });
  }
  ok('order endpoint: the runasrole is not described as Administrator, because it is not',
    /runasrole` is `customrole2184`/.test(sl) && !/runs as an administrator/.test(sl), null);
}

// The cross-point pass over items 6 to 12. Each of these is a defect two correct
// changes produced between them, so each guard names the pair.
{
  const w = src('components/arch/SOWizard.tsx');
  const d = src('components/arch/ArchOrderDraftDialog.tsx');
  const sl = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/sl/mcgi_sl_arch_order_create.js');
  const lib = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js');

  // 10b + the open-orders service: an existing line arrives already converted.
  ok('append: an existing line is put back into the cost currency before the one conversion',
    /costPerBF: l\.costPerBF \* rate/.test(w) && /exchangeRate/.test(src('hooks/useArchOpenOrders.ts')), null);
  // 10c: the rates the screen prints are the rates the money used.
  ok('economics recompute when the milling rates change',
    /\[lines, split, reman, price, costFx, liveRates\]/.test(w), null);
  // 9b + 10c: no literal rate anywhere in the prose.
  ok('the pricing note reads the live rates rather than a literal',
    !/reman rates are confirmed at \$0\.20/.test(w) &&
      /The reman rates are \{fmtMoney\(planingRate, COST_CURRENCY\)\}/.test(w), null);
  // 10b + 11: the rate is stated on the step that commits, not only on Pricing.
  ok('review states the conversion and the availability consequence',
    /\{fxNote &&[\s\S]{0,400}reviewBody|reviewBody[\s\S]{0,900}\{fxNote &&/.test(w) &&
      /bundles leave availability on save/.test(w), null);
  // Append: steps are validated on what the save writes.
  ok('step validity follows writableLines, not the lines on screen',
    /const splitOk = writableLines\.every/.test(w) &&
      /const remanOk = writableLines\.every/.test(w) &&
      /const priceOk = writableLines\.every/.test(w), null);
  // The confirmation dialog is the last thing seen before a write.
  ok('confirm dialog names its currency and refuses to invent a margin',
    /fmtMoney\(l\.pricePerBF, cur\)/.test(d) &&
      /draft\.totals\.allCostsKnown \? fmtMoney\(draft\.totals\.profit, cur, 0\)/.test(d), null);
  // 12: a refusal is now an ordinary outcome, so it cannot be an error line.
  ok('a role refusal is audited, not logged as an error, and says what it refused',
    /log\.audit\('ARCH Order Create',/.test(sl) &&
      /open the ARCH screen but not change orders with it/.test(sl), null);
  // 12: the diagnostics stayed where they were, on the write list.
  ok('the developer probes are gated on the write list, not on the audience',
    /const mayDiagnose = allowed\.indexOf\(Number\(user\.role\)\) !== -1;/.test(sl) &&
      /mayDiagnose \? \(context\.request\.parameters \|\| \{\}\)\.probeDeptCustomer : null/.test(sl) &&
      /if \(!mayDiagnose\) return undefined;/.test(sl), null);
  // 10b + 10c: one date parser, and a currency code rather than a LIKE pattern.
  ok('both new endpoint actions use the one date parser in that file',
    /const asked = parseIsoDate\(dateIso\);/.test(lib) && /const parsed = parseIsoDate\(dateIso\);/.test(lib) &&
      !/\/\^\d\{4\}-\d\{2\}-\d\{2\}\$\/\.test\(String\(dateIso\)\)/.test(lib), null);
  ok('  ...and the rate is looked up by ISO code, with no wildcard surface',
    /\/\^\[A-Z\]\{3\}\$\/\.test\(target\)/.test(lib) &&
      /UPPER\(tc\.symbol\) = \?/.test(lib) && !/LIKE \?/.test(lib), null);
  ok('  ...and today is the account day, not UTC',
    /const isoDay =/.test(lib) && !/toISOString\(\)\.slice\(0, 10\)/.test(lib), null);
}

// 🔴 THE TEMPORAL DEAD ZONE GUARD. `isLowPriced` reads `costFx`, and for about an
// hour on 2026-09-15 it was declared 275 lines below it: the first lot a trader
// added ran `lines.filter(isLowPriced)`, threw "Cannot access before
// initialization", and React unmounted the entire screen to a white page. tsc does
// not model this across a function boundary and no unit test renders the component,
// so position is the only thing that can be asserted here.
{
  const w = src('components/arch/SOWizard.tsx');
  const decl = w.indexOf('const costFx = fx && fx.status');
  const reader = w.indexOf('isLowPricedAt(parseFloat(pr(l.key))');
  ok('costFx is declared before the low-price predicate that reads it',
    decl > 0 && reader > 0 && decl < reader, { decl, reader });
  const eco = w.indexOf('const economics = React.useMemo');
  ok('  ...and before the economics memo that passes it', decl > 0 && decl < eco, { decl, eco });
  const shown = w.indexOf('const costShown = costFx === 1');
  ok('  ...and costShown follows costFx rather than preceding it',
    shown > decl, { decl, shown });
}

// Feedback 6 item 13. The currency a customer is billed in comes from the customer
// record, never from `currenciesFor`, which is a SEEDED RANDOM on the name: it
// returns USD+CAD for exactly the customer he complained about, 84 Lumber Company.
{
  const w = src('components/arch/SOWizard.tsx');
  ok('currency: the picker reads the live customer, not a fixture',
    /const customerCurrencies = React\.useMemo<string\[\]>/.test(w) &&
      /return hit\.currencyCode \? \[hit\.currencyCode\] : \[\];/.test(w), null);
  // 🔴 The sublist BEFORE the primary field. 50 customers in this account hold two
  // currencies, so reading only `customer.currency` would swap an invented choice
  // for a missing one.
  ok('  ...and it offers every currency the customer record allows',
    /if \(hit\.currencyCodes && hit\.currencyCodes\.length\) return hit\.currencyCodes;/.test(w) &&
      /currencyCodes/.test(src('hooks/useArchCustomers.ts')), null);
  // An append is answered by the order, which carries its own stamped currency.
  ok('  ...while an append reads the order rather than the customer record',
    /if \(mode === 'existing'\) return currency \? \[currency\] : \[\];/.test(w) &&
      /from the sales order itself/.test(w), null);
  ok('  ...and the buttons and the sentence both read that list',
    /\{customerCurrencies\.map\(\(c\) => \(/.test(w) &&
      !/currenciesFor\(customer\)\.length > 1/.test(w), null);
  ok('  ...and a live customer with no currency is never given one',
    /setCurrency\(hit\?\.currencyCode \|\| ''\);/.test(w) &&
      !/setCurrency\(hit\?\.currencyCode \|\| currenciesFor/.test(w), null);
  // The fixture survives for the OFFLINE picker only, where a name is all there is.
  ok('  ...while the offline path keeps the fixture, and says so',
    /Fixture path only: this picker is reached when the live list is absent/.test(w), null);
}

// Feedback 6 item 14. The payment terms come from the customer record, which is
// what the field's own caption has always claimed. `paymentTermsFor` is a seeded
// random over five terms and returns "1% 15 Net 30 days" for 84 Lumber Company,
// the exact string in his screenshot; the record says ".5% 20 net 21 days".
{
  const w = src('components/arch/SOWizard.tsx');
  ok('terms: the field reads the customer record, not a fixture',
    /const customerTerms = React\.useMemo<string>/.test(w) &&
      /\(liveCustomer && liveCustomer\.termsName\) \|\| ''/.test(w) &&
      /value=\{customerTerms\}/.test(w), null);
  ok('  ...and Review and the draft read the same value',
    /\['Payment terms', customerTerms \|\| '—'\]/.test(w) &&
      /paymentTerms: customerTerms,/.test(w), null);
  // 76 of 1,058 active customers carry no terms, so the empty case is real.
  ok('  ...and a customer with no terms is not given some',
    /None on the customer record/.test(w), null);
  // One lookup feeds both the currency and the terms.
  ok('  ...through a single live-customer lookup',
    /const liveCustomer = React\.useMemo\(/.test(w), null);
}

// Item 14, adversarial pass. An append is answered by the ORDER: NetSuite stamps
// terms on the sales order and they do not follow a later edit to the customer.
// 2 of 1,269 ARCH orders already differ from their customer (2026-09-15), and the
// picker hides subsidiary 7 on purpose, so reading the customer record would also
// have said "None on the customer record" over 17 of 230 open orders.
{
  const w = src('components/arch/SOWizard.tsx');
  ok('terms: an append reads the order, not the customer record',
    /if \(mode === 'existing'\) return \(chosenOrder && chosenOrder\.termsName\) \|\| '';/.test(w), null);
  ok('  ...and the caption names the source it is reading',
    /From the sales order . read-only/.test(w) && /None on the order/.test(w), null);
  // `customersAreLive` is false while the list LOADS, and an append fills a real
  // customer before it lands; keying the fixture on the name alone flashed the
  // seeded-random terms over a real order, which is the reported defect itself.
  ok('  ...and the fixture is only for a demo name, never a real customer',
    /if \(!customersAreLive\) return customerId \? '' : paymentTermsFor\(customer\);/.test(w), null);
  // The order's own terms have to arrive for any of that to be true.
  const svc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service_arch.js');
  ok("  ...and the service sends the order's own terms",
    /BUILTIN\.DF\(t\.terms\)\s+AS termsname/.test(svc) && /termsName:\s+r\.termsname/.test(svc), null);
  // The last screen before the write treated an absent value as a blank cell.
  const dlg = src('components/arch/ArchOrderDraftDialog.tsx');
  ok('  ...and the confirmation dialog shows an absent value as absent',
    /\['Payment terms', draft\.header\.paymentTerms \|\| '—'\]/.test(dlg), null);
}

// Feedback 6 item 15. "Quand je clique sur Edit un existing SO, il y a un bon
// delais (10 secondes) avant que l'info apparraisse." The tab and the wizard each
// held their own copy of the hook, so Edit remounted the wizard and made it
// re-fetch the list the tab was already showing. Measured 2026-09-15: 2.3s to
// 11.9s per call. ONE fetch, held by the screen, and Edit waits for nothing.
{
  const scr = src('components/ArchScreen.tsx');
  const wiz = src('components/arch/SOWizard.tsx');
  const view = src('components/arch/ArchOpenOrdersView.tsx');
  // 🔴 THE GATE TEXT THIS USED TO MATCH IS GONE, ON PURPOSE. Feedback 9 item 12
  // asked the tab to populate on arrival, so the fetch is no longer gated. What
  // item 15 actually bought is UNCHANGED and is what is asserted now: ONE hook,
  // owned by the screen, handed to both consumers, so Edit waits for nothing.
  ok('edit speed: the screen owns the open-order list',
    /const openOrdersState = useArchOpenOrders\(true\);/.test(scr) &&
      /ordersState=\{openOrdersState\}/.test(scr), null);
  ok('  ...and both consumers take it from the screen',
    /ordersState\?: ArchOpenOrdersState;/.test(wiz) &&
      /ordersState\?: ArchOpenOrdersState;/.test(view), null);
  // The own-hook fallback keeps each component usable alone, but it must be
  // DISABLED when the parent supplies a list or there are two requests again.
  ok('  ...and the fallback hook cannot run a second request',
    /useArchOpenOrders\(!ordersState\)/.test(wiz) &&
      /useArchOpenOrders\(!ordersState\)/.test(view), null);
  /* 🔴 THIS GUARD IS RETIRED, AND DELIBERATELY REPLACED RATHER THAN DELETED.
   *
   * It read: "A trader who never opens an order must still not pay for the
   * list", and it pinned the lazy gate. Feedback 9 item 12 reverses that
   * decision on purpose -- "Sales Order tab. Est-ce qu'on peut faire en sorte
   * qu'elle popule directement (comme le TS)" -- so every screen load now pays
   * for a list many loads never look at.
   *
   * That is a real cost and it is not pretended away. What justifies it is that
   * the cost moves OFF the critical path: the request runs while the trader
   * reads the grid rather than while they wait on an empty tab, which serves the
   * very complaint item 15 came from ("bon delais (10 secondes)"). Page-load
   * frequency has NOT been measured, so that is the argument, not smallness.
   *
   * Two things now protect the trader in its place, and they are what this
   * block asserts.
   */
  // 1. The prefetch must be paired with a refresh when the tab opens. Without
  //    it, a trader arriving forty minutes later reads forty-minute-old orders,
  //    and a mount fetch that FAILED shows an error that may no longer be true.
  //    The prefetch is only the latency win; this is what keeps it honest.
  ok('  ...and the prefetch is paired with a refresh when the tab is opened',
    /if \(tab !== 'orders'\) return;/.test(scr) &&
      /openOrdersState\.reload\(\);/.test(scr), null);
  // 2. 🔴 AND IT IS NOT CACHED ON A TIMER, which is what "comme le TS" would
  //    literally mean and is the one option that is unsafe. Open orders change
  //    the moment a trader creates one, so a 15-minute cache hides a
  //    just-created order -- and the builder decides which existing lines to
  //    keep or drop from `chosenOrder.lines`, so a stale list would feed the
  //    APPEND path's arithmetic. The grid tolerates a cache because stock moves
  //    slowly and a shrink guard protects it; this has neither property.
  ok('  ...and the reason it is NOT cached like the grid is written down',
    /invalidated ON WRITE by the order endpoint/.test(scr), null);
}

// Item 15, the server half, RETIRED 2026-09-22 (Feedback 14). The department-id
// fast path (open orders 2.14s -> 1.24s) had already stopped paying off once the
// subsidiary arm put a BUILTIN.DF back into the same WHERE, and the department arm
// itself is gone: every row it added was CWP MTL stock at CWP MTL locations. What is
// pinned now is that the resolver is really gone and nothing hardcodes an id.
{
  const svc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service_arch.js');
  ok('open orders: the department-id resolver is removed, not left as dead code',
    !/hardwoodDepartmentId/.test(svc) && !/SELECT id FROM department WHERE name/.test(svc), null);
  ok('  ...and no literal id is compared inside the scope SQL',
    !/'i\.department = \d/.test(svc) && !/i\.subsidiary = \d/.test(svc), null);
}

// Item 15, adversarial pass. Sharing one list removed an ACCIDENT: the wizard used
// to remount and fetch its own copy, so an append at least saw its own result on the
// next Edit. Nothing ever reloaded the list on a write, so without this the trader
// can reopen the order they just appended to, not see those lines, and add them
// twice -- a duplicate write, not a stale caption.
{
  const scr = src('components/ArchScreen.tsx');
  ok('edit speed: a successful write refreshes the order list',
    /reloadOpenOrders\(\);/.test(scr) &&
      /const reloadOpenOrders = openOrdersState\.reload;/.test(scr), null);
  ok('  ...and the callback declares it rather than closing over a stale one',
    /\}, \[reloadOpenOrders\]\);/.test(scr), null);
  // Two guards on the department-id fallback lived here. Retired with the
  // department arm itself on 2026-09-22 (Feedback 14); see "Item 15, the server half".
}

// Feedback 6 item 18. "IA-CWP-730. Le MBF price est 12.76 vs 14.15." Both figures
// were right and they are different figures: 14.15 is what lot 316027-9 cost, 12.76
// is the on-hand-weighted average of the 21 ZEB84KD bundles at CWP Prevost, which run
// 12.25 to 14.15. The screen only ever carried the row average, and the margin and
// profit are computed off it too, so this was never only cosmetic.
{
  const mr = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js');
  ok("18: the cache emits the lot's own cost, which it already had",
    /l\.costPerUnit = costed \? Math\.round\(perBase \* rate \* 100\) \/ 100 : null;/.test(mr), null);
  // Base to display MULTIPLIES by rate for a cost and DIVIDES for a quantity. Three
  // bugs on this screen have come from that asymmetry.
  ok('18:  ...converted the same way the row average is, never divided',
    /costVal \+= l\.onHand \* \(perBase \* rate\);/.test(mr), null);

  const scr = src('components/ArchScreen.tsx');
  const drw = src('components/arch/ArchLotTable.tsx');
  ok('18: a cart line is priced at its own bundle, not the row',
    /costPerBF: lot\.costPerUnit === null \|\| lot\.costPerUnit === undefined/.test(scr), null);
  // 🔴 RELOCATED, NOT REMOVED, by Feedback 9 item 1. The drawer used to inline
  // the fallback chain; it now delegates to `lotCostDisplay`, which applies the
  // same rungs AND picks the currency. These two assertions follow the invariant
  // to where it lives instead of asserting on text that no longer exists, which
  // would have been the easy and wrong way to make this file green.
  const lots = src('lib/archLots.ts');
  ok('18:  ...and so is the drawer column that used to repeat one number per row',
    /lotCostDisplay\(lot, row\)/.test(drw) &&
      /if \(hasCost\(lot\.costPerUnit\)\) return \{ value: lot\.costPerUnit/.test(lots), null);
  // Null is not zero: an uncosted lot would otherwise price at free, and the row
  // average has always excluded those from both sides rather than counting them.
  ok('18:  ...and an uncosted lot falls back to the row, never to zero',
    /\? row\.avgCostPerUnit/.test(scr) && /return rowCostDisplay\(row\);/.test(lots), null);
}

// Item 18, adversarial pass. The screen's costing book is a deployment parameter;
// the write path's is not. `archSplitExecute` asks for no book on purpose, because
// an inventory adjustment posts to the PRIMARY one. Book 1 is primary here, so they
// agree today. A parameter change would put the screen on a basis the adjustment
// cannot follow, silently.
//
// 🔴 CORRECTED 2026-09-21. This comment used to say the USD book (id 2) "carries
// a line for every ARCH posting -- 175 in each book on ZEB84KD, measured". That
// measurement was real but it does NOT generalise, and reading it as though it did
// made flipping the cost book look like a free way to answer Feedback 9 item 1.
// ZEB84KD is a CWP MTL item. Measured across every ARCH inventory adjustment:
// 1,037 book-1 lines for subsidiary ARC and ZERO book-2 lines; the 143/143 pair is
// all CWP MTL. So pointing the screen at book 2 would blank the cost on the whole
// migrated inventory, which is the only inventory the client is looking at.
{
  const mr = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js');
  ok('18adv: a costing book other than the primary says so, loudly',
    /costing book is not the primary book/.test(mr) &&
      /_costBookCached !== ARCH_COST_BOOK_DEFAULT/.test(mr), null);
  const ex = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archSplitExecute.js');
  ok('18adv:  ...and the split still asks for no book, which is what makes them agree',
    /getLotCostsAtLocation\(\[String\(lotId\)\], locationId\)/.test(ex), null);
}

// Final cross-point pass, items 5 to 18. Item 18 put the per-lot cost on the grid
// and in the wizard; leaving the open-orders tab on the row average would have been
// item 18 again one surface across -- the same bundle reading 14.15 in the builder
// and 12.76 on the tab, and an APPEND mixing both bases in one profit total, because
// its existing lines come from that payload and its new ones from the grid.
{
  const svc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service_arch.js');
  ok('5-18: an open-order line is costed at its own bundle',
    /const lotCostFor = /.test(svc) &&
      /const rawCost = lotCost === null \? rowCost : lotCost;/.test(svc), null);
  // The pair key holds `{ onHand: [lots] }`, not `{ lots }` -- the first version of
  // this read looked for the wrong property and would have silently found nothing.
  ok('5-18:  ...reading the shape the cache actually writes',
    /parsed && parsed\.onHand/.test(svc) &&
      /buildDetailBucketKey\(itemId, locationId, 'onHand'\)/.test(svc), null);
  // One read per pair, and only for pairs on an open order.
  ok('5-18:  ...memoised per pair rather than per line',
    /const lotCostCache = \{\};/.test(svc), null);
  ok('5-18:  ...and falling back to the row average, never to zero',
    /lotCostCache\[pair\] = map;/.test(svc) && /if \(!hit\) return null;/.test(svc), null);
}

// Feedback 9 item 1, 2026-09-21. « BF cost : Est-ce qu'on peut afficher par défaut
// en USD? Au taux de la réception en inventaire ». The stored cost is CAD (proven
// three ways in `archCostCurrency.test.mjs`), so this is a conversion, and the
// conversion has three ways to go wrong that no type checker can see.
{
  const mr = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js');
  const svc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service_arch.js');
  const scr = src('components/ArchScreen.tsx');
  const grid = src('components/InventoryTableARCH.tsx');
  const drw = src('components/arch/ArchLotTable.tsx');

  // DIRECTION. `lotFx` is CAD per USD, so cost DIVIDES. Multiplying turns CA$2.31
  // into US$3.22 rather than US$1.66 -- an equally plausible number to look at.
  ok('f9-1: the per-lot USD cost divides by the rate, never multiplies',
    /perBase \* rate \/ fx/.test(mr) && !/perBase \* rate \* fx/.test(mr), null);

  // 🔴 EXACT DATE EQUALITY. `currencyrate` carries a 1970-01-01 stub row per
  // currency, fxsourcemethod 'N/A', USD at 1.101. An `effectivedate <= ?` lookup
  // for a 2023 receipt matches ONLY that stub and converts at 1.101 instead of
  // ~1.35: a silent 20% error wearing the face of a real rate. `archOrderCreate`
  // reads the table the other way and is right to, because it only ever asks
  // about today. This one asks about history and must not.
  ok('f9-1: the receipt-date rate is read by exact date, so the 1970 stub is unreachable',
    /crr\.effectivedate = t\.custbody4/.test(mr) &&
      /crt\.effectivedate = t\.trandate/.test(mr) &&
      // Alias-qualified, because real SQL here always writes `crr.`/`crt.`; a bare
      // `effectivedate <= ?` also appears in the doc comment above the helper as the
      // thing NOT to do, and the first version of this guard failed on that prose.
      !/cr[a-z]*\.effectivedate <=/.test(mr), null);

  // The row average is over per-lot USD, not the CAD average over one rate. A row
  // holding bundles received on different days converts at different rates, which
  // is the normal case, not an edge one.
  ok('f9-1: the row USD average is weighted per lot, not the CAD average over one rate',
    /costValUsd \+= l\.onHand \* \(perBase \* rate \/ fx\)/.test(mr) &&
      /costValUsd \/ costQtyUsd/.test(mr), null);

  // 🔴 THE CAD FIGURE IS ADDED TO, NOT REPLACED, AND THE CART MUST KEEP READING IT.
  // `SOWizard` multiplies every line by `costFx` to reach the order's currency at
  // the ORDER's stamped rate. Feed it an already-converted cost and it converts
  // twice: measured once at 11 margin points, in the direction that hides a loss.
  ok('f9-1: the cart still carries the CAD cost, so the wizard cannot convert twice',
    !/costPerUnitUsd/.test(scr) && !/avgCostPerUnitUsd/.test(scr), null);
  ok('f9-1:  ...and the builder still emits the CAD figure beside the USD one',
    /avgCostPerUnit: avgCostPerUnit,/.test(mr) &&
      /avgCostPerUnitUsd: avgCostPerUnitUsd,/.test(mr), null);

  // The currency travels with the number. A bare `$` on a Canadian figure is the
  // defect `formatCostPerUnit` already carries a comment about, and this change
  // makes the column genuinely mixed, so neither cell may omit it.
  ok('f9-1: both cost surfaces render the currency they were handed',
    /formatCostPerUnit\(cost\.value, row\.original\.unit, cost\.currency\)/.test(grid) &&
      /formatCostPerUnit\(cost\.value, row\.unit, cost\.currency\)/.test(drw), null);

  // META IS AN ALLOWLIST and this has been missed twice before, per its own
  // comment. A builder field absent here is invisible to the browser.
  ok('f9-1: the new meta fields are named in the service allowlist',
    /costCurrency:\s+meta\.costCurrency/.test(svc) &&
      /usdCostedRowCount:\s+meta\.usdCostedRowCount/.test(svc), null);

  // The spreadsheet must not drift from the screen. Found in the adversarial
  // pass on this item: the export wrote `avgCostPerUnit` directly, so a sheet
  // exported from a USD screen carried CAD numbers in an unlabelled column, and
  // this file's own comment says a spreadsheet gets forwarded and totalled by
  // someone who never saw the screen. It now routes through the same selector.
  const exp = src('lib/exportARCH.ts');
  ok('f9-1: the export uses the same selector as the grid, and names the currency',
    /rowCostDisplay\(r\)\.value/.test(exp) &&
      /rowCostDisplay\(r\)\.currency/.test(exp) &&
      /'Cost Currency'/.test(exp) &&
      !/r\.avgCostPerUnit/.test(exp), null);
  // A partial average is qualified on screen by a tooltip and a spreadsheet has
  // none, so the qualification has to travel in the cell itself.
  ok('f9-1:  ...and a partial average says so in the sheet, not only in a tooltip',
    /r\.costUsdPartial \? ' \(partial\)' : ''/.test(exp), null);

  // 🔴 THE FALLBACK MEANS "NO LOT DATE", NOT "NO RATE FOR THE LOT DATE".
  // Caught in the adversarial pass by recomputing all 860 lots independently:
  // lot 214065 carries custbody4 = 2023-03-29 and its adjustment posted
  // 2026-09-16, so the old `fxrec > 0 ? fxrec : fxtran` found no 2023 rate and
  // silently used the 2026 one. CA$31.07 became US$22.31 at a rate from another
  // year, on 70 lots, and it runs ~4% light, which flatters margin.
  ok('f9-1: a lot WITH a receipt date is priced at that date or not at all',
    /const fx = r\.lotdt \? num\(r\.fxrec\) : num\(r\.fxtran\);/.test(mr) &&
      !/num\(r\.fxrec\) > 0 \? num\(r\.fxrec\) : num\(r\.fxtran\)/.test(mr), null);
  // And the dedupe cannot become the same substitution by another route: keying
  // it off `out` would let a LATER adjustment supply a rate the earliest one was
  // refused.
  ok('f9-1:  ...and the earliest inbound decides, with seen tracked apart from out',
    /const seen = \{\};/.test(mr) && /if \(seen\[id\]\) return;/.test(mr), null);

  // A costing failure must cost the USD figure and nothing else. The row's
  // quantities are the reason the screen exists.
  ok('f9-1: a failed conversion degrades to CAD rather than losing the row',
    /ARCH cache USD cost conversion failed/.test(mr) &&
      /Every row keeps its CAD cost/.test(mr), null);
}

// Feedback 9 item 2, 2026-09-21. "Container : Sur un IA est-ce qu'on peut feed a
// partir de custbody5 (lot Vessel)". He is right about the field -- account-wide it
// holds real ship names (ULTRA YORKSHIRE, SAGA FRAM, SEA WAVE, "Inbound Truck") --
// but on the ARCH import all 210 vessel-bearing adjustments carry the lot's own
// prefix instead, and by his 2026-08-19 answer that number is the PO.
{
  const mr = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js');
  const grid = src('components/InventoryTableARCH.tsx');
  const drw = src('components/arch/ArchLotTable.tsx');
  const cfg = src('config/businessConfig.ts');

  // 🔴 THE PREFIX REFUSAL IS THE WHOLE ITEM. Without it this ships a column
  // headed Container holding PO numbers, which `poFromLotNo` forbids in capitals
  // and which is why the column was pulled off the main grid on 2026-08-19.
  ok('f9-2: a Lot Vessel that is merely the lot prefix is refused',
    /const vesselFor = \(l\) =>/.test(mr) &&
      /if \(ln\.indexOf\(vu\) === 0\) return '';/.test(mr), null);
  // The prefix test alone has a hole today's data does not show: lot `001326-2`
  // against vessel `1326` matches at position 2, so a PO number would reach a
  // column headed Container after all. Measured 210 of 210 at position 1 and 0
  // elsewhere, but the leading-zero lot family exists in this account.
  ok('f9-2:  ...and so is an all-digit value sitting anywhere in the lot number',
    /if \(\/\^\[0-9\]\+\$\/\.test\(vu\) && ln\.indexOf\(vu\) !== -1\) return '';/.test(mr), null);

  // The packing-list capture holds a real ISO 6346 code and must win over a
  // vessel name. Order matters in the `||` chain, so it is asserted literally.
  // Feedback 15 appends the PO's Seal / Trailer # as the LAST fallback; the
  // packing list still wins, then the IA vessel.
  ok('f9-2:  ...and the packing-list container still wins over the vessel, then the PO seal',
    /containerNo:\s+\(tally && tally\.container\) \|\| vesselFor\(l\) \|\| lotSeals\[String\(l\.lotId\)\] \|\| ''/.test(mr), null);

  // `po` is deliberately NOT changed by this item. The prefix is still reported as
  // the PO, which is his own nomenclature, and repairing that column is a separate
  // decision that has not been taken.
  ok('f9-2:  ...and po is still the lot prefix, untouched by this item',
    /po:\s+poFromLotNo\(l\.lotNo\)/.test(mr), null);

  // The cell can now hold a ship name, so the header stops promising a number.
  ok('f9-2: the detail header no longer promises a container NUMBER',
    /Container \/ Vessel/.test(drw) && !/Container #<\/th>/.test(drw), null);

  // 🔴 AND THE MAIN GRID STILL HAS NO CONTAINER COLUMN. He asked for it off on
  // 2026-08-19 and that decision is not reopened by giving the field a source.
  ok('f9-2: the main grid still carries no container column or filter',
    !/id: 'containerNo'/.test(grid) && /CONTAINER # was a column here until 2026-08-19/.test(grid) &&
      /NO CONTAINER FILTER, removed 2026-08-19/.test(cfg), null);
}

// Feedback 9 item 7, 2026-09-21. "Sales Rep : possible de le populer a partir du
// champs suivant? custentity_mgsl_sales_rep ou est-ce qu'on devrait utiliser salesrep".
// Measured across all 1,127 customers: the MGSL field is on 498, `salesrep` on ONE
// (Julie Munger, customer 1913). On the 321 active ARC customers it is 264 and 0. So
// the customer fallback leg read a field that could never fire, and the endpoint
// refused with NO_CUSTOMER_REP about customers whose record plainly names a rep.
{
  const oc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js');

  // Additive, not a swap: customer 1913 must keep resolving off `salesrep`, and no
  // case that works today may stop working.
  //
  // ⚠️ Widened 2026-09-22. The customer's OWN SALES TEAM now leads the chain,
  // which is what Marc-Antoine asked for on the 17th. The two field legs keep
  // their order and their meaning behind it, so this still pins what it was
  // written to pin, plus one rung.
  ok('f9-7: the customer leg reads the sales TEAM first, then the MGSL field, then salesrep',
    // 🔴 Three separate assertions, NOT one multi-line regex. A regex literal
    // cannot contain a real newline, and writing the chain as one pattern put a
    // line break inside the literal and took the whole file down with a
    // SyntaxError. Same trap this repo has hit before.
    /return customerSalesRep\(customerId\)\.repId/.test(oc)
    && /\|\| customerRep\('custentity_mgsl_sales_rep'\)/.test(oc)
    && /\|\| customerRep\('salesrep'\);/.test(oc)
    && oc.indexOf("customerSalesRep(customerId).repId")
       < oc.indexOf("|| customerRep('custentity_mgsl_sales_rep')"), true);
  ok('f9-7:  ...and the team lookup joins employee, so it cannot suggest a rep the write path refuses',
    /FROM customersalesteam cst/.test(oc) && /JOIN employee e ON e\.id = cst\.employee/.test(oc)
    && /e\.issalesrep = 'T'/.test(oc), null);
  ok('f9-7:  ...and it degrades rather than throwing, same contract as the field legs',
    /customer sales TEAM unreadable/.test(oc), null);
  // 🔴 The screen and the write path must run the SAME lookup, or the wizard
  // prefills a rep the endpoint then refuses. That defect has happened here once
  // already with the rep dropdown.
  ok('f9-7:  ...and the screen is served by that same function, not a second copy',
    /customerSalesRep: customerSalesRep,/.test(oc), null);

  // 🔴 WRAPPED. The only caller does not catch, so an unknown-identifier error
  // on a custom field would leave order creation as an exception instead of the
  // refusal the caller is built to report.
  ok('f9-7:  ...inside a try/catch, because the caller does not catch',
    /ARCH Order Create — customer sales rep unreadable/.test(oc), null);

  // The diagnosis function exists only to explain why the resolver found nothing.
  // If the two disagree about where a rep comes from, the refusal names the wrong
  // cause. This is the pair that has to move together.
  ok('f9-7: the diagnosis leg reads the same two columns in the same order',
    /SELECT custentity_mgsl_sales_rep AS mgslrep, salesrep/.test(oc) &&
      /int\(cust\[0\]\.mgslrep\) \|\| int\(cust\[0\]\.salesrep\)/.test(oc), null);

  // Rep and team are different questions. Marc-Antoine, 2026-09-08: the rep is the
  // SO owner, the team is the commission split. They agree on ARC customers today
  // (263 agree, 0 disagree) and must not be collapsed into one lookup.
  ok('f9-7: the rep is still resolved separately from the named team',
    /const repId = namedTeam \? null : resolveSalesRep\(/.test(oc), null);
}

// Feedback 9 item 6, 2026-09-21. "Feed les champs suivants de la sub ARC
// (customers/Sales Rep & Sales Team)". Taken literally the customer picker would go
// from ~786 names to ARC's 321 -- and 30 of the 62 ARCH sales orders in this account
// belong to CWP MTL customers across 9 companies, so a hard filter drops those 9 out
// of the picker while their orders stay on the screen. Same shape as the August scope
// collapse. So ARC sorts FIRST and the rest stays reachable.
{
  const svc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service_arch.js');
  const wiz = src('components/arch/SOWizard.tsx');

  // A SORT, not a filter. Verified live: 786 returned, archCount 321, first 321 all ARC.
  ok('f9-6: ARC sorts first and nothing is removed',
    /const ordered = kept\.filter\(isArch\)\.concat\(kept\.filter\(\(r\) => !isArch\(r\)\)\);/.test(svc) &&
      /customers: ordered\.map/.test(svc), null);

  // 🔴 STABLE. The query already ordered by the displayed label, and re-sorting on
  // companyname would float the records that have none to the top -- the defect the
  // ORDER BY in that query carries its own comment about.
  ok('f9-6:  ...preserving the alphabetical order inside each group',
    /ORDER BY COALESCE\(c\.companyname, c\.entityid\)/.test(svc) &&
      !/ordered\.sort\(/.test(svc), null);

  // The count is for VERIFYING the ordering, not for drawing a divider: this picker
  // is a typeahead and a positional divider stops meaning anything once it filters.
  ok('f9-6:  ...and the non-ARC rows are marked per row, not with a divider',
    /archCount: ordered\.filter\(isArch\)\.length/.test(svc) &&
      /String\(c\.subsidiaryId\) !== String\(ARCH_SUBSIDIARY_ID\)/.test(wiz), null);

  // The IND exclusion predates this and must survive it.
  ok('f9-6: the industrial exclusion is untouched',
    /const isIndustrial = \(r\) =>/.test(svc) &&
      /customer list emptied by the industrial filter/.test(svc), null);
}

// Feedback 9 item 10, 2026-09-21, and he re-sent this line on its own at 10:18 so it
// is the one he most wants moved: non-inventory lines (freight) at SO creation, in
// section 2, which is the Items step.
{
  const oc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js');
  const api = src('lib/archOrderApi.ts');
  const wiz = src('components/arch/SOWizard.tsx');

  // 🔴 A SEPARATE CHANNEL. `resolveLines` must keep refusing a line with no lot:
  // the oversell check, active holds, unattributed commitments and the `claimed`
  // accumulator all key off it, and making them conditional so freight could pass
  // would put the bundle protections one bad request away from being skipped.
  ok('f9-10: the lot path still refuses a line with no lot or location',
    /the lot or location is missing\. Re-pick it from the grid/.test(oc), null);
  ok('f9-10:  ...and charges travel in their own resolver',
    /const resolveCharges = \(rawCharges\) =>/.test(oc) &&
      /const addChargeLine = \(so, charge, index\) =>/.test(oc), null);

  // The allowlist is the only thing standing between a hand-made POST and
  // `Temp Migration AP` on a customer-facing order, so it is enforced server-side.
  ok('f9-10: the allowlist is enforced on the SERVER, not just in the picker',
    /is not a charge item this /.test(oc) &&
      /Object\.prototype\.hasOwnProperty\.call\(allowed, String\(itemId\)\)/.test(oc), null);

  // 🔴 MILLING IS DELIBERATELY ABSENT. The Remanufacturing step already prices
  // planing and cutting at 0.20/BF each and records them on the lot line, with a JE
  // at invoicing. A milling line item would be the same money twice.
  /*
   * RE-POINTED 2026-09-21, not flipped green. This asserted that milling was
   * ABSENT from the allowlist, which was the right call on the evidence we had
   * and which Marc-Antoine then overruled on the call at [10:04]: the $0.20/BF
   * is the internal cost, the milling charge is a separate customer-facing
   * amount, so nothing is billed twice.
   *
   * The invariant did not go away, it got narrower. Only the CUSTOMER-facing
   * item may be sold: 3330 `Milling Charges : Cut` and 3331 `... : Planing`
   * carry the internal cost on the reman POs (5 lines each, all PurchOrd), and
   * putting either on a sales order would mix the two sides of one job. Deleting
   * this guard would have retired that distinction along with the stale half.
   */
  // ⚠️ No word-boundary escape here, on purpose. An earlier edit of this exact
  // line wrote a real 0x08 BACKSPACE byte instead of the escape, because it is a
  // valid escape in the script that generated the file. The regex then demanded a
  // backspace character and could never match, while rendering identically in a
  // terminal, a diff and code review. `id: NNNN,` is unambiguous without it.
  // 🔴 Moved off internal ids 2026-09-22. 3540 is a SANDBOX id; production's
  // Milling Charges is 2976 and production has no Freight Charges item at all, so
  // the id list made the milling feature silently do nothing in prod: no line, no
  // error. The rule is unchanged, only its expression is account-neutral now.
  // ⚠️ Comment-stripped, and not optionally. The source explains this rule in
  // prose directly above the code that implements it, naming the two items that
  // must NOT be offered, so a raw search matches the explanation and reports the
  // rule broken by the very text describing it. Third time in this repo.
  const ocCode = oc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  ok('f9-10: milling is offered, and ONLY the customer-facing item',
    /'Milling Charges',/.test(ocCode) &&
      !/Milling Charges : Cut/.test(ocCode) &&
      !/'Planing'/.test(ocCode), null);
  ok('f9-10:  ...and no charge item is named by a hardcoded internal id any more',
    !/id: 3540,/.test(ocCode) && !/id: 3541,/.test(ocCode) && !/id: 2089,/.test(ocCode), null);
  ok('f9-10:  ...they are resolved against whichever account this is',
    /chargeItemsByName/.test(ocCode) && /ARCH_CHARGE_ITEM_NAMES/.test(ocCode), null);
  ok('f9-10:  ...and the overruled objection is recorded, not deleted',
    /MILLING IS NOW OFFERED/.test(oc) &&
      /10:04/.test(oc), null);

  // Charges last, so the post-save lot matcher never walks past one to reach a lot.
  ok('f9-10: charges are written after every stock line',
    /addChargeLine\(so, charge, firstNewLine \+ resolved\.lines\.length \+ j\)/.test(oc), null);

  // The cap exists because NetSuite crawls on very long orders; charges must count.
  ok('f9-10: charges count toward the line cap',
    /resolved\.lines\.length \+ resolvedCharges\.charges\.length > MAX_LINES/.test(oc), null);

  // Create only. On an append the order already carries its freight and a second
  // line would silently double it. Refused server-side AND hidden in the UI.
  ok('f9-10: charges are refused on an append, not quietly dropped',
    /if \(appending && resolvedCharges\.charges\.length\)/.test(oc) &&
      /Charge lines can only be added when a NEW order is created/.test(oc), null);
  ok('f9-10:  ...and the affordance is hidden in existing-order mode',
    /charges: mode === 'existing' \? undefined : charges/.test(wiz) &&
      /mode !== 'existing' && writeAuth && writeAuth\.chargeItems\.length > 0/.test(wiz), null);

  // Sent as its own array, never merged into `lines`.
  ok('f9-10: the request carries charges separately from the stock lines',
    /charges: draft\.charges && draft\.charges\.length/.test(api), null);

  // `chargeItemList` returns `{ error }` on a read failure, and that object is
  // truthy: spreading it would give the picker an entry with no id that the server
  // would then refuse. An empty list disables the affordance instead.
  ok('f9-10: a failed charge-item read yields an empty list, not a broken option',
    /Array\.isArray\(body\.chargeItems\) \? body\.chargeItems : \[\]/.test(api), null);

  // 🔴 AND THE CHARGE LINES APPEAR ON REVIEW, which is the screen the trader
  // confirms from. Found by putting a real order through the wizard: the Items
  // step offered freight and the request carried it, but Review showed only the
  // wood -- $1,655 approved while the payload was about to write $1,655 plus
  // $250 of freight. Confirming a write means seeing what is written.
  ok('f9-10: the charge lines are shown on the Review step',
    /Freight and other charges/.test(wiz) &&
      /chargesWithMilling\.map\(\(c, i\) => \(/.test(wiz) &&
      /fmtMoney\(c\.quantity \* c\.rate, currency \|\| 'USD', 2\)/.test(wiz), null);
  // Revenue drives margin and must EXCLUDE charges; the saved order's total
  // includes them. Both figures, so Review cannot disagree with the document.
  /*
   * RE-POINTED 2026-09-21. The rule is unchanged -- Review must show the total
   * the saved order will carry, beside a margin that excludes charges -- but the
   * array it sums is now `chargesWithMilling`, because the milling column adds a
   * line the Items step never saw. Summing the old `charges` would have shown a
   * total missing the milling line while the request carried it, which is the
   * exact defect this guard was written for.
   */
  ok('f9-10:  ...with an order total that includes them, beside a margin that does not',
    /'Order total',/.test(wiz) &&
      // [\s\S] because the expression wraps across two lines in the source, and a
      // regex literal cannot contain a real newline.
      /totals\.revenue[\s\S]{0,40}chargesWithMilling\.reduce\(\(sum, c\) => sum \+ c\.quantity \* c\.rate, 0\)/.test(wiz), null);
  // Only when there are charges, so an order without freight keeps the six
  // figures this strip has always had.
  ok('f9-10:  ...and only when the order actually carries a charge',
    /\.\.\.\(chargesWithMilling\.length > 0/.test(wiz), null);

}

// 🔴 THE SCOPE UNION MUST REACH EVERY MODULE, 2026-09-21. Feedback 7 moved the
// cache builder to (department = 'Hardwood' OR subsidiary = 'ARC') because the
// client's inventory arrived in ARC carrying department "Trading". TWO OTHER
// MODULES NEVER GOT IT, and both failures were invisible:
//
//   archOrderCreate  refused every ARC lot at CREATION -- 1,048 of 1,099 on hand --
//                    with "X is not an ARCH hardwood item". Its comment claimed
//                    "Same scope as the cache MR uses for display", which had
//                    silently stopped being true. Proven by externalid: 33 ARC
//                    orders exist, all hand-made in the UI, NOT ONE carrying the
//                    `ARCH-` key this endpoint stamps.
//   the service      returned an EMPTY Open Sales Orders tab, reporting "0 items in
//                    the Hardwood department" while the grid showed 132 rows.
//
// Measured: the union sees 168 items, department-only sees 25.
{
  const oc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js');
  const svc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service_arch.js');
  const mr = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js');

  // ONE predicate in the order endpoint, so a future divergence is a code change
  // rather than a silent drift.
  // 🔴 Feedback 14, 2026-09-22: subsidiary ARC ALONE. The department arm added only
  // CWP MTL items at CWP MTL locations (Bluelinx, Buffalo, Ambassador, CWP Prevost,
  // USL), which MA reported as « des reloads qui ne sont pas dans CWP ARC ».
  ok('scope: the order endpoint tests subsidiary ARC alone, in one place',
    /const inArchScope = \(department, subsidiary, itemCode\) =>/.test(oc) &&
      /return sub === ARCH_SUBSIDIARY_NAME;/.test(oc) &&
      !/dept === HARDWOOD_DEPARTMENT \|\|/.test(oc), null);
  // 🔴 AND DECKING IS EXCLUDED FROM BOTH ARMS. Hanging the exclusion off the
  // department arm would make IPE orderable the moment it sits in ARC.
  ok('scope:  ...with decking excluded regardless of which arm matched',
    /if \(NON_ARCH_DEPARTMENT_ITEMS\.indexOf\(code\) !== -1\) return false;/.test(oc), null);
  // Selecting the column is not enough: it has to reach the lot state, or the
  // predicate reads undefined and every ARC lot is refused exactly as before.
  ok('scope:  ...and the subsidiary is both SELECTED and mapped into the lot state',
    /BUILTIN\.DF\(i\.subsidiary\) AS subsidiary/.test(oc) &&
      /subsidiary: String\(r\.subsidiary \|\| ''\)/.test(oc), null);
  // The creation gate and the Ready-to-Build scope read the same predicate.
  ok('scope:  ...used by the creation gate AND the order-scope count',
    /if \(!inArchScope\(st\.department, st\.subsidiary, st\.itemCode\)\)/.test(oc) &&
      /if \(inArchScope\(dept, rows\[i\]\.sub, code\)\)/.test(oc), null);

  // The service's open-orders and item-count queries share one filter.
  ok('scope: the service filter is subsidiary ARC alone and binds exactly one param',
    /sql: 'BUILTIN\.DF\(i\.subsidiary\) = \?',\s*params: \[ARCH_SUBSIDIARY_NAME\],/.test(svc) &&
      !/i\.department = \?/.test(svc) && !/params: \[dept\.param\]/.test(svc), null);
  // BUILTIN.DF, never the raw column: `i.subsidiary` is NOT_EXPOSED on this tenant
  // and a bare comparison is a hard 400.
  ok('scope:  ...through BUILTIN.DF, because the raw column is a 400',
    !/[^.]i\.subsidiary = /.test(svc), null);

  // And the cache builder, which had it first, still has it.
  ok('scope: the cache builder is subsidiary ARC alone, bound with one param',
    /const ARCH_SCOPE_SQL = 'BUILTIN\.DF\(i\.subsidiary\) = \?';/.test(mr) &&
      /const ARCH_SCOPE_PARAMS = \[ARCH_SUBSIDIARY\];/.test(mr), null);
  // 🔴 THE TRAP IN NARROWING IT. UNTAGGED_SQL has TWO placeholders of its own and
  // used to borrow ARCH_SCOPE_PARAMS; one param would under-bind it, and its catch
  // swallows the failure, so the miscategorisation warning would die silently.
  {
    const at = mr.indexOf('const UNTAGGED_SQL =');
    const q = mr.slice(at, mr.indexOf('/**', at));
    ok('scope:  ...and UNTAGGED_SQL binds its OWN department+subsidiary pair, not the scope params',
      /params: EXCLUDED_UNITS_TYPES\.concat\(UNTAGGED_PARAMS\)/.test(mr) &&
        /const UNTAGGED_PARAMS = \[HARDWOOD_DEPARTMENT, ARCH_SUBSIDIARY\];/.test(mr) &&
        !/EXCLUDED_UNITS_TYPES\.concat\(ARCH_SCOPE_PARAMS\)/.test(mr) &&
        /BUILTIN\.DF\(i\.department\) <> \?/.test(q) && /BUILTIN\.DF\(i\.subsidiary\), '~none~'\) <> \?/.test(q),
      q.slice(0, 200));
  }
  // All three sites agree, so a fourth divergence is caught here.
  ok('scope:  ...and all three sites use the same subsidiary name',
    /const ARCH_SUBSIDIARY = 'ARC';/.test(mr) &&
      /const ARCH_SUBSIDIARY_NAME = 'ARC';/.test(svc) && /const ARCH_SUBSIDIARY_NAME = 'ARC';/.test(oc), null);
}

// Money audit, 2026-09-16. The order was created in the customer's PRIMARY currency
// while the screen priced, converted and quoted in whatever the trader clicked. 47
// active non-industrial customers carry more than one currency; on a CAD pick
// against a USD-primary customer the invoice lands 39% over the quote.
{
  const api = src('lib/archOrderApi.ts');
  const wiz = src('components/arch/SOWizard.tsx');
  const svc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service_arch.js');
  const oc  = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js');
  ok('money: the request carries the currency the trader priced in',
    /currencyId: draft\.header\.currencyId \|\| undefined,/.test(api), null);
  ok("money:  ...resolved from the customer's own sublist, positionally",
    /const currencyIdFor = /.test(wiz) && /currencyId: currencyIdFor\(currency\),/.test(wiz), null);
  ok('money:  ...which the service sends in the same ORDER BY as the codes',
    /AS currencyids/.test(svc) && /currencyIds:   r\.currencyids/.test(svc), null);
  // Falling back to the customer default is the behaviour that caused this.
  ok('money:  ...and an unresolvable currency is refused, never defaulted',
    /does not resolve to a /.test(oc) && /SELECT id FROM currency WHERE UPPER\(symbol\) = \?/.test(oc), null);
}

// The currency read-back, 2026-09-16. The order is now created in the currency the
// trader priced in; this proves it afterwards rather than trusting it. The one thing
// worse than a mismatch is a silent one.
{
  const oc = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js');
  const api = src('lib/archOrderApi.ts');
  const dlg = src('components/arch/ArchOrderDraftDialog.tsx');
  /*
   * 🔴 SCOPE. The first version read `h.currency` at the result assembly, where `h`
   * is not in scope: it belongs to the create and append branches. It threw
   * `h is not defined` AFTER SO-CWP-001376 had already been saved, so the trader was
   * told the order failed when it existed. A post-save block must not reference
   * anything the branches above it own.
   */
  ok('readback: the header is read from a name that is in scope after the save',
    /const reqHeader = \(input && input\.header\) \|\| \{\};/.test(oc) &&
      !/String\(h\.currency \|\| ''\)/.test(oc), null);
  ok('readback: the saved currency is read back after the save',
    /cur\.symbol AS currencycode/.test(oc) && /currencyCode: saved\.currencyCode/.test(oc) === false, null);
  ok('readback:  ...by ISO code, never the display name',
    /cur\.symbol AS currencycode/.test(oc) && !/BUILTIN\.DF\(t\.currency\)/.test(oc), null);
  ok('readback:  ...compared to what the screen priced in, and logged as an error',
    /currencyMismatch = \{ expected: wanted, actual: saved\.currencyCode \}/.test(oc) &&
      /ARCH Order . currency mismatch/.test(oc), null);
  ok('readback:  ...and carried on the response',
    /currencyMismatch: currencyMismatch,/.test(oc) &&
      /currencyMismatch\?: \{ expected: string; actual: string \} \| null;/.test(api), null);
  // It must not share a panel with the not-locked warning: this one is money.
  ok('readback:  ...and the confirmation says so before anything else',
    /if \(result\.currencyMismatch\) \{/.test(dlg) &&
      /but it was priced in/.test(dlg), null);
}

// Feedback 6 item 7b. "Ajouter le champ customer notes (memo). Parfois les users
// veulent inscrire une note pour leur client sur la commande." It writes the order's
// NATIVE memo, because that is where the note already goes when a trader types one by
// hand: SO-CWP-001369 and -001370 both read "thank you for your business", written by
// Marc-Antoine on 2026-09-11, and 73 of 1,270 ARCH orders carry one.
{
  const wiz = src('components/arch/SOWizard.tsx');
  const api = src('lib/archOrderApi.ts');
  const dlg = src('components/arch/ArchOrderDraftDialog.tsx');
  const oc  = srcAbs('src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js');
  ok('7b: the note reaches the order as its native memo',
    /so\.setValue\(\{ fieldId: 'memo', value: note \}\);/.test(oc) &&
      /customerNote: draft\.header\.customerNote \|\| undefined,/.test(api), null);
  // NetSuite truncates past 999 without a word, which is a bad way to find out.
  ok('7b:  ...capped on both sides rather than discovered at save',
    /const MEMO_MAX = 999;/.test(wiz) && /slice\(0, 999\)/.test(oc), null);
  // An append writes no header field at all, so an editable box would drop the note.
  ok('7b:  ...and an append says the note belongs to the order, not the box',
    /A note lives on the order header/.test(wiz), null);
  // An empty row reads as a note that failed rather than one never written.
  ok('7b:  ...shown on Review and the confirmation only when there is one',
    /\['Note', customerNote\.trim\(\)\]/.test(wiz) &&
      /\['Note on the order', draft\.header\.customerNote\]/.test(dlg), null);
  // Read back off the saved order, like every other fact in that email.
  ok('7b:  ...and the confirmation email prints what the order carries',
    /t\.memo                             AS memo/.test(oc) &&
      /\['Note', summary \? summary\.memo : null\]/.test(oc), null);
}

// Feedback 12, 2026-09-22. MA: « Ajuster la query des Open SOs svp », on a
// screenshot of the empty-state banner claiming "0 items in the Hardwood
// department" and advising him to tag hardwood items. The query was already fixed
// (ef3f98f); the banner still named the old scope and a remedy that fixes nothing.
{
  const view = src('components/arch/ArchOpenOrdersView.tsx');
  ok('open orders banner: names subsidiary ARC as the scope',
    /carries an item in subsidiary ARC\./.test(view) && /in subsidiary ARC, so orders on items/.test(view), null);
  ok('open orders banner: no longer names the Hardwood department as the scope',
    !/carries a Hardwood-department item/.test(view) && !/in the Hardwood department, so orders/.test(view), null);
  ok('open orders banner: and the tagging advice is gone from every leg',
    !/Tagging the remaining hardwood items/i.test(view) && !/tagging the remaining hardwood items/.test(view), null);
}

console.log(fail ? ('# FAIL ' + fail) : '# archUiGuards ok');
process.exit(fail ? 1 : 0);
