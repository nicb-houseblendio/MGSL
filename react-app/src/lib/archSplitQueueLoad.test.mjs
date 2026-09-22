/**
 * Feedback 11, 2026-09-22. The warehouse split screen served INVENTED orders
 * (Heritage Cabinetry, Atlas Millwork) under "NetSuite unreachable" when the
 * endpoint had in fact refused the signed-in role. These guards pin the rule:
 * fixtures only when there is no endpoint at all; any live failure is an error
 * with no jobs and a message that says who must act.
 *
 * The hook is also checked at source level, because the decision function is
 * worthless if the hook stops calling it or reintroduces a fixture fallback.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decideSplitQueueLoad, isJsonContentType } from './archSplitQueueLoad.ts';

const here = dirname(fileURLToPath(import.meta.url));
const hook = readFileSync(join(here, '../hooks/useArchSplitQueue.ts'), 'utf8');
const screen = readFileSync(join(here, '../components/warehouse/WarehouseSplitScreen.tsx'), 'utf8');
const suitelet = readFileSync(join(here,
  '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/sl/mcgi_sl_arch_split_execute.js'), 'utf8');
const sdf = readFileSync(join(here,
  '../../../src/Objects/scripts/sl/customscript_mcgi_sl_arch_split_execute.xml'), 'utf8');

test('no endpoint: local preview, fixtures, no message', () => {
  assert.deepEqual(decideSplitQueueLoad({ hasEndpoint: false }), { source: 'fixtures', failure: null, message: null });
});

test('the exact refusal MA got: FORBIDDEN is an error naming the role and where to add it', () => {
  const d = decideSplitQueueLoad({
    hasEndpoint: true, contentType: 'application/json',
    body: { ok: false, code: 'FORBIDDEN', error: 'x', role: 2183 },
  });
  assert.equal(d.source, 'error');
  assert.equal(d.failure, 'forbidden');
  assert.match(d.message, /role id 2183/);
  assert.match(d.message, /Permitted Split Roles/);
  assert.doesNotMatch(d.message, /unreachable/i);
});

test('FORBIDDEN from an older server with no role id still reads cleanly', () => {
  const d = decideSplitQueueLoad({ hasEndpoint: true, body: { ok: false, code: 'FORBIDDEN' } });
  assert.equal(d.failure, 'forbidden');
  assert.match(d.message, /^Your role is not permitted/);
});

test('an HTML page (audience block or expired session) is not_json, not a network error', () => {
  const d = decideSplitQueueLoad({ hasEndpoint: true, contentType: 'text/html', body: null });
  assert.equal(d.source, 'error');
  assert.equal(d.failure, 'not_json');
  assert.match(d.message, /audience/);
});

test('a server failure passes its own message through', () => {
  const d = decideSplitQueueLoad({ hasEndpoint: true, body: { ok: false, code: 'QUEUE_FAILED', error: 'Could not load the split queue: boom' } });
  assert.deepEqual(d, { source: 'error', failure: 'server', message: 'Could not load the split queue: boom' });
});

test('a network rejection is an error, never fixtures', () => {
  const d = decideSplitQueueLoad({ hasEndpoint: true, networkError: 'Failed to fetch' });
  assert.equal(d.source, 'error');
  assert.equal(d.failure, 'network');
});

test('ok:true is live', () => {
  assert.equal(decideSplitQueueLoad({ hasEndpoint: true, body: { ok: true } }).source, 'netsuite');
});

test('content-type detection', () => {
  assert.equal(isJsonContentType('application/json;charset=utf-8'), true);
  assert.equal(isJsonContentType('text/html; charset=UTF-8'), false);
  assert.equal(isJsonContentType(null), false);
});

test('hook: fixtures are reachable ONLY from the no-endpoint branch', () => {
  const uses = hook.match(/getSplitJobs\(\)/g) || [];
  assert.equal(uses.length, 1, 'getSplitJobs() must be called exactly once');
  const noUrl = hook.indexOf('if (!url) {');
  const call = hook.indexOf('setJobs(getSplitJobs())');
  const fetchAt = hook.indexOf('fetch(`${url}');
  assert.ok(noUrl > -1 && call > noUrl && call < fetchAt, 'the fixture call must sit inside the !url branch, before the fetch');
  assert.match(hook, /decideSplitQueueLoad\(/);
  assert.match(hook, /setJobs\(\[\]\);\s*\n\s*setSource\('error'\)/);
});

test('screen: no "NetSuite unreachable" badge, a visible alert, and no fake "Progress saved" on error', () => {
  // As a rendered string literal; the header comment quotes the old badge on purpose.
  assert.doesNotMatch(screen, /'[^'\n]*NetSuite unreachable[^'\n]*'/);
  assert.match(screen, /source === 'error' && \(\s*<div\s+role="alert"/);
  const guard = screen.indexOf("if (source === 'error' || source === 'loading') {");
  const preview = screen.indexOf("if (source !== 'netsuite') {");
  assert.ok(guard > -1 && guard < preview, 'the error guard must run before the fixture preview branch');
});

test('suitelet: the refusal carries the role id and logs at AUDIT, not ERROR', () => {
  const block = suitelet.slice(suitelet.indexOf('if (allowed.indexOf(Number(user.role)) === -1)'),
    suitelet.indexOf("if (context.request.method === 'GET')"));
  assert.match(block, /log\.audit\(/);
  assert.doesNotMatch(block, /log\.error\(/);
  assert.match(block, /role: Number\(user\.role\)/);
});

test('SDF: the Logistics Coordinator role is in BOTH the parameter and the audience, and allroles stays F', () => {
  const dep = sdf.slice(sdf.indexOf('<scriptdeployment scriptid="customdeploy_mcgi_sl_arch_split_execute">'));
  assert.match(dep, /<custscript_arch_split_roles>2183<\/custscript_arch_split_roles>/);
  assert.match(dep, /<audslctrole>ADMINISTRATOR\|\[scriptid=customrole2183\]<\/audslctrole>/);
  assert.match(dep, /<allroles>F<\/allroles>/);
  assert.match(dep, /<runasrole>ADMINISTRATOR<\/runasrole>/);
});
