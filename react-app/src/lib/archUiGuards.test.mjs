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

console.log(fail ? ('# FAIL ' + fail) : '# archUiGuards ok');
process.exit(fail ? 1 : 0);
