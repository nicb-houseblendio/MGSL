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
  assert.match(d.message, /Audience/);
  assert.match(d.message, /Permitted Split Roles/);
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
  const block = suitelet.slice(suitelet.indexOf('if (!rolePermitted(user, allowed)) {'),
    suitelet.indexOf("if (context.request.method === 'GET')"));
  assert.match(block, /log\.audit\(/);
  assert.doesNotMatch(block, /log\.error\(/);
  assert.match(block, /role: Number\(user\.role\)/);
});

// NOT "portable": a hand-made role's script id is customrole<internal id>. The
// mechanism is right; the production preflight is pinned in the SDF test below.
test('suitelet: roles match by internal id OR script id', () => {
  assert.match(suitelet, /const rolePermitted = \(user, allowed\) =>/);
  assert.match(suitelet, /String\(user\.roleId \|\| ''\)\.toLowerCase\(\)/);
  assert.match(suitelet, /if \(!rolePermitted\(user, allowed\)\) \{/);
  // Executed, not just grepped: pull the two helpers out and run them.
  const grab = (name) => {
    const at = suitelet.indexOf('const ' + name + ' =');
    const end = suitelet.indexOf(';\n', suitelet.indexOf('=>', at));
    return suitelet.slice(at, end + 1);
  };
  const permBody = suitelet.slice(suitelet.indexOf('const permittedRoles = () => {'),
    suitelet.indexOf('    };', suitelet.indexOf('const permittedRoles = () => {')) + 6);
  const make = (param) => new Function('runtime', 'ROLE_ADMINISTRATOR',
    permBody + '\n' + grab('rolePermitted') + '\nreturn { permittedRoles, rolePermitted };')(
    { getCurrentScript: () => ({ getParameter: () => param }) }, 3);
  const a = make('customrole2183');
  assert.deepEqual(a.permittedRoles(), ['customrole2183', '3']);
  assert.equal(a.rolePermitted({ role: 2183, roleId: 'customrole2183' }, a.permittedRoles()), true);
  assert.equal(a.rolePermitted({ role: 3, roleId: 'administrator' }, a.permittedRoles()), true);
  assert.equal(a.rolePermitted({ role: 2182, roleId: 'customrole2182' }, a.permittedRoles()), false);
  const b = make('2183, CustomRole2184');
  assert.equal(b.rolePermitted({ role: 2183, roleId: 'customrole2183' }, b.permittedRoles()), true);
  assert.equal(b.rolePermitted({ role: 2184, roleId: 'customrole2184' }, b.permittedRoles()), true);
  const c = make('');
  assert.deepEqual(c.permittedRoles(), ['3']);
  assert.equal(c.rolePermitted({ role: 2183, roleId: 'customrole2183' }, c.permittedRoles()), false);
});

test('SDF: the Logistics Coordinator role is in BOTH the parameter and the audience, and allroles stays F', () => {
  const dep = sdf.slice(sdf.indexOf('<scriptdeployment scriptid="customdeploy_mcgi_sl_arch_split_execute">'));
  assert.match(dep, /<custscript_arch_split_roles>customrole2183<\/custscript_arch_split_roles>/);
  assert.match(dep, /<audslctrole>ADMINISTRATOR\|\[scriptid=customrole2183\]<\/audslctrole>/);
  assert.match(dep, /<allroles>F<\/allroles>/);
  assert.match(dep, /<runasrole>ADMINISTRATOR<\/runasrole>/);
  // The production preflight must stay next to the value it protects.
  assert.match(dep, /SELECT scriptid, name FROM role WHERE scriptid = 'customrole2183'/);
});

/* ── Round-2 review, 2026-09-22: honesty AFTER a write ──────────────────────
 * A split whose adjustment POSTED and whose SO true-up then failed was answered
 * CONFLICT (its wording matched "already") and shown as "Nothing was saved",
 * while the line left the queue as In progress. Pinned end to end below. */
const execLib = readFileSync(join(here,
  '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archSplitExecute.js'), 'utf8');
const queueLib = readFileSync(join(here,
  '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archSplitQueue.js'), 'utf8');

test('server: the post-write failure is TAGGED with posted + the adjustment id', () => {
  assert.match(execLib, /posted\.posted = true;\s*\n\s*posted\.inventoryAdjustmentId = adjustmentId;\s*\n\s*throw posted;/);
});

test('suitelet: POSTED_INCOMPLETE is decided BEFORE the expected-refusal regex, at ERROR', () => {
  const at = suitelet.indexOf('if (e.posted) {');
  const rx = suitelet.indexOf('const expected = /');
  assert.ok(at > -1 && at < rx, 'posted must be checked first');
  const block = suitelet.slice(at, rx);
  assert.match(block, /code: 'POSTED_INCOMPLETE'/);
  assert.match(block, /inventoryAdjustmentId: e\.inventoryAdjustmentId/);
  assert.match(block, /log\.error\(/);
});

test('hook: a POST with no JSON answer, or no answer, is UNKNOWN, never "nothing was written"', () => {
  // From the POST onward: before it, "nothing was written" is true (no request left).
  const post = hook.slice(hook.indexOf('const r = await fetch(url, {'));
  assert.ok(post.length > 0 && hook.indexOf('const r = await fetch(url, {') > -1);
  assert.doesNotMatch(post, /so nothing was written/);
  assert.equal((post.match(/unknown: true/g) || []).length, 2);
  assert.match(post, /posted: !!\(body && body\.posted\)/);
});

test('screen: posted or unknown results go to a persistent alert, never the "Nothing was saved" toast', () => {
  assert.match(screen, /\} else if \(res\.posted\) \{/);
  assert.match(screen, /\} else if \(res\.unknown\) \{/);
  const alertAt = screen.indexOf('if (needsHands.length) {');
  const nothingAt = screen.indexOf('setToast(`Nothing was saved. ${failed[0]}`)');
  assert.ok(alertAt > -1 && alertAt < nothingAt, 'the alert must be decided before the refusal toast');
  assert.match(screen, /saveAlert && \(\s*<div\s+role="alert"/);
});

test('screen + hook: splits claimed and never finished are shown, not silently dropped', () => {
  assert.match(hook, /setInProgressOrders\(body\.counts\?\.inProgressOrders \|\| \[\]\)/);
  assert.match(screen, /inProgressOrders\.length > 0 &&/);
  // and the standing condition is no longer an ERROR on every queue load
  const block = queueLib.slice(queueLib.indexOf('if (stuckLines.length) {'), queueLib.indexOf('if (stuckLines.length) {') + 900);
  assert.match(block, /log\.audit\('ARCH Split Queue — splits claimed and not finished'/);
});

test('hook: a NetSuite-served page with no endpoint is an ERROR, never fixtures', () => {
  const at = hook.indexOf('if (!url && servedByNetSuite()) {');
  const fx = hook.indexOf('setJobs(getSplitJobs())');
  assert.ok(at > -1 && at < fx);
  assert.match(hook.slice(at, fx), /setSource\('error'\)/);
});

test('server: a line reserving NO bundle, or a lot of another item, is refused before anything moves', () => {
  assert.match(execLib, /if \(!reserved\.length\) \{\s*\n\s*throw new Error\('That order line does not reserve any bundle/);
  assert.match(execLib, /if \(lineItemId && String\(lot\.itemId\) !== lineItemId\) \{/);
  assert.doesNotMatch(execLib, /if \(reserved\.length && !reserved\.some/);
  // both are classified as refusals, not faults
  assert.match(suitelet, /\|does not reserve\|different item\|not an ARCH item\//);
  // and the ARCH scope is enforced on the write path itself, not only in the queue
  assert.match(execLib, /if \(lot\.itemSubsidiary !== 'ARC'\) \{/);
  assert.match(execLib, /BUILTIN\.DF\(it\.subsidiary\) AS itemsub/);
});
