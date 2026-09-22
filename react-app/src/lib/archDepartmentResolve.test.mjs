/**
 * `resolveDepartment` from archOrderCreate.js, tested against the SHIPPED SOURCE.
 *
 * Feedback 9, second NetSuite pass 2026-09-21. The endpoint stamped department 11
 * (`Trading : Hardwood`, mapped to subsidiary CWP MTL and nothing else) onto every
 * order. An ARC customer makes an ARC order, so NetSuite refused it with "Invalid
 * Field Value 11 for the following field: department", and it would have refused
 * every order the traders tried on ARC stock.
 *
 * 🔴 THIS FILE EXISTS IN ITS SECOND FORM, AND THE FIRST FORM IS THE LESSON.
 * v1 mocked `fld.getSelectOptions()` and passed 25/25 against an implementation
 * that called it. On a NON-DYNAMIC record that method does not exist, so in
 * production every call threw, the catch swallowed it, and the validation layer
 * was dead code — while these tests reported green. The mock proved the mock
 * worked. Only the deployed health GET exposed it:
 *
 *   "optionsError": "TypeError: fld.getSelectOptions is not a function"
 *
 * ⚠️ So the rule this file now follows: mock only what the REAL call surface is,
 * and assert the query TEXT, not just the behaviour around it. A guard that
 * cannot tell the difference between "the code works" and "my stub works" is
 * worse than no guard.
 *
 * 🔴 The function brace-walks out of the builder rather than being copied. A copy
 * tests the copy. Same technique as archVesselRule.test.mjs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(
  here,
  '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js',
);

const src = readFileSync(SRC, 'utf8');

/* ── extract `const resolveDepartment = (so) => { ... };` by brace depth ──── */
const START = 'const resolveDepartment = (so) => {';
const at = src.indexOf(START);
if (at === -1) throw new Error('resolveDepartment not found in archOrderCreate.js');
let depth = 0;
let end = -1;
for (let i = src.indexOf('{', at); i < src.length; i++) {
  const c = src[i];
  if (c === '{') depth++;
  else if (c === '}') {
    depth--;
    if (depth === 0) { end = i + 1; break; }
  }
}
if (end === -1) throw new Error('could not brace-walk resolveDepartment');
const body = src.slice(at + START.length, end - 1);

const DEFAULT_ID = Number((src.match(/DEPARTMENT_DEFAULT = (\d+)/) || [])[1]);

let fails = 0;
let ran = 0;
const ok = (label, got, want) => {
  ran++;
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) {
    fails++;
    console.error(`  FAIL ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
  }
};

const logCalls = [];
const queryCalls = [];

/*
 * `rowsFor` is a function of the subsidiary so a test can assert the query is
 * actually parameterised on it, rather than returning one canned answer
 * regardless of input — which is how a stub hides a hardcoded lookup.
 */
const call = (subsidiary, wanted, rowsFor) => {
  logCalls.length = 0;
  queryCalls.length = 0;
  const fn = new Function(
    'so', 'departmentId', 'int', 'log', 'query', 'DEPARTMENT_DEFAULT',
    body + '\n//# resolveDepartment',
  );
  return fn(
    { getValue: ({ fieldId }) => (fieldId === 'subsidiary' ? subsidiary : '') },
    () => wanted,
    (v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : 0;
    },
    {
      audit: (t, d) => logCalls.push(['audit', t, d]),
      error: (t, d) => logCalls.push(['error', t, d]),
      debug: () => {},
    },
    {
      runSuiteQL: (opts) => {
        queryCalls.push(opts);
        const out = rowsFor(opts && opts.params && opts.params[0]);
        if (out instanceof Error) throw out;
        return { asMappedResults: () => out };
      },
    },
    DEFAULT_ID,
  );
};

/* The real account, measured 2026-09-21 from `departmentsubsidiarymap`. */
const MAP = {
  5: [{ department: '9' }, { department: '10' }, { department: '11' }],   // CWP MTL
  9: [{ department: '9' }, { department: '4' }],                          // ARC
};
const real = (sub) => MAP[Number(sub)] || [];

console.log('resolveDepartment — the 11-on-ARC blocker');

/* ── the bug itself ───────────────────────────────────────────────────────── */
ok('ARC (sub 9) asked for 11 falls back to the default', call(9, 11, real), DEFAULT_ID);
ok('  logged at audit, not error', logCalls.map((c) => c[0]), ['audit']);
ok('  and the message names both departments', /11/.test(String(logCalls[0][2])) && /9/.test(String(logCalls[0][2])), true);
ok('ARC asked for 10 also falls back', call(9, 10, real), DEFAULT_ID);

/* ── MTL is untouched ─────────────────────────────────────────────────────── */
ok('MTL (sub 5) asked for 11 keeps 11', call(5, 11, real), 11);
ok('  silently', logCalls.length, 0);
ok('MTL asked for 9 keeps 9', call(5, 9, real), 9);
ok('ARC asked for 9 keeps 9, the normal path', call(9, 9, real), 9);
ok('  with no log line at all', logCalls.length, 0);

/* ── 🔴 the query must be real, parameterised, and against the right table ── */
console.log('the query itself');
call(9, 11, real);
ok('exactly one query is issued', queryCalls.length, 1);
ok('against departmentsubsidiarymap', /departmentsubsidiarymap/i.test(queryCalls[0].query), true);
ok('selecting department', /select\s+department/i.test(queryCalls[0].query), true);
ok('bound, not interpolated', queryCalls[0].query.includes('?'), true);
ok('no subsidiary id inlined in the SQL text', /\b(9|5)\b/.test(queryCalls[0].query), false);
ok('the subsidiary is passed as the parameter', queryCalls[0].params, [9]);
/* If it ignored its input it would answer the same for a subsidiary it has never
 * seen, which is how a stubbed lookup masks a hardcoded one. */
ok('an unmapped subsidiary is not silently treated as ARC', call(77, 11, real), 11);

/* ── 🔴 every unknown keeps the wish: the false-zero branch ──────────────── */
console.log('unknowns must not read as "nothing is valid"');
ok('zero rows keeps the wanted id', call(9, 11, () => []), 11);
ok('  and says nothing, because nothing was learned', logCalls.length, 0);
ok('null rows keeps the wanted id', call(9, 11, () => null), 11);
ok('a thrown query keeps the wanted id', call(9, 11, () => new Error('Invalid or unsupported search')), 11);
ok('  recorded at audit', logCalls.map((c) => c[0]), ['audit']);
ok('  naming the underlying error, so a dialect mismatch is visible',
  /unsupported search/.test(String(logCalls[0][2])), true);

/* A missing subsidiary means there is nothing to validate against. */
ok('no subsidiary on the record short-circuits', call(0, 11, () => { throw new Error('must not query'); }), 11);
ok('  and issues no query at all', queryCalls.length, 0);

/* ── neither wanted nor default valid: fail visibly, invent nothing ──────── */
console.log('no valid department');
const NEITHER = () => [{ department: '4' }, { department: '7' }];
ok('keeps the wanted id rather than guessing', call(9, 11, NEITHER), 11);
ok('  at ERROR level', logCalls.map((c) => c[0]), ['error']);
ok('  and does NOT return one of the valid-but-wrong ids',
  [4, 7].includes(call(9, 11, NEITHER)), false);

/* ── row shapes ───────────────────────────────────────────────────────────── */
console.log('row shapes');
ok('numeric department values match', call(9, 9, () => [{ department: 9 }]), 9);
ok('a null department row is skipped, not counted',
  call(9, 11, () => [{ department: null }, { department: String(DEFAULT_ID) }]), DEFAULT_ID);

/* ── the constant, the other half of the fix ──────────────────────────────── */
console.log('DEPARTMENT_DEFAULT');
ok('is 9 (Trading), mapped to 27 subsidiaries including ARC', DEFAULT_ID, 9);
ok('is NOT 11, which is CWP MTL only', DEFAULT_ID === 11, false);

/* ── and the shipped source must not have the dead call back ─────────────── */
console.log('no regression to the dead implementation');
/*
 * ⚠️ Comments are stripped first, on purpose. The function's own comment
 * explains that it USED to call `fld.getSelectOptions()`, and a bare text search
 * matched that explanation and failed — a guard that cannot tell a mention from
 * a call would force the next person to delete the history to get green.
 */
const codeOnly = body
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
ok('resolveDepartment makes no live getSelectOptions call', /getSelectOptions\s*\(/.test(codeOnly), false);
ok('  but keeps the comment saying why, so nobody re-adds it', /getSelectOptions/.test(body), true);
ok('no write site sets department straight from departmentId()',
  (src.match(/fieldId: 'department', value: departmentId\(\)/g) || []).length, 0);
ok('both write sites use resolveDepartment(so)',
  (src.match(/fieldId: 'department', value: resolveDepartment\(so\)/g) || []).length, 2);

console.log(`\n${ran - fails}/${ran} passed`);
if (fails) process.exit(1);
