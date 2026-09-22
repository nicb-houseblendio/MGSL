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

test('the split queue reads the native ship date, and a defaulted one (== order date) is no date', () => {
  assert.match(splitQueue, /TO_CHAR\(t\.shipdate, 'YYYY-MM-DD'\)\s+AS shipdate/);
  assert.match(splitQueue, /shipDate:\s+\(r\.shipdate && r\.shipdate !== r\.trandate\) \? r\.shipdate : '',/);
  // the trandate fallback made "nobody entered a date" read as "13d late"
  assert.doesNotMatch(splitQueue, /r\.shipdate \|\| r\.trandate/);
});

// Feedback 14 round-1 review: the split queue was the unscoped fourth ARCH site.
// 32 of the 38 split-flagged lines in sandbox are CWP MTL items.
test('the split queue is scoped to subsidiary ARC, like the other three sites', () => {
  assert.match(splitQueue, /"  AND BUILTIN\.DF\(i\.subsidiary\) = 'ARC' " \+/);
  assert.ok(splitQueue.indexOf("BUILTIN.DF(i.subsidiary) = 'ARC'") < splitQueue.indexOf("'ORDER BY t.tranid, tl.linesequencenumber'"));
});
