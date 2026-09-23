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
// Feedback 14 follow-up (2026-09-23): decking in ARC is ARCH, so the decking
// tripwires went with the exclusion they policed. The shared-subsidiary one stays.
test('MR tripwires: ARC-location stock on an out-of-scope item stays; the decking ones are gone', () => {
  const mr = readFileSync(join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js'), 'utf8');
  assert.match(mr, /'WHERE BUILTIN\.DF\(loc\.subsidiary\) = \? ' \+/);
  assert.doesNotMatch(mr, /BUILTIN\.DF\(i\.subsidiary\) LIKE \?/);
  assert.match(mr, /Shared-subsidiary check failed \(non-fatal\)/);
  assert.doesNotMatch(mr, /Decking-category check failed|DECKING_LEAK_SQL|NON_ARCH_ITEMS_SQL/);
});

test('decking is IN the ARCH scope at all three sites (Feedback 14 follow-up)', () => {
  const root = join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen');
  const mr = readFileSync(join(root, 'entry_points/mr/mcgi_mr_trader_screen_cache_arch.js'), 'utf8');
  const svc = readFileSync(join(root, 'service/trader_screen_service_arch.js'), 'utf8');
  const oc = readFileSync(join(root, 'shared/archOrderCreate.js'), 'utf8');
  for (const [n, s] of [['mr', mr], ['service', svc], ['orderCreate', oc]]) {
    assert.doesNotMatch(s, /NON_ARCH_DEPARTMENT_ITEMS\.|NON_ARCH_ITEMS_SQL|'IPE44DECKD'/, n);
  }
  // the endpoint's scope predicate is the subsidiary alone
  const at = oc.indexOf('const inArchScope');
  const pred = oc.slice(at, oc.indexOf('};', at));
  assert.match(pred, /return sub === ARCH_SUBSIDIARY_NAME;/);
  assert.doesNotMatch(pred, /indexOf\(code\)/);
});
