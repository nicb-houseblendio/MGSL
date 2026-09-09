// Source-level guards for the Open Sales Orders tab, same technique as
// archUiGuards.test.mjs: node cannot load a .tsx (ERR_UNKNOWN_FILE_EXTENSION under
// --experimental-strip-types) and there is no jsdom in this project, so these read
// the component source and pin the pairs that must move together.
//
// Both fixes here came from Marc-Antoine on 2026-09-08:
//   "Est-ce que lorsqu'on clique sur le numéro du SO ça nous redirige vers le form
//    dans Netsuite?"                                        -> it did not. Now it does.
//   "Ils affichent tous a unassigned, mais devrait être la personne qui a créé le
//    SO."                                                   -> creator AND rep, labelled.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(here, '..', rel), 'utf8');

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

const v = src('components/arch/ArchOpenOrdersView.tsx');
const h = src('hooks/useArchOpenOrders.ts');

/* ── 1. Clicking the SO number opens the record ────────────────────────────────
 *
 * It was a <button> whose only job was toggling the row, and the comment above it
 * said a NetSuite record "cannot" be opened because the tab had only fixtures.
 * That stopped being true when the live endpoint landed with real internal ids. */
ok('link: the SO number is an anchor, not only a toggle button',
  /<a\s[\s\S]{0,400}?href=\{soUrl\}/.test(v), false);
ok('link: it opens in a new tab and cannot reach back into this page',
  /target="_blank"/.test(v) && /rel="noopener noreferrer"/.test(v), false);
ok('link: the href comes from the tested URL builder',
  /import \{ salesOrderUrl \} from '@\/lib\/nsRecordUrl'/.test(v) &&
  /salesOrderUrl\(o\.internalId, accountId\)/.test(v), false);
// The host transform is the one thing that can silently be wrong (9448239_SB1 ->
// 9448239-sb1). It lives in a module with a test; a second inline copy here could
// drift from it, and would not be covered by anything.
ok('link: no NetSuite host is assembled inside the component',
  !/app\.netsuite\.com/.test(v) && !/salesord\.nl/.test(v), false);
ok('link: the stale "it cannot open a NetSuite record" comment is gone',
  !/It cannot open a NetSuite record/i.test(v), false);
// A fixture order has internalId null, so salesOrderUrl returns '' and the button
// stays. Offering a link there would send the trader to a NetSuite 404.
ok('link: a row with no url keeps the toggle button rather than a dead link',
  /\{soUrl \? \(/.test(v) && /\) : \(\s*<button/.test(v), false);

// EXPANDING MUST STILL BE REACHABLE, since the number no longer does it.
ok('expand: the caret button per row survives', /aria-expanded=\{isOpen\}/.test(v), false);
ok('expand: Expand all / Collapse all survives', /allExpanded \? 'Collapse all' : 'Expand all'/.test(v), false);

/* ── 2. Both people, labelled, neither substituted ────────────────────────────*/
ok('people: there is a Sales rep column', />\s*Sales rep\s*</.test(v), false);
ok('people: there is a Created by column', />\s*Created by\s*</.test(v), false);
ok('people: the rep is NOT removed', /const repOf = /.test(v) && /repOf\(o\)/.test(v), false);
ok('people: the band names WHICH person it is banding by',
  /\{AXES\[groupBy\]\.band\}/.test(v), false);
ok('people: and so does the subtotal row', /Subtotal · \{AXES\[groupBy\]\.band\} · \{groupName\}/.test(v), false);
// The client asked for the creator, and the creator is also the field that cannot
// silently go unread (see 3). So that is the default, with the rep one click away.
ok('people: the default grouping is the creator, which is what was asked for',
  /axisOverride !== null \? axisOverride : anyCreator \? 'creator' : 'rep'/.test(v), false);
// Fixture orders carry no createdBy, so a hard "creator" default would band every
// demo order under one "Unknown" and lose the trader bands demo mode is for.
ok('people: with no creators to group by it falls back to the rep rather than one Unknown band',
  /const anyCreator = /.test(v) && /\(o\.createdBy \|\| ''\)\.trim\(\) !== ''/.test(v), false);
ok('people: the grouping is switchable rather than baked in',
  /Group by: Created by/.test(v) && /Group by: Sales rep/.test(v), false);
// `createdBy` is '' when the role cannot read it, and grouping on '' yields a
// nameless band and a blank-looking filter option.
ok('people: createdBy is never rendered raw, so a blank never prints as nothing',
  !/\{o\.createdBy\}/.test(v) && /CREATOR_UNKNOWN/.test(v), false);
ok('people: and neither is trader', !/\{o\.trader\}/.test(v), false);
ok('people: the filter follows the grouping axis instead of a second, conflicting one',
  /groupValue\(o, groupBy\) === groupFilter/.test(v), false);
// Keyed on the RESOLVED axis, so it covers the fallback flipping when data
// arrives as well as the user changing the control.
ok('people: a change of axis clears the filter, which would otherwise empty the table',
  /React\.useEffect\(\(\) => setGroupFilter\(''\), \[groupBy\]\)/.test(v), false);

/* ── 3. "Unassigned everywhere" can no longer be silent ───────────────────────*/
ok('honesty: the tab renders the attribution notice',
  /traderAttributionNotice\(\{/.test(v) && /attNotice\.lines\.join\(' '\)/.test(v), false);
ok('honesty: at two severities, so a partial gap is not shouted at',
  /attNotice\.level === 'error'/.test(v), false);
ok('honesty: the hook exposes the attribution', /traderAttribution: ArchTraderAttribution \| null/.test(h), false);
ok('honesty: and derives it when the deployed service does not send one',
  /deriveTraderAttribution/.test(h), false);
ok('honesty: fixtures carry no attribution, so no notice can claim a live problem',
  /setSource\('fixtures'\);\s*\n\s*setTraderAttribution\(null\);/.test(h), false);

/* ── 4. TWELVE columns, and every row still on the same grid ──────────────────
 *
 * The whole point of the single <colgroup> is that STATUS lands at the same x in
 * every group. Adding two columns is exactly the change that silently breaks it:
 * one forgotten <td> shifts every figure in one row type by a column and the
 * table still renders. */
const between = (a, b) => {
  const i = v.indexOf(a);
  const j = v.indexOf(b);
  return i === -1 || j === -1 || j < i ? '' : v.slice(i, j);
};
const count = (s, re) => (s.match(re) || []).length;
const cols = count((v.match(/<colgroup>[\s\S]*?<\/colgroup>/) || [''])[0], /<col\b/g);
const ths = count((v.match(/<thead>[\s\S]*?<\/thead>/) || [''])[0], /<th\b/g);
const orderTds = count(between("background: isOpen ? '#F2F6FD'", '{/* Line items reuse'), /<td\b/g);
const lineTds = count(between('<tr key={l.key}', '{li === o.lines.length - 1 && null}'), /<td\b/g);
ok('grid: twelve columns are declared', cols === 12, cols);
ok('grid: twelve header cells', ths === 12, ths);
ok('grid: an order row fills all twelve', orderTds === 12, orderTds);
ok('grid: a line-item row fills all twelve', lineTds === 12, lineTds);
// The subtotal row is 1 + colSpan(7) + 4 = 12, and the two full-width rows span 12.
const spans = (v.match(/colSpan=\{(\d+)\}/g) || []).map((s) => Number(s.replace(/\D/g, '')));
ok('grid: the band and empty-state rows span all twelve',
  spans.filter((n) => n === 12).length === 2, spans);
ok('grid: the subtotal label spans seven, so its four figures land under their columns',
  spans.includes(7) && !spans.includes(5), spans);
ok('grid: no colSpan from the ten-column layout survives',
  !spans.includes(10), spans);

console.log(fail ? ('# FAIL ' + fail) : '# archOpenOrdersView ok');
process.exit(fail ? 1 : 0);
