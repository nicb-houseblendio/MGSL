// Source-level guards for honesty in the ARCH components. node cannot load a .tsx
// (ERR_UNKNOWN_FILE_EXTENSION under --experimental-strip-types), so these read the
// component source and pin the pairs that must move together. Each one is here
// because the screen once showed generated data with nothing saying so.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
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
  ok('grid: READY TO BUILD carries a not-sourced note',
    /key: 'readyToBuild'[\s\S]{0,400}?note: 'Not sourced yet/.test(t));
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
  ok('cache MR: readyToBuild is still an unsourced literal 0, matching archBuckets',
    /readyToBuild: 0,/.test(mr));

  /* ── Marc-Antoine, ROOT CAUSE, server side ────────────────────────────────
   * `available` subtracted `outbound` from an `onHand` figure that was already
   * net of the fulfilment, so every shipment took the same wood off twice and
   * the deduction never expired — nothing closes a shipped-and-billed line.
   * 1,166 BF across the 13 live rows on 2026-09-08. With it gone all 13
   * reconcile; 4 did not before. */
  ok('cache MR: available no longer subtracts outbound',
    /available:\s*Math\.max\(0, onHand \+ onOrder \+ inTransit\s*\n\s*- reserve - 0 \/\*readyToBuild\*\/\s*\n\s*- held\)/.test(mr));
  ok('cache MR: and the removal is documented, not silent',
    /`outbound` IS NOT SUBTRACTED/.test(mr));
  ok('grid: the Outbound header does not claim a second deduction',
    /NOT deducted from Available a second time/.test(t));
  ok('contract: types\\/arch.ts states the corrected formula',
    /onHand \+ onOrder \+ inTransit − reserve − readyToBuild − held/.test(src('types/arch.ts')));
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
  /* Updated 2026-09-09 when the panel became a PICKER over the 44 real teams.
     The guard's point is unchanged - Review must restate the split before the
     order is committed - but a picked team now outranks both older sources,
     because it is the only one of the three this order actually sends. */
  ok('wizard: Review restates the split, which 11d1007 also removed',
    /'Sales team',\s*pickedTeam\s*\?\s*pickedTeam\.name \+ ' \(' \+ teamSplitLabel\(pickedTeam\) \+ '\)'/.test(w) &&
    /: orderSplit\s*\?\s*orderSplit\.headline\s*: NEW_ORDER_SPLIT_HEADLINE/.test(w));
  /* And the id it sends can only be one the live list holds. A team picked before
     a reload that no longer offers it must not post an entitygroup id. */
  ok('wizard: the team id is sent only when the live list still holds it, and only on a NEW order',
    /salesTeamId: mode === 'new' \? sendableTeamId\(liveTeams, salesTeamId\) : undefined,/.test(w));
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

console.log(fail ? ('# FAIL ' + fail) : '# archUiGuards ok');
process.exit(fail ? 1 : 0);
