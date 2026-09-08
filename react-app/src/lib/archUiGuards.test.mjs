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

// Sales rep, not sales team, and no fabricated commission split. The prototype drew
// percentage bars per team member on the Customer step and repeated them on Review;
// no NetSuite field feeds either, and the header maps to ONE employee (H_SALES_REP).
{
  const w = src('components/arch/SOWizard.tsx');
  const d = src('components/arch/ArchOrderDraftDialog.tsx');
  const f = src('lib/archOrderFixtures.ts');
  ok('fixtures: no SALES_TEAMS map and no percentages', !/SALES_TEAMS/.test(f) && !/pct/.test(f));
  ok('fixtures: SALES_TEAM_NAMES still exported for the offline dropdown', /export const SALES_TEAM_NAMES\s*=\s*\[/.test(f));
  ok('wizard: no commission panel', !/Commission split/.test(w) && !/SALES_TEAMS\[/.test(w));
  ok('wizard: field is labelled Sales rep', /Sales rep \*/.test(w) && !/Sales team/.test(w));
  ok('wizard: offline dropdown still lists the placeholder names', /SALES_TEAM_NAMES\.map\(/.test(w));
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
  ok('orders view: Edit is hidden on fixture orders (no internalId)', /editable = o\.status !== 'Ready to Build' && !!o\.internalId/.test(v));
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

console.log(fail ? ('# FAIL ' + fail) : '# archUiGuards ok');
process.exit(fail ? 1 : 0);
