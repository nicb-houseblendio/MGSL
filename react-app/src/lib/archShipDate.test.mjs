/**
 * The ARCH order wizard's Ship date was written to `custbody_mgsl_expectedshipdate`,
 * a column SuiteQL will SELECT but which is not on the sales-order record, so
 * `setIfPresent` skipped it and the date was dropped on every order: 21 audits
 * from script 6505 up to 2026-09-21. The split queue read the same dead column, so
 * every warehouse job's "Ships in N d" counted from the transaction date.
 * Found 2026-09-22 while checking Feedback 13's Ship Week column.
 *
 * Pinned at source level because both failures were silent by design.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SHARED = join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared');
const orderCreate = readFileSync(join(SHARED, 'archOrderCreate.js'), 'utf8');
const splitQueue = readFileSync(join(SHARED, 'archSplitQueue.js'), 'utf8');

/** Source with comments removed, so a scar comment naming the dead field is allowed. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('the wizard ship date is written to the native shipdate field', () => {
  assert.match(orderCreate, /const H_SHIP_DATE\s*=\s*'shipdate';/);
});

test('both write paths (create and append) still go through H_SHIP_DATE', () => {
  const uses = orderCreate.match(/setIfPresent\(so, H_SHIP_DATE, d,/g) || [];
  assert.equal(uses.length, 2);
});

test('no executable code reads or writes custbody_mgsl_expectedshipdate any more', () => {
  assert.doesNotMatch(code(orderCreate), /custbody_mgsl_expectedshipdate/);
  assert.doesNotMatch(code(splitQueue), /custbody_mgsl_expectedshipdate/);
});

test('the split queue resolves the ship week through the shared rule (Feedback 13)', () => {
  assert.match(splitQueue, /TO_CHAR\(t\.shipdate, 'YYYY-MM-DD'\)\s+AS shipdate/);
  assert.match(splitQueue, /ArchShipWeek\.readShipWeeks\(query, log, rows\.map\(\(r\) => r\.soid\)\)/);
  assert.match(splitQueue, /ArchShipWeek\.forOrder\(shipRead, r\.soid,\s*\{ shipDate: r\.shipdate, tranDate: r\.trandate \}\)/);
  // the trandate fallback made "nobody entered a date" read as "13d late"
  assert.doesNotMatch(splitQueue, /r\.shipdate \|\| r\.trandate/);
});

// Feedback 14 round-1 review: the split queue was the unscoped fourth ARCH site.
// 32 of the 38 split-flagged lines in sandbox are CWP MTL items.
test('the split queue is scoped to subsidiary ARC, like the other three sites', () => {
  assert.match(splitQueue, /"  AND BUILTIN\.DF\(i\.subsidiary\) = 'ARC' " \+/);
  assert.ok(splitQueue.indexOf("BUILTIN.DF(i.subsidiary) = 'ARC'") < splitQueue.indexOf("'ORDER BY t.tranid, tl.linesequencenumber'"));
});

// Feedback 14 round-2 review: the two MR tripwires that could not fire.
test('MR tripwires: decking by CATEGORY, and ARC-location stock on an out-of-scope item', () => {
  const mr = readFileSync(join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js'), 'utf8');
  assert.match(mr, /AND BUILTIN\.DF\(i\.csegitem_category\) = \?',\s*\n\s*params: ARCH_SCOPE_PARAMS\.concat\(\['Decking'\]\)/);
  assert.match(mr, /'WHERE BUILTIN\.DF\(loc\.subsidiary\) = \? ' \+/);
  // the name-LIKE version is gone: it could never see an include-children item
  assert.doesNotMatch(mr, /BUILTIN\.DF\(i\.subsidiary\) LIKE \?/);
  // each has its own try, so neither can take down a rebuild
  assert.match(mr, /Decking-category check failed \(non-fatal\)/);
  assert.match(mr, /Shared-subsidiary check failed \(non-fatal\)/);
});
