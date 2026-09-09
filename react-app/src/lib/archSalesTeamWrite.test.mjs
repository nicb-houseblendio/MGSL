// archOrderCreate.js — the SALES TEAM write path, loaded through the same AMD
// shim archOrderEmail.test.mjs uses, with all eight dependencies faked.
//
// ── Why these numbers and not invented ones ───────────────────────────────────
// Every team below is a real sandbox row, measured 2026-09-08:
//   entitygroup + entitygroupmember   44 active teams, 82 member rows, and every
//                                     team's contributions summing to EXACTLY 1
//   2805 Sam/Justin                   Samuel Nadon 2094 0.5 / Justin Loveland 2090 0.5
//   2808 Rettenmeier/Phil             Philippe 2093 0.67 / Samuel 2094 0.33
//   2803 Sam/Phil/Chris/Ilane         four members at 0.25
//   3302 Chris/Tom                    Christopher Pajot 3268 0.7 / Tom Gorelle 0.3,
//                                     and Pajot is issalesrep 'F'
//   3283 James Bradley                its ONLY member (3163) is issalesrep 'F'
//   a 3-way team                      0.33333 / 0.33333 / 0.33334
//   transactionsalesteam              10,170 rows over 8,665 transactions, sums
//                                     to 1 on every one, isprimary 'T' on 54
// Ids in the 9000s are synthetic, for shapes the account does not currently hold.
//
// 🔴 WHAT THIS CANNOT PROVE. Whether `record.save` ACCEPTS a `contribution` on a
// Sales Team line needs a real sales order, which this task was not allowed to
// create. So the write is asserted against a record fake, and the live answer to
// "is the field even settable" is served by the health GET
// (`lineFields.salesTeam`). Assertions marked SOURCE are source-text guards and
// are not behavioural coverage.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = process.env.ARCH_ORDER_CREATE_FILE
  || join(here, '..', '..', '..', 'src', 'FileCabinet', 'SuiteScripts', 'mcgi_services', 'trader_screen', 'shared', 'archOrderCreate.js');

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

// ── the account, as the three answerable queries ─────────────────────────────
const TEAMS = {
  2805: { groupname: 'Sam/Justin',           issalesrep: 'T', isinactive: 'F' },
  2808: { groupname: 'Rettenmeier/Phil',     issalesrep: 'T', isinactive: 'F' },
  2803: { groupname: 'Sam/Phil/Chris/Ilane', issalesrep: 'T', isinactive: 'F' },
  3302: { groupname: 'Chris/Tom',            issalesrep: 'T', isinactive: 'F' },
  3283: { groupname: 'James Bradley',        issalesrep: 'T', isinactive: 'F' },
  3137: { groupname: 'Samuel Nadon',         issalesrep: 'T', isinactive: 'F' },
  9001: { groupname: 'Three Way',            issalesrep: 'T', isinactive: 'F' },
  9002: { groupname: 'Dead Team',            issalesrep: 'T', isinactive: 'T' },
  9003: { groupname: 'Not A Sales Team',     issalesrep: 'F', isinactive: 'F' },
  9004: { groupname: 'Scoped Away',          issalesrep: 'T', isinactive: 'F' },
  9005: { groupname: 'Empty Team',           issalesrep: 'T', isinactive: 'F' },
  9006: { groupname: 'Doubled',              issalesrep: 'T', isinactive: 'F' },
  9007: { groupname: 'Garbage Id',           issalesrep: 'T', isinactive: 'F' },
  9008: { groupname: 'Retired Member',       issalesrep: 'T', isinactive: 'F' },
  9009: { groupname: 'Invisible Member',     issalesrep: 'T', isinactive: 'F' },
};
const MEMBERS = {
  2805: [{ repid: '2094', repname: 'Samuel Nadon', contribution: '0.5' },
         { repid: '2090', repname: 'Justin Loveland', contribution: '0.5' }],
  2808: [{ repid: '2093', repname: 'Philippe Grand Maitre', contribution: '0.67' },
         { repid: '2094', repname: 'Samuel Nadon', contribution: '0.33' }],
  2803: [{ repid: '2084', repname: 'Christian Labbé', contribution: '0.25' },
         { repid: '2088', repname: 'Ilane Slimani', contribution: '0.25' },
         { repid: '2093', repname: 'Philippe Grand Maitre', contribution: '0.25' },
         { repid: '2094', repname: 'Samuel Nadon', contribution: '0.25' }],
  3302: [{ repid: '3268', repname: 'Christopher Pajot', contribution: '0.7' },
         { repid: '3299', repname: 'Tom Gorelle', contribution: '0.3' }],
  3283: [{ repid: '3163', repname: 'James Bradley', contribution: '1' }],
  3137: [{ repid: '2094', repname: 'Samuel Nadon', contribution: '1' }],
  9001: [{ repid: '2094', repname: 'A', contribution: '0.33333' },
         { repid: '2090', repname: 'B', contribution: '0.33333' },
         { repid: '2091', repname: 'C', contribution: '0.33334' }],
  // One member of a 50/50 withheld by role scope: 50% comes back, not 100%.
  9004: [{ repid: '2094', repname: 'Samuel Nadon', contribution: '0.5' }],
  9005: [],
  9006: [{ repid: '2094', repname: 'Samuel Nadon', contribution: '0.5' },
         { repid: '2094', repname: 'Samuel Nadon again', contribution: '0.5' }],
  9007: [{ repid: '2094', repname: 'Samuel Nadon', contribution: '0.5' },
         { repid: '2090abc', repname: 'unparseable id', contribution: '0.5' }],
  9008: [{ repid: '2094', repname: 'Samuel Nadon', contribution: '0.5' },
         { repid: '2087', repname: 'Retired Rep', contribution: '0.5' }],
  9009: [{ repid: '2094', repname: 'Samuel Nadon', contribution: '0.5' },
         { repid: '4444', repname: 'Somebody In Another Subsidiary', contribution: '0.5' }],
};
// issalesrep / isinactive exactly as the account holds them.
const EMPLOYEES = {
  2084: { entityid: 'Christian Labbé',         issalesrep: 'T', isinactive: 'F' },
  2088: { entityid: 'Ilane Slimani',           issalesrep: 'T', isinactive: 'F' },
  2090: { entityid: 'Justin Loveland',         issalesrep: 'T', isinactive: 'F' },
  2091: { entityid: 'Chris',                   issalesrep: 'T', isinactive: 'F' },
  2093: { entityid: 'Philippe Grand Maitre',   issalesrep: 'T', isinactive: 'F' },
  2094: { entityid: 'Samuel Nadon',            issalesrep: 'T', isinactive: 'F' },
  3299: { entityid: 'Tom Gorelle',             issalesrep: 'T', isinactive: 'F' },
  3268: { entityid: 'Christopher Pajot',       issalesrep: 'F', isinactive: 'F' },
  3163: { entityid: 'James Bradley',           issalesrep: 'F', isinactive: 'F' },
  2087: { entityid: 'Retired Rep',             issalesrep: 'T', isinactive: 'T' },
};

const sqlLog = [];
let storedTeam = null;      // what verifySalesTeam reads back
let throwOn = null;         // a regex: make the matching query fail
const query = {
  runSuiteQL: ({ query: sql, params }) => {
    sqlLog.push(sql);
    if (throwOn && throwOn.test(sql)) {
      const e = new Error('Record Join not found'); e.name = 'SSS_SEARCH_ERROR'; throw e;
    }
    const rows = (() => {
      if (/FROM entitygroup\b/.test(sql)) {
        const t = TEAMS[String(params[0])];
        return t ? [{ ...t }] : [];
      }
      if (/FROM entitygroupmember/.test(sql)) {
        return (MEMBERS[String(params[0])] || []).map((m) => ({ ...m }));
      }
      if (/FROM employee/.test(sql)) {
        const ids = ((sql.match(/IN \(([^)]*)\)/) || [])[1] || '').split(',').map((s) => s.trim());
        return ids.filter((id) => EMPLOYEES[id]).map((id) => ({ id, ...EMPLOYEES[id] }));
      }
      if (/FROM transactionsalesteam/.test(sql)) return (storedTeam || []).map((r) => ({ ...r }));
      return [];
    })();
    return { asMappedResults: () => rows };
  },
};
const logged = { audit: [], error: [] };
const log = {
  audit: (t, m) => logged.audit.push(t + ' | ' + m),
  error: (t, m) => logged.error.push(t + ' | ' + m),
  debug: () => {},
};
const runtime = {
  /* 🔴 THE COMMISSION LATCH IS ON IN THIS FAKE, DELIBERATELY.
   *
   * `resolveSalesTeam` returns null unless `custscript_arch_salesteam_write_on` is
   * enabled, because writing a multi-member team attributes commission on a real sales
   * document and MGSL have not asked for it yet. The latch has its own assertions at
   * the bottom of this file, and more in archSalesTeams.test.mjs.
   *
   * ⚠️ Do NOT simplify this back to `getParameter: () => null`. Every assertion about
   * the write logic would then pass vacuously, because the function under test would
   * refuse before it ran. That is exactly how this suite broke once.
   */
  getCurrentScript: () => ({
    getParameter: (opts) =>
      ((opts && opts.name) === 'custscript_arch_salesteam_write_on' ? 'T' : null),
  }),
  getCurrentUser: () => ({ id: 3136 }),
};
const inert = new Proxy({}, {
  get: (_t, k) => (k === 'Type'
    ? new Proxy({}, { get: (_x, y) => String(y).toLowerCase() })
    : () => { throw new Error('unexpected dependency call: ' + String(k)); }),
});

let mod = null;
const define = (deps, factory) => {
  const table = {
    'N/record': inert, 'N/query': query, 'N/search': inert, 'N/runtime': runtime,
    'N/log': log, 'N/render': inert, 'N/email': inert, './archSplitExecute': {},
  };
  mod = factory(...deps.map((d) => {
    if (!(d in table)) throw new Error('unfaked dep ' + d);
    return table[d];
  }));
};
const src = fs.readFileSync(FILE, 'utf8');
new Function('define', src)(define);

ok('module exports the three sales-team functions for the test runner',
  !!mod && typeof mod.resolveSalesTeam === 'function' && typeof mod.writeSalesTeam === 'function'
  && typeof mod.verifySalesTeam === 'function',
  mod && Object.keys(mod));
if (!mod || typeof mod.resolveSalesTeam !== 'function' || typeof mod.writeSalesTeam !== 'function'
    || typeof mod.verifySalesTeam !== 'function') {
  console.log('\nFAILURES: ' + (fail || 1));
  process.exit(1);
}
const { resolveSalesTeam, writeSalesTeam, verifySalesTeam } = mod;
const refusalOf = (fn) => {
  try { fn(); return null; } catch (e) { return { name: e.name, message: e.message }; }
};

// ── 1. the happy paths, and the percentages the FIELD wants ──────────────────
let t = resolveSalesTeam('2805');
ok('Sam/Justin resolves to two members', t.memberCount === 2 && t.teamName === 'Sam/Justin', t);
ok('percentages are the TYPED number (50), not the stored fraction (0.5)',
  t.members.every((m) => m.pct === 50), t.members);
ok('names come from the employee record rather than the member row',
  t.members.map((m) => m.name).join('|') === 'Justin Loveland|Samuel Nadon', t.members);
ok('members are sorted by employee id, so the remainder rule is deterministic',
  t.members[0].id === 2090 && t.members[1].id === 2094, t.members);

t = resolveSalesTeam('2808');
ok('a real 0.67/0.33 weighting survives as 67/33 rather than being evened out',
  t.members.map((m) => m.pct).sort((a, b) => a - b).join('/') === '33/67', t.members);

t = resolveSalesTeam('2803');
ok('the four-member team is 25% each and totals 100',
  t.memberCount === 4 && t.members.every((m) => m.pct === 25), t.members);

// 🔴 THE ROUNDING CASE. 0.33333 * 100 is 33.332999999999998 in IEEE 754, so three
// naively rounded members total 99.999 and Team Selling wants 100.
t = resolveSalesTeam('9001');
const pcts = t.members.map((m) => m.pct);
ok('a 0.33333/0.33333/0.33334 team totals EXACTLY 100',
  pcts.reduce((s, p) => s + p, 0) === 100, pcts);
ok('and reproduces the stored 33.333/33.333/33.334 rather than inventing thirds',
  pcts.slice().sort().join(',') === '33.333,33.333,33.334', pcts);
// WARNING, and it is deliberate: on the account's five-decimal data the
// remainder rule buys NOTHING. Rounding 0.33333/0.33333/0.33334 naively already
// totals exactly 100, and a brute force over every five-decimal two- and
// three-way split with no member below 5% finds no case that loses a hundredth.
// It buys the case that WOULD, which is a fraction with more than six decimals.
ok('the measured 5-decimal team does not need the remainder rule (stated, not implied)',
  [0.33333, 0.33333, 0.33334].reduce((s, f) => s + Math.round(f * 1000000) / 10000, 0) === 100);
ok('but a true one third rounds naively to 99.9999, which Team Selling refuses',
  [1 / 3, 1 / 3, 1 / 3].reduce((s, f) => s + Math.round(f * 1000000) / 10000, 0) !== 100,
  [1 / 3, 1 / 3, 1 / 3].reduce((s, f) => s + Math.round(f * 1000000) / 10000, 0));

t = resolveSalesTeam('3137');
ok('a one-member team resolves to 100%', t.memberCount === 1 && t.members[0].pct === 100, t);

// ── 2. every refusal, because each is a different real cause ─────────────────
ok('a non-numeric team id is refused, not coerced',
  (refusalOf(() => resolveSalesTeam('SO-CWP-001352')) || {}).name === 'ARCH_ORDER_REFUSED');
ok('so are a float, an injection shape, a negative id and zero',
  ['2805.9', '1 OR 1=1', '-5', '0', 'abc', '2805abc'].every(
    (v) => (refusalOf(() => resolveSalesTeam(v)) || {}).name === 'ARCH_ORDER_REFUSED'));

let r = refusalOf(() => resolveSalesTeam('999999'));
ok('an unknown team says it may be out of scope rather than only "not found"',
  /does not exist, or is outside the subsidiaries/.test(r.message), r);
r = refusalOf(() => resolveSalesTeam('9002'));
ok('an inactive team is refused', /is inactive/.test(r.message), r);
r = refusalOf(() => resolveSalesTeam('9003'));
ok('an employee group that is not a sales team is refused', /not a sales team/.test(r.message), r);
r = refusalOf(() => resolveSalesTeam('9005'));
ok('a team with no readable members is refused, never posted empty',
  /no active members/.test(r.message), r);

// 🔴 6 of the 44 real teams fail this one.
ok('a team whose members are all active reps is NOT refused (control)',
  refusalOf(() => resolveSalesTeam('2808')) === null);
r = refusalOf(() => resolveSalesTeam('3283'));
ok('the real "James Bradley" team is refused: its only member is not flagged Sales Rep',
  r && /James Bradley is not flagged Sales Rep/.test(r.message), r);
ok('and the refusal says the WHOLE order would have failed, not just the line',
  r && /refuses the WHOLE order/.test(r.message) && /no part of this team was written/.test(r.message), r);
r = refusalOf(() => resolveSalesTeam('3302'));
ok('the real Chris/Tom team is refused for the same reason, naming Pajot',
  r && /Christopher Pajot is not flagged Sales Rep/.test(r.message), r);
r = refusalOf(() => resolveSalesTeam('9008'));
ok('an INACTIVE member is refused, and distinguished from not being a rep',
  r && /Retired Rep is inactive/.test(r.message) && !/not flagged/.test(r.message), r);
r = refusalOf(() => resolveSalesTeam('9009'));
ok('a member the role cannot see is refused as out of scope, not as "not a rep"',
  r && /is outside the subsidiaries this endpoint can write for/.test(r.message), r);

// The withheld-member case, which is what a `g.size` comparison used to be for.
r = refusalOf(() => resolveSalesTeam('9004'));
ok('a team whose readable members total 50% is refused as INCOMPLETE, not posted at 50%',
  r && /adds up to 50% across the 1 member\(s\)/.test(r.message), r);
ok('and it points at role scope rather than blaming the team',
  r && /outside the subsidiaries this endpoint can read/.test(r.message), r);

// ── 3. one person twice in a group must not be credited twice ────────────────
// Refused by NAME rather than deduplicated: two rows at 0.5 mean the group
// intends that person 100%, so keeping one of them would credit 50% instead, and
// verifySalesTeam compares by employee id so it would read back as correct.
r = refusalOf(() => resolveSalesTeam('9006'));
ok('a member listed twice is refused by name, not silently deduplicated',
  r && /lists Samuel Nadon more than once/.test(r.message) && /ambiguous/.test(r.message), r);

// ── 4. an unparseable member id is dropped, and the SUM then catches it ──────
r = refusalOf(() => resolveSalesTeam('9007'));
ok('a member row with an unusable id is dropped and the shortfall refuses the team',
  r && /adds up to 50% across the 1 member\(s\)/.test(r.message), r);

// ── 5. a query failure is a refusal that quotes NetSuite, never a fallback ───
throwOn = /FROM entitygroupmember/;
logged.error.length = 0;
r = refusalOf(() => resolveSalesTeam('2805'));
throwOn = null;
ok('a failed member read refuses and states that nothing was attributed',
  r && /no commission was attributed/.test(r.message), r);
ok('and quotes NetSuite verbatim, the only way a dialect problem is identifiable',
  r && /SSS_SEARCH_ERROR: Record Join not found/.test(r.message), r);
ok('and logs the failing query at error level',
  logged.error.some((l) => /sales team read failed/.test(l)), logged.error);
throwOn = /FROM employee/;
r = refusalOf(() => resolveSalesTeam('2805'));
throwOn = null;
ok('a failed EMPLOYEE read also refuses rather than skipping validation',
  r && r.name === 'ARCH_ORDER_REFUSED' && /could not be read/.test(r.message), r);

// ── 6. the reserved word and the query shape ─────────────────────────────────
sqlLog.length = 0;
resolveSalesTeam('2805');
ok('the group, the members and the employees are three separate reads', sqlLog.length === 3, sqlLog);
const memberSql = sqlLog.find((s) => /entitygroupmember/.test(s)) || '';
ok('`group` is DOUBLE-QUOTED: it is reserved and the read is a hard 400 without it',
  /"group"\s*=\s*\?/.test(memberSql), memberSql);
ok('the member read filters inactive members out in SQL', /isinactive = 'F'/.test(memberSql), memberSql);
ok('no query joins grouptype, which is a record join inside N/query and failed live',
  sqlLog.every((s) => !/grouptype/i.test(s)), sqlLog);
ok('no query reads entitygroup.size either, so only ONE unproven identifier is used',
  sqlLog.every((s) => !/\bsize\b/i.test(s)), sqlLog);
const empSql = sqlLog.find((s) => /FROM employee/.test(s)) || '';
ok('the employee read selects the FLAGS rather than filtering on them, so a refusal can name the cause',
  /issalesrep/.test(empSql) && !/issalesrep = 'T'/.test(empSql), empSql);
ok('and its IN list holds only digits and commas', /IN \([\d,]+\)$/.test(empSql.trim()), empSql);

// ── 7. writeSalesTeam against a record fake ──────────────────────────────────
const makeRecord = (sublistFields, existingEmployees) => {
  const lines = (existingEmployees || []).map((e) => ({ employee: e }));
  return {
    getSublistFields: ({ sublistId }) => (sublistId === 'salesteam' ? sublistFields.slice() : []),
    getLineCount: ({ sublistId }) => (sublistId === 'salesteam' ? lines.length : 0),
    getSublistValue: ({ fieldId, line }) => lines[line][fieldId],
    removeLine: ({ line }) => { lines.splice(line, 1); },
    setSublistValue: ({ fieldId, line, value }) => {
      while (lines.length <= line) lines.push({});
      lines[line][fieldId] = value;
    },
    lines: lines,
  };
};
const FULL = ['employee', 'salesrole', 'contribution', 'isprimary'];

let rec = makeRecord(FULL, []);
let w = writeSalesTeam(rec, resolveSalesTeam('2805'));
ok('a two-member team writes two lines', rec.lines.length === 2, rec.lines);
ok('and sets contribution on both, as the typed number',
  rec.lines.every((l) => l.contribution === 50), rec.lines);
ok('and NEVER sets salesrole (setting it turned USER_ERROR into UNEXPECTED_ERROR)',
  rec.lines.every((l) => l.salesrole === undefined), rec.lines);
ok('and NEVER sets isprimary (8,611 of 8,665 real teams carry no primary)',
  rec.lines.every((l) => l.isprimary === undefined), rec.lines);
ok('a new order reports no previous team',
  w.previousEmployees.length === 0 && w.contributionWritten === true, w);

rec = makeRecord(FULL, []);
writeSalesTeam(rec, resolveSalesTeam('2808'));
ok('the 67/33 weighting reaches the sublist as 67 and 33',
  rec.lines.map((l) => l.contribution).sort((a, b) => a - b).join('/') === '33/67', rec.lines);

rec = makeRecord(FULL, []);
writeSalesTeam(rec, resolveSalesTeam('3137'));
ok('a ONE-member team sets only employee, keeping the byte-for-byte proven path',
  rec.lines.length === 1 && rec.lines[0].employee === 2094 && rec.lines[0].contribution === undefined,
  rec.lines);

// 🔴 the refusal that separates money from a note
rec = makeRecord(['employee', 'salesrole'], []);
r = refusalOf(() => writeSalesTeam(rec, resolveSalesTeam('2805')));
ok('no contribution field plus a multi-member team is REFUSED, not posted without its split',
  r && /does not expose a contribution field/.test(r.message), r);
ok('and nothing was written to the record', rec.lines.length === 0, rec.lines);
rec = makeRecord(['employee'], []);
writeSalesTeam(rec, resolveSalesTeam('3137'));
ok('a ONE-member team still writes when there is no contribution field',
  rec.lines.length === 1 && rec.lines[0].employee === 2094, rec.lines);

// ── 8. replacing a team on an APPEND ─────────────────────────────────────────
// SO-CWP-001352 really is Justin 2090 + Samuel 2094. Replacing it with a
// one-member team must leave ONE line, not three.
rec = makeRecord(FULL, [2090, 2094]);
w = writeSalesTeam(rec, resolveSalesTeam('3137'));
ok('replacing a two-member team leaves exactly one line', rec.lines.length === 1, rec.lines);
ok('and reports what it replaced, so the change is recoverable from the response alone',
  w.previousEmployees.join(',') === '2090,2094', w);
rec = makeRecord(FULL, [2090, 2094, 3163]);
writeSalesTeam(rec, resolveSalesTeam('2808'));
ok('replacing three members with two leaves two, with no stale third line',
  rec.lines.length === 2 && rec.lines.map((l) => l.employee).join(',') === '2093,2094', rec.lines);

// A record that refuses to give up its existing lines must abandon the request,
// not save a half-cleared sublist. Nothing is committed until save(), so the
// order in NetSuite is untouched either way.
logged.error.length = 0;
const stubborn = makeRecord(FULL, [2090, 2094]);
stubborn.removeLine = () => { const e = new Error('SUBLIST_READ_ONLY'); e.name = 'SSS_INVALID'; throw e; };
r = refusalOf(() => writeSalesTeam(stubborn, resolveSalesTeam('3137')));
ok('a sublist that cannot be cleared is a REFUSAL naming NetSuite, not a raw failure',
  r && r.name === 'ARCH_ORDER_REFUSED' && /no commission was reattributed/.test(r.message)
  && /SSS_INVALID: SUBLIST_READ_ONLY/.test(r.message), r);
ok('and it logs how far it got before failing',
  logged.error.some((l) => /Read 2 of 2 existing line\(s\) before failing/.test(l)), logged.error);

// ── 9. verifySalesTeam: fractions out, typed numbers in ──────────────────────
t = resolveSalesTeam('2805');
storedTeam = [{ employee: '2090', contribution: '0.5' }, { employee: '2094', contribution: '0.5' }];
let v = verifySalesTeam(126664, t);
ok('a matching read-back verifies clean', v.verified === true && v.mismatches.length === 0, v);

storedTeam = [{ employee: '2090', contribution: '50' }, { employee: '2094', contribution: '50' }];
v = verifySalesTeam(126664, t);
ok('a read-back of 50 where 0.5 was meant IS a mismatch (the Percent trap, caught)',
  v.mismatches.length === 2, v);

storedTeam = [{ employee: '2090', contribution: '1' }];
v = verifySalesTeam(126664, t);
ok('a dropped member is reported by name',
  v.mismatches.some((m) => /Samuel Nadon is not on the saved order/.test(m)), v);
ok('and the survivor at 100% is reported as the wrong share',
  v.mismatches.some((m) => /Justin Loveland stored 1 where 0\.5/.test(m)), v);

storedTeam = [{ employee: '2090', contribution: '0.5' }, { employee: '2094', contribution: '0.5' },
  { employee: '3163', contribution: '0' }];
v = verifySalesTeam(126664, t);
ok('an employee credited on the order but not in the team is reported',
  v.mismatches.some((m) => /employee 3163 is credited on the saved order/.test(m)), v);

throwOn = /FROM transactionsalesteam/;
logged.audit.length = 0; logged.error.length = 0;
v = verifySalesTeam(126664, t);
throwOn = null;
ok('an UNREADABLE sublist reports verified:false with NO mismatches, never a false alarm',
  v.verified === false && v.mismatches.length === 0, v);
ok('and audits rather than errors, because "could not tell" is not actionable',
  logged.audit.some((l) => /unverified/.test(l)) && logged.error.length === 0,
  { audit: logged.audit, error: logged.error });

// the three-way rounding, verified end to end against its own stored fractions
t = resolveSalesTeam('9001');
storedTeam = [{ employee: '2090', contribution: '0.33333' },
  { employee: '2091', contribution: '0.33334' },
  { employee: '2094', contribution: '0.33333' }];
v = verifySalesTeam(1, t);
ok('the 33.333/33.333/33.334 team verifies against the fractions NetSuite would store',
  v.verified === true && v.mismatches.length === 0, v);

// ── 10. SOURCE guards: the wiring a record fake cannot reach ─────────────────
// createOrder needs a real N/record and a resolved cart, so these are source
// assertions and are labelled as such rather than implying behaviour.
ok('SOURCE: the team is resolved BEFORE the record is created, so a refusal writes nothing',
  src.indexOf('const namedTeam =') > 0
  && src.indexOf('const namedTeam =') < src.indexOf('? record.load({ type: record.Type.SALES_ORDER'),
  false);
ok('SOURCE: with no salesTeamId the team is null, so the rep path is unchanged',
  /String\(teamRequest\)\.trim\(\) === ''\)\s*\r?\n\s*\? null\s*\r?\n\s*: resolveSalesTeam\(teamRequest\)/.test(src),
  false);
ok('SOURCE: a named team skips resolveSalesRep instead of running both',
  /const repId = namedTeam \? null : resolveSalesRep\(/.test(src), false);
ok('SOURCE: the rep refusal only fires when NO team was named',
  /if \(!namedTeam && !repId\) \{/.test(src), false);
ok('SOURCE: no default, configured or fallback sales TEAM parameter exists anywhere',
  !/custscript_arch_default_sales_team|custscript_arch_sales_team/.test(src), false);
ok('SOURCE: the dry run validates the team too, so a bad team is caught before pricing',
  /const teamProblems = \[\];/.test(src) && /teamProblems\.concat\(resolved\.problems\)/.test(src), false);
ok('SOURCE: the health GET reports what the salesteam sublist accepts',
  /getSublistFields\(\{ sublistId: 'salesteam' \}\)/.test(src)
  && /contribution: st\.indexOf\('contribution'\) !== -1/.test(src), false);
ok('SOURCE: a team mismatch after the save is logged at ERROR, like an assignment mismatch',
  /SALES TEAM MISMATCH on SO/.test(src), false);
{
  // The append branch runs from its own header comment to the append externalid
  // marker. THE POINT OF ITEM 2: nothing in it touches the rep.
  const start = src.indexOf('── Header fields on an APPEND');
  const end = src.indexOf('if (appending && idempotencyKey) {');
  const appendBlock = start > 0 && end > start ? src.slice(start, end) : '';
  ok('SOURCE: the append branch never sets custbody_sales_rep and never resolves a rep',
    !!appendBlock && !/setIfPresent\(so, H_SALES_REP/.test(appendBlock)
    && !/resolveSalesRep\(/.test(appendBlock), appendBlock.length);
  ok('SOURCE: it writes a NAMED team, and says the commission was reattributed',
    /Sales team on SO ' \+ existingId \+ ' REPLACED by an explicit request/.test(appendBlock)
    && /Commission on this order has been reattributed/.test(appendBlock), false);
  ok('SOURCE: and it argues the decision from the measured 50/50 order rather than asserting it',
    /SO-CWP-001352/.test(appendBlock) && /Samuel Nadon \/ Justin/.test(appendBlock), false);
}

/* ── THE LATCH, FROM THE SERVER'S SIDE ───────────────────────────────────────────
 *
 * The client cannot be the only thing stopping a commission write: the endpoint is a
 * URL and anything can POST to it. Added 2026-09-09 after an adversarial pass found
 * the wizard sending a team id on every new order with no gate, inert only because
 * the service action was still undeployed, i.e. ONE deploy away from attributing
 * commission nobody had approved, from two halves built the same day.
 *
 * Every one of these must resolve to NOTHING.
 */
for (const [why, getParameter] of [
  ['no parameter at all', () => null],
  ['an empty string', () => ''],
  ['the string F', () => 'F'],
  ['boolean false', () => false],
  ['a parameter that THROWS because it is not on the deployment', () => { throw new Error('SSS_INVALID_SCRIPT_PARAMETER'); }],
]) {
  let m = null;
  new Function('define', src)((deps, factory) => {
    const table = {
      'N/record': inert, 'N/query': query, 'N/search': inert, 'N/log': log,
      'N/render': inert, 'N/email': inert, './archSplitExecute': {},
      'N/runtime': { getCurrentScript: () => ({ getParameter }), getCurrentUser: () => ({ id: 3136 }) },
    };
    m = factory(...deps.map((d) => table[d]));
  });
  const got = m.resolveSalesTeam('2805');
  ok('latch OFF (' + why + '): a named team resolves to NOTHING, so no commission is written',
    got === null, got);
}

console.log('\n' + (fail ? 'FAILURES: ' + fail : 'all passed'));
if (fail) process.exit(1);
