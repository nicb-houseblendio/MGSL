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
  ok('cache MR: a lot assignment is scaled by the line-level open share',
    /reserve \+= assigned \* openShare/.test(mr) && /onOrder \+= assigned \* openShare/.test(mr));
  ok('cache MR: the unconditional whole-assignment reserve is gone',
    !/\.reserve \+= assigned;/.test(mr));
  // Updated 2026-09-10: readyToBuild moved from a hardcoded literal 0 to an
  // isolated, separately try/caught query over `custbody_arch_ready_to_build`
  // — see `loadBuckets`. Pin the shape that keeps it safe to deploy before the
  // field exists (never joined into BUCKET_SQL, which the other five buckets
  // depend on) rather than the old hardcoded absence.
  ok('cache MR: readyToBuild is read from its own isolated, try/caught query',
    /custbody_arch_ready_to_build = 'T'/.test(mr) && /readyToBuildSourced = false/.test(mr));
  ok('cache MR: that query is never joined into BUCKET_SQL itself',
    !(mr.match(/const BUCKET_SQL =[\s\S]*?;/) || [''])[0].includes('custbody_arch_ready_to_build'));
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
  ok('cache MR: available no longer subtracts outbound',
    /available:\s*Math\.max\(0, onHand \+ onOrder \+ inTransit\s*\n\s*- reserve - readyToBuild\s*\n\s*- held\)/.test(mr));
  ok('cache MR: and the removal is documented, not silent',
    /`outbound` IS NOT SUBTRACTED/.test(mr));
  ok('grid: the Outbound header does not claim a second deduction',
    /NOT deducted from Available a second time/.test(t));
  ok('contract: types\\/arch.ts states the corrected formula',
    /onHand \+ onOrder \+ inTransit − reserve − readyToBuild − held/.test(src('types/arch.ts')));

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
  ok('cache MR: bucketsMeta takes the flag as an ARGUMENT, so summarize cannot read the module copy',
    /const bucketsMeta = \(sourced\) => \(\{/.test(mrArch) && !/bucketsMeta\(\)/.test(mrArch));
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
    /confirm it is not hardwood/.test(flat), null);

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
  ok('  ...testing the department BY NAME, never the internal id',
    /dept === HARDWOOD_DEPARTMENT/.test(s) && !/department === 11/.test(s), null);
  ok('  ...and honouring the same decking exclusions as the line check',
    /NON_ARCH_DEPARTMENT_ITEMS\.indexOf\(code\) === -1/.test(s), null);

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

console.log(fail ? ('# FAIL ' + fail) : '# archUiGuards ok');
process.exit(fail ? 1 : 0);
